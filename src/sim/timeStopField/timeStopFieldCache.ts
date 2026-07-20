/**
 * timeStopFieldCache.ts — TimeStop Field Region Cache.
 *
 * Module-level singleton cache of {@link TimeStopFieldRegionSet}, rebuilt
 * only when marked dirty (room load, editor paint/delete of TimeStop Field
 * tiles). Mirrors `render/liquidBodyCache.ts`'s dirty-flag convention so the
 * expensive BFS never runs in the per-tick hot path.
 */

import type { WorldState } from '../world';
import { buildTimeStopFieldRegions, type TimeStopFieldRegionSet } from './timeStopFieldBuilder';

const EMPTY_REGION_SET: TimeStopFieldRegionSet = { regions: [], tileToRegion: new Map() };

let _isDirty = true;
let _regionSet: TimeStopFieldRegionSet = EMPTY_REGION_SET;

/**
 * Marks the region cache stale so it rebuilds on the next `getTimeStopFieldRegions`
 * call. Call whenever TimeStop Field tiles are added/removed or a room loads.
 */
export function markTimeStopFieldsDirty(): void {
  _isDirty = true;
}

/**
 * Returns the current connected-region set, rebuilding if dirty. Safe to
 * call every frame/tick — rebuilds are amortised to room-change events.
 */
export function getTimeStopFieldRegions(world: WorldState): TimeStopFieldRegionSet {
  if (_isDirty) {
    _regionSet = buildTimeStopFieldRegions(world);
    _isDirty = false;
  }
  return _regionSet;
}
