// CodeGuard Cloud website.
// Creates a job, uploads the file (code scan only), starts the job, checks its
// status until it finishes and then shows the text report.
// Job and report text is always shown with textContent, never innerHTML.

'use strict';

const TESTS = [
  { id: 'AUTH_MISSING', name: 'Missing authentication', desc: 'Can protected routes be opened without logging in?' },
  { id: 'SQL_INJECTION', name: 'SQL injection', desc: 'Do SQL payloads cause database errors?' },
  { id: 'NOSQL_INJECTION', name: 'NoSQL injection', desc: 'Do MongoDB-style operators change results?' },
  { id: 'RATE_LIMITING', name: 'Rate limiting', desc: 'Are bursts of requests slowed down or blocked?' },
  { id: 'SECURITY_HEADERS', name: 'Security headers', desc: 'Are headers like CSP and HSTS set?' },
  { id: 'SENSITIVE_DATA_EXPOSURE', name: 'Sensitive data exposure', desc: 'Do responses leak passwords or stack traces?' },
];

const TYPE_NAMES = { 'api-check': 'API check', 'static-analysis': 'Code scan' };
const STATUS_NAMES = {
  CREATED: 'Created', QUEUED: 'Queued', RUNNING: 'Running',
  SUCCEEDED: 'Succeeded', FAILED: 'Failed', EXPIRED: 'Expired',
};
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const RECENT_KEY = 'codeGuard.recentJobs';
const RECENT_MAX = 10;
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Poll every 2 s for the first 30 s, then every 5 s. Back off up to 30 s after errors.
const FAST_POLL_MS = 2000;
const SLOW_POLL_MS = 5000;
const FAST_POLL_FOR_MS = 30000;
const MAX_BACKOFF_MS = 30000;

const $ = (id) => document.getElementById(id);

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const state = {
  apiUrl: null,
  jobId: null,
  pollRun: 0,        // increases each time a job is opened, so old poll loops stop
  reportText: null,
};

// ---------- API calls ----------

class NetworkError extends Error {}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(state.apiUrl + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new NetworkError('Could not reach the Job API. Check your connection.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  return { status: res.status, data };
}

const errorText = (data, fallback) =>
  (data && typeof data.error === 'string' && data.error) || fallback;

async function loadConfig() {
  const res = await fetch('config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('config.json is missing');
  const config = await res.json();
  if (typeof config.apiUrl !== 'string' || !/^https?:\/\//.test(config.apiUrl)) {
    throw new Error('config.json has no valid apiUrl');
  }
  state.apiUrl = config.apiUrl.replace(/\/+$/, '');
}

// ---------- Recent jobs (this browser only) ----------

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((j) => j && JOB_ID_PATTERN.test(j.jobId)) : [];
  } catch {
    return [];
  }
}

function writeRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* storage blocked */ }
  renderRecent();
}

function saveRecent(job) {
  const list = readRecent().filter((j) => j.jobId !== job.jobId);
  list.unshift({
    jobId: job.jobId,
    type: job.type,
    status: job.status || 'CREATED',
    createdAt: job.createdAt || new Date().toISOString(),
  });
  writeRecent(list);
}

// Remember the last status seen, so the list shows it without asking the API.
function updateRecentStatus(jobId, status) {
  const list = readRecent();
  const job = list.find((j) => j.jobId === jobId);
  if (!job || job.status === status) return;
  job.status = status;
  writeRecent(list);
}

function renderRecent() {
  const list = readRecent();
  const ul = $('recent-list');
  ul.replaceChildren();
  $('recent-empty').hidden = list.length > 0;
  $('clear-recent').hidden = list.length === 0;

  for (const job of list) {
    const button = el('button', job.jobId === state.jobId ? 'active' : '');
    button.type = 'button';

    const name = el('span', 'name', TYPE_NAMES[job.type] || job.type);
    name.append(el('code', '', job.jobId.slice(0, 8)));

    button.append(
      name,
      el('span', `pill ${job.status || ''}`, STATUS_NAMES[job.status] || 'Unknown'),
      el('span', 'when', formatTime(job.createdAt)),
    );
    button.addEventListener('click', () => { location.hash = `job=${job.jobId}`; });

    const li = el('li');
    li.append(button);
    ul.append(li);
  }
}

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ---------- Form helpers ----------

function showFormMessage(text) {
  const box = $('form-message');
  box.textContent = text || '';
  box.hidden = !text;
}

function setBusy(form, busy, label) {
  const button = form.querySelector('button[type="submit"]');
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}

function selectTab(which) {
  const isApi = which === 'api';
  $('tab-api').setAttribute('aria-selected', String(isApi));
  $('tab-code').setAttribute('aria-selected', String(!isApi));
  $('tab-api').tabIndex = isApi ? 0 : -1;
  $('tab-code').tabIndex = isApi ? -1 : 0;
  $('form-api').hidden = !isApi;
  $('form-code').hidden = isApi;
  showFormMessage('');
}

function renderTestChoices() {
  const box = $('test-list');
  for (const test of TESTS) {
    const input = el('input');
    input.type = 'checkbox';
    input.name = 'tests';
    input.value = test.id;
    input.checked = true;

    const text = el('span');
    text.append(el('strong', '', test.name), el('small', '', test.desc));

    const label = el('label', 'test');
    label.append(input, text);
    box.append(label);
  }
}

function setAllTests(checked) {
  for (const input of document.querySelectorAll('input[name="tests"]')) input.checked = checked;
}

// File picker with drag and drop.
function showChosenFile() {
  const file = $('code-file').files[0];
  $('dropzone').classList.toggle('has-file', Boolean(file));
  $('drop-title').textContent = file ? file.name : 'Drop a file here or click to choose';
  $('drop-detail').textContent = file
    ? `${formatSize(file.size)} · click to choose another file`
    : 'One source file, a .zip or a .tar, up to 5 MB';
}

function setUpDropzone() {
  const zone = $('dropzone');
  const input = $('code-file');
  input.addEventListener('change', showChosenFile);

  for (const name of ['dragenter', 'dragover']) {
    zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add('dragging'); });
  }
  for (const name of ['dragleave', 'drop']) {
    zone.addEventListener(name, () => zone.classList.remove('dragging'));
  }
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    showChosenFile();
  });
}

// ---------- Submitting jobs ----------

async function submitApiCheck(event) {
  event.preventDefault();
  const form = event.currentTarget;
  showFormMessage('');

  const path = $('api-path').value.trim() || '/';
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 200 || /[\x00-\x1f\x7f\\]/.test(path)) {
    showFormMessage('The path must start with a single "/" and be at most 200 characters.');
    return;
  }

  const tests = [...form.querySelectorAll('input[name="tests"]:checked')].map((i) => i.value);
  if (tests.length === 0) {
    showFormMessage('Choose at least one test.');
    return;
  }

  // Leaving out "tests" means the worker runs all of them.
  const parameters = tests.length === TESTS.length ? { path } : { path, tests };

  setBusy(form, true, 'Creating job…');
  try {
    const { status, data } = await api('POST', '/jobs', { type: 'api-check', parameters });
    if (status !== 201) {
      showFormMessage(errorText(data, `Could not create the job (HTTP ${status}).`));
      return;
    }
    openJob(data.jobId, data);
    saveRecent(data);
    await startJob(data.jobId);
  } catch (error) {
    showFormMessage(error.message);
  } finally {
    setBusy(form, false);
  }
}

async function submitCodeScan(event) {
  event.preventDefault();
  const form = event.currentTarget;
  showFormMessage('');

  const file = $('code-file').files[0];
  if (!file) {
    showFormMessage('Choose a file to scan.');
    return;
  }
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    showFormMessage('The file must be between 1 byte and 5 MB.');
    return;
  }
  if (file.name.length > 255) {
    showFormMessage('The file name is too long (255 characters at most).');
    return;
  }

  setBusy(form, true, 'Creating job…');
  try {
    const { status, data } = await api('POST', '/jobs', {
      type: 'static-analysis',
      file: { name: file.name, sizeBytes: file.size, contentType: file.type || 'application/octet-stream' },
    });
    if (status !== 201 || !data.upload) {
      showFormMessage(errorText(data, `Could not create the job (HTTP ${status}).`));
      return;
    }
    openJob(data.jobId, data);
    saveRecent(data);

    setBusy(form, true, 'Uploading…');
    setStatus('Uploading the file…');
    await uploadFile(data.upload, file);

    setBusy(form, true, 'Starting…');
    await startJob(data.jobId);
  } catch (error) {
    showFormMessage(error.message);
    setStatus('');
  } finally {
    setBusy(form, false);
  }
}

// The browser sends the file straight to S3 with the signed form from the Job API.
async function uploadFile(upload, file) {
  const body = new FormData();
  for (const [name, value] of Object.entries(upload.fields || {})) body.append(name, value);
  body.append('file', file); // S3 needs the file to be the last field

  let res;
  try {
    res = await fetch(upload.url, { method: 'POST', body });
  } catch {
    throw new Error('The upload could not reach storage. Try again.');
  }
  if (!res.ok) {
    throw new Error(`The upload was rejected (HTTP ${res.status}). The upload form lasts 5 minutes; try again.`);
  }
}

// Start a job. If the answer is lost, check the job's status before offering a retry,
// so the same job is never started twice by the page.
async function startJob(jobId) {
  $('retry-start').hidden = true;
  showJobError('');
  setStatus('Starting…');

  let result;
  try {
    result = await api('POST', `/jobs/${encodeURIComponent(jobId)}/start`);
  } catch (error) {
    result = { status: 0, data: { error: error.message } };
  }

  if (result.status === 202 || result.status === 200) {
    pollJob(jobId);
    return;
  }

  // Unclear or failed start: look at the real status first.
  try {
    const check = await api('GET', `/jobs/${encodeURIComponent(jobId)}`);
    if (check.status === 200 && check.data.status && check.data.status !== 'CREATED') {
      pollJob(jobId);
      return;
    }
  } catch { /* fall through to the retry button */ }

  setStatus('');
  showJobError(errorText(result.data, `The job could not be started (HTTP ${result.status}).`));
  $('retry-start').hidden = false;
}

// ---------- Job view ----------

function openJob(jobId, job) {
  state.jobId = jobId;
  state.pollRun += 1;
  state.reportText = null;

  if (location.hash !== `#job=${jobId}`) history.replaceState(null, '', `#job=${jobId}`);

  $('job-card').hidden = false;
  $('report-card').hidden = true;
  $('report').replaceChildren();
  $('report-summary').replaceChildren();
  $('job-id').textContent = jobId;
  $('job-type').textContent = TYPE_NAMES[job?.type] || 'Scan';
  $('retry-start').hidden = true;
  showJobError('');
  renderStages(job?.status || 'CREATED');
  setStatus(job?.status ? statusText(job) : 'Loading…');
  renderRecent();
  $('job-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setStatus(text, kind) {
  const status = $('job-status');
  status.textContent = text;
  status.className = `status ${kind || ''}`.trim();
}

function showJobError(text) {
  const box = $('job-error');
  box.textContent = text || '';
  box.hidden = !text;
}

function statusText(job) {
  switch (job.status) {
    case 'CREATED': return job.type === 'static-analysis' ? 'Waiting for the upload and start.' : 'Created, not started yet.';
    case 'QUEUED': return 'Queued: waiting for the worker to pick it up.';
    case 'RUNNING': return 'Running the scan…';
    case 'SUCCEEDED': return 'Finished. The report is below.';
    case 'FAILED': return 'The job failed.';
    default: return job.status;
  }
}

// Stage arrows: earlier stages are ticked, the current one spins, the last one
// turns green (Succeeded) or red (Failed).
function renderStages(status) {
  const order = ['CREATED', 'QUEUED', 'RUNNING', 'DONE'];
  const finished = status === 'SUCCEEDED' || status === 'FAILED';
  const current = finished ? 3 : Math.max(0, order.indexOf(status));

  for (const li of $('stages').children) {
    const index = order.indexOf(li.dataset.stage);
    li.className = '';
    li.removeAttribute('aria-current');

    if (index < current) li.classList.add('done');
    else if (index === current && !finished) { li.classList.add('current'); li.setAttribute('aria-current', 'step'); }
    else if (index === 3 && status === 'SUCCEEDED') li.classList.add('succeeded');
    else if (index === 3 && status === 'FAILED') li.classList.add('failed');

    if (li.dataset.stage === 'DONE') {
      li.querySelector('.label').textContent = finished ? STATUS_NAMES[status] : 'Finished';
    }
  }
}

function showJob(job) {
  $('job-type').textContent = TYPE_NAMES[job.type] || job.type;
  renderStages(job.status);
  updateRecentStatus(job.jobId || state.jobId, job.status);

  if (job.status === 'FAILED') {
    setStatus(statusText(job), 'failed');
    showJobError(`${job.errorMessage || 'Job processing failed.'} (${job.errorCode || 'JOB_FAILED'})`);
  } else {
    setStatus(statusText(job), job.status === 'SUCCEEDED' ? 'succeeded' : '');
    showJobError('');
  }
}

// Check the job's status until it finishes. Only the newest loop keeps running.
async function pollJob(jobId) {
  const run = ++state.pollRun;
  const startedAt = Date.now();
  let backoff = 0;

  while (run === state.pollRun) {
    let delay = Date.now() - startedAt < FAST_POLL_FOR_MS ? FAST_POLL_MS : SLOW_POLL_MS;

    try {
      const { status, data } = await api('GET', `/jobs/${encodeURIComponent(jobId)}`);
      if (run !== state.pollRun) return;

      if (status === 200) {
        backoff = 0;
        showJob(data);
        if (data.status === 'SUCCEEDED') {
          if (data.reportAvailable) await loadReport(jobId, run);
          return;
        }
        if (data.status === 'FAILED') return;
        if (data.status === 'CREATED') {
          // Not started (for example the page was closed before starting).
          $('retry-start').hidden = false;
          return;
        }
      } else if (status === 404 || status === 410) {
        setStatus('');
        showJobError(status === 410 ? 'This job has expired.' : 'Job not found. It may have expired.');
        updateRecentStatus(jobId, 'EXPIRED');
        return;
      } else if (status === 429 || status >= 500) {
        backoff = Math.min(MAX_BACKOFF_MS, backoff ? backoff * 2 : SLOW_POLL_MS);
        delay = backoff;
      } else {
        showJobError(errorText(data, `Unexpected answer from the Job API (HTTP ${status}).`));
        return;
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      backoff = Math.min(MAX_BACKOFF_MS, backoff ? backoff * 2 : SLOW_POLL_MS);
      delay = backoff;
      setStatus(`Connection problem, trying again in ${Math.round(delay / 1000)} s…`);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

// ---------- Report ----------

// Colour lines such as "[FAIL] ..." or "[HIGH] ..." and count them for the summary.
const LINE_KINDS = {
  PASS: 'ok', FAIL: 'bad', WARNING: 'warn', ERROR: 'warn',
  HIGH: 'bad', MEDIUM: 'warn', LOW: 'ok',
};

function renderReport(text) {
  const pre = $('report');
  const counts = {};
  const lines = text.split('\n');
  pre.replaceChildren();

  lines.forEach((line, i) => {
    const tag = line.match(/^\[([A-Z]+)\]/)?.[1];
    let className = '';
    if (tag && LINE_KINDS[tag]) {
      className = `line-${LINE_KINDS[tag]}`;
      counts[tag] = (counts[tag] || 0) + 1;
    } else if (i === 0 || /^(Summary|Findings):/.test(line)) {
      className = 'line-head';
    } else if (/^[-=]{10,}$/.test(line)) {
      className = 'line-rule';
    }
    pre.append(className ? el('span', className, line) : document.createTextNode(line));
    if (i < lines.length - 1) pre.append('\n');
  });

  const summary = $('report-summary');
  summary.replaceChildren();
  for (const tag of Object.keys(LINE_KINDS)) {
    if (!counts[tag]) continue;
    const chip = el('span', `chip ${LINE_KINDS[tag]}`);
    chip.append(el('b', '', String(counts[tag])), `${tag.charAt(0)}${tag.slice(1).toLowerCase()}`);
    summary.append(chip);
  }
}

async function loadReport(jobId, run) {
  $('report-card').hidden = false;
  $('report').textContent = 'Loading report…';
  $('download-report').disabled = true;
  $('copy-report').disabled = true;

  try {
    const { status, data } = await api('GET', `/jobs/${encodeURIComponent(jobId)}/report`);
    if (status !== 200 || typeof data.reportUrl !== 'string') {
      throw new Error(errorText(data, `The report link could not be created (HTTP ${status}).`));
    }

    // The signed link works for 60 seconds, so fetch it straight away and keep the text.
    let res;
    try {
      res = await fetch(data.reportUrl);
    } catch {
      throw new Error('The report could not be downloaded from storage.');
    }
    if (!res.ok) throw new Error(`The report could not be downloaded (HTTP ${res.status}).`);
    const text = await res.text();

    if (run !== state.pollRun) return;
    state.reportText = text;
    renderReport(text);
    $('download-report').disabled = false;
    $('copy-report').disabled = false;
  } catch (error) {
    if (run !== state.pollRun) return;
    $('report').textContent = error.message;
  }
}

function downloadReport() {
  if (!state.reportText || !state.jobId) return;
  const blob = new Blob([state.reportText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = `report-${state.jobId}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(button, text, label) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => { button.textContent = label; }, 2000);
}

// ---------- Opening a job from the address (#job=<id>) ----------

function jobIdFromHash() {
  const match = location.hash.match(/^#job=(.+)$/);
  return match && JOB_ID_PATTERN.test(match[1]) ? match[1] : null;
}

function openJobFromHash() {
  const jobId = jobIdFromHash();
  if (!jobId || jobId === state.jobId) return;
  const saved = readRecent().find((j) => j.jobId === jobId);
  openJob(jobId, saved ? { type: saved.type } : null);
  pollJob(jobId);
}

// ---------- Start-up ----------

async function init() {
  renderTestChoices();
  setUpDropzone();
  renderRecent();

  $('tab-api').addEventListener('click', () => selectTab('api'));
  $('tab-code').addEventListener('click', () => selectTab('code'));
  $('select-all').addEventListener('click', () => setAllTests(true));
  $('select-none').addEventListener('click', () => setAllTests(false));
  $('form-api').addEventListener('submit', submitApiCheck);
  $('form-code').addEventListener('submit', submitCodeScan);
  $('retry-start').addEventListener('click', () => state.jobId && startJob(state.jobId));
  $('download-report').addEventListener('click', downloadReport);
  $('copy-report').addEventListener('click', (e) => state.reportText && copyText(e.currentTarget, state.reportText, 'Copy'));
  $('copy-link').addEventListener('click', (e) => copyText(e.currentTarget, location.href, 'Copy link to this job'));
  $('clear-recent').addEventListener('click', () => writeRecent([]));
  window.addEventListener('hashchange', openJobFromHash);

  // Left/right arrow keys move between the two tabs.
  $('tab-api').parentElement.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const next = $('tab-api').getAttribute('aria-selected') === 'true' ? 'code' : 'api';
    selectTab(next);
    $(`tab-${next}`).focus();
  });

  try {
    await loadConfig();
  } catch (error) {
    showFormMessage(`The website is not connected to the Job API yet (${error.message}). It works once deployed with Terraform.`);
    for (const button of document.querySelectorAll('form button[type="submit"]')) button.disabled = true;
    return;
  }

  openJobFromHash();
}

init();
