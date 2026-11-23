import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatReport, MAX_REPORT_BYTES } from './report.js';

const base = {
  jobId: 'job-1',
  fileName: 'app.zip',
  format: 'zip',
  scannedAt: '2026-11-20T00:00:00.000Z',
  fileCount: 2,
  skipped: { binary: 1, empty: 0, folders: 1 }
};

const finding = (i) => ({
  severity: 'HIGH',
  name: 'Hardcoded Secret',
  description: 'Hardcoded password',
  file: `src/file${i}.js`,
  line: i,
  column: 7,
  evidence: `const password = '${'x'.repeat(80)}';`
});

test('report lists counts and findings', () => {
  const text = formatReport({ ...base, findings: [finding(1)] });
  assert.match(text, /Files scanned: 2 \| skipped binary: 1/);
  assert.match(text, /Findings: 1 \(HIGH 1 \| MEDIUM 0 \| LOW 0\)/);
  assert.match(text, /\[HIGH\] src\/file1\.js:1:7/);
});

test('report with no findings says so', () => {
  assert.match(formatReport({ ...base, findings: [] }), /No findings\./);
});

test('report is capped at 1 MiB with a truncation notice', () => {
  const findings = Array.from({ length: 20000 }, (_, i) => finding(i));
  const text = formatReport({ ...base, findings });
  assert.ok(Buffer.byteLength(text) <= MAX_REPORT_BYTES);
  assert.match(text, /report truncated: \d+ more findings not shown/);
});