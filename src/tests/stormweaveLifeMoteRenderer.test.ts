import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import {
  blendStormweaveMotePalettes,
  buildStormweaveMotePalette,
} from '../render/stormweaveLifeMoteRenderer';
import { getMoteTypeVisual } from '../sim/motes/moteTypeConfig';

test('buildStormweaveMotePalette produces a distinct palette per equippable mote type', () => {
  const palettes = EQUIPPABLE_KINDS.map((kind) => buildStormweaveMotePalette(kind));
  const bodyHexes = new Set(palettes.map((p) => p.bodyHex));
  const glowHexes = new Set(palettes.map((p) => p.glowInnerHex));
  const trailHexes = new Set(palettes.map((p) => p.trailMainHex));
  assert.equal(bodyHexes.size, EQUIPPABLE_KINDS.length, 'each kind must have a distinct body colour');
  assert.equal(glowHexes.size, EQUIPPABLE_KINDS.length, 'each kind must have a distinct glow colour');
  assert.equal(trailHexes.size, EQUIPPABLE_KINDS.length, 'each kind must have a distinct trail colour');
});

test('mote palettes blend smoothly between dust types', () => {
  const golden = buildStormweaveMotePalette(ParticleKind.Golden);
  const ice = buildStormweaveMotePalette(ParticleKind.Ice);
  assert.deepEqual(blendStormweaveMotePalettes(golden, ice, 0), golden);
  assert.deepEqual(blendStormweaveMotePalettes(golden, ice, 1), ice);
  const middle = blendStormweaveMotePalettes(golden, ice, 0.5);
  assert.notEqual(middle.bodyHex, golden.bodyHex);
  assert.notEqual(middle.bodyHex, ice.bodyHex);
  assert.notEqual(middle.trailMainHex, golden.trailMainHex);
  assert.notEqual(middle.trailMainHex, ice.trailMainHex);
});

test('Void Dust palette is dark purple/violet, not gold', () => {
  const palette = buildStormweaveMotePalette(ParticleKind.Void);
  assert.equal(palette.bodyHex, '#210033');
  assert.equal(palette.trailMainHex, '#210033');
  // Body must not resemble the legacy gold body colour.
  assert.notEqual(palette.bodyHex, '#ffd451');
});

test('unknown/internal particle kinds fall back to the Golden palette', () => {
  const fallback = buildStormweaveMotePalette(999);
  const golden = buildStormweaveMotePalette(ParticleKind.Golden);
  assert.deepEqual(fallback, golden);
});

test('shield crescent and center colours are derived from the selected type, not hardcoded gold', () => {
  for (const kind of EQUIPPABLE_KINDS) {
    const visual = getMoteTypeVisual(kind);
    const palette = buildStormweaveMotePalette(kind);
    assert.notEqual(palette.shieldCrescentCenterHex, '#ffe58a', `kind ${kind} must not stay gold`);
    // Center colour is exactly the type's glow colour.
    const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
    const expected = `#${toHex(visual.glow.r)}${toHex(visual.glow.g)}${toHex(visual.glow.b)}`;
    assert.equal(palette.shieldCrescentCenterHex, expected);
  }
});

test('shield impact flash retains a per-type tint rather than always being gold-white', () => {
  const impactHexes = new Set(EQUIPPABLE_KINDS.map((kind) => buildStormweaveMotePalette(kind).shieldImpactHex));
  assert.equal(impactHexes.size, EQUIPPABLE_KINDS.length, 'impact flash must differ per mote type');
});

test('canonical mote renderer source contains no hardcoded golden literals outside the fallback', () => {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../render/stormweaveLifeMoteRenderer.ts');
  const src = readFileSync(filePath, 'utf8');
  const goldLiterals = ['#ffd451', '#fff7c2', '#d77d12', '#f2b632', '#b75b08', '#e9a521', '#fff0a3', '#b87318', '#ffe58a', '#fffbd6'];
  for (const literal of goldLiterals) {
    assert.ok(!src.includes(literal), `legacy hardcoded gold literal ${literal} must be removed from the renderer`);
  }
});
