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
 *    Ice, Holy, Light, Metal, Physical)
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Particles with computed alpha below this are skipped. */
const MIN_VISIBLE_ALPHA = 0.004;

/**
 * Kinds that get an optional glint pixel on the virtual canvas.
 * This is a bitmask over ParticleKind values (kind < 32 so a plain number works).
 */
const GLINT_KIND_MASK = (
  (1 << ParticleKind.Physical) |
  (1 << ParticleKind.Ice)      |
  (1 << ParticleKind.Holy)     |
  (1 << ParticleKind.Metal)    |
  (1 << ParticleKind.Crystal)  |
  (1 << ParticleKind.Gold)     |
  (1 << ParticleKind.Light)
);

// ---------------------------------------------------------------------------
// Per-kind palette ramps
// ---------------------------------------------------------------------------
//
// Four tones per kind: [0] = dark, [1] = mid, [2] = bright, [3] = glint.
// Indices are selected by tonePhase = (fracX*0.55 + fracY*0.45 + seed*0.137)%1.
// Attack-mode 2×2 motes use all four slots for the four sub-pixels.
//
// To tune: edit the hex strings below.  Each ramp must have exactly 4 entries.
// ---------------------------------------------------------------------------

const PALETTE_RAMPS: readonly (readonly string[])[] = [
  // Physical (0) — dense gold motes
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

/** Safe palette lookup — returns Physical ramp if kind is out of range. */
function getPalette(kind: number): readonly string[] {
  return PALETTE_RAMPS[kind] ?? PALETTE_RAMPS[0];
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

    const kind = kindBuffer[i];

    // Fluid background particles stay in the WebGL layer for disturbance glow.
    if (kind === ParticleKind.Fluid) continue;

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
    const seed  = (noiseTickSeed[i] & 0xFFFF) / 65536.0;  // 0..1, stable

    // tonePhase is the continuous 0..1 selector; floored to palette index.
    const tonePhase  = (fracX * 0.55 + fracY * 0.45 + seed * 0.137) % 1.0;
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
      // Only rendered for shimmery kinds when the particle is bright enough
      // (ageFade > 0.55 so it only appears near spawn/peak-life, not fade).
      if ((GLINT_KIND_MASK & (1 << kind)) !== 0 && ageFade > 0.55) {
        // Glint position shifts by seed so not all particles glint the same way.
        const glintTone = palette[3]; // always the glint/brightest ramp entry
        const glintAlpha = alpha * 0.45 * (ageFade - 0.55) / 0.45;
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
