/**
 * Minimal ZIP writer — STORE method only, no compression, no dependencies.
 *
 * Exists because the supplier portal's "download all files" (David,
 * 2026-08-05) needs a zip and the repo has no archive library: adding one
 * means running npm install on this Windows box, which prunes the linux-musl
 * optional deps and breaks the container build (see CLAUDE.md). The files
 * being bundled are PDFs, images and XLSX — already compressed, so STORE
 * loses nothing that matters.
 *
 * Emits a plain ZIP (local file headers + central directory + EOCD) readable
 * by every extractor. UTF-8 filename flag set; DOS timestamps from the
 * entry's mtime (or epoch start when omitted — deterministic for tests).
 * No ZIP64: 4GB total / 65k entries is far beyond any PO's files.
 */

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** Optional modified time; defaults to the DOS epoch (1980-01-01). */
  mtime?: Date;
}

// Standard CRC-32 (IEEE 802.3), table-driven.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(mtime?: Date): { date: number; time: number } {
  if (!mtime || mtime.getFullYear() < 1980) return { date: 0x21, time: 0 }; // 1980-01-01 00:00
  const date =
    ((mtime.getFullYear() - 1980) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate();
  const time =
    (mtime.getHours() << 11) | (mtime.getMinutes() << 5) | Math.floor(mtime.getSeconds() / 2);
  return { date, time };
}

/** Keep names archive-safe: forward slashes, no leading slashes or traversal. */
function sanitizeEntryName(name: string): string {
  const cleaned = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('/');
  return cleaned || 'file';
}

/** Build a ZIP from entries. Duplicate names get " (2)", " (3)"… suffixes. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const used = new Map<string, number>();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    let name = sanitizeEntryName(entry.name);
    const seen = used.get(name.toLowerCase()) ?? 0;
    used.set(name.toLowerCase(), seen + 1);
    if (seen > 0) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)} (${seen + 1})${name.slice(dot)}` : `${name} (${seen + 1})`;
    }

    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(entry.data);
    const { date, time } = dosDateTime(entry.mtime);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed (= uncompressed for STORE)
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags: UTF-8 names
    central.writeUInt16LE(0, 10); // method: STORE
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra/comment/disk/attrs all zero (30-37)
    central.writeUInt32LE(offset, 42); // local header offset

    localParts.push(local, nameBytes, entry.data);
    centralParts.push(central, nameBytes);
    offset += 30 + nameBytes.length + size;
  }

  const centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}
