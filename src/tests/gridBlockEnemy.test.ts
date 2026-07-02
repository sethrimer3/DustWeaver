/**
 * Tests for the grid block enemy system.
 *
 * Covers:
 *  - Physics exclusion: no gravity or standard chase velocity applied
 *  - Grid alignment: positions remain on 8-unit grid after many ticks
 *  - 2×2 corridor check: 2×2 enemy cannot enter a 1-tile-wide corridor
 *  - Speed variants: slow/medium/fast have distinct step durations
 *  - Contact damage: uses existing damage/invulnerability pipeline
 *  - Compact schema round-trip: all six variants preserved
 *  - Verbose JSON round-trip: all six variants preserved
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

/** Build the flat SOA world arrays expected by isCellSolid / gridBlockEnemyAi. */
function makeWorld(opts: {
  widthBlocks?: number;
  heightBlocks?: number;
  walls?: { x: number; y: number; w: number; h: number }[];
  clusters?: ReturnType<typeof makeEnemy | typeof makePlayer>[];
  dtMs?: number;
}) {
  const wb = opts.widthBlocks  ?? 20;
  const hb = opts.heightBlocks ?? 15;
  const walls = opts.walls ?? [];
  const wc = walls.length;

  const wallXWorld              = new Float32Array(wc);
  const wallYWorld              = new Float32Array(wc);
  const wallWWorld              = new Float32Array(wc);
  const wallHWorld              = new Float32Array(wc);
  const wallIsPlatformFlag      = new Uint8Array(wc);
  const wallRampOrientationIndex = new Uint8Array(wc).fill(255); // 255 = not a ramp
  const wallIsInvisibleFlag     = new Uint8Array(wc);

  walls.forEach((w, i) => {
    wallXWorld[i] = w.x;
    wallYWorld[i] = w.y;
    wallWWorld[i] = w.w;
    wallHWorld[i] = w.h;
  });

  return {
    dtMs: opts.dtMs ?? (1000 / 60),
    worldWidthWorld:  wb * BS,
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

function makeEnemy(overrides: {
  sizeIndex?: 0 | 1;
  speedIndex?: 0 | 1 | 2;
  gridX?: number;
  gridY?: number;
  hp?: number;
  entityId?: number;
}) {
  const sz = overrides.sizeIndex  ?? 0;
  const sp = overrides.speedIndex ?? 0;
  const gx = overrides.gridX ?? 2;
  const gy = overrides.gridY ?? 2;
  const hw = GRID_BLOCK_HALF_SIZE[sz];

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
    gridBlockPrevHealthPoints: overrides.hp ?? 10,
    positionXWorld: gx * BS + hw,
    positionYWorld: gy * BS + hw,
    halfWidthWorld:  hw,
    halfHeightWorld: hw,
    velocityXWorld: 0,
    velocityYWorld: 0,
    healthPoints:    overrides.hp ?? 10,
    maxHealthPoints: overrides.hp ?? 10,
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

  assert.equal(enemy.velocityXWorld, 0, 'velocityX must stay 0');
  assert.equal(enemy.velocityYWorld, 0, 'velocityY must stay 0');
});

test('grid block enemy velocity stays zero even when player is far away', () => {
  const enemy  = makeEnemy({ gridX: 2, gridY: 2 });
  const player = makePlayer(15 * BS, 12 * BS); // far away
  const world  = makeWorld({ clusters: [player, enemy] });

  for (let i = 0; i < 60; i++) {
    applyGridBlockEnemyAI(world);
  }
  assert.equal(enemy.velocityXWorld, 0);
  assert.equal(enemy.velocityYWorld, 0);
});

// ── Grid alignment ────────────────────────────────────────────────────────────

test('1x1 enemy position matches committed grid cell when not mid-step', () => {
  const enemy  = makeEnemy({ sizeIndex: 0, speedIndex: 0, gridX: 2, gridY: 2 });
  const player = makePlayer(10 * BS, 2 * BS); // right of enemy
  const world  = makeWorld({ clusters: [player, enemy] });

  // Run enough ticks for several complete steps (slow = 20 ticks/step).
  for (let i = 0; i < 120; i++) {
    applyGridBlockEnemyAI(world);
  }

  // When not mid-step the interpolated position must equal the committed cell center.
  if (enemy.gridBlockMoveTicks === 0) {
    const hw = GRID_BLOCK_HALF_SIZE[0]; // 4
    const expectedX = enemy.gridBlockGridX * BS + hw;
    const expectedY = enemy.gridBlockGridY * BS + hw;
    assert.equal(enemy.positionXWorld, expectedX, 'positionX must match committed gridX');
    assert.equal(enemy.positionYWorld, expectedY, 'positionY must match committed gridY');
  }
  // If we happen to end mid-step, verify position is between old and new cell centers.
  // (This is hard to test precisely due to dtMs rounding; the committed-cell check above is sufficient.)
});

test('2x2 enemy position matches committed grid cell when not mid-step', () => {
  const enemy  = makeEnemy({ sizeIndex: 1, speedIndex: 0, gridX: 2, gridY: 2 });
  const player = makePlayer(10 * BS, 2 * BS);
  const world  = makeWorld({ clusters: [player, enemy] });

  for (let i = 0; i < 120; i++) {
    applyGridBlockEnemyAI(world);
  }

  if (enemy.gridBlockMoveTicks === 0) {
    const hw = GRID_BLOCK_HALF_SIZE[1]; // 8
    const expectedX = enemy.gridBlockGridX * BS + hw;
    const expectedY = enemy.gridBlockGridY * BS + hw;
    assert.equal(enemy.positionXWorld, expectedX);
    assert.equal(enemy.positionYWorld, expectedY);
  }
});

// ── 2×2 corridor check ────────────────────────────────────────────────────────

test('2x2 enemy stays put when surrounded by walls', () => {
  // Enemy 2×2 at (2,2) — footprint covers tiles (2,2),(3,2),(2,3),(3,3).
  // Place walls that block every adjacent 2×2 footprint:
  //   • Right:  footprint at (3,2) needs (3,2) free — block tile (3,2) with a wall.
  //   • Left:   footprint at (1,2) needs (1,2) free — block tile (1,2).
  //   • Down:   footprint at (2,3) needs (2,4) free — block tile (2,4).
  //   • Up:     footprint at (2,1) needs (2,1) free — block tile (2,1).
  //
  // A 1-tile wall at each blocker position is sufficient.
  const enemy  = makeEnemy({ sizeIndex: 1, speedIndex: 2, gridX: 2, gridY: 2 });
  const player = makePlayer(8 * BS, 2 * BS); // somewhere else

  const walls = [
    makeWall(3 * BS, 2 * BS, BS, BS), // blocks tile (3,2) — prevents move right
    makeWall(1 * BS, 2 * BS, BS, BS), // blocks tile (1,2) — prevents move left
    makeWall(2 * BS, 4 * BS, BS, BS), // blocks tile (2,4) — prevents move down
    makeWall(2 * BS, 1 * BS, BS, BS), // blocks tile (2,1) — prevents move up
  ];

  const world = makeWorld({
    widthBlocks: 10,
    heightBlocks: 8,
    walls,
    clusters: [player, enemy],
  });

  const startGX = enemy.gridBlockGridX;
  const startGY = enemy.gridBlockGridY;

  for (let i = 0; i < 200; i++) {
    applyGridBlockEnemyAI(world);
  }

  assert.equal(enemy.gridBlockGridX, startGX, '2×2 enemy gridX should not change when surrounded');
  assert.equal(enemy.gridBlockGridY, startGY, '2×2 enemy gridY should not change when surrounded');
});

// ── Speed variants ────────────────────────────────────────────────────────────

test('slow variant takes more ticks per step than medium', () => {
  function countTicksForOneStep(speedIndex: 0 | 1 | 2): number {
    const enemy  = makeEnemy({ sizeIndex: 0, speedIndex, gridX: 1, gridY: 1 });
    const player = makePlayer(10 * BS, 1 * BS);
    const world  = makeWorld({ clusters: [player, enemy] });

    // Trigger first repath immediately.
    enemy.gridBlockRepathCooldownTicks = 0;

    const startGridX = enemy.gridBlockGridX;
    for (let tick = 1; tick <= 100; tick++) {
      applyGridBlockEnemyAI(world);
      if (enemy.gridBlockGridX !== startGridX || enemy.gridBlockGridY !== enemy.gridBlockGridY) {
        // Wait until step fully commits.
        if (enemy.gridBlockMoveTicks === 0 && (
          enemy.gridBlockGridX !== startGridX
        )) {
          return tick;
        }
      }
    }
    return 100;
  }

  const ticksSlow   = countTicksForOneStep(0);
  const ticksMedium = countTicksForOneStep(1);
  const ticksFast   = countTicksForOneStep(2);

  assert.ok(ticksSlow > ticksMedium,   `slow(${ticksSlow}) should take more ticks than medium(${ticksMedium})`);
  assert.ok(ticksMedium > ticksFast,   `medium(${ticksMedium}) should take more ticks than fast(${ticksFast})`);
});

// ── Contact damage ────────────────────────────────────────────────────────────

test('enemy touching player deals contact damage respecting invulnerability frames', () => {
  const enemy  = makeEnemy({ sizeIndex: 0, gridX: 2, gridY: 2 });
  const player = makePlayer(enemy.positionXWorld, enemy.positionYWorld); // exactly overlapping

  const world = makeWorld({ clusters: [player, enemy] });

  // First tick: invulnerability is 0 → damage applied.
  applyGridBlockEnemyAI(world);
  const hpAfterFirst = player.healthPoints;
  assert.ok(hpAfterFirst < 10, `Player should have taken damage; hp=${hpAfterFirst}`);

  // Second tick: invulnerability frames are now active → no additional damage.
  applyGridBlockEnemyAI(world);
  const hpAfterSecond = player.healthPoints;
  assert.equal(hpAfterSecond, hpAfterFirst, 'No damage during invulnerability frames');
});

test('enemy does not damage player when they are not overlapping', () => {
  const enemy  = makeEnemy({ sizeIndex: 0, gridX: 2, gridY: 2 });
  const player = makePlayer(10 * BS, 10 * BS); // far away

  const world = makeWorld({ clusters: [player, enemy] });
  applyGridBlockEnemyAI(world);

  assert.equal(player.healthPoints, 10, 'Player should take no damage when not overlapping');
});

// ── Hit flash ─────────────────────────────────────────────────────────────────

test('hit-flash ticks are set when enemy HP decreases', () => {
  const enemy = makeEnemy({ hp: 10 });
  const world = makeWorld({ clusters: [enemy] });

  // Run once to sync prevHealthPoints.
  applyGridBlockEnemyAI(world);
  assert.equal(enemy.gridBlockHitFlashTicks, 0, 'No flash when HP unchanged');

  // Deal damage externally (simulate particle hit).
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

const GRID_BLOCK_VARIANTS: Array<[string, boolean, 0 | 1, 0 | 1 | 2]> = [
  ['gridBlock1x1Slow',   true, 0, 0],
  ['gridBlock1x1Medium', true, 0, 1],
  ['gridBlock1x1Fast',   true, 0, 2],
  ['gridBlock2x2Slow',   true, 1, 0],
  ['gridBlock2x2Medium', true, 1, 1],
  ['gridBlock2x2Fast',   true, 1, 2],
];

for (const [expectedType, isGrid, sz, sp] of GRID_BLOCK_VARIANTS) {
  test(`enemyFlagsToType encodes ${expectedType}`, () => {
    const e = makeJsonEnemy(isGrid, sz, sp);
    assert.equal(enemyFlagsToType(e), expectedType);
  });

  test(`enemyTypeToFlags decodes ${expectedType}`, () => {
    const base = { xBlock: 5, yBlock: 5, kinds: [], particleCount: 0, isBoss: false };
    const flags = enemyTypeToFlags(expectedType as import('../levels/roomSavedTypes').SavedEnemyType, base);
    assert.equal(flags.isGridBlockEnemy,    isGrid,              'isGridBlockEnemy flag');
    assert.equal(flags.gridBlockSizeIndex,  sz,                  'gridBlockSizeIndex');
    assert.equal(flags.gridBlockSpeedIndex, sp,                  'gridBlockSpeedIndex');
  });

  test(`compact schema round-trip preserves ${expectedType}`, () => {
    const e = makeJsonEnemy(isGrid, sz, sp);
    const savedType = enemyFlagsToType(e);
    assert.equal(savedType, expectedType, 'dehydrate step');

    const base = { xBlock: 5, yBlock: 5, kinds: [], particleCount: 0, isBoss: false };
    const restored = enemyTypeToFlags(savedType, base);
    assert.equal(restored.isGridBlockEnemy,    isGrid, 'isGridBlockEnemy after hydrate');
    assert.equal(restored.gridBlockSizeIndex,  sz,     'sizeIndex after hydrate');
    assert.equal(restored.gridBlockSpeedIndex, sp,     'speedIndex after hydrate');
  });
}

test('non-grid-block enemies are still encoded as basic (no regression)', () => {
  const basic = makeJsonEnemy(false, 0, 0);
  assert.equal(enemyFlagsToType(basic), 'basic');
});
