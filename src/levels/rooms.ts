/**
 * Metroidvania room definitions.
 *
 * Layout:
 *   World 2 ← [LOBBY] → World 1
 *
 * The lobby is a neutral hub (world 0) with exits left and right.
 * Going RIGHT leads to World 1 rooms.
 * Going LEFT leads to World 2 rooms.
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

// ── Lobby (World 0) ──────────────────────────────────────────────────────────

const lobbyTunnels: TunnelOpening[] = [
  { direction: 'right', positionBlock: LOBBY_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
  { direction: 'left',  positionBlock: LOBBY_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
];

const lobbyBoundary = buildBoundaryWalls(LOBBY_WIDTH, LOBBY_HEIGHT, lobbyTunnels);
const lobbyTunnelWalls = buildTunnelWalls(LOBBY_WIDTH, lobbyTunnels);

export const ROOM_LOBBY: RoomDef = {
  id: 'lobby',
  name: 'Nexus Lobby',
  worldNumber: 0,
  widthBlocks: LOBBY_WIDTH,
  heightBlocks: LOBBY_HEIGHT,
  walls: [
    ...lobbyBoundary,
    ...lobbyTunnelWalls,
    // Interior platforms
    { xBlock: 12, yBlock: 18, wBlock: 6, hBlock: 1 },  // left platform
    { xBlock: 30, yBlock: 18, wBlock: 6, hBlock: 1 },  // right platform
    { xBlock: 20, yBlock: 15, wBlock: 8, hBlock: 1 },  // central high platform
  ],
  enemies: [],
  playerSpawnBlock: [24, 21],
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
    { xBlock: 24, yBlock: 14 },
  ],
};

// ── World 1, Room 1 ──────────────────────────────────────────────────────────

const W1_TUNNEL_Y = 16;

const w1r1Tunnels: TunnelOpening[] = [
  { direction: 'left', positionBlock: W1_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
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
    {
      xBlock: 20,
      yBlock: 15,
      kinds: [ParticleKind.Physical, ParticleKind.Earth],
      particleCount: 18,
      isBossFlag: 0,
    },
    {
      xBlock: 32,
      yBlock: 17,
      kinds: [ParticleKind.Physical],
      particleCount: 14,
      isBossFlag: 0,
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
  ],
  skillTombs: [],
};

// ── World 2, Room 1 ──────────────────────────────────────────────────────────

const W2_TUNNEL_Y = 16;

const w2r1Tunnels: TunnelOpening[] = [
  { direction: 'right', positionBlock: W2_TUNNEL_Y, sizeBlocks: TUNNEL_HEIGHT_BLOCKS },
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
    {
      xBlock: 12,
      yBlock: 16,
      kinds: [ParticleKind.Fire, ParticleKind.Lava],
      particleCount: 18,
      isBossFlag: 0,
    },
    {
      xBlock: 28,
      yBlock: 14,
      kinds: [ParticleKind.Fire],
      particleCount: 14,
      isBossFlag: 0,
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
  ],
  skillTombs: [],
};

// ── Room registry ────────────────────────────────────────────────────────────

/** All rooms keyed by id for quick lookup. */
export const ROOM_REGISTRY: ReadonlyMap<string, RoomDef> = new Map([
  [ROOM_LOBBY.id, ROOM_LOBBY],
  [ROOM_W1_ROOM1.id, ROOM_W1_ROOM1],
  [ROOM_W2_ROOM1.id, ROOM_W2_ROOM1],
]);

/** The room the player starts in. */
export const STARTING_ROOM_ID = 'lobby';
