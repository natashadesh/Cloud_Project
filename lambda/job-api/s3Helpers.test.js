const assert = require("node:assert/strict");
const { test } = require("node:test");
const { S3Client } = require("@aws-sdk/client-s3");
const { createS3Helpers } = require("./s3Helpers.js");

const bucket = "cloud-project-artifacts-test";

// Fake keys: signing happens locally, nothing is sent to AWS.
function makeClient() {
  return new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "AKIDTEST", secretAccessKey: "test-secret" },
  });
}

test("upload form is locked to the job's key and 1 byte to 5 MiB", async () => {
  const helpers = createS3Helpers({ client: makeClient(), bucket });
  const form = await helpers.createUploadForm("job-123");

  assert.ok(form.url.startsWith("https://"));
  assert.equal(form.fields.key, "inputs/job-123/source");
  assert.equal(form.expiresIn, 300);

  const policy = JSON.parse(Buffer.from(form.fields.Policy, "base64").toString("utf8"));
  const range = policy.conditions.find((c) => Array.isArray(c) && c[0] === "content-length-range");
  assert.deepEqual(range, ["content-length-range", 1, 5 * 1024 * 1024]);
});

test("upload check pins the exact uploaded version", async (t) => {
  const client = makeClient();
  t.mock.method(client, "send", async (command) => {
    assert.equal(command.input.Key, "inputs/job-123/source");
    return { ContentLength: 2048, VersionId: "v1" };
  });

  const helpers = createS3Helpers({ client, bucket });
  const result = await helpers.verifyUploadedInput({ jobId: "job-123", file: { sizeBytes: 2048 } });

  assert.deepEqual(result, { inputKey: "inputs/job-123/source", inputVersionId: "v1", inputSizeBytes: 2048 });
});

test("upload check returns null when nothing was uploaded", async (t) => {
  const client = makeClient();
  t.mock.method(client, "send", async () => {
    throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
  });

  const helpers = createS3Helpers({ client, bucket });
  assert.equal(await helpers.verifyUploadedInput({ jobId: "job-123" }), null);
});

test("upload check rejects a size that differs from the declared size", async (t) => {
  const client = makeClient();
  t.mock.method(client, "send", async () => ({ ContentLength: 999, VersionId: "v1" }));

  const helpers = createS3Helpers({ client, bucket });
  assert.equal(await helpers.verifyUploadedInput({ jobId: "job-123", file: { sizeBytes: 2048 } }), null);
});

test("report link is signed for 60 seconds and the exact version", async () => {
  const helpers = createS3Helpers({ client: makeClient(), bucket });
  const url = new URL(
    await helpers.signReportDownload({ reportKey: "reports/job-123/report.txt", reportVersionId: "rv1" })
  );

  assert.equal(url.protocol, "https:");
  assert.ok(url.pathname.endsWith("/reports/job-123/report.txt"));
  assert.equal(url.searchParams.get("X-Amz-Expires"), "60");
  assert.equal(url.searchParams.get("versionId"), "rv1");
});

test("everything returns null when the bucket is not configured", async () => {
  delete process.env.ARTIFACTS_BUCKET_NAME;
  const helpers = createS3Helpers({ client: makeClient() });

  assert.equal(await helpers.createUploadForm("job-123"), null);
  assert.equal(await helpers.verifyUploadedInput({ jobId: "job-123" }), null);
  assert.equal(await helpers.signReportDownload({ reportKey: "r", reportVersionId: "v" }), null);
});