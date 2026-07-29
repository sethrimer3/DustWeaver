/**
 * gamePlayerLuminantLight.ts — Player-centered ambient light driven by the
 * player's currently surviving Luminant (Light) motes.
 *
 * Reuses the existing scene-lighting infrastructure (`LightDef` +
 * `renderLightingPass`) rather than a parallel lighting system: this module
 * only computes a single persistent `LightDef` describing the player's
 * Luminant glow, which the caller merges into the room's scene-light list.
 *
 * Radius scales with the player's live Luminant mote count (particles of
 * kind Light, alive, owned by the player — the same availability policy
 * used by the DarkRoom Light Dust illumination in gameLightDustIllumination.ts),
 * never a separate/desyncable counter. The displayed radius/intensity are
 * smoothly interpolated toward their targets every frame so mote gain/loss
 * never snaps the lit area.
 */

import type { LightDef } from '../render/lighting/lightingTypes';
import type { WorldSnapshot } from '../render/snapshot';
import { isAvailablePlayerLightDust } from './gameLightDustIllumination';

/** Base radius (world units / in-game pixels) with zero active Luminant motes... */
export const PLAYER_LUMINANT_BASE_RADIUS_WORLD = 100;
/** ...plus this much additional radius per currently surviving Luminant mote. */
export const PLAYER_LUMINANT_RADIUS_PER_MOTE_WORLD = 10;

/** Peak brightness once the light is fully faded in. */
const PLAYER_LUMINANT_MAX_INTENSITY_PCT = 40;

/**
 * Exponential smoothing rate (per second). Higher = snappier. At 8/s the
 * displayed value closes ~86% of the gap to target within 250ms — responsive
 * without visibly snapping.
 */
const INTERP_RATE_PER_SEC = 8;

/** Warm-white matching the existing Luminant/Light Dust visual identity. */
const LUMINANT_COLOR_R = 255;
const LUMINANT_COLOR_G = 244;
const LUMINANT_COLOR_B = 176;

/** Target radius is considered "settled" (light fully removed) below this. */
const MIN_VISIBLE_RADIUS_WORLD = 0.5;

/** target = base + count * perMote, or 0 when the player has no active Luminant motes. */
export function computePlayerLuminantTargetRadiusWorld(activeLuminantMoteCount: number): number {
  if (activeLuminantMoteCount <= 0) return 0;
  return PLAYER_LUMINANT_BASE_RADIUS_WORLD + activeLuminantMoteCount * PLAYER_LUMINANT_RADIUS_PER_MOTE_WORLD;
}

/**
 * Live count of the player's currently surviving/equipped Luminant motes.
 * Delegates to the same alive+kind+ownership predicate the DarkRoom Light
 * Dust pass already uses, so this can never desynchronize from gameplay state.
 */
export function countActivePlayerLuminantMotes(
  particles: WorldSnapshot['particles'],
  playerEntityId: number,
): number {
  let count = 0;
  for (let pi = 0; pi < particles.particleCount; pi++) {
    if (isAvailablePlayerLightDust(particles, pi, playerEntityId)) count++;
  }
  return count;
}

/** Frame-rate-independent exponential approach of `current` toward `target`. */
function approach(current: number, target: number, dtSec: number): number {
  if (current === target) return target;
  const t = 1 - Math.exp(-INTERP_RATE_PER_SEC * Math.max(0, dtSec));
  const next = current + (target - current) * t;
  // Snap once within a negligible epsilon so state settles exactly at 0 and
  // stops re-allocating/reporting a light forever approaching zero.
  return Math.abs(next - target) < 0.01 ? target : next;
}

// ── Singleton state ──────────────────────────────────────────────────────
// One reusable LightDef + smoothing state for the player's Luminant glow.
// Never duplicated: callers always get back the same object reference.

let _currentRadiusWorld = 0;
let _currentIntensityPct = 0;

const _light: LightDef = {
  xWorld: 0,
  yWorld: 0,
  kind: 'softGlow',
  radiusWorld: 0,
  colorR: LUMINANT_COLOR_R,
  colorG: LUMINANT_COLOR_G,
  colorB: LUMINANT_COLOR_B,
  intensityPct: 0,
  blendMode: 'add',
  // Ambient environment fill, not a directional/occlusion-casting source —
  // keeps per-frame cost flat regardless of room wall count.
  castsShadowsFlag: 0,
};

/**
 * Advance the smoothing simulation and return the shared LightDef when it
 * should be rendered this frame (radius/intensity meaningfully above zero),
 * or `null` when fully faded out / no player found.
 */
export function updatePlayerLuminantLight(snapshot: WorldSnapshot, dtSec: number): LightDef | null {
  let playerSnap: WorldSnapshot['clusters'][number] | undefined;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const c = snapshot.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) { playerSnap = c; break; }
  }

  if (playerSnap === undefined) {
    _currentRadiusWorld = approach(_currentRadiusWorld, 0, dtSec);
    _currentIntensityPct = approach(_currentIntensityPct, 0, dtSec);
    return null;
  }

  const activeCount = countActivePlayerLuminantMotes(snapshot.particles, playerSnap.entityId);
  const targetRadiusWorld = computePlayerLuminantTargetRadiusWorld(activeCount);
  const targetIntensityPct = activeCount > 0 ? PLAYER_LUMINANT_MAX_INTENSITY_PCT : 0;

  _currentRadiusWorld = approach(_currentRadiusWorld, targetRadiusWorld, dtSec);
  _currentIntensityPct = approach(_currentIntensityPct, targetIntensityPct, dtSec);

  if (_currentRadiusWorld < MIN_VISIBLE_RADIUS_WORLD || _currentIntensityPct <= 0) return null;

  _light.xWorld = playerSnap.positionXWorld;
  _light.yWorld = playerSnap.positionYWorld;
  _light.radiusWorld = _currentRadiusWorld;
  _light.intensityPct = _currentIntensityPct;
  return _light;
}

/**
 * Reset the smoothing state and hide the light immediately. Must be called
 * on room transitions, respawn, and death cleanup (mirrors
 * `dustContainerPickupEffect.reset()` / `playerDeathDust.reset()` in
 * gameScreen.ts's loadRoom() reset block) so the glow never persists or
 * duplicates across those boundaries.
 */
export function resetPlayerLuminantLight(): void {
  _currentRadiusWorld = 0;
  _currentIntensityPct = 0;
  _light.radiusWorld = 0;
  _light.intensityPct = 0;
}
