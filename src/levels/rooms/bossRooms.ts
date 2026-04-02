/**
 * Boss room definitions.
 */

import { ParticleKind } from '../../sim/particles/kinds';
import { RoomDef } from '../roomDef';
import {
  buildBoundaryWalls,
  buildTunnelWalls,
  TUNNEL_HEIGHT_BLOCKS,
  TunnelOpening,
} from './roomBuilders';
import { W1_ROOM_WIDTH, W1_TUNNEL_Y, BOSS_TUNNEL_Y } from './world1Rooms';

// ── Boss Room dimensions ─────────────────────────────────────────────────────

const BOSS_ROOM_WIDTH = 60;
const BOSS_ROOM_HEIGHT = 60;

// ── Boss Room: Radiant Tether ────────────────────────────────────────────────

const bossRoomTunnels: TunnelOpening[] = [
  { direction: 'left', positionBlock: BOSS_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
];

const bossRoomBoundary = buildBoundaryWalls(BOSS_ROOM_WIDTH, BOSS_ROOM_HEIGHT, bossRoomTunnels);
const bossRoomTunnelWalls = buildTunnelWalls(BOSS_ROOM_WIDTH, bossRoomTunnels);

export const ROOM_BOSS_RADIANT_TETHER: RoomDef = {
  id: 'boss_radiant_tether',
  name: 'Luminous Chamber',
  worldNumber: 1,
  widthBlocks: BOSS_ROOM_WIDTH,
  heightBlocks: BOSS_ROOM_HEIGHT,
  walls: [
    ...bossRoomBoundary,
    ...bossRoomTunnelWalls,
    // Square chamber — thick walls on all sides for solid chain anchoring
    // Thicken left wall (cols 1-2)
    { xBlock: 1, yBlock: 1, wBlock: 2, hBlock: 20 },
    { xBlock: 1, yBlock: 22, wBlock: 1, hBlock: 16 },
    { xBlock: 1, yBlock: 46, wBlock: 2, hBlock: 13 },
    // Thicken right wall (cols 57-58)
    { xBlock: 57, yBlock: 1, wBlock: 2, hBlock: 20 },
    { xBlock: 58, yBlock: 22, wBlock: 1, hBlock: 16 },
    { xBlock: 57, yBlock: 46, wBlock: 2, hBlock: 13 },
    // Thicken ceiling (rows 1-2)
    { xBlock: 3, yBlock: 1, wBlock: 54, hBlock: 2 },
    // Thicken floor (rows 57-58)
    { xBlock: 3, yBlock: 57, wBlock: 54, hBlock: 2 },
    // Small platforms for player to use as cover / parkour
    { xBlock: 10, yBlock: 48, wBlock: 5, hBlock: 1 },
    { xBlock: 45, yBlock: 48, wBlock: 5, hBlock: 1 },
    { xBlock: 25, yBlock: 45, wBlock: 10, hBlock: 1 },
    { xBlock: 8,  yBlock: 35, wBlock: 4, hBlock: 1 },
    { xBlock: 48, yBlock: 35, wBlock: 4, hBlock: 1 },
    { xBlock: 15, yBlock: 25, wBlock: 4, hBlock: 1 },
    { xBlock: 41, yBlock: 25, wBlock: 4, hBlock: 1 },
  ],
  enemies: [
    {
      xBlock: 30,
      yBlock: 20,
      kinds: [ParticleKind.Holy, ParticleKind.Lightning],
      particleCount: 50,
      isBossFlag: 1,
      isRadiantTetherFlag: 1,
    },
  ],
  playerSpawnBlock: [3, BOSS_TUNNEL_Y + 2],
  transitions: [
    {
      direction: 'left',
      targetRoomId: 'w1_room1',
      positionBlock: BOSS_TUNNEL_Y,
      openingSizeBlocks: TUNNEL_HEIGHT_BLOCKS,
      targetSpawnBlock: [W1_ROOM_WIDTH - 4, W1_TUNNEL_Y + 2],
    },
  ],
  skillTombs: [],
};
