/**
 * Metroidvania room definitions.
 *
 * Layout:
 *   World 3 ← World 2 ← [LOBBY] → World 1
 *
 * The lobby is a neutral hub (world 0) with exits left and right.
 * Going RIGHT leads to World 1 rooms.
 * Going LEFT leads to World 2 rooms.
 * Going further LEFT from World 2 leads to World 3 (fire/lava world).
 *
 * All coordinates are in block units (1 block = 30 world units).
 */

import { ParticleKind } from '../sim/particles/kinds';
import { RoomDef } from './roomDef';

// ── Tunnel constants ──────────────────────────────────────────────────────────

/** Height of tunnel openings in blocks. */
const TUNNEL_HEIGHT_BLOCKS = 5;
/** Extra blocks of tunnel corridor extending past the room boundary. */
const TUNNEL_OVERHANG_BLOCKS = 4;

// ── Helper: build boundary walls with optional tunnel openings ──────────────

interface TunnelOpening {
  direction: 'left' | 'right';
  positionBlock: number;
  sizeBlocks: number;
}

/**
 * Creates boundary wall segments for a room, with gaps for tunnel openings.
 * Returns wall definitions in block units.
 *
 * Room layout convention:
 *  - Top wall:    row 0, spans full width
 *  - Bottom wall: row (h-1), spans full width
 *  - Left wall:   col 0, spans full height (minus tunnels)
 *  - Right wall:  col (w-1), spans full height (minus tunnels)
 */
function buildBoundaryWalls(
  widthBlocks: number,
  heightBlocks: number,
  tunnels: readonly TunnelOpening[],
): { xBlock: number; yBlock: number; wBlock: number; hBlock: number }[] {
  const walls: { xBlock: number; yBlock: number; wBlock: number; hBlock: number }[] = [];

  // Top wall (full width)
  walls.push({ xBlock: 0, yBlock: 0, wBlock: widthBlocks, hBlock: 1 });
  // Bottom wall (full width)
  walls.push({ xBlock: 0, yBlock: heightBlocks - 1, wBlock: widthBlocks, hBlock: 1 });

  // Left wall — split around tunnel openings
  const leftTunnels = tunnels.filter(t => t.direction === 'left');
  buildSideWall(walls, 0, 1, heightBlocks - 2, leftTunnels);

  // Right wall — split around tunnel openings
  const rightTunnels = tunnels.filter(t => t.direction === 'right');
  buildSideWall(walls, widthBlocks - 1, 1, heightBlocks - 2, rightTunnels);

  return walls;
}

function buildSideWall(
  out: { xBlock: number; yBlock: number; wBlock: number; hBlock: number }[],
  xBlock: number,
  startYBlock: number,
  totalHeightBlocks: number,
  tunnels: readonly TunnelOpening[],
): void {
  // Sort tunnels by position
  const sorted = [...tunnels].sort((a, b) => a.positionBlock - b.positionBlock);

  let currentY = startYBlock;
  const endY = startYBlock + totalHeightBlocks;

  for (const tunnel of sorted) {
    const tunnelTop = tunnel.positionBlock;
    const tunnelBottom = tunnel.positionBlock + tunnel.sizeBlocks;

    // Wall segment above tunnel
    if (tunnelTop > currentY) {
      out.push({ xBlock, yBlock: currentY, wBlock: 1, hBlock: tunnelTop - currentY });
    }
    currentY = tunnelBottom;
  }

  // Wall segment below last tunnel
  if (currentY < endY) {
    out.push({ xBlock, yBlock: currentY, wBlock: 1, hBlock: endY - currentY });
  }
}

/**
 * Builds tunnel corridor walls (top and bottom lining blocks extending
 * past the room boundary for visual continuity).
 */
function buildTunnelWalls(
  roomWidthBlocks: number,
  tunnels: readonly TunnelOpening[],
): { xBlock: number; yBlock: number; wBlock: number; hBlock: number }[] {
  const walls: { xBlock: number; yBlock: number; wBlock: number; hBlock: number }[] = [];

  for (const tunnel of tunnels) {
    const topY = tunnel.positionBlock - 1;    // ceiling row
    const bottomY = tunnel.positionBlock + tunnel.sizeBlocks; // floor row

    if (tunnel.direction === 'left') {
      // Tunnel extends leftward from col 0
      walls.push({ xBlock: -TUNNEL_OVERHANG_BLOCKS, yBlock: topY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
      walls.push({ xBlock: -TUNNEL_OVERHANG_BLOCKS, yBlock: bottomY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
    } else {
      // Tunnel extends rightward from col (w-1)
      walls.push({ xBlock: roomWidthBlocks - 1, yBlock: topY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
      walls.push({ xBlock: roomWidthBlocks - 1, yBlock: bottomY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
    }
  }

  return walls;
}

// ── Room definitions ─────────────────────────────────────────────────────────

const LOBBY_WIDTH = 48;
const LOBBY_HEIGHT = 24;
const LOBBY_TUNNEL_Y = 16; // tunnel opening top row (above the floor)

const W1_ROOM_WIDTH = 40;
const W1_ROOM_HEIGHT = 24;

const W2_ROOM_WIDTH = 40;
const W2_ROOM_HEIGHT = 24;

const W3_ROOM_WIDTH = 44;
const W3_ROOM_HEIGHT = 24;

// ── Lobby (World 0) ──────────────────────────────────────────────────────────

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
};

// ── World 1, Room 1 ──────────────────────────────────────────────────────────

const W1_TUNNEL_Y = 16;

const BOSS_ROOM_WIDTH = 60;
const BOSS_ROOM_HEIGHT = 60;
const BOSS_TUNNEL_Y = 40;

const w1r1Tunnels: TunnelOpening[] = [
  { direction: 'left', positionBlock: W1_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
  { direction: 'right', positionBlock: W1_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
];

const w1r1Boundary = buildBoundaryWalls(W1_ROOM_WIDTH, W1_ROOM_HEIGHT, w1r1Tunnels);
const w1r1TunnelWalls = buildTunnelWalls(W1_ROOM_WIDTH, w1r1Tunnels);

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
      targetSpawnBlock: [LOBBY_WIDTH - 4, LOBBY_TUNNEL_Y + 2],
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
};

// ── World 2, Room 1 ──────────────────────────────────────────────────────────

const W2_TUNNEL_Y = 16;

const w2r1Tunnels: TunnelOpening[] = [
  { direction: 'right', positionBlock: W2_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
  { direction: 'left',  positionBlock: W2_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
];

const w2r1Boundary = buildBoundaryWalls(W2_ROOM_WIDTH, W2_ROOM_HEIGHT, w2r1Tunnels);
const w2r1TunnelWalls = buildTunnelWalls(W2_ROOM_WIDTH, w2r1Tunnels);

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
      targetSpawnBlock: [3, LOBBY_TUNNEL_Y + 2],
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
};

// ── World 3, Room 1 (Fire/Lava World) ────────────────────────────────────────

const W3_TUNNEL_Y = 16;

const w3r1Tunnels: TunnelOpening[] = [
  { direction: 'right', positionBlock: W3_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
];

const w3r1Boundary = buildBoundaryWalls(W3_ROOM_WIDTH, W3_ROOM_HEIGHT, w3r1Tunnels);
const w3r1TunnelWalls = buildTunnelWalls(W3_ROOM_WIDTH, w3r1Tunnels);

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
      targetSpawnBlock: [3, W2_TUNNEL_Y + 2],
    },
  ],
  skillTombs: [],
};

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

// ── Room registry ────────────────────────────────────────────────────────────

/** All rooms keyed by id for quick lookup. */
export const ROOM_REGISTRY: ReadonlyMap<string, RoomDef> = new Map([
  [ROOM_LOBBY.id, ROOM_LOBBY],
  [ROOM_W1_ROOM1.id, ROOM_W1_ROOM1],
  [ROOM_W2_ROOM1.id, ROOM_W2_ROOM1],
  [ROOM_W3_ROOM1.id, ROOM_W3_ROOM1],
  [ROOM_BOSS_RADIANT_TETHER.id, ROOM_BOSS_RADIANT_TETHER],
]);

/** The room the player starts in. */
export const STARTING_ROOM_ID = 'lobby';
