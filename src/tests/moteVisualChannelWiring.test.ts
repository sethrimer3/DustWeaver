import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import { getMoteTypeVisual, shadeRgb, rgbToHex } from '../sim/motes/moteTypeConfig';
import { getParticleStyle, KIND_COLOR_R, KIND_COLOR_G, KIND_COLOR_B } from '../render/particles/styles';

const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-4, `${msg} (${a} vs ${b})`);

test('shadeRgb scales channels and clamps to [0,1]', () => {
  const s = shadeRgb({ r: 1, g: 0.5, b: 0 }, 0.5);
  assert.deepEqual(s, { r: 0.5, g: 0.25, b: 0 });
  const clamped = shadeRgb({ r: 0.9, g: 0.9, b: 0.9 }, 2.0);
  assert.deepEqual(clamped, { r: 1, g: 1, b: 1 });
});

test('rgbToHex formats an RGB triple as a 6-digit hex string', () => {
  assert.equal(rgbToHex({ r: 1, g: 0.84, b: 0 }), '#ffd600');
  assert.equal(rgbToHex({ r: 0, g: 0, b: 0 }), '#000000');
  assert.equal(rgbToHex({ r: 1, g: 1, b: 1 }), '#ffffff');
});

// ── Trail channel (already established in an earlier stage; re-asserted here
// as part of the full per-channel audit) ────────────────────────────────────

test('trail colour stays in sync with the centralized config for every equippable kind', () => {
  for (const kind of EQUIPPABLE_KINDS) {
    const trail = getMoteTypeVisual(kind).trail;
    near(KIND_COLOR_R[kind], trail.r, `R drift for kind ${kind}`);
    near(KIND_COLOR_G[kind], trail.g, `G drift for kind ${kind}`);
    near(KIND_COLOR_B[kind], trail.b, `B drift for kind ${kind}`);
  }
});

// ── particle channel: documented as an intentional alias of body ───────────

test('particle colour intentionally equals body for every mote type (documented alias, not drift)', () => {
  for (const kind of EQUIPPABLE_KINDS) {
    const visual = getMoteTypeVisual(kind);
    assert.deepEqual(visual.particle, visual.body, `kind ${kind}: particle must equal body`);
  }
});

// ── body + glow channels: genuinely wired through render paths ─────────────
// (dynamically import the renderer modules that generate their tables from
// moteTypeConfig at module load, so this test independently re-derives the
// expected values with the SAME pure helpers and compares against what those
// modules actually produced.)

test('Canvas pixel-locked dust renderer\'s body/glint tone ramp is generated from body/glow, per equippable kind', async () => {
  const { getMotePaletteRampForTesting } = await import('../render/particles/pixelLockedDustRenderer');
  for (const kind of EQUIPPABLE_KINDS) {
    const visual = getMoteTypeVisual(kind);
    const ramp = getMotePaletteRampForTesting(kind);
    assert.equal(ramp.length, 4, `kind ${kind}: ramp must keep the 4-tone dithering structure`);
    assert.equal(ramp[0], rgbToHex(shadeRgb(visual.body, 0.42)), `kind ${kind}: darkest tone generated from body`);
    assert.equal(ramp[1], rgbToHex(shadeRgb(visual.body, 0.72)), `kind ${kind}: mid tone generated from body`);
    assert.equal(ramp[2], rgbToHex(visual.body), `kind ${kind}: base tone equals body exactly`);
    assert.equal(ramp[3], rgbToHex(visual.glow), `kind ${kind}: glint tone generated from glow`);
  }
});

test('WebGL shader source embeds a body-colour literal generated from the centralized config for every equippable kind', async () => {
  const { PARTICLE_FRAGMENT_SHADER_SRC } = await import('../render/particles/shaders');
  const toGlslLiteral = (kind: ParticleKind) => {
    const body = getMoteTypeVisual(kind).body;
    const fmt = (v: number) => Math.max(0, Math.min(1, v)).toFixed(2);
    return `vec3(${fmt(body.r)}, ${fmt(body.g)}, ${fmt(body.b)})`;
  };
  // Ice (ki==2), Nature (ki==11), Void (ki==13), Light (ki==19) each get an
  // explicit branch; Golden has no explicit branch and instead falls through
  // to the trailing default return — check both forms are present.
  assert.ok(PARTICLE_FRAGMENT_SHADER_SRC.includes(`if (ki == 2)  return ${toGlslLiteral(ParticleKind.Ice)};`), 'Ice body literal generated from config');
  assert.ok(PARTICLE_FRAGMENT_SHADER_SRC.includes(`if (ki == 11) return ${toGlslLiteral(ParticleKind.Nature)};`), 'Nature body literal generated from config');
  assert.ok(PARTICLE_FRAGMENT_SHADER_SRC.includes(`if (ki == 13) return ${toGlslLiteral(ParticleKind.Void)};`), 'Void body literal generated from config');
  assert.ok(PARTICLE_FRAGMENT_SHADER_SRC.includes(`if (ki == 19) return ${toGlslLiteral(ParticleKind.Light)};`), 'Light body literal generated from config');
  assert.ok(PARTICLE_FRAGMENT_SHADER_SRC.includes(`if (ki == 20) return ${toGlslLiteral(ParticleKind.FireDust)};`), 'FireDust body literal generated from config');
  assert.ok(PARTICLE_FRAGMENT_SHADER_SRC.includes(`return ${toGlslLiteral(ParticleKind.Golden)};`), 'Golden (default-fallback) body literal generated from config');
});

test('internal/environmental kinds keep their bespoke Canvas palette (unaffected by the equippable-kind sync)', () => {
  // Fire (kind 1) is not equippable and must be untouched.
  assert.equal(getParticleStyle(ParticleKind.Fire).colorHex, '#ff5500');
});
