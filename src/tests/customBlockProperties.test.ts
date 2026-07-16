/**
 * Tests for Phase 2A: safe predefined properties for custom blocks.
 * Covers the property registry (customBlockProperties.ts), schema v1/v2
 * compatibility (customBlocks.ts), runtime caching (customBlockSpriteCache.ts),
 * editor room-wall/breakable resolution (editorRoomBuilder.ts), and gameplay
 * fragile-block rendering suppression (customBlockGameplayRenderer.ts).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal DOM stubs for Node.js test environment (mirrors customBlocksPhase1C.test.ts) ──
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
  validateCustomBlockSource,
  parseCustomBlockSource,
  serializeCustomBlock,
  makeBlankPixelData,
  CUSTOM_BLOCK_PIXELS_PER_TILE,
} from '../levels/customBlocks';
import {
  DEFAULT_CUSTOM_BLOCK_PROPERTIES,
  validateAndResolveCustomBlockProperties,
  checkCustomBlockPropertyCompatibility,
  resolveWallBehavior,
  isEligibleForBreakablePathway,
  type CustomBlockProperties,
} from '../levels/customBlockProperties';
import {
  registerCustomBlockSprite,
  getCustomBlockProperties,
  clearCustomBlockSpriteCache,
  getOrFallbackSprite,
} from '../render/customBlockSpriteCache';
import { renderCustomBlockSprites, type BreakableWorldLookup } from '../render/customBlockGameplayRenderer';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import type { EditorRoomData } from '../editor/editorState';
import type { CustomBlockDef } from '../levels/customBlocks';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeV1Source(overrides: Record<string, unknown> = {}) {
  const tw = (overrides['tileWidth'] as number | undefined) ?? 1;
  const th = (overrides['tileHeight'] as number | undefined) ?? 1;
  const pw = tw * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const ph = th * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const pixels: string[][] = Array.from({ length: ph }, () =>
    Array.from({ length: pw }, () => '#FF000088'));
  return {
    schemaVersion: 1,
    id: 'legacy-block',
    name: 'Legacy Block',
    tileWidth: tw,
    tileHeight: th,
    pixelWidth: pw,
    pixelHeight: ph,
    behavior: 'solid',
    pixels,
    ...overrides,
  };
}

function makeV2Source(properties: Partial<CustomBlockProperties> = {}, overrides: Record<string, unknown> = {}) {
  const tw = (overrides['tileWidth'] as number | undefined) ?? 1;
  const th = (overrides['tileHeight'] as number | undefined) ?? 1;
  const pw = tw * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const ph = th * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const pixels: string[][] = Array.from({ length: ph }, () =>
    Array.from({ length: pw }, () => '#00FF00FF'));
  return {
    schemaVersion: 2,
    id: 'modern-block',
    name: 'Modern Block',
    tileWidth: tw,
    tileHeight: th,
    pixelWidth: pw,
    pixelHeight: ph,
    properties: { ...DEFAULT_CUSTOM_BLOCK_PROPERTIES, ...properties },
    pixels,
    ...overrides,
  };
}

function makeEditorRoomData(placements: Array<{
  xBlock: number; yBlock: number; blockId: string; tileWidth: 1 | 2; tileHeight: 1 | 2;
}>): EditorRoomData {
  return {
    id: 'room-1',
    name: 'Room 1',
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

// ── 1. Version-1 defaults ─────────────────────────────────────────────────────

describe('Schema version-1 compatibility', () => {
  test('1. version-1 custom blocks receive solid/default/indestructible defaults', () => {
    const result = parseCustomBlockSource(makeV1Source());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.def.properties, DEFAULT_CUSTOM_BLOCK_PROPERTIES);
      assert.equal(result.propertyWarnings.length, 0);
    }
  });

  test('18. older campaigns with schemaVersion 1 remain loadable (no schema errors)', () => {
    const errors = validateCustomBlockSource(makeV1Source());
    assert.equal(errors.length, 0);
  });
});

// ── 2. Version-2 round trip ───────────────────────────────────────────────────

describe('Schema version-2 properties', () => {
  test('2. version-2 property definitions save and reload with exact values', () => {
    const props: CustomBlockProperties = { collision: 'oneWay', friction: 'default', breakability: 'indestructible', materialResponse: 'stone', contactDamage: 'none' };
    const source = makeV2Source(props);
    const result = parseCustomBlockSource(source);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.def.properties, props);
  });

  test('16. duplicate copies properties but the caller assigns a new stable ID', () => {
    const props: CustomBlockProperties = { collision: 'solid', friction: 'slippery', breakability: 'indestructible' };
    const original = parseCustomBlockSource(makeV2Source(props, { id: 'orig' }));
    assert.equal(original.ok, true);
    const dup = parseCustomBlockSource(makeV2Source(props, { id: 'orig-2' }));
    assert.equal(dup.ok, true);
    if (original.ok && dup.ok) {
      assert.deepEqual(dup.def.properties, original.def.properties);
      assert.notEqual(dup.def.id, original.def.id);
    }
  });

  test('15. rename does not alter properties or the stable ID', () => {
    const props: CustomBlockProperties = { collision: 'nonSolid', friction: 'default', breakability: 'indestructible' };
    const before = parseCustomBlockSource(makeV2Source(props, { id: 'stable-id', name: 'Old Name' }));
    const afterRename = parseCustomBlockSource(makeV2Source(props, { id: 'stable-id', name: 'New Name' }));
    assert.equal(before.ok, true);
    assert.equal(afterRename.ok, true);
    if (before.ok && afterRename.ok) {
      assert.equal(before.def.id, afterRename.def.id);
      assert.deepEqual(before.def.properties, afterRename.def.properties);
    }
  });

  test('17. export and relocated reload preserve properties exactly (serialize -> parse round trip)', () => {
    const props: CustomBlockProperties = { collision: 'oneWay', friction: 'default', breakability: 'indestructible', materialResponse: 'stone', contactDamage: 'none' };
    const pixelData = makeBlankPixelData(1, 1);
    const sourceDef = serializeCustomBlock('roundtrip', 'Round Trip', 1, 1, pixelData, props);
    assert.equal(sourceDef.schemaVersion, 2);
    const parsed = parseCustomBlockSource(sourceDef);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.deepEqual(parsed.def.properties, props);
  });
});

// ── 3. Unknown / invalid values ───────────────────────────────────────────────

describe('Unknown or invalid property values', () => {
  test('3. unknown collision value is rejected safely and falls back without crashing', () => {
    const source = makeV2Source();
    (source.properties as unknown as Record<string, unknown>)['collision'] = 'explodeOnTouch';
    const result = parseCustomBlockSource(source);
    assert.equal(result.ok, true); // Never crashes the whole block.
    if (result.ok) {
      assert.equal(result.def.properties.collision, 'solid'); // safe fallback
      assert.ok(result.propertyWarnings.some(w => w.field === 'properties.collision'));
    }
  });

  test('19. invalid definitions use controlled fallback behavior (unknown extra keys rejected)', () => {
    const source = makeV2Source();
    (source.properties as unknown as Record<string, unknown>)['damageOnContact'] = 999;
    const result = parseCustomBlockSource(source);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.propertyWarnings.some(w => w.field === 'properties.damageOnContact'));
    }
  });

  test('validateAndResolveCustomBlockProperties never throws on garbage input', () => {
    assert.doesNotThrow(() => validateAndResolveCustomBlockProperties('not-an-object', 1, 1));
    assert.doesNotThrow(() => validateAndResolveCustomBlockProperties(null, 1, 1));
    assert.doesNotThrow(() => validateAndResolveCustomBlockProperties({ collision: 42 }, 1, 1));
  });
});

// ── 4. Compatibility rules ────────────────────────────────────────────────────

describe('Invalid property combinations', () => {
  test('4. nonSolid + slippery friction is flagged incompatible', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'nonSolid', friction: 'slippery', breakability: 'indestructible' }, 1, 1);
    assert.ok(issues.some(i => i.rule === 'nonSolidNoFriction'));
  });

  test('4b. fragile + non-solid collision is flagged incompatible', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'nonSolid', friction: 'default', breakability: 'fragile' }, 1, 1);
    assert.ok(issues.some(i => i.rule === 'fragileRequiresSolid'));
  });

  test('4c. fragile 2x2 solid is now compatible (Phase 2B multi-cell breakable support)', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2);
    assert.strictEqual(issues.length, 0);
  });

  test('fragile 1x1 solid is compatible', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 1, 1);
    assert.equal(issues.length, 0);
  });

  test('incompatible combination loaded from JSON falls back safely, not crash', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'nonSolid', friction: 'slippery', breakability: 'indestructible' }, 1, 1);
    assert.equal(result.properties.friction, 'default'); // forced back to compatible default
    assert.ok(result.errors.length > 0);
  });
});

// ── 5-7. Collision resolution reuses existing wall pathways ─────────────────

describe('Collision preset -> existing wall pathway mapping', () => {
  test('5. solid custom blocks retain existing full-footprint collision (wall generated, not platform)', () => {
    const behavior = resolveWallBehavior({ collision: 'solid', friction: 'default', breakability: 'indestructible' });
    assert.equal(behavior.generateWall, true);
    assert.equal(behavior.isPlatformFlag, 0);
  });

  test('6. oneWay custom blocks use the existing directional one-way platform flag', () => {
    const behavior = resolveWallBehavior({ collision: 'oneWay', friction: 'default', breakability: 'indestructible' });
    assert.equal(behavior.generateWall, true);
    assert.equal(behavior.isPlatformFlag, 1);
    assert.equal(behavior.platformEdge, 0); // top-only, matches existing authored one-way walls
  });

  test('7. non-solid custom blocks render but generate no collision wall', () => {
    const behavior = resolveWallBehavior({ collision: 'nonSolid', friction: 'default', breakability: 'indestructible' });
    assert.equal(behavior.generateWall, false);
  });

  test('8. slippery blocks reuse the existing ice-theme low-friction wall pathway', () => {
    const behavior = resolveWallBehavior({ collision: 'solid', friction: 'slippery', breakability: 'indestructible' });
    assert.equal(behavior.blockTheme, 'ice');
  });

  test('default friction maps to the normal blackRock theme', () => {
    const behavior = resolveWallBehavior({ collision: 'solid', friction: 'default', breakability: 'indestructible' });
    assert.equal(behavior.blockTheme, 'blackRock');
  });
});

// ── 9-11. Breakability ────────────────────────────────────────────────────────

describe('Breakability preset -> existing breakable-block pathway', () => {
  test('9. fragile 1x1 solid blocks are eligible for the existing breakable pathway', () => {
    assert.equal(isEligibleForBreakablePathway(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 1, 1), true);
  });

  test('10. 2x2 fragile blocks ARE eligible (Phase 2B: atomic multi-cell breakable group)', () => {
    assert.equal(isEligibleForBreakablePathway(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2), true);
  });

  test('indestructible blocks are never eligible for the breakable pathway', () => {
    assert.equal(isEligibleForBreakablePathway(
      { collision: 'solid', friction: 'default', breakability: 'indestructible' }, 1, 1), false);
  });
});

// ── editorRoomBuilder integration ──────────────────────────────────────────────

describe('editorRoomBuilder resolves custom block properties into RoomDef', () => {
  function registerTestBlock(id: string, properties: CustomBlockProperties, tileWidth: 1 | 2 = 1, tileHeight: 1 | 2 = 1): void {
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

  test('solid custom block placement produces a normal wall entry', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('solid-block', { collision: 'solid', friction: 'default', breakability: 'indestructible' });
    const room = makeEditorRoomData([{ xBlock: 3, yBlock: 3, blockId: 'custom:solid-block', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const wall = roomDef.walls.find(w => w.xBlock === 3 && w.yBlock === 3 && w.blockTheme === 'blackRock');
    assert.ok(wall, 'expected a solid blackRock wall at the placement');
    assert.equal(wall!.isPlatformFlag ?? 0, 0);
    clearCustomBlockSpriteCache();
  });

  test('oneWay custom block placement sets isPlatformFlag on the generated wall', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('oneway-block', { collision: 'oneWay', friction: 'default', breakability: 'indestructible' });
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:oneway-block', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const wall = roomDef.walls.find(w => w.xBlock === 5 && w.yBlock === 5);
    assert.ok(wall);
    assert.equal(wall!.isPlatformFlag, 1);
    clearCustomBlockSpriteCache();
  });

  test('nonSolid custom block placement produces no wall at all', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('nonsolid-block', { collision: 'nonSolid', friction: 'default', breakability: 'indestructible' });
    const room = makeEditorRoomData([{ xBlock: 7, yBlock: 7, blockId: 'custom:nonsolid-block', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const wall = roomDef.walls.find(w => w.xBlock === 7 && w.yBlock === 7);
    assert.equal(wall, undefined);
    clearCustomBlockSpriteCache();
  });

  test('fragile 1x1 solid custom block is routed to RoomDef.breakableBlocks, not a plain wall', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('fragile-block', { collision: 'solid', friction: 'default', breakability: 'fragile' });
    const room = makeEditorRoomData([{ xBlock: 9, yBlock: 9, blockId: 'custom:fragile-block', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.ok(roomDef.breakableBlocks?.some(b => b.xBlock === 9 && b.yBlock === 9));
    const plainWall = roomDef.walls.find(w => w.xBlock === 9 && w.yBlock === 9);
    assert.equal(plainWall, undefined); // gameRoomHazards.ts creates its own wall for this entry
    clearCustomBlockSpriteCache();
  });

  test('11. 2x2 custom block collision covers the full footprint (wBlock/hBlock = 2)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('big-block', { collision: 'solid', friction: 'default', breakability: 'indestructible' }, 2, 2);
    const room = makeEditorRoomData([{ xBlock: 2, yBlock: 2, blockId: 'custom:big-block', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const wall = roomDef.walls.find(w => w.xBlock === 2 && w.yBlock === 2);
    assert.ok(wall);
    assert.equal(wall!.wBlock, 2);
    assert.equal(wall!.hBlock, 2);
    clearCustomBlockSpriteCache();
  });

  test('property changes affect existing placements after re-registering (no room-data rewrite needed)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('mutable-block', { collision: 'solid', friction: 'default', breakability: 'indestructible' });
    const room = makeEditorRoomData([{ xBlock: 1, yBlock: 1, blockId: 'custom:mutable-block', tileWidth: 1, tileHeight: 1 }]);
    const before = editorRoomDataToRoomDef(room);
    assert.equal(before.walls.find(w => w.xBlock === 1 && w.yBlock === 1)?.isPlatformFlag ?? 0, 0);

    // Simulate saving an edit that changes the definition's collision preset.
    registerTestBlock('mutable-block', { collision: 'oneWay', friction: 'default', breakability: 'indestructible' });
    const after = editorRoomDataToRoomDef(room); // same room data, same coordinates/ID
    assert.equal(after.walls.find(w => w.xBlock === 1 && w.yBlock === 1)?.isPlatformFlag, 1);
    clearCustomBlockSpriteCache();
  });
});

// ── Runtime cache: properties travel with the sprite, campaign isolation ────

describe('Runtime property cache', () => {
  test('cached sprite carries the validated property profile', () => {
    clearCustomBlockSpriteCache();
    const def: CustomBlockDef = {
      id: 'cache-test', namespacedId: 'custom:cache-test', name: 'Cache Test',
      tileWidth: 1, tileHeight: 1,
      pixelWidth: CUSTOM_BLOCK_PIXELS_PER_TILE, pixelHeight: CUSTOM_BLOCK_PIXELS_PER_TILE,
      pixelData: makeBlankPixelData(1, 1),
      properties: { collision: 'oneWay', friction: 'slippery', breakability: 'indestructible' },
    };
    registerCustomBlockSprite(def);
    assert.deepEqual(getCustomBlockProperties('cache-test'), def.properties);
    clearCustomBlockSpriteCache();
  });

  test('20. campaign switch clears property profiles (no leak between campaigns with identical local IDs)', () => {
    clearCustomBlockSpriteCache();
    const propsA: CustomBlockProperties = { collision: 'oneWay', friction: 'default', breakability: 'indestructible' };
    registerCustomBlockSprite({
      id: 'shared-id', namespacedId: 'custom:shared-id', name: 'Campaign A Block',
      tileWidth: 1, tileHeight: 1, pixelWidth: 8, pixelHeight: 8,
      pixelData: makeBlankPixelData(1, 1), properties: propsA,
    });
    assert.deepEqual(getCustomBlockProperties('shared-id'), propsA);

    clearCustomBlockSpriteCache(); // campaign switch

    const propsB: CustomBlockProperties = { collision: 'nonSolid', friction: 'default', breakability: 'indestructible' };
    registerCustomBlockSprite({
      id: 'shared-id', namespacedId: 'custom:shared-id', name: 'Campaign B Block',
      tileWidth: 1, tileHeight: 1, pixelWidth: 8, pixelHeight: 8,
      pixelData: makeBlankPixelData(1, 1), properties: propsB,
    });
    assert.deepEqual(getCustomBlockProperties('shared-id'), propsB);
    assert.notDeepEqual(propsA, propsB);
    clearCustomBlockSpriteCache();
  });

  test('missing/unregistered block falls back to safe default properties (never crashes)', () => {
    clearCustomBlockSpriteCache();
    assert.deepEqual(getCustomBlockProperties('never-registered'), DEFAULT_CUSTOM_BLOCK_PROPERTIES);
    const sprite = getOrFallbackSprite('never-registered-2', 1, 1);
    assert.deepEqual(sprite.properties, DEFAULT_CUSTOM_BLOCK_PROPERTIES);
    clearCustomBlockSpriteCache();
  });
});

// ── 12. Fragile-block rendering suppression (no fragments) ──────────────────

describe('Fragile custom block breaking removes the complete placement', () => {
  test('12. broken fragile 1x1 placement is not drawn (no visual fragment left behind)', () => {
    clearCustomBlockSpriteCache();
    registerCustomBlockSprite({
      id: 'break-me', namespacedId: 'custom:break-me', name: 'Break Me',
      tileWidth: 1, tileHeight: 1, pixelWidth: 8, pixelHeight: 8,
      pixelData: makeBlankPixelData(1, 1),
      properties: { collision: 'solid', friction: 'default', breakability: 'fragile' },
    });

    const room = {
      customBlockPlacements: [[4, 4, 'custom:break-me']],
    } as unknown as Parameters<typeof renderCustomBlockSprites>[1];

    const drawnCalls: number[] = [];
    const fakeCtx = {
      imageSmoothingEnabled: false,
      drawImage: (...args: unknown[]) => { drawnCalls.push(args.length); },
    } as unknown as CanvasRenderingContext2D;

    // World reports this placement's breakable entry as inactive (broken).
    const brokenWorld: BreakableWorldLookup = {
      breakableBlockCount: 1,
      breakableBlockXWorld: [4.5 * 8],
      breakableBlockYWorld: [4.5 * 8],
      isBreakableBlockActiveFlag: [0],
    };
    renderCustomBlockSprites(fakeCtx, room, 0, 0, 1, brokenWorld);
    assert.equal(drawnCalls.length, 0, 'broken fragile block must not be drawn');

    // Still-active (unbroken) fragile block draws normally.
    const activeWorld: BreakableWorldLookup = {
      breakableBlockCount: 1,
      breakableBlockXWorld: [4.5 * 8],
      breakableBlockYWorld: [4.5 * 8],
      isBreakableBlockActiveFlag: [1],
    };
    renderCustomBlockSprites(fakeCtx, room, 0, 0, 1, activeWorld);
    assert.equal(drawnCalls.length, 1, 'unbroken fragile block should still be drawn');
    clearCustomBlockSpriteCache();
  });

  test('11b. a solid 2x2 fragile block IS eligible for the breakable pathway (Phase 2B)', () => {
    assert.equal(isEligibleForBreakablePathway(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 2, 2), true);
  });
});

// ── Phase 2B: atomic 2x2 fragile destruction (real room + sim integration) ──

describe('Phase 2B: atomic 2x2 fragile destruction', () => {
  function registerBoulder(id: string): void {
    const def: CustomBlockDef = {
      id,
      namespacedId: `custom:${id}`,
      name: id,
      tileWidth: 2,
      tileHeight: 2,
      pixelWidth: 2 * CUSTOM_BLOCK_PIXELS_PER_TILE,
      pixelHeight: 2 * CUSTOM_BLOCK_PIXELS_PER_TILE,
      pixelData: makeBlankPixelData(2, 2),
      properties: { collision: 'solid', friction: 'default', breakability: 'fragile' },
    };
    registerCustomBlockSprite(def);
  }

  test('striking any one of the 4 cells destroys the complete placement atomically, leaving a neighboring placement untouched', async () => {
    clearCustomBlockSpriteCache();
    registerBoulder('boulder');

    // Two independent 2x2 fragile placements of the SAME definition, far apart.
    const room = makeEditorRoomData([
      { xBlock: 2, yBlock: 2, blockId: 'custom:boulder', tileWidth: 2, tileHeight: 2 },
      { xBlock: 10, yBlock: 10, blockId: 'custom:boulder', tileWidth: 2, tileHeight: 2 },
    ]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.length, 8, 'expect 4 cells per placement x 2 placements');

    const { createWorldState } = await import('../sim/world');
    const { loadRoomHazards } = await import('../screens/gameRoomHazards');
    const { applyHazards } = await import('../sim/hazards');

    const world = createWorldState(1000 / 60, 1);
    loadRoomHazards(world, roomDef);

    // Player cluster overlapping the BOTTOM-RIGHT cell (3,3) of placement A —
    // i.e. NOT the anchor cell — moving fast enough to break it.
    const BS = 8;
    const player = {
      isAliveFlag: 1,
      positionXWorld: 3 * BS + BS / 2,
      positionYWorld: 3 * BS + BS / 2,
      halfWidthWorld: 2,
      halfHeightWorld: 2,
      velocityXWorld: 400,
      velocityYWorld: 0,
    } as unknown as (typeof world.clusters)[number];
    world.clusters.push(player);

    applyHazards(world);

    const isActiveAt = (x: number, y: number): boolean => {
      const cx = (x + 0.5) * BS;
      const cy = (y + 0.5) * BS;
      for (let i = 0; i < world.breakableBlockCount; i++) {
        if (Math.abs(world.breakableBlockXWorld[i] - cx) < 0.5 && Math.abs(world.breakableBlockYWorld[i] - cy) < 0.5) {
          return world.isBreakableBlockActiveFlag[i] === 1;
        }
      }
      throw new Error(`no breakable entry at (${x},${y})`);
    };

    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) {
      assert.equal(isActiveAt(x, y), false, `placement A cell (${x},${y}) must be destroyed`);
    }
    for (const [x, y] of [[10, 10], [11, 10], [10, 11], [11, 11]]) {
      assert.equal(isActiveAt(x, y), true, `placement B cell (${x},${y}) must remain intact`);
    }

    // Collision fully removed for all 4 destroyed cells (wall dims zeroed).
    for (let i = 0; i < world.breakableBlockCount; i++) {
      if (world.isBreakableBlockActiveFlag[i] === 0) {
        const wi = world.breakableBlockWallIndex[i];
        assert.equal(world.wallWWorld[wi], 0);
        assert.equal(world.wallHWorld[wi], 0);
      }
    }

    // Rendering: the whole placement's anchor-cell lookup reports "broken",
    // so no fragment of it is drawn; the untouched neighbor still draws.
    const lookup: BreakableWorldLookup = {
      breakableBlockCount: world.breakableBlockCount,
      breakableBlockXWorld: world.breakableBlockXWorld,
      breakableBlockYWorld: world.breakableBlockYWorld,
      isBreakableBlockActiveFlag: world.isBreakableBlockActiveFlag,
    };
    const roomForRender = { customBlockPlacements: [[2, 2, 'custom:boulder'], [10, 10, 'custom:boulder']] } as unknown as Parameters<typeof renderCustomBlockSprites>[1];
    const drawnAt: Array<[number, number]> = [];
    const fakeCtx = {
      imageSmoothingEnabled: false,
      drawImage: () => { drawnAt.push([0, 0]); },
    } as unknown as CanvasRenderingContext2D;
    renderCustomBlockSprites(fakeCtx, roomForRender, 0, 0, 1, lookup);
    assert.equal(drawnAt.length, 1, 'exactly one placement (the untouched neighbor) should still draw — bounded, no 4x fan-out');

    // Idempotency: a second collision callback in the same frame must not
    // throw, double-free, or affect the untouched neighboring placement.
    assert.doesNotThrow(() => applyHazards(world));
    for (const [x, y] of [[10, 10], [11, 10], [10, 11], [11, 11]]) {
      assert.equal(isActiveAt(x, y), true, 'idempotent re-run must not affect the untouched neighbor');
    }

    clearCustomBlockSpriteCache();
  });

  test('1x1 fragile custom blocks still break individually via the same pathway (no regression)', async () => {
    clearCustomBlockSpriteCache();
    const def: CustomBlockDef = {
      id: 'pebble', namespacedId: 'custom:pebble', name: 'pebble',
      tileWidth: 1, tileHeight: 1,
      pixelWidth: CUSTOM_BLOCK_PIXELS_PER_TILE, pixelHeight: CUSTOM_BLOCK_PIXELS_PER_TILE,
      pixelData: makeBlankPixelData(1, 1),
      properties: { collision: 'solid', friction: 'default', breakability: 'fragile' },
    };
    registerCustomBlockSprite(def);
    const room = makeEditorRoomData([{ xBlock: 6, yBlock: 6, blockId: 'custom:pebble', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.length, 1);
    assert.equal(roomDef.breakableBlocks?.[0]?.groupId, undefined, '1x1 placements are never grouped');

    const { createWorldState } = await import('../sim/world');
    const { loadRoomHazards } = await import('../screens/gameRoomHazards');
    const { applyHazards } = await import('../sim/hazards');

    const world = createWorldState(1000 / 60, 1);
    loadRoomHazards(world, roomDef);
    const BS = 8;
    world.clusters.push({
      isAliveFlag: 1,
      positionXWorld: 6 * BS + BS / 2,
      positionYWorld: 6 * BS + BS / 2,
      halfWidthWorld: 2,
      halfHeightWorld: 2,
      velocityXWorld: 400,
      velocityYWorld: 0,
    } as unknown as (typeof world.clusters)[number]);

    applyHazards(world);
    assert.equal(world.isBreakableBlockActiveFlag[0], 0);
    clearCustomBlockSpriteCache();
  });

  test('changing an existing placement definition from fragile to indestructible removes it from the breakable pathway on next resolution', () => {
    clearCustomBlockSpriteCache();
    registerBoulder('switchable');
    const room = makeEditorRoomData([{ xBlock: 1, yBlock: 1, blockId: 'custom:switchable', tileWidth: 2, tileHeight: 2 }]);
    const before = editorRoomDataToRoomDef(room);
    assert.equal(before.breakableBlocks?.length, 4);

    // Re-register the SAME id as indestructible (simulates saving an edit).
    const def: CustomBlockDef = {
      id: 'switchable', namespacedId: 'custom:switchable', name: 'switchable',
      tileWidth: 2, tileHeight: 2,
      pixelWidth: 2 * CUSTOM_BLOCK_PIXELS_PER_TILE, pixelHeight: 2 * CUSTOM_BLOCK_PIXELS_PER_TILE,
      pixelData: makeBlankPixelData(2, 2),
      properties: { collision: 'solid', friction: 'default', breakability: 'indestructible' },
    };
    registerCustomBlockSprite(def);
    const after = editorRoomDataToRoomDef(room); // same room data, same coordinates/ID
    assert.equal(after.breakableBlocks?.length ?? 0, 0, 'no longer routed through the breakable pathway');
    const wall = after.walls.find(w => w.xBlock === 1 && w.yBlock === 1);
    assert.ok(wall, 'now a normal solid wall covering the full 2x2 footprint');
    assert.equal(wall!.wBlock, 2);
    assert.equal(wall!.hBlock, 2);
    clearCustomBlockSpriteCache();
  });

  test('older placement data without groupId metadata (undefined) is treated as ungrouped, not a crash', () => {
    // Simulates a pre-Phase-2B RoomBreakableBlockDef entry with no groupId field.
    clearCustomBlockSpriteCache();
    const legacyRoomDef = {
      widthBlocks: 10, heightBlocks: 10, walls: [],
      breakableBlocks: [{ xBlock: 5, yBlock: 5 }], // no groupId — legacy shape
      enemies: [], transitions: [], saveTombs: [], skillTombs: [], dustPiles: [],
      grasshopperAreas: [], fireflyAreas: [], playerSpawnBlock: [0, 0],
    } as unknown as Parameters<typeof import('../screens/gameRoomHazards').loadRoomHazards>[1];

    return import('../sim/world').then(async ({ createWorldState }) => {
      const { loadRoomHazards } = await import('../screens/gameRoomHazards');
      const world = createWorldState(1000 / 60, 1);
      assert.doesNotThrow(() => loadRoomHazards(world, legacyRoomDef));
      assert.equal(world.breakableBlockGroupId[0], -1, 'ungrouped legacy cell defaults to -1');
    });
  });
});
