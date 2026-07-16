/**
 * Tests for Phase 2E: custom block break-resistance presets.
 *
 * Covers: the breakResistance property/registry (customBlockProperties.ts),
 * schema-v1/v2 compatibility defaults, the single authoritative
 * resolveBreakThresholdWorld mapping in src/sim/hazards.ts, real momentum-
 * threshold application for all three tiers via the real destruction
 * pathway (editorRoomBuilder.ts -> gameRoomHazards.ts -> applyHazards),
 * grouped 2x2 atomic destruction with a shared resistance tier, interaction
 * with Phase 2D contact damage and Phase 2C material-response break events,
 * and the sprite-cache properties-only update optimization. Extends (does
 * not replace) the Phase 2A/2B/2C/2D suites, whose coverage must continue to
 * pass unchanged.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal DOM stubs for Node.js test environment (mirrors earlier phase tests) ──
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
  parseCustomBlockSource,
  serializeCustomBlock,
  makeBlankPixelData,
  CUSTOM_BLOCK_PIXELS_PER_TILE,
  type CustomBlockDef,
} from '../levels/customBlocks';
import {
  validateAndResolveCustomBlockProperties,
  isBreakResistancePreset,
  breakResistanceToIndex,
  indexToBreakResistance,
  BREAK_RESISTANCE_PRESET_IDS,
  type CustomBlockProperties,
  type BreakResistancePreset,
} from '../levels/customBlockProperties';
import {
  registerCustomBlockSprite,
  getCustomBlockProperties,
  getCustomBlockSprite,
  updateCustomBlockProperties,
  clearCustomBlockSpriteCache,
} from '../render/customBlockSpriteCache';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import type { EditorRoomData } from '../editor/editorState';
import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { loadRoomHazards } from '../screens/gameRoomHazards';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { applyHazards } from '../sim/hazards';

// ── Helpers (mirror src/tests/customBlocksPhase2D.test.ts) ──────────────────

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
    id: 'room-2e',
    name: 'Room 2E',
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

/** Fragile, solid block properties with a given resistance tier and optional overrides. */
function resProps(
  breakResistance: BreakResistancePreset,
  overrides: Partial<CustomBlockProperties> = {},
): CustomBlockProperties {
  return {
    collision: 'solid', friction: 'default', breakability: 'fragile',
    materialResponse: 'stone', contactDamage: 'none', breakResistance, ...overrides,
  };
}

/** Builds a world with a player cluster at the given block coords and X velocity. */
function worldWithPlayerAt(
  room: RoomDef, cxBlock: number, cyBlock: number, velocityXWorld: number,
): ReturnType<typeof createWorldState> {
  const world = createWorldState(16);
  loadRoomHazards(world, room);
  const cx = (cxBlock + 0.5) * BLOCK_SIZE_MEDIUM;
  const cy = (cyBlock + 0.5) * BLOCK_SIZE_MEDIUM;
  const player = createClusterState(0, cx, cy, 1, 10);
  player.velocityXWorld = velocityXWorld;
  world.clusters = [player];
  return world;
}

// ── 1 & 2. Schema defaults ───────────────────────────────────────────────────

describe('Phase 2E: schema defaults', () => {
  test('1. version-1 custom blocks default breakResistance to standard', () => {
    const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const pixels: string[][] = Array.from({ length: pw }, () => Array.from({ length: pw }, () => '#FF000088'));
    const source = {
      schemaVersion: 1, id: 'legacy-2e', name: 'Legacy', tileWidth: 1, tileHeight: 1,
      pixelWidth: pw, pixelHeight: pw, behavior: 'solid', pixels,
    };
    const result = parseCustomBlockSource(source);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.def.properties.breakResistance, 'standard');
  });

  test('2. schema-v2 blocks without breakResistance default to standard', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 1, 1, { blockId: 'no-resistance' },
    );
    assert.equal(result.properties.breakResistance, 'standard');
    assert.equal(result.fallbackUsed, false); // absence is not an error
  });
});

// ── 3. All three presets save and reload ────────────────────────────────────

describe('Phase 2E: preset round trip', () => {
  for (const tier of BREAK_RESISTANCE_PRESET_IDS) {
    test(`3. ${tier} preset saves and reloads exactly`, () => {
      const props = resProps(tier);
      const pixelData = makeBlankPixelData(1, 1);
      const sourceDef = serializeCustomBlock(`rt2e-${tier}`, `RT ${tier}`, 1, 1, pixelData, props);
      const parsed = parseCustomBlockSource(sourceDef);
      assert.equal(parsed.ok, true);
      if (parsed.ok) assert.equal(parsed.def.properties.breakResistance, tier);
    });
  }
});

// ── 4. Unknown values produce a diagnostic and safe fallback ────────────────

describe('Phase 2E: invalid breakResistance values', () => {
  test('4. unknown breakResistance value is rejected safely and falls back to standard', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', breakability: 'fragile', breakResistance: 'adamantine' },
      1, 1, { blockId: 'bad-resistance' },
    );
    assert.equal(result.properties.breakResistance, 'standard');
    assert.ok(result.errors.some(e => e.field === 'properties.breakResistance'));
    assert.equal(result.fallbackUsed, true);
  });

  test('isBreakResistancePreset rejects non-strings and unknown strings', () => {
    assert.equal(isBreakResistancePreset('weak'), true);
    assert.equal(isBreakResistancePreset('standard'), true);
    assert.equal(isBreakResistancePreset('reinforced'), true);
    assert.equal(isBreakResistancePreset('adamantine'), false);
    assert.equal(isBreakResistancePreset(42), false);
    assert.equal(isBreakResistancePreset(undefined), false);
  });

  test('breakResistanceToIndex / indexToBreakResistance round trip, unknown index falls back to standard', () => {
    for (const tier of BREAK_RESISTANCE_PRESET_IDS) {
      assert.equal(indexToBreakResistance(breakResistanceToIndex(tier)), tier);
    }
    assert.equal(indexToBreakResistance(99), 'standard');
  });
});

// ── 5. Standard preserves the existing threshold exactly ────────────────────

describe('Phase 2E: standard tier matches the pre-Phase-2E global threshold', () => {
  test('5. standard-tier 1x1 does not break at 240 wu/s but does break at 260 wu/s', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('std-1x1', resProps('standard'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:std-1x1', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);

    const worldBelow = worldWithPlayerAt(roomDef, 5, 5, 240);
    applyHazards(worldBelow);
    assert.equal(worldBelow.isBreakableBlockActiveFlag[0], 1, '240 wu/s must not break the pre-existing 250 threshold');

    const worldAbove = worldWithPlayerAt(roomDef, 5, 5, 260);
    applyHazards(worldAbove);
    assert.equal(worldAbove.isBreakableBlockActiveFlag[0], 0, '260 wu/s must break the pre-existing 250 threshold');
    clearCustomBlockSpriteCache();
  });
});

// ── 6, 7, 8, 9. Real per-tier momentum application ──────────────────────────

describe('Phase 2E: real per-tier momentum thresholds', () => {
  function breaksAt(tier: BreakResistancePreset, velocity: number): boolean {
    clearCustomBlockSpriteCache();
    registerTestBlock(`tier-${tier}-${velocity}`, resProps(tier));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: `custom:tier-${tier}-${velocity}`, tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5, velocity);
    applyHazards(world);
    const broke = world.isBreakableBlockActiveFlag[0] === 0;
    clearCustomBlockSpriteCache();
    return broke;
  }

  test('6. a momentum value between weak (150) and standard (250) breaks weak but not standard', () => {
    assert.equal(breaksAt('weak', 200), true);
    assert.equal(breaksAt('standard', 200), false);
  });

  test('7. a momentum value between standard (250) and reinforced (350) breaks standard but not reinforced', () => {
    assert.equal(breaksAt('standard', 300), true);
    assert.equal(breaksAt('reinforced', 300), false);
  });

  test('8. a momentum value above reinforced (350) breaks all three tiers', () => {
    assert.equal(breaksAt('weak', 400), true);
    assert.equal(breaksAt('standard', 400), true);
    assert.equal(breaksAt('reinforced', 400), true);
  });

  test('9. resting or low-speed contact breaks none of the three tiers', () => {
    assert.equal(breaksAt('weak', 50), false);
    assert.equal(breaksAt('standard', 50), false);
    assert.equal(breaksAt('reinforced', 50), false);
  });

  test('10. a 1x1 placement uses the selected threshold end to end', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('weak-1x1-check', resProps('weak'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:weak-1x1-check', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.[0]?.breakResistance, 'weak');
    const world = worldWithPlayerAt(roomDef, 5, 5, 160); // above weak(150), below standard(250)
    applyHazards(world);
    assert.equal(world.isBreakableBlockActiveFlag[0], 0);
    clearCustomBlockSpriteCache();
  });
});

// ── 11, 12, 13, 14. Grouped 2x2 shared-resistance destruction ───────────────

describe('Phase 2E: grouped 2x2 shared resistance', () => {
  test('11. all four cells of one 2x2 group carry the same resistance tier', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('reinforced-2x2', resProps('reinforced'), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:reinforced-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const cells = roomDef.breakableBlocks ?? [];
    assert.equal(cells.length, 4);
    assert.ok(cells.every(c => c.breakResistance === 'reinforced'));
    clearCustomBlockSpriteCache();
  });

  test('12. sub-threshold impact leaves the entire weak-tier 2x2 group intact', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('weak-2x2-sub', resProps('weak'), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:weak-2x2-sub', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 10, 10, 100); // below weak(150)
    applyHazards(world);
    for (let i = 0; i < 4; i++) assert.equal(world.isBreakableBlockActiveFlag[i], 1);
    clearCustomBlockSpriteCache();
  });

  test('13. qualifying impact destroys the full weak-tier 2x2 group atomically', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('weak-2x2-full', resProps('weak'), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:weak-2x2-full', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 10, 10, 200); // above weak(150), below standard(250)
    applyHazards(world);
    for (let i = 0; i < 4; i++) assert.equal(world.isBreakableBlockActiveFlag[i], 0);
    assert.equal(world.breakEventCount, 1, 'one break event for the complete placement');
    clearCustomBlockSpriteCache();
  });

  test('14. adjacent groups with different resistance tiers remain independent', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('weak-adj', resProps('weak'), 2, 2);
    registerTestBlock('reinforced-adj', resProps('reinforced'), 2, 2);
    const room = makeEditorRoomData([
      { xBlock: 0, yBlock: 0, blockId: 'custom:weak-adj', tileWidth: 2, tileHeight: 2 },
      { xBlock: 2, yBlock: 0, blockId: 'custom:reinforced-adj', tileWidth: 2, tileHeight: 2 },
    ]);
    const roomDef = editorRoomDataToRoomDef(room);
    // Strike the weak placement with momentum that breaks weak (150) but not reinforced (350).
    const world = worldWithPlayerAt(roomDef, 0, 0, 200);
    applyHazards(world);
    for (let i = 0; i < world.breakableBlockCount; i++) {
      const isWeakPlacement = world.breakableBlockXWorld[i] < 2 * BLOCK_SIZE_MEDIUM;
      assert.equal(world.isBreakableBlockActiveFlag[i], isWeakPlacement ? 0 : 1);
    }
    clearCustomBlockSpriteCache();
  });

  test('15. duplicate destruction callbacks on an already-broken group emit no additional break events', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('weak-2x2-idem', resProps('weak'), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 12, yBlock: 12, blockId: 'custom:weak-2x2-idem', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 12, 12, 200);
    applyHazards(world);
    assert.equal(world.breakEventCount, 1);
    applyHazards(world);
    assert.equal(world.breakEventCount, 0, 'no new break events on an already-broken placement');
    applyHazards(world);
    assert.equal(world.breakEventCount, 0);
    clearCustomBlockSpriteCache();
  });
});

// ── 16, 17. Indestructible retention ─────────────────────────────────────────

describe('Phase 2E: indestructible retention', () => {
  test('16. an indestructible block with breakResistance set ignores it at runtime (never enters the breakable pathway)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('indestruct-weak', resProps('weak', { breakability: 'indestructible' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:indestruct-weak', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.length ?? 0, 0);
    const world = worldWithPlayerAt(roomDef, 5, 5, 400); // even at extreme speed
    applyHazards(world);
    assert.equal(world.breakableBlockCount, 0);
    clearCustomBlockSpriteCache();
  });

  test('17. switching a block from indestructible back to fragile restores the selected resistance', () => {
    const withResistance = resProps('weak', { breakability: 'indestructible' });
    const savedAsIndestructible = parseCustomBlockSource(
      serializeCustomBlock('toggle-2e', 'Toggle', 1, 1, makeBlankPixelData(1, 1), withResistance),
    );
    assert.equal(savedAsIndestructible.ok, true);
    if (!savedAsIndestructible.ok) return;
    assert.equal(savedAsIndestructible.def.properties.breakResistance, 'weak');

    // Flip only breakability back to fragile, keeping the same breakResistance value.
    const backToFragile = { ...savedAsIndestructible.def.properties, breakability: 'fragile' as const };
    const reSaved = parseCustomBlockSource(
      serializeCustomBlock('toggle-2e', 'Toggle', 1, 1, makeBlankPixelData(1, 1), backToFragile),
    );
    assert.equal(reSaved.ok, true);
    if (reSaved.ok) {
      assert.equal(reSaved.def.properties.breakability, 'fragile');
      assert.equal(reSaved.def.properties.breakResistance, 'weak', 'resistance choice must survive the round trip');
    }
  });
});

// ── 18, 19, 20. Editor dirty-tracking / rename / duplicate data-model behavior ─

describe('Phase 2E: editor dirty tracking, undo/redo, rename, duplicate', () => {
  test('18. changing only breakResistance is detected as dirty, and undo restores it', () => {
    const original: CustomBlockProperties = resProps('standard');
    const undoStack: CustomBlockProperties[] = [original];
    let properties: CustomBlockProperties = { ...original, breakResistance: 'reinforced' };

    function propertiesEqual(a: CustomBlockProperties, b: CustomBlockProperties): boolean {
      return a.collision === b.collision && a.friction === b.friction && a.breakability === b.breakability &&
        a.materialResponse === b.materialResponse && a.contactDamage === b.contactDamage &&
        a.breakResistance === b.breakResistance;
    }

    assert.equal(propertiesEqual(properties, original), false, 'breakResistance-only change must be dirty');

    const restored = undoStack.pop()!;
    properties = restored;
    assert.equal(properties.breakResistance, 'standard');
  });

  test('19. rename preserves breakResistance (serializeCustomBlock -> parseCustomBlockSource)', () => {
    const props = resProps('reinforced');
    const before = parseCustomBlockSource(serializeCustomBlock('stable-2e', 'Old Name', 1, 1, makeBlankPixelData(1, 1), props));
    const afterRename = parseCustomBlockSource(serializeCustomBlock('stable-2e', 'New Name', 1, 1, makeBlankPixelData(1, 1), props));
    assert.equal(before.ok, true);
    assert.equal(afterRename.ok, true);
    if (before.ok && afterRename.ok) {
      assert.equal(before.def.id, afterRename.def.id);
      assert.equal(afterRename.def.properties.breakResistance, 'reinforced');
      assert.deepEqual(before.def.properties, afterRename.def.properties);
    }
  });

  test('20. duplicate copies breakResistance with a new stable ID', () => {
    const props = resProps('weak');
    const original = parseCustomBlockSource(serializeCustomBlock('orig-2e', 'Original', 1, 1, makeBlankPixelData(1, 1), props));
    const dup = parseCustomBlockSource(serializeCustomBlock('orig-2e-copy', 'Original Copy', 1, 1, makeBlankPixelData(1, 1), props));
    assert.equal(original.ok, true);
    assert.equal(dup.ok, true);
    if (original.ok && dup.ok) {
      assert.equal(dup.def.properties.breakResistance, 'weak');
      assert.deepEqual(dup.def.properties, original.def.properties);
      assert.notEqual(dup.def.id, original.def.id);
    }
  });
});

// ── 21. Property-only edits do not rebuild the sprite canvas ───────────────

describe('Phase 2E: sprite-cache properties-only update', () => {
  test('21. updateCustomBlockProperties changes breakResistance without rebuilding the cached canvas', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('cache-2e', resProps('standard'));
    const before = getCustomBlockSprite('cache-2e');
    assert.ok(before !== null);
    const canvasBefore = before!.canvas;

    const ok = updateCustomBlockProperties('cache-2e', resProps('reinforced'));
    assert.equal(ok, true);

    const after = getCustomBlockSprite('cache-2e');
    assert.ok(after !== null);
    assert.equal(after!.canvas, canvasBefore, 'canvas object must be the SAME instance — no rebuild');
    assert.equal(after!.properties.breakResistance, 'reinforced');
    clearCustomBlockSpriteCache();
  });
});

// ── 22. Contact-damage ordering still holds ─────────────────────────────────

describe('Phase 2E: contact-damage interaction', () => {
  test('22. a reinforced damaging block still applies contact damage even when momentum is insufficient to break it', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('reinforced-dmg', resProps('reinforced', { contactDamage: 'high' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:reinforced-dmg', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    // 200 wu/s is well below reinforced's 350 threshold, but contact damage
    // does not depend on momentum at all.
    const world = worldWithPlayerAt(roomDef, 5, 5, 200);
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 2, 'high-tier contact damage still applied');
    assert.equal(world.isBreakableBlockActiveFlag[0], 1, 'block must NOT break below its reinforced threshold');
  });

  test('a weak fragile+damaging 2x2 block applies damage exactly once even though it also breaks', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('weak-dmg-2x2', resProps('weak', { contactDamage: 'low' }), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:weak-dmg-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 10, 10, 200); // breaks weak(150), well below standard(250)
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 1, 'exactly one low-tier hit, not four');
    for (let i = 0; i < 4; i++) assert.equal(world.isBreakableBlockActiveFlag[i], 0);
    clearCustomBlockSpriteCache();
  });
});

// ── 23. Material-response break feedback still emits once ──────────────────

describe('Phase 2E: material-response interaction', () => {
  test('23. a reinforced 2x2 metal block still emits exactly one material-specific break event', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('reinforced-metal-2x2', resProps('reinforced', { materialResponse: 'metal' }), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:reinforced-metal-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 10, 10, 400); // exceeds reinforced(350)
    applyHazards(world);
    assert.equal(world.breakEventCount, 1);
    assert.equal(world.breakEventMaterial[0], 2, 'metal index (2)');
    assert.equal(world.breakEventIsGroupedFlag[0], 1);
    clearCustomBlockSpriteCache();
  });
});

// ── 24. Export and relocated reopening preserve the preset ──────────────────

describe('Phase 2E: export/relocate round trip', () => {
  test('24. export and relocated reload preserve the breakResistance preset exactly', () => {
    const props = resProps('reinforced');
    const pixelData = makeBlankPixelData(2, 2);
    const sourceDef = serializeCustomBlock('relocate-2e', 'Relocate 2E', 2, 2, pixelData, props);
    assert.equal(sourceDef.schemaVersion, 2);
    const reloaded = JSON.parse(JSON.stringify(sourceDef));
    const parsed = parseCustomBlockSource(reloaded);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.def.properties.breakResistance, 'reinforced');
  });
});

// ── 25. Campaign switching cannot leak resistance profiles ──────────────────

describe('Phase 2E: campaign switch isolation', () => {
  test('25. campaign switch (sprite cache clear) does not leak stale breakResistance', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('leak-check-2e', resProps('reinforced'));
    assert.equal(getCustomBlockProperties('leak-check-2e').breakResistance, 'reinforced');
    clearCustomBlockSpriteCache(); // simulate switching campaigns
    registerTestBlock('leak-check-2e', resProps('weak'));
    assert.equal(getCustomBlockProperties('leak-check-2e').breakResistance, 'weak');
    clearCustomBlockSpriteCache();
  });

  test('unregistered id after a campaign clear never returns a previous campaign\'s resistance tier', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('gone-after-clear-2e', resProps('reinforced'));
    clearCustomBlockSpriteCache();
    assert.equal(getCustomBlockProperties('gone-after-clear-2e').breakResistance, 'standard'); // safe default, not leaked
  });
});

// ── 26. Built-in (non-custom-block) breakable blocks remain standard ───────

describe('Phase 2E: built-in breakable block backward compatibility', () => {
  test('26. a hand-authored breakableBlocks entry with no breakResistance field behaves exactly like the pre-Phase-2E standard threshold', () => {
    const world = createWorldState(16);
    const room = {
      breakableBlocks: [{ xBlock: 4, yBlock: 4 }], // no groupId/blockTheme/materialResponse/breakResistance — pre-Phase-2E shape
    } as unknown as RoomDef;
    assert.doesNotThrow(() => loadRoomHazards(world, room));
    assert.equal(world.breakableBlockCount, 1);

    const cx = (4 + 0.5) * BLOCK_SIZE_MEDIUM;
    const cy = (4 + 0.5) * BLOCK_SIZE_MEDIUM;

    const belowThreshold = createClusterState(0, cx, cy, 1, 10);
    belowThreshold.velocityXWorld = 240;
    world.clusters = [belowThreshold];
    applyHazards(world);
    assert.equal(world.isBreakableBlockActiveFlag[0], 1, '240 wu/s must not break the built-in default (standard) threshold');

    // Reload (world.breakableBlockCount/flags rebuilt) and confirm 260 does break it.
    loadRoomHazards(world, room);
    const aboveThreshold = createClusterState(0, cx, cy, 1, 10);
    aboveThreshold.velocityXWorld = 260;
    world.clusters = [aboveThreshold];
    applyHazards(world);
    assert.equal(world.isBreakableBlockActiveFlag[0], 0, '260 wu/s must break the built-in default (standard) threshold');
  });
});
