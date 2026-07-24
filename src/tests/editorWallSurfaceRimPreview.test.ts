/**
 * editorWallSurfaceRimPreview.test.ts — Coverage for the editor's own live
 * Surface Rim preview: it must resolve custom styles from live EditorWall
 * data (no explicit "confirm"/room-load step), rebuild when the rim style
 * changes, and never touch the gameplay `blockWallLayoutCache.ts` singleton.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EditorRoomData, EditorWall } from '../editor/editorElementTypes';
import { getEditorWallLayout, drawEditorSurfaceRimOverlay } from '../editor/editorWallSurfaceRimPreview';
import { normalizeSurfaceRimStyle } from '../render/walls/surfaceRimStyle';
import { setPrebuiltWallLayout, getCurrentWallLayout } from '../render/walls/blockWallLayoutCache';

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
