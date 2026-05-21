/**
 * minimalZipWriter.ts — Minimal store-only ZIP builder for browser export.
 *
 * Generates a valid PKZIP archive (store method, no compression) from a list
 * of named UTF-8 text / binary entries.  CRC-32 is computed per-entry as
 * required by the ZIP specification.
 *
 * Limitations (intentional — this is not a general-purpose library):
 *   - Store only (compression method 0 — no deflate).
 *   - UTF-8 filenames with flag bit 11 set.
 *   - 32-bit file sizes (max ~4 GiB per file / total).  No ZIP64.
 *   - File timestamps written as zero (not needed for cache ZIPs).
 *
 * Suitable for exporting derived room-cache ZIPs in browser mode where total
 * size is well under a few MB and no external dependency is desired.
 *
 * Usage:
 *   const blob = buildZipBlob([
 *     { filename: 'ROOMS/manifest.json', data: encoder.encode(manifestJson) },
 *     { filename: 'ROOMS/lobby_room.json', data: encoder.encode(roomJson) },
 *   ]);
 */

// ── CRC-32 table (standard reflected polynomial 0xEDB88320) ──────────────────

const CRC32_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Little-endian write helpers ───────────────────────────────────────────────

function writeU16(buf: Uint8Array, offset: number, v: number): void {
  buf[offset]     = v & 0xFF;
  buf[offset + 1] = (v >>> 8) & 0xFF;
}

function writeU32(buf: Uint8Array, offset: number, v: number): void {
  buf[offset]     = v & 0xFF;
  buf[offset + 1] = (v >>> 8)  & 0xFF;
  buf[offset + 2] = (v >>> 16) & 0xFF;
  buf[offset + 3] = (v >>> 24) & 0xFF;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** An entry to include in the ZIP archive. */
export interface ZipEntry {
  /** Path inside the ZIP (e.g. `'ROOMS/manifest.json'`). */
  filename: string;
  /** Raw file bytes.  Use `new TextEncoder().encode(str)` for text. */
  data: Uint8Array;
}

/**
 * Builds a store-only (no compression) ZIP archive from the given entries and
 * returns it as a `Blob` with MIME type `application/zip`.
 *
 * Entry order is preserved.  Duplicate filenames are allowed (though not
 * recommended — most unzip tools take the last occurrence).
 */
export function buildZipBlob(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();

  // Pre-encode each entry and compute CRC-32 up front.
  const prepared = entries.map(e => ({
    filenameBytes: encoder.encode(e.filename),
    data: e.data,
    crc: crc32(e.data),
  }));

  const parts: Uint8Array[] = [];

  // ── Local file sections ───────────────────────────────────────────────────

  /** Byte offset of each local file header (needed for central directory). */
  const localHeaderOffsets: number[] = [];
  let offset = 0;

  for (const entry of prepared) {
    localHeaderOffsets.push(offset);

    const fnLen = entry.filenameBytes.length;
    const headerSize = 30 + fnLen;
    const header = new Uint8Array(headerSize);

    // Local file header signature: 0x04034b50
    header[0] = 0x50; header[1] = 0x4B; header[2] = 0x03; header[3] = 0x04;
    writeU16(header, 4, 20);           // version needed to extract
    writeU16(header, 6, 0x0800);       // general purpose flag: UTF-8 filename
    writeU16(header, 8, 0);            // compression method: store
    writeU16(header, 10, 0);           // last mod file time
    writeU16(header, 12, 0);           // last mod file date
    writeU32(header, 14, entry.crc);   // CRC-32
    writeU32(header, 18, entry.data.length); // compressed size (== uncompressed)
    writeU32(header, 22, entry.data.length); // uncompressed size
    writeU16(header, 26, fnLen);       // file name length
    writeU16(header, 28, 0);           // extra field length
    header.set(entry.filenameBytes, 30);

    parts.push(header);
    parts.push(entry.data);
    offset += headerSize + entry.data.length;
  }

  // ── Central directory ─────────────────────────────────────────────────────

  const centralDirStart = offset;

  for (let i = 0; i < prepared.length; i++) {
    const entry = prepared[i];
    const fnLen = entry.filenameBytes.length;
    const cd = new Uint8Array(46 + fnLen);

    // Central directory file header signature: 0x02014b50
    cd[0] = 0x50; cd[1] = 0x4B; cd[2] = 0x01; cd[3] = 0x02;
    writeU16(cd, 4,  20);              // version made by
    writeU16(cd, 6,  20);              // version needed to extract
    writeU16(cd, 8,  0x0800);          // general purpose flag: UTF-8 filename
    writeU16(cd, 10, 0);               // compression method: store
    writeU16(cd, 12, 0);               // last mod file time
    writeU16(cd, 14, 0);               // last mod file date
    writeU32(cd, 16, entry.crc);       // CRC-32
    writeU32(cd, 20, entry.data.length); // compressed size
    writeU32(cd, 24, entry.data.length); // uncompressed size
    writeU16(cd, 28, fnLen);           // file name length
    writeU16(cd, 30, 0);               // extra field length
    writeU16(cd, 32, 0);               // file comment length
    writeU16(cd, 34, 0);               // disk number start
    writeU16(cd, 36, 0);               // internal file attributes
    writeU32(cd, 38, 0);               // external file attributes
    writeU32(cd, 42, localHeaderOffsets[i]); // relative offset of local header
    cd.set(entry.filenameBytes, 46);

    parts.push(cd);
    offset += 46 + fnLen;
  }

  const centralDirSize = offset - centralDirStart;

  // ── End of central directory record ──────────────────────────────────────

  const eocd = new Uint8Array(22);
  // Signature: 0x06054b50
  eocd[0] = 0x50; eocd[1] = 0x4B; eocd[2] = 0x05; eocd[3] = 0x06;
  writeU16(eocd, 4,  0);                    // number of this disk
  writeU16(eocd, 6,  0);                    // disk with start of central dir
  writeU16(eocd, 8,  prepared.length);      // entries on this disk
  writeU16(eocd, 10, prepared.length);      // total entries
  writeU32(eocd, 12, centralDirSize);       // size of central directory
  writeU32(eocd, 16, centralDirStart);      // offset of central directory
  writeU16(eocd, 20, 0);                    // ZIP file comment length
  parts.push(eocd);

  return new Blob(parts as BlobPart[], { type: 'application/zip' });
}
