const { randomUUID } = require("node:crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const {
  LambdaClient,
  InvokeCommand,
} = require("@aws-sdk/client-lambda");

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});
const tableName = process.env.JOBS_TABLE_NAME;

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method;
    const path = event.rawPath || "";

    
    
    // POST /jobs - validate input and create a job
    if (method === "POST" && path === "/jobs") {

      // 1. Read and parse the request body
      let body;

      try {
        const rawBody = event.isBase64Encoded
          ? Buffer.from(event.body || "", "base64").toString("utf8")
          : event.body;

        body = JSON.parse(rawBody);
      } catch {
        return response(400, { error: "Invalid JSON request body" });
      }

      // 2. Check that the request is a JSON object
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return response(400, { error: "Expected a JSON object" });
      }

      // 3. Validate the job type
      const allowedTypes = ["static-analysis", "api-check"];

      if (!allowedTypes.includes(body.type)) {
        return response(400, {
          error: "Invalid job type",
          allowedTypes,
        });
      }

      // 4. Reject unexpected top-level fields
      const allowedFields = body.type === "api-check"
        ? ["type", "parameters"]
        : ["type", "file"];

      if (Object.keys(body).some(key => !allowedFields.includes(key))) {
        return response(400, { error: "Unexpected request field" });
      }

      let input;

      // 5. Validate API-check parameters
      if (body.type === "api-check") {
        const parameters = body.parameters;

        if (!parameters || typeof parameters !== "object" ||
            Array.isArray(parameters)) {
          return response(400, { error: "Invalid API-check parameters" });
        }

        if (Buffer.byteLength(JSON.stringify(parameters), "utf8") > 4096) {
          return response(400, { error: "Parameters exceed 4 KiB" });
        }

        const allowedParameterFields = ["path", "tests"];

        if (Object.keys(parameters).some(
          key => !allowedParameterFields.includes(key)
        )) {
          return response(400, { error: "Unknown API-check parameter" });
        }

        const { path: targetPath = "/", tests } = parameters;

        // Paths must be relative to the configured test API
        if (typeof targetPath !== "string" ||
            !targetPath.startsWith("/") ||
            targetPath.startsWith("//") ||
            targetPath.length > 200 ||
            /[\x00-\x1f\x7f\\]/.test(targetPath)) {
          return response(400, { error: "Invalid target path" });
        }

        // Match the test IDs supported by Tanishq's worker
        const validTests = new Set([
          "AUTH_MISSING",
          "SQL_INJECTION",
          "NOSQL_INJECTION",
          "RATE_LIMITING",
          "SECURITY_HEADERS",
          "SENSITIVE_DATA_EXPOSURE",
        ]);

        if (tests !== undefined &&
            (!Array.isArray(tests) ||
             tests.length === 0 ||
             tests.length > validTests.size ||
             !tests.every(id =>
               typeof id === "string" && validTests.has(id)
             ))) {
          return response(400, { error: "Invalid test selection" });
        }

        input = {
          parameters: {
            path: targetPath,
            ...(tests !== undefined
              ? { tests: [...new Set(tests)] }
              : {}),
          },
        };

      } else {

        // 6. Validate static-analysis file metadata
        const file = body.file;

        if (!file || typeof file !== "object" ||
            Array.isArray(file)) {
          return response(400, { error: "Missing or invalid file metadata" });
        }

        const allowedFileFields = [
          "name", "sizeBytes", "contentType"
        ];

        if (Object.keys(file).some(
          key => !allowedFileFields.includes(key)
        )) {
          return response(400, { error: "Unexpected file field" });
        }

        if (typeof file.name !== "string" ||
            file.name.trim().length === 0 ||
            file.name.length > 255 ||
            /[\/\\\x00-\x1f\x7f]/.test(file.name) ||
            !Number.isInteger(file.sizeBytes) ||
            file.sizeBytes < 1 ||
            file.sizeBytes > 5 * 1024 * 1024 ||
            typeof file.contentType !== "string" ||
            file.contentType.length === 0 ||
            file.contentType.length > 128) {
          return response(400, { error: "Invalid file metadata" });
        }

        input = {
          file: {
            name: file.name,
            sizeBytes: file.sizeBytes,
            contentType: file.contentType,
          },
        };
      }

      // 7. Generate a unique ID and creation timestamp
      const jobId = randomUUID();
      const now = new Date().toISOString();

      // 8. Create the DynamoDB job record
      const job = {
        jobId,
        type: body.type,
        status: "CREATED",
        createdAt: now,
        expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400,
        ...input,
      };

      // 9. Save the job in DynamoDB
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: job,
          ConditionExpression: "attribute_not_exists(jobId)",
        })
      );

      // 10. Return the new job information to the frontend
      return response(201, {
        jobId,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
        statusUrl: `/jobs/${jobId}`,
      });
    }


    // POST /jobs/{jobId}/start - start an existing job
    if (method === "POST" && /^\/jobs\/[^/]+\/start$/.test(path)) {

      // 1. Extract the job ID from the URL
      const jobId = event.pathParameters?.jobId || path.split("/")[2];

      // 2. Retrieve the job from DynamoDB
      const result = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { jobId },
          ConsistentRead: true,
        })
      );

      const job = result.Item;

      if (!job) {
        return response(404, { error: "Job not found" });
      }

      // 3. Check whether the job has expired
      const nowEpoch = Math.floor(Date.now() / 1000);

      if (job.expiresAt <= nowEpoch) {
        return response(410, { error: "Job has expired" });
      }

      // 4. Prevent duplicate starts
      if (job.status !== "CREATED") {
        return response(200, {
          jobId,
          status: job.status,
          message: "Job has already been started or completed",
        });
      }

      // Validate input based on the job type
      let upload = null;

      if (job.type === "static-analysis") {

        // Ask the S3 helper to verify the uploaded file
        upload = await verifyUploadedInput(job);

        if (
          !upload ||
          typeof upload.inputKey !== "string" ||
          typeof upload.inputVersionId !== "string" ||
          !Number.isInteger(upload.inputSizeBytes) ||
          upload.inputSizeBytes < 1
        ) {
          return response(409, {
            error: "Uploaded file is missing or not verified",
          });
        }

      } else if (job.type !== "api-check") {

        return response(400, {
          error: "Unsupported job type",
        });
      }

      // 5. Check that the worker Lambda is configured
      const workerFunctions = {
        "api-check": process.env.API_CHECK_FUNCTION_NAME,
        "static-analysis": process.env.ANALYSIS_FUNCTION_NAME,
      };

      const workerFunctionName = workerFunctions[job.type];

      if (!workerFunctionName) {
        return response(503, {
          error: "Worker is not configured",
        });
      }

      const now = new Date();
      const queuedAt = now.toISOString();
      const deadlineAt = Math.floor(now.getTime() / 1000) + 600;

      // Add S3 information only for static-analysis jobs
      const uploadUpdate = upload
        ? ", inputKey = :inputKey, inputVersionId = :inputVersionId, inputSizeBytes = :inputSizeBytes"
        : "";

      const uploadValues = upload
        ? {
            ":inputKey": upload.inputKey,
            ":inputVersionId": upload.inputVersionId,
            ":inputSizeBytes": upload.inputSizeBytes,
          }
        : {};

      // 6. Change CREATED -> QUEUED atomically
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { jobId },
            UpdateExpression:
              "SET #status = :queued, queuedAt = :queuedAt, deadlineAt = :deadlineAt" +
              uploadUpdate,
            ConditionExpression:
              "attribute_exists(jobId) AND #status = :created " +
              "AND #type = :type AND expiresAt > :nowEpoch",
            ExpressionAttributeNames: {
              "#status": "status",
              "#type": "type",
            },
            ExpressionAttributeValues: {
              ":created": "CREATED",
              ":queued": "QUEUED",
              ":type": job.type,
              ":queuedAt": queuedAt,
              ":deadlineAt": deadlineAt,
              ":nowEpoch": Math.floor(now.getTime() / 1000),
              ...uploadValues,
            },
          })
        );
      } catch (error) {
        // Another request may have already started this job
        if (error.name === "ConditionalCheckFailedException") {
          const latest = await client.send(
            new GetCommand({
              TableName: tableName,
              Key: { jobId },
              ConsistentRead: true,
            })
          );

          if (!latest.Item) {
            return response(404, { error: "Job not found" });
          }

          if (latest.Item.expiresAt <= Math.floor(Date.now() / 1000)) {
            return response(410, { error: "Job has expired" });
          }

          return response(200, {
            jobId,
            status: latest.Item.status,
            message: "Job state has already changed",
          });
        }

        throw error;
      }

      // 7. Invoke the API-check worker asynchronously
      try {
        const invocation = await lambdaClient.send(
          new InvokeCommand({
            FunctionName: workerFunctionName,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({ jobId })),
          })
        );

        if (invocation.StatusCode !== 202) {
          console.error("Unexpected worker invocation response", {
            jobId,
            statusCode: invocation.StatusCode,
          });

          return response(503, {
            error: "Worker dispatch could not be confirmed",
            jobId,
          });
        }

      } catch (error) {
        console.error("Worker invocation error", {
          jobId,
          error,
        });

        // Do not automatically requeue or invoke again.
        // The event may already have been accepted by AWS.
        return response(503, {
          error: "Worker dispatch could not be confirmed",
          jobId,
        });
      }

      // 8. Tell the frontend that the job was accepted
      return response(202, {
        jobId,
        status: "QUEUED",
        statusUrl: `/jobs/${jobId}`,
      });
    }

    // GET /jobs/{jobId} - retrieve a job
    if (method === "GET" && /^\/jobs\/[^/]+$/.test(path)) {
      const jobId = event.pathParameters?.jobId ||
        path.split("/")[2];

      const result = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { jobId },
        })
      );

      if (!result.Item) {
        return response(404, { error: "Job not found" });
      }

      return response(200, result.Item);
    }

    return response(404, { error: "Route not found" });
  } catch (error) {
    console.error("Job API error:", error);
    return response(500, { error: "Internal server error" });
  }
  
};

