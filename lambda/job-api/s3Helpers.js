// S3 helpers for the Job API (Bhavan): upload form, upload check, signed report link.
const {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { createPresignedPost } = require("@aws-sdk/s3-presigned-post");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MiB, same limit as the API's metadata check
const UPLOAD_FORM_SECONDS = 300;          // upload form works for 5 minutes
const REPORT_LINK_SECONDS = 60;           // report link works for 60 seconds

// The server picks the key, so the browser can never choose its own path.
const inputKeyFor = (jobId) => `inputs/${jobId}/source`;

function createS3Helpers({ client = new S3Client({}), bucket } = {}) {
  // Read the bucket name when called, so Lambda config or tests can set it later.
  const bucketName = () => bucket || process.env.ARTIFACTS_BUCKET_NAME;

  // 1. Signed upload form for a new static-analysis job (browser POSTs straight to S3).
  async function createUploadForm(jobId) {
    const Bucket = bucketName();
    if (!Bucket) return null; // storage not configured

    const { url, fields } = await createPresignedPost(client, {
      Bucket,
      Key: inputKeyFor(jobId),
      Conditions: [["content-length-range", 1, MAX_UPLOAD_BYTES]],
      Expires: UPLOAD_FORM_SECONDS,
    });

    return { url, fields, expiresIn: UPLOAD_FORM_SECONDS };
  }

  // 2. Check the upload exists, has the declared size, and pin its exact version.
  async function verifyUploadedInput(job) {
    const Bucket = bucketName();
    if (!Bucket || !job || typeof job.jobId !== "string") return null;

    const Key = inputKeyFor(job.jobId);
    let head;
    try {
      head = await client.send(new HeadObjectCommand({ Bucket, Key }));
    } catch (error) {
      const notFound = error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404;
      if (notFound) return null; // nothing uploaded yet
      throw error;
    }

    const size = head.ContentLength;
    if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) return null;
    if (Number.isInteger(job.file?.sizeBytes) && job.file.sizeBytes !== size) return null;
    if (typeof head.VersionId !== "string" || !head.VersionId || head.VersionId === "null") return null;

    return { inputKey: Key, inputVersionId: head.VersionId, inputSizeBytes: size };
  }

  // 3. 60-second signed link to the exact report version.
  async function signReportDownload(job) {
    const Bucket = bucketName();
    if (!Bucket || typeof job?.reportKey !== "string" || typeof job?.reportVersionId !== "string") {
      return null;
    }

    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket,
        Key: job.reportKey,
        VersionId: job.reportVersionId,
        ResponseContentType: "text/plain; charset=utf-8",
      }),
      { expiresIn: REPORT_LINK_SECONDS }
    );
  }

  return { createUploadForm, verifyUploadedInput, signReportDownload };
}

module.exports = { createS3Helpers, inputKeyFor, MAX_UPLOAD_BYTES };