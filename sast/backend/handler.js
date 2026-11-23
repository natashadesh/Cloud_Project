import { scanCode } from './scanner.js';
import { createJobStore } from './jobStore.js';
import { createStorage } from './storage.js';
import { extractFiles } from './archive.js';
import { formatReport } from './report.js';
import { PUBLIC_ERROR_CODES, fail } from './errors.js';

// Stop collecting after this many findings; the report is capped at 1 MiB anyway.
const MAX_FINDINGS = 5000;

// Built as a factory so tests can pass in fake DynamoDB/S3 stores.
export const createHandler = ({
  jobs = createJobStore(),
  storage = createStorage(),
  scan = scanCode,
  now = () => new Date()
} = {}) => async (event, context = {}) => {
  const { jobId } = event || {};
  if (typeof jobId !== 'string' || jobId.length === 0) {
    console.error('Invalid event: missing jobId');
    return { status: 'IGNORED', reason: 'MISSING_JOB_ID' };
  }

  // The event only carries jobId; DynamoDB is the source of truth.
  const job = await jobs.getJob(jobId);
  if (!job) {
    console.warn(`Job ${jobId}: not found, ignoring`);
    return { jobId, status: 'IGNORED', reason: 'NOT_FOUND' };
  }

  const executionId = context.awsRequestId || `local-${Date.now()}`;
  const claimed = await jobs.claimJob(jobId, executionId);
  if (!claimed) {
    // Duplicate delivery, wrong type, or deadline passed: exit without scanning.
    console.warn(`Job ${jobId}: could not claim (status=${job.status}, type=${job.type}), skipping`);
    return { jobId, status: 'IGNORED', reason: 'NOT_CLAIMED' };
  }
  console.log(`Job ${jobId}: claimed by ${executionId}`);

  try {
    if (typeof job.inputKey !== 'string' || typeof job.inputVersionId !== 'string') {
      throw fail('INPUT_MISSING', 'The job has no pinned upload');
    }

    const bytes = await storage.readInput(job.inputKey, job.inputVersionId);
    const fileName = job.file?.name || 'source.txt';
    const { format, files, skipped } = extractFiles(bytes, { fileName });

    const findings = [];
    for (const file of files) {
      if (findings.length >= MAX_FINDINGS) break;
      for (const finding of scan(file.text, file.path)) {
        if (findings.length >= MAX_FINDINGS) break;
        findings.push(finding);
      }
    }

    const text = formatReport({
      jobId,
      fileName,
      format,
      scannedAt: now().toISOString(),
      fileCount: files.length,
      skipped,
      findings
    });
    const { reportKey, reportVersionId } = await storage.saveReport(jobId, text);

    const recorded = await jobs.markSucceeded(jobId, executionId, { reportKey, reportVersionId });
    if (!recorded) {
      // The deadline rule already failed this job; never overwrite a terminal state.
      console.warn(`Job ${jobId}: finished late, status left unchanged`);
      return { jobId, status: 'IGNORED', reason: 'LATE_FINISH' };
    }

    console.log(`Job ${jobId}: SUCCEEDED (${format}, ${files.length} files, ${findings.length} findings)`);
    return { jobId, status: 'SUCCEEDED', reportKey, files: files.length, findings: findings.length };
  } catch (error) {
    const known = PUBLIC_ERROR_CODES.has(error.code);
    const errorCode = known ? error.code : 'ANALYSIS_FAILED';
    const message = known ? error.message : 'The analysis failed unexpectedly';
    console.error(`Job ${jobId}: FAILED (${errorCode})`, known ? error.message : error);
    await jobs.markFailed(jobId, executionId, errorCode, message);
    return { jobId, status: 'FAILED', errorCode };
  }
};

// Lambda entry point
export const handler = createHandler();