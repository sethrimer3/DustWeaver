/**
 * gameCrackedBlockShatterEvents.ts — Per-tick cracked-block shatter → particle bridge.
 *
 * Mirrors gameCrumbleDebrisEvents.ts, but drives the momentum-speed shatter
 * particle burst (CrackedBlockShatterRenderer) instead of the generic 2-hit
 * crumble debris. Reads world.shatterEvent* — a small, per-tick event queue
 * populated by sim/crackedBlockShatter.ts during collision resolution and
 * drained (shatterEventCount reset to 0) at the top of every tick() call —
 * so it must be called once per physics tick, immediately after tick(world)
 * returns and before the next tick() call.
 */

import type { WorldState } from '../sim/world';
import type { CrackedBlockShatterRenderer } from '../render/crackedBlockShatterRenderer';

export function tickCrackedBlockShatterEvents(
  world: WorldState,
  shatterRenderer: CrackedBlockShatterRenderer,
  dtMs: number,
): void {
  for (let ei = 0; ei < world.shatterEventCount; ei++) {
    shatterRenderer.notifyShatter(
      world.shatterEventXWorld[ei],
      world.shatterEventYWorld[ei],
      world.shatterEventWWorld[ei],
      world.shatterEventHWorld[ei],
      world.shatterEventImpactXWorld[ei],
      world.shatterEventImpactYWorld[ei],
      world.shatterEventNormalX[ei],
      world.shatterEventNormalY[ei],
      world.shatterEventThemeIndex[ei],
      world.shatterEventSpeedWorld[ei],
    );
  }

  shatterRenderer.update(dtMs);
}
