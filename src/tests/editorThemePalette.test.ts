import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as editorStyles from '../editor/editorStyles';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = join(__dirname, '..', 'editor');

// Files that legitimately use greenish colors for gameplay/room-content
// markers (springboards, ramps, transitions, decorations, grasshopper
// enemy areas, etc.) rather than editor chrome, so they are excluded from
// the sweep below.
const CONTENT_COLOR_FILES = new Set([
  'editorRendererHelpers.ts',
  'editorOverlayDrawers.ts',
  'editorPalettePreview.ts',
  'editorUIHelpers.ts',
  'editorZoneDrawers.ts',
]);

const OBSOLETE_GREEN_LITERALS = [
  '#00c864',
  '#c0ffd0',
  '#44cc88',
  '#88ff88',
  'rgba(0,200,100',
  'rgba(0,100,50',
  'rgba(0,80,60',
  'rgba(200,255,200',
];

test('editorStyles exposes the navy/gold theme palette, not the legacy green tokens', () => {
  assert.equal((editorStyles as Record<string, unknown>).GREEN, undefined,
    'GREEN was renamed to ACCENT_GOLD; a reintroduced GREEN export means the old token crept back in');
  assert.match(editorStyles.ACCENT_GOLD, /^#[0-9a-f]{6}$/i);
  assert.match(editorStyles.ACCENT_GOLD_BRIGHT, /^#[0-9a-f]{6}$/i);
  assert.match(editorStyles.TEXT_COLOR, /^#[0-9a-f]{6}$/i);
  assert.match(editorStyles.PANEL_BG_SOLID, /^#[0-9a-f]{6}$/i);
});

test('editor UI modules do not reintroduce obsolete primary-green chrome literals', () => {
  const offenders: string[] = [];
  for (const fileName of readdirSync(EDITOR_DIR)) {
    if (!fileName.endsWith('.ts') || CONTENT_COLOR_FILES.has(fileName)) continue;
    const contents = readFileSync(join(EDITOR_DIR, fileName), 'utf8');
    for (const literal of OBSOLETE_GREEN_LITERALS) {
      if (contents.includes(literal)) {
        offenders.push(`${fileName}: ${literal}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'obsolete green editor-chrome literals found');
});
