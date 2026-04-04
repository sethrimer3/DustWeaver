/**
 * TheroEffectManager
 *
 * Manages singleton instances of all 7 ported Thero chapter background effects
 * and dispatches update + draw calls based on the current showcase room ID.
 *
 * Effect-to-room-id mapping:
 *   thero_prologue → PrologueShapeEffect   (XOR glow shapes)
 *   thero_ch1      → VermiculateEffect     (bouncing tracer worms)
 *   thero_ch2      → GravityGridEffect     (warped grid + floating balls)
 *   thero_ch3      → EulerFluidEffect      (fluid tracer particles)
 *   thero_ch4      → FloaterLatticeEffect  (floating circles & swimmers)
 *   thero_ch5      → TetrisBlockEffect     (walking block cluster)
 *   thero_ch6      → SubstrateEffect       (crystalline cracks)
 */

import { TheroBackgroundEffect } from './theroBackgroundEffect';
import { createPrologueShapeEffect } from './prologueShapeEffect';
import { createVermiculateEffect }    from './vermiculateEffect';
import { createGravityGridEffect }    from './gravityGridEffect';
import { createEulerFluidEffect }     from './eulerFluidEffect';
import { createFloaterLatticeEffect } from './floaterLatticeEffect';
import { createTetrisBlockEffect }    from './tetrisBlockEffect';
import { createSubstrateEffect }      from './substrateEffect';

// Room IDs of the 7 showcase rooms (worldNumber === 99).
export const THERO_SHOWCASE_ROOM_IDS = new Set([
  'thero_prologue',
  'thero_ch1',
  'thero_ch2',
  'thero_ch3',
  'thero_ch4',
  'thero_ch5',
  'thero_ch6',
]);

// World number used to identify Thero showcase rooms.
export const THERO_SHOWCASE_WORLD_NUMBER = 99;

// ── Lazy singleton effect instances ───────────────────────────────────────────
// Effects are created on first access and reused across room visits.

let _effects: Map<string, TheroBackgroundEffect> | null = null;

function getEffects(): Map<string, TheroBackgroundEffect> {
  if (!_effects) {
    _effects = new Map([
      ['thero_prologue', createPrologueShapeEffect()],
      ['thero_ch1',      createVermiculateEffect()],
      ['thero_ch2',      createGravityGridEffect()],
      ['thero_ch3',      createEulerFluidEffect()],
      ['thero_ch4',      createFloaterLatticeEffect()],
      ['thero_ch5',      createTetrisBlockEffect()],
      ['thero_ch6',      createSubstrateEffect()],
    ]);
  }
  return _effects;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true when the given room ID belongs to a Thero showcase room.
 * Use this to gate the solid-black background and effect rendering.
 */
export function isTheroShowcaseRoom(roomId: string): boolean {
  return THERO_SHOWCASE_ROOM_IDS.has(roomId);
}

/**
 * Advance the effect for the given room and render it onto the context.
 * The solid black background is handled by `renderWorldBackground` in
 * backgroundRenderer.ts (worldNumber=99 draws '#000000').
 * This function only updates the effect simulation and renders the effect overlay.
 *
 * Safe to call every frame; does nothing if roomId is not a showcase room.
 *
 * @param ctx       The 2D canvas context (virtual 480×270 space).
 * @param roomId    Current room ID.
 * @param widthPx   Virtual canvas width (480).
 * @param heightPx  Virtual canvas height (270).
 * @param nowMs     Current timestamp in ms (e.g. performance.now()).
 */
export function renderTheroShowcaseEffect(
  ctx: CanvasRenderingContext2D,
  roomId: string,
  widthPx: number,
  heightPx: number,
  nowMs: number,
): void {
  const effect = getEffects().get(roomId);
  if (!effect) return;

  effect.update(nowMs, widthPx, heightPx);
  effect.draw(ctx);
}

/**
 * Reset the effect for a specific room (call when the player leaves it).
 * The effect will reinitialise cleanly on next entry.
 */
export function resetTheroEffect(roomId: string): void {
  const effect = _effects?.get(roomId);
  effect?.reset();
}

/**
 * Reset all Thero effects at once (e.g. on full game reset).
 */
export function resetAllTheroEffects(): void {
  if (!_effects) return;
  for (const effect of _effects.values()) {
    effect.reset();
  }
}

// ── Crystalline Cracks background effect ─────────────────────────────────────

/**
 * Singleton SubstrateEffect instance for the Crystalline Cracks room background.
 * Shared across any room that has backgroundId='crystallineCracks'.
 */
let _crystallineCracksEffect: TheroBackgroundEffect | null = null;

/**
 * Render the Crystalline Cracks procedural background effect.
 * Call this each frame after drawing the solid-black background.
 *
 * @param ctx       The 2D canvas context (virtual 480×270 space).
 * @param widthPx   Virtual canvas width (480).
 * @param heightPx  Virtual canvas height (270).
 * @param nowMs     Current timestamp in ms (e.g. performance.now()).
 */
export function renderCrystallineCracksBackground(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
  nowMs: number,
): void {
  if (!_crystallineCracksEffect) {
    _crystallineCracksEffect = createSubstrateEffect();
  }
  _crystallineCracksEffect.update(nowMs, widthPx, heightPx);
  _crystallineCracksEffect.draw(ctx);
}
