// S3 access for the analysis worker: read the pinned upload, save the report.
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { fail } from './errors.js';

export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const reportKeyFor = (jobId) => `reports/${jobId}/report.txt`;

export const createStorage = ({
  bucketName = process.env.ARTIFACTS_BUCKET_NAME,
  client = new S3Client({})
} = {}) => {
  // Read exactly the version the Job API pinned at start, so a re-upload can't change what we scan.
  const readInput = async (key, versionId) => {
    let result;
    try {
      result = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key, VersionId: versionId }));
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.name === 'NoSuchVersion' || error.$metadata?.httpStatusCode === 404) {
        throw fail('INPUT_MISSING', 'The uploaded file is no longer available');
      }
      throw error;
    }
    if (result.ContentLength > MAX_INPUT_BYTES) throw fail('INPUT_TOO_LARGE', 'The upload is larger than 5 MiB');

    const bytes = Buffer.from(await result.Body.transformToByteArray());
    if (bytes.length > MAX_INPUT_BYTES) throw fail('INPUT_TOO_LARGE', 'The upload is larger than 5 MiB');
    return bytes;
  };

  // Returns the key and S3 version ID so the job record pins the exact report.
  const saveReport = async (jobId, text) => {
    const key = reportKeyFor(jobId);
    const result = await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: text,
      ContentType: 'text/plain; charset=utf-8'
    }));
    return { reportKey: key, reportVersionId: result.VersionId };
  };

  return { readInput, saveReport };
};