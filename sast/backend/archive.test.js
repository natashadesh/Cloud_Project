import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { extractFiles } from './archive.js';
import { makeZip, makeTar, VULNERABLE_JS } from './testHelpers.js';

const failsWith = (code, fn) => assert.throws(fn, (error) => error.code === code);

test('plain text upload is one file named after the upload', () => {
  const result = extractFiles(Buffer.from(VULNERABLE_JS), { fileName: 'app.js' });
  assert.equal(result.format, 'text');
  assert.deepEqual(result.files.map((f) => f.path), ['app.js']);
});

test('ZIP: scans text files, skips folders, binary and empty files', () => {
  const zip = makeZip([
    { name: 'src/' },
    { name: 'src/app.js', data: VULNERABLE_JS },
    { name: 'src/notes.md', data: 'plain notes', method: 0 },
    { name: 'img/logo.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]) },
    { name: 'empty.txt', data: '' }
  ]);
  const result = extractFiles(zip);
  assert.equal(result.format, 'zip');
  assert.deepEqual(result.files.map((f) => f.path), ['src/app.js', 'src/notes.md']);
  assert.deepEqual(result.skipped, { binary: 1, empty: 1, folders: 1 });
});

test('TAR: reads files and folders', () => {
  const tar = makeTar([{ name: 'src/', type: '5' }, { name: 'src/app.js', data: VULNERABLE_JS }]);
  const result = extractFiles(tar);
  assert.equal(result.format, 'tar');
  assert.equal(result.files[0].text, VULNERABLE_JS);
});

test('rejects "../" and absolute paths', () => {
  failsWith('ARCHIVE_UNSAFE', () => extractFiles(makeZip([{ name: '../evil.js', data: 'x' }])));
  failsWith('ARCHIVE_UNSAFE', () => extractFiles(makeZip([{ name: '/etc/passwd', data: 'x' }])));
  failsWith('ARCHIVE_UNSAFE', () => extractFiles(makeTar([{ name: 'a/../../evil.js', data: 'x' }])));
});

test('rejects links', () => {
  failsWith('ARCHIVE_UNSAFE', () => extractFiles(makeZip([{ name: 'link', data: '/etc/passwd', symlink: true }])));
  failsWith('ARCHIVE_UNSAFE', () => extractFiles(makeTar([{ name: 'link', type: '2', linkname: '/etc/passwd' }])));
});

test('rejects archives inside archives (by name and by content)', () => {
  const inner = makeZip([{ name: 'a.js', data: 'x' }]);
  failsWith('ARCHIVE_UNSAFE', () => extractFiles(makeZip([{ name: 'inner.zip', data: inner }])));
  failsWith('ARCHIVE_UNSAFE', () => extractFiles(makeZip([{ name: 'data.bin', data: inner }])));
});

test('rejects more than 500 entries', () => {
  const entries = Array.from({ length: 501 }, (_, i) => ({ name: `f${i}.js`, data: 'x' }));
  failsWith('ARCHIVE_TOO_LARGE', () => extractFiles(makeZip(entries)));
});

test('rejects a zip bomb before unpacking it', () => {
  const bomb = makeZip([{ name: 'zeros.txt', data: Buffer.alloc(21 * 1024 * 1024, 0x61) }]);
  assert.ok(bomb.length < 100 * 1024, 'the bomb itself is small');
  failsWith('ARCHIVE_TOO_LARGE', () => extractFiles(bomb));
});

test('rejects an entry that unpacks to more than it claims', () => {
  const liar = makeZip([{ name: 'a.txt', data: 'a'.repeat(100000), declaredSize: 10 }]);
  failsWith('ARCHIVE_INVALID', () => extractFiles(liar));
});

test('rejects damaged files', () => {
  const zip = makeZip([{ name: 'a.js', data: VULNERABLE_JS }]);
  failsWith('ARCHIVE_INVALID', () => extractFiles(zip.subarray(0, zip.length - 10)));
  const tar = makeTar([{ name: 'a.js', data: VULNERABLE_JS }]);
  tar[0] = 0x5a; // breaks the header checksum
  failsWith('ARCHIVE_INVALID', () => extractFiles(tar));
});

test('rejects unsupported formats', () => {
  failsWith('UNSUPPORTED_FORMAT', () => extractFiles(zlib.gzipSync(Buffer.from(VULNERABLE_JS))));
  failsWith('UNSUPPORTED_FORMAT', () => extractFiles(Buffer.from([0x00, 0xff, 0x10, 0x00])));
});