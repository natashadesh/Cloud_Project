import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const keys = ['aws_access_key_id', 'aws_secret_access_key', 'aws_session_token'];

async function readInput() {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    return input;
  }
  if (process.platform !== 'darwin') {
    throw new Error('Clipboard import requires macOS. Pipe the credentials block to this command instead.');
  }
  try {
    return execFileSync('pbpaste', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error('Could not read the clipboard. Copy the AWS CLI credentials block and retry.');
  }
}

function parseCredentials(input) {
  const credentials = {};
  for (const rawLine of input.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';') || line === '[default]') continue;
    const match = /^(aws_access_key_id|aws_secret_access_key|aws_session_token)\s*=\s*(\S+)$/.exec(line);
    if (!match || Object.hasOwn(credentials, match[1])) {
      throw new Error('Copy only the complete AWS CLI credentials block with its three unique fields.');
    }
    credentials[match[1]] = match[2];
  }
  if (keys.some((key) => !credentials[key])) {
    throw new Error('The credentials block must include the access key, secret key, and session token.');
  }
  return credentials;
}

function updateDefaultProfile(contents, credentials) {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const headers = [...contents.matchAll(/^[ \t]*\[([^\]\r\n]+)\][ \t]*(?:[#;].*)?\r?$/gm)];
  const defaults = headers.filter((header) => header[1].trim() === 'default');
  if (defaults.length > 1) throw new Error('The credentials file contains multiple [default] sections.');

  if (!defaults.length) {
    const separator = contents ? (contents.endsWith('\n') ? newline : newline + newline) : '';
    return contents + separator + '[default]' + newline
      + keys.map((key) => `${key} = ${credentials[key]}`).join(newline) + newline;
  }
  const header = defaults[0];
  const start = header.index + header[0].length;
  const end = headers[headers.indexOf(header) + 1]?.index ?? contents.length;
  const missing = new Set(keys);
  let section = contents.slice(start, end).replace(
    /^[ \t]*(aws_access_key_id|aws_secret_access_key|aws_session_token)[ \t]*=[^\r\n]*/gm,
    (_, key) => {
      missing.delete(key);
      return `${key} = ${credentials[key]}`;
    },
  );
  if (missing.size) {
    if (!section.endsWith('\n')) section += newline;
    section += [...missing].map((key) => `${key} = ${credentials[key]}`).join(newline) + newline;
  }
  return contents.slice(0, start) + section + contents.slice(end);
}

function verifyCredentials(credentials) {
  const env = { ...process.env };
  delete env.AWS_PROFILE;
  delete env.AWS_DEFAULT_PROFILE;
  for (const key of keys) env[key.toUpperCase()] = credentials[key];
  env.AWS_DEFAULT_REGION = env.AWS_DEFAULT_REGION || env.AWS_REGION || 'us-east-1';
  env.AWS_CLI_AUTO_PROMPT = 'off';
  try {
    const output = execFileSync('aws', [
      'sts', 'get-caller-identity', '--output', 'json', '--no-cli-pager',
      '--cli-connect-timeout', '5', '--cli-read-timeout', '10',
    ], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 });
    const { Account } = JSON.parse(output);
    if (!/^\d{12}$/.test(Account)) throw new Error('Invalid identity response');
    return Account;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('AWS CLI is required. Install AWS CLI v2 and retry.');
    throw new Error('AWS verification failed. Check the lab is running, credentials are current, and network access is available.');
  }
}

async function main() {
  const credentials = parseCredentials(await readInput());
  const file = resolve(process.env.AWS_SHARED_CREDENTIALS_FILE || join(homedir(), '.aws', 'credentials'));
  let contents = '';
  try {
    contents = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const updated = updateDefaultProfile(contents, credentials);
  const account = verifyCredentials(credentials);

  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporaryFile = join(dirname(file), `.credentials-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, updated, { flag: 'wx', mode: 0o600 });
    await rename(temporaryFile, file);
  } finally {
    await rm(temporaryFile, { force: true });
  }
  console.log(`Updated [default] credentials for AWS account ${account}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
