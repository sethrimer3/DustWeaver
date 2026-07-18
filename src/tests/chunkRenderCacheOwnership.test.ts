import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_SIZE_BLOCKS,
  RoomChunkCache,
  createChunkCacheOwnershipKey,
} from '../render/walls/chunkRenderCache';
import * as FP from '../debug/perfFreezeProfiler';

const BLOCK_SIZE = 8;
const SMALL_VIEWPORT = 1;
const CORE_VIEWPORT = BLOCK_SIZE * (CHUNK_SIZE_BLOCKS - 1);

interface FakeCanvas extends HTMLCanvasElement {
  fakeId: number;
  builtFor?: string;
}

interface DrawRecorder {
  ctx: CanvasRenderingContext2D;
  drawn: FakeCanvas[];
  fills: Array<[number, number, number, number]>;
}

interface CacheInternals {
  _chunks: Map<string, {
    canvas: FakeCanvas;
    contentGeneration: number;
    hadFallbacksFlag: boolean;
    builtWithGameplayFallbackFlag: boolean;
  }>;
  _dirtyKeys: Set<string>;
  _lastVisibleFrame: Map<string, number>;
  _layoutRef: unknown;
  _scalePx: number;
}

const originalDocument = globalThis.document;
let nextCanvasId = 1;

before(() => {
  const fakeDocument = {
    createElement(tagName: string): FakeCanvas {
      assert.equal(tagName, 'canvas');
      const canvas = {
        fakeId: nextCanvasId++,
        width: 0,
        height: 0,
        getContext(kind: string) {
          assert.equal(kind, '2d');
          return {
            canvas,
            globalAlpha: 1,
            globalCompositeOperation: 'source-over',
            imageSmoothingEnabled: false,
            setTransform() {},
            clearRect() {},
          } as unknown as CanvasRenderingContext2D;
        },
      } as unknown as FakeCanvas;
      return canvas;
    },
  };
  (globalThis as unknown as { document: Document }).document = fakeDocument as unknown as Document;
});

after(() => {
  if (originalDocument === undefined) {
    delete (globalThis as unknown as { document?: Document }).document;
  } else {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
});

function owner(roomId: string, renderState = 'render-state', scale = 1): string {
  return createChunkCacheOwnershipKey(roomId, renderState, scale);
}

function makeRecorder(): DrawRecorder {
  const drawn: FakeCanvas[] = [];
  const fills: Array<[number, number, number, number]> = [];
  const ctx = {
    imageSmoothingEnabled: false,
    fillStyle: '',
    save() {},
    restore() {},
    drawImage(canvas: FakeCanvas) {
      drawn.push(canvas);
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push([x, y, w, h]);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, drawn, fills };
}

function makeBuildFn(label: string, builtKeys: string[] = [], returnsFallback = false) {
  return (
    chunkCtx: CanvasRenderingContext2D,
    _chunkOffsetXPx: number,
    _chunkOffsetYPx: number,
    _scalePx: number,
    _blockSizePx: number,
    colMin: number,
    rowMin: number,
  ): boolean => {
    const canvas = chunkCtx.canvas as FakeCanvas;
    canvas.builtFor = label;
    builtKeys.push(`${colMin / CHUNK_SIZE_BLOCKS},${rowMin / CHUNK_SIZE_BLOCKS}`);
    return returnsFallback;
  };
}

test('gameplay fallback chunks remain drawable without perpetual rebuild churn', () => {
  const cache = new RoomChunkCache();
  const layout = {};
  const builtKeys: string[] = [];
  const gameplayFallbackBuild = makeBuildFn('gameplay-fallback', builtKeys, true);

  FP.setBakeForbiddenInGameplay(true);
  try {
    cache.activateContentOwnership(owner('room-a'));
    cache.setMaxChunksPerFrame(0);
    cache.renderVisibleChunks(
      makeRecorder().ctx,
      layout,
      0,
      0,
      1,
      BLOCK_SIZE,
      SMALL_VIEWPORT,
      SMALL_VIEWPORT,
      gameplayFallbackBuild,
    );
    assert.equal(builtKeys.length, 4);
    assert.deepEqual(cache.getFallbackDiagnosticCounts(), {
      hadFallbacksCount: 0,
      gameplayFallbackCount: 4,
    });

    cache.setMaxChunksPerFrame(1);
    const steadyFrame = makeRecorder();
    cache.renderVisibleChunks(
      steadyFrame.ctx,
      layout,
      0,
      0,
      1,
      BLOCK_SIZE,
      SMALL_VIEWPORT,
      SMALL_VIEWPORT,
      gameplayFallbackBuild,
    );

    assert.equal(builtKeys.length, 4, 'intentional gameplay fallbacks must not rebuild every frame');
    assert.equal(steadyFrame.drawn.length, 4, 'all fallback chunks remain drawable while baking is forbidden');
    assert.equal(steadyFrame.fills.length, 0, 'the rebuild-budget rectangle must not cover stable fallback chunks');
    assert.equal(cache.stats.rebuiltThisFrame, 0);
    assert.equal(cache.stats.skippedThisFrame, 0);
  } finally {
    FP.setBakeForbiddenInGameplay(false);
  }
});

test('missing visible chunks converge before ordinary fallback retries can starve them', () => {
  const cache = new RoomChunkCache();
  const layout = {};
  const builtKeys: string[] = [];
  const fallbackBuild = makeBuildFn('sprite-fallback', builtKeys, true);

  cache.activateContentOwnership(owner('room-a'));
  cache.setMaxChunksPerFrame(0);
  cache.renderVisibleChunks(
    makeRecorder().ctx,
    layout,
    0,
    0,
    1,
    BLOCK_SIZE,
    SMALL_VIEWPORT,
    SMALL_VIEWPORT,
    fallbackBuild,
  );
  assert.equal(builtKeys.length, 4);

  cache.setMaxChunksPerFrame(1);
  const chunkShift = -(CHUNK_SIZE_BLOCKS * BLOCK_SIZE);
  const firstExpandedFrame = makeRecorder();
  cache.renderVisibleChunks(
    firstExpandedFrame.ctx,
    layout,
    chunkShift,
    0,
    1,
    BLOCK_SIZE,
    SMALL_VIEWPORT,
    SMALL_VIEWPORT,
    fallbackBuild,
  );
  assert.equal(cache.stats.rebuiltThisFrame, 1);
  assert.equal(firstExpandedFrame.fills.length, 1, 'only the second newly exposed chunk waits one frame');

  const secondExpandedFrame = makeRecorder();
  cache.renderVisibleChunks(
    secondExpandedFrame.ctx,
    layout,
    chunkShift,
    0,
    1,
    BLOCK_SIZE,
    SMALL_VIEWPORT,
    SMALL_VIEWPORT,
    fallbackBuild,
  );
  assert.equal(cache.stats.rebuiltThisFrame, 1);
  assert.equal(secondExpandedFrame.fills.length, 0, 'new coverage must converge despite earlier fallback-retry chunks');
});

function renderSmallViewport(
  cache: RoomChunkCache,
  recorder: DrawRecorder,
  layout: object,
  buildLabel: string,
  builtKeys: string[] = [],
  scale = 1,
  offsetX = 0,
): void {
  cache.renderVisibleChunks(
    recorder.ctx,
    layout,
    offsetX,
    0,
    scale,
    BLOCK_SIZE,
    SMALL_VIEWPORT,
    SMALL_VIEWPORT,
    makeBuildFn(buildLabel, builtKeys),
  );
}

test('room switch under rebuild pressure never draws Room A canvases for Room B', () => {
  const cache = new RoomChunkCache();
  const layoutA = {};
  const recorderA = makeRecorder();
  cache.activateContentOwnership(owner('room-a'));
  cache.setMaxChunksPerFrame(0);
  renderSmallViewport(cache, recorderA, layoutA, 'room-a');
  const roomACanvases = new Set(recorderA.drawn);
  assert.equal(roomACanvases.size, 4);

  cache.activateContentOwnership(owner('room-b'));
  cache.setMaxChunksPerFrame(1);
  const recorderB = makeRecorder();
  const builtForB: string[] = [];
  renderSmallViewport(cache, recorderB, {}, 'room-b', builtForB);

  assert.equal(recorderB.drawn.length, 1, 'the one rebuilt Room B chunk is drawable');
  assert.ok(recorderB.drawn.every((canvas) => !roomACanvases.has(canvas)));
  assert.ok(recorderB.drawn.every((canvas) => canvas.builtFor === 'room-b'));
  assert.equal(recorderB.fills.length, 3, 'budget-skipped chunks use the neutral fallback');
  assert.equal(cache.stats.rebuiltThisFrame, 1);
  assert.equal(cache.stats.skippedThisFrame, 3);

  for (let i = 0; i < 3; i++) {
    renderSmallViewport(cache, makeRecorder(), {}, 'room-b', builtForB);
  }
  assert.equal(builtForB.length, 4, 'skipped chunks remain pending and converge later');
});

test('partial Room B adoption removes untouched Room A chunk keys before large-room movement', () => {
  for (const isBgLayer of [false, true]) {
    const cache = new RoomChunkCache(isBgLayer);
    const roomAExtra = { fakeId: nextCanvasId++ } as FakeCanvas;
    cache.injectWarmedChunks(
      new Map([
        ['0,0', { fakeId: nextCanvasId++ } as FakeCanvas],
        ['2,0', roomAExtra],
      ]),
      {},
      1,
      owner('room-a'),
    );

    const roomBWarmed = { fakeId: nextCanvasId++ } as FakeCanvas;
    cache.injectWarmedChunks(
      new Map([['0,0', roomBWarmed]]),
      {},
      1,
      owner('room-b'),
    );

    const internals = cache as unknown as CacheInternals;
    assert.deepEqual([...internals._chunks.keys()], ['0,0']);
    assert.equal(cache.extractCleanChunks().get('0,0'), roomBWarmed);

    cache.setMaxChunksPerFrame(1);
    const movedView = makeRecorder();
    renderSmallViewport(cache, movedView, {}, 'room-b', [], 1, -2 * CHUNK_SIZE_BLOCKS * BLOCK_SIZE);
    assert.ok(!movedView.drawn.includes(roomAExtra));
    assert.ok(movedView.fills.length > 0, `${isBgLayer ? 'background' : 'wall'} cache must fill missing distant chunks neutrally`);
  }
});

test('coverage and extraction reject a stale-generation canvas', () => {
  const cache = new RoomChunkCache();
  cache.injectWarmedChunks(
    new Map([['0,0', { fakeId: nextCanvasId++ } as FakeCanvas]]),
    {},
    1,
    owner('room-a'),
  );
  const entry = (cache as unknown as CacheInternals)._chunks.get('0,0');
  assert.ok(entry);
  entry.contentGeneration--;

  assert.equal(
    cache.isViewportCoreCovered(0, 0, CORE_VIEWPORT, CORE_VIEWPORT, 1, BLOCK_SIZE),
    false,
  );
  assert.equal(cache.extractCleanChunks().size, 0);
});

test('a forced real activation clears canvases even when the room ownership key is unchanged', () => {
  const cache = new RoomChunkCache();
  const ownershipKey = owner('editor-playtest-room');
  cache.injectWarmedChunks(
    new Map([['0,0', { fakeId: nextCanvasId++ } as FakeCanvas]]),
    {},
    1,
    ownershipKey,
  );
  const previousGeneration = cache.contentGeneration;

  cache.activateContentOwnership(ownershipKey, true);

  assert.equal(cache.contentGeneration, previousGeneration + 1);
  assert.equal(cache.extractCleanChunks().size, 0);
  assert.equal((cache as unknown as CacheInternals)._chunks.size, 0);
});

test('clean same-room chunks are reused and targeted invalidation rebuilds only affected chunks', () => {
  const cache = new RoomChunkCache();
  const layout = {};
  cache.activateContentOwnership(owner('room-a'));
  cache.setMaxChunksPerFrame(0);
  const firstRecorder = makeRecorder();
  const builtKeys: string[] = [];
  renderSmallViewport(cache, firstRecorder, layout, 'room-a', builtKeys);
  assert.equal(builtKeys.length, 4);

  const secondRecorder = makeRecorder();
  renderSmallViewport(cache, secondRecorder, layout, 'room-a', builtKeys);
  assert.equal(builtKeys.length, 4, 'clean chunks must not rebuild');
  assert.deepEqual(secondRecorder.drawn, firstRecorder.drawn);

  cache.invalidateBlockRect(0, 0, 0, 0);
  renderSmallViewport(cache, makeRecorder(), layout, 'room-a', builtKeys);
  assert.equal(builtKeys.length, 5, 'only the targeted chunk rebuilds');
  assert.equal(builtKeys.at(-1), '0,0');
});

test('dirty same-room canvases retain owned pixels once the rebuild budget is exhausted', () => {
  const cache = new RoomChunkCache();
  const layout = {};
  cache.activateContentOwnership(owner('room-a'));
  cache.setMaxChunksPerFrame(0);
  const initial = makeRecorder();
  renderSmallViewport(cache, initial, layout, 'room-a');
  const staleSecondCanvas = (cache as unknown as CacheInternals)._chunks.get('1,0')?.canvas;
  assert.ok(staleSecondCanvas);

  cache.invalidateBlockRect(0, 0, CHUNK_SIZE_BLOCKS, 0);
  cache.setMaxChunksPerFrame(1);
  const recorder = makeRecorder();
  renderSmallViewport(cache, recorder, layout, 'room-a-updated');

  assert.ok(recorder.drawn.includes(staleSecondCanvas));
  assert.equal(recorder.fills.length, 0);
  assert.equal(cache.stats.rebuiltThisFrame, 1);
  assert.equal(cache.stats.skippedThisFrame, 1);
});

test('zoom change drops prior-scale canvases and keeps the rebuild limit', () => {
  const cache = new RoomChunkCache();
  const layout = {};
  cache.activateContentOwnership(owner('room-a', 'render-state', 1));
  cache.setMaxChunksPerFrame(0);
  const scaleOne = makeRecorder();
  renderSmallViewport(cache, scaleOne, layout, 'scale-1');
  const oldCanvases = new Set(scaleOne.drawn);

  // Quality/theme setters may invalidate before the new zoom reaches the
  // renderer; scale identity must survive invalidation so the next render can
  // still recognize and clear incompatible canvas dimensions.
  cache.invalidateAll();
  cache.setMaxChunksPerFrame(1);
  const scaleTwo = makeRecorder();
  renderSmallViewport(cache, scaleTwo, layout, 'scale-2', [], 2);
  assert.equal(cache.stats.rebuiltThisFrame, 1);
  assert.ok(scaleTwo.drawn.every((canvas) => !oldCanvases.has(canvas)));
  assert.ok(scaleTwo.fills.length > 0);
});

test('dispose resets ownership, content metadata, visibility state, and diagnostics', () => {
  const cache = new RoomChunkCache();
  cache.activateContentOwnership(owner('room-a'));
  cache.setMaxChunksPerFrame(0);
  renderSmallViewport(cache, makeRecorder(), {}, 'room-a');
  assert.ok(cache.stats.totalChunkCount > 0);

  cache.dispose();

  const internals = cache as unknown as CacheInternals;
  assert.equal(cache.contentOwnershipKey, null);
  assert.equal(cache.contentGeneration, 0);
  assert.equal(internals._chunks.size, 0);
  assert.equal(internals._dirtyKeys.size, 0);
  assert.equal(internals._lastVisibleFrame.size, 0);
  assert.equal(internals._layoutRef, null);
  assert.equal(internals._scalePx, 0);
  assert.deepEqual(cache.stats, {
    visibleChunkCount: 0,
    totalChunkCount: 0,
    dirtyChunkCount: 0,
    rebuiltThisFrame: 0,
    memoryEstimateKB: 0,
    evictedTotal: 0,
    rebuildMsThisFrame: 0,
    skippedThisFrame: 0,
  });
});
