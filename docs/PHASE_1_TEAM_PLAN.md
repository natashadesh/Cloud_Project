# Phase 1 delivery plan — three team members

This plan divides the Phase 1 design in [ARCHITECTURE.md](/Users/pge/Documents/ProjectArch/ARCHITECTURE.md) into three workstreams with comparable AWS learning opportunities. Member A, Member B, and Member C are placeholders for the team's names.

Each member owns a Lambda function from implementation through deployment, its IAM permissions and CloudWatch log group, and additional AWS resources. Each writes Terraform, runs cloud checks, reviews another member's work, and leads one deployment session.

The balance is based on implementation complexity and hands-on cloud work, rather than the number of tickets. The two existing tools are small: the API workflow is more involved, archive handling adds work to static analysis, and the simpler external-API worker leaves room for the frontend.

## 1. Ownership at a glance

| | Member A — Job API and metadata | Member B — Analysis and file storage | Member C — API checker and website |
|---|---|---|---|
| Lambda ownership | Job API, packaged as a ZIP | Static-analysis worker, container image | External-API worker, container image |
| Main AWS services | API Gateway, Lambda, DynamoDB | Lambda, ECR, private S3 | Lambda, ECR, website S3 |
| Storage responsibility | Jobs table, schema, TTL | Input/report bucket, versions, lifecycle, CORS | Public frontend bucket and assets |
| IAM and logs | Job API role, API Gateway invoke permission, API log group | Analysis role, ECR policy, analysis log group | API-check role, ECR policy, API-check log group |
| Application work | Job creation, submission, status, deadline handling | Analysis adapter, archive validation, upload/report helpers | API-check adapter and plain JavaScript UI |
| Deployment experience | Leads first complete infrastructure deployment | Leads analysis integration deployment | Leads final website and API-check deployment |
| Peer reviewer | Member C | Member A | Member B |

All three work with Terraform, AWS SDK calls, Lambda execution, permissions, and ordinary AWS logs. There is no dedicated infrastructure-only or frontend-only role.

## 2. Member A — Job API and metadata

**Outcome:** A browser or HTTP client can create a job, start the correct worker, and retrieve reliable status.

### AWS and Terraform work

- Create the API Gateway HTTP API, integration, four routes, stage, CORS configuration, and throttling settings from the architecture.
- Create the job API Lambda, its ZIP deployment, execution role, and seven-day log group.
- Create the DynamoDB jobs table with `jobId` as its key, on-demand capacity, and TTL on `expiresAt`.
- Grant the API function access to the table, the specific S3 operations it needs, and invocation of the two workers. Scope API Gateway's permission to invoke this function.
- Expose the API URL and jobs table name/ARN for the other workstreams.

### Application work

- Lead agreement on the shared job schema, request/response shapes, statuses, and error codes.
- Implement `POST /jobs`, including validation and record creation. Call Member B's upload helper when a file is needed.
- Implement `POST /jobs/{jobId}/start`: check readiness, pin the input version through Member B's helper, conditionally queue the job, and await asynchronous Lambda acceptance.
- Implement `GET /jobs/{jobId}`: return status, enforce logical expiry, and conditionally fail overdue unfinished jobs.
- Wire `GET /jobs/{jobId}/report` to Member B's report-link helper after validating job state and expiry.
- Implement duplicate-start behavior, uncertain-dispatch handling, and `ALLOW_NEW_JOBS`.

### Completion evidence

- Create and start both job types through the deployed HTTP API.
- Show the relevant DynamoDB item and the selected worker invocation.
- Submit the same job twice and demonstrate that it is dispatched only once.
- Demonstrate an overdue job becoming `FAILED` when its status is read.
- Demonstrate appropriate responses for invalid input, missing uploads, unknown jobs, and expired jobs.

**Dependencies:** Member B supplies the artifacts bucket and storage helper interface. Members B and C supply worker ARNs. Member C supplies the website origin. Use the agreed names and fixtures while these resources are being built.

## 3. Member B — Static analysis and file storage

**Outcome:** An uploaded ZIP, TAR, or text file is processed by the analysis container and produces a private, versioned text report.

### AWS and Terraform work

- Create the analysis ECR repository, image retrieval policy, and lifecycle policy for untagged images.
- Build and push the analysis image; provide its immutable digest for deployment.
- Create the analysis Lambda, execution role, seven-day log group, and asynchronous invocation settings.
- Create the private artifacts bucket with encryption, versioning, public-access blocking, and the input/report lifecycle rules.
- Configure artifacts-bucket CORS using Member C's website origin.
- Expose bucket name/ARN and analysis function name/ARN.

### Application work

- Extract the existing regex tool from its HTTP server and add a Lambda handler.
- Read the canonical job, claim it with a conditional DynamoDB update, and read the pinned S3 input version.
- Implement bounded archive handling, supported-format checks, and the size/entry limits defined in the architecture.
- Produce UTF-8 text, upload the report, and record its key/version and final status.
- Implement the three small S3 helper functions used by Member A's API: create an upload form, inspect the uploaded object/version, and sign a report download.
- Add fixtures for valid inputs, findings, invalid archives, and HTML-like text in reports.

Member B owns these storage helper files inside the job API service; Member A owns the routes that call them and the API execution role. Agree on their function signatures first, and review permission changes together.

### Completion evidence

- Upload and scan one ZIP, TAR, and plain-text file through the deployed flow.
- Show that direct unsigned access to inputs and reports fails.
- Re-upload to the same key and demonstrate that the worker reads the version recorded at submission.
- Deliver the worker event twice and demonstrate one successful claim.
- Demonstrate clear failures for malformed or excessive input and inspect the corresponding Lambda logs.

**Dependencies:** Member A supplies the table/schema and submission contract. Member C supplies the website origin. Before the HTTP API is ready, use a development fixture script to create a valid test job and invoke the worker.

## 4. Member C — External API checker and website

**Outcome:** The S3 page can submit either job type, survive a page close, and display/download reports; the API-check worker runs independently.

### AWS and Terraform work

- Create the API-check ECR repository, image retrieval policy, and lifecycle policy for untagged images.
- Build and push the API-check image; provide its immutable digest.
- Create the API-check Lambda, execution role, seven-day log group, and asynchronous invocation settings.
- Create the S3 website bucket, website configuration, public-read policy for frontend assets, and appropriate public-access settings.
- Publish HTML/CSS/JavaScript with correct content types and generate `config.json` from the deployed API URL.
- Expose the website origin and API-check function name/ARN.

### Application work

- Extract the small external-API tool from its HTTP server and add a Lambda handler.
- Use the same conditional job-claim/completion behavior as Member B's worker.
- Call the configured test API with bounded parameters, request count, and timeouts; write the report to the shared artifacts bucket.
- Implement the single-page UI: tool selection, input controls, direct upload, start, polling, readable failures, and report display/download.
- Save recent job IDs in `localStorage` and reopen jobs from `/#job=<jobId>`.
- Render reports as text and stop polling when jobs finish or expire.

Keep the UI functional and small: no framework migration, design system, login screen, or visual redesign is required. This keeps the combined website/worker work comparable to the other workstreams.

### Completion evidence

- Open the deployed S3 website and submit an API-check job.
- Demonstrate that it invokes only the API-check worker.
- Display and download a report from each tool.
- Close the page, reopen a saved job URL, and retrieve its result.
- Demonstrate external-API failure and expired-report messages, and show that HTML-like report text does not execute.

**Dependencies:** Member A supplies API response fixtures and the API URL. Member B supplies the upload form/report-link contract and artifacts bucket. Build the page against fixtures before integrating the deployed services.

## 5. Agreements needed before parallel implementation

Spend the first working session agreeing on these interfaces. This is a joint session; Member A records the decisions in a short contract file, reviewed by B and C.

| Agreement | Lead | Required decision |
|---|---|---|
| Job schema and lifecycle | A | Field names/types, conditional updates, timestamps, deadline, expiry |
| Worker event | A | Only `{ "jobId": "..." }`; workers load all other values from DynamoDB |
| API request/response fixtures | A | All four routes; success and error examples; signed upload/report response shape |
| S3 helper functions | B | Inputs, return values, validation errors, version handling |
| Files and reports | B | Exact key layout, limits, plain-text encoding, report truncation behavior |
| External API check | C | Actual test API URL, supported parameters, response/failure behavior |
| Website/API integration | C | Exact browser origin, config file format, CORS requirements |
| Deployment conventions | All | Region, project prefix, tags, supported versions, environment names, image architecture |

Use the architecture's existing values unless the team records a deliberate change. In particular, preserve independent job types, the five lifecycle states, signed private file access, and the ten-minute deadline rule.

Both workers must implement the same claim and completion conditions. Member A describes those conditions; B and C compare their implementations during review. Avoid three independently invented versions of the job lifecycle.

## 6. Terraform ownership and shared state

Keep the architecture's two deployment roots, `infra/registry` and `infra/app`. Within them, split files by workstream to reduce merge conflicts. This changes file organization, not the application architecture.

| Proposed files | Primary owner |
|---|---|
| `infra/registry/analysis.tf` | B: analysis ECR resources |
| `infra/registry/api_check.tf` | C: API-check ECR resources |
| `infra/app/job_api.tf`, `http_api.tf`, `jobs.tf` | A: API function, gateway, table, associated IAM/logs |
| `infra/app/analysis.tf`, `artifacts.tf` | B: analysis function, associated IAM/logs, private storage |
| `infra/app/api_check.tf`, `website.tf`, `frontend.tf` | C: API-check function, associated IAM/logs, site/assets |
| Provider/version/backend files and shared naming variables | Created together; changes reviewed by another member |
| `services/job-api/`, except its S3 helper files | A |
| `services/job-api/src/storage/`, `services/analysis/` | B |
| `services/api-check/`, `frontend/` | C |
| Contract fixtures and deployment notes | All, with one author per change |

Keep resource-specific variables and outputs beside their owning resources; define shared values such as region and project prefix once. A function owner also owns that function's IAM and log configuration, avoiding one central permissions file that everyone edits.

**Use shared remote Terraform state for this three-person plan.** The architecture allowed local state for an individual; three people applying independent local states to the same environment would lose a common resource inventory.

Bootstrap one separate private, versioned S3 state bucket, with distinct keys for registry and application state and native S3 locking through `use_lockfile = true`. Keep it separate from both application buckets. Follow the backend setup described in the architecture and [HashiCorp's S3 backend documentation](https://developer.hashicorp.com/terraform/language/backend/s3). This is a team tooling resource, not an additional runtime service.

Use one shared demo environment initially. All members get their own AWS access to the project; credentials are not shared or committed. Commit the provider lockfile, but exclude state, plan files, and local credentials.

For each deployment, designate one operator. The operator applies a reviewed plan from the current merged revision, with both worker image digests recorded. Other members review and observe, then take the operator role at the next checkpoint. State locking prevents concurrent state writes; the team must also avoid applying stale branch configurations.

Do not create three separate app stacks or routinely use targeted applies to work around integration. Everyone's resources are included in the same application plan. Each author can develop and validate their changes independently, while the shared environment advances through complete reviewed configurations.

## 7. Milestones and integration order

The milestones are completion gates, not fixed dates. Agree on calendar dates after the team has inspected the existing service code.

| Milestone | Member A | Member B | Member C | Exit condition |
|---|---|---|---|---|
| M0 — Shared setup | Record API/job contracts | Record file/helper contracts | Record UI/external-API contracts | Region, state, AWS access, interfaces, and ownership agreed |
| M1 — Independent implementation | API/DynamoDB Terraform and handler skeleton | Artifacts/ECR/analysis Terraform and first image | Website/ECR/API-check Terraform, first image, UI fixtures | All resource declarations merge and both images are available |
| M2 — First cloud deployment | Lead complete app apply; create test jobs | Invoke analysis with a prepared fixture | Invoke API checker with a prepared fixture | All three Lambdas run; table, buckets, API, and normal logs work |
| M3 — Analysis flow | Integrate start/status routes | Lead deployment; complete upload-to-report flow | Connect upload, polling, and report UI | Analysis works from the deployed page |
| M4 — Both flows and handover | Check deadline/duplicate-start behavior | Check versions, private access, and archive failures | Lead deployment; complete external check and UI recovery | Both flows meet the joint acceptance checks |

During M1, B and C can build their images independently of the deployed job API. A can use stub worker responses or contract fixtures during development. For M2, merge the complete infrastructure skeleton and publish both worker images before applying the app root; do not leave unresolved references to another person's future Terraform files.

Deploy the website bucket independently of uploading its configured assets: its endpoint supplies the CORS origin, and the generated API URL later supplies `config.json`. This keeps the resource dependency direction clear.

If a first image contains a temporary handler for infrastructure checks, label it as such and replace it before that tool's end-to-end milestone. A successful Lambda invocation alone is not completion of the workstream.

## 8. Shared verification and learning rotation

Each owner supplies a short runbook with build/deploy steps, relevant Terraform outputs, one successful cloud execution, one failure example, and cleanup instructions. A reviewer should be able to repeat those steps without the author operating their keyboard.

| Joint check | Lead | Reviewer |
|---|---|---|
| Both job types route to the correct worker | A | C |
| Duplicate start and uncertain submission handling | A | B |
| Deadline and metadata expiry behavior | A | C |
| ZIP/TAR/text support and invalid archive rejection | B | A |
| Duplicate worker claim behavior in both workers | B | C |
| Signed file access and pinned input version | B | C |
| External API request limits and failure reporting | C | A |
| Close/reopen, polling, and text download | C | B |
| Safe text rendering and browser CORS behavior | C | B |
| IAM, normal Lambda logs, and Terraform reproducibility | Each owner | Their assigned peer reviewer |

Use a shorter configurable deadline in a controlled test if waiting ten minutes slows verification, then restore the documented default. Use the normal runtime permissions for worker tests so a broad developer identity does not hide a missing execution-role permission.

For equal hands-on exposure, rotate three short cloud walkthroughs:

1. A explains API Gateway and DynamoDB; B operates the console/CLI while C checks the Terraform mapping.
2. B explains ECR, private S3, and the analysis worker; C operates while A reviews.
3. C explains website deployment and the API-check worker; A operates while B reviews.

Each member should finish Phase 1 able to deploy their own function, diagnose an IAM or runtime failure from its logs, explain their storage/API configuration, and repeat one other member's cloud check.

## 9. Workload adjustments and completion

Check the balance after M1. Compare remaining AWS setup, application work, and debugging effort—not just completed ticket counts.

| If this becomes the bottleneck | Adjustment |
|---|---|
| A's API workflow takes longer | B completes storage helper integration; C helps verify endpoint/error fixtures while A retains lifecycle ownership |
| B's archive handling takes longer | A pairs on worker state transitions; C supplies file fixtures and helps verify upload/report behavior |
| C's frontend takes longer | A helps wire job submission/status; B helps wire upload/report display; C retains website and API-check ownership |
| One member finishes early | They operate a peer's deployment or investigate an integration failure before taking cosmetic work |

Keep SQS, authentication, custom domains, CloudFront, dashboards, alerts, tracing, and background reconciliation outside this Phase 1 split. If account-level restrictions require a hosting change, record and redistribute that change explicitly instead of silently expanding one member's work.

Phase 1 is complete when the deployed S3 page can submit both independent tools, preserve access to jobs after closing the browser, and display/download their text reports; the joint failure checks pass; Terraform reproduces the environment; and all three members have led a deployment and reviewed a peer's cloud work.
