import test from 'node:test';
import assert from 'node:assert/strict';

import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import {
  getMoteTypeConfig,
  getMoteTypeVisual,
  getMoteTypeProjectile,
  hasMoteTypeConfig,
  DEFAULT_MOTE_TYPE,
  GOLD_DUST_OUTBOUND_SPEED_PX_PER_SEC,
  GOLD_DUST_MAX_TRAVEL_PX,
} from '../sim/motes/moteTypeConfig';
import { KIND_COLOR_R, KIND_COLOR_G, KIND_COLOR_B } from '../render/particles/styles';

test('Gold Dust is the default mote type and keeps the gold aesthetic', () => {
  assert.equal(DEFAULT_MOTE_TYPE, ParticleKind.Golden);
  const gold = getMoteTypeConfig(ParticleKind.Golden);
  assert.equal(gold.name, 'Gold Dust');
  // Gold body/trail hue.
  assert.deepEqual(gold.visual.body, { r: 1.0, g: 0.84, b: 0.0 });
  assert.deepEqual(gold.visual.trail, { r: 1.0, g: 0.84, b: 0.0 });
});

test('Gold Dust projectile uses the section 7 defaults', () => {
  const proj = getMoteTypeProjectile(ParticleKind.Golden);
  assert.equal(proj.outboundSpeedPxPerSec, 250);
  assert.equal(proj.maxTravelPx, 250);
  assert.equal(proj.outboundSpeedPxPerSec, GOLD_DUST_OUTBOUND_SPEED_PX_PER_SEC);
  assert.equal(proj.maxTravelPx, GOLD_DUST_MAX_TRAVEL_PX);
  assert.equal(proj.homing, false);
  assert.equal(proj.piercing, false);
});

test('every equippable player mote type has an explicit config', () => {
  for (const kind of EQUIPPABLE_KINDS) {
    assert.ok(hasMoteTypeConfig(kind), `missing config for kind ${kind}`);
  }
});

test('unknown / internal kinds fall back to the default (Gold Dust) config', () => {
  assert.equal(hasMoteTypeConfig(ParticleKind.Lava), false);
  const cfg = getMoteTypeConfig(ParticleKind.Lava);
  assert.equal(cfg.kind, ParticleKind.Golden);
});

test('trail colour follows the selected mote type (body hue == trail hue)', () => {
  for (const kind of EQUIPPABLE_KINDS) {
    const v = getMoteTypeVisual(kind);
    assert.deepEqual(v.trail, v.body, `trail hue drifted from body for kind ${kind}`);
  }
});

test('renderer colour tables stay in sync with the centralized config', () => {
  // The scattered KIND_COLOR_* tables are now sourced from moteTypeConfig for
  // equippable player kinds; assert they match so the two never drift apart.
  // KIND_COLOR_* are Float32Array, so compare within single-precision epsilon.
  const near = (a: number, b: number, msg: string) =>
    assert.ok(Math.abs(a - b) < 1e-4, `${msg} (${a} vs ${b})`);
  for (const kind of EQUIPPABLE_KINDS) {
    const trail = getMoteTypeVisual(kind).trail;
    near(KIND_COLOR_R[kind], trail.r, `R drift for kind ${kind}`);
    near(KIND_COLOR_G[kind], trail.g, `G drift for kind ${kind}`);
    near(KIND_COLOR_B[kind], trail.b, `B drift for kind ${kind}`);
  }
});
