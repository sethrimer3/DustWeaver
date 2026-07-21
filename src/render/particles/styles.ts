/**
 * Per-element visual style. `STYLES`/`getParticleStyle()` here are used only
 * for the Fluid background particle (see renderer.ts) — ordinary gameplay
 * motes are NOT drawn from this table; they go through
 * `pixelLockedDustRenderer.ts` (Canvas fallback) or the WebGL shader
 * (`shaders.ts` → `kindColor()`).
 *
 * `KIND_COLOR_R/G/B` below feed the trail renderers (`trailRenderer.ts`,
 * `dustSwitchTrailRenderer.ts`).
 *
 * Where the centralized mote-type config (task section 7) actually lands, per
 * render path — all generated FROM `sim/motes/moteTypeConfig.ts` at module
 * load for the *equippable player mote* kinds (Golden, Ice, Nature, Void,
 * Light); internal/environmental kinds keep their bespoke hand-tuned values
 * everywhere:
 *   • trail   → `visual.trail`, synced into `KIND_COLOR_R/G/B` below.
 *   • body    → `visual.body`, synced into `pixelLockedDustRenderer.ts`'s
 *               Canvas tone ramp (darker tones) AND `shaders.ts`'s WebGL
 *               `kindColor()` literal — both renderers' actual body colour.
 *   • glow    → `visual.glow`, synced into `pixelLockedDustRenderer.ts`'s
 *               ramp as the glint/brightest accent tone. WebGL has no
 *               separate glow-colour slot; its "glow" is the additive-blend
 *               appearance of the body colour itself (see shaders.ts).
 *   • particle→ intentionally aliases `visual.body` for now: motes ARE the
 *               particles in this renderer architecture, so there is no
 *               independent spawned-effect-particle colour to wire yet. Kept
 *               as a distinct config field for a future dedicated FX spawner.
 * A regression test asserts each of these stays in sync (or, for `particle`,
 * intentionally equal to `body`) so this comment cannot silently go stale.
 */

import { ParticleKind } from '../../sim/particles/kinds';
import { getMoteTypeVisual, hasMoteTypeConfig } from '../../sim/motes/moteTypeConfig';

export interface ParticleStyle {
  colorHex: string;
  radiusPx: number;
}

// ---- Per-element colour palette (matches ELEMENT_COLORS in webglRenderer) -

const STYLES: ParticleStyle[] = [
  { colorHex: '#ffd700', radiusPx: 1 }, // Golden — bright golden yellow
  { colorHex: '#ff5500', radiusPx: 1 }, // Fire      — hot orange
  { colorHex: '#88ddff', radiusPx: 1 }, // Ice       — cool light blue
  { colorHex: '#ffff44', radiusPx: 1 }, // Lightning — electric yellow
  { colorHex: '#44ff44', radiusPx: 1 }, // Poison    — acid green
  { colorHex: '#cc44ff', radiusPx: 1 }, // Arcane    — violet
  { colorHex: '#88ffee', radiusPx: 1 }, // Wind      — pale cyan
  { colorHex: '#ffeeaa', radiusPx: 1 }, // Holy      — warm gold
  { colorHex: '#6633cc', radiusPx: 1 }, // Shadow    — deep purple
  { colorHex: '#aabbcc', radiusPx: 1 }, // Metal     — silver
  { colorHex: '#88662a', radiusPx: 1 }, // Earth     — warm brown
  { colorHex: '#44cc44', radiusPx: 1 }, // Nature    — vivid green
  { colorHex: '#aaeeff', radiusPx: 1 }, // Crystal   — icy bright blue
  { colorHex: '#220033', radiusPx: 1 }, // Void      — near-black purple
  { colorHex: '#88ccff', radiusPx: 3 }, // Fluid     — pale aqua-blue (background, keep larger)
  { colorHex: '#2299ee', radiusPx: 1 }, // Water     — deep flowing blue
  { colorHex: '#ff2200', radiusPx: 1.5 }, // Lava      — molten deep red-orange (slightly larger)
  { colorHex: '#888899', radiusPx: 1 }, // Stone     — cool grey
  { colorHex: '#ffd700', radiusPx: 1 }, // Gold      — bright golden yellow
  { colorHex: '#fffde0', radiusPx: 1.5 }, // Light   — radiant white-gold
];

const FALLBACK_STYLE: ParticleStyle = STYLES[0];

export function getParticleStyle(kind: number): ParticleStyle {
  return STYLES[kind] ?? FALLBACK_STYLE;
}

// ── Shared RGB float colour data ──────────────────────────────────────────────
//
// These typed arrays expose the same per-kind RGB values as kindColor() in
// shaders.ts as plain JavaScript floats, indexed by ParticleKind.
// Used by the WebGL trail renderer to avoid duplicating the colour table.
// Must stay in sync with kindColor() in shaders.ts whenever colours change.

/** Red component of each kind's neon colour (Float32, indexed by ParticleKind). */
export const KIND_COLOR_R = new Float32Array([
  1.00, // Golden — bright golden yellow
  1.00, // Fire      — hot orange
  0.53, // Ice       — cool blue
  1.00, // Lightning — electric yellow
  0.27, // Poison    — acid green
  0.80, // Arcane    — violet
  0.53, // Wind      — pale cyan
  1.00, // Holy      — warm gold
  0.40, // Shadow    — deep purple
  0.67, // Metal     — silver
  0.53, // Earth     — warm brown
  0.27, // Nature    — vivid green
  0.67, // Crystal   — icy bright blue
  0.13, // Void      — near-black purple
  0.55, // Fluid     — pale aqua-blue
  0.13, // Water     — deep flowing blue
  1.00, // Lava      — deep molten red-orange
  0.53, // Stone     — cool grey
  1.00, // Gold      — bright golden yellow
  1.00, // Light     — radiant white-gold
]);

/** Green component of each kind's neon colour (Float32, indexed by ParticleKind). */
export const KIND_COLOR_G = new Float32Array([
  0.84, // Golden
  0.33, // Fire
  0.87, // Ice
  1.00, // Lightning
  1.00, // Poison
  0.27, // Arcane
  1.00, // Wind
  0.93, // Holy
  0.20, // Shadow
  0.73, // Metal
  0.40, // Earth
  0.80, // Nature
  0.93, // Crystal
  0.00, // Void
  0.80, // Fluid
  0.60, // Water
  0.13, // Lava
  0.53, // Stone
  0.84, // Gold
  0.99, // Light
]);

/** Blue component of each kind's neon colour (Float32, indexed by ParticleKind). */
export const KIND_COLOR_B = new Float32Array([
  0.00, // Golden
  0.00, // Fire
  1.00, // Ice
  0.27, // Lightning
  0.27, // Poison
  1.00, // Arcane
  0.93, // Wind
  0.67, // Holy
  0.80, // Shadow
  0.80, // Metal
  0.16, // Earth
  0.27, // Nature
  1.00, // Crystal
  0.20, // Void
  1.00, // Fluid
  0.93, // Water
  0.00, // Lava
  0.60, // Stone
  0.00, // Gold
  0.88, // Light
]);

// ── Sync equippable player-mote colours from the centralized config ──────────
//
// For each equippable player mote type that declares an explicit config, the
// authoritative body/trail colour comes from `moteTypeConfig.ts`. We copy it
// into the per-channel tables (and the Canvas hex styles) at module load so the
// renderer's mote body, glow, trail, and particle colours all follow the
// selected mote type from a single source. Internal / environmental kinds are
// untouched. The regression test asserts these stay numerically identical to
// the legacy hand-authored values, so this is a consolidation, not a recolour.

for (const kind of [
  ParticleKind.Golden,
  ParticleKind.Ice,
  ParticleKind.Nature,
  ParticleKind.Void,
  ParticleKind.Light,
]) {
  if (!hasMoteTypeConfig(kind)) continue;
  const trail = getMoteTypeVisual(kind).trail;
  KIND_COLOR_R[kind] = trail.r;
  KIND_COLOR_G[kind] = trail.g;
  KIND_COLOR_B[kind] = trail.b;
}
