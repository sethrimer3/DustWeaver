/**
 * Reusable room-layout helper functions for building boundary walls
 * and tunnel corridors.
 */

// ── Tunnel constants ──────────────────────────────────────────────────────────

/** Height of tunnel openings in blocks. */
export const TUNNEL_HEIGHT_BLOCKS = 5;
/** Extra blocks of tunnel corridor extending past the room boundary. */
export const TUNNEL_OVERHANG_BLOCKS = 4;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TunnelOpening {
  direction: 'left' | 'right';
  positionBlock: number;
  sizeBlocks: number;
}

// ── Helper: build boundary walls with optional tunnel openings ──────────────

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
export function buildBoundaryWalls(
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

export function buildSideWall(
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
export function buildTunnelWalls(
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
