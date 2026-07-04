#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const ATLAS_ROOT = path.join(ROOT, 'ASSETS', 'DERIVED', 'SPRITE_ATLASES');
const DIFF_ROOT = path.join(ATLAS_ROOT, '_DIFF');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function usage() {
  return [
    'Usage: node scripts/compare-sprite-atlases.mjs [--theme <themeId>] [--debug|--write-all]',
    '',
    'Compares atlas sprite crops against their original source sprites pixel-for-pixel.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { theme: null, writeAll: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--theme':
        if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
          throw new Error('--theme requires a theme id.');
        }
        args.theme = argv[++i];
        break;
      case '--debug':
      case '--write-all':
        args.writeAll = true;
        break;
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }
  return args;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function relFromRoot(absPath) {
  return toPosixPath(path.relative(ROOT, absPath));
}

async function exists(absPath) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function atlasJsonFiles() {
  if (!await exists(ATLAS_ROOT)) {
    throw new Error(`Atlas folder does not exist: ${relFromRoot(ATLAS_ROOT)}`);
  }
  const entries = await fs.readdir(ATLAS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(ATLAS_ROOT, entry.name))
    .sort((a, b) => relFromRoot(a).localeCompare(relFromRoot(b)));
}

async function readJson(absPath) {
  return JSON.parse(await fs.readFile(absPath, 'utf8'));
}

function channelsForColorType(colorType) {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 3: return 1;
    case 4: return 2;
    case 6: return 4;
    default: return 0;
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterScanline(row, previous, filter, bpp) {
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp] : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bpp ? previous[i - bpp] : 0;
    switch (filter) {
      case 0:
        break;
      case 1:
        row[i] = (row[i] + left) & 0xff;
        break;
      case 2:
        row[i] = (row[i] + up) & 0xff;
        break;
      case 3:
        row[i] = (row[i] + Math.floor((left + up) / 2)) & 0xff;
        break;
      case 4:
        row[i] = (row[i] + paeth(left, up, upLeft)) & 0xff;
        break;
      default:
        throw new Error(`unsupported PNG filter ${filter}`);
    }
  }
}

function writeRgbaRow(out, outOffset, row, width, colorType, palette, transparency) {
  for (let x = 0; x < width; x++) {
    const dst = outOffset + x * 4;
    if (colorType === 0) {
      const gray = row[x];
      out[dst] = gray;
      out[dst + 1] = gray;
      out[dst + 2] = gray;
      out[dst + 3] = 255;
    } else if (colorType === 2) {
      const src = x * 3;
      out[dst] = row[src];
      out[dst + 1] = row[src + 1];
      out[dst + 2] = row[src + 2];
      out[dst + 3] = 255;
    } else if (colorType === 3) {
      const idx = row[x];
      const p = idx * 3;
      if (palette === null || p + 2 >= palette.length) throw new Error('indexed PNG missing palette entry');
      out[dst] = palette[p];
      out[dst + 1] = palette[p + 1];
      out[dst + 2] = palette[p + 2];
      out[dst + 3] = transparency !== null && idx < transparency.length ? transparency[idx] : 255;
    } else if (colorType === 4) {
      const src = x * 2;
      const gray = row[src];
      out[dst] = gray;
      out[dst + 1] = gray;
      out[dst + 2] = gray;
      out[dst + 3] = row[src + 1];
    } else if (colorType === 6) {
      const src = x * 4;
      out[dst] = row[src];
      out[dst + 1] = row[src + 1];
      out[dst + 2] = row[src + 2];
      out[dst + 3] = row[src + 3];
    }
  }
}

function decodePng(buffer) {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  let palette = null;
  let transparency = null;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error('truncated PNG chunk');
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('unsupported compressed/interlaced PNG variant');
      }
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0 || idat.length === 0) throw new Error('missing PNG image data');
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}; expected 8`);

  const channels = channelsForColorType(colorType);
  if (channels === 0) throw new Error(`unsupported PNG color type ${colorType}`);

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let inOffset = 0;
  let previous = Buffer.alloc(stride);
  let current = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = inflated[inOffset++];
    inflated.copy(current, 0, inOffset, inOffset + stride);
    inOffset += stride;
    unfilterScanline(current, previous, filter, channels);
    writeRgbaRow(rgba, y * width * 4, current, width, colorType, palette, transparency);
    [previous, current] = [current, previous];
  }

  return { width, height, rgba };
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const dst = y * (rowBytes + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, y * rowBytes, y * rowBytes + rowBytes);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function cropRgba(image, rect) {
  const out = Buffer.alloc(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    const srcStart = ((rect.y + y) * image.width + rect.x) * 4;
    const dstStart = y * rect.w * 4;
    image.rgba.copy(out, dstStart, srcStart, srcStart + rect.w * 4);
  }
  return out;
}

function countPixelDiffs(a, b) {
  const len = Math.min(a.length, b.length);
  let diffPixels = 0;
  for (let i = 0; i < len; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
      diffPixels++;
    }
  }
  return diffPixels + Math.abs(a.length - b.length) / 4;
}

function makeDiffSheet(source, crop, width, height) {
  const gap = 2;
  const sheetW = width * 3 + gap * 2;
  const sheetH = height;
  const out = Buffer.alloc(sheetW * sheetH * 4, 0);

  function copyPanel(data, panelX) {
    for (let y = 0; y < height; y++) {
      const srcStart = y * width * 4;
      const dstStart = (y * sheetW + panelX) * 4;
      data.copy(out, dstStart, srcStart, srcStart + width * 4);
    }
  }

  copyPanel(source, 0);
  copyPanel(crop, width + gap);

  const diffX = (width + gap) * 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = (y * sheetW + diffX + x) * 4;
      const different = source[src] !== crop[src]
        || source[src + 1] !== crop[src + 1]
        || source[src + 2] !== crop[src + 2]
        || source[src + 3] !== crop[src + 3];
      if (different) {
        out[dst] = 255;
        out[dst + 1] = 0;
        out[dst + 2] = 64;
        out[dst + 3] = 255;
      } else {
        out[dst] = source[src];
        out[dst + 1] = source[src + 1];
        out[dst + 2] = source[src + 2];
        out[dst + 3] = Math.floor(source[src + 3] * 0.35);
      }
    }
  }
  return { width: sheetW, height: sheetH, rgba: out };
}

function safeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function writeDiff(themeId, key, source, crop, width, height) {
  await fs.mkdir(DIFF_ROOT, { recursive: true });
  const sheet = makeDiffSheet(source, crop, width, height);
  const outPath = path.join(DIFF_ROOT, `${safeFileName(themeId)}__${safeFileName(key)}.png`);
  await fs.writeFile(outPath, encodePng(sheet.width, sheet.height, sheet.rgba));
  return outPath;
}

async function compareAtlas(jsonPath, options) {
  const metadata = await readJson(jsonPath);
  const themeId = metadata.themeId ?? path.basename(jsonPath, '.json');
  const atlasPath = path.resolve(path.dirname(jsonPath), metadata.atlasImage ?? '');
  const result = {
    themeId,
    spriteCount: 0,
    mismatches: [],
    errors: [],
    diffFiles: [],
  };

  let atlas;
  try {
    atlas = decodePng(await fs.readFile(atlasPath));
  } catch (err) {
    result.errors.push(`${themeId}: could not decode atlas ${relFromRoot(atlasPath)}: ${err.message}`);
    return result;
  }

  const entries = Object.entries(metadata.sprites ?? {}).sort(([a], [b]) => a.localeCompare(b));
  result.spriteCount = entries.length;

  for (const [key, sprite] of entries) {
    if (typeof sprite?.sourcePath !== 'string') {
      result.errors.push(`${themeId}/${key}: missing sourcePath`);
      continue;
    }
    const sourcePath = path.resolve(ROOT, sprite.sourcePath);
    let source;
    try {
      source = decodePng(await fs.readFile(sourcePath));
    } catch (err) {
      result.errors.push(`${themeId}/${key}: could not decode source ${sprite.sourcePath}: ${err.message}`);
      continue;
    }

    if (source.width !== sprite.w || source.height !== sprite.h) {
      result.mismatches.push(`${themeId}/${key}: source dimensions ${source.width}x${source.height} differ from metadata ${sprite.w}x${sprite.h}`);
      continue;
    }
    if (sprite.x < 0 || sprite.y < 0 || sprite.x + sprite.w > atlas.width || sprite.y + sprite.h > atlas.height) {
      result.mismatches.push(`${themeId}/${key}: atlas rect ${sprite.x},${sprite.y},${sprite.w},${sprite.h} outside ${atlas.width}x${atlas.height}`);
      continue;
    }

    const crop = cropRgba(atlas, sprite);
    const diffPixels = countPixelDiffs(source.rgba, crop);
    if (diffPixels > 0) {
      result.mismatches.push(`${themeId}/${key}: ${diffPixels} pixel(s) differ`);
    }
    if (diffPixels > 0 || options.writeAll) {
      const diffPath = await writeDiff(themeId, key, source.rgba, crop, sprite.w, sprite.h);
      result.diffFiles.push(relFromRoot(diffPath));
    }
  }

  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const jsonFiles = (await atlasJsonFiles()).filter((file) => {
    if (options.theme === null) return true;
    return path.basename(file, '.json') === options.theme;
  });
  if (jsonFiles.length === 0) {
    throw new Error(options.theme === null
      ? `No atlas metadata files found in ${relFromRoot(ATLAS_ROOT)}`
      : `No atlas metadata found for theme '${options.theme}'`);
  }

  const results = [];
  for (const jsonPath of jsonFiles) {
    results.push(await compareAtlas(jsonPath, options));
  }

  const atlasCount = results.length;
  const spriteCount = results.reduce((sum, result) => sum + result.spriteCount, 0);
  const mismatchCount = results.reduce((sum, result) => sum + result.mismatches.length, 0);
  const errorCount = results.reduce((sum, result) => sum + result.errors.length, 0);
  const diffCount = results.reduce((sum, result) => sum + result.diffFiles.length, 0);

  console.log(`[sprite-atlas-compare] atlases=${atlasCount} sprites=${spriteCount} mismatches=${mismatchCount} errors=${errorCount} diffFiles=${diffCount}`);
  for (const result of results) {
    if (result.mismatches.length === 0 && result.errors.length === 0) {
      console.log(`[sprite-atlas-compare] ${result.themeId}: ${result.spriteCount} sprite(s) OK`);
      continue;
    }
    for (const mismatch of result.mismatches) console.error(`[sprite-atlas-compare] mismatch: ${mismatch}`);
    for (const error of result.errors) console.error(`[sprite-atlas-compare] error: ${error}`);
    for (const diff of result.diffFiles) console.error(`[sprite-atlas-compare] diff: ${diff}`);
  }

  if (mismatchCount > 0 || errorCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[sprite-atlas-compare] ${err.message}`);
  process.exit(1);
});
