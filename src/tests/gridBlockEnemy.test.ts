import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyGridBlockEnemyAI,
  applyGridSnakeEnemyAI,
  DEFAULT_GRID_SNAKE_LENGTH,
  GRID_BLOCK_HALF_SIZE,
  GRID_SNAKE_HALF_SIZE,
  initializeGridSnakeSegments,
} from '../sim/clusters/gridBlockEnemyAi';
import { spawnEnemyClusters } from '../screens/gameEnemySpawn';
import { enemyFlagsToType } from '../levels/roomSchemaV2';
import { enemyTypeToFlags } from '../levels/roomSchemaHydrator';
import type { RoomJsonEnemy } from '../editor/roomJsonSchema';
import type { RoomEnemyDef } from '../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { createRng } from '../sim/rng';
import { createWorldState } from '../sim/world';

const BS = BLOCK_SIZE_SMALL;

function makeWall(x: number, y: number, w: number, h: number) {
  return { x, y, w, h };
}

function makeWorld(opts: {
  widthBlocks?: number;
  heightBlocks?: number;
  walls?: { x: number; y: number; w: number; h: number }[];
  clusters?: ReturnType<typeof makeBlockEnemy | typeof makeGridSnake | typeof makePlayer>[];
  dtMs?: number;
}) {
  const wb = opts.widthBlocks ?? 20;
  const hb = opts.heightBlocks ?? 15;
  const walls = opts.walls ?? [];
  const wc = walls.length;

  const wallXWorld = new Float32Array(wc);
  const wallYWorld = new Float32Array(wc);
  const wallWWorld = new Float32Array(wc);
  const wallHWorld = new Float32Array(wc);
  const wallIsPlatformFlag = new Uint8Array(wc);
  const wallRampOrientationIndex = new Uint8Array(wc).fill(255);
  const wallIsInvisibleFlag = new Uint8Array(wc);

  walls.forEach((w, i) => {
    wallXWorld[i] = w.x;
    wallYWorld[i] = w.y;
    wallWWorld[i] = w.w;
    wallHWorld[i] = w.h;
  });

  return {
    dtMs: opts.dtMs ?? (1000 / 60),
    worldWidthWorld: wb * BS,
    worldHeightWorld: hb * BS,
    wallCount: wc,
    wallXWorld,
    wallYWorld,
    wallWWorld,
    wallHWorld,
    wallIsPlatformFlag,
    wallRampOrientationIndex,
    wallIsInvisibleFlag,
    clusters: opts.clusters ?? [],
  } as unknown as import('../sim/world').WorldState;
}

function makeBlockEnemy(overrides: {
  sizeIndex?: 0 | 1;
  speedIndex?: 0 | 1 | 2;
  gridX?: number;
  gridY?: number;
  hp?: number;
}) {
  const sz = overrides.sizeIndex ?? 0;
  const sp = overrides.speedIndex ?? 0;
  const gx = overrides.gridX ?? 2;
  const gy = overrides.gridY ?? 2;
  const hw = GRID_BLOCK_HALF_SIZE[sz];
  const hp = overrides.hp ?? 10;

  return {
    entityId: 1,
    isAliveFlag: 1 as 0 | 1,
    isPlayerFlag: 0 as 0 | 1,
    isGridBlockEnemyFlag: 1 as 0 | 1,
    isGridSnakeEnemyFlag: 0 as 0 | 1,
    gridBlockSizeIndex: sz,
    gridBlockSpeedIndex: sp,
    gridBlockGridX: gx,
    gridBlockGridY: gy,
    gridBlockTargetGridX: gx,
    gridBlockTargetGridY: gy,
    gridBlockMoveTicks: 0,
    gridBlockRepathCooldownTicks: 0,
    gridBlockNextDirX: 0,
    gridBlockNextDirY: 0,
    gridBlockGlintPhase: 0,
    gridBlockHitFlashTicks: 0,
    gridBlockPrevHealthPoints: hp,
    gridBlockAiState: 0,
    gridBlockChargeDirX: 0,
    gridBlockChargeDirY: 0,
    gridBlockChargeSpeedWorld: 0,
    gridBlockRecoverTicks: 0,
    positionXWorld: gx * BS + hw,
    positionYWorld: gy * BS + hw,
    halfWidthWorld: hw,
    halfHeightWorld: hw,
    velocityXWorld: 0,
    velocityYWorld: 0,
    healthPoints: hp,
    maxHealthPoints: hp,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
  };
}

function makeGridSnake(overrides: {
  gridX?: number;
  gridY?: number;
  length?: number;
  hp?: number;
}) {
  const gx = overrides.gridX ?? 2;
  const gy = overrides.gridY ?? 2;
  const length = overrides.length ?? DEFAULT_GRID_SNAKE_LENGTH;
  const hp = overrides.hp ?? 8;
  const snake = {
    entityId: 2,
    isAliveFlag: 1 as 0 | 1,
    isPlayerFlag: 0 as 0 | 1,
    isGridBlockEnemyFlag: 0 as 0 | 1,
    isGridSnakeEnemyFlag: 1 as 0 | 1,
    gridSnakeLength: length,
    gridSnakeGridX: gx,
    gridSnakeGridY: gy,
    gridSnakeTargetGridX: gx,
    gridSnakeTargetGridY: gy,
    gridSnakeMoveTicks: 0,
    gridSnakeRepathCooldownTicks: 0,
    gridSnakeNextDirX: 0,
    gridSnakeNextDirY: 0,
    gridSnakeSegmentGridX: [] as number[],
    gridSnakeSegmentGridY: [] as number[],
    gridSnakePhase: 0,
    gridSnakePrevHealthPoints: hp,
    gridBlockHitFlashTicks: 0,
    positionXWorld: gx * BS + GRID_SNAKE_HALF_SIZE,
    positionYWorld: gy * BS + GRID_SNAKE_HALF_SIZE,
    halfWidthWorld: GRID_SNAKE_HALF_SIZE,
    halfHeightWorld: GRID_SNAKE_HALF_SIZE,
    velocityXWorld: 0,
    velocityYWorld: 0,
    healthPoints: hp,
    maxHealthPoints: hp,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
  };
  initializeGridSnakeSegments(snake as never, length);
  return snake;
}

function makePlayer(x: number, y: number) {
  return {
    entityId: 0,
    isAliveFlag: 1 as 0 | 1,
    isPlayerFlag: 1 as 0 | 1,
    isGridBlockEnemyFlag: 0 as 0 | 1,
    isGridSnakeEnemyFlag: 0 as 0 | 1,
    positionXWorld: x,
    positionYWorld: y,
    halfWidthWorld: 6,
    halfHeightWorld: 8,
    velocityXWorld: 0,
    velocityYWorld: 0,
    healthPoints: 10,
    maxHealthPoints: 10,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
    isGroundedFlag: 0 as 0 | 1,
    varJumpTimerTicks: 0,
  };
}

test('snake moves orthogonally one grid cell at a time', () => {
  const snake = makeGridSnake({ gridX: 2, gridY: 2 });
  const player = makePlayer(8 * BS, 2 * BS);
  const world = makeWorld({ clusters: [player, snake] });

  applyGridSnakeEnemyAI(world);

  assert.equal(snake.gridSnakeTargetGridX, 3);
  assert.equal(snake.gridSnakeTargetGridY, 2);
  assert.notEqual(snake.gridSnakeNextDirX, 1);
});

test('snake body segments follow the head previous positions', () => {
  const snake = makeGridSnake({ gridX: 2, gridY: 2, length: 4 });
  const player = makePlayer(8 * BS, 2 * BS);
  const world = makeWorld({ clusters: [player, snake] });

  for (let i = 0; i < 20; i++) applyGridSnakeEnemyAI(world);

  assert.equal(snake.gridSnakeGridX, 3);
  assert.equal(snake.gridSnakeGridY, 2);
  assert.equal(snake.gridSnakeSegmentGridX[0], 2);
  assert.equal(snake.gridSnakeSegmentGridY[0], 2);
  assert.equal(snake.gridSnakeSegmentGridX[1], 1);
  assert.equal(snake.gridSnakeSegmentGridY[1], 2);
});

test('snake cannot enter walls', () => {
  const snake = makeGridSnake({ gridX: 2, gridY: 2 });
  const player = makePlayer(8 * BS, 2 * BS);
  const walls = [makeWall(3 * BS, 2 * BS, BS, BS)];
  const world = makeWorld({ walls, clusters: [player, snake] });

  applyGridSnakeEnemyAI(world);

  assert.notEqual(`${snake.gridSnakeTargetGridX},${snake.gridSnakeTargetGridY}`, '3,2');
});

test('snake contact damages from body segments', () => {
  const snake = makeGridSnake({ gridX: 4, gridY: 2 });
  const player = makePlayer(3 * BS + GRID_SNAKE_HALF_SIZE, 2 * BS + GRID_SNAKE_HALF_SIZE);
  const world = makeWorld({ clusters: [player, snake] });

  applyGridSnakeEnemyAI(world);

  assert.ok(player.healthPoints < 10);
});

test('snake remains grid-aligned after many ticks', () => {
  const snake = makeGridSnake({ gridX: 1, gridY: 1 });
  const player = makePlayer(10 * BS, 8 * BS);
  const world = makeWorld({ widthBlocks: 12, heightBlocks: 10, clusters: [player, snake] });

  for (let i = 0; i < 300; i++) applyGridSnakeEnemyAI(world);

  if (snake.gridSnakeMoveTicks === 0) {
    assert.equal(snake.positionXWorld, snake.gridSnakeGridX * BS + GRID_SNAKE_HALF_SIZE);
    assert.equal(snake.positionYWorld, snake.gridSnakeGridY * BS + GRID_SNAKE_HALF_SIZE);
  }
  for (let i = 0; i < snake.gridSnakeLength; i++) {
    assert.equal(Number.isInteger(snake.gridSnakeSegmentGridX[i]), true);
    assert.equal(Number.isInteger(snake.gridSnakeSegmentGridY[i]), true);
  }
});

test('block enemy detects a direct row slide crossing the player', () => {
  const enemy = makeBlockEnemy({ speedIndex: 0, gridX: 1, gridY: 2 });
  const player = makePlayer(5 * BS + 4, 2 * BS + 4);
  const world = makeWorld({ widthBlocks: 8, heightBlocks: 5, clusters: [player, enemy] });

  applyGridBlockEnemyAI(world);

  assert.equal(enemy.gridBlockAiState, 1);
  assert.equal(enemy.gridBlockChargeDirX, 1);
  assert.equal(enemy.gridBlockChargeDirY, 0);
  assert.equal(enemy.gridBlockTargetGridX, 7);
});

test('block enemy commits to one direction until wall impact', () => {
  const enemy = makeBlockEnemy({ speedIndex: 2, gridX: 1, gridY: 2 });
  const player = makePlayer(6 * BS + 4, 2 * BS + 4);
  const world = makeWorld({ widthBlocks: 8, heightBlocks: 5, clusters: [player, enemy] });

  applyGridBlockEnemyAI(world);
  const dirX = enemy.gridBlockChargeDirX;
  for (let i = 0; i < 60 && enemy.gridBlockAiState === 1; i++) {
    applyGridBlockEnemyAI(world);
    assert.equal(enemy.gridBlockChargeDirX, dirX);
    assert.equal(enemy.gridBlockChargeDirY, 0);
  }

  assert.equal(enemy.gridBlockAiState, 2);
  assert.equal(enemy.gridBlockGridX, 7);
  assert.equal(enemy.gridBlockGridY, 2);
});

test('block enemy accelerates up to top speed', () => {
  const enemy = makeBlockEnemy({ speedIndex: 1, gridX: 1, gridY: 1 });
  const player = makePlayer(10 * BS + 4, BS + 4);
  const world = makeWorld({ widthBlocks: 12, heightBlocks: 4, clusters: [player, enemy] });

  applyGridBlockEnemyAI(world);
  applyGridBlockEnemyAI(world);
  const speedA = enemy.gridBlockChargeSpeedWorld;
  applyGridBlockEnemyAI(world);
  const speedB = enemy.gridBlockChargeSpeedWorld;

  assert.ok(speedB > speedA);
  assert.ok(speedB <= 112);
});

test('block enemy stops at the last legal cell before a wall', () => {
  const enemy = makeBlockEnemy({ speedIndex: 2, gridX: 1, gridY: 2 });
  const walls = [makeWall(5 * BS, 2 * BS, BS, BS)];
  const world = makeWorld({ widthBlocks: 9, heightBlocks: 5, walls, clusters: [enemy] });
  enemy.gridBlockNextDirX = 1;
  enemy.gridBlockRepathCooldownTicks = 100;

  for (let i = 0; i < 90; i++) applyGridBlockEnemyAI(world);

  assert.equal(enemy.gridBlockGridX, 4);
  assert.equal(enemy.gridBlockGridY, 2);
});

test('2x2 block enemy never clips outside right or bottom bounds', () => {
  const enemy = makeBlockEnemy({ sizeIndex: 1, speedIndex: 2, gridX: 1, gridY: 1 });
  const player = makePlayer(10 * BS, 10 * BS);
  const world = makeWorld({ widthBlocks: 6, heightBlocks: 5, clusters: [player, enemy] });

  for (let i = 0; i < 300; i++) {
    applyGridBlockEnemyAI(world);
    assert.ok(enemy.gridBlockGridX + 2 <= 6);
    assert.ok(enemy.gridBlockGridY + 2 <= 5);
    assert.ok(enemy.gridBlockTargetGridX + 2 <= 6);
    assert.ok(enemy.gridBlockTargetGridY + 2 <= 5);
  }
});

test('block enemy BFSes through slide-resting positions to set up a future slide', () => {
  const enemy = makeBlockEnemy({ speedIndex: 0, gridX: 1, gridY: 1 });
  const player = makePlayer(5 * BS + 4, 5 * BS + 4);
  const world = makeWorld({ widthBlocks: 7, heightBlocks: 7, clusters: [player, enemy] });

  applyGridBlockEnemyAI(world);

  assert.equal(enemy.gridBlockAiState, 1);
  assert.equal(enemy.gridBlockChargeDirX, 1);
  assert.equal(enemy.gridBlockChargeDirY, 0);
  assert.equal(enemy.gridBlockTargetGridX, 6);
  assert.equal(enemy.gridBlockTargetGridY, 1);
});

test('block enemy deals contact damage during charge', () => {
  const enemy = makeBlockEnemy({ speedIndex: 2, gridX: 1, gridY: 2 });
  const player = makePlayer(2 * BS + 4, 2 * BS + 4);
  const world = makeWorld({ widthBlocks: 8, heightBlocks: 5, clusters: [player, enemy] });

  for (let i = 0; i < 10; i++) applyGridBlockEnemyAI(world);

  assert.ok(player.healthPoints < 10);
});

test('block enemy pauses briefly after wall impact', () => {
  const enemy = makeBlockEnemy({ speedIndex: 2, gridX: 1, gridY: 1 });
  const player = makePlayer(5 * BS + 4, BS + 4);
  const world = makeWorld({ widthBlocks: 6, heightBlocks: 4, clusters: [player, enemy] });

  for (let i = 0; i < 90 && enemy.gridBlockAiState !== 2; i++) applyGridBlockEnemyAI(world);

  assert.equal(enemy.gridBlockAiState, 2);
  assert.ok(enemy.gridBlockRecoverTicks > 0);
  const x = enemy.positionXWorld;
  applyGridBlockEnemyAI(world);
  assert.equal(enemy.positionXWorld, x);
});

test('spawn normalizes grid block size/speed and clamps 2x2 footprint in bounds', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 5 * BS;
  world.worldHeightWorld = 4 * BS;
  const enemyDef = {
    xBlock: 999,
    yBlock: 999,
    kinds: [],
    particleCount: 6,
    isBossFlag: 0,
    isGridBlockEnemyFlag: 1,
    gridBlockSizeIndex: 1,
    gridBlockSpeedIndex: 99,
  } as unknown as RoomEnemyDef;

  spawnEnemyClusters(world, [enemyDef], 2, createRng(456));

  const enemy = world.clusters[0];
  assert.equal(enemy.gridBlockSizeIndex, 1);
  assert.equal(enemy.gridBlockSpeedIndex, 0);
  assert.equal(enemy.gridBlockGridX, 3);
  assert.equal(enemy.gridBlockGridY, 2);
});

test('spawn initializes grid snake length and segments', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 8 * BS;
  world.worldHeightWorld = 6 * BS;
  const enemyDef = {
    xBlock: 3,
    yBlock: 2,
    kinds: [],
    particleCount: 0,
    isBossFlag: 0,
    isGridSnakeEnemyFlag: 1,
    gridSnakeLength: 5,
  } as unknown as RoomEnemyDef;

  spawnEnemyClusters(world, [enemyDef], 2, createRng(456));

  const snake = world.clusters[0];
  assert.equal(snake.isGridSnakeEnemyFlag, 1);
  assert.equal(snake.gridSnakeLength, 5);
  assert.equal(snake.gridSnakeSegmentGridX.length, 5);
});

function makeJsonEnemy(type: 'gridBlock' | 'gridSnake' | 'basic', sizeIndex: 0 | 1, speedIndex: 0 | 1 | 2): RoomJsonEnemy {
  return {
    xBlock: 5,
    yBlock: 5,
    kinds: [],
    particleCount: 0,
    isBoss: false,
    isFlyingEye: false,
    isRollingEnemy: false,
    isRockElemental: false,
    isRadiantTether: false,
    isRadiantWeb: false,
    isGrappleHunter: false,
    isSlime: false,
    isLargeSlime: false,
    isWheelEnemy: false,
    isBeetle: false,
    isWebSpider: false,
    isDustConstellation: false,
    isDustConstellationLarge: false,
    isOrbitalDustCore: false,
    isOrbitalDustCoreLarge: false,
    isDustBlockMimic: false,
    isDustBlockMimicLarge: false,
    isVoidSingularity: false,
    isVoidSingularityPair: false,
    isDustLeech: false,
    isGridBlockEnemy: type === 'gridBlock',
    gridBlockSizeIndex: sizeIndex,
    gridBlockSpeedIndex: speedIndex,
    isGridSnakeEnemy: type === 'gridSnake',
    gridSnakeLength: 5,
    isSquareStampede: false,
    isBeeSwarm: false,
    isGoldenMimic: false,
    isGoldenMimicYFlipped: false,
  } as unknown as RoomJsonEnemy;
}

const BLOCK_VARIANTS: Array<[string, 0 | 1, 0 | 1 | 2]> = [
  ['gridBlock1x1Slow', 0, 0],
  ['gridBlock1x1Medium', 0, 1],
  ['gridBlock1x1Fast', 0, 2],
  ['gridBlock2x2Slow', 1, 0],
  ['gridBlock2x2Medium', 1, 1],
  ['gridBlock2x2Fast', 1, 2],
];

for (const [expectedType, sz, sp] of BLOCK_VARIANTS) {
  test(`compact schema preserves ${expectedType}`, () => {
    const saved = enemyFlagsToType(makeJsonEnemy('gridBlock', sz, sp));
    assert.equal(saved, expectedType);
    const base = { xBlock: 5, yBlock: 5, kinds: [], particleCount: 0, isBoss: false };
    const restored = enemyTypeToFlags(saved as import('../levels/roomSavedTypes').SavedEnemyType, base);
    assert.equal(restored.isGridBlockEnemy, true);
    assert.equal(restored.gridBlockSizeIndex, sz);
    assert.equal(restored.gridBlockSpeedIndex, sp);
  });
}

test('compact schema preserves grid snake enemy type and length', () => {
  const saved = enemyFlagsToType(makeJsonEnemy('gridSnake', 0, 0));
  assert.equal(saved, 'gridSnake');
  const base = { xBlock: 5, yBlock: 5, kinds: [], particleCount: 0, isBoss: false, snakeLength: 5 };
  const restored = enemyTypeToFlags(saved, base);
  assert.equal(restored.isGridSnakeEnemy, true);
  assert.equal(restored.gridSnakeLength, 5);
});

test('non-grid enemies encode as basic', () => {
  assert.equal(enemyFlagsToType(makeJsonEnemy('basic', 0, 0)), 'basic');
});
