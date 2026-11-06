import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
const installations = [
  ['--include=dev'],
  ['--prefix', 'sast/backend'],
  ['--prefix', 'pentest/backend'],
  ['--prefix', 'lambda/job-api', '--omit=dev'],
];

for (const args of installations) {
  // Invoke npm through Node so Windows does not need to launch npm.cmd.
  execFileSync(process.execPath, [
    process.env.npm_execpath, 'ci', ...args, '--no-fund', '--no-update-notifier',
  ], { cwd: rootDirectory, stdio: 'inherit' });
}
