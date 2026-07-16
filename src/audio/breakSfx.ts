/**
 * breakSfx.ts — Material-response break-sound selection (Phase 2C).
 *
 * A pure, DOM-free, audio-hardware-free selection boundary: given a
 * MaterialResponsePreset (and whether the break event covers a grouped
 * placement), returns which existing PlayerSfxManager sound name to play and
 * at what volume scale. Kept separate from PlayerSfxManager itself so tests
 * can exercise the selection logic directly without touching AudioContext.
 *
 * No new sound assets are added for Phase 2C — every mapped name already
 * exists in ASSETS/sfx/PLAYER/ and is already preloaded by PlayerSfxManager.
 * Reuse rationale:
 *   - stone -> 'jump_impact_hard'   (heaviest existing impact, reads as a
 *                                    rock/masonry thud)
 *   - wood  -> 'jump_impact_medium' (a lighter impact than stone, reads as
 *                                    a duller wooden crack)
 *   - metal -> 'grapple_impact'     (the grapple hook's metal-on-surface
 *                                    clink is the closest existing metallic
 *                                    sound in the project)
 * This gives all three presets a distinct existing sound rather than
 * collapsing two of them onto the same asset.
 */

import type { PlayerSfxName } from './playerSfx';
import type { MaterialResponsePreset } from '../levels/customBlockProperties';

/** Maps a material-response preset to the existing PlayerSfxManager sound it reuses. */
export function materialBreakSoundName(material: MaterialResponsePreset): PlayerSfxName {
  switch (material) {
    case 'stone': return 'jump_impact_hard';
    case 'wood': return 'jump_impact_medium';
    case 'metal': return 'grapple_impact';
  }
}

/**
 * Base volume scale for a single break event, before any concurrent-event
 * attenuation. Grouped (2x2) placements play marginally louder than a lone
 * 1x1 cell since they represent more mass breaking at once, but the increase
 * is modest to avoid a jarringly loud group-break.
 */
function baseBreakVolumeScale(isGrouped: boolean): number {
  return isGrouped ? 1.0 : 0.85;
}

/**
 * Resolves the final volume scale (passed to PlayerSfxManager.play as
 * `volumeScale`) for one break event, given how many break events are firing
 * in the same tick. Attenuates when multiple blocks break simultaneously so a
 * pile of breaks does not clip or sum into an overloud burst.
 *
 * @param isGrouped            Whether this event covers a multi-cell (2x2) placement.
 * @param concurrentEventCount Total break events firing this tick (>= 1).
 */
export function resolveBreakVolumeScale(isGrouped: boolean, concurrentEventCount: number): number {
  const base = baseBreakVolumeScale(isGrouped);
  if (concurrentEventCount <= 1) return base;
  // Attenuate by 1/sqrt(n), floored so even a large pile-up stays audible.
  const attenuation = Math.max(0.5, 1 / Math.sqrt(concurrentEventCount));
  return base * attenuation;
}
