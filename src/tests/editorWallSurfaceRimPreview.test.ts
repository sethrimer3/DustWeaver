import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EditorRoomData, EditorWall } from '../editor/editorElementTypes';
import { getEditorWallLayout, drawEditorSurfaceRimOverlay } from '../editor/editorWallSurfaceRimPreview';
import { normalizeSurfaceRimStyle } from '../render/walls/surfaceRimStyle';
import { setPrebuiltWallLayout, getCurrentWallLayout, buildWallLayout } from '../render/walls/blockWallLayoutCache';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import { buildRoomWallTemplate } from '../screens/gameRoomWalls';
import type { WallSnapshot } from '../render/snapshotTypes';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { editorPerfCounters, resetEditorPerfCounters } from '../editor/editorPerfCounters';

function makeWall(uid: number, overrides: Partial<EditorWall> = {}): EditorWall {
  return {
    uid, xBlock: uid * 3, yBlock: 0, wBlock: 1, hBlock: 1,
    isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0,
    ...overrides,
  } as EditorWall;
}

function makeRoom(walls: EditorWall[]): EditorRoomData {
  return {
    id: 'r', name: 'r', worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT', songId: '_continue',
    widthBlocks: 30, heightBlocks: 20, playerSpawnBlock: [0, 0],
    interiorWalls: walls, enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    dustPiles: [], grasshopperAreas: [], fireflyAreas: [], decorations: [],
    ambientLightBlockers: [], lightSources: [], backgroundBlocks: [],
  } as unknown as EditorRoomData;
}

function makeFakeCtx(): { ctx: CanvasRenderingContext2D; rectCount: number } {
  const state = { rectCount: 0 };
  const ctx = {
    globalCompositeOperation: 'source-over',
    save(): void {}, restore(): void {},
    set fillStyle(_v: string) {},
    get fillStyle() { return ''; },
    fillRect(): void { state.rectCount++; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rectCount: state.rectCount };
}

test('getEditorWallLayout: resolves custom Surface Rim styles directly from live EditorWall.surfaceRim — no room reload needed', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff7a18', widthPx: 2, opacity: 0.5 });
  const room = makeRoom([makeWall(1, { surfaceRim: style })]);
  const layout = getEditorWallLayout(room);
  assert.deepEqual(layout.tileSurfaceRim.get('3,0'), style);
});

test('getEditorWallLayout: a wall with no surfaceRim produces no tileSurfaceRim entry (default preview)', () => {
  const room = makeRoom([makeWall(0)]);
  const layout = getEditorWallLayout(room);
  assert.equal(layout.tileSurfaceRim.size, 0);
});

test('editor preview updates on the next call after an in-place Surface Rim edit (same-frame-equivalent redraw)', () => {
  const wall = makeWall(0);
  const room = makeRoom([wall]);

  const before = getEditorWallLayout(room);
  assert.equal(before.tileSurfaceRim.size, 0);

  // Simulate the inspector applying a property change directly to the live wall object.
  wall.surfaceRim = normalizeSurfaceRimStyle({ mode: 'gradient', color: '00ffff', widthPx: 3, opacity: 0.6 });

  const after = getEditorWallLayout(room);
  assert.notEqual(after, before, 'a rim edit must invalidate the editor-local layout cache');
  assert.ok(after.tileSurfaceRim.has('0,0'), 'the updated style must be resolvable on the very next call');
});

test('editor preview layout is cached across calls when nothing changed (no redundant rebuild)', () => {
  const room = makeRoom([makeWall(0)]);
  const a = getEditorWallLayout(room);
  const b = getEditorWallLayout(room);
  assert.equal(a, b, 'identical room state must reuse the same cached layout object');
});

test('drawEditorSurfaceRimOverlay: runs the overlay pass with a resolver reflecting the wall\'s style (produces draws)', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000', widthPx: 2, opacity: 0.5 });
  const room = makeRoom([makeWall(0, { surfaceRim: style })]);
  const { ctx } = makeFakeCtx();
  let drewSomething = false;
  const originalFillRect = ctx.fillRect.bind(ctx);
  (ctx as unknown as { fillRect: () => void }).fillRect = () => { drewSomething = true; originalFillRect(); };
  drawEditorSurfaceRimOverlay(ctx, room, 0, 0, 1);
  assert.ok(drewSomething, 'the overlay pass must actually draw for a wall with an exposed side');
});

test('editor preview building/rebuilding never touches the gameplay blockWallLayoutCache singleton', () => {
  // Install a sentinel gameplay layout, then exercise the editor preview
  // heavily (multiple distinct rooms/edits) — the sentinel must survive
  // completely untouched, proving no cross-talk with the shared singleton.
  const room1 = makeRoom([makeWall(0, { surfaceRim: normalizeSurfaceRimStyle({ mode: 'solid' }) })]);
  const sentinelLayout = getEditorWallLayout(room1); // any real CachedWallLayout shape works as a sentinel
  setPrebuiltWallLayout(sentinelLayout);

  const room2 = makeRoom([makeWall(0, { surfaceRim: normalizeSurfaceRimStyle({ mode: 'gradient' }) })]);
  getEditorWallLayout(room2);
  getEditorWallLayout(makeRoom([makeWall(0), makeWall(1)]));

  assert.equal(getCurrentWallLayout(), sentinelLayout, 'the gameplay singleton must be untouched by editor-preview calls');
});

test('editor preview without O(n²) merge produces identical surface exposure and custom rim pixel layouts to runtime merge result', () => {
  const same = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000' });
  const other = normalizeSurfaceRimStyle({ mode: 'solid', color: '00ff00' });
  const cases: EditorWall[][] = [
    [
      makeWall(10, { xBlock: 2, surfaceRim: same }),
      makeWall(11, { xBlock: 3, surfaceRim: same }),
    ],
    [
      makeWall(20, { xBlock: 2, yBlock: 2, surfaceRim: same }),
      makeWall(21, { xBlock: 3, yBlock: 2, surfaceRim: same }),
      makeWall(22, { xBlock: 2, yBlock: 3, surfaceRim: same }),
      makeWall(23, { xBlock: 3, yBlock: 3, surfaceRim: same }),
      makeWall(24, { xBlock: 2, yBlock: 2, surfaceRim: other }),
    ],
    [
      makeWall(30, { xBlock: 2, surfaceRim: same }),
      makeWall(31, { xBlock: 3, surfaceRim: other }),
    ],
    [
      makeWall(40, { xBlock: 2, surfaceRim: same, blockTheme: 'dirt' }),
      makeWall(41, { xBlock: 3, surfaceRim: same, blockTheme: 'brownRock' }),
    ],
    [
      makeWall(50, { xBlock: 2, surfaceRim: same, isPlatformFlag: 1 }),
      makeWall(51, { xBlock: 3, surfaceRim: same, isPlatformFlag: 1 }),
      makeWall(52, { xBlock: 4, surfaceRim: same, stairsOrientation: 0 }),
    ],
  ];

  for (const walls of cases) {
    const room = makeRoom(walls);
    const runtimeTemplate = buildRoomWallTemplate(editorRoomDataToRoomDef(room));
    const runtimeSnapshot: WallSnapshot = {
      count: runtimeTemplate.wallCount,
      xWorld: runtimeTemplate.xWorld,
      yWorld: runtimeTemplate.yWorld,
      wWorld: runtimeTemplate.wWorld,
      hWorld: runtimeTemplate.hWorld,
      isPlatformFlag: runtimeTemplate.isPlatformFlag,
      platformEdge: runtimeTemplate.platformEdge,
      themeIndex: runtimeTemplate.themeIndex,
      isInvisibleFlag: runtimeTemplate.isInvisibleFlag,
      rampOrientationIndex: runtimeTemplate.rampOrientationIndex,
      isPillarHalfWidthFlag: runtimeTemplate.isPillarHalfWidthFlag,
      surfaceRimStyleIndex: runtimeTemplate.rimStyleIndex,
      surfaceRimStyleTable: runtimeTemplate.rimStyleTable,
    };
    const runtimeLayout = buildWallLayout(runtimeSnapshot, BLOCK_SIZE_SMALL, room.widthBlocks, room.heightBlocks, 'test');
    const preview = getEditorWallLayout(room);
    const sortPixels = (pixels: readonly { xWorldPx: number; yWorldPx: number; renderDataIndex: number; distancePx: number }[]) =>
      Array.from(pixels).sort((a, b) => (a.yWorldPx - b.yWorldPx) || (a.xWorldPx - b.xWorldPx) || (a.renderDataIndex - b.renderDataIndex) || (a.distancePx - b.distancePx));

    assert.deepEqual(Array.from(preview.surfaceExposureMap), Array.from(runtimeLayout.surfaceExposureMap));
    assert.deepEqual(sortPixels(preview.customSurfaceRimPixels), sortPixels(runtimeLayout.customSurfaceRimPixels));
    assert.deepEqual(Array.from(preview.customSurfaceRimRenderData), Array.from(runtimeLayout.customSurfaceRimRenderData));
  }
});

test('getEditorWallLayout caches by room and mutationSerial without redundant builds or conversions', () => {
  resetEditorPerfCounters();
  const room = makeRoom([makeWall(100)]);
  const l1 = getEditorWallLayout(room, 5);
  assert.equal(editorPerfCounters.surfaceRimLayoutRebuilds, 1);
  assert.equal(editorPerfCounters.roomDefConversions, 0, 'must not run editorRoomDataToRoomDef');

  const l2 = getEditorWallLayout(room, 5);
  assert.equal(l2, l1);
  assert.equal(editorPerfCounters.surfaceRimLayoutRebuilds, 1, 'matching mutationSerial avoids rebuild');
});
