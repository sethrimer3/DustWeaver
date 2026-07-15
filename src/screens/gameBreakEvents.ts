/**
 * gameBreakEvents.ts — Per-tick break-event -> sound/particle bridge (Phase 2C).
 *
 * Extracted to isolate the break-event queue drain from the physics tick loop
 * in gameScreen.ts, mirroring the existing gameCrumbleDebrisEvents.ts pattern.
 *
 * Design notes:
 *
 * - `world.breakEventCount` / the parallel break-event arrays are populated by
 *   `applyHazards()` in src/sim/hazards.ts — ONE event per destroyed logical
 *   placement (a 2x2 group is one event, not four). This function only reads
 *   them; it never mutates simulation state.
 *
 * - Must be called once per physics tick, inside the fixed-step accumulator
 *   loop, after `tick(world)` returns — the queue is reset to empty at the top
 *   of the NEXT `applyHazards()` call, so it must be drained before then.
 *
 * - Sound selection is a pure, testable boundary (see ../audio/breakSfx.ts) —
 *   no browser audio globals need to be mocked to test the mapping itself.
 */

import type { WorldState } from '../sim/world';
import type { PlayerSfxManager } from '../audio/playerSfx';
import type { GraphicsQuality } from '../ui/renderSettings';
import type { BreakEffectRenderer } from '../render/breakEffectRenderer';
import { indexToMaterialResponse } from '../levels/customBlockProperties';
import { materialBreakSoundName, resolveBreakVolumeScale } from '../audio/breakSfx';

/**
 * Drains this tick's break-event queue: spawns material-tinted debris and
 * plays the mapped break sound for each event, then advances the debris
 * simulation.
 *
 * @param world        Simulation world state (break-event arrays read-only).
 * @param breakEffects Break-debris particle renderer (mutated).
 * @param sfx          Player SFX manager used to play the mapped break sound.
 * @param quality      Active graphics-quality tier — scales particle counts.
 * @param dtMs         Fixed tick duration in milliseconds (FIXED_DT_MS).
 */
export function tickBreakEvents(
  world: WorldState,
  breakEffects: BreakEffectRenderer,
  sfx: PlayerSfxManager,
  quality: GraphicsQuality,
  dtMs: number,
): void {
  const eventCount = world.breakEventCount;
  for (let i = 0; i < eventCount; i++) {
    const material = indexToMaterialResponse(world.breakEventMaterial[i]);
    const isGrouped = world.breakEventIsGroupedFlag[i] === 1;

    breakEffects.notifyBreak(
      world.breakEventXWorld[i],
      world.breakEventYWorld[i],
      material,
      isGrouped,
      quality,
    );

    sfx.play(materialBreakSoundName(material), resolveBreakVolumeScale(isGrouped, eventCount));
  }

  breakEffects.update(dtMs);
}
