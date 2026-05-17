/**
 * gameCrumbleDebrisEvents.ts — Per-tick crumble-block event → debris bridge.
 *
 * Extracted from the physics tick loop in gameScreen.ts to isolate the change-
 * detection scan that fires visual events on the CrumbleDebrisRenderer when a
 * crumble block is cracked (first hit) or fully destroyed (second hit).
 *
 * Design notes:
 *
 * - The scan is performed once per physics tick, inside the fixed-step
 *   accumulator loop.  It compares the per-block "active" and "hits remaining"
 *   values from the current tick against the values captured before the tick
 *   (stored in `prevCrumbleActive` / `prevCrumbleHits`).
 *
 * - Both `prevCrumbleActive` and `prevCrumbleHits` are mutated in-place by
 *   this function to record the new baseline for the next tick.
 *
 * - `crumbleDebris.update(dtMs)` is also called here to advance the particle
 *   simulation for the debris renderer — the two operations are always paired.
 *
 * - This function has no return value and never modifies `WorldState` directly;
 *   it only reads crumble arrays and notifies the visual renderer.
 */

import type { WorldState } from '../sim/world';
import type { CrumbleDebrisRenderer } from '../render/crumbleDebrisRenderer';

/**
 * Scan all crumble blocks for state changes this tick and fire the appropriate
 * visual debris events on `crumbleDebris`, then advance the debris simulation.
 *
 * Must be called once per fixed-timestep tick after `tick(world)` returns and
 * before the accumulator is decremented.
 *
 * @param world              Simulation world state (crumble arrays read-only).
 * @param crumbleDebris      Debris particle renderer (mutated).
 * @param prevCrumbleActive  Per-block "was-active" snapshot; mutated in-place.
 * @param prevCrumbleHits    Per-block "was-hits" snapshot; mutated in-place.
 * @param dtMs               Fixed tick duration in milliseconds (FIXED_DT_MS).
 */
export function tickCrumbleDebrisEvents(
  world: WorldState,
  crumbleDebris: CrumbleDebrisRenderer,
  prevCrumbleActive: Uint8Array,
  prevCrumbleHits: Uint8Array,
  dtMs: number,
): void {
  for (let ci = 0; ci < world.crumbleBlockCount; ci++) {
    const nowActive = world.isCrumbleBlockActiveFlag[ci];
    const nowHits   = world.crumbleBlockHitsRemaining[ci];
    const wasActive = prevCrumbleActive[ci];
    const wasHits   = prevCrumbleHits[ci];

    if (wasActive === 1) {
      if (nowActive === 0) {
        // Block fully destroyed this tick.
        // The wall sprite renderer detects the changed wall-layout signature
        // automatically and rebuilds ambient lighting on the next frame.
        crumbleDebris.notifyBlockHit(world.crumbleBlockXWorld[ci], world.crumbleBlockYWorld[ci], true);
      } else if (nowHits < wasHits) {
        // Block cracked (first hit) this tick.
        crumbleDebris.notifyBlockHit(world.crumbleBlockXWorld[ci], world.crumbleBlockYWorld[ci], false);
      }
    }

    prevCrumbleActive[ci] = nowActive;
    prevCrumbleHits[ci]   = nowHits;
  }

  crumbleDebris.update(dtMs);
}
