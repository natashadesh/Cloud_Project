// Builds the plain-text analysis report (max 1 MiB).
// The website shows it with textContent, so code echoed in the evidence lines stays inert.
export const MAX_REPORT_BYTES = 1024 * 1024;

const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'];

export const formatReport = ({ jobId, fileName, format, scannedAt, fileCount, skipped, findings }) => {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] || 0) + 1;

  const head = [
    'STATIC ANALYSIS REPORT',
    '======================',
    `Job ID:      ${jobId}`,
    `Upload:      ${fileName} (${format.toUpperCase()})`,
    `Scanned at:  ${scannedAt}`,
    '',
    `Files scanned: ${fileCount} | skipped binary: ${skipped.binary} | empty: ${skipped.empty} | folders: ${skipped.folders}`,
    `Findings: ${findings.length} (${SEVERITIES.map((s) => `${s} ${counts[s]}`).join(' | ')})`,
    '-'.repeat(60)
  ].join('\n');

  if (findings.length === 0) return `${head}\nNo findings.\n`;

  // Add findings until the next one would pass the limit, then say what was left out.
  const reserve = 200;
  let text = head;
  let bytes = Buffer.byteLength(text);
  let shown = 0;
  for (const f of findings) {
    const entry = `\n[${f.severity}] ${f.file}:${f.line}:${f.column}  ${f.name}: ${f.description}\n    ${f.evidence}`;
    const entryBytes = Buffer.byteLength(entry);
    if (bytes + entryBytes > MAX_REPORT_BYTES - reserve) break;
    text += entry;
    bytes += entryBytes;
    shown += 1;
  }
  if (shown < findings.length) {
    text += `\n\n... report truncated: ${findings.length - shown} more findings not shown (1 MiB limit)`;
  }
  return `${text}\n`;
};