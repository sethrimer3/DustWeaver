#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ATLAS_ROOT = path.join(ROOT, 'ASSETS', 'DERIVED', 'SPRITE_ATLASES');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function usage() {
  return [
    'Usage: node scripts/validate-sprite-atlases.mjs [--strict] [--summary] [--theme <themeId>]',
    '',
    'Validates derived sprite atlas metadata and referenced source sprites.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    strict: false,
    summary: false,
    theme: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--strict':
        args.strict = true;
        break;
      case '--summary':
        args.summary = true;
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

async function exists(absPath) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function readPngDimensions(absPath) {
  const handle = await fs.open(absPath, 'r');
  try {
    const header = Buffer.alloc(33);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < header.length || !header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error('not a PNG file');
    }
    const type = header.toString('ascii', 12, 16);
    if (type !== 'IHDR') throw new Error('PNG missing IHDR chunk');
    return {
      width: header.readUInt32BE(16),
      height: header.readUInt32BE(20),
    };
  } finally {
    await handle.close();
  }
}

async function readJson(absPath, errors) {
  try {
    return JSON.parse(await fs.readFile(absPath, 'utf8'));
  } catch (err) {
    errors.push(`${relFromRoot(absPath)}: could not parse JSON: ${err.message}`);
    return null;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function numericRect(sprite) {
  return ['x', 'y', 'w', 'h'].every((key) => typeof sprite[key] === 'number' && Number.isFinite(sprite[key]));
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y;
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

async function validateAtlas(jsonPath) {
  const errors = [];
  const warnings = [];
  const metadata = await readJson(jsonPath, errors);
  const result = {
    jsonPath,
    themeId: path.basename(jsonPath, '.json'),
    spriteCount: 0,
    pngSize: 0,
    errors,
    warnings,
  };
  if (metadata === null) return result;

  if (metadata.version === undefined) errors.push(`${relFromRoot(jsonPath)}: missing version`);
  if (typeof metadata.themeId !== 'string' || metadata.themeId.length === 0) {
    errors.push(`${relFromRoot(jsonPath)}: missing themeId`);
  } else {
    result.themeId = metadata.themeId;
  }
  if (typeof metadata.sourceRoot !== 'string' || metadata.sourceRoot.length === 0) {
    errors.push(`${relFromRoot(jsonPath)}: missing sourceRoot`);
  }
  if (!isObject(metadata.sprites)) {
    errors.push(`${relFromRoot(jsonPath)}: sprites must be an object`);
    return result;
  }

  const atlasImage = typeof metadata.atlasImage === 'string' ? metadata.atlasImage : '';
  if (atlasImage.length === 0) {
    errors.push(`${relFromRoot(jsonPath)}: missing atlasImage`);
    return result;
  }

  const atlasPath = path.resolve(path.dirname(jsonPath), atlasImage);
  if (!atlasPath.startsWith(ATLAS_ROOT)) {
    errors.push(`${relFromRoot(jsonPath)}: atlasImage resolves outside atlas folder`);
    return result;
  }
  if (!await exists(atlasPath)) {
    errors.push(`${relFromRoot(jsonPath)}: referenced atlas PNG does not exist: ${atlasImage}`);
    return result;
  }

  let atlasDimensions;
  try {
    atlasDimensions = await readPngDimensions(atlasPath);
    result.pngSize = (await fs.stat(atlasPath)).size;
  } catch (err) {
    errors.push(`${relFromRoot(atlasPath)}: could not read atlas PNG: ${err.message}`);
    return result;
  }

  if (typeof metadata.width === 'number' && metadata.width !== atlasDimensions.width) {
    warnings.push(`${metadata.themeId}: metadata width ${metadata.width} differs from atlas PNG width ${atlasDimensions.width}`);
  }
  if (typeof metadata.height === 'number' && metadata.height !== atlasDimensions.height) {
    warnings.push(`${metadata.themeId}: metadata height ${metadata.height} differs from atlas PNG height ${atlasDimensions.height}`);
  }

  const rects = [];
  const entries = Object.entries(metadata.sprites).sort(([a], [b]) => a.localeCompare(b));
  result.spriteCount = entries.length;
  if (entries.length === 0) warnings.push(`${metadata.themeId}: sprites object is empty`);

  for (const [key, sprite] of entries) {
    if (!isObject(sprite)) {
      errors.push(`${metadata.themeId}/${key}: sprite entry must be an object`);
      continue;
    }
    if (!numericRect(sprite)) {
      errors.push(`${metadata.themeId}/${key}: x, y, w, h must be finite numbers`);
      continue;
    }
    if (sprite.w <= 0 || sprite.h <= 0) {
      errors.push(`${metadata.themeId}/${key}: w and h must be positive`);
      continue;
    }
    if (sprite.x < 0 || sprite.y < 0 || sprite.x + sprite.w > atlasDimensions.width || sprite.y + sprite.h > atlasDimensions.height) {
      errors.push(`${metadata.themeId}/${key}: sprite rectangle is outside atlas bounds ${atlasDimensions.width}x${atlasDimensions.height}`);
    }

    if (typeof sprite.sourcePath !== 'string' || sprite.sourcePath.length === 0) {
      errors.push(`${metadata.themeId}/${key}: missing sourcePath`);
    } else {
      const sourcePath = path.resolve(ROOT, sprite.sourcePath);
      if (!sourcePath.startsWith(ROOT)) {
        errors.push(`${metadata.themeId}/${key}: sourcePath resolves outside repo root`);
      } else if (!await exists(sourcePath)) {
        errors.push(`${metadata.themeId}/${key}: sourcePath does not exist: ${sprite.sourcePath}`);
      } else {
        try {
          const sourceDimensions = await readPngDimensions(sourcePath);
          if (sourceDimensions.width !== sprite.w || sourceDimensions.height !== sprite.h) {
            errors.push(
              `${metadata.themeId}/${key}: source dimensions ${sourceDimensions.width}x${sourceDimensions.height} do not match metadata ${sprite.w}x${sprite.h}`,
            );
          }
        } catch (err) {
          errors.push(`${metadata.themeId}/${key}: could not read source sprite: ${err.message}`);
        }
      }
    }

    rects.push({ key, x: sprite.x, y: sprite.y, w: sprite.w, h: sprite.h });
  }

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) {
        errors.push(`${metadata.themeId}: sprite rectangles overlap: ${rects[i].key} and ${rects[j].key}`);
      }
    }
  }

  return result;
}

function printSummary(results, options) {
  const atlasCount = results.length;
  const spriteCount = results.reduce((sum, result) => sum + result.spriteCount, 0);
  const totalPngSize = results.reduce((sum, result) => sum + result.pngSize, 0);
  const warningCount = results.reduce((sum, result) => sum + result.warnings.length, 0);
  const errorCount = results.reduce((sum, result) => sum + result.errors.length, 0);

  console.log(`[sprite-atlas-validate] atlases=${atlasCount} sprites=${spriteCount} pngBytes=${totalPngSize} warnings=${warningCount} errors=${errorCount}`);
  if (!options.summary) {
    for (const result of results) {
      console.log(`[sprite-atlas-validate] ${result.themeId}: ${result.spriteCount} sprite(s), ${result.pngSize} PNG bytes`);
    }
  }
  for (const result of results) {
    for (const warning of result.warnings) console.warn(`[sprite-atlas-validate] warning: ${warning}`);
    for (const error of result.errors) console.error(`[sprite-atlas-validate] error: ${error}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let files = await atlasJsonFiles();
  if (options.theme !== null) {
    files = files.filter((file) => path.basename(file, '.json') === options.theme);
    if (files.length === 0) throw new Error(`No atlas JSON matched --theme ${options.theme}`);
  }
  if (files.length === 0) throw new Error('No atlas JSON files found.');

  const results = [];
  for (const file of files) results.push(await validateAtlas(file));
  printSummary(results, options);

  const warningCount = results.reduce((sum, result) => sum + result.warnings.length, 0);
  const errorCount = results.reduce((sum, result) => sum + result.errors.length, 0);
  if (errorCount > 0 || (options.strict && warningCount > 0)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[sprite-atlas-validate] ${err.message}`);
  process.exitCode = 1;
});
