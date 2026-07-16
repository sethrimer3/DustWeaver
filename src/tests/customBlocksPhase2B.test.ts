/**
 * Tests for Phase 2B: multi-cell fragile custom blocks and property-system
 * hardening.
 *
 * Covers: the logical-placement grouping produced by editorRoomBuilder.ts
 * for 2x2 fragile custom blocks, the atomic group-destroy transaction in
 * src/sim/hazards.ts (applyHazards), persistence/reset semantics via
 * gameRoomHazards.loadRoomHazards + residentRoomManager-style restore, and
 * the relaxed compatibility rule in customBlockProperties.ts. Extends (does
 * not replace) src/tests/customBlockProperties.test.ts, whose Phase 2A
 * coverage must continue to pass unchanged.
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
import {
  checkCustomBlockPropertyCompatibility,
  isEligibleForBreakablePathway,
  validateAndResolveCustomBlockProperties,
  type CustomBlockProperties,
} from '../levels/customBlockProperties';
import {
  registerCustomBlockSprite,
  clearCustomBlockSpriteCache,
} from '../render/customBlockSpriteCache';
import { renderCustomBlockSprites, type BreakableWorldLookup } from '../render/customBlockGameplayRenderer';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import type { EditorRoomData } from '../editor/editorState';
import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { loadRoomHazards } from '../screens/gameRoomHazards';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { applyHazards } from '../sim/hazards';

// ── Helpers ──────────────────────────────────────────────────────────────────

function registerTestBlock(
  id: string,
  properties: CustomBlockProperties,
  tileWidth: 1 | 2 = 1,
  tileHeight: 1 | 2 = 1,
): void {
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
}

function makeEditorRoomData(placements: Array<{
  xBlock: number; yBlock: number; blockId: string; tileWidth: 1 | 2; tileHeight: 1 | 2;
}>): EditorRoomData {
  return {
    id: 'room-2b',
    name: 'Room 2B',
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

/** Builds a world with the player cluster overlapping (cx, cy) at speed enough to break blocks. */
function worldWithPlayerAt(room: RoomDef, cxBlock: number, cyBlock: number): ReturnType<typeof createWorldState> {
  const world = createWorldState(16);
  loadRoomHazards(world, room);
  const cx = (cxBlock + 0.5) * BLOCK_SIZE_MEDIUM;
  const cy = (cyBlock + 0.5) * BLOCK_SIZE_MEDIUM;
  const player = createClusterState(0, cx, cy, 1, 3);
  player.velocityXWorld = 400; // above BREAKABLE_MOMENTUM_THRESHOLD_WORLD (250)
  world.clusters = [player];
  return world;
}

// ── 1. Compatibility rule relaxation ────────────────────────────────────────

describe('Phase 2B: fragile 2x2 compatibility', () => {
  test('1. solid 2x2 fragile is compatible (no issues)', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    assert.equal(issues.length, 0);
  });

  test('2. solid 1x1 fragile is still compatible (unchanged Phase 2A behavior)', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 1, 1);
    assert.equal(issues.length, 0);
  });

  test('3. nonSolid + fragile 2x2 is still invalid (fragileRequiresSolid)', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'nonSolid', friction: 'default', breakability: 'fragile' }, 2, 2);
    assert.ok(issues.some(i => i.rule === 'fragileRequiresSolid'));
  });

  test('4. oneWay + fragile 2x2 is still invalid (fragileRequiresSolid)', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'oneWay', friction: 'default', breakability: 'fragile' }, 2, 2);
    assert.ok(issues.some(i => i.rule === 'fragileRequiresSolid'));
  });

  test('5. nonSolid + slippery friction is still invalid regardless of footprint', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'nonSolid', friction: 'slippery', breakability: 'indestructible' }, 2, 2);
    assert.ok(issues.some(i => i.rule === 'nonSolidNoFriction'));
  });

  test('6. isEligibleForBreakablePathway now returns true for solid 2x2 fragile', () => {
    assert.equal(isEligibleForBreakablePathway(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2), true);
  });

  test('7. validateAndResolveCustomBlockProperties no longer falls back fragile->indestructible for 2x2 solid', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2, { blockId: 'x' });
    assert.equal(result.properties.breakability, 'fragile');
    assert.equal(result.fallbackUsed, false);
  });

  test('8. non-solid 2x2 fragile still falls back to indestructible at load time', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'nonSolid', friction: 'default', breakability: 'fragile' }, 2, 2, { blockId: 'y' });
    assert.equal(result.properties.breakability, 'indestructible');
    assert.equal(result.fallbackUsed, true);
  });
});

// ── 2. editorRoomBuilder: logical placement -> grouped breakable cells ──────

describe('Phase 2B: editorRoomBuilder grouping', () => {
  test('9. 1x1 fragile still produces exactly one ungrouped breakable cell', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-1x1', { collision: 'solid', friction: 'default', breakability: 'fragile' });
    const room = makeEditorRoomData([{ xBlock: 4, yBlock: 4, blockId: 'custom:frag-1x1', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.length, 1);
    assert.equal(roomDef.breakableBlocks?.[0]?.groupId, undefined);
    clearCustomBlockSpriteCache();
  });

  test('10. 2x2 fragile produces exactly 4 breakable cells sharing one groupId, no plain wall', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-2x2', { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    const room = makeEditorRoomData([{ xBlock: 6, yBlock: 6, blockId: 'custom:frag-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const cells = roomDef.breakableBlocks ?? [];
    assert.equal(cells.length, 4);
    const groupIds = new Set(cells.map(c => c.groupId));
    assert.equal(groupIds.size, 1);
    assert.notEqual([...groupIds][0], undefined);
    const coords = new Set(cells.map(c => `${c.xBlock},${c.yBlock}`));
    assert.deepEqual(coords, new Set(['6,6', '7,6', '6,7', '7,7']));
    const plainWall = roomDef.walls.find(w => w.xBlock === 6 && w.yBlock === 6 && w.wBlock === 2);
    assert.equal(plainWall, undefined);
    clearCustomBlockSpriteCache();
  });

  test('11. two adjacent 2x2 fragile placements of the SAME definition get independent group ids', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-2x2-b', { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    const room = makeEditorRoomData([
      { xBlock: 0, yBlock: 0, blockId: 'custom:frag-2x2-b', tileWidth: 2, tileHeight: 2 },
      { xBlock: 2, yBlock: 0, blockId: 'custom:frag-2x2-b', tileWidth: 2, tileHeight: 2 }, // touching, same def
    ]);
    const roomDef = editorRoomDataToRoomDef(room);
    const cells = roomDef.breakableBlocks ?? [];
    assert.equal(cells.length, 8);
    const groupA = cells.filter(c => c.xBlock < 2).map(c => c.groupId);
    const groupB = cells.filter(c => c.xBlock >= 2).map(c => c.groupId);
    assert.equal(new Set(groupA).size, 1);
    assert.equal(new Set(groupB).size, 1);
    assert.notEqual(groupA[0], groupB[0]);
    clearCustomBlockSpriteCache();
  });

  test('12. fragile + slippery 1x1 threads the ice theme onto the breakable cell (friction hardening)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-ice', { collision: 'solid', friction: 'slippery', breakability: 'fragile' });
    const room = makeEditorRoomData([{ xBlock: 8, yBlock: 8, blockId: 'custom:frag-ice', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.[0]?.blockTheme, 'ice');
    clearCustomBlockSpriteCache();
  });

  test('13. fragile + default friction 1x1 leaves blockTheme undefined (preserves default-theme sentinel)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-default', { collision: 'solid', friction: 'default', breakability: 'fragile' });
    const room = makeEditorRoomData([{ xBlock: 9, yBlock: 8, blockId: 'custom:frag-default', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.[0]?.blockTheme, undefined);
    clearCustomBlockSpriteCache();
  });

  test('14. missing-definition fallback preserves the full 2x2 footprint as a solid wall (not fragile)', () => {
    clearCustomBlockSpriteCache();
    // Do NOT register the block — simulates a placement referencing an unknown/removed definition.
    const room = makeEditorRoomData([{ xBlock: 3, yBlock: 3, blockId: 'custom:does-not-exist', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const wall = roomDef.walls.find(w => w.xBlock === 3 && w.yBlock === 3);
    assert.ok(wall, 'expected a fallback solid wall covering the full footprint');
    assert.equal(wall!.wBlock, 2);
    assert.equal(wall!.hBlock, 2);
    assert.equal(roomDef.breakableBlocks?.length ?? 0, 0);
    clearCustomBlockSpriteCache();
  });
});

// ── 3. Atomic destruction transaction (src/sim/hazards.ts) ──────────────────

describe('Phase 2B: atomic 2x2 group destruction', () => {
  test('15. 1x1 fragile still breaks with the pre-Phase-2B single-cell behavior', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-solo', { collision: 'solid', friction: 'default', breakability: 'fragile' });
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:frag-solo', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5);
    assert.equal(world.breakableBlockCount, 1);
    applyHazards(world);
    assert.equal(world.isBreakableBlockActiveFlag[0], 0);
    clearCustomBlockSpriteCache();
  });

  test('16. striking ANY one of the 4 cells of a 2x2 fragile block destroys all 4 atomically', () => {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      clearCustomBlockSpriteCache();
      registerTestBlock('frag-quad', { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
      const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:frag-quad', tileWidth: 2, tileHeight: 2 }]);
      const roomDef = editorRoomDataToRoomDef(room);
      const world = worldWithPlayerAt(roomDef, 10 + dx, 10 + dy);
      assert.equal(world.breakableBlockCount, 4);
      applyHazards(world);
      for (let i = 0; i < 4; i++) {
        assert.equal(world.isBreakableBlockActiveFlag[i], 0, `cell ${i} should be broken (struck cell offset ${dx},${dy})`);
      }
      clearCustomBlockSpriteCache();
    }
  });

  test('17. destroying a 2x2 group also removes collision for all 4 corresponding walls', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-quad-wall', { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    const room = makeEditorRoomData([{ xBlock: 1, yBlock: 1, blockId: 'custom:frag-quad-wall', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 1, 1);
    const wallIndices = [0, 1, 2, 3].map(i => world.breakableBlockWallIndex[i]);
    for (const wi of wallIndices) {
      assert.ok(world.wallWWorld[wi] > 0 && world.wallHWorld[wi] > 0, 'wall should be intact before destruction');
    }
    applyHazards(world);
    for (const wi of wallIndices) {
      assert.equal(world.wallWWorld[wi], 0);
      assert.equal(world.wallHWorld[wi], 0);
    }
    clearCustomBlockSpriteCache();
  });

  test('18. adjacent same-definition 2x2 placements stay independently destructible', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-quad-indep', { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    const room = makeEditorRoomData([
      { xBlock: 0, yBlock: 0, blockId: 'custom:frag-quad-indep', tileWidth: 2, tileHeight: 2 },
      { xBlock: 2, yBlock: 0, blockId: 'custom:frag-quad-indep', tileWidth: 2, tileHeight: 2 },
    ]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 0, 0); // strike only the first placement
    assert.equal(world.breakableBlockCount, 8);
    applyHazards(world);
    // First placement's 4 cells (xBlock < 2) are broken.
    for (let i = 0; i < world.breakableBlockCount; i++) {
      const isFirstPlacement = world.breakableBlockXWorld[i] < 2 * BLOCK_SIZE_MEDIUM;
      assert.equal(world.isBreakableBlockActiveFlag[i], isFirstPlacement ? 0 : 1);
    }
    clearCustomBlockSpriteCache();
  });

  test('19. duplicate destruction callbacks within the same frame are idempotent (no double effects/errors)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-quad-idem', { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    const room = makeEditorRoomData([{ xBlock: 12, yBlock: 12, blockId: 'custom:frag-quad-idem', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 12, 12);
    // applyHazards processes breakable blocks once per call; simulate multiple
    // frames' worth of calls (the player is still overlapping) to prove
    // repeated destroy attempts on already-broken cells are safe no-ops.
    applyHazards(world);
    assert.doesNotThrow(() => { applyHazards(world); applyHazards(world); });
    for (let i = 0; i < 4; i++) assert.equal(world.isBreakableBlockActiveFlag[i], 0);
  });

  test('20. a slow-moving player (below momentum threshold) does not break any cell of a 2x2 block', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-quad-slow', { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    const room = makeEditorRoomData([{ xBlock: 13, yBlock: 13, blockId: 'custom:frag-quad-slow', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 13, 13);
    world.clusters[0]!.velocityXWorld = 50; // below threshold
    applyHazards(world);
    for (let i = 0; i < 4; i++) assert.equal(world.isBreakableBlockActiveFlag[i], 1);
  });
});

// ── 4. Renderer: whole 2x2 sprite hides atomically ──────────────────────────

describe('Phase 2B: renderer suppression for broken 2x2 fragile placements', () => {
  test('21. broken 2x2 fragile placement is not drawn at all (checked via anchor-cell match)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-render', { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    const room = { customBlockPlacements: [[2, 2, 'custom:frag-render']] } as unknown as RoomDef;

    const drawnCalls: unknown[] = [];
    const fakeCtx = {
      imageSmoothingEnabled: false,
      drawImage: (...args: unknown[]) => { drawnCalls.push(args); },
    } as unknown as CanvasRenderingContext2D;

    const brokenWorld: BreakableWorldLookup = {
      breakableBlockCount: 1,
      breakableBlockXWorld: [(2 + 0.5) * 8],
      breakableBlockYWorld: [(2 + 0.5) * 8],
      isBreakableBlockActiveFlag: [0], // anchor cell broken -> whole group broken (atomic)
    };
    renderCustomBlockSprites(fakeCtx, room, 0, 0, 1, brokenWorld);
    assert.equal(drawnCalls.length, 0);
    clearCustomBlockSpriteCache();
  });
});

// ── 5. Backward compatibility for old rooms ─────────────────────────────────

describe('Phase 2B: backward compatibility', () => {
  test('22. old-shape breakableBlocks entries without groupId/blockTheme parse and run fine', () => {
    const world = createWorldState(16);
    const room = {
      breakableBlocks: [{ xBlock: 4, yBlock: 4 }], // no groupId, no blockTheme — pre-Phase-2B shape
    } as unknown as RoomDef;
    assert.doesNotThrow(() => loadRoomHazards(world, room));
    assert.equal(world.breakableBlockCount, 1);
    assert.equal(world.breakableBlockGroupId[0], -1);
    const player = createClusterState(0, (4 + 0.5) * BLOCK_SIZE_MEDIUM, (4 + 0.5) * BLOCK_SIZE_MEDIUM, 1, 3);
    player.velocityXWorld = 400;
    world.clusters = [player];
    assert.doesNotThrow(() => applyHazards(world));
    assert.equal(world.isBreakableBlockActiveFlag[0], 0);
  });

  test('23. campaign switch (sprite cache clear) does not leak stale properties into a fresh registration', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('leak-check', { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    clearCustomBlockSpriteCache(); // simulate switching campaigns
    // Re-registering under the same id with different properties must fully replace the old entry.
    registerTestBlock('leak-check', { collision: 'nonSolid', friction: 'default', breakability: 'indestructible' });
    const room = makeEditorRoomData([{ xBlock: 8, yBlock: 8, blockId: 'custom:leak-check', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.length ?? 0, 0);
    assert.equal(roomDef.walls.find(w => w.xBlock === 8 && w.yBlock === 8), undefined);
    clearCustomBlockSpriteCache();
  });

  test('24. all existing Phase 2A property tests keep passing (spot check: solid/oneWay/nonSolid unaffected)', () => {
    assert.equal(checkCustomBlockPropertyCompatibility(
      { collision: 'solid', friction: 'default', breakability: 'indestructible', materialResponse: 'stone', contactDamage: 'none', breakResistance: 'standard', windResponse: 'passThrough' }, 1, 1).length, 0);
    assert.equal(checkCustomBlockPropertyCompatibility(
      { collision: 'oneWay', friction: 'slippery', breakability: 'indestructible', materialResponse: 'stone', contactDamage: 'none', breakResistance: 'standard', windResponse: 'passThrough' }, 2, 2).length, 0);
    assert.ok(checkCustomBlockPropertyCompatibility(
      { collision: 'nonSolid', friction: 'slippery', breakability: 'indestructible', materialResponse: 'stone', contactDamage: 'none', breakResistance: 'standard', windResponse: 'passThrough' }, 1, 1)
      .some(i => i.rule === 'nonSolidNoFriction'));
  });
});
