/**
 * Regression/behavior tests for the Ice Mote-specific visuals:
 *   - Ice shield half-hexagon silhouette selection + geometry.
 *   - Ice arrows do not bounce on terrain impact and register cosmetic frost.
 *   - Non-Ice arrows retain existing bounce behavior (regression).
 *   - Ice frost surface placement, per-shot growth, corner traversal, gap
 *     stopping, overlap merging, and room-reset lifecycle
 *     (src/sim/iceFrost.ts).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import {
  beginBowArrowAssembly,
  tickBowArrowAssembly,
  fireBowArrow,
  tickBowArrowOutbound,
  BOW_ARROW_PHASE_NONE,
  BOW_ARROW_LOAD_3_TICKS,
} from '../sim/weaves/bowArrow';
import {
  isIceShieldSilhouette,
  renderIceShieldHexagon,
} from '../render/stormweaveLifeMoteRenderer';
import { createShieldWeaveState, type ShieldWeaveState } from '../sim/stormweave/shieldWeave';
import type { StormweaveMotePalette } from '../render/stormweaveLifeMoteRenderer';
import {
  buildSurfaceExposureMap,
  type TileSolidityGrid,
  type SurfaceExposureMap,
} from '../sim/world/surfaceExposure';
import {
  applyIceArrowFrostHit,
  processPendingIceFrostImpacts,
  recordIceArrowFrostImpact,
  resetIceFrostForRoom,
  getIceFrostSegmentStates,
  FROST_REACH_PX_PER_SHOT,
} from '../sim/iceFrost';

const DT_MS = 1000 / 60;
const BLOCK_SIZE_PX = 8;

function gridFromRows(rows: readonly (0 | 1)[][], blockSizePx = BLOCK_SIZE_PX): TileSolidityGrid {
  const heightBlocks = rows.length;
  const widthBlocks = rows[0]?.length ?? 0;
  return {
    widthBlocks,
    heightBlocks,
    blockSizePx,
    isSolidAt: (col: number, row: number): boolean => {
      if (row < 0 || row >= heightBlocks || col < 0 || col >= widthBlocks) return false;
      return rows[row][col] === 1;
    },
  };
}

function segState(map: SurfaceExposureMap, col: number, row: number, side: string) {
  for (const s of getIceFrostSegmentStates()) {
    if (s.segment.col === col && s.segment.row === row && s.segment.side === side) return s;
  }
  return undefined;
}

// ── Shield silhouette ────────────────────────────────────────────────────────

describe('Ice shield half-hexagon silhouette', () => {
  test('Ice selects the hexagon silhouette; other equippable kinds keep the default crescent (regression)', () => {
    assert.equal(isIceShieldSilhouette(ParticleKind.Ice), true);
    for (const kind of [ParticleKind.Golden, ParticleKind.Nature, ParticleKind.Void, ParticleKind.Light]) {
      assert.equal(isIceShieldSilhouette(kind), false, `kind ${kind} must not use the Ice silhouette`);
    }
  });

  test('half-hexagon: flat edge faces the player (back), apex faces the aim direction, straight edges only', () => {
    const shield: ShieldWeaveState = createShieldWeaveState();
    shield.isActive = true;
    shield.centerXWorld = 100;
    shield.centerYWorld = 50;
    shield.radiusWorld = 12;
    shield.directionAngleRad = 0; // aiming +x

    const moveTo: [number, number][] = [];
    const lineTo: [number, number][] = [];
    let closed = false;
    const fakeCtx = {
      beginPath() {},
      moveTo: (x: number, y: number) => moveTo.push([x, y]),
      lineTo: (x: number, y: number) => lineTo.push([x, y]),
      closePath: () => { closed = true; },
      fill() {},
      stroke() {},
    } as unknown as CanvasRenderingContext2D;
    const palette = { shieldCrescentHex: '#fff', shieldCrescentCenterHex: '#fff' } as unknown as StormweaveMotePalette;

    renderIceShieldHexagon(fakeCtx, shield, 0, 0, 1, palette);

    const points = [...moveTo, ...lineTo];
    assert.equal(points.length, 5, 'half-hexagon has exactly 5 straight-edge vertices');
    assert.ok(closed, 'polygon path is closed');

    // Apex: furthest point along the aim direction (+x here) — must sit at
    // centerX + radius (fully forward), and on the aim axis (y == centerY).
    const apex = points.reduce((a, b) => (b[0] > a[0] ? b : a));
    assert.ok(Math.abs(apex[0] - (100 + 12)) < 1e-6);
    assert.ok(Math.abs(apex[1] - 50) < 1e-6);

    // Flat back edge: the two points closest to the player (smallest local x,
    // i.e. x == centerX here since aim is +x) must be symmetric about centerY.
    const backEdge = points.filter((p) => Math.abs(p[0] - 100) < 1e-6);
    assert.equal(backEdge.length, 2, 'exactly two vertices form the flat back edge facing the player');
    assert.ok(Math.abs((backEdge[0][1] - 50) + (backEdge[1][1] - 50)) < 1e-6, 'back edge is symmetric about the aim axis');
  });

  test('half-hexagon orients correctly across the full 360° aim range (apex tracks direction, not just left/right flip)', () => {
    const shield: ShieldWeaveState = createShieldWeaveState();
    shield.isActive = true;
    shield.centerXWorld = 0;
    shield.centerYWorld = 0;
    shield.radiusWorld = 10;
    const palette = { shieldCrescentHex: '#fff', shieldCrescentCenterHex: '#fff' } as unknown as StormweaveMotePalette;

    for (const angleDeg of [0, 37, 90, 135, 180, 225, 270, 314]) {
      const angle = (angleDeg * Math.PI) / 180;
      shield.directionAngleRad = angle;
      const points: [number, number][] = [];
      const fakeCtx = {
        beginPath() {}, moveTo: (x: number, y: number) => points.push([x, y]),
        lineTo: (x: number, y: number) => points.push([x, y]),
        closePath() {}, fill() {}, stroke() {},
      } as unknown as CanvasRenderingContext2D;
      renderIceShieldHexagon(fakeCtx, shield, 0, 0, 1, palette);

      // All 5 vertices sit at distance r from center (regular-hexagon
      // vertices), so distinguish the true apex by projection onto the aim
      // direction instead of raw distance.
      const dot = (p: [number, number]): number => p[0] * Math.cos(angle) + p[1] * Math.sin(angle);
      const apex = points.reduce((a, b) => (dot(b) > dot(a) ? b : a));
      const expectedX = Math.cos(angle) * 10;
      const expectedY = Math.sin(angle) * 10;
      assert.ok(Math.abs(apex[0] - expectedX) < 1e-6, `angle ${angleDeg}°: apex x`);
      assert.ok(Math.abs(apex[1] - expectedY) < 1e-6, `angle ${angleDeg}°: apex y`);
    }
  });
});

// ── Arrow impact: bounce suppression ─────────────────────────────────────────

function makeArrowFixture(kind: ParticleKind, moteCount = 8) {
  const world = createWorldState(DT_MS, 11);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, kind, moteCount, world.rng);
  player.healthPoints = moteCount;
  player.maxHealthPoints = moteCount;
  world.selectedDustKind = kind;
  return { world, player };
}

function assembleAndFire(world: ReturnType<typeof createWorldState>) {
  beginBowArrowAssembly(world, world.tick, 1);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 13; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  assert.equal(fireBowArrow(world, 1, 0), true);
}

describe('Ice arrow terrain impact', () => {
  test('Ice arrows do not bounce: flight ends at the wall and a frost impact is queued', () => {
    resetIceFrostForRoom();
    const { world } = makeArrowFixture(ParticleKind.Ice);
    world.wallCount = 1;
    world.wallXWorld[0] = 140;
    world.wallYWorld[0] = 60;
    world.wallWWorld[0] = 40;
    world.wallHWorld[0] = 80;
    assembleAndFire(world);

    let resolved = false;
    for (let i = 0; i < 600 && !resolved; i++) {
      world.tick++;
      resolved = tickBowArrowOutbound(world);
    }
    assert.ok(resolved);
    assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE, 'flight ends immediately on impact, no bounce phase');

    // A single fake segment spanning the wall face — any impact this test
    // fires at the wall must land near it, so frost registers.
    const map: SurfaceExposureMap = {
      widthBlocks: 1, heightBlocks: 1, blockSizePx: BLOCK_SIZE_PX,
      masks: new Map(), concaveCornerMasks: new Map(), concaveCorners: [],
      segments: [{
        col: 17, row: 7, side: 'left', normalX: -1, normalY: 0,
        x0: 140, y0: 40, x1: 140, y1: 160, airCol: 16, airRow: 7,
      }],
    };
    processPendingIceFrostImpacts(map);
    assert.ok(segState(map, 17, 7, 'left') !== undefined, 'Ice impact registered cosmetic frost on the struck surface');

    let sawEmbedded = false;
    for (let i = 0; i < world.particleCount; i++) {
      if (world.positionXWorld[i] > 140 + 1e-3) sawEmbedded = true;
    }
    assert.equal(sawEmbedded, false, 'motes never embed past the struck wall');
  });

  test('non-Ice arrows keep bouncing and never queue frost (regression)', () => {
    resetIceFrostForRoom();
    const { world } = makeArrowFixture(ParticleKind.Golden);
    world.wallCount = 1;
    world.wallXWorld[0] = 140;
    world.wallYWorld[0] = 60;
    world.wallWWorld[0] = 40;
    world.wallHWorld[0] = 80;
    assembleAndFire(world);

    let resolved = false;
    for (let i = 0; i < 600 && !resolved; i++) {
      world.tick++;
      resolved = tickBowArrowOutbound(world);
    }
    assert.ok(resolved);

    let sawLeftward = false;
    for (let i = 0; i < world.particleCount; i++) {
      if (world.behaviorMode[i] !== 0) continue;
      if (world.velocityXWorld[i] < -10) sawLeftward = true;
    }
    assert.ok(sawLeftward, 'Golden arrow still reflects off the wall');

    const map: SurfaceExposureMap = {
      widthBlocks: 1, heightBlocks: 1, blockSizePx: BLOCK_SIZE_PX,
      masks: new Map(), concaveCornerMasks: new Map(), concaveCorners: [],
      segments: [{
        col: 17, row: 7, side: 'left', normalX: -1, normalY: 0,
        x0: 140, y0: 40, x1: 140, y1: 160, airCol: 16, airRow: 7,
      }],
    };
    processPendingIceFrostImpacts(map);
    assert.equal(segState(map, 17, 7, 'left'), undefined, 'non-Ice arrows never queue a frost impact');
  });
});

// ── Frost placement / growth / corners / lifecycle ───────────────────────────

describe('Ice frost surface coverage', () => {
  test('frost lands on the correct exposed surface, oriented with that surface\'s normal', () => {
    resetIceFrostForRoom();
    const grid = gridFromRows([
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    const map = buildSurfaceExposureMap(grid);
    // Tile (1,1)'s top segment spans x=[8,16], y=8.
    applyIceArrowFrostHit(map, 12, 8);
    const state = segState(map, 1, 1, 'top');
    assert.ok(state !== undefined, 'frost registered on the struck tile side');
    assert.equal(state!.segment.normalX, 0);
    assert.equal(state!.segment.normalY, -1);
  });

  test('each shot extends frost by FROST_REACH_PX_PER_SHOT in each direction (8px total when unobstructed)', () => {
    resetIceFrostForRoom();
    const map: SurfaceExposureMap = {
      widthBlocks: 1, heightBlocks: 1, blockSizePx: 40,
      masks: new Map(), concaveCornerMasks: new Map(), concaveCorners: [],
      segments: [{ col: 0, row: 0, side: 'top', normalX: 0, normalY: -1, x0: 0, y0: 0, x1: 40, y1: 0, airCol: 0, airRow: -1 }],
    };
    applyIceArrowFrostHit(map, 20, 0); // midpoint hit
    const state = segState(map, 0, 0, 'top')!;
    assert.ok(Math.abs(state.targetStart - (20 - FROST_REACH_PX_PER_SHOT)) < 1e-6);
    assert.ok(Math.abs(state.targetEnd - (20 + FROST_REACH_PX_PER_SHOT)) < 1e-6);
    assert.ok(Math.abs((state.targetEnd - state.targetStart) - FROST_REACH_PX_PER_SHOT * 2) < 1e-6);
  });

  test('overlapping/adjacent shots merge into one interval instead of stacking duplicate coverage', () => {
    resetIceFrostForRoom();
    const map: SurfaceExposureMap = {
      widthBlocks: 1, heightBlocks: 1, blockSizePx: 40,
      masks: new Map(), concaveCornerMasks: new Map(), concaveCorners: [],
      segments: [{ col: 0, row: 0, side: 'top', normalX: 0, normalY: -1, x0: 0, y0: 0, x1: 40, y1: 0, airCol: 0, airRow: -1 }],
    };
    applyIceArrowFrostHit(map, 20, 0); // covers [16,24]
    applyIceArrowFrostHit(map, 22, 0); // overlaps, extends to [18,26]

    let count = 0;
    for (const s of getIceFrostSegmentStates()) { void s; count++; }
    assert.equal(count, 1, 'still exactly one coverage entry for this segment — no duplicate stacking');

    const state = segState(map, 0, 0, 'top')!;
    assert.ok(Math.abs(state.targetStart - 16) < 1e-6);
    assert.ok(Math.abs(state.targetEnd - 26) < 1e-6);
  });

  test('frost propagates across a connected concave corner onto the adjacent surface', () => {
    resetIceFrostForRoom();
    // Notch layout: A (col1,row1) and C (col2,row2) meet diagonally through
    // the open notch at (col2,row1) — A's right segment ends exactly where
    // C's top segment begins (both at pixel (16,16)).
    const grid = gridFromRows([
      [0, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ]);
    const map = buildSurfaceExposureMap(grid);

    // A's right segment: x=16, y in [8,16]. Hit near its far end (y=15,
    // local pos 7) so the 4px reach spills 3px onto C's top segment.
    applyIceArrowFrostHit(map, 16, 15);

    const aState = segState(map, 1, 1, 'right')!;
    assert.ok(aState !== undefined);
    assert.ok(Math.abs(aState.targetEnd - 8) < 1e-6, 'A\'s coverage is clamped at its own segment end');

    const cState = segState(map, 2, 2, 'top');
    assert.ok(cState !== undefined, 'coverage continued onto the connected segment across the corner');
    assert.ok(cState!.targetStart <= 1e-6, 'continuation starts right at the shared corner point');
    assert.ok(cState!.targetEnd > 0, 'some of the leftover reach was applied on the far side of the corner');
  });

  test('frost does NOT propagate across a disconnected (gap) surface', () => {
    resetIceFrostForRoom();
    // A single tile whose top segment has no exposed neighbor at either end
    // (its room-width is 1, so left/right are out of bounds and never
    // exposed) — both corners of this segment are genuine dead ends, exactly
    // like a surface run terminating at a structural gap.
    const grid = gridFromRows([
      [0],
      [1],
      [0],
    ], 20);
    const map = buildSurfaceExposureMap(grid);

    // Hit near the segment's right end so a real leftover remains after
    // clamping to the segment's own bound.
    applyIceArrowFrostHit(map, 17, 20);

    let count = 0;
    for (const s of getIceFrostSegmentStates()) { void s; count++; }
    assert.equal(count, 1, 'coverage never spread to a nonexistent connected segment');

    const state = segState(map, 0, 1, 'top')!;
    assert.ok(state !== undefined);
    assert.ok(state.targetEnd <= 20 + 1e-6, 'coverage clamps at the segment\'s own end instead of jumping past the gap');
  });

  test('frost is cleared on room reset', () => {
    resetIceFrostForRoom();
    const grid = gridFromRows([[0, 0, 0], [0, 1, 0], [0, 0, 0]]);
    const map = buildSurfaceExposureMap(grid);
    recordIceArrowFrostImpact(12, 8);
    processPendingIceFrostImpacts(map);
    assert.ok(segState(map, 1, 1, 'top') !== undefined);

    resetIceFrostForRoom();
    let count = 0;
    for (const s of getIceFrostSegmentStates()) { void s; count++; }
    assert.equal(count, 0, 'all frost coverage cleared on room reset');
  });
});
