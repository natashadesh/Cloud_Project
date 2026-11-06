const { randomUUID } = require("node:crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
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

    // POST /jobs - create a job
    if (method === "POST" && path === "/jobs") {
      const jobId = randomUUID();
      const now = new Date().toISOString();

      const job = {
        jobId,
        status: "CREATED",
        createdAt: now,
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      };

      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: job,
        })
      );

      return response(201, job);
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