/**
 * Lobby (World 0) — Stone Hollow.
 *
 * The lobby is a neutral hub with exits left (→ World 2) and right (→ World 1).
 */

import { ParticleKind } from '../../sim/particles/kinds';
import { RoomDef } from '../roomDef';
import {
  buildBoundaryWalls,
  buildTunnelWalls,
  TUNNEL_HEIGHT_BLOCKS,
  TunnelOpening,
} from './roomBuilders';
import { W1_ROOM_HEIGHT } from './world1Rooms';
import { W2_ROOM_WIDTH, W2_ROOM_HEIGHT } from './world2Rooms';

// ── Lobby dimensions ─────────────────────────────────────────────────────────

export const LOBBY_WIDTH = 48 * 3;
export const LOBBY_HEIGHT = 24 * 3;
export const LOBBY_TUNNEL_Y = 16; // tunnel opening top row (above the floor)

// ── Lobby room definition ────────────────────────────────────────────────────

const lobbyTunnels: TunnelOpening[] = [
  { direction: 'right', positionBlock: LOBBY_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
  { direction: 'left',  positionBlock: LOBBY_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
];

const lobbyBoundary = buildBoundaryWalls(LOBBY_WIDTH, LOBBY_HEIGHT, lobbyTunnels);
const lobbyTunnelWalls = buildTunnelWalls(LOBBY_WIDTH, lobbyTunnels);

export const ROOM_LOBBY: RoomDef = {
  id: 'lobby',
  name: 'Stone Hollow',
  worldNumber: 0,
  widthBlocks: LOBBY_WIDTH,
  heightBlocks: LOBBY_HEIGHT,
  walls: [
    ...lobbyBoundary,
    ...lobbyTunnelWalls,

    // ── Uneven ceiling stalactites (interior ceiling bumps, row 1–3) ───────
    { xBlock: 5,  yBlock: 1, wBlock: 2, hBlock: 2 },
    { xBlock: 10, yBlock: 1, wBlock: 3, hBlock: 1 },
    { xBlock: 16, yBlock: 1, wBlock: 1, hBlock: 3 },
    { xBlock: 17, yBlock: 1, wBlock: 2, hBlock: 2 },
    { xBlock: 22, yBlock: 1, wBlock: 4, hBlock: 1 },
    { xBlock: 28, yBlock: 1, wBlock: 2, hBlock: 2 },
    { xBlock: 33, yBlock: 1, wBlock: 1, hBlock: 3 },
    { xBlock: 37, yBlock: 1, wBlock: 3, hBlock: 1 },
    { xBlock: 42, yBlock: 1, wBlock: 2, hBlock: 2 },

    // ── Irregular left wall insets (thicken left boundary, cols 1–3) ───────
    { xBlock: 1, yBlock: 2,  wBlock: 2, hBlock: 3 },
    { xBlock: 1, yBlock: 7,  wBlock: 1, hBlock: 4 },
    { xBlock: 1, yBlock: 12, wBlock: 3, hBlock: 2 },
    { xBlock: 1, yBlock: 21, wBlock: 2, hBlock: 2 },

    // ── Irregular right wall insets (thicken right boundary) ───────────────
    { xBlock: 45, yBlock: 2,  wBlock: 2, hBlock: 3 },
    { xBlock: 46, yBlock: 7,  wBlock: 1, hBlock: 3 },
    { xBlock: 44, yBlock: 12, wBlock: 3, hBlock: 2 },
    { xBlock: 45, yBlock: 21, wBlock: 2, hBlock: 2 },

    // ── Uneven floor — main cave floor (row 20–22, not flat) ──────────────
    // Left floor section (stepped up slightly on the far left)
    { xBlock: 1,  yBlock: 21, wBlock: 4, hBlock: 2 },
    { xBlock: 5,  yBlock: 22, wBlock: 5, hBlock: 1 },
    { xBlock: 10, yBlock: 21, wBlock: 3, hBlock: 2 },
    { xBlock: 13, yBlock: 22, wBlock: 3, hBlock: 1 },

    // Left dip / lower floor area (row 22 only — a small valley)
    { xBlock: 16, yBlock: 22, wBlock: 2, hBlock: 1 },

    // Central plateau — 8 blocks wide, top at row 19 (3 blocks above row 22 baseline)
    { xBlock: 20, yBlock: 19, wBlock: 8, hBlock: 4 },

    // Right floor section (stepped and uneven)
    { xBlock: 28, yBlock: 22, wBlock: 3, hBlock: 1 },
    { xBlock: 31, yBlock: 21, wBlock: 3, hBlock: 2 },
    { xBlock: 34, yBlock: 22, wBlock: 4, hBlock: 1 },
    { xBlock: 38, yBlock: 21, wBlock: 3, hBlock: 2 },
    { xBlock: 41, yBlock: 22, wBlock: 3, hBlock: 1 },
    { xBlock: 44, yBlock: 21, wBlock: 3, hBlock: 2 },

    // ── Rocky outcrops / small ledges for visual interest ──────────────────
    { xBlock: 7,  yBlock: 17, wBlock: 3, hBlock: 1 },  // left ledge
    { xBlock: 38, yBlock: 17, wBlock: 3, hBlock: 1 },  // right ledge

    // ── Stepped edges connecting to plateau (avoid floating terrain) ───────
    { xBlock: 18, yBlock: 21, wBlock: 2, hBlock: 2 },  // left step to plateau
    { xBlock: 28, yBlock: 21, wBlock: 2, hBlock: 2 },  // right step from plateau
  ],
  enemies: [
    // Rock Elemental — on lower floor, >10 blocks from plateau center (x=24)
    {
      xBlock: 10,
      yBlock: 20,
      kinds: [ParticleKind.Earth],
      particleCount: 12,
      isBossFlag: 0,
      isRockElementalFlag: 1,
    },
  ],
  // Player spawn centered on plateau top (plateau x=20..28, top=row 19, spawn on 18=row above)
  playerSpawnBlock: [24, 18],
  transitions: [
    {
      direction: 'right',
      targetRoomId: 'w1_room1',
      positionBlock: LOBBY_TUNNEL_Y,
      openingSizeBlocks: TUNNEL_HEIGHT_BLOCKS,
      targetSpawnBlock: [3, W1_ROOM_HEIGHT - 5],
    },
    {
      direction: 'left',
      targetRoomId: 'w2_room1',
      positionBlock: LOBBY_TUNNEL_Y,
      openingSizeBlocks: TUNNEL_HEIGHT_BLOCKS,
      targetSpawnBlock: [W2_ROOM_WIDTH - 4, W2_ROOM_HEIGHT - 5],
    },
  ],
  skillTombs: [
    // Skill tome on plateau, 2 blocks right of spawn (24+2=26)
    { xBlock: 26, yBlock: 18 },
  ],
  skillBooks: [
    // Golden Dust skillbook in the lobby, left side of the plateau.
    { xBlock: 22, yBlock: 18 },
  ],
  dustContainers: [
    // Dust Container collectible, right side of the plateau.
    { xBlock: 30, yBlock: 18 },
  ],
};
