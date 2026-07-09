import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomChunkCache, CHUNK_SIZE_BLOCKS } from '../render/walls/chunkRenderCache';

/**
 * Coverage for the room-entry lighting/shading convergence fix: a chunk built
 * while `FP.isBakeForbiddenInGameplay()` was true (`builtWithGameplayFallbackFlag`)
 * may be missing real edge shading/lighting entirely, even though it isn't
 * literally `hadFallbacksFlag` or dirty. It must never be treated as visually
 * "ready" by viewport-coverage checks, and must never be extracted/adopted
 * into another room's render path as if it were a finished, shaded bake.
 *
 * `RoomChunkCache` has no public constructor for a gameplay-fallback chunk
 * (that state is only ever set from the private `renderVisibleChunks` build
 * path, which needs a real `HTMLCanvasElement`/document — unavailable under
 * the plain node/tsx test runner). These tests poke the private `_chunks` map
 * directly via a cast to simulate that state, which is safe here since the
 * class stores it as a plain object property, not a real JS private field.
 */

const BLOCK_SIZE = 8;
// Just under one full chunk width/height in world pixels, so both the core
// (margin=0) and single-chunk math below land on exactly chunk "0,0" with no
// ambiguity from viewport-edge rounding pulling in a neighbouring chunk.
const SINGLE_CHUNK_VP = BLOCK_SIZE * (CHUNK_SIZE_BLOCKS - 1);

interface PokableChunkCache {
  _chunks: Map<string, { canvas: HTMLCanvasElement; hadFallbacksFlag: boolean; builtWithGameplayFallbackFlag: boolean }>;
}

function fakeCanvas(): HTMLCanvasElement {
  return {} as unknown as HTMLCanvasElement;
}

function poke(cache: RoomChunkCache, key: string): { hadFallbacksFlag: boolean; builtWithGameplayFallbackFlag: boolean } {
  const entry = (cache as unknown as PokableChunkCache)._chunks.get(key);
  assert.ok(entry, `expected chunk ${key} to exist`);
  return entry!;
}

test('freshly-injected chunk is considered core-covered (sanity baseline)', () => {
  // Only asserts the core (margin=0) check here — isViewportCovered (with the
  // CHUNK_MARGIN safety ring) needs the surrounding chunks too; see the
  // dedicated margin test below, which populates the full 3x3 neighbourhood.
  const cache = new RoomChunkCache();
  cache.injectWarmedChunks(new Map([['0,0', fakeCanvas()]]), {}, 1);
  assert.equal(cache.isViewportCoreCovered(0, 0, SINGLE_CHUNK_VP, SINGLE_CHUNK_VP, 1, BLOCK_SIZE), true);
});

test('isViewportCoreCovered returns false when the required chunk has builtWithGameplayFallbackFlag', () => {
  const cache = new RoomChunkCache();
  cache.injectWarmedChunks(new Map([['0,0', fakeCanvas()]]), {}, 1);
  poke(cache, '0,0').builtWithGameplayFallbackFlag = true;

  assert.equal(
    cache.isViewportCoreCovered(0, 0, SINGLE_CHUNK_VP, SINGLE_CHUNK_VP, 1, BLOCK_SIZE),
    false,
    'a gameplay-fallback chunk must not be treated as visually ready — it may be missing real shading entirely',
  );
});

test('isViewportCovered (with safety margin) returns false when any covered chunk has builtWithGameplayFallbackFlag', () => {
  const cache = new RoomChunkCache();
  // Populate the full margin-inclusive range around chunk (0,0) so the only
  // variable under test is the fallback flag on one of them.
  const chunks = new Map<string, HTMLCanvasElement>();
  for (let cy = -1; cy <= 1; cy++) {
    for (let cx = -1; cx <= 1; cx++) {
      chunks.set(`${cx},${cy}`, fakeCanvas());
    }
  }
  cache.injectWarmedChunks(chunks, {}, 1);
  assert.equal(cache.isViewportCovered(0, 0, SINGLE_CHUNK_VP, SINGLE_CHUNK_VP, 1, BLOCK_SIZE), true);

  poke(cache, '1,1').builtWithGameplayFallbackFlag = true; // a margin-ring chunk, not the core one

  assert.equal(
    cache.isViewportCovered(0, 0, SINGLE_CHUNK_VP, SINGLE_CHUNK_VP, 1, BLOCK_SIZE),
    false,
    'even a margin-ring gameplay-fallback chunk must break full coverage',
  );
});

test('extractCleanChunks excludes chunks with builtWithGameplayFallbackFlag', () => {
  const cache = new RoomChunkCache();
  cache.injectWarmedChunks(new Map([['0,0', fakeCanvas()], ['1,0', fakeCanvas()]]), {}, 1);
  poke(cache, '1,0').builtWithGameplayFallbackFlag = true;

  const clean = cache.extractCleanChunks();
  assert.equal(clean.has('0,0'), true, 'a genuinely clean chunk must still be extracted');
  assert.equal(clean.has('1,0'), false, 'a gameplay-fallback chunk must never be adopted into another render path as a finished bake');
});

test('retryGameplayFallbackChunksNow marks gameplay-fallback chunks dirty and clears the flag', () => {
  const cache = new RoomChunkCache();
  cache.injectWarmedChunks(new Map([['0,0', fakeCanvas()]]), {}, 1);
  poke(cache, '0,0').builtWithGameplayFallbackFlag = true;

  cache.retryGameplayFallbackChunksNow();

  const counts = cache.getFallbackDiagnosticCounts();
  assert.equal(counts.gameplayFallbackCount, 0, 'flag must be cleared once the retry is scheduled');
  assert.equal(
    cache.isViewportCoreCovered(0, 0, SINGLE_CHUNK_VP, SINGLE_CHUNK_VP, 1, BLOCK_SIZE),
    false,
    'the chunk must now be dirty (pending rebuild) rather than silently treated as covered again',
  );
});

test('getFallbackDiagnosticCounts reports hadFallbacksFlag and builtWithGameplayFallbackFlag counts independently', () => {
  const cache = new RoomChunkCache();
  cache.injectWarmedChunks(new Map([['0,0', fakeCanvas()], ['1,0', fakeCanvas()], ['2,0', fakeCanvas()]]), {}, 1);
  poke(cache, '0,0').hadFallbacksFlag = true;
  poke(cache, '1,0').builtWithGameplayFallbackFlag = true;
  // '2,0' stays clean.

  const counts = cache.getFallbackDiagnosticCounts();
  assert.equal(counts.hadFallbacksCount, 1);
  assert.equal(counts.gameplayFallbackCount, 1);
});
