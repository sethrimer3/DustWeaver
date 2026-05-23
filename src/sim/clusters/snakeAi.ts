import type { WorldState } from '../world';
import type { ClusterState } from './state';
import { nextFloat } from '../rng';
import { moveClusterByDelta, resetClusterGroundedFlag, resolveClusterFloorCollision } from './movementCollision';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { BLOCK_SIZE_SMALL, PLAYER_HALF_HEIGHT_WORLD, PLAYER_HALF_WIDTH_WORLD } from '../../levels/roomDef';

// ── Variant tuning constants ─────────────────────────────────────────────────

export const BIG_SNAKE_HP = 20;
const BIG_SNAKE_SPEED_WORLD = 28;
const BIG_SNAKE_CLIMB_SPEED_WORLD = 18;
const BIG_SNAKE_TURN_RATE_PER_SEC = 2.5;
const BIG_SNAKE_SEGMENT_COUNT = 18;
const BIG_SNAKE_SEGMENT_SPACING_WORLD = 5.5;
export const BIG_SNAKE_HALF_WIDTH_WORLD = 4.5;
export const BIG_SNAKE_HALF_HEIGHT_WORLD = 4.5;
const BIG_SNAKE_CONTACT_DAMAGE = 2;
const BIG_SNAKE_REPATH_INTERVAL_TICKS = 45;

export const NEEDLE_SNAKE_HP = 4;
const NEEDLE_SNAKE_SPEED_WORLD = 65;
const NEEDLE_SNAKE_CLIMB_SPEED_WORLD = 52;
const NEEDLE_SNAKE_TURN_RATE_PER_SEC = 6.0;
const NEEDLE_SNAKE_SEGMENT_COUNT = 14;
const NEEDLE_SNAKE_SEGMENT_SPACING_WORLD = 3.5;
export const NEEDLE_SNAKE_HALF_WIDTH_WORLD = 2.5;
export const NEEDLE_SNAKE_HALF_HEIGHT_WORLD = 2.5;
const NEEDLE_SNAKE_CONTACT_DAMAGE = 1;
const NEEDLE_SNAKE_REPATH_INTERVAL_TICKS = 25;

const STATE_PATROL = 0;
const STATE_PURSUE = 1;
const STATE_CLIMB = 2;
const STATE_REPATH = 3;
const STATE_RECOVER = 4;

const MAX_PATH_SEARCH_NODES = 512;
const MAX_STORED_PATH_NODES = 256;
const PLAYER_PURSUIT_RANGE_WORLD = 144.0;
const PLAYER_PURSUIT_RANGE_NEEDLE_WORLD = 184.0;
const PATROL_RADIUS_BIG_CELLS = 5;
const PATROL_RADIUS_NEEDLE_CELLS = 7;
const NODE_REACHED_DIST_WORLD = 4.0;
const NEEDLE_WOBBLE_STRENGTH = 0.45;
const SLITHER_FREQ_BIG = 0.18;
const SLITHER_FREQ_NEEDLE = 0.32;

interface SnakeSegments {
  xs: Float32Array;
  ys: Float32Array;
  count: number;
}

interface SnakePathState {
  cols: Int16Array;
  rows: Int16Array;
  length: number;
  index: number;
  wobbleSign: number;
}

const _snakeSegmentsByEntityId = new Map<number, SnakeSegments>();
const _snakePathByEntityId = new Map<number, SnakePathState>();

let _navSolidGridWidth = 0;
let _navSolidGridHeight = 0;
let _navSolidGrid = new Uint8Array(0);

const _neighborDx = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
const _neighborDy = [-1, -1, -1, 0, 0, 1, 1, 1] as const;

export function resetSnakeRuntimeState(): void {
  _snakeSegmentsByEntityId.clear();
  _snakePathByEntityId.clear();
  _navSolidGridWidth = 0;
  _navSolidGridHeight = 0;
  _navSolidGrid = new Uint8Array(0);
}

export function initializeSnakeSegments(
  entityId: number,
  headXWorld: number,
  headYWorld: number,
  segmentCount: number,
  segmentSpacingWorld: number,
  dirXWorld: number,
  dirYWorld: number,
): void {
  const xs = new Float32Array(segmentCount);
  const ys = new Float32Array(segmentCount);
  const len = Math.sqrt(dirXWorld * dirXWorld + dirYWorld * dirYWorld);
  const dirX = len > 0.0001 ? dirXWorld / len : 1.0;
  const dirY = len > 0.0001 ? dirYWorld / len : 0.0;
  for (let i = 0; i < segmentCount; i++) {
    xs[i] = headXWorld - dirX * segmentSpacingWorld * i;
    ys[i] = headYWorld - dirY * segmentSpacingWorld * i;
  }
  _snakeSegmentsByEntityId.set(entityId, { xs, ys, count: segmentCount });
}

export function getSnakeSegments(entityId: number): SnakeSegments | undefined {
  return _snakeSegmentsByEntityId.get(entityId);
}

function getSegmentCount(cluster: ClusterState): number {
  return cluster.isWallSnakeFlag === 1 ? BIG_SNAKE_SEGMENT_COUNT : NEEDLE_SNAKE_SEGMENT_COUNT;
}

function getSegmentSpacingWorld(cluster: ClusterState): number {
  return cluster.isWallSnakeFlag === 1 ? BIG_SNAKE_SEGMENT_SPACING_WORLD : NEEDLE_SNAKE_SEGMENT_SPACING_WORLD;
}

function getMoveSpeedWorld(cluster: ClusterState): number {
  return cluster.isWallSnakeFlag === 1 ? BIG_SNAKE_SPEED_WORLD : NEEDLE_SNAKE_SPEED_WORLD;
}

function getClimbSpeedWorld(cluster: ClusterState): number {
  return cluster.isWallSnakeFlag === 1 ? BIG_SNAKE_CLIMB_SPEED_WORLD : NEEDLE_SNAKE_CLIMB_SPEED_WORLD;
}

function getTurnRatePerSec(cluster: ClusterState): number {
  return cluster.isWallSnakeFlag === 1 ? BIG_SNAKE_TURN_RATE_PER_SEC : NEEDLE_SNAKE_TURN_RATE_PER_SEC;
}

function getContactDamage(cluster: ClusterState): number {
  return cluster.isWallSnakeFlag === 1 ? BIG_SNAKE_CONTACT_DAMAGE : NEEDLE_SNAKE_CONTACT_DAMAGE;
}

function getRepathIntervalTicks(cluster: ClusterState): number {
  return cluster.isWallSnakeFlag === 1 ? BIG_SNAKE_REPATH_INTERVAL_TICKS : NEEDLE_SNAKE_REPATH_INTERVAL_TICKS;
}

function getPlayerPursuitRangeWorld(cluster: ClusterState): number {
  return cluster.isWallSnakeFlag === 1 ? PLAYER_PURSUIT_RANGE_WORLD : PLAYER_PURSUIT_RANGE_NEEDLE_WORLD;
}

function getPatrolRadiusCells(cluster: ClusterState): number {
  return cluster.isWallSnakeFlag === 1 ? PATROL_RADIUS_BIG_CELLS : PATROL_RADIUS_NEEDLE_CELLS;
}

function setSnakeState(cluster: ClusterState, nextState: number): void {
  if (cluster.snakeAiState !== nextState) {
    cluster.snakeAiState = nextState;
    cluster.snakeAiStateTicks = 0;
  }
}

function rebuildNavSolidGrid(world: WorldState): void {
  const width = world.bgWallGridWidth;
  const height = world.bgWallGridHeight;
  if (width <= 0 || height <= 0) {
    _navSolidGridWidth = 0;
    _navSolidGridHeight = 0;
    _navSolidGrid = new Uint8Array(0);
    return;
  }
  if (
    _navSolidGridWidth === width &&
    _navSolidGridHeight === height &&
    _navSolidGrid.length === width * height &&
    world.tick !== 0
  ) {
    return;
  }

  _navSolidGridWidth = width;
  _navSolidGridHeight = height;
  _navSolidGrid = new Uint8Array(width * height);

  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallRampOrientationIndex[wi] !== 255) continue;
    const startCol = Math.max(0, Math.floor(world.wallXWorld[wi] / BLOCK_SIZE_SMALL));
    const startRow = Math.max(0, Math.floor(world.wallYWorld[wi] / BLOCK_SIZE_SMALL));
    const endCol = Math.min(width - 1, Math.ceil((world.wallXWorld[wi] + world.wallWWorld[wi]) / BLOCK_SIZE_SMALL) - 1);
    const endRow = Math.min(height - 1, Math.ceil((world.wallYWorld[wi] + world.wallHWorld[wi]) / BLOCK_SIZE_SMALL) - 1);
    for (let row = startRow; row <= endRow; row++) {
      const rowBase = row * width;
      for (let col = startCol; col <= endCol; col++) {
        _navSolidGrid[rowBase + col] = 1;
      }
    }
  }
}

function getCellIndex(col: number, row: number, width: number): number {
  return col + row * width;
}

function isCellInBounds(col: number, row: number, width: number, height: number): boolean {
  return col >= 0 && col < width && row >= 0 && row < height;
}

function getNodeKind(world: WorldState, col: number, row: number): number {
  const width = world.bgWallGridWidth;
  const height = world.bgWallGridHeight;
  if (!isCellInBounds(col, row, width, height)) return 0;
  const idx = getCellIndex(col, row, width);
  const isSolid = _navSolidGrid[idx] === 1;
  const isWall = !isSolid && world.bgWallGrid[idx] === 1;
  const isFloor = !isSolid && row + 1 < height && _navSolidGrid[getCellIndex(col, row + 1, width)] === 1;
  return (isFloor ? 1 : 0) | (isWall ? 2 : 0);
}

function isWallNode(world: WorldState, col: number, row: number): boolean {
  return (getNodeKind(world, col, row) & 2) !== 0;
}

function worldToCellCoord(valueWorld: number): number {
  return Math.floor(valueWorld / BLOCK_SIZE_SMALL);
}

function cellCenterWorld(col: number): number {
  return col * BLOCK_SIZE_SMALL + BLOCK_SIZE_SMALL * 0.5;
}

function findNearestValidNode(world: WorldState, col: number, row: number, maxRadius: number): { col: number; row: number } | null {
  const width = world.bgWallGridWidth;
  const height = world.bgWallGridHeight;
  let bestCol = 0;
  let bestRow = 0;
  let bestDistSq = Infinity;
  let found = false;
  for (let radius = 0; radius <= maxRadius; radius++) {
    const minCol = Math.max(0, col - radius);
    const maxCol = Math.min(width - 1, col + radius);
    const minRow = Math.max(0, row - radius);
    const maxRow = Math.min(height - 1, row + radius);
    for (let scanRow = minRow; scanRow <= maxRow; scanRow++) {
      for (let scanCol = minCol; scanCol <= maxCol; scanCol++) {
        if (getNodeKind(world, scanCol, scanRow) === 0) continue;
        const dx = scanCol - col;
        const dy = scanRow - row;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestCol = scanCol;
          bestRow = scanRow;
          found = true;
        }
      }
    }
    if (found) {
      return { col: bestCol, row: bestRow };
    }
  }
  return null;
}

function canTraverseBetween(world: WorldState, fromCol: number, fromRow: number, toCol: number, toRow: number): boolean {
  const fromKind = getNodeKind(world, fromCol, fromRow);
  const toKind = getNodeKind(world, toCol, toRow);
  if (fromKind === 0 || toKind === 0) return false;

  const dx = toCol - fromCol;
  const dy = toRow - fromRow;
  if (dx !== 0 && dy !== 0) {
    if (getNodeKind(world, fromCol + dx, fromRow) === 0 && getNodeKind(world, fromCol, fromRow + dy) === 0) {
      return false;
    }
  }

  const fromIsFloorOnly = fromKind === 1;
  const toIsFloorOnly = toKind === 1;
  if (fromIsFloorOnly && toIsFloorOnly && dy !== 0 && dx === 0) {
    return false;
  }

  return true;
}

function computeStepCost(world: WorldState, fromCol: number, fromRow: number, toCol: number, toRow: number): number {
  const diagonal = fromCol !== toCol && fromRow !== toRow;
  const moveBase = diagonal ? 1.41421356 : 1.0;
  return moveBase * (isWallNode(world, toCol, toRow) ? 1.2 : 1.0);
}

function estimateHeuristic(fromCol: number, fromRow: number, toCol: number, toRow: number): number {
  const dx = toCol - fromCol;
  const dy = toRow - fromRow;
  return Math.sqrt(dx * dx + dy * dy);
}

function ensureSnakeSegments(cluster: ClusterState): SnakeSegments {
  const expectedCount = getSegmentCount(cluster);
  const current = _snakeSegmentsByEntityId.get(cluster.entityId);
  if (current !== undefined && current.count === expectedCount) {
    return current;
  }
  initializeSnakeSegments(
    cluster.entityId,
    cluster.positionXWorld,
    cluster.positionYWorld,
    expectedCount,
    getSegmentSpacingWorld(cluster),
    cluster.snakeHeadDirXWorld,
    cluster.snakeHeadDirYWorld,
  );
  return _snakeSegmentsByEntityId.get(cluster.entityId)!;
}

function ensureSnakePathState(cluster: ClusterState): SnakePathState {
  let state = _snakePathByEntityId.get(cluster.entityId);
  if (state === undefined) {
    state = {
      cols: new Int16Array(MAX_STORED_PATH_NODES),
      rows: new Int16Array(MAX_STORED_PATH_NODES),
      length: 0,
      index: 0,
      wobbleSign: 1,
    };
    _snakePathByEntityId.set(cluster.entityId, state);
  }
  return state;
}

function choosePatrolTargetNode(world: WorldState, cluster: ClusterState): { col: number; row: number } | null {
  const baseCol = worldToCellCoord(cluster.snakeSpawnXWorld);
  const baseRow = worldToCellCoord(cluster.snakeSpawnYWorld);
  const radius = getPatrolRadiusCells(cluster);
  const targetCol = baseCol + Math.floor(nextFloat(world.rng) * (radius * 2 + 1)) - radius;
  const targetRow = baseRow + Math.floor(nextFloat(world.rng) * (radius + 1)) - Math.floor(radius * 0.5);
  return findNearestValidNode(world, targetCol, targetRow, radius + 4)
    ?? findNearestValidNode(world, baseCol, baseRow, radius + 4);
}

function computePathToTarget(
  world: WorldState,
  cluster: ClusterState,
  startCol: number,
  startRow: number,
  targetCol: number,
  targetRow: number,
): boolean {
  const width = world.bgWallGridWidth;
  const height = world.bgWallGridHeight;
  const cellCount = width * height;
  const gScore = new Float32Array(cellCount);
  const fScore = new Float32Array(cellCount);
  const cameFrom = new Int32Array(cellCount);
  const openFlags = new Uint8Array(cellCount);
  const closedFlags = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    gScore[i] = Infinity;
    fScore[i] = Infinity;
    cameFrom[i] = -1;
  }

  const startIdx = getCellIndex(startCol, startRow, width);
  const targetIdx = getCellIndex(targetCol, targetRow, width);
  const openSet: number[] = [startIdx];
  openFlags[startIdx] = 1;
  gScore[startIdx] = 0;
  fScore[startIdx] = estimateHeuristic(startCol, startRow, targetCol, targetRow);

  let visitedCount = 0;
  let bestIdx = startIdx;
  let bestHeuristic = fScore[startIdx];

  while (openSet.length > 0 && visitedCount < MAX_PATH_SEARCH_NODES) {
    let bestOpenIndex = 0;
    let currentIdx = openSet[0];
    let currentScore = fScore[currentIdx];
    for (let i = 1; i < openSet.length; i++) {
      const idx = openSet[i];
      if (fScore[idx] < currentScore) {
        currentScore = fScore[idx];
        currentIdx = idx;
        bestOpenIndex = i;
      }
    }

    openSet.splice(bestOpenIndex, 1);
    openFlags[currentIdx] = 0;
    closedFlags[currentIdx] = 1;
    visitedCount += 1;

    const currentCol = currentIdx % width;
    const currentRow = Math.floor(currentIdx / width);
    const heuristic = estimateHeuristic(currentCol, currentRow, targetCol, targetRow);
    if (heuristic < bestHeuristic) {
      bestHeuristic = heuristic;
      bestIdx = currentIdx;
    }
    if (currentIdx === targetIdx) {
      bestIdx = currentIdx;
      break;
    }

    for (let ni = 0; ni < _neighborDx.length; ni++) {
      const nextCol = currentCol + _neighborDx[ni];
      const nextRow = currentRow + _neighborDy[ni];
      if (!isCellInBounds(nextCol, nextRow, width, height)) continue;
      if (!canTraverseBetween(world, currentCol, currentRow, nextCol, nextRow)) continue;
      const nextIdx = getCellIndex(nextCol, nextRow, width);
      if (closedFlags[nextIdx] === 1) continue;

      const tentativeScore = gScore[currentIdx] + computeStepCost(world, currentCol, currentRow, nextCol, nextRow);
      if (tentativeScore >= gScore[nextIdx]) continue;

      cameFrom[nextIdx] = currentIdx;
      gScore[nextIdx] = tentativeScore;
      fScore[nextIdx] = tentativeScore + estimateHeuristic(nextCol, nextRow, targetCol, targetRow);
      if (openFlags[nextIdx] === 0) {
        openSet.push(nextIdx);
        openFlags[nextIdx] = 1;
      }
    }
  }

  const pathState = ensureSnakePathState(cluster);
  const reverseCols = new Int16Array(MAX_STORED_PATH_NODES);
  const reverseRows = new Int16Array(MAX_STORED_PATH_NODES);
  let reverseLength = 0;
  let walkIdx = bestIdx;
  while (walkIdx >= 0 && reverseLength < MAX_STORED_PATH_NODES) {
    reverseCols[reverseLength] = walkIdx % width;
    reverseRows[reverseLength] = Math.floor(walkIdx / width);
    reverseLength += 1;
    if (walkIdx === startIdx) break;
    walkIdx = cameFrom[walkIdx];
  }

  if (reverseLength <= 0) {
    pathState.length = 0;
    pathState.index = 0;
    return false;
  }

  pathState.length = reverseLength;
  pathState.index = reverseLength > 1 ? 1 : 0;
  for (let i = 0; i < reverseLength; i++) {
    const srcIndex = reverseLength - 1 - i;
    pathState.cols[i] = reverseCols[srcIndex];
    pathState.rows[i] = reverseRows[srcIndex];
  }
  return bestIdx === targetIdx || reverseLength > 1;
}

function maybeRepathSnake(
  world: WorldState,
  cluster: ClusterState,
  player: ClusterState | null,
): void {
  if (cluster.snakeRepathCooldownTicks > 0) return;

  const startNode = findNearestValidNode(
    world,
    worldToCellCoord(cluster.positionXWorld),
    worldToCellCoord(cluster.positionYWorld),
    4,
  );
  if (startNode === null) {
    setSnakeState(cluster, STATE_RECOVER);
    cluster.snakeRepathCooldownTicks = getRepathIntervalTicks(cluster);
    const pathState = ensureSnakePathState(cluster);
    pathState.length = 0;
    pathState.index = 0;
    return;
  }

  let targetNode: { col: number; row: number } | null = null;
  let shouldPursuePlayer = false;
  if (player !== null) {
    const dxToPlayer = player.positionXWorld - cluster.positionXWorld;
    const dyToPlayer = player.positionYWorld - cluster.positionYWorld;
    const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);
    if (distToPlayer <= getPlayerPursuitRangeWorld(cluster)) {
      shouldPursuePlayer = true;
      targetNode = findNearestValidNode(
        world,
        worldToCellCoord(player.positionXWorld),
        worldToCellCoord(player.positionYWorld),
        6,
      );
    }
  }
  if (targetNode === null) {
    targetNode = choosePatrolTargetNode(world, cluster);
  }
  if (targetNode === null) {
    setSnakeState(cluster, STATE_RECOVER);
    cluster.snakeRepathCooldownTicks = getRepathIntervalTicks(cluster);
    return;
  }

  const foundPath = computePathToTarget(world, cluster, startNode.col, startNode.row, targetNode.col, targetNode.row);
  const pathState = ensureSnakePathState(cluster);
  pathState.wobbleSign = nextFloat(world.rng) < 0.5 ? -1 : 1;
  cluster.snakeRepathCooldownTicks = getRepathIntervalTicks(cluster);

  if (!foundPath || pathState.length <= 0) {
    setSnakeState(cluster, STATE_RECOVER);
    return;
  }

  if (shouldPursuePlayer) {
    const nextNodeIsWall = pathState.index < pathState.length
      ? isWallNode(world, pathState.cols[pathState.index], pathState.rows[pathState.index])
      : false;
    setSnakeState(cluster, nextNodeIsWall ? STATE_CLIMB : STATE_PURSUE);
  } else {
    setSnakeState(cluster, STATE_PATROL);
  }
}

function updateBodySegments(cluster: ClusterState): void {
  const segments = ensureSnakeSegments(cluster);
  const spacingWorld = getSegmentSpacingWorld(cluster);
  segments.xs[0] = cluster.positionXWorld;
  segments.ys[0] = cluster.positionYWorld;
  for (let i = 1; i < segments.count; i++) {
    const leadX = segments.xs[i - 1];
    const leadY = segments.ys[i - 1];
    const dx = leadX - segments.xs[i];
    const dy = leadY - segments.ys[i];
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= 0.0001) continue;
    const invDist = 1.0 / dist;
    const followDist = Math.max(0.0, dist - spacingWorld);
    segments.xs[i] += dx * invDist * followDist;
    segments.ys[i] += dy * invDist * followDist;
  }
}

function clampSnakeToWorld(cluster: ClusterState, world: WorldState): void {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  if (cluster.positionXWorld < hw) {
    cluster.positionXWorld = hw;
    if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
  } else if (cluster.positionXWorld > world.worldWidthWorld - hw) {
    cluster.positionXWorld = world.worldWidthWorld - hw;
    if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
  }
  if (cluster.positionYWorld < hh) {
    cluster.positionYWorld = hh;
    if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
  } else if (cluster.positionYWorld > world.worldHeightWorld - hh) {
    cluster.positionYWorld = world.worldHeightWorld - hh;
    if (cluster.velocityYWorld > 0) cluster.velocityYWorld = 0;
    cluster.isGroundedFlag = 1;
  }
}

function updateSnakeMovement(
  world: WorldState,
  cluster: ClusterState,
  player: ClusterState | null,
  dtSec: number,
): void {
  const pathState = ensureSnakePathState(cluster);
  let targetXWorld = cluster.snakeSpawnXWorld;
  let targetYWorld = cluster.snakeSpawnYWorld;
  let targetOnWall = false;

  while (pathState.index < pathState.length) {
    const nodeCol = pathState.cols[pathState.index];
    const nodeRow = pathState.rows[pathState.index];
    const nodeXWorld = cellCenterWorld(nodeCol);
    const nodeYWorld = cellCenterWorld(nodeRow);
    const dxNode = nodeXWorld - cluster.positionXWorld;
    const dyNode = nodeYWorld - cluster.positionYWorld;
    if (dxNode * dxNode + dyNode * dyNode <= NODE_REACHED_DIST_WORLD * NODE_REACHED_DIST_WORLD) {
      pathState.index += 1;
      continue;
    }
    targetXWorld = nodeXWorld;
    targetYWorld = nodeYWorld;
    targetOnWall = isWallNode(world, nodeCol, nodeRow);
    break;
  }

  if (pathState.index >= pathState.length) {
    if (player !== null && cluster.snakeAiState === STATE_PURSUE) {
      targetXWorld = player.positionXWorld;
      targetYWorld = player.positionYWorld;
    } else {
      targetXWorld = cluster.snakeSpawnXWorld;
      targetYWorld = cluster.snakeSpawnYWorld;
    }
  }

  let desiredDirXWorld = targetXWorld - cluster.positionXWorld;
  let desiredDirYWorld = targetYWorld - cluster.positionYWorld;
  const desiredLen = Math.sqrt(desiredDirXWorld * desiredDirXWorld + desiredDirYWorld * desiredDirYWorld);
  if (desiredLen > 0.0001) {
    desiredDirXWorld /= desiredLen;
    desiredDirYWorld /= desiredLen;
  } else {
    desiredDirXWorld = cluster.snakeHeadDirXWorld;
    desiredDirYWorld = cluster.snakeHeadDirYWorld;
  }

  if (cluster.isNeedleSnakeFlag === 1 && cluster.snakeAiState === STATE_PURSUE) {
    const wobble = Math.sin(cluster.snakeSlitherPhaseRad * 1.8 + cluster.entityId * 0.37) * NEEDLE_WOBBLE_STRENGTH;
    const perpX = -desiredDirYWorld;
    const perpY = desiredDirXWorld;
    desiredDirXWorld += perpX * wobble * pathState.wobbleSign;
    desiredDirYWorld += perpY * wobble * pathState.wobbleSign;
    const wobbleLen = Math.sqrt(desiredDirXWorld * desiredDirXWorld + desiredDirYWorld * desiredDirYWorld);
    if (wobbleLen > 0.0001) {
      desiredDirXWorld /= wobbleLen;
      desiredDirYWorld /= wobbleLen;
    }
  }

  const turnBlend = Math.min(1.0, getTurnRatePerSec(cluster) * dtSec);
  let headDirXWorld = cluster.snakeHeadDirXWorld + (desiredDirXWorld - cluster.snakeHeadDirXWorld) * turnBlend;
  let headDirYWorld = cluster.snakeHeadDirYWorld + (desiredDirYWorld - cluster.snakeHeadDirYWorld) * turnBlend;
  const headLen = Math.sqrt(headDirXWorld * headDirXWorld + headDirYWorld * headDirYWorld);
  if (headLen > 0.0001) {
    headDirXWorld /= headLen;
    headDirYWorld /= headLen;
  } else {
    headDirXWorld = 1.0;
    headDirYWorld = 0.0;
  }
  cluster.snakeHeadDirXWorld = headDirXWorld;
  cluster.snakeHeadDirYWorld = headDirYWorld;

  const wasGrounded = cluster.isGroundedFlag === 1;
  resetClusterGroundedFlag(cluster);
  const speedWorld = targetOnWall ? getClimbSpeedWorld(cluster) : getMoveSpeedWorld(cluster);
  cluster.velocityXWorld = headDirXWorld * speedWorld;
  cluster.velocityYWorld = headDirYWorld * speedWorld;

  const moveResult = moveClusterByDelta(
    cluster,
    world,
    cluster.velocityXWorld * dtSec,
    cluster.velocityYWorld * dtSec,
    wasGrounded,
    dtSec,
  );
  clampSnakeToWorld(cluster, world);

  const currentCol = worldToCellCoord(cluster.positionXWorld);
  const currentRow = worldToCellCoord(cluster.positionYWorld);
  cluster.snakeIsOnWallFlag = isWallNode(world, currentCol, currentRow) || targetOnWall ? 1 : 0;
  if (cluster.snakeIsOnWallFlag === 1) {
    cluster.isGroundedFlag = 0;
  } else {
    resolveClusterFloorCollision(cluster, world);
  }

  if (moveResult.blockedX || moveResult.blockedY) {
    cluster.snakeRepathCooldownTicks = 0;
    if (cluster.snakeIsOnWallFlag === 1) {
      setSnakeState(cluster, STATE_REPATH);
    }
  }
}

export function applySnakeAI(world: WorldState): void {
  if (world.bgWallGridWidth <= 0 || world.bgWallGridHeight <= 0) return;
  rebuildNavSolidGrid(world);

  const dtSec = world.dtMs * 0.001;
  let player: ClusterState | null = null;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isPlayerFlag === 1 && cluster.isAliveFlag === 1) {
      player = cluster;
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isWallSnakeFlag !== 1 && cluster.isNeedleSnakeFlag !== 1) continue;
    if (cluster.isAliveFlag === 0) {
      _snakeSegmentsByEntityId.delete(cluster.entityId);
      _snakePathByEntityId.delete(cluster.entityId);
      continue;
    }

    ensureSnakeSegments(cluster);
    ensureSnakePathState(cluster);

    cluster.snakeAiStateTicks += 1;
    if (cluster.snakeRepathCooldownTicks > 0) {
      cluster.snakeRepathCooldownTicks -= 1;
    }

    maybeRepathSnake(world, cluster, player);
    updateSnakeMovement(world, cluster, player, dtSec);

    const phaseFreq = cluster.isWallSnakeFlag === 1 ? SLITHER_FREQ_BIG : SLITHER_FREQ_NEEDLE;
    const moveSpeedWorld = Math.sqrt(
      cluster.velocityXWorld * cluster.velocityXWorld +
      cluster.velocityYWorld * cluster.velocityYWorld,
    );
    cluster.snakeSlitherPhaseRad += moveSpeedWorld * dtSec * phaseFreq;
    updateBodySegments(cluster);

    const currentCol = worldToCellCoord(cluster.positionXWorld);
    const currentRow = worldToCellCoord(cluster.positionYWorld);
    if (cluster.snakeIsOnWallFlag === 1 || isWallNode(world, currentCol, currentRow)) {
      cluster.snakeIsOnWallFlag = 1;
      setSnakeState(cluster, STATE_CLIMB);
    } else if (cluster.snakeAiState === STATE_CLIMB) {
      setSnakeState(cluster, player !== null ? STATE_PURSUE : STATE_PATROL);
    }

    if (player !== null && player.invulnerabilityTicks <= 0) {
      const dx = Math.abs(cluster.positionXWorld - player.positionXWorld);
      const dy = Math.abs(cluster.positionYWorld - player.positionYWorld);
      if (
        dx < cluster.halfWidthWorld + PLAYER_HALF_WIDTH_WORLD &&
        dy < cluster.halfHeightWorld + PLAYER_HALF_HEIGHT_WORLD
      ) {
        applyPlayerDamageWithKnockback(player, getContactDamage(cluster), cluster.positionXWorld, cluster.positionYWorld);
      }
    }
  }
}
