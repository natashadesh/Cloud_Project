
const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  DynamoDBDocumentClient,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");

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
