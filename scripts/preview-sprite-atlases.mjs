#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ATLAS_ROOT = path.join(ROOT, 'ASSETS', 'DERIVED', 'SPRITE_ATLASES');
const PREVIEW_ROOT = path.join(ATLAS_ROOT, '_PREVIEW');

function esc(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function main() {
  const entries = await fs.readdir(ATLAS_ROOT, { withFileTypes: true }).catch(() => []);
  const jsonFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => path.join(ATLAS_ROOT, e.name)).sort();
  if (jsonFiles.length === 0) throw new Error('No atlas JSON files found');
  const sections = [];
  for (const file of jsonFiles) {
    const meta = JSON.parse(await fs.readFile(file, 'utf8'));
    const spriteCount = Object.keys(meta.sprites ?? {}).length;
    sections.push(`
      <section>
        <h2>${esc(meta.themeId)}</h2>
        <p>${spriteCount} sprites, ${esc(meta.width)}x${esc(meta.height)}, source: <code>${esc(meta.sourceRoot)}</code></p>
        <img src="../${encodeURIComponent(meta.atlasImage)}" alt="${esc(meta.themeId)} atlas">
        <details>
          <summary>Sprites</summary>
          <ul>${Object.keys(meta.sprites ?? {}).sort().map(key => {
            const s = meta.sprites[key];
            return `<li><code>${esc(key)}</code> ${s.w}x${s.h} at ${s.x},${s.y}</li>`;
          }).join('')}</ul>
        </details>
      </section>`);
  }
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DustWeaver Sprite Atlas Preview</title>
  <style>
    body { margin: 24px; background: #14110d; color: #ead7a2; font-family: system-ui, sans-serif; }
    h1 { font-size: 24px; }
    section { border-top: 1px solid rgba(234,215,162,.25); padding: 18px 0 24px; }
    h2 { margin: 0 0 6px; font-size: 18px; }
    p { margin: 0 0 12px; color: rgba(234,215,162,.75); }
    img { image-rendering: pixelated; background: repeating-conic-gradient(#222 0 25%, #333 0 50%) 0 / 16px 16px; border: 1px solid rgba(234,215,162,.25); max-width: 100%; }
    code { color: #fff0bd; }
    li { margin: 3px 0; }
  </style>
</head>
<body>
  <h1>DustWeaver Sprite Atlas Preview</h1>
  <p>Derived developer preview. Runtime rendering is not enabled by default.</p>
  ${sections.join('\n')}
</body>
</html>
`;
  await fs.mkdir(PREVIEW_ROOT, { recursive: true });
  const out = path.join(PREVIEW_ROOT, 'index.html');
  await fs.writeFile(out, html);
  console.log(`[sprite-atlas-preview] generated ${path.relative(ROOT, out).replace(/\\/g, '/')}`);
}

main().catch(err => {
  console.error(`[sprite-atlas-preview] ${err.message}`);
  process.exitCode = 1;
});
