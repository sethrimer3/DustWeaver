import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { buildTileSolidityGridFromRoomWalls, buildSurfaceExposureMap } from '../sim/world/surfaceExposure';
import { buildSlimeSnailSurfaceTopology, findNearestSlimeSnailSegment, getDirectedEndpoints, getNextSlimeSnailSegment } from '../sim/clusters/slimeSnailSurfaceTopology';
import { applySlimeSnailAI, interpolateCornerPosition, isSurfaceSegmentSlimed, placeSlimeSnailOnSurface, tickSlimeSnailTrails } from '../sim/clusters/slimeSnailAi';
import { SLIME_SNAIL_TRAIL_LIFETIME_TICKS } from '../sim/clusters/slimeSnailConfig';
import { getSlimeTrailCellThickness } from '../render/clusters/slimeSnailRenderer';
import { enemyFlagsToType } from '../levels/roomSchemaV2';
import { enemyTypeToFlags } from '../levels/roomSchemaHydrator';
import type { RoomJsonEnemy } from '../editor/roomJsonSchema';

function topologyFor(walls: Array<{xBlock:number;yBlock:number;wBlock:number;hBlock:number}>) {
  const grid = buildTileSolidityGridFromRoomWalls(walls, 8, 8, 8);
  return buildSlimeSnailSurfaceTopology(buildSurfaceExposureMap(grid));
}

function snailFixture() {
  const world = createWorldState(1000 / 60, 4); world.worldWidthWorld = 64; world.worldHeightWorld = 64; world.builtForRoomId = 'snail-test';
  world.wallCount = 1; world.wallXWorld[0] = 16; world.wallYWorld[0] = 24; world.wallWWorld[0] = 8; world.wallHWorld[0] = 8;
  const snail = createClusterState(1, 20, 20, 0, 2); snail.isSlimeSnailFlag = 1; snail.slimeSnailTrailSlotIndex = 0; snail.slimeSnailSurfaceSideIndex = 0; snail.slimeSnailClockwiseFlag = 1;
  world.clusters = [snail]; placeSlimeSnailOnSurface(world, snail); return { world, snail };
}

test('topology exposes four sides and directions reverse', () => {
  const topology = topologyFor([{xBlock:2,yBlock:3,wBlock:1,hBlock:1}]); assert.equal(topology.segments.length, 4);
  const top = topology.segments.find(s => s.side === 'top')!; const cw = getDirectedEndpoints(top, 1); const ccw = getDirectedEndpoints(top, 0);
  assert.equal(cw.startX, ccw.endX); assert.equal(cw.endX, ccw.startX);
});
test('topology follows floor to wall and wall to ceiling deterministically', () => {
  const topology = topologyFor([{xBlock:2,yBlock:3,wBlock:1,hBlock:1}]); const top = topology.segments.find(s => s.side === 'top')!;
  const right = getNextSlimeSnailSegment(topology, top.index, 1); assert.equal(topology.segments[right!.nextIndex].side, 'right');
  const bottom = getNextSlimeSnailSegment(topology, right!.nextIndex, 1); assert.equal(topology.segments[bottom!.nextIndex].side, 'bottom');
});
test('diagonally touching islands are not connected', () => {
  const topology = topologyFor([{xBlock:1,yBlock:1,wBlock:1,hBlock:1},{xBlock:2,yBlock:2,wBlock:1,hBlock:1}]);
  for (const seg of topology.segments.filter(s => s.col === 1 && s.row === 1)) {
    const next = getNextSlimeSnailSegment(topology, seg.index, 1); if (next) assert.equal(topology.segments[next.nextIndex].col, 1);
  }
});
test('corner interpolation is continuous and deterministic', () => {
  const a = interpolateCornerPosition(8, 8, -Math.PI/2, Math.PI/2, 3, 0); const b = interpolateCornerPosition(8, 8, -Math.PI/2, Math.PI/2, 3, 1);
  assert.ok(Math.abs(a.x - 8) < 1e-9); assert.ok(Math.abs(a.y - 5) < 1e-9); assert.ok(Math.abs(b.x - 11) < 1e-9); assert.deepEqual(a, interpolateCornerPosition(8,8,-Math.PI/2,Math.PI/2,3,0));
});
test('invalid placement does not crash', () => {
  const world = createWorldState(1000/60, 1); world.worldWidthWorld = world.worldHeightWorld = 64; world.builtForRoomId = 'empty'; const snail = createClusterState(1, 10, 10, 0, 2); snail.isSlimeSnailFlag = 1;
  placeSlimeSnailOnSurface(world, snail); assert.equal(snail.slimeSnailSurfaceSegmentIndex, -1);
});
test('snail advances eight units in one second and deposits completed segment', () => {
  const { world, snail } = snailFixture(); const startX = snail.positionXWorld; const startY = snail.positionYWorld;
  for (let i=0;i<60;i++) applySlimeSnailAI(world);
  assert.ok(Math.hypot(snail.positionXWorld-startX, snail.positionYWorld-startY) > 5); assert.equal(world.slimeSnailTrailCount[0], 1);
  assert.equal(world.slimeSnailTrailRemainingTicks[0], SLIME_SNAIL_TRAIL_LIFETIME_TICKS); assert.equal(isSurfaceSegmentSlimed(world, 2, 3, 0), true);
});
test('trail expires visually and for gameplay on the same tick after death', () => {
  const { world, snail } = snailFixture(); for(let i=0;i<60;i++) applySlimeSnailAI(world); snail.isAliveFlag = 0;
  const before = world.slimeSnailTrailCount[0]; for(let i=0;i<SLIME_SNAIL_TRAIL_LIFETIME_TICKS;i++) tickSlimeSnailTrails(world);
  assert.equal(world.slimeSnailTrailCount[0], before); assert.equal(world.slimeSnailTrailRemainingTicks[0], 0); assert.equal(isSurfaceSegmentSlimed(world,2,3,0), false);
});
test('trail storage is bounded and overlapping records block until all expire', () => {
  const { world } = snailFixture(); world.slimeSnailTrailCount[0]=2; world.slimeSnailTrailCol[0]=world.slimeSnailTrailCol[1]=2; world.slimeSnailTrailRow[0]=world.slimeSnailTrailRow[1]=3; world.slimeSnailTrailSideIndex[0]=world.slimeSnailTrailSideIndex[1]=0; world.slimeSnailTrailRemainingTicks[0]=1; world.slimeSnailTrailRemainingTicks[1]=2;
  tickSlimeSnailTrails(world); assert.equal(isSurfaceSegmentSlimed(world,2,3,0), true); tickSlimeSnailTrails(world); assert.equal(isSurfaceSegmentSlimed(world,2,3,0), false); assert.equal(world.slimeSnailTrailCol.length, 160);
});
test('visual thickness decays deterministically', () => {
  assert.equal(getSlimeTrailCellThickness(0, 12, 0), 0); assert.equal(getSlimeTrailCellThickness(SLIME_SNAIL_TRAIL_LIFETIME_TICKS, 12, 0), 3);
  assert.equal(getSlimeTrailCellThickness(400, 12, 3), getSlimeTrailCellThickness(400, 12, 3));
  const late = Array.from({length:8},(_,i)=>getSlimeTrailCellThickness(40, 99, i)); assert.ok(late.every(v=>v<=1));
});
test('compact schema round trips snail side and direction with safe defaults', () => {
  const type = enemyFlagsToType({isSlimeSnail:true,slimeSnailSurfaceSideIndex:3,slimeSnailClockwiseFlag:0} as RoomJsonEnemy); assert.equal(type,'slimeSnail');
  const restored = enemyTypeToFlags(type,{xBlock:1,yBlock:2,kinds:['Nature'],particleCount:2,isBoss:false,slimeSnailSideIndex:3,slimeSnailCw:0}); assert.equal(restored.slimeSnailSurfaceSideIndex,3); assert.equal(restored.slimeSnailClockwiseFlag,0);
  const defaults = enemyTypeToFlags(type,{xBlock:1,yBlock:2,kinds:[],particleCount:0,isBoss:false}); assert.equal(defaults.slimeSnailSurfaceSideIndex,0); assert.equal(defaults.slimeSnailClockwiseFlag,1);
});
test('nearest segment respects authored side', () => {
  const topology=topologyFor([{xBlock:2,yBlock:3,wBlock:1,hBlock:1}]); const idx=findNearestSlimeSnailSegment(topology,20,20,0); assert.equal(topology.segments[idx].side,'top');
});
