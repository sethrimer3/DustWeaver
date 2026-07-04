#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './sprite-atlas-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ATLAS_ROOT = path.join(ROOT, 'ASSETS', 'DERIVED', 'SPRITE_ATLASES');

function parseArgs(argv) {
  const opts = { strict: false, summary: false, theme: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') opts.strict = true;
    else if (arg === '--summary') opts.summary = true;
    else if (arg === '--theme') opts.theme = argv[++i] ?? null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function exists(file) {
  return fs.stat(file).then(() => true, () => false);
}

async function validateOne(jsonFile) {
  const warnings = [];
  const errors = [];
  const meta = await readJson(jsonFile);
  const requireField = (name, type) => {
    if (!(name in meta)) errors.push(`${rel(jsonFile)}: missing ${name}`);
    else if (type !== null && typeof meta[name] !== type) errors.push(`${rel(jsonFile)}: ${name} must be ${type}`);
  };
  requireField('version', 'number');
  requireField('themeId', 'string');
  requireField('sourceRoot', 'string');
  requireField('atlasImage', 'string');
  requireField('sprites', 'object');
  if (meta.sprites === null || Array.isArray(meta.sprites)) errors.push(`${rel(jsonFile)}: sprites must be an object`);

  const pngFile = path.join(path.dirname(jsonFile), String(meta.atlasImage ?? ''));
  if (!(await exists(pngFile))) errors.push(`${rel(jsonFile)}: atlas PNG missing: ${meta.atlasImage}`);

  let atlas = null;
  let pngBytes = 0;
  if (await exists(pngFile)) {
    const buf = await fs.readFile(pngFile);
    pngBytes = buf.length;
    try {
      atlas = decodePng(buf);
    } catch (err) {
      errors.push(`${rel(pngFile)}: cannot decode atlas PNG: ${err.message}`);
    }
  }

  const rects = [];
  let spriteCount = 0;
  if (meta.sprites && typeof meta.sprites === 'object') {
    const keys = Object.keys(meta.sprites).sort();
    for (const key of keys) {
      spriteCount++;
      const s = meta.sprites[key];
      if (s === null || typeof s !== 'object') {
        errors.push(`${meta.themeId}.${key}: sprite entry must be an object`);
        continue;
      }
      for (const name of ['x', 'y', 'w', 'h']) {
        if (typeof s[name] !== 'number' || !Number.isFinite(s[name])) errors.push(`${meta.themeId}.${key}: ${name} must be numeric`);
      }
      if (typeof s.sourcePath !== 'string') errors.push(`${meta.themeId}.${key}: sourcePath must be a string`);
      const rect = { key, x: s.x, y: s.y, w: s.w, h: s.h };
      if (atlas && (rect.x < 0 || rect.y < 0 || rect.w <= 0 || rect.h <= 0 || rect.x + rect.w > atlas.width || rect.y + rect.h > atlas.height)) {
        errors.push(`${meta.themeId}.${key}: rectangle outside atlas bounds`);
      }
      for (const other of rects) {
        if (rectsOverlap(rect, other)) errors.push(`${meta.themeId}.${key}: overlaps ${other.key}`);
      }
      rects.push(rect);
      if (typeof s.sourcePath === 'string') {
        const sourceFile = path.join(ROOT, s.sourcePath);
        if (!(await exists(sourceFile))) {
          errors.push(`${meta.themeId}.${key}: source missing: ${s.sourcePath}`);
        } else {
          try {
            const source = decodePng(await fs.readFile(sourceFile));
            if (source.width !== s.w || source.height !== s.h) {
              errors.push(`${meta.themeId}.${key}: metadata size ${s.w}x${s.h} differs from source ${source.width}x${source.height}`);
            }
          } catch (err) {
            warnings.push(`${meta.themeId}.${key}: cannot decode source ${s.sourcePath}: ${err.message}`);
          }
        }
      }
    }
  }
  return { file: jsonFile, themeId: meta.themeId ?? path.basename(jsonFile, '.json'), spriteCount, pngBytes, warnings, errors };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const entries = await fs.readdir(ATLAS_ROOT, { withFileTypes: true }).catch(() => []);
  const jsonFiles = entries
    .filter(e => e.isFile() && e.name.endsWith('.json') && (opts.theme === null || e.name === `${opts.theme}.json`))
    .map(e => path.join(ATLAS_ROOT, e.name))
    .sort((a, b) => a.localeCompare(b));
  if (jsonFiles.length === 0) throw new Error(opts.theme ? `No atlas JSON found for theme ${opts.theme}` : 'No atlas JSON files found');
  const results = [];
  for (const file of jsonFiles) results.push(await validateOne(file));
  const warnings = results.flatMap(r => r.warnings);
  const errors = results.flatMap(r => r.errors);
  const spriteTotal = results.reduce((sum, r) => sum + r.spriteCount, 0);
  const pngBytes = results.reduce((sum, r) => sum + r.pngBytes, 0);
  console.log(`[sprite-atlas-validate] atlases=${results.length} sprites=${spriteTotal} pngBytes=${pngBytes} warnings=${warnings.length} errors=${errors.length}`);
  if (!opts.summary) {
    for (const r of results) console.log(`[sprite-atlas-validate] ${r.themeId}: ${r.spriteCount} sprite(s), ${r.pngBytes} PNG bytes`);
  }
  for (const warning of warnings) console.warn(`[sprite-atlas-validate] warning: ${warning}`);
  for (const error of errors) console.error(`[sprite-atlas-validate] error: ${error}`);
  if (errors.length > 0 || (opts.strict && warnings.length > 0)) process.exitCode = 1;
}

main().catch(err => {
  console.error(`[sprite-atlas-validate] ${err.message}`);
  process.exitCode = 1;
});
