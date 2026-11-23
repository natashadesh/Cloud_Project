// Error codes the analysis worker may store on a FAILED job.
// Anything else is stored as ANALYSIS_FAILED with a generic message, so stack
// traces and AWS error details never reach the job record or the browser.
export const PUBLIC_ERROR_CODES = new Set([
  'INPUT_MISSING',
  'INPUT_TOO_LARGE',
  'UNSUPPORTED_FORMAT',
  'ARCHIVE_INVALID',
  'ARCHIVE_UNSAFE',
  'ARCHIVE_TOO_LARGE'
]);

export const fail = (code, message) => Object.assign(new Error(message), { code });