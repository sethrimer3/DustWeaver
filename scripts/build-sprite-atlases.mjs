#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePngRgba, hashBuffer, spriteKeyFromRelativePath } from './sprite-atlas-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'ASSETS', 'DERIVED', 'SPRITE_ATLASES');
const BLOCKS_ROOT = path.join(ROOT, 'ASSETS', 'SPRITES', 'BLOCKS');
const SPECIAL_ROOT = path.join(ROOT, 'ASSETS', 'SPRITES', 'specialBLOCKS');
const SYSTEM_FOLDERS = new Set(['block_templates']);
const SPECIAL_WALL_THEMES = new Set(['iceBlock', 'ultraIceBlock']);
const IMAGE_EXT_RE = /\.png$/i;

function parseArgs(argv) {
  const opts = { dryRun: false, force: false, deterministic: false, theme: null, padding: 2 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--deterministic') opts.deterministic = true;
    else if (arg === '--theme') opts.theme = argv[++i] ?? null;
    else if (arg === '--padding') opts.padding = Number(argv[++i] ?? '2');
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(opts.padding) || opts.padding < 0) throw new Error('--padding must be a non-negative integer');
  return opts;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

async function listThemeSprites(root, themeId) {
  const dir = path.join(root, themeId);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue;
    if (!IMAGE_EXT_RE.test(entry.name)) continue;
    files.push(path.join(dir, entry.name));
  }
  return files;
}

async function discoverThemes() {
  const themes = [];
  const blockDirs = await fs.readdir(BLOCKS_ROOT, { withFileTypes: true });
  for (const entry of blockDirs.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (/^\d/.test(entry.name) || SYSTEM_FOLDERS.has(entry.name)) continue;
    const files = await listThemeSprites(BLOCKS_ROOT, entry.name);
    if (files.length > 0) themes.push({ id: entry.name, sourceRoot: path.join(BLOCKS_ROOT, entry.name), files });
  }
  const specialDirs = await fs.readdir(SPECIAL_ROOT, { withFileTypes: true });
  for (const entry of specialDirs.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !SPECIAL_WALL_THEMES.has(entry.name)) continue;
    const allFiles = await listThemeSprites(SPECIAL_ROOT, entry.name);
    const files = allFiles.filter(file => path.basename(file).startsWith(entry.name));
    if (files.length > 0) themes.push({ id: entry.name, sourceRoot: path.join(SPECIAL_ROOT, entry.name), files });
  }
  return themes.sort((a, b) => a.id.localeCompare(b.id));
}

function packSprites(sprites, padding) {
  const sorted = [...sprites].sort((a, b) => a.key.localeCompare(b.key));
  const maxW = Math.max(...sorted.map(s => s.w), 1);
  const totalArea = sorted.reduce((sum, s) => sum + (s.w + padding) * (s.h + padding), 0);
  let width = 1;
  while (width < Math.max(maxW, Math.ceil(Math.sqrt(totalArea)))) width *= 2;
  width = Math.max(width, 32);
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const sprite of sorted) {
    if (x > 0 && x + sprite.w > width) {
      x = 0;
      y += rowH + padding;
      rowH = 0;
    }
    sprite.x = x;
    sprite.y = y;
    x += sprite.w + padding;
    rowH = Math.max(rowH, sprite.h);
  }
  let height = 1;
  while (height < y + rowH) height *= 2;
  return { width, height, sprites: sorted };
}

function blit(dst, dstW, src, sx, sy) {
  for (let y = 0; y < src.height; y++) {
    const srcStart = y * src.width * 4;
    const dstStart = ((sy + y) * dstW + sx) * 4;
    src.data.copy(dst, dstStart, srcStart, srcStart + src.width * 4);
  }
}

async function writeReadme(opts) {
  const text = [
    '# Sprite Atlases',
    '',
    'This folder contains derived sprite atlas outputs generated from source sprites under `ASSETS/SPRITES/`.',
    'These files are safe to regenerate. Do not hand-edit atlas PNG or JSON files.',
    '',
    'Runtime rendering does not depend on these atlases by default. Atlas usage is experimental and opt-in only.',
    '',
    'Commands:',
    '',
    '```bash',
    'npm run build:atlases -- --deterministic',
    'npm run validate:atlases -- --strict',
    'npm run compare:atlases',
    'npm run preview:atlases',
    '```',
    '',
  ].join('\n');
  if (!opts.dryRun) {
    await fs.mkdir(OUT_ROOT, { recursive: true });
    await fs.writeFile(path.join(OUT_ROOT, 'README.md'), text);
  }
}

async function buildTheme(theme, opts) {
  const outPng = path.join(OUT_ROOT, `${theme.id}.png`);
  const outJson = path.join(OUT_ROOT, `${theme.id}.json`);
  const exists = await fs.stat(outPng).then(() => true, () => false);
  if (exists && !opts.force) {
    console.log(`[sprite-atlas] ${theme.id}: skipped (output exists; pass --force to overwrite)`);
    return { generated: false, warnings: [] };
  }
  const warnings = [];
  const seenKeys = new Set();
  const sprites = [];
  for (const file of theme.files.sort((a, b) => rel(a).localeCompare(rel(b)))) {
    const relative = path.relative(theme.sourceRoot, file).replace(/\\/g, '/');
    const key = spriteKeyFromRelativePath(relative);
    if (seenKeys.has(key)) warnings.push(`${theme.id}: duplicate sprite key ${key}`);
    seenKeys.add(key);
    let decoded;
    const buffer = await fs.readFile(file);
    try {
      decoded = decodePng(buffer);
    } catch (err) {
      warnings.push(`${theme.id}: could not decode ${rel(file)}: ${err.message}`);
      continue;
    }
    sprites.push({ key, sourcePath: rel(file), hash: hashBuffer(buffer), w: decoded.width, h: decoded.height, decoded });
  }
  if (sprites.length === 0) {
    warnings.push(`${theme.id}: no decodable PNG sprites`);
    return { generated: false, warnings };
  }
  const packed = packSprites(sprites, opts.padding);
  const atlas = Buffer.alloc(packed.width * packed.height * 4);
  for (const sprite of packed.sprites) blit(atlas, packed.width, sprite.decoded, sprite.x, sprite.y);
  const spriteMeta = {};
  for (const sprite of packed.sprites.sort((a, b) => a.key.localeCompare(b.key))) {
    spriteMeta[sprite.key] = {
      x: sprite.x,
      y: sprite.y,
      w: sprite.w,
      h: sprite.h,
      sourcePath: sprite.sourcePath,
      sourceHash: sprite.hash,
    };
  }
  const meta = {
    version: 1,
    themeId: theme.id,
    sourceRoot: rel(theme.sourceRoot),
    atlasImage: `${theme.id}.png`,
    generatedAt: opts.deterministic ? '1970-01-01T00:00:00.000Z' : new Date().toISOString(),
    padding: opts.padding,
    width: packed.width,
    height: packed.height,
    sprites: spriteMeta,
  };
  if (opts.dryRun) {
    console.log(`[sprite-atlas] ${theme.id}: would generate ${rel(outPng)} (${packed.width}x${packed.height}, ${sprites.length} sprites)`);
  } else {
    await fs.mkdir(OUT_ROOT, { recursive: true });
    await fs.writeFile(outPng, encodePngRgba(packed.width, packed.height, atlas));
    await fs.writeFile(outJson, `${JSON.stringify(meta, null, 2)}\n`);
    console.log(`[sprite-atlas] ${theme.id}: generated ${rel(outPng)} and ${rel(outJson)} (${sprites.length} sprite(s))`);
  }
  return { generated: true, warnings };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const themes = (await discoverThemes()).filter(t => opts.theme === null || t.id === opts.theme);
  if (themes.length === 0) throw new Error(opts.theme ? `No eligible sprites found for theme ${opts.theme}` : 'No eligible sprites found');
  console.log(`[sprite-atlas] Scanned ${themes.length} theme folder(s).`);
  let generated = 0;
  const warnings = [];
  for (const theme of themes) {
    const result = await buildTheme(theme, opts);
    if (result.generated) generated++;
    warnings.push(...result.warnings);
  }
  await writeReadme(opts);
  for (const warning of warnings) console.warn(`[sprite-atlas] warning: ${warning}`);
  console.log(`[sprite-atlas] Done. generated=${generated} warnings=${warnings.length}`);
}

main().catch(err => {
  console.error(`[sprite-atlas] ${err.message}`);
  process.exitCode = 1;
});
