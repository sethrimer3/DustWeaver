#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePngRgba } from './sprite-atlas-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ATLAS_ROOT = path.join(ROOT, 'ASSETS', 'DERIVED', 'SPRITE_ATLASES');
const DIFF_ROOT = path.join(ATLAS_ROOT, '_DIFFS');

function parseArgs(argv) {
  const opts = { theme: null, writeDiffs: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--theme') opts.theme = argv[++i] ?? null;
    else if (arg === '--write-diffs') opts.writeDiffs = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function pixelMismatch(atlas, source, rect) {
  let mismatch = 0;
  const diff = Buffer.alloc(source.width * source.height * 4);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const si = (y * source.width + x) * 4;
      const ai = ((rect.y + y) * atlas.width + rect.x + x) * 4;
      const same = source.data[si] === atlas.data[ai]
        && source.data[si + 1] === atlas.data[ai + 1]
        && source.data[si + 2] === atlas.data[ai + 2]
        && source.data[si + 3] === atlas.data[ai + 3];
      if (!same) mismatch++;
      diff[si] = same ? 0 : 255;
      diff[si + 1] = 0;
      diff[si + 2] = same ? 0 : 255;
      diff[si + 3] = same ? 0 : 255;
    }
  }
  return { mismatch, diff };
}

async function compareOne(jsonFile, opts) {
  const meta = await readJson(jsonFile);
  const atlas = decodePng(await fs.readFile(path.join(path.dirname(jsonFile), meta.atlasImage)));
  let sprites = 0;
  let mismatches = 0;
  let diffFiles = 0;
  const errors = [];
  for (const key of Object.keys(meta.sprites).sort()) {
    sprites++;
    const s = meta.sprites[key];
    try {
      const source = decodePng(await fs.readFile(path.join(ROOT, s.sourcePath)));
      const result = pixelMismatch(atlas, source, s);
      if (result.mismatch > 0) {
        mismatches++;
        errors.push(`${meta.themeId}.${key}: ${result.mismatch} pixel mismatch(es)`);
        if (opts.writeDiffs) {
          await fs.mkdir(DIFF_ROOT, { recursive: true });
          const safeKey = key.replace(/[^a-z0-9_-]+/gi, '_');
          await fs.writeFile(path.join(DIFF_ROOT, `${meta.themeId}-${safeKey}.png`), encodePngRgba(source.width, source.height, result.diff));
          diffFiles++;
        }
      }
    } catch (err) {
      mismatches++;
      errors.push(`${meta.themeId}.${key}: ${err.message}`);
    }
  }
  return { themeId: meta.themeId, sprites, mismatches, diffFiles, errors };
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
  for (const file of jsonFiles) results.push(await compareOne(file, opts));
  const sprites = results.reduce((sum, r) => sum + r.sprites, 0);
  const mismatches = results.reduce((sum, r) => sum + r.mismatches, 0);
  const diffFiles = results.reduce((sum, r) => sum + r.diffFiles, 0);
  const errors = results.flatMap(r => r.errors);
  console.log(`[sprite-atlas-compare] atlases=${results.length} sprites=${sprites} mismatches=${mismatches} errors=${errors.length} diffFiles=${diffFiles}`);
  for (const r of results) console.log(`[sprite-atlas-compare] ${r.themeId}: ${r.sprites} sprite(s) ${r.mismatches === 0 ? 'OK' : 'MISMATCH'}`);
  for (const error of errors) console.error(`[sprite-atlas-compare] error: ${error}`);
  if (errors.length > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error(`[sprite-atlas-compare] ${err.message}`);
  process.exitCode = 1;
});
