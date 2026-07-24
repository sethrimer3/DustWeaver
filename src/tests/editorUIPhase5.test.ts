import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  toggleAccessibleName, toggleSig, computeCollapseHeaderPresentation,
} from '../editor/editorUILayersPanel';
import type { EditorLayerState } from '../editor/editorLayers';
import {
  computeDensityDisplaySignature, capitalizeSeverity, formatDensityTotalLine, formatDensitySuffixLine,
} from '../editor/editorDensityIndicatorFormat';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function layer(overrides: Partial<EditorLayerState> = {}): EditorLayerState {
  return { visible: true, locked: false, solo: false, selectOnly: false, ...overrides };
}

// ── Layer panel: accessible names / aria-pressed source values ─────────────

test('toggleAccessibleName: includes the layer name and current on/off state, not just an icon', () => {
  const name = toggleAccessibleName('Toggle visibility', 'Powder / Dust Motes', true);
  assert.ok(name.includes('Powder / Dust Motes'));
  assert.ok(name.includes('on'));
  assert.equal(toggleAccessibleName('Toggle visibility', 'Terrain', false).includes('off'), true);
});

test('toggleSig: distinguishes every combination of the 4 toggle bits (aria-pressed source of truth)', () => {
  const sigs = new Set<string>();
  for (const visible of [true, false]) {
    for (const locked of [true, false]) {
      for (const solo of [true, false]) {
        for (const selectOnly of [true, false]) {
          sigs.add(toggleSig(layer({ visible, locked, solo, selectOnly })));
        }
      }
    }
  }
  assert.equal(sigs.size, 16, 'expected all 16 combinations to produce distinct signatures');
});

test('toggleSig: identical state produces an identical signature (no spurious DOM/aria-pressed rewrite)', () => {
  const a = toggleSig(layer({ visible: true, locked: false, solo: true, selectOnly: false }));
  const b = toggleSig(layer({ visible: true, locked: false, solo: true, selectOnly: false }));
  assert.equal(a, b);
});

// ── Collapse header: aria-expanded ──────────────────────────────────────────

test('computeCollapseHeaderPresentation: expanded state exposes aria-expanded="true"', () => {
  const p = computeCollapseHeaderPresentation(false);
  assert.equal(p.ariaExpanded, 'true');
  assert.equal(p.indicatorText, '▾');
  assert.equal(p.rowsDisplay, 'block');
});

test('computeCollapseHeaderPresentation: collapsed state exposes aria-expanded="false"', () => {
  const p = computeCollapseHeaderPresentation(true);
  assert.equal(p.ariaExpanded, 'false');
  assert.equal(p.indicatorText, '▸');
  assert.equal(p.rowsDisplay, 'none');
});

// ── Density indicator: structural/value signature gating ───────────────────

test('computeDensityDisplaySignature: identical values -> identical signature (no rebuild)', () => {
  const a = computeDensityDisplaySignature(true, 42, 'elevated', 'Terrain');
  const b = computeDensityDisplaySignature(true, 42, 'elevated', 'Terrain');
  assert.equal(a, b);
});

test('computeDensityDisplaySignature: any changed value -> different signature (rebuild required)', () => {
  const base = computeDensityDisplaySignature(true, 42, 'elevated', 'Terrain');
  assert.notEqual(computeDensityDisplaySignature(true, 43, 'elevated', 'Terrain'), base);
  assert.notEqual(computeDensityDisplaySignature(true, 42, 'high', 'Terrain'), base);
  assert.notEqual(computeDensityDisplaySignature(true, 42, 'elevated', 'Enemies'), base);
});

test('computeDensityDisplaySignature: no room collapses to the empty signature regardless of stale values', () => {
  assert.equal(computeDensityDisplaySignature(false, 999, 'extreme', 'Hazards'), '');
});

test('formatting helpers produce plain text (no markup) suitable for textContent', () => {
  assert.equal(capitalizeSeverity('elevated'), 'Elevated');
  assert.equal(formatDensityTotalLine(1234), 'Room density: 1,234 elements');
  assert.ok(!formatDensityTotalLine(5).includes('<'));
  assert.equal(formatDensitySuffixLine('Terrain'), ' — mostly Terrain');
  assert.ok(!formatDensitySuffixLine('Terrain').includes('<'));
});

// ── Campaign title: source-level regression guard ───────────────────────────
//
// editorUI.ts can't be imported under Node (it uses Vite's import.meta.env),
// and this project has no DOM/jsdom test harness (see other test files' doc
// comments on this constraint), so real DOM output can't be asserted here.
// This is a source-level guard against the specific fix regressing: the
// campaign title must never be assigned via innerHTML again.
test('campaign title is built via textContent/DOM nodes, not innerHTML (prevents markup injection)', () => {
  const source = readFileSync(path.join(__dirname, '../editor/editorUI.ts'), 'utf8');
  const titleSection = source.slice(source.indexOf('// ── Title'), source.indexOf('// ── Confirm / Cancel bar'));
  assert.ok(!/\.innerHTML/.test(titleSection), 'expected the title-building section to contain no innerHTML assignment');
  assert.ok(/subtitle\.textContent\s*=\s*campaignTitle/.test(titleSection), 'expected campaignTitle to be assigned via textContent, not interpolated into markup');
});
