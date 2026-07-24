/**
 * pixelLockedDustRenderer.ts — Pixel-Locked Prismatic Dust renderer.
 *
 * Renders gameplay-relevant dust particles as crisp, grid-snapped motes on the
 * 480×270 virtual canvas.  Physics remain subpixel-smooth; only the *rendered*
 * position snaps to integer virtual-canvas coordinates.  The particle's hidden
 * fractional position (fracX/fracY) plus its stable per-lifetime noiseTickSeed
 * drive a tone-index selection over a small quantized palette ramp, giving each
 * mote a subtle, physically-grounded shimmer without random per-frame flicker.
 *
 * Visual contract:
 *  - 1×1 fillRect for normal/shield motes (behaviorMode 0, 2)
 *  - 2×2 multi-tone fillRect cluster for attack motes (behaviorMode 1)
 *  - Optional single-pixel glint for shimmery dust kinds (Gold, Crystal,
 *    Ice, Holy, Light, Metal, Golden)
 *  - imageSmoothingEnabled must be false on the receiving canvas context
 *
 * Excluded kinds (handled elsewhere):
 *  - ParticleKind.Fluid (14) — stays in WebGL for background disturbance glow
 *  - Particles with behaviorMode === BEHAVIOR_MODE_GRAPPLE_CHAIN (3) —
 *    handled by grappleRenderer.ts
 */

import type { WorldSnapshot } from '../snapshot';
import { ParticleKind } from '../../sim/particles/kinds';
import { BEHAVIOR_MODE_GRAPPLE_CHAIN } from '../../sim/clusters/grappleShared';
import { isDustSwitchBehaviorMode } from '../../sim/particles/dustSwitchBehaviorMode';
import { getMoteTypeVisual, hasMoteTypeConfig, shadeRgb, rgbToHex } from '../../sim/motes/moteTypeConfig';
import type { EditorRenderMask } from '../../editor/editorRenderMask';
import { isLayerVisibleInMask } from '../../editor/editorRenderMask';
import { getLayerForParticleKind } from '../../editor/editorParticleLayers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Particles with computed alpha below this are skipped. */
const MIN_VISIBLE_ALPHA = 0.004;

/**
 * ageFade threshold above which a glint pixel is drawn for shimmery kinds.
 * A value of 0.55 means the glint only appears during the first 45% of the
 * particle's life (near spawn / peak brightness), fading before death.
 * Increase toward 1.0 to show glint for longer; decrease toward 0.0 to limit
 * it to the very start of a particle's life.
 */
const GLINT_AGE_THRESHOLD = 0.55;

/**
 * Kinds that get an optional glint pixel on the virtual canvas.
 * This is a bitmask over ParticleKind values (kind < 32 so a plain number works).
 */
const GLINT_KIND_MASK = (
  (1 << ParticleKind.Golden) |
  (1 << ParticleKind.Ice)      |
  (1 << ParticleKind.Holy)     |
  (1 << ParticleKind.Metal)    |
  (1 << ParticleKind.Crystal)  |
  (1 << ParticleKind.Gold)     |
  (1 << ParticleKind.Light)
);

// ---------------------------------------------------------------------------
// Tone-selection tuning constants
// ---------------------------------------------------------------------------

/**
 * Weight applied to the particle's intra-pixel horizontal offset (fracX)
 * when computing the subpixel tone phase.  Adjust to shift how much
 * left/right position contributes to palette selection.
 */
const TONE_WEIGHT_X = 0.55;
/**
 * Weight applied to the particle's intra-pixel vertical offset (fracY).
 * Together with TONE_WEIGHT_X the two weights need not sum to 1; they are
 * additive inputs to a modulo-1 phase and can be rebalanced freely.
 */
const TONE_WEIGHT_Y = 0.45;
/**
 * Weight applied to the stable per-particle seed.  Using an irrational-ish
 * value (0.137 ≈ 1/φ²) distributes seed contributions evenly across the
 * palette without clustering at round-number offsets.
 */
const TONE_WEIGHT_SEED = 0.137;

/**
 * Divisor used to normalise the lower 16 bits of `noiseTickSeed` to [0, 1).
 * Equal to 2^16 = 65536.
 */
const SEED_NORMALISE = 65536.0;

// ---------------------------------------------------------------------------
// Per-kind palette ramps  (indexed by ParticleKind ordinal)
// ---------------------------------------------------------------------------

// Not `readonly` at the type level: the equippable-kind entries are
// overwritten below at module load, generated from the centralized mote-type
// config (task section 7), so this table's body colour genuinely follows
// `moteTypeConfig.ts` rather than drifting from a separately hand-authored
// palette. Internal/environmental kinds keep their bespoke hand-tuned ramps.
const KIND_PALETTE_RAMPS: string[][] = [
  // Golden (0) — dense gold motes
  ['#7a5000', '#c48c00', '#ffd700', '#fff5cc'],
  // Fire (1) — scorching embers
  ['#7a1500', '#cc3300', '#ff6600', '#ffbb88'],
  // Ice (2) — frozen crystals
  ['#003d7a', '#1a66cc', '#44aaff', '#ccedff'],
  // Lightning (3) — crackling sparks
  ['#665500', '#ccaa00', '#ffee00', '#ffff99'],
  // Poison (4) — toxic spores
  ['#1a3300', '#336600', '#55dd00', '#aaffaa'],
  // Arcane (5) — mysterious energy
  ['#330055', '#8822aa', '#cc44ff', '#f0aaff'],
  // Wind (6) — whirling gusts
  ['#1a4455', '#3388aa', '#88ddff', '#eeffff'],
  // Holy (7) — sacred motes
  ['#665500', '#ccaa44', '#ffee88', '#fffff0'],
  // Shadow (8) — tendrils of darkness
  ['#110022', '#441166', '#7733cc', '#cc88ff'],
  // Metal (9) — razor shards
  ['#334455', '#667788', '#aabbcc', '#ddeeff'],
  // Earth (10) — heavy stone fragments
  ['#332200', '#664400', '#996622', '#ccaa88'],
  // Nature (11) — living spores
  ['#1a3300', '#336600', '#66cc00', '#aaffaa'],
  // Crystal (12) — glittering shards
  ['#003355', '#006699', '#33bbee', '#ccffff'],
  // Void (13) — unstable matter
  ['#1a001a', '#440044', '#660066', '#9933cc'],
  // Fluid (14) — UNUSED here (handled by WebGL); kept for index alignment
  ['#003355', '#336699', '#88ccff', '#ccedff'],
  // Water (15) — flowing droplets
  ['#001a33', '#003388', '#1a66dd', '#88ccff'],
  // Lava (16) — molten fragments
  ['#550000', '#aa2200', '#ee4400', '#ff9966'],
  // Stone (17) — ancient worn fragments
  ['#2d2d3d', '#556677', '#889aaa', '#ccddee'],
  // Gold (18) — grappling hook sparkles
  ['#886600', '#ccaa00', '#ffcc00', '#fff0aa'],
  // Light (19) — radiant boss glow
  ['#887755', '#ccbb99', '#fffaee', '#ffffff'],
];

// ── Sync equippable player-mote body/glint tones from the centralized config ─
//
// For each equippable player mote type, the ramp's darker tones (indices 0-2,
// darkest→base) are generated from `visual.body`, and the glint/brightest
// tone (index 3 — already the "glint" accent drawn by the shimmer/attack-mode
// paths below) is generated from `visual.glow`. This makes "body" and "glow"
// both genuinely centralized instead of only the trail colour, while keeping
// the existing 4-tone dithering-ramp visual structure. Internal/environmental
// kinds are left on their hand-tuned ramps.
for (const kind of [
  ParticleKind.Golden,
  ParticleKind.Ice,
  ParticleKind.Nature,
  ParticleKind.Void,
  ParticleKind.Light,
]) {
  if (!hasMoteTypeConfig(kind)) continue;
  const visual = getMoteTypeVisual(kind);
  KIND_PALETTE_RAMPS[kind] = [
    rgbToHex(shadeRgb(visual.body, 0.42)),
    rgbToHex(shadeRgb(visual.body, 0.72)),
    rgbToHex(visual.body),
    rgbToHex(visual.glow),
  ];
}

/** Safe palette lookup — returns the Golden ramp if kind is out of range. */
function getPalette(kind: number): readonly string[] {
  return KIND_PALETTE_RAMPS[kind] ?? KIND_PALETTE_RAMPS[0];
}

/**
 * Exposed read-only accessor for the per-kind tone ramp, primarily so tests
 * can verify the equippable-kind entries are genuinely generated from
 * `moteTypeConfig.ts` (task section 7) without needing a canvas.
 */
export function getMotePaletteRampForTesting(kind: number): readonly string[] {
  return getPalette(kind);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Render all gameplay-relevant dust particles as crisp pixel-locked motes
 * on the virtual Canvas 2D context.
 *
 * Must be called on the *virtual* (480×270) canvas with
 * `ctx.imageSmoothingEnabled = false` already set.
 *
 * @param ctx         Virtual canvas 2D context.
 * @param snapshot    World snapshot (read-only).
 * @param offsetXPx   Camera X offset in virtual pixels (same as `ox` used
 *                    elsewhere in gameRender.ts).
 * @param offsetYPx   Camera Y offset in virtual pixels (`oy`).
 * @param scalePx     World-to-virtual-pixel scale factor (`zoom`).
 */
export function renderPixelLockedDust(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  mask?: EditorRenderMask | null,
): void {
  const { particles } = snapshot;
  const {
    particleCount, isAliveFlag,
    positionXWorld, positionYWorld,
    kindBuffer, ageTicks, lifetimeTicks,
    behaviorMode, particleMoteSlotState,
    noiseTickSeed,
  } = particles;

  // Save and disable image smoothing so single-pixel fillRects stay crisp.
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    // ── Exclusions ──────────────────────────────────────────────────────────
    // Grapple-chain particles are owned by grappleRenderer.ts.
    if (behaviorMode[i] === BEHAVIOR_MODE_GRAPPLE_CHAIN) continue;
    // Dust-switch motes (recalling/returning) are drawn behind the player by
    // dustSwitchTrailRenderer.ts instead — skip them here so they don't also
    // render in front via the normal pass.
    if (isDustSwitchBehaviorMode(behaviorMode[i])) continue;

    const kind = kindBuffer[i];

    // Fluid background particles stay in the WebGL layer for disturbance glow.
    if (kind === ParticleKind.Fluid) continue;

    if (!isLayerVisibleInMask(mask, getLayerForParticleKind(kind))) continue;

    // ── Alpha / visibility ──────────────────────────────────────────────────
    const lt      = lifetimeTicks[i];
    const normAge = lt > 0 ? Math.min(1.0, ageTicks[i] / lt) : 0.0;
    const ageFade = 1.0 - normAge;

    let alpha = ageFade;

    // Disturbed-only check reused from fallback renderer (non-Fluid always
    // uses ageFade; Fluid is excluded above).
    // Depleted mote slot → render at 25% alpha as a "spent" visual cue.
    if (particleMoteSlotState[i] !== 0) alpha *= 0.25;

    if (alpha <= MIN_VISIBLE_ALPHA) continue;

    // ── Virtual-pixel position ──────────────────────────────────────────────
    const vx = positionXWorld[i] * scalePx + offsetXPx;
    const vy = positionYWorld[i] * scalePx + offsetYPx;

    // Snap to integer virtual pixel — physics remain subpixel, only render snaps.
    const drawX = Math.round(vx);
    const drawY = Math.round(vy);

    // ── Subpixel tone selection ─────────────────────────────────────────────
    // fracX/fracY: where the particle sits within the snapped pixel (0..1).
    // Together with a stable per-particle seed these produce a tone index that
    // is consistent frame-to-frame (the particle shifts tone smoothly as it
    // drifts across virtual pixel boundaries, not every tick).
    const fracX = vx - Math.floor(vx);
    const fracY = vy - Math.floor(vy);
    const seed  = (noiseTickSeed[i] & 0xFFFF) / SEED_NORMALISE;  // lower 16 bits → [0,1), stable

    // tonePhase is the continuous 0..1 selector; floored to palette index.
    const tonePhase  = (fracX * TONE_WEIGHT_X + fracY * TONE_WEIGHT_Y + seed * TONE_WEIGHT_SEED) % 1.0;
    const palette    = getPalette(kind);
    const toneIndex  = Math.floor(tonePhase * palette.length) % palette.length;

    ctx.globalAlpha = alpha;

    const mode = behaviorMode[i];

    if (mode === 1) {
      // ── Attack mote: 2×2 multi-tone cluster ────────────────────────────
      // Derive four per-corner tone indices so the arrangement shifts by
      // seed/fracX/fracY, giving each particle a unique look without random
      // per-frame noise.
      const base     = tonePhase;
      const offset   = 1.0 / palette.length;
      const tone0    = Math.floor(((base)             % 1.0) * palette.length) % palette.length;
      const tone1    = Math.floor(((base + offset)    % 1.0) * palette.length) % palette.length;
      const tone2    = Math.floor(((base + offset * 2) % 1.0) * palette.length) % palette.length;
      const tone3    = Math.floor(((base + offset * 3) % 1.0) * palette.length) % palette.length;

      // Top-left
      ctx.fillStyle = palette[tone0];
      ctx.fillRect(drawX,     drawY,     1, 1);
      // Top-right
      ctx.fillStyle = palette[tone1];
      ctx.fillRect(drawX + 1, drawY,     1, 1);
      // Bottom-left
      ctx.fillStyle = palette[tone2];
      ctx.fillRect(drawX,     drawY + 1, 1, 1);
      // Bottom-right (glint/brightest corner for attack mode)
      ctx.fillStyle = palette[tone3];
      ctx.fillRect(drawX + 1, drawY + 1, 1, 1);
    } else {
      // ── Normal / shield mote: 1×1 solid pixel ──────────────────────────
      ctx.fillStyle = palette[toneIndex];
      ctx.fillRect(drawX, drawY, 1, 1);

      // Optional glint: a single adjacent pixel at the glint tone.
      // Only rendered for shimmery kinds when the particle is bright enough.
      if ((GLINT_KIND_MASK & (1 << kind)) !== 0 && ageFade > GLINT_AGE_THRESHOLD) {
        // Glint position shifts by seed so not all particles glint the same way.
        const glintTone = palette[3]; // always the glint/brightest ramp entry
        // Glint fades in above the GLINT_AGE_THRESHOLD and out as the particle dies.
        // glintAlpha = alpha * (ageFade - threshold), scaled so it peaks at 1× alpha.
        const glintAlpha = alpha * (ageFade - GLINT_AGE_THRESHOLD);
        ctx.globalAlpha = Math.min(glintAlpha, alpha);
        ctx.fillStyle = glintTone;
        // Offset direction: top-right for even seeds, bottom-left for odd.
        const dx = (noiseTickSeed[i] & 1) === 0 ? 1 : -1;
        const dy = (noiseTickSeed[i] & 2) === 0 ? -1 : 1;
        ctx.fillRect(drawX + dx, drawY + dy, 1, 1);
        ctx.globalAlpha = alpha;
      }
    }
  }

  ctx.globalAlpha       = 1.0;
  ctx.imageSmoothingEnabled = prevSmoothing;
}
