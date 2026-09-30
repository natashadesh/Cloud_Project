# One complete example

Imagine I am the user.

I select:

- **Static analysis**

and upload:

- `my-code.zip`

## Step A — Create the job

The website says to Natalia's API:

> Create a static-analysis job for my-code.zip.

Your API generates something like:

```text
jobId = 9d5a-1234
```

and DynamoDB gets a record:

```yaml
jobId: 9d5a-1234
type: static-analysis
status: CREATED
```

The actual architecture says the Job API creates the DynamoDB record in `CREATED` state before the file is processed. ([Architecture](ARCHITECTURE.md))

`CREATED` means:

> We know about the job, but processing has not started.

## Step B — Upload the file

There is an important detail here.

The ZIP file does not travel:

```text
Browser
   ↓
API Gateway
   ↓
Natalia's Lambda
   ↓
S3
```

Instead it goes:

```text
Browser ───────────────► S3
```

Your API only gives the browser temporary permission to upload it.

That is called a **presigned S3 upload**. The architecture explicitly says the file does not pass through API Gateway or the Job API Lambda. ([Project description](project_description.md))

So your Lambda handles:

- "Here is the job."
- "Here is where its file belongs."

but it doesn't carry the 5 MB ZIP through itself.

This distinction will matter later.

## Step C — Start the job

After uploading, the browser tells your API:

> Start job 9d5a-1234

Now your code changes:

```text
CREATED
```

into:

```text
QUEUED
```

`QUEUED` means:

> The system accepted this job for processing and is sending it to the appropriate worker.

The architecture explicitly defines this transition before asynchronously invoking the analysis worker. ([Architecture](ARCHITECTURE.md))

## Step D — Natalia chooses the correct worker

The job has:

```yaml
type: static-analysis
```

so your API sends it to:

> Bhavan's Analysis Lambda

If instead it had:

```yaml
type: api-check
```

your API would send it to:

> Tanishq's API-check Lambda

This is one of your central responsibilities: deciding which worker should run. Your job-distribution document describes Natalia as coordinating the system and deciding which worker should run. ([Job distribution](job_destribution.md))

## Step E — What do you send the worker?

This part is surprisingly simple.

You do not send something huge like:

```json
{
  "jobId": "9d5a-1234",
  "filename": "my-code.zip",
  "bucket": "something",
  "status": "QUEUED",
  "user": "...",
  "etc": "..."
}
```

The team contract says workers receive only:

```json
{
  "jobId": "9d5a-1234"
}
```

Then the worker looks up that job in DynamoDB and finds the real information there. ([Job distribution](job_destribution.md))

This is an important design idea.

**DynamoDB becomes the official source of truth.**

Instead of Natalia telling Bhavan:

> "Trust all this information I'm sending you."

Natalia says:

> "Process job 9d5a-1234."

Bhavan asks DynamoDB:

> "What exactly is job 9d5a-1234?"

That keeps everyone working from the same record.

## Step F — Worker begins

Bhavan's worker receives:

```text
jobId = 9d5a-1234
```

It reads DynamoDB and sees:

```text
status = QUEUED
type = static-analysis
```

Then it tries to claim the job by changing:

```text
QUEUED → RUNNING
```

Now:

```yaml
status: RUNNING
```

means:

> A worker successfully claimed this job and is processing it.

The project uses a **conditional update** here: the worker is only allowed to claim it if the job is still `QUEUED`. ([Project description](project_description.md))

That detail looks small, but it's extremely important.

### Why not simply change it to RUNNING?

Imagine AWS accidentally delivers the same request twice.

**Worker #1:**

> I want job 123.

**Worker #2:**

> I also want job 123.

Without protection:

- Worker 1 analyzes it.
- Worker 2 analyzes it too.

Bad.

With the conditional rule:

**Worker 1:**

```text
QUEUED → RUNNING
SUCCESS
```

**Worker 2:**

```text
QUEUED → RUNNING
FAIL — it isn't QUEUED anymore
```

Worker #2 stops.

Your architecture calls the broader idea **idempotency**: duplicate events must not accidentally process the same job multiple times. ([Project description](project_description.md))

You don't need to memorize the word yet.

Just remember:

> **Only one worker gets to claim a job.**

## Step G — The worker performs the analysis

Now Bhavan's worker gets the uploaded file from private S3.

It runs the static-analysis logic.

Then it creates something like:

```text
report.txt
```

and puts that back into S3.

So now we have:

```text
DynamoDB
    job 9d5a-1234
    status = RUNNING

S3
    input: my-code.zip
    output: report.txt
```

- DynamoDB stores metadata.
- S3 stores the actual large objects/files.

The architecture is explicit that source code and report bodies belong in S3, not in DynamoDB. ([Project description](project_description.md))

## Step H — Job completes

Everything worked, so the worker changes:

```text
RUNNING → SUCCEEDED
```

Now DynamoDB might conceptually say:

```yaml
jobId: 9d5a-1234
type: static-analysis
status: SUCCEEDED
reportKey: reports/9d5a-1234/report.txt
```

`SUCCEEDED` means:

> The processing completed successfully and a result is available.

If the program crashed, the archive was malformed, the external API failed, etc., the final status could instead be:

```text
FAILED
```

The official lifecycle is:

```text
CREATED
   ↓
QUEUED
   ↓
RUNNING
   ↓
SUCCEEDED
or
FAILED
```

Source: [Project description](project_description.md).

## Step I — How does the browser know it's done?

This is where the word **polling** appears.

The browser does this every few seconds:

> What's the status of job 9d5a-1234?

Your API responds:

```text
RUNNING
```

A few seconds later:

> What's the status of job 9d5a-1234?

Response:

```text
SUCCEEDED
```

Then the browser asks:

> Can I get the report?

Your API returns temporary access to the report stored in S3.

The architecture's full flow is exactly create → upload → start → worker processing → polling → report retrieval. ([Architecture](ARCHITECTURE.md))

## Now the most important realization about your role

Look at that entire story again:

```text
USER
 ↓
create job
 ↓
NATALIA: store CREATED
 ↓
upload
 ↓
NATALIA: start job
 ↓
NATALIA: CREATED → QUEUED
 ↓
NATALIA: choose worker
 ↓
BHAVAN/TANISHQ: QUEUED → RUNNING
 ↓
worker performs job
 ↓
worker: RUNNING → SUCCEEDED/FAILED
 ↓
USER asks NATALIA for status
 ↓
NATALIA reads DynamoDB
 ↓
USER sees result
```

That is why your document says:

> **Natalia owns the job lifecycle.** ([Job distribution](job_destribution.md))

You don't personally perform the analysis.

You coordinate the life of the request.
