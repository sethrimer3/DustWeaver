/**
 * Tests for the grid block enemy system.
 *
 * Covers:
 *  - Physics exclusion: no gravity or standard chase velocity applied
 *  - Grid alignment: positions match committed cell when not mid-step
 *  - Wall blocking: 2×2 enemy surrounded by blockers never moves
 *  - Speed variants: slow/medium/fast have distinct step durations
 *  - Contact damage: uses existing damage/invulnerability pipeline
 *  - Hit-flash: triggered when HP drops
 *  - Compact schema round-trip: all six variants preserved
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyGridBlockEnemyAI, GRID_BLOCK_HALF_SIZE } from '../sim/clusters/gridBlockEnemyAi';
import { enemyFlagsToType } from '../levels/roomSchemaV2';
import { enemyTypeToFlags } from '../levels/roomSchemaHydrator';
import type { RoomJsonEnemy } from '../editor/roomJsonSchema';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';

const BS = BLOCK_SIZE_SMALL; // 8

// ── Minimal world/cluster builders ────────────────────────────────────────────

function makeWall(x: number, y: number, w: number, h: number) {
  return { x, y, w, h };
}

function makeWorld(opts: {
  widthBlocks?: number;
  heightBlocks?: number;
  walls?: { x: number; y: number; w: number; h: number }[];
  clusters?: ReturnType<typeof makeEnemy | typeof makePlayer>[];
  dtMs?: number;
}) {
  const wb    = opts.widthBlocks  ?? 20;
  const hb    = opts.heightBlocks ?? 15;
  const walls = opts.walls ?? [];
  const wc    = walls.length;

  const wallXWorld               = new Float32Array(wc);
  const wallYWorld               = new Float32Array(wc);
  const wallWWorld               = new Float32Array(wc);
  const wallHWorld               = new Float32Array(wc);
  const wallIsPlatformFlag       = new Uint8Array(wc);
  const wallRampOrientationIndex = new Uint8Array(wc).fill(255);
  const wallIsInvisibleFlag      = new Uint8Array(wc);

  walls.forEach((w, i) => {
    wallXWorld[i] = w.x;  wallYWorld[i] = w.y;
    wallWWorld[i] = w.w;  wallHWorld[i] = w.h;
  });

  return {
    dtMs: opts.dtMs ?? (1000 / 60),
    worldWidthWorld:  wb * BS,
    worldHeightWorld: hb * BS,
    wallCount: wc,
    wallXWorld, wallYWorld, wallWWorld, wallHWorld,
    wallIsPlatformFlag, wallRampOrientationIndex, wallIsInvisibleFlag,
    clusters: opts.clusters ?? [],
  } as unknown as import('../sim/world').WorldState;
}

function makeEnemy(overrides: {
  sizeIndex?: 0 | 1; speedIndex?: 0 | 1 | 2;
  gridX?: number; gridY?: number;
  hp?: number; entityId?: number;
}) {
  const sz = overrides.sizeIndex  ?? 0;
  const sp = overrides.speedIndex ?? 0;
  const gx = overrides.gridX ?? 2;
  const gy = overrides.gridY ?? 2;
  const hw = GRID_BLOCK_HALF_SIZE[sz];
  const hp = overrides.hp ?? 10;

  return {
    entityId: overrides.entityId ?? 1,
    isAliveFlag:           1 as 0 | 1,
    isPlayerFlag:          0 as 0 | 1,
    isGridBlockEnemyFlag:  1 as 0 | 1,
    gridBlockSizeIndex:    sz,
    gridBlockSpeedIndex:   sp,
    gridBlockGridX:        gx,
    gridBlockGridY:        gy,
    gridBlockTargetGridX:  gx,
    gridBlockTargetGridY:  gy,
    gridBlockMoveTicks:    0,
    gridBlockRepathCooldownTicks: 0,
    gridBlockNextDirX:     0,
    gridBlockNextDirY:     0,
    gridBlockGlintPhase:   0,
    gridBlockHitFlashTicks: 0,
    gridBlockPrevHealthPoints: hp,
    positionXWorld: gx * BS + hw,
    positionYWorld: gy * BS + hw,
    halfWidthWorld:  hw,
    halfHeightWorld: hw,
    velocityXWorld: 0,
    velocityYWorld: 0,
    healthPoints:    hp,
    maxHealthPoints: hp,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
  };
}

function makePlayer(x: number, y: number) {
  return {
    entityId: 0,
    isAliveFlag:  1 as 0 | 1,
    isPlayerFlag: 1 as 0 | 1,
    isGridBlockEnemyFlag: 0 as 0 | 1,
    positionXWorld: x,
    positionYWorld: y,
    halfWidthWorld:  6,
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

// ── Physics exclusion ─────────────────────────────────────────────────────────

test('grid block enemy velocity stays zero after AI tick', () => {
  const enemy = makeEnemy({});
  const world = makeWorld({ clusters: [enemy] });
  applyGridBlockEnemyAI(world);
  assert.equal(enemy.velocityXWorld, 0);
  assert.equal(enemy.velocityYWorld, 0);
});

test('grid block enemy velocity stays zero even with far-away player over many ticks', () => {
  const enemy  = makeEnemy({ gridX: 2, gridY: 2 });
  const player = makePlayer(15 * BS, 12 * BS);
  const world  = makeWorld({ clusters: [player, enemy] });
  for (let i = 0; i < 60; i++) applyGridBlockEnemyAI(world);
  assert.equal(enemy.velocityXWorld, 0);
  assert.equal(enemy.velocityYWorld, 0);
});

// ── Grid alignment ────────────────────────────────────────────────────────────

test('1x1 enemy position matches committed grid cell when not mid-step', () => {
  const enemy  = makeEnemy({ sizeIndex: 0, speedIndex: 0, gridX: 2, gridY: 2 });
  const player = makePlayer(10 * BS, 2 * BS);
  const world  = makeWorld({ clusters: [player, enemy] });

  for (let i = 0; i < 120; i++) applyGridBlockEnemyAI(world);

  if (enemy.gridBlockMoveTicks === 0) {
    const hw       = GRID_BLOCK_HALF_SIZE[0];
    const expectedX = enemy.gridBlockGridX * BS + hw;
    const expectedY = enemy.gridBlockGridY * BS + hw;
    assert.equal(enemy.positionXWorld, expectedX, 'positionX must match committed gridX');
    assert.equal(enemy.positionYWorld, expectedY, 'positionY must match committed gridY');
  }
});

test('2x2 enemy position matches committed grid cell when not mid-step', () => {
  const enemy  = makeEnemy({ sizeIndex: 1, speedIndex: 0, gridX: 2, gridY: 2 });
  const player = makePlayer(10 * BS, 2 * BS);
  const world  = makeWorld({ clusters: [player, enemy] });

  for (let i = 0; i < 120; i++) applyGridBlockEnemyAI(world);

  if (enemy.gridBlockMoveTicks === 0) {
    const hw       = GRID_BLOCK_HALF_SIZE[1];
    const expectedX = enemy.gridBlockGridX * BS + hw;
    const expectedY = enemy.gridBlockGridY * BS + hw;
    assert.equal(enemy.positionXWorld, expectedX);
    assert.equal(enemy.positionYWorld, expectedY);
  }
});

// ── 2×2 wall blocking ─────────────────────────────────────────────────────────

test('2x2 enemy stays put when surrounded by single-tile blockers', () => {
  // Enemy 2×2 at (2,2) — footprint covers tiles (2,2),(3,2),(2,3),(3,3).
  // Single-tile walls block every adjacent 2×2 footprint:
  //   Right: (3,2) blocked  Left: (1,2) blocked
  //   Down:  (2,4) blocked  Up:   (2,1) blocked
  const enemy  = makeEnemy({ sizeIndex: 1, speedIndex: 2, gridX: 2, gridY: 2 });
  const player = makePlayer(8 * BS, 2 * BS);

  const walls = [
    makeWall(3 * BS, 2 * BS, BS, BS),
    makeWall(1 * BS, 2 * BS, BS, BS),
    makeWall(2 * BS, 4 * BS, BS, BS),
    makeWall(2 * BS, 1 * BS, BS, BS),
  ];

  const world = makeWorld({ widthBlocks: 10, heightBlocks: 8, walls, clusters: [player, enemy] });
  const startGX = enemy.gridBlockGridX;
  const startGY = enemy.gridBlockGridY;

  for (let i = 0; i < 200; i++) applyGridBlockEnemyAI(world);

  assert.equal(enemy.gridBlockGridX, startGX, '2×2 enemy gridX should not change when surrounded');
  assert.equal(enemy.gridBlockGridY, startGY, '2×2 enemy gridY should not change when surrounded');
});

// ── Speed variants ────────────────────────────────────────────────────────────

test('slow variant takes more ticks per step than medium, medium more than fast', () => {
  function ticksForOneStep(speedIndex: 0 | 1 | 2): number {
    const enemy  = makeEnemy({ sizeIndex: 0, speedIndex, gridX: 1, gridY: 1 });
    const player = makePlayer(10 * BS, 1 * BS);
    const world  = makeWorld({ clusters: [player, enemy] });
    enemy.gridBlockRepathCooldownTicks = 0;
    const startGX = enemy.gridBlockGridX;
    for (let tick = 1; tick <= 100; tick++) {
      applyGridBlockEnemyAI(world);
      if (enemy.gridBlockMoveTicks === 0 && enemy.gridBlockGridX !== startGX) return tick;
    }
    return 100;
  }

  const slow   = ticksForOneStep(0);
  const medium = ticksForOneStep(1);
  const fast   = ticksForOneStep(2);

  assert.ok(slow > medium,   `slow(${slow}) should take more ticks than medium(${medium})`);
  assert.ok(medium > fast,   `medium(${medium}) should take more ticks than fast(${fast})`);
});

// ── Contact damage ────────────────────────────────────────────────────────────

test('enemy touching player deals contact damage respecting invulnerability', () => {
  const enemy  = makeEnemy({ sizeIndex: 0, gridX: 2, gridY: 2 });
  const player = makePlayer(enemy.positionXWorld, enemy.positionYWorld);
  const world  = makeWorld({ clusters: [player, enemy] });

  applyGridBlockEnemyAI(world);
  const hpAfterFirst = player.healthPoints;
  assert.ok(hpAfterFirst < 10, `Player should have taken damage; hp=${hpAfterFirst}`);

  applyGridBlockEnemyAI(world);
  assert.equal(player.healthPoints, hpAfterFirst, 'No damage during invulnerability');
});

test('enemy does not damage player when not overlapping', () => {
  const enemy  = makeEnemy({ sizeIndex: 0, gridX: 2, gridY: 2 });
  const player = makePlayer(10 * BS, 10 * BS);
  const world  = makeWorld({ clusters: [player, enemy] });
  applyGridBlockEnemyAI(world);
  assert.equal(player.healthPoints, 10);
});

// ── Hit flash ─────────────────────────────────────────────────────────────────

test('hit-flash ticks are set when enemy HP decreases', () => {
  const enemy = makeEnemy({ hp: 10 });
  const world = makeWorld({ clusters: [enemy] });

  applyGridBlockEnemyAI(world);
  assert.equal(enemy.gridBlockHitFlashTicks, 0, 'No flash when HP unchanged');

  enemy.healthPoints -= 2;
  applyGridBlockEnemyAI(world);
  assert.ok(enemy.gridBlockHitFlashTicks > 0, 'Flash ticks should be set after HP drop');
});

// ── Compact schema round-trip ─────────────────────────────────────────────────

function makeJsonEnemy(isGridBlockEnemy: boolean, sizeIndex: 0 | 1, speedIndex: 0 | 1 | 2): RoomJsonEnemy {
  return {
    xBlock: 5, yBlock: 5,
    kinds: [], particleCount: 0, isBoss: false,
    isFlyingEye: false, isRollingEnemy: false, isRockElemental: false,
    isRadiantTether: false, isRadiantWeb: false, isGrappleHunter: false,
    isSlime: false, isLargeSlime: false, isWheelEnemy: false, isBeetle: false,
    isWebSpider: false, isDustConstellation: false, isDustConstellationLarge: false,
    isOrbitalDustCore: false, isOrbitalDustCoreLarge: false,
    isDustBlockMimic: false, isDustBlockMimicLarge: false,
    isVoidSingularity: false, isVoidSingularityPair: false, isDustLeech: false,
    isGridBlockEnemy,
    gridBlockSizeIndex: sizeIndex,
    gridBlockSpeedIndex: speedIndex,
    isSquareStampede: false, isBeeSwarm: false, isGoldenMimic: false,
    isGoldenMimicYFlipped: false,
  } as unknown as RoomJsonEnemy;
}

const VARIANTS: Array<[string, boolean, 0 | 1, 0 | 1 | 2]> = [
  ['gridBlock1x1Slow',   true, 0, 0],
  ['gridBlock1x1Medium', true, 0, 1],
  ['gridBlock1x1Fast',   true, 0, 2],
  ['gridBlock2x2Slow',   true, 1, 0],
  ['gridBlock2x2Medium', true, 1, 1],
  ['gridBlock2x2Fast',   true, 1, 2],
];

for (const [expectedType, isGrid, sz, sp] of VARIANTS) {
  test(`enemyFlagsToType encodes ${expectedType}`, () => {
    assert.equal(enemyFlagsToType(makeJsonEnemy(isGrid, sz, sp)), expectedType);
  });

  test(`enemyTypeToFlags decodes ${expectedType}`, () => {
    const base = { xBlock: 5, yBlock: 5, kinds: [], particleCount: 0, isBoss: false };
    const flags = enemyTypeToFlags(expectedType as import('../levels/roomSavedTypes').SavedEnemyType, base);
    assert.equal(flags.isGridBlockEnemy,    isGrid, 'isGridBlockEnemy');
    assert.equal(flags.gridBlockSizeIndex,  sz,     'gridBlockSizeIndex');
    assert.equal(flags.gridBlockSpeedIndex, sp,     'gridBlockSpeedIndex');
  });

  test(`compact round-trip preserves ${expectedType}`, () => {
    const e       = makeJsonEnemy(isGrid, sz, sp);
    const saved   = enemyFlagsToType(e);
    assert.equal(saved, expectedType, 'dehydrate step');
    const base    = { xBlock: 5, yBlock: 5, kinds: [], particleCount: 0, isBoss: false };
    const restored = enemyTypeToFlags(saved, base);
    assert.equal(restored.isGridBlockEnemy,    isGrid, 'isGridBlockEnemy after hydrate');
    assert.equal(restored.gridBlockSizeIndex,  sz,     'sizeIndex after hydrate');
    assert.equal(restored.gridBlockSpeedIndex, sp,     'speedIndex after hydrate');
  });
}

test('non-grid-block enemies encode as basic (no regression)', () => {
  assert.equal(enemyFlagsToType(makeJsonEnemy(false, 0, 0)), 'basic');
});
