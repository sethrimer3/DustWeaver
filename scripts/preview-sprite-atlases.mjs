#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ATLAS_ROOT = path.join(ROOT, 'ASSETS', 'DERIVED', 'SPRITE_ATLASES');
const PREVIEW_ROOT = path.join(ATLAS_ROOT, '_PREVIEW');

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function rel(from, to) {
  return toPosixPath(path.relative(from, to));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function atlasJsonFiles() {
  const entries = await fs.readdir(ATLAS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(ATLAS_ROOT, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function readAtlas(jsonPath) {
  const metadata = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  const spriteCount = metadata.sprites && typeof metadata.sprites === 'object'
    ? Object.keys(metadata.sprites).length
    : 0;
  return {
    themeId: metadata.themeId ?? path.basename(jsonPath, '.json'),
    atlasImage: metadata.atlasImage,
    sourceRoot: metadata.sourceRoot ?? '',
    generatedAt: metadata.generatedAt ?? '',
    width: metadata.width ?? '',
    height: metadata.height ?? '',
    padding: metadata.padding ?? '',
    spriteCount,
    imageRel: rel(PREVIEW_ROOT, path.join(ATLAS_ROOT, metadata.atlasImage ?? '')),
  };
}

async function main() {
  const files = await atlasJsonFiles();
  if (files.length === 0) throw new Error('No atlas JSON files found.');

  const atlases = [];
  for (const file of files) atlases.push(await readAtlas(file));

  await fs.mkdir(PREVIEW_ROOT, { recursive: true });
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>DustWeaver Sprite Atlas Preview</title>',
    '<style>',
    'body{margin:24px;font-family:Segoe UI,Arial,sans-serif;background:#191816;color:#f3efe4}',
    'h1{font-size:24px;margin:0 0 16px}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}',
    '.atlas{border:1px solid #514c43;border-radius:6px;padding:12px;background:#24221f}',
    '.meta{font-size:12px;line-height:1.5;color:#cfc6b5;margin:0 0 10px}',
    '.sheet{image-rendering:pixelated;max-width:100%;height:auto;background:#111;border:1px solid #38342e}',
    'code{color:#e9c46a}',
    '</style>',
    '</head>',
    '<body>',
    '<h1>DustWeaver Sprite Atlas Preview</h1>',
    `<p class="meta">${atlases.length} atlas file(s). Derived inspection output only; runtime rendering does not use these atlases yet.</p>`,
    '<main class="grid">',
    ...atlases.map((atlas) => [
      '<section class="atlas">',
      `<h2>${escapeHtml(atlas.themeId)}</h2>`,
      '<p class="meta">',
      `sprites: <code>${escapeHtml(atlas.spriteCount)}</code><br>`,
      `size: <code>${escapeHtml(atlas.width)}x${escapeHtml(atlas.height)}</code><br>`,
      `padding: <code>${escapeHtml(atlas.padding)}</code><br>`,
      `source: <code>${escapeHtml(atlas.sourceRoot)}</code><br>`,
      `generated: <code>${escapeHtml(atlas.generatedAt)}</code>`,
      '</p>',
      `<img class="sheet" src="${escapeHtml(atlas.imageRel)}" alt="${escapeHtml(atlas.themeId)} atlas">`,
      '</section>',
    ].join('\n')),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  const outputPath = path.join(PREVIEW_ROOT, 'index.html');
  await fs.writeFile(outputPath, html);
  console.log(`[sprite-atlas-preview] Wrote ${toPosixPath(path.relative(ROOT, outputPath))}`);
}

main().catch((err) => {
  console.error(`[sprite-atlas-preview] ${err.message}`);
  process.exitCode = 1;
});
