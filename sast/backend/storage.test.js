import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStorage } from './storage.js';

const fakeClient = (reply) => ({ sent: [], async send(command) { this.sent.push(command.input); return reply(command); } });

test('reads the exact pinned version', async () => {
  const client = fakeClient(() => ({ ContentLength: 3, Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }));
  const storage = createStorage({ bucketName: 'bucket', client });
  const bytes = await storage.readInput('inputs/job-1/source', 'v1');
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.deepEqual(client.sent[0], { Bucket: 'bucket', Key: 'inputs/job-1/source', VersionId: 'v1' });
});

test('a missing upload becomes INPUT_MISSING', async () => {
  const client = fakeClient(() => { throw Object.assign(new Error('gone'), { name: 'NoSuchVersion' }); });
  const storage = createStorage({ bucketName: 'bucket', client });
  await assert.rejects(storage.readInput('k', 'v'), (error) => error.code === 'INPUT_MISSING');
});

test('an oversized upload becomes INPUT_TOO_LARGE', async () => {
  const client = fakeClient(() => ({ ContentLength: 6 * 1024 * 1024 }));
  const storage = createStorage({ bucketName: 'bucket', client });
  await assert.rejects(storage.readInput('k', 'v'), (error) => error.code === 'INPUT_TOO_LARGE');
});

test('saves the report and returns its version', async () => {
  const client = fakeClient(() => ({ VersionId: 'rv1' }));
  const storage = createStorage({ bucketName: 'bucket', client });
  const saved = await storage.saveReport('job-1', 'report');
  assert.deepEqual(saved, { reportKey: 'reports/job-1/report.txt', reportVersionId: 'rv1' });
  assert.equal(client.sent[0].ContentType, 'text/plain; charset=utf-8');
});