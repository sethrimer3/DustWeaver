/**
 * World 3 room definitions — Crucible Depths (Fire/Lava World).
 */

import { ParticleKind } from '../../sim/particles/kinds';
import { RoomDef } from '../roomDef';
import {
  buildBoundaryWalls,
  buildTunnelWalls,
  TUNNEL_HEIGHT_BLOCKS,
  TunnelOpening,
} from './roomBuilders';

// ── World 3 dimensions ───────────────────────────────────────────────────────

export const W3_ROOM_WIDTH = 44;
export const W3_ROOM_HEIGHT = 24;

// ── World 3, Room 1 (Fire/Lava World) ────────────────────────────────────────

const W3_TUNNEL_Y = 16;

const w3r1Tunnels: TunnelOpening[] = [
  { direction: 'right', positionBlock: W3_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
];

const w3r1Boundary = buildBoundaryWalls(W3_ROOM_WIDTH, W3_ROOM_HEIGHT, w3r1Tunnels);
const w3r1TunnelWalls = buildTunnelWalls(W3_ROOM_WIDTH, w3r1Tunnels);

// Used by world2Rooms.ts for transitions
export { W3_TUNNEL_Y };

// W2 tunnel Y duplicated here to avoid circular import (world2Rooms → world3Rooms → world2Rooms).
// Must match W2_TUNNEL_Y in world2Rooms.ts.
const W2_TUNNEL_Y_FOR_SPAWN = 16;

export const ROOM_W3_ROOM1: RoomDef = {
  id: 'w3_room1',
  name: 'Crucible Depths',
  worldNumber: 3,
  widthBlocks: W3_ROOM_WIDTH,
  heightBlocks: W3_ROOM_HEIGHT,
  walls: [
    ...w3r1Boundary,
    ...w3r1TunnelWalls,
    // Interior platforms — rugged, asymmetric terrain
    { xBlock: 5,  yBlock: 19, wBlock: 6, hBlock: 1 },
    { xBlock: 14, yBlock: 16, wBlock: 5, hBlock: 1 },
    { xBlock: 24, yBlock: 18, wBlock: 4, hBlock: 1 },
    { xBlock: 32, yBlock: 14, wBlock: 5, hBlock: 1 },
    { xBlock: 18, yBlock: 12, wBlock: 6, hBlock: 1 },
    { xBlock: 8,  yBlock: 13, wBlock: 4, hBlock: 1 },
  ],
  enemies: [
    // Rolling enemy 5 — Fire dust
    {
      xBlock: 16,
      yBlock: 15,
      kinds: [ParticleKind.Fire],
      particleCount: 18,
      isBossFlag: 0,
      isRollingEnemyFlag: 1,
      rollingEnemySpriteIndex: 5,
    },
    // Rolling enemy 6 — Lava dust
    {
      xBlock: 32,
      yBlock: 13,
      kinds: [ParticleKind.Lava],
      particleCount: 20,
      isBossFlag: 0,
      isRollingEnemyFlag: 1,
      rollingEnemySpriteIndex: 6,
    },
  ],
  playerSpawnBlock: [W3_ROOM_WIDTH - 4, W3_ROOM_HEIGHT - 5],
  transitions: [
    {
      direction: 'right',
      targetRoomId: 'w2_room1',
      positionBlock: W3_TUNNEL_Y,
      openingSizeBlocks: TUNNEL_HEIGHT_BLOCKS,
      targetSpawnBlock: [3, W2_TUNNEL_Y_FOR_SPAWN + 2],
    },
  ],
  skillTombs: [],
  // ── Environmental hazards ─────────────────────────────────────────────
  lavaZones: [
    // Lava pool at the bottom of the room
    { xBlock: 1, yBlock: 21, wBlock: 42, hBlock: 2 },
  ],
  spikes: [
    // Ceiling spikes above lava
    { xBlock: 20, yBlock: 20, direction: 'down' as const },
    { xBlock: 21, yBlock: 20, direction: 'down' as const },
    { xBlock: 22, yBlock: 20, direction: 'down' as const },
  ],
  dustBoostJars: [
    // Lava dust boost jar on a high platform
    { xBlock: 20, yBlock: 11, dustKind: ParticleKind.Lava, dustCount: 12 },
  ],
};
