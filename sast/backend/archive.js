// Reads one upload safely: a text file, a ZIP or a TAR.
// The format comes from the file's bytes, never from its name, and every
// archive is checked before anything is unpacked.
import zlib from 'node:zlib';
import { fail } from './errors.js';

export const LIMITS = {
  maxExpandedBytes: 20 * 1024 * 1024, // all files together after unpacking
  maxEntries: 500                     // files + folders inside one archive
};

const NESTED_ARCHIVE_NAME = /\.(zip|jar|war|ear|tar|tgz|gz|bz2|xz|7z|rar)$/i;
const utf8 = new TextDecoder('utf-8', { fatal: true });

// Text, or null for binary data (NUL bytes or invalid UTF-8).
export const toText = (bytes) => {
  if (bytes.includes(0)) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
};

const isZip = (b) =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b &&
  ((b[2] === 0x03 && b[3] === 0x04) || (b[2] === 0x05 && b[3] === 0x06));

const isTar = (b) => b.length >= 512 && b.toString('latin1', 257, 262) === 'ustar';

const isOtherArchive = (b) =>
  (b[0] === 0x1f && b[1] === 0x8b) ||                     // gzip
  b.toString('latin1', 0, 3) === 'BZh' ||                 // bzip2
  b.toString('latin1', 0, 6) === '\xfd7zXZ\x00' ||        // xz
  b.toString('latin1', 0, 6) === '7z\xbc\xaf\x27\x1c' ||  // 7-Zip
  b.toString('latin1', 0, 4) === 'Rar!';                  // RAR

// Archive paths must stay inside the archive: no absolute paths, no "..".
const checkPath = (name) => {
  const path = name.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').includes('..')) {
    throw fail('ARCHIVE_UNSAFE', `Unsafe path in archive: ${path.slice(0, 120)}`);
  }
  if (NESTED_ARCHIVE_NAME.test(path)) {
    throw fail('ARCHIVE_UNSAFE', `Archives inside archives are not allowed: ${path.slice(0, 120)}`);
  }
  return path;
};

// Collects scannable text files and enforces the entry and size limits.
const createCollector = () => {
  const files = [];
  const skipped = { binary: 0, empty: 0, folders: 0 };
  let entries = 0;
  let expandedBytes = 0;

  return {
    files,
    countEntry() {
      entries += 1;
      if (entries > LIMITS.maxEntries) {
        throw fail('ARCHIVE_TOO_LARGE', `The archive has more than ${LIMITS.maxEntries} entries`);
      }
    },
    reserve(bytes) {
      expandedBytes += bytes;
      if (expandedBytes > LIMITS.maxExpandedBytes) {
        throw fail('ARCHIVE_TOO_LARGE', 'The archive unpacks to more than 20 MiB');
      }
    },
    folder() {
      skipped.folders += 1;
    },
    add(path, bytes) {
      if (bytes.length === 0) {
        skipped.empty += 1;
        return;
      }
      if (isZip(bytes) || isTar(bytes) || isOtherArchive(bytes)) {
        throw fail('ARCHIVE_UNSAFE', `Archives inside archives are not allowed: ${path.slice(0, 120)}`);
      }
      const text = toText(bytes);
      if (text === null) skipped.binary += 1;
      else files.push({ path, text });
    },
    result(format) {
      return { format, files, skipped, entries, expandedBytes };
    }
  };
};

// ZIP: walk the central directory, then unpack each entry from its local header.
const readZip = (buf, out) => {
  // End-of-central-directory record: last 22 bytes plus an optional comment (max 64 KiB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw fail('ARCHIVE_INVALID', 'The ZIP file is damaged (no central directory)');

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt16LE(eocd + 4) !== 0 || count === 0xffff || cdOffset === 0xffffffff) {
    throw fail('ARCHIVE_INVALID', 'Split and ZIP64 archives are not supported');
  }
  if (count > LIMITS.maxEntries) {
    throw fail('ARCHIVE_TOO_LARGE', `The archive has more than ${LIMITS.maxEntries} entries`);
  }
  if (cdOffset + cdSize > eocd) throw fail('ARCHIVE_INVALID', 'The ZIP file is damaged');

  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) {
      throw fail('ARCHIVE_INVALID', 'The ZIP file is damaged');
    }
    const madeBy = buf.readUInt16LE(p + 4) >> 8; // 3 = Unix
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const unixMode = buf.readUInt32LE(p + 38) >>> 16;
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLength > eocd) throw fail('ARCHIVE_INVALID', 'The ZIP file is damaged');
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;

    out.countEntry();
    const path = checkPath(name);
    if (madeBy === 3 && (unixMode & 0o170000) === 0o120000) {
      throw fail('ARCHIVE_UNSAFE', `Links are not allowed: ${path.slice(0, 120)}`);
    }
    if (path.endsWith('/')) {
      out.folder();
      continue;
    }
    if (flags & 0x1) throw fail('ARCHIVE_INVALID', 'Encrypted ZIP entries are not supported');

    // Count the declared size first, so a zip bomb is rejected before unpacking.
    out.reserve(size);

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw fail('ARCHIVE_INVALID', 'The ZIP file is damaged');
    }
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > buf.length) throw fail('ARCHIVE_INVALID', 'The ZIP file is damaged');
    const data = buf.subarray(dataStart, dataStart + compressedSize);

    let bytes;
    if (method === 0) {
      bytes = data;
    } else if (method === 8) {
      try {
        // Never let an entry unpack to more than it claims.
        bytes = zlib.inflateRawSync(data, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw fail('ARCHIVE_INVALID', `Could not unpack ${path.slice(0, 120)}`);
      }
    } else {
      throw fail('ARCHIVE_INVALID', `Unsupported ZIP compression in ${path.slice(0, 120)}`);
    }
    if (bytes.length !== size || (zlib.crc32(bytes) >>> 0) !== crc) {
      throw fail('ARCHIVE_INVALID', `ZIP entry is damaged: ${path.slice(0, 120)}`);
    }
    out.add(path, bytes);
  }
};

const readOctal = (buf, start, length) => {
  const text = buf.toString('latin1', start, start + length).replace(/\0[\s\S]*$/, '').trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw fail('ARCHIVE_INVALID', 'The TAR file is damaged');
  return parseInt(text, 8);
};

const readString = (buf, start, length) =>
  buf.toString('utf8', start, start + length).replace(/\0[\s\S]*$/, '');

// TAR: 512-byte headers, each followed by the file's data rounded up to 512 bytes.
const readTar = (buf, out) => {
  let p = 0;
  let longName = null;

  while (p + 512 <= buf.length) {
    const header = buf.subarray(p, p + 512);
    if (header.every((b) => b === 0)) break; // end of archive

    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (sum !== readOctal(header, 148, 8)) throw fail('ARCHIVE_INVALID', 'The TAR file is damaged (bad checksum)');

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = p + 512;
    if (dataStart + size > buf.length) throw fail('ARCHIVE_INVALID', 'The TAR file is cut off');
    const data = buf.subarray(dataStart, dataStart + size);
    p = dataStart + Math.ceil(size / 512) * 512;

    // Metadata records (long names, pax headers) describe the next entry.
    if ('xgLK'.includes(type)) {
      if (size > 64 * 1024) throw fail('ARCHIVE_INVALID', 'TAR metadata is too large');
      if (type === 'L') longName = data.toString('utf8').replace(/\0+$/, '');
      if (type === 'x') {
        const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
        if (match) longName = match[1];
      }
      continue;
    }

    const prefix = readString(header, 345, 155);
    const baseName = readString(header, 0, 100);
    const name = longName ?? (prefix ? `${prefix}/${baseName}` : baseName);
    longName = null;

    out.countEntry();
    const path = checkPath(name);
    if (type === '1' || type === '2') throw fail('ARCHIVE_UNSAFE', `Links are not allowed: ${path.slice(0, 120)}`);
    if (type === '5') {
      out.folder();
      continue;
    }
    if (type !== '0' && type !== '7') {
      throw fail('ARCHIVE_UNSAFE', `Special files are not allowed: ${path.slice(0, 120)}`);
    }
    out.reserve(size);
    out.add(path, data);
  }
};

// Returns { format, files: [{ path, text }], skipped, entries, expandedBytes }.
export const extractFiles = (bytes, { fileName = 'source.txt' } = {}) => {
  const out = createCollector();

  if (isZip(bytes)) {
    readZip(bytes, out);
    return out.result('zip');
  }
  if (isTar(bytes)) {
    readTar(bytes, out);
    return out.result('tar');
  }
  if (isOtherArchive(bytes)) {
    throw fail('UNSUPPORTED_FORMAT', 'Only ZIP, TAR and plain text uploads are supported');
  }

  const text = toText(bytes);
  if (text === null) throw fail('UNSUPPORTED_FORMAT', 'The upload is not text, ZIP or TAR');
  out.countEntry();
  out.reserve(bytes.length);
  out.files.push({ path: fileName, text });
  return out.result('text');
};