
const assert = require("node:assert/strict");
const { test } = require("node:test");

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

// Use a test table name. No real table is required.
process.env.JOBS_TABLE_NAME = "cloud-project-jobs-test";

const { handler } = require("./index.js");

// Simulate an HTTP request received through API Gateway.
function makeEvent(body) {
  return {
    requestContext: {
      http: { method: "POST" },
    },
    rawPath: "/jobs",
    body: JSON.stringify(body),
  };
}

// Sends a POST request to start processing
function makeStartEvent(jobId) {
  return {
    requestContext: {
      http: { method: "POST" },
    },
    rawPath: `/jobs/${jobId}/start`,
    pathParameters: { jobId },
  };
}

// Send a GETS request to check processing status
function makeStatusEvent(jobId) {
  return {
    requestContext: {
      http: { method: "GET" },
    },
    rawPath: `/jobs/${jobId}`,
    pathParameters: { jobId },
  };
}

// Create a simulated HTTP request for the report endpoint
function makeReportEvent(jobId) {
  return {
    requestContext: {
      http: { method: "GET" },
    },
    rawPath: `/jobs/${jobId}/report`,
    pathParameters: { jobId },
  };
}

// TEST 1: Valid job
test("creates a valid API-check job", async (t) => {
  let savedJob;

  // Intercept the DynamoDB request instead of contacting AWS.
  const send = t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {
      assert.ok(command instanceof PutCommand);
      savedJob = command.input.Item;
      return {};
    }
  );

  const result = await handler(makeEvent({
    type: "api-check",
    parameters: {
      path: "/api/users",
      tests: ["AUTH_MISSING"],
    },
  }));

  assert.equal(result.statusCode, 201);
  assert.equal(savedJob.type, "api-check");
  assert.equal(savedJob.status, "CREATED");
  assert.equal(savedJob.parameters.path, "/api/users");
  assert.equal(send.mock.callCount(), 1);

  console.log("Valid job created successfully");
});

// TEST 2: Invalid job type
test("rejects an unsupported job type", async (t) => {
  const send = t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async () => {
      throw new Error("DynamoDB should not be called");
    }
  );

  const result = await handler(makeEvent({
    type: "unknown-tool",
  }));

  assert.equal(result.statusCode, 400);
  assert.equal(send.mock.callCount(), 0);

  console.log("Invalid job type rejected");
});

// TEST 3: Invalid file metadata
test("rejects an oversized file", async (t) => {
  const send = t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async () => {
      throw new Error("DynamoDB should not be called");
    }
  );

  const result = await handler(makeEvent({
    type: "static-analysis",
    file: {
      name: "sample.zip",
      sizeBytes: 10 * 1024 * 1024,
      contentType: "application/zip",
    },
  }));

  assert.equal(result.statusCode, 400);
  assert.equal(send.mock.callCount(), 0);

  console.log("Oversized file rejected");
});


// TEST 4: Start a valid API-check job
test("starts a job and invokes the correct worker", async (t) => {
  const jobId = "job-123";

  process.env.API_CHECK_FUNCTION_NAME = "cloud-project-api-check";

  const dbSend = t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {
      if (command instanceof GetCommand) {
        return {
          Item: {
            jobId,
            type: "api-check",
            status: "CREATED",
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          },
        };
      }

      if (command instanceof UpdateCommand) {
        assert.equal(
          command.input.ExpressionAttributeValues[":queued"],
          "QUEUED"
        );
        return {};
      }

      throw new Error("Unexpected DynamoDB command");
    }
  );

  const lambdaSend = t.mock.method(
    LambdaClient.prototype,
    "send",
    async (command) => {
      assert.ok(command instanceof InvokeCommand);
      assert.equal(
        command.input.FunctionName,
        "cloud-project-api-check"
      );
      assert.equal(command.input.InvocationType, "Event");

      const payload = JSON.parse(
        Buffer.from(command.input.Payload).toString("utf8")
      );

      assert.deepEqual(payload, { jobId });

      return { StatusCode: 202 };
    }
  );

  const result = await handler(makeStartEvent(jobId));

  assert.equal(result.statusCode, 202);
  assert.equal(dbSend.mock.callCount(), 2);
  assert.equal(lambdaSend.mock.callCount(), 1);

  console.log("Job queued and worker invoked successfully");
});

// TEST 5: Starting an existing job must not invoke again
test("does not invoke worker for an already-started job", async (t) => {
  const jobId = "job-456";

  const dbSend = t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {
      assert.ok(command instanceof GetCommand);

      return {
        Item: {
          jobId,
          type: "api-check",
          status: "QUEUED",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      };
    }
  );

  const lambdaSend = t.mock.method(
    LambdaClient.prototype,
    "send",
    async () => {
      throw new Error("Worker must not be invoked twice");
    }
  );

  const result = await handler(makeStartEvent(jobId));

  assert.equal(result.statusCode, 200);
  assert.equal(dbSend.mock.callCount(), 1);
  assert.equal(lambdaSend.mock.callCount(), 0);

  console.log("Duplicate start prevented successfully");
});


test("simultaneous starts dispatch the worker only once", async (t) => {
  const jobId = "job-concurrent";
  let currentStatus = "CREATED";
  let invocationCount = 0;

  process.env.API_CHECK_FUNCTION_NAME = "cloud-project-api-check";

  // Simulate DynamoDB with a shared job status
  t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {
      if (command instanceof GetCommand) {
        return {
          Item: {
            jobId,
            type: "api-check",
            status: currentStatus,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          },
        };
      }

      if (command instanceof UpdateCommand) {
        // Simulate DynamoDB's atomic condition
        if (currentStatus !== "CREATED") {
          const error = new Error("Condition failed");
          error.name = "ConditionalCheckFailedException";
          throw error;
        }

        currentStatus = "QUEUED";
        return {};
      }

      throw new Error("Unexpected DynamoDB command");
    }
  );

  // Count how many times the worker is invoked
  t.mock.method(
    LambdaClient.prototype,
    "send",
    async (command) => {
      assert.ok(command instanceof InvokeCommand);
      invocationCount++;
      return { StatusCode: 202 };
    }
  );

  // Send two start requests concurrently
  const [first, second] = await Promise.all([
    handler(makeStartEvent(jobId)),
    handler(makeStartEvent(jobId)),
  ]);

  const statusCodes = [first.statusCode, second.statusCode].sort();

  assert.deepEqual(statusCodes, [200, 202]);
  assert.equal(currentStatus, "QUEUED");
  assert.equal(invocationCount, 1);

  console.log("Concurrent starts dispatched only one worker");
});


test("returns 410 for an expired job", async (t) => {
  const jobId = "job-expired";

  const dbSend = t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {
      assert.ok(command instanceof GetCommand);

      return {
        Item: {
          jobId,
          type: "api-check",
          status: "SUCCEEDED",
          expiresAt: Math.floor(Date.now() / 1000) - 60,
        },
      };
    }
  );

  const result = await handler(makeStatusEvent(jobId));

  assert.equal(result.statusCode, 410);
  assert.equal(dbSend.mock.callCount(), 1);

  console.log("Expired job correctly rejected");
});



test("marks a job as FAILED when its deadline passes", async (t) => {
  const jobId = "job-timeout";

  const now = Math.floor(Date.now() / 1000);

  const originalJob = {
    jobId,
    type: "api-check",
    status: "RUNNING",
    createdAt: new Date(Date.now() - 15 * 60000).toISOString(),
    deadlineAt: now - 60,
    expiresAt: now + 3600,
  };

  const dbSend = t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {

      if (command instanceof GetCommand) {
        return { Item: originalJob };
      }

      if (command instanceof UpdateCommand) {
        // Verify that the API requests a conditional failure update
        assert.equal(
          command.input.ExpressionAttributeValues[":failed"],
          "FAILED"
        );

        assert.equal(
          command.input.ExpressionAttributeValues[":errorCode"],
          "JOB_DEADLINE_EXCEEDED"
        );

        return {
          Attributes: {
            ...originalJob,
            status: "FAILED",
            finishedAt: new Date().toISOString(),
            errorCode: "JOB_DEADLINE_EXCEEDED",
          },
        };
      }

      throw new Error("Unexpected DynamoDB command");
    }
  );

  const result = await handler(makeStatusEvent(jobId));

  assert.equal(result.statusCode, 200);

  const body = JSON.parse(result.body);

  assert.equal(body.status, "FAILED");
  assert.equal(body.errorCode, "JOB_DEADLINE_EXCEEDED");
  assert.equal(dbSend.mock.callCount(), 2);

  console.log("Overdue job correctly marked FAILED");
});


test("preserves SUCCEEDED when worker finishes during timeout handling", async (t) => {
  const jobId = "job-finished-during-timeout";
  const now = Math.floor(Date.now() / 1000);

  let readCount = 0;

  const dbSend = t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {

      if (command instanceof GetCommand) {
        readCount++;

        // First read: the job appears overdue
        if (readCount === 1) {
          return {
            Item: {
              jobId,
              type: "api-check",
              status: "RUNNING",
              deadlineAt: now - 60,
              expiresAt: now + 3600,
            },
          };
        }

        // Second read: the worker has completed the job
        return {
          Item: {
            jobId,
            type: "api-check",
            status: "SUCCEEDED",
            finishedAt: new Date().toISOString(),
            reportKey: `reports/${jobId}/report.txt`,
            expiresAt: now + 3600,
          },
        };
      }

      if (command instanceof UpdateCommand) {
        // Simulate DynamoDB rejecting the update because
        // the worker already changed the status
        const error = new Error("Condition failed");
        error.name = "ConditionalCheckFailedException";
        throw error;
      }

      throw new Error("Unexpected DynamoDB command");
    }
  );

  const result = await handler(makeStatusEvent(jobId));
  const body = JSON.parse(result.body);

  assert.equal(result.statusCode, 200);
  assert.equal(body.status, "SUCCEEDED");
  assert.equal(body.reportAvailable, true);
  assert.equal(readCount, 2);
  assert.equal(dbSend.mock.callCount(), 3);

  console.log("Worker completion preserved successfully");
});


test("returns 404 when report job does not exist", async (t) => {
  t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {
      assert.ok(command instanceof GetCommand);
      return { Item: undefined };
    }
  );

  const result = await handler(makeReportEvent("missing-job"));

  assert.equal(result.statusCode, 404);
});


test("returns 410 when report job has expired", async (t) => {
  t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {
      assert.ok(command instanceof GetCommand);

      return {
        Item: {
          jobId: "expired-job",
          status: "SUCCEEDED",
          reportKey: "reports/expired-job/report.txt",
          reportVersionId: "version-1",
          expiresAt: Math.floor(Date.now() / 1000) - 60,
        },
      };
    }
  );

  const result = await handler(makeReportEvent("expired-job"));

  assert.equal(result.statusCode, 410);
});


test("returns 409 when report is not ready", async (t) => {
  t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {
      assert.ok(command instanceof GetCommand);

      return {
        Item: {
          jobId: "running-job",
          status: "RUNNING",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      };
    }
  );

  const result = await handler(makeReportEvent("running-job"));

  assert.equal(result.statusCode, 409);
});


test("returns 503 when report signing is not configured", async (t) => {
  t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {
      assert.ok(command instanceof GetCommand);

      return {
        Item: {
          jobId: "completed-job",
          status: "SUCCEEDED",
          reportKey: "reports/completed-job/report.txt",
          reportVersionId: "version-1",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      };
    }
  );

  const result = await handler(makeReportEvent("completed-job"));

  assert.equal(result.statusCode, 503);
  assert.equal(JSON.parse(result.body).reportUrl, undefined);
});


test("blocks new work when ALLOW_NEW_JOBS is false", async (t) => {
  const previous = process.env.ALLOW_NEW_JOBS;
  process.env.ALLOW_NEW_JOBS = "false";

  t.after(() => {
    if (previous === undefined) {
      delete process.env.ALLOW_NEW_JOBS;
    } else {
      process.env.ALLOW_NEW_JOBS = previous;
    }
  });

  const dbSend = t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async () => {
      throw new Error("DynamoDB should not be called");
    }
  );

  const createResult = await handler({
    requestContext: { http: { method: "POST" } },
    rawPath: "/jobs",
    body: JSON.stringify({
      type: "api-check",
      parameters: { path: "/" },
    }),
  });

  const startResult = await handler(makeStartEvent("job-123"));

  assert.equal(createResult.statusCode, 503);
  assert.equal(startResult.statusCode, 503);
  assert.equal(dbSend.mock.callCount(), 0);
});


test("allows status reads when new jobs are disabled", async (t) => {
  const previous = process.env.ALLOW_NEW_JOBS;
  process.env.ALLOW_NEW_JOBS = "false";

  t.after(() => {
    if (previous === undefined) {
      delete process.env.ALLOW_NEW_JOBS;
    } else {
      process.env.ALLOW_NEW_JOBS = previous;
    }
  });

  t.mock.method(
    DynamoDBDocumentClient.prototype,
    "send",
    async (command) => {
      assert.ok(command instanceof GetCommand);

      return {
        Item: {
          jobId: "existing-job",
          type: "api-check",
          status: "SUCCEEDED",
          createdAt: new Date().toISOString(),
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      };
    }
  );

  const result = await handler(makeStatusEvent("existing-job"));

  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).status, "SUCCEEDED");
});


