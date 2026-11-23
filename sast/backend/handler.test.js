import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from './handler.js';
import { makeZip, VULNERABLE_JS } from './testHelpers.js';

const queuedJob = {
  jobId: 'job-1',
  type: 'static-analysis',
  status: 'QUEUED',
  inputKey: 'inputs/job-1/source',
  inputVersionId: 'v1',
  file: { name: 'project.zip', sizeBytes: 100, contentType: 'application/zip' }
};

// Fake DynamoDB and S3 stores that record what the handler did.
const fakes = ({ job = queuedJob, claim = true, finish = true, upload } = {}) => {
  const calls = { succeeded: null, failed: null, saved: null };
  const jobs = {
    getJob: async () => job,
    claimJob: async () => claim,
    markSucceeded: async (id, exec, fields) => { calls.succeeded = fields; return finish; },
    markFailed: async (id, exec, code, message) => { calls.failed = { code, message }; return true; }
  };
  const storage = {
    readInput: async () => upload ?? makeZip([{ name: 'src/app.js', data: VULNERABLE_JS }]),
    saveReport: async (id, text) => { calls.saved = text; return { reportKey: `reports/${id}/report.txt`, reportVersionId: 'rv1' }; }
  };
  return { jobs, storage, calls };
};

test('scans the upload, saves the report and marks SUCCEEDED', async () => {
  const { jobs, storage, calls } = fakes();
  const result = await createHandler({ jobs, storage })({ jobId: 'job-1' }, { awsRequestId: 'req-1' });
  assert.equal(result.status, 'SUCCEEDED');
  assert.match(calls.saved, /Hardcoded password/);
  assert.deepEqual(calls.succeeded, { reportKey: 'reports/job-1/report.txt', reportVersionId: 'rv1' });
});

test('a duplicate delivery is ignored without scanning', async () => {
  const { jobs, storage, calls } = fakes({ claim: false });
  const result = await createHandler({ jobs, storage })({ jobId: 'job-1' });
  assert.equal(result.reason, 'NOT_CLAIMED');
  assert.equal(calls.saved, null);
});

test('an unsafe archive ends as FAILED with ARCHIVE_UNSAFE', async () => {
  const { jobs, storage, calls } = fakes({ upload: makeZip([{ name: '../evil.js', data: 'x' }]) });
  const result = await createHandler({ jobs, storage })({ jobId: 'job-1' });
  assert.equal(result.errorCode, 'ARCHIVE_UNSAFE');
  assert.equal(calls.failed.code, 'ARCHIVE_UNSAFE');
});

test('a job without a pinned upload ends as INPUT_MISSING', async () => {
  const { jobs, storage } = fakes({ job: { ...queuedJob, inputVersionId: undefined } });
  const result = await createHandler({ jobs, storage })({ jobId: 'job-1' });
  assert.equal(result.errorCode, 'INPUT_MISSING');
});

test('unexpected errors are stored without internal details', async () => {
  const { jobs, storage, calls } = fakes();
  storage.readInput = async () => { throw new Error('secret internal detail'); };
  const result = await createHandler({ jobs, storage })({ jobId: 'job-1' });
  assert.equal(result.errorCode, 'ANALYSIS_FAILED');
  assert.equal(calls.failed.message, 'The analysis failed unexpectedly');
});

test('a late finish never overwrites the deadline failure', async () => {
  const { jobs, storage } = fakes({ finish: false });
  const result = await createHandler({ jobs, storage })({ jobId: 'job-1' });
  assert.equal(result.reason, 'LATE_FINISH');
});