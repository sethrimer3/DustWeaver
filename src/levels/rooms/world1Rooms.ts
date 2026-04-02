/**
 * World 1 room definitions — Stone Crossing.
 */

import { ParticleKind } from '../../sim/particles/kinds';
import { RoomDef } from '../roomDef';
import {
  buildBoundaryWalls,
  buildTunnelWalls,
  TUNNEL_HEIGHT_BLOCKS,
  TunnelOpening,
} from './roomBuilders';

// ── World 1 dimensions ───────────────────────────────────────────────────────

export const W1_ROOM_WIDTH = 40;
export const W1_ROOM_HEIGHT = 24;

// ── World 1, Room 1 ──────────────────────────────────────────────────────────

const W1_TUNNEL_Y = 16;

// Boss room dimensions needed for transitions
const BOSS_TUNNEL_Y = 40;

const w1r1Tunnels: TunnelOpening[] = [
  { direction: 'left', positionBlock: W1_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
  { direction: 'right', positionBlock: W1_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
];

const w1r1Boundary = buildBoundaryWalls(W1_ROOM_WIDTH, W1_ROOM_HEIGHT, w1r1Tunnels);
const w1r1TunnelWalls = buildTunnelWalls(W1_ROOM_WIDTH, w1r1Tunnels);

// These are imported by lobbyRoom.ts and bossRooms.ts — re-export for convenience
export { W1_TUNNEL_Y, BOSS_TUNNEL_Y };

export const ROOM_W1_ROOM1: RoomDef = {
  id: 'w1_room1',
  name: 'Stone Crossing',
  worldNumber: 1,
  widthBlocks: W1_ROOM_WIDTH,
  heightBlocks: W1_ROOM_HEIGHT,
  walls: [
    ...w1r1Boundary,
    ...w1r1TunnelWalls,
    // Interior platforms
    { xBlock: 8,  yBlock: 19, wBlock: 5, hBlock: 1 },
    { xBlock: 18, yBlock: 17, wBlock: 4, hBlock: 1 },
    { xBlock: 26, yBlock: 15, wBlock: 5, hBlock: 1 },
    { xBlock: 14, yBlock: 13, wBlock: 6, hBlock: 1 },
    { xBlock: 32, yBlock: 19, wBlock: 4, hBlock: 1 },
  ],
  enemies: [
    // Rolling enemy 1 — Physical dust
    {
      xBlock: 20,
      yBlock: 15,
      kinds: [ParticleKind.Physical],
      particleCount: 18,
      isBossFlag: 0,
      isRollingEnemyFlag: 1,
      rollingEnemySpriteIndex: 1,
    },
    // Rolling enemy 2 — Metal dust
    {
      xBlock: 32,
      yBlock: 17,
      kinds: [ParticleKind.Metal],
      particleCount: 14,
      isBossFlag: 0,
      isRollingEnemyFlag: 1,
      rollingEnemySpriteIndex: 2,
    },
    // Flying Eye (Fire) — hovers mid-room
    {
      xBlock: 12,
      yBlock: 9,
      kinds: [ParticleKind.Fire],
      particleCount: 16,
      isBossFlag: 0,
      isFlyingEyeFlag: 1,
    },
    // Flying Eye (Wind) — hovers right side
    {
      xBlock: 30,
      yBlock: 7,
      kinds: [ParticleKind.Wind],
      particleCount: 16,
      isBossFlag: 0,
      isFlyingEyeFlag: 1,
    },
  ],
  playerSpawnBlock: [3, W1_ROOM_HEIGHT - 5],
  transitions: [
    {
      direction: 'left',
      targetRoomId: 'lobby',
      positionBlock: W1_TUNNEL_Y,
      openingSizeBlocks: TUNNEL_HEIGHT_BLOCKS,
      // LOBBY_WIDTH and LOBBY_TUNNEL_Y are used here but to avoid circular
      // imports we use literal values matching lobbyRoom.ts constants.
      targetSpawnBlock: [48 * 3 - 4, 16 + 2],
    },
    {
      direction: 'right',
      targetRoomId: 'boss_radiant_tether',
      positionBlock: W1_TUNNEL_Y,
      openingSizeBlocks: TUNNEL_HEIGHT_BLOCKS,
      targetSpawnBlock: [3, BOSS_TUNNEL_Y + 2],
    },
  ],
  skillTombs: [],
  // ── Environmental hazards ─────────────────────────────────────────────
  spikes: [
    // Spike pit below first platform
    { xBlock: 8, yBlock: 22, direction: 'up' as const },
    { xBlock: 9, yBlock: 22, direction: 'up' as const },
    { xBlock: 10, yBlock: 22, direction: 'up' as const },
  ],
  springboards: [
    // Springboard to reach higher platform
    { xBlock: 14, yBlock: 22 },
  ],
  breakableBlocks: [
    // Breakable wall blocking a shortcut
    { xBlock: 25, yBlock: 16 },
    { xBlock: 25, yBlock: 17 },
  ],
  dustBoostJars: [
    // Fire dust boost jar
    { xBlock: 30, yBlock: 18, dustKind: ParticleKind.Fire, dustCount: 12 },
  ],
  fireflyJars: [
    // Firefly jar on a platform
    { xBlock: 10, yBlock: 18 },
  ],
};
