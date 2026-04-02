/**
 * Metroidvania room definitions — barrel file.
 *
 * Layout:
 *   World 3 ← World 2 ← [LOBBY] → World 1
 *
 * Room definitions are split by world into sub-files under ./rooms/.
 * This file re-exports everything for backward compatibility and
 * assembles the unified ROOM_REGISTRY.
 */

import { RoomDef } from './roomDef';
import { THERO_SHOWCASE_ROOMS } from './effectShowcaseRooms';

// ── Re-exports (backward compatibility) ──────────────────────────────────────

export { ROOM_LOBBY } from './rooms/lobbyRoom';
export { ROOM_W1_ROOM1 } from './rooms/world1Rooms';
export { ROOM_W2_ROOM1 } from './rooms/world2Rooms';
export { ROOM_W3_ROOM1 } from './rooms/world3Rooms';
export { ROOM_BOSS_RADIANT_TETHER } from './rooms/bossRooms';

// Import concrete values for registry assembly
import { ROOM_LOBBY } from './rooms/lobbyRoom';
import { ROOM_W1_ROOM1 } from './rooms/world1Rooms';
import { ROOM_W2_ROOM1 } from './rooms/world2Rooms';
import { ROOM_W3_ROOM1 } from './rooms/world3Rooms';
import { ROOM_BOSS_RADIANT_TETHER } from './rooms/bossRooms';

// ── Room registry ────────────────────────────────────────────────────────────

/** All rooms keyed by id for quick lookup. */
export const ROOM_REGISTRY: ReadonlyMap<string, RoomDef> = new Map([
  [ROOM_LOBBY.id, ROOM_LOBBY],
  [ROOM_W1_ROOM1.id, ROOM_W1_ROOM1],
  [ROOM_W2_ROOM1.id, ROOM_W2_ROOM1],
  [ROOM_W3_ROOM1.id, ROOM_W3_ROOM1],
  [ROOM_BOSS_RADIANT_TETHER.id, ROOM_BOSS_RADIANT_TETHER],
  // Thero effect showcase rooms (worldNumber=99, solid-black background + effect overlay)
  ...THERO_SHOWCASE_ROOMS.map(r => [r.id, r] as [string, RoomDef]),
]);

/** The room the player starts in. */
export const STARTING_ROOM_ID = 'lobby';
