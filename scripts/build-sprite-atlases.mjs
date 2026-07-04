#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const BLOCKS_ROOT = path.join(ROOT, 'ASSETS', 'SPRITES', 'BLOCKS');
const SPECIAL_BLOCKS_ROOT = path.join(ROOT, 'ASSETS', 'SPRITES', 'specialBLOCKS');
const OUTPUT_ROOT = path.join(ROOT, 'ASSETS', 'DERIVED', 'SPRITE_ATLASES');
const DEFAULT_PADDING = 2;
const DETERMINISTIC_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const SYSTEM_BLOCK_FOLDERS = new Set(['block_templates']);
const SPECIAL_WALL_THEMES = new Set(['iceBlock', 'ultraIceBlock']);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function usage() {
  return [
    'Usage: node scripts/build-sprite-atlases.mjs [--dry-run] [--force] [--deterministic] [--theme <themeId>]',
    '',
    'Builds derived sprite atlases from folder-based block/tile sprite themes.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    deterministic: false,
    theme: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--deterministic':
        args.deterministic = true;
        break;
      case '--theme':
        if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
          throw new Error('--theme requires a theme id.');
        }
        args.theme = argv[++i];
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

function sanitizeOutputName(themeId) {
  return themeId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function exists(absPath) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function listFilesDepthOne(root, themeId) {
  const dir = path.join(root, themeId);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => relFromRoot(a).localeCompare(relFromRoot(b)));
}

function hasPng(files) {
  return files.some((file) => path.extname(file).toLowerCase() === '.png');
}

async function discoverThemes() {
  const themes = [];

  const blockEntries = await fs.readdir(BLOCKS_ROOT, { withFileTypes: true });
  for (const entry of blockEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (SYSTEM_BLOCK_FOLDERS.has(entry.name)) continue;
    if (/^\d/.test(entry.name)) continue;

    const files = await listFilesDepthOne(BLOCKS_ROOT, entry.name);
    if (!hasPng(files)) continue;
    themes.push({
      themeId: entry.name,
      sourceRootAbs: path.join(BLOCKS_ROOT, entry.name),
      sourceRoot: relFromRoot(path.join(BLOCKS_ROOT, entry.name)),
      files,
    });
  }

  const specialEntries = await fs.readdir(SPECIAL_BLOCKS_ROOT, { withFileTypes: true });
  for (const entry of specialEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (!SPECIAL_WALL_THEMES.has(entry.name)) continue;

    const files = (await listFilesDepthOne(SPECIAL_BLOCKS_ROOT, entry.name))
      .filter((file) => path.basename(file).startsWith(entry.name));
    if (!hasPng(files)) continue;
    themes.push({
      themeId: entry.name,
      sourceRootAbs: path.join(SPECIAL_BLOCKS_ROOT, entry.name),
      sourceRoot: relFromRoot(path.join(SPECIAL_BLOCKS_ROOT, entry.name)),
      files,
    });
  }

  return themes.sort((a, b) => a.themeId.localeCompare(b.themeId));
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

  if (width <= 0 || height <= 0 || idat.length === 0) {
    throw new Error('missing PNG image data');
  }
  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${bitDepth}; expected 8`);
  }

  const channels = channelsForColorType(colorType);
  if (channels === 0) throw new Error(`unsupported PNG color type ${colorType}`);

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bytesPerPixel = channels;
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let inOffset = 0;
  let previous = Buffer.alloc(stride);
  let current = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = inflated[inOffset++];
    inflated.copy(current, 0, inOffset, inOffset + stride);
    inOffset += stride;
    unfilterScanline(current, previous, filter, bytesPerPixel);
    writeRgbaRow(rgba, y * width * 4, current, width, colorType, palette, transparency);
    [previous, current] = [current, previous];
  }

  return { width, height, rgba };
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
      if (palette === null) throw new Error('indexed PNG has no palette');
      const index = row[x];
      const src = index * 3;
      out[dst] = palette[src] ?? 0;
      out[dst + 1] = palette[src + 1] ?? 0;
      out[dst + 2] = palette[src + 2] ?? 0;
      out[dst + 3] = transparency?.[index] ?? 255;
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

function copySprite(atlas, atlasWidth, sprite, x, y) {
  for (let row = 0; row < sprite.height; row++) {
    const srcStart = row * sprite.width * 4;
    const srcEnd = srcStart + sprite.width * 4;
    const dstStart = ((y + row) * atlasWidth + x) * 4;
    sprite.rgba.copy(atlas, dstStart, srcStart, srcEnd);
  }
}

function packSprites(sprites, padding) {
  const totalArea = sprites.reduce((sum, sprite) => sum + (sprite.width + padding) * (sprite.height + padding), 0);
  const widest = sprites.reduce((max, sprite) => Math.max(max, sprite.width), 0);
  const targetWidth = Math.max(16, nextPowerOfTwo(Math.ceil(Math.sqrt(totalArea))));
  const atlasWidth = Math.max(targetWidth, widest + padding * 2);

  let x = padding;
  let y = padding;
  let rowHeight = 0;
  for (const sprite of sprites) {
    if (x + sprite.width + padding > atlasWidth && x > padding) {
      x = padding;
      y += rowHeight + padding;
      rowHeight = 0;
    }
    sprite.x = x;
    sprite.y = y;
    x += sprite.width + padding;
    rowHeight = Math.max(rowHeight, sprite.height);
  }

  const atlasHeight = nextPowerOfTwo(Math.max(16, y + rowHeight + padding));
  return { atlasWidth, atlasHeight };
}

function nextPowerOfTwo(value) {
  let pow = 1;
  while (pow < value) pow *= 2;
  return pow;
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
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

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

function spriteKeyFor(sourceRootAbs, file) {
  return toPosixPath(path.relative(sourceRootAbs, file)).replace(/\.png$/i, '');
}

async function buildTheme(theme, options) {
  const warnings = [];
  const skipped = [];
  const decoded = [];
  const seenKeys = new Set();

  for (const file of theme.files) {
    const rel = relFromRoot(file);
    if (path.extname(file).toLowerCase() !== '.png') {
      skipped.push(`${rel} (non-PNG)`);
      continue;
    }

    const key = spriteKeyFor(theme.sourceRootAbs, file);
    if (seenKeys.has(key)) {
      warnings.push(`Duplicate sprite key '${key}' in ${theme.sourceRoot}`);
      continue;
    }
    seenKeys.add(key);

    try {
      const image = decodePng(await fs.readFile(file));
      decoded.push({
        key,
        sourcePath: rel,
        width: image.width,
        height: image.height,
        rgba: image.rgba,
        x: 0,
        y: 0,
      });
    } catch (err) {
      warnings.push(`Could not decode ${rel}: ${err.message}`);
    }
  }

  decoded.sort((a, b) => a.key.localeCompare(b.key));
  if (decoded.length === 0) {
    return { themeId: theme.themeId, generated: false, warnings, skipped, spriteCount: 0, reason: 'no decodable PNG sprites' };
  }

  const { atlasWidth, atlasHeight } = packSprites(decoded, DEFAULT_PADDING);
  const outputBase = sanitizeOutputName(theme.themeId);
  const atlasImage = `${outputBase}.png`;
  const atlasJson = `${outputBase}.json`;
  const atlasPath = path.join(OUTPUT_ROOT, atlasImage);
  const jsonPath = path.join(OUTPUT_ROOT, atlasJson);
  const outputExists = await exists(atlasPath) || await exists(jsonPath);

  if (outputExists && !options.force && !options.dryRun) {
    return {
      themeId: theme.themeId,
      generated: false,
      warnings,
      skipped,
      spriteCount: decoded.length,
      reason: 'output exists; pass --force to overwrite',
      atlasImage,
      atlasJson,
    };
  }

  const sprites = {};
  for (const sprite of decoded) {
    sprites[sprite.key] = {
      x: sprite.x,
      y: sprite.y,
      w: sprite.width,
      h: sprite.height,
      sourcePath: sprite.sourcePath,
    };
  }

  const metadata = {
    version: 1,
    themeId: theme.themeId,
    sourceRoot: theme.sourceRoot,
    atlasImage,
    generatedAt: options.deterministic ? DETERMINISTIC_TIMESTAMP : new Date().toISOString(),
    padding: DEFAULT_PADDING,
    width: atlasWidth,
    height: atlasHeight,
    sprites,
  };

  if (!options.dryRun) {
    await fs.mkdir(OUTPUT_ROOT, { recursive: true });
    const atlas = Buffer.alloc(atlasWidth * atlasHeight * 4);
    for (const sprite of decoded) {
      copySprite(atlas, atlasWidth, sprite, sprite.x, sprite.y);
    }
    await fs.writeFile(atlasPath, encodePng(atlasWidth, atlasHeight, atlas));
    await fs.writeFile(jsonPath, `${JSON.stringify(metadata, null, 2)}\n`);
  }

  return {
    themeId: theme.themeId,
    generated: true,
    dryRun: options.dryRun,
    warnings,
    skipped,
    spriteCount: decoded.length,
    atlasImage,
    atlasJson,
    width: atlasWidth,
    height: atlasHeight,
  };
}

async function writeReadme(options) {
  if (options.dryRun) return;
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  await fs.writeFile(
    path.join(OUTPUT_ROOT, 'README.md'),
    [
      '# Sprite Atlases',
      '',
      'This folder contains derived block/tile sprite atlas files generated from source sprites under `ASSETS/SPRITES/`.',
      'Runtime rendering does not depend on these atlases yet.',
      '',
      'Regenerate atlases:',
      '',
      '```bash',
      'npm run build:atlases -- --force',
      'npm run build:atlases -- --deterministic',
      '```',
      '',
      'Validate atlas metadata, source dimensions, bounds, and overlaps:',
      '',
      '```bash',
      'npm run validate:atlases -- --summary',
      'npm run validate:atlases -- --strict',
      '```',
      '',
      'Generate the developer inspection preview:',
      '',
      '```bash',
      'npm run preview:atlases',
      '```',
      '',
      'All files in this folder are derived output and safe to regenerate. Source sprites live outside this folder and should not be edited by atlas tooling.',
      '',
    ].join('\n'),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let themes = await discoverThemes();

  if (options.theme !== null) {
    themes = themes.filter((theme) => theme.themeId === options.theme);
    if (themes.length === 0) {
      throw new Error(`No eligible sprite theme matched --theme ${options.theme}`);
    }
  }

  if (themes.length === 0) {
    throw new Error('No eligible block/tile sprite theme folders were found.');
  }

  const results = [];
  for (const theme of themes) {
    results.push(await buildTheme(theme, options));
  }

  const foundSprites = results.reduce((sum, result) => sum + result.spriteCount, 0);
  if (foundSprites === 0) {
    throw new Error('No eligible decodable PNG sprites were found in discovered block/tile sprite folders.');
  }

  await writeReadme(options);

  console.log(`[sprite-atlas] Scanned ${themes.length} theme folder(s).`);
  for (const result of results) {
    const status = result.generated
      ? `${options.dryRun ? 'would generate' : 'generated'} ${result.atlasImage} + ${result.atlasJson} (${result.spriteCount} sprites, ${result.width}x${result.height})`
      : `skipped (${result.reason})`;
    console.log(`[sprite-atlas] ${result.themeId}: ${status}`);
    for (const item of result.skipped) console.log(`[sprite-atlas]   skipped ${item}`);
    for (const warning of result.warnings) console.warn(`[sprite-atlas]   warning: ${warning}`);
  }
}

main().catch((err) => {
  console.error(`[sprite-atlas] ${err.message}`);
  process.exitCode = 1;
});
