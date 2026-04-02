/**
 * World 2 room definitions — Ember Threshold.
 */

import { ParticleKind } from '../../sim/particles/kinds';
import { RoomDef } from '../roomDef';
import {
  buildBoundaryWalls,
  buildTunnelWalls,
  TUNNEL_HEIGHT_BLOCKS,
  TunnelOpening,
} from './roomBuilders';
import { W3_ROOM_WIDTH } from './world3Rooms';

// ── World 2 dimensions ───────────────────────────────────────────────────────

export const W2_ROOM_WIDTH = 40;
export const W2_ROOM_HEIGHT = 24;

// ── World 2, Room 1 ──────────────────────────────────────────────────────────

const W2_TUNNEL_Y = 16;

const w2r1Tunnels: TunnelOpening[] = [
  { direction: 'right', positionBlock: W2_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
  { direction: 'left',  positionBlock: W2_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
];

const w2r1Boundary = buildBoundaryWalls(W2_ROOM_WIDTH, W2_ROOM_HEIGHT, w2r1Tunnels);
const w2r1TunnelWalls = buildTunnelWalls(W2_ROOM_WIDTH, w2r1Tunnels);

// Re-export for convenience (used by lobbyRoom.ts)
export { W2_TUNNEL_Y };

// Lobby tunnel Y duplicated here to avoid circular import (lobbyRoom → world2Rooms → lobbyRoom).
// Must match LOBBY_TUNNEL_Y in lobbyRoom.ts.
const LOBBY_TUNNEL_Y_FOR_SPAWN = 16;

export const ROOM_W2_ROOM1: RoomDef = {
  id: 'w2_room1',
  name: 'Ember Threshold',
  worldNumber: 2,
  widthBlocks: W2_ROOM_WIDTH,
  heightBlocks: W2_ROOM_HEIGHT,
  walls: [
    ...w2r1Boundary,
    ...w2r1TunnelWalls,
    // Interior platforms
    { xBlock: 6,  yBlock: 15, wBlock: 5, hBlock: 1 },
    { xBlock: 15, yBlock: 18, wBlock: 4, hBlock: 1 },
    { xBlock: 22, yBlock: 16, wBlock: 5, hBlock: 1 },
    { xBlock: 30, yBlock: 13, wBlock: 4, hBlock: 1 },
    { xBlock: 10, yBlock: 20, wBlock: 6, hBlock: 1 },
  ],
  enemies: [
    // Rolling enemy 3 — Water dust
    {
      xBlock: 12,
      yBlock: 16,
      kinds: [ParticleKind.Water],
      particleCount: 18,
      isBossFlag: 0,
      isRollingEnemyFlag: 1,
      rollingEnemySpriteIndex: 3,
    },
    // Rolling enemy 4 — Ice dust
    {
      xBlock: 28,
      yBlock: 14,
      kinds: [ParticleKind.Ice],
      particleCount: 14,
      isBossFlag: 0,
      isRollingEnemyFlag: 1,
      rollingEnemySpriteIndex: 4,
    },
    // Flying Eye (Ice) — hovers mid-room
    {
      xBlock: 20,
      yBlock: 8,
      kinds: [ParticleKind.Ice],
      particleCount: 16,
      isBossFlag: 0,
      isFlyingEyeFlag: 1,
    },
  ],
  playerSpawnBlock: [W2_ROOM_WIDTH - 4, W2_ROOM_HEIGHT - 5],
  transitions: [
    {
      direction: 'right',
      targetRoomId: 'lobby',
      positionBlock: W2_TUNNEL_Y,
      openingSizeBlocks: TUNNEL_HEIGHT_BLOCKS,
      targetSpawnBlock: [3, LOBBY_TUNNEL_Y_FOR_SPAWN + 2],
    },
    {
      direction: 'left',
      targetRoomId: 'w3_room1',
      positionBlock: W2_TUNNEL_Y,
      openingSizeBlocks: TUNNEL_HEIGHT_BLOCKS,
      targetSpawnBlock: [W3_ROOM_WIDTH - 4, W2_TUNNEL_Y + 2],
    },
  ],
  skillTombs: [],
  // ── Environmental hazards ─────────────────────────────────────────────
  waterZones: [
    // Flooded lower section of the room
    { xBlock: 1, yBlock: 19, wBlock: 38, hBlock: 4 },
  ],
  springboards: [
    { xBlock: 8, yBlock: 22 },
  ],
};
