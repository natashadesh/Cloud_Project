# Job distribution

## 1. The three-person split

The system is divided like this:

| Person | Main responsibility |
| --- | --- |
| Natalia | Job API + DynamoDB + API Gateway |
| Bhavan | Static-analysis worker + private file storage |
| Tanishq | External-API worker + frontend website |

Each member owns one Lambda end-to-end.

So visually:

```text
                    Natalia
                      │
               API Gateway
                      │
                Job API Lambda
                      │
              ┌───────┴───────┐
              │               │
              ▼               ▼
           Bhavan           Tanishq
       Analysis Lambda   API-check Lambda
              │               │
        Private S3        Website/UI
```

But they are not independent mini-projects. All three pieces have to use the same job format, Terraform environment, AWS account, and deployment conventions.

## 2. Natalia: the orchestration/control person

Natalia owns the part that coordinates everything.

Their outcome is:

> A browser or HTTP client should be able to create a job, start the correct worker, and retrieve reliable status.

Their AWS responsibilities are mainly:

```text
API Gateway
     ↓
Job API Lambda
     ↓
DynamoDB
```

They create:

- API Gateway.
- The Job API Lambda.
- DynamoDB.
- IAM permissions for the API.
- The API's CloudWatch log group.

They also implement the four API operations:

```text
POST /jobs
POST /jobs/{jobId}/start
GET  /jobs/{jobId}
GET  /jobs/{jobId}/report
```

### The important concept

Natalia owns the **job lifecycle**.

Think:

```text
CREATED
   ↓
QUEUED
   ↓
RUNNING
   ↓
SUCCEEDED / FAILED
```

Natalia's code decides whether starting is allowed, whether a job has expired, whether a duplicate start should be ignored, and which worker should run.

So Natalia is effectively responsible for the application's control plane.

## 3. Bhavan: file processing and private storage

Bhavan owns the static-analysis path.

Their expected result is:

> ZIP, TAR, or text goes in → analysis runs → private text report comes out.

Their main AWS resources are:

```text
ECR
 ↓
Analysis Lambda
 ↓
Private S3 artifacts bucket
```

They create the:

- Analysis ECR repository.
- Analysis Lambda.
- IAM execution role.
- CloudWatch log group.
- Private artifacts bucket.
- S3 versioning.
- Lifecycle rules.
- CORS configuration.

Their application work includes the more file-heavy logic:

- Extract the existing regex tool from its HTTP server.
- Make it a Lambda handler.
- Read the correct S3 object version.
- Validate ZIP/TAR/text inputs.
- Enforce archive limits.
- Generate the report.
- Upload it back to S3.

### One subtle ownership rule

Bhavan also writes some code inside Natalia's Job API service.

Specifically, Bhavan owns the S3 helper functions used for things like:

- Create upload form.
- Inspect uploaded object.
- Create signed report link.

But Natalia owns the routes that call those helpers.

That is an important team-design lesson:

> File ownership can cross service boundaries when one person has the relevant domain responsibility.

## 4. Tanishq: external checker + browser UI

Tanishq owns both the second worker and the visible frontend.

Their outcome is:

> The website can submit either type of job, survive a page close, and display/download reports.

Their AWS side includes:

- API-check ECR repository.
- API-check Lambda.
- Its IAM role.
- Its logs.
- Public S3 website bucket.
- Website assets.
- Generated `config.json`.

Their application responsibilities include:

- **API-check Lambda.**
- **HTML/CSS/JavaScript frontend.**

The UI must support:

- Choosing the tool.
- Entering parameters.
- Uploading files directly.
- Starting jobs.
- Polling status.
- Showing errors.
- Displaying reports.
- Downloading reports.
- Reopening jobs using `localStorage`.
- Restoring jobs from `/#job=<jobId>`.

The document explicitly says not to overbuild the frontend. No new framework, design system, authentication UI, or major redesign is required.

The goal is functional integration, not frontend polish.

## 5. The biggest team risk: incompatible interfaces

This may be the most important section of the whole document.

Before everyone starts coding separately, the team must agree on the shared contracts.

The document says the first working session should define things such as:

- Job schema.
- Lifecycle states.
- Worker event format.
- API request/response formats.
- S3 helper interfaces.
- File naming conventions.
- External API parameters.
- Browser origin/CORS.
- Deployment naming conventions.

For example, all workers receive only:

```json
{
  "jobId": "..."
}
```

Then they load everything else from DynamoDB.

That means Bhavan must not invent:

```json
{
  "jobId": "...",
  "bucket": "...",
  "filename": "...",
  "type": "..."
}
```

while Tanishq invents a different worker format.

They must share one contract.

## 6. Both workers must behave the same way

Even though Bhavan and Tanishq own different Lambda functions, their state-handling behavior must be identical.

The document explicitly says both workers should use the same claim/completion conditions.

Conceptually:

```text
receive jobId
     ↓
read DynamoDB
     ↓
check job type/status
     ↓
conditionally claim QUEUED → RUNNING
     ↓
do work
     ↓
write result
     ↓
conditionally RUNNING → SUCCEEDED
```

This matters because otherwise you might get:

```text
Analysis worker:
QUEUED → RUNNING → SUCCEEDED

API worker:
QUEUED → PROCESSING → COMPLETE
```

Then Natalia's API would need to understand two incompatible lifecycles.

The document intentionally avoids that.

## 7. Terraform is shared, not three separate deployments

This is another major concept.

There is still only:

```text
infra/
    registry/
    app/
```

The Terraform files are divided by owner, but they form one infrastructure configuration.

For example:

| Owner | Terraform files |
| --- | --- |
| Natalia | `job_api.tf`, `http_api.tf`, `jobs.tf` |
| Bhavan | `analysis.tf`, `artifacts.tf` |
| Tanishq | `api_check.tf`, `website.tf`, `frontend.tf` |

So ownership does not mean:

```text
Natalia deploys Natalia's stack
Bhavan deploys Bhavan's stack
Tanishq deploys Tanishq's stack
```

It means:

```text
Natalia + Bhavan + Tanishq Terraform
                ↓
         one merged plan
                ↓
    one shared AWS environment
```

## 8. Why remote Terraform state becomes necessary

The original architecture said local Terraform state was acceptable for one developer.

This document changes that because there are now three people.

If every person had their own state file:

- Natalia thinks these resources exist.
- Bhavan thinks different resources exist.
- Tanishq thinks different resources exist.

That would be dangerous.

So the plan requires **shared remote Terraform state in S3**.

Conceptually:

```text
            Natalia
               │
               ▼
             shared
Bhavan ─── Terraform ─── Tanishq
             state
             in S3
```

The document also uses S3 state locking so two people do not modify Terraform state simultaneously.

### But state locking is not enough

This point is easy to miss.

Suppose:

- **Natalia's branch** = yesterday's Terraform.
- **Bhavan's branch** = newest Terraform.

Even if Terraform state locking prevents simultaneous writes, Natalia could still apply an outdated configuration after Bhavan.

So the team also needs a human/process rule:

> **Important:** Apply only reviewed Terraform from the current merged revision.

That is why deployments have one designated operator.

## 9. The milestones are integration gates, not deadlines

The plan defines:

- **M0**
- **M1**
- **M2**
- **M3**
- **M4**

But they are not dates.

They represent progressively more complete states of the system.

### M0 — agree before coding

The team agrees on:

- AWS access.
- Region.
- Terraform state.
- Interfaces.
- Ownership.

### M1 — independent implementation

Everyone can work in parallel.

| Member | Builds |
| --- | --- |
| Natalia | API + DynamoDB skeleton |
| Bhavan | S3 + ECR + analysis worker |
| Tanishq | Website + ECR + API-check worker |

### M2 — first complete cloud deployment

The pieces are merged enough that:

- All 3 Lambdas run.
- DynamoDB exists.
- Buckets exist.
- API exists.
- Logs work.

### M3 — static-analysis flow works end-to-end

Now the complete path works:

```text
Website
 ↓
API
 ↓
upload
 ↓
analysis Lambda
 ↓
report
 ↓
website
```

### M4 — both complete workflows work

Both tools work, including failure handling and recovery.

## 10. Fixtures let people work before everything exists

A useful software-team idea in the document is **contract-driven parallel development**.

For example, Tanishq does not need to wait until Natalia finishes the API.

Tanishq can build the frontend against fake API responses such as:

```json
{
  "jobId": "123",
  "status": "RUNNING"
}
```

Likewise Bhavan can create a test DynamoDB record and invoke the analysis worker without the real browser/API flow.

The document explicitly encourages using fixtures and development scripts while dependencies are unfinished.

This is how they avoid:

- Bhavan waits for Natalia.
- Tanishq waits for Natalia.
- Natalia waits for Bhavan and Tanishq.

## 11. Everyone must prove their work in the cloud

A task is not complete merely because the code exists.

Each person has explicit completion evidence.

For example, Natalia must demonstrate things like:

- Submit both job types.
- Duplicate start does not duplicate work.
- Expired job fails correctly.
- Invalid requests return correct errors.

Bhavan must demonstrate:

- ZIP/TAR/text scanning.
- Private S3 access.
- Version pinning.
- Duplicate worker protection.
- Bad archive handling.

Tanishq must demonstrate:

- API-check submission.
- Correct worker routing.
- Report display/download.
- Close/reopen recovery.
- Safe HTML-like report rendering.

This is basically saying:

> **“Done” means observable AWS behavior, not just committed code.**

## 12. Peer review is deliberately cross-functional

The review assignments are:

| Owner | Reviewer |
| --- | --- |
| Natalia | Tanishq |
| Bhavan | Natalia |
| Tanishq | Bhavan |

And the joint verification section mixes responsibilities further.

For example:

| Verification area | Lead | Reviewer |
| --- | --- | --- |
| Job routing | Natalia | Tanishq |
| Archive behavior | Bhavan | Natalia |
| Frontend behavior | Tanishq | Bhavan |

The reason is educational: the plan wants everyone to understand more than just their own code.

## 13. Everyone must lead a deployment

Another important requirement is that nobody becomes just:

- The frontend person.
- The backend person.
- The Terraform person.

Everyone writes Terraform and operates AWS.

The deployments rotate:

1. **Natalia** leads first complete deployment.
2. **Bhavan** leads analysis integration deployment.
3. **Tanishq** leads final deployment.

There are also rotating AWS walkthroughs so each member operates another person's area.

The intended learning outcome is that each person can:

- Deploy their Lambda.
- Diagnose IAM failures.
- Diagnose runtime errors.
- Understand their AWS configuration.
- Repeat someone else's cloud check.

## 14. Workload equality does not mean equal ticket counts

The plan explicitly says the workload is balanced by difficulty and learning, not by counting tasks.

For example:

- **Natalia** has a more complex job lifecycle.
- **Bhavan** has archive parsing and storage complexity.
- **Tanishq** gets the simpler API worker but also owns the frontend.

So:

- **Natalia:** complex orchestration.
- **Bhavan:** complex file processing.
- **Tanishq:** simpler worker + UI.

The goal is approximately comparable effort.

## 15. Ownership can be adjusted if someone becomes blocked

After M1 the team should reevaluate actual workload.

The document gives explicit redistribution rules.

For example, if Natalia becomes overloaded:

- Bhavan helps with storage integration.
- Tanishq helps test API fixtures.
- **Natalia retains lifecycle ownership.**

If Bhavan gets stuck on archive handling:

- Natalia helps with state transitions.
- Tanishq helps create test files.
- **Bhavan retains analysis ownership.**

The important principle is:

> Help can move, but conceptual ownership stays clear.

## 16. Things intentionally excluded

Just like the architecture document, this plan tries hard to prevent scope creep.

Phase 1 explicitly excludes:

- SQS.
- Authentication.
- Custom domains.
- CloudFront.
- Dashboards.
- Alerts.
- Tracing.
- Background reconciliation.

That is important because with three people it is very easy for somebody to say:

> “While I'm working on this, I'll also add login.”

Then suddenly their workstream becomes twice as large.

The plan says not to do that.

## The whole document in one picture

Think of the three roles like this:

```text
                    ┌──────────────────────┐
                    │      Natalia         │
                    │                      │
Browser ───────────►│ API Gateway          │
                    │ Job API Lambda       │
                    │ DynamoDB             │
                    └─────────┬────────────┘
                              │ jobId
                   ┌──────────┴──────────┐
                   │                     │
                   ▼                     ▼
        ┌──────────────────┐   ┌──────────────────┐
        │     Bhavan       │   │    Tanishq       │
        │                  │   │                  │
        │ Analysis Lambda  │   │ API-check Lambda │
        │ ECR              │   │ ECR              │
        │ Private S3       │   │ Website S3       │
        │ Archive handling │   │ Browser UI       │
        └──────────────────┘   └──────────────────┘
```

But underneath all three:

- Shared contracts.
- Shared AWS account.
- Shared Terraform.
- Shared Terraform state.
- Shared lifecycle model.
- Peer review.
- Rotating deployments.

That is really what this document is organizing.

## The 7 ideas I would remember

1. Each person owns a **vertical slice**, not just a few tickets.
2. **Natalia** owns orchestration, **Bhavan** owns files/analysis, **Tanishq** owns external API/UI.
3. **Shared interfaces** must be agreed before parallel coding.
4. The two workers must implement the same **job-state behavior**.
5. There is **one shared Terraform environment**, not three separate stacks.
6. **Shared remote Terraform state** is necessary for a team.
7. Completion means demonstrating **working behavior in AWS**, with peer review and deployment experience.
