// Test-only builders for small ZIP and TAR files (never copied into the Lambda image).
import zlib from 'node:zlib';

// entries: [{ name, data, method (8 = deflate, 0 = stored), symlink, declaredSize }]
export const makeZip = (entries) => {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.data ?? '');
    const method = e.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = zlib.crc32(raw) >>> 0;
    const size = e.declaredSize ?? raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = e.symlink ? 0o120777 : e.name.endsWith('/') ? 0o040755 : 0o100644;
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

// entries: [{ name, data, type ('0' file, '2' symlink, '5' folder), linkname }]
export const makeTar = (entries) => {
  const blocks = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '');
    const header = Buffer.alloc(512);
    header.write(e.name, 0, 100, 'utf8');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write(e.type ?? '0', 156);
    if (e.linkname) header.write(e.linkname, 157, 100, 'utf8');
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
};

export const VULNERABLE_JS = "const password = 'hunter2';\nconst apiKey = 'abcdef1234567890abcd';\n";