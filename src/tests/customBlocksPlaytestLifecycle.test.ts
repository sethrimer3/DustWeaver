/**
 * Regression tests for the "2x2 custom block renders as four ordinary 1x1
 * wall tiles after confirm/playtest" bug.
 *
 * Root causes fixed:
 *  1. `editorRoomDataToRoomDef` (src/editor/editorRoomBuilder.ts) built the
 *     collision walls from `data.customBlockPlacements` but never copied the
 *     placements themselves onto the returned `RoomDef`, so
 *     `renderCustomBlockSprites` saw `room.customBlockPlacements === undefined`
 *     and drew nothing at all — only the baked blackRock collision walls
 *     showed, which is what looked like "ordinary 1x1 wall tiles".
 *  2. `closeEditor()` (src/editor/editorController.ts) unconditionally called
 *     `clearCustomBlockSpriteCache()`. closeEditor() is only ever used to
 *     return to gameplay of the SAME active campaign (confirm/playtest, or
 *     cancel), never to unload/switch campaigns — so even after fixing (1),
 *     the sprite cache would already be empty by the time gameplay tried to
 *     render.
 *  3. `RoomDef.customBlockPlacements` had no footprint (tileWidth/tileHeight)
 *     field, so a missing/unregistered custom block definition always fell
 *     back to a 1x1 placeholder sprite regardless of the placement's actual
 *     footprint.
 *  4. The "+2x2" create-custom-block button seeded the dialog with
 *     `tileWidth = 2` but always hardcoded `tileHeight = 1`, silently
 *     creating a 2x1 block.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal DOM stubs for Node.js test environment ──────────────────────────
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  class FakeOffscreenCanvas {
    width: number; height: number;
    _data: Uint8ClampedArray;
    constructor(w: number, h: number) {
      this.width = w; this.height = h;
      this._data = new Uint8ClampedArray(w * h * 4);
    }
    getContext(_type: string) {
      const data = this._data;
      return {
        putImageData(imgData: { data: Uint8ClampedArray }) { data.set(imgData.data); },
        imageSmoothingEnabled: false,
        drawImage() {},
        save() {}, restore() {},
      };
    }
  }
  // @ts-expect-error — polyfill for test environment only
  globalThis.OffscreenCanvas = FakeOffscreenCanvas;
}
if (typeof globalThis.ImageData === 'undefined') {
  // @ts-expect-error — polyfill
  globalThis.ImageData = class ImageData {
    data: Uint8ClampedArray; width: number; height: number;
    constructor(data: Uint8ClampedArray, w: number, h: number) {
      this.data = data; this.width = w; this.height = h;
    }
  };
}

import {
  makeBlankPixelData,
  CUSTOM_BLOCK_PIXELS_PER_TILE,
  type CustomBlockDef,
} from '../levels/customBlocks';
import type { CustomBlockProperties } from '../levels/customBlockProperties';
import {
  registerCustomBlockSprite,
  getOrFallbackSprite,
  clearCustomBlockSpriteCache,
} from '../render/customBlockSpriteCache';
import { renderCustomBlockSprites } from '../render/customBlockGameplayRenderer';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import { resolveInitialCustomBlockFootprint } from '../editor/editorCustomBlockDialog';
import type { EditorRoomData } from '../editor/editorState';

// ── Helpers ──────────────────────────────────────────────────────────────────

function registerTestBlock(
  id: string,
  properties: CustomBlockProperties,
  tileWidth: 1 | 2 = 1,
  tileHeight: 1 | 2 = 1,
): CustomBlockDef {
  const def: CustomBlockDef = {
    id,
    namespacedId: `custom:${id}`,
    name: id,
    tileWidth,
    tileHeight,
    pixelWidth: tileWidth * CUSTOM_BLOCK_PIXELS_PER_TILE,
    pixelHeight: tileHeight * CUSTOM_BLOCK_PIXELS_PER_TILE,
    pixelData: makeBlankPixelData(tileWidth, tileHeight),
    properties,
  };
  registerCustomBlockSprite(def);
  return def;
}

const SOLID_INDESTRUCTIBLE: CustomBlockProperties = {
  collision: 'solid', friction: 'default', breakability: 'indestructible',
};

function makeEditorRoomData(placements: Array<{
  xBlock: number; yBlock: number; blockId: string; tileWidth: 1 | 2; tileHeight: 1 | 2;
}>): EditorRoomData {
  return {
    id: 'room-playtest',
    name: 'Room Playtest',
    worldNumber: 0,
    mapX: 0,
    mapY: 0,
    blockTheme: 'blackRock',
    backgroundId: undefined,
    lightingEffect: undefined,
    songId: '_continue',
    widthBlocks: 20,
    heightBlocks: 15,
    interiorWalls: [],
    customBlockPlacements: placements.map((p, i) => ({ uid: i + 1, ...p })),
    enemies: [],
    playerSpawnBlock: [1, 1],
    transitions: [],
    saveTombs: [],
    skillTombs: [],
    dustPiles: [],
    grasshopperAreas: [],
    fireflyAreas: [],
    ambientLightDirection: 0,
    directionalBias: 0,
    sideExposureStrength: 0,
    minimumWallLight: 0,
    falloffPower: 1,
    sunrays: false,
    backgroundLightSpill: 0,
    solidLightSoftness: 0,
  } as unknown as EditorRoomData;
}

// Minimal fake 2D context capturing drawImage calls, enough to assert the
// destination rectangle passed to each custom-block sprite draw.
function makeFakeCtx() {
  const draws: { w: number; h: number; x: number; y: number }[] = [];
  return {
    ctx: {
      imageSmoothingEnabled: false,
      drawImage(_img: unknown, x: number, y: number, w: number, h: number) {
        draws.push({ x, y, w, h });
      },
    } as unknown as CanvasRenderingContext2D,
    draws,
  };
}

// ── 1 & 8: registered 2x2 block renders as one unified 2x2 sprite ───────────

describe('Custom block 2x2 rendering', () => {
  test('1. a registered 2x2 block renders with a 2x2 destination rectangle', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('big-2x2', SOLID_INDESTRUCTIBLE, 2, 2);
    const room = editorRoomDataToRoomDef(makeEditorRoomData([
      { xBlock: 3, yBlock: 5, blockId: 'custom:big-2x2', tileWidth: 2, tileHeight: 2 },
    ]));
    const { ctx, draws } = makeFakeCtx();
    renderCustomBlockSprites(ctx, room, 0, 0, 1);
    assert.equal(draws.length, 1, 'exactly one draw call for one logical placement');
    assert.equal(draws[0].w, 16, '2 tiles * 8px zoom = 16px wide');
    assert.equal(draws[0].h, 16, '2 tiles * 8px zoom = 16px tall');
    clearCustomBlockSpriteCache();
  });

  test('7. existing 1x1 behavior is unchanged', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('small-1x1', SOLID_INDESTRUCTIBLE, 1, 1);
    const room = editorRoomDataToRoomDef(makeEditorRoomData([
      { xBlock: 2, yBlock: 2, blockId: 'custom:small-1x1', tileWidth: 1, tileHeight: 1 },
    ]));
    const { ctx, draws } = makeFakeCtx();
    renderCustomBlockSprites(ctx, room, 0, 0, 1);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].w, 8);
    assert.equal(draws[0].h, 8);
    clearCustomBlockSpriteCache();
  });

  test('8. multiple placements of the same 2x2 definition share one cached sprite object', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('shared-2x2', SOLID_INDESTRUCTIBLE, 2, 2);
    const spriteA = getOrFallbackSprite('shared-2x2', 2, 2);
    const spriteB = getOrFallbackSprite('shared-2x2', 2, 2);
    assert.equal(spriteA, spriteB, 'both lookups must return the identical cached object');
    clearCustomBlockSpriteCache();
  });
});

// ── 2 & 3: editorRoomDataToRoomDef preserves customBlockPlacements ──────────

describe('editorRoomDataToRoomDef preserves custom block placements for playtest', () => {
  test('2. the built RoomDef carries customBlockPlacements (not dropped)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('carried-2x2', SOLID_INDESTRUCTIBLE, 2, 2);
    const room = editorRoomDataToRoomDef(makeEditorRoomData([
      { xBlock: 1, yBlock: 1, blockId: 'custom:carried-2x2', tileWidth: 2, tileHeight: 2 },
    ]));
    assert.ok(room.customBlockPlacements, 'customBlockPlacements must be present on the built RoomDef');
    assert.equal(room.customBlockPlacements!.length, 1);
    const [x, y, id, w, h] = room.customBlockPlacements![0] as [number, number, string, number, number];
    assert.deepEqual([x, y, id, w, h], [1, 1, 'custom:carried-2x2', 2, 2]);
    clearCustomBlockSpriteCache();
  });

  test('3. confirm/playtest never leaves the room without an accessible custom sprite', () => {
    // Simulates the exact confirm/playtest lifecycle: build the RoomDef the
    // same way confirmEdits() does, then render as gameplay would — without
    // any additional registration step in between (this is the regression:
    // previously the cache was cleared by closeEditor() and the placement
    // was dropped by editorRoomDataToRoomDef, so nothing rendered).
    clearCustomBlockSpriteCache();
    registerTestBlock('playtest-2x2', SOLID_INDESTRUCTIBLE, 2, 2);
    const room = editorRoomDataToRoomDef(makeEditorRoomData([
      { xBlock: 4, yBlock: 4, blockId: 'custom:playtest-2x2', tileWidth: 2, tileHeight: 2 },
    ]));
    // closeEditor() no longer clears the sprite cache (see editorController.ts) —
    // simulate that by NOT calling clearCustomBlockSpriteCache() here.
    const { ctx, draws } = makeFakeCtx();
    renderCustomBlockSprites(ctx, room, 0, 0, 1);
    assert.equal(draws.length, 1, 'the 2x2 sprite must still render immediately after the playtest transition');
    assert.equal(draws[0].w, 16);
    assert.equal(draws[0].h, 16);
    clearCustomBlockSpriteCache();
  });
});

// ── 4: true campaign unload/switch still clears the cache ──────────────────

describe('Campaign switch / unload still clears the sprite cache (no leakage)', () => {
  test('4. clearCustomBlockSpriteCache() empties the cache; a missing id falls back', () => {
    registerTestBlock('campaign-a-block', SOLID_INDESTRUCTIBLE, 2, 2);
    assert.notEqual(getOrFallbackSprite('campaign-a-block', 2, 2).properties.collision, undefined);
    clearCustomBlockSpriteCache(); // simulates a real campaign load/switch (game.ts)
    // Re-registering under campaign B with a different id must not see campaign A's def.
    const fallback = getOrFallbackSprite('campaign-a-block', 1, 1);
    // After the clear, "campaign-a-block" is gone; getOrFallbackSprite rebuilds
    // a fresh (missing-texture) fallback rather than returning stale data.
    assert.equal(fallback.tileWidth, 1);
    assert.equal(fallback.tileHeight, 1);
    clearCustomBlockSpriteCache();
  });
});

// ── 5: missing 2x2 definition retains a 2x2 fallback footprint ─────────────

describe('Missing-definition fallback footprint hardening', () => {
  test('5. a 2x2 placement with no registered definition falls back to a 2x2 (not 1x1) placeholder', () => {
    clearCustomBlockSpriteCache();
    // Never registered: 'ghost-2x2' has no sprite cache entry at all.
    const room = editorRoomDataToRoomDef(makeEditorRoomData([
      { xBlock: 6, yBlock: 6, blockId: 'custom:ghost-2x2', tileWidth: 2, tileHeight: 2 },
    ]));
    const { ctx, draws } = makeFakeCtx();
    renderCustomBlockSprites(ctx, room, 0, 0, 1);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].w, 16, 'missing 2x2 definition must still draw a 2x2 (16px) placeholder, not 1x1 (8px)');
    assert.equal(draws[0].h, 16);
    clearCustomBlockSpriteCache();
  });

  test('5b. old room data with no footprint recorded on the placement tuple still defaults to 1x1', () => {
    clearCustomBlockSpriteCache();
    const room = {
      ...editorRoomDataToRoomDef(makeEditorRoomData([])),
      customBlockPlacements: [[2, 2, 'custom:legacy-missing']] as unknown as readonly (readonly [number, number, string])[],
    };
    const { ctx, draws } = makeFakeCtx();
    renderCustomBlockSprites(ctx, room, 0, 0, 1);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].w, 8);
    assert.equal(draws[0].h, 8);
    clearCustomBlockSpriteCache();
  });
});

// ── 6: create-dialog footprint initialization ───────────────────────────────

describe('Custom block creation dialog footprint initialization', () => {
  test('6. requesting a 2x2 new block initializes BOTH width and height to 2', () => {
    const { tileWidth, tileHeight } = resolveInitialCustomBlockFootprint(undefined, 2);
    assert.equal(tileWidth, 2);
    assert.equal(tileHeight, 2, 'tileHeight must also start at 2 — previously hardcoded to 1');
  });

  test('6b. requesting a 1x1 new block initializes both to 1 (unchanged default)', () => {
    const { tileWidth, tileHeight } = resolveInitialCustomBlockFootprint(undefined, 1);
    assert.equal(tileWidth, 1);
    assert.equal(tileHeight, 1);
  });

  test('6c. editing an existing def ignores defaultTileSize and keeps the def\'s own footprint', () => {
    const existingDef: CustomBlockDef = registerTestBlock('existing-2x1', SOLID_INDESTRUCTIBLE, 2, 1);
    const { tileWidth, tileHeight } = resolveInitialCustomBlockFootprint(existingDef, 2);
    assert.equal(tileWidth, 2);
    assert.equal(tileHeight, 1, 'editing must preserve the def\'s actual footprint, not re-derive from defaultTileSize');
    clearCustomBlockSpriteCache();
  });
});

// ── 9: fragile-2x2-renderer suppression still works with placements preserved ─

describe('Fragile 2x2 suppression still works after placements are preserved on RoomDef', () => {
  test('9. a broken fragile 2x2 placement (anchor cell inactive) is not drawn', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-2x2', { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    const room = editorRoomDataToRoomDef(makeEditorRoomData([
      { xBlock: 5, yBlock: 5, blockId: 'custom:frag-2x2', tileWidth: 2, tileHeight: 2 },
    ]));
    const world = {
      breakableBlockCount: 1,
      breakableBlockXWorld: [(5 + 0.5) * 8],
      breakableBlockYWorld: [(5 + 0.5) * 8],
      isBreakableBlockActiveFlag: [0], // already broken
    };
    const { ctx, draws } = makeFakeCtx();
    renderCustomBlockSprites(ctx, room, 0, 0, 1, world);
    assert.equal(draws.length, 0, 'a broken fragile 2x2 placement must not draw anything');
    clearCustomBlockSpriteCache();
  });
});

// ── 10: save/reload preserves footprint data through the JSON round trip ───

describe('Save/reload round trip preserves custom block footprint', () => {
  test('10. roomJsonSerializer -> roomJsonToRoomDef round trip preserves tileWidth/tileHeight', async () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('roundtrip-2x2', SOLID_INDESTRUCTIBLE, 2, 2);
    const { editorRoomDataToJson } = await import('../editor/roomJsonSerializer');
    const { roomJsonDefToRoomDef } = await import('../levels/roomJsonToRoomDef');
    const editorData = makeEditorRoomData([
      { xBlock: 7, yBlock: 8, blockId: 'custom:roundtrip-2x2', tileWidth: 2, tileHeight: 2 },
    ]);
    const json = editorRoomDataToJson(editorData);
    assert.ok(json.customBlockPlacements && json.customBlockPlacements.length === 1);
    const tuple = json.customBlockPlacements[0];
    assert.equal(tuple[3], 2, 'serialized JSON must retain tileWidth');
    assert.equal(tuple[4], 2, 'serialized JSON must retain tileHeight');
    const roomDef = roomJsonDefToRoomDef(json);
    assert.ok(roomDef.customBlockPlacements && roomDef.customBlockPlacements.length === 1);
    const [, , , w, h] = roomDef.customBlockPlacements[0] as [number, number, string, number, number];
    assert.equal(w, 2);
    assert.equal(h, 2);
    clearCustomBlockSpriteCache();
  });
});
