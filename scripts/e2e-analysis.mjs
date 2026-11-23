// End-to-end check of the static-analysis flow through the real Job API.
// Usage: node scripts/e2e-analysis.mjs <file-to-scan>
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/e2e-analysis.mjs <file-to-scan>');
  process.exit(1);
}

// Terraform prints the API URL with a trailing slash; drop it so paths don't become "//jobs".
const apiUrl = execFileSync('terraform', ['-chdir=terraform/apps', 'output', '-raw', 'api_url'], { encoding: 'utf8' })
  .trim()
  .replace(/\/+$/, '');
const bytes = readFileSync(file);
// Never print signed links or upload forms: they contain temporary AWS tokens.
const hideSigned = (key, value) =>
  key === 'upload' ? '[signed upload form]' : key === 'reportUrl' ? '[signed report link]' : value;
const call = async (method, path, body) => {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
    console.log(`${method} ${path} -> ${res.status} ${JSON.stringify(data, hideSigned)}`);
  return { status: res.status, data };
};

// 1. Create the job; the API answers with a signed S3 upload form.
const created = await call('POST', '/jobs', {
  type: 'static-analysis',
  file: { name: basename(file), sizeBytes: bytes.length, contentType: 'application/octet-stream' }
});
if (created.status !== 201 || !created.data.upload) process.exit(1);
const { jobId, upload } = created.data;

// 2. Upload straight to S3 with the form (the file must be the last field).
const form = new FormData();
for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
form.append('file', new Blob([bytes]), basename(file));
const uploaded = await fetch(upload.url, { method: 'POST', body: form });
console.log(`S3 upload -> ${uploaded.status} (204 means stored)`);
if (uploaded.status !== 204) {
  console.error(await uploaded.text());
  process.exit(1);
}

// 3. Start the job, then poll until it finishes (deadline is 10 minutes).
const started = await call('POST', `/jobs/${jobId}/start`);
if (started.status >= 300) process.exit(1);

let job = {};
for (let i = 0; i < 30 && !['SUCCEEDED', 'FAILED'].includes(job.status); i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  job = (await call('GET', `/jobs/${jobId}`)).data;
}
if (job.status !== 'SUCCEEDED') {
  console.error(`Job ended as ${job.status}: ${job.errorCode || ''} ${job.errorMessage || ''}`);
  process.exit(1);
}

// 4. Get the 60-second signed report link and print the report.
const report = await call('GET', `/jobs/${jobId}/report`);
const text = await (await fetch(report.data.reportUrl)).text();
console.log(`\n${text}`);