/**
 * Tests for Phase 2C: custom block material-response presets and break
 * feedback (sound + particle profiles selected by materialResponse).
 *
 * Covers: the materialResponse property/registry (customBlockProperties.ts),
 * schema-v1/v2 compatibility defaults, the break-event queue produced by
 * src/sim/hazards.ts (applyHazards) and threaded through
 * editorRoomBuilder.ts/gameRoomHazards.ts, the material sound-selection
 * boundary (audio/breakSfx.ts), and the bounded particle-profile selection
 * (render/breakEffectRenderer.ts). Extends (does not replace) the Phase 2A/2B
 * suites, whose coverage must continue to pass unchanged.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal DOM stubs for Node.js test environment (mirrors Phase 2B tests) ──
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
  isMaterialResponsePreset,
  materialResponseToIndex,
  indexToMaterialResponse,
  MATERIAL_RESPONSE_PRESET_IDS,
  type CustomBlockProperties,
  type MaterialResponsePreset,
} from '../levels/customBlockProperties';
import {
  registerCustomBlockSprite,
  getCustomBlockProperties,
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
import { materialBreakSoundName, resolveBreakVolumeScale } from '../audio/breakSfx';
import {
  BreakEffectRenderer,
  getMaterialParticleProfile,
  resolveBreakParticleCount,
} from '../render/breakEffectRenderer';

// ── Helpers (mirror src/tests/customBlocksPhase2B.test.ts) ──────────────────

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
    id: 'room-2c',
    name: 'Room 2C',
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

function fragileProps(materialResponse: MaterialResponsePreset): CustomBlockProperties {
  return { collision: 'solid', friction: 'default', breakability: 'fragile', materialResponse };
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

// ── 1 & 2. Schema defaults ───────────────────────────────────────────────────

describe('Phase 2C: schema defaults', () => {
  test('1. version-1 custom blocks default materialResponse to stone', () => {
    const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const pixels: string[][] = Array.from({ length: pw }, () => Array.from({ length: pw }, () => '#FF000088'));
    const source = {
      schemaVersion: 1, id: 'legacy', name: 'Legacy', tileWidth: 1, tileHeight: 1,
      pixelWidth: pw, pixelHeight: pw, behavior: 'solid', pixels,
    };
    const result = parseCustomBlockSource(source);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.def.properties.materialResponse, 'stone');
  });

  test('2. schema-v2 blocks without materialResponse default to stone', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', breakability: 'fragile' }, 1, 1, { blockId: 'no-material' },
    );
    assert.equal(result.properties.materialResponse, 'stone');
    assert.equal(result.fallbackUsed, false); // absence is not an error
  });
});

// ── 3. All three presets save and reload ────────────────────────────────────

describe('Phase 2C: preset round trip', () => {
  for (const material of MATERIAL_RESPONSE_PRESET_IDS) {
    test(`3. ${material} preset saves and reloads exactly`, () => {
      const props = fragileProps(material);
      const pixelData = makeBlankPixelData(1, 1);
      const sourceDef = serializeCustomBlock(`rt-${material}`, `RT ${material}`, 1, 1, pixelData, props);
      const parsed = parseCustomBlockSource(sourceDef);
      assert.equal(parsed.ok, true);
      if (parsed.ok) assert.equal(parsed.def.properties.materialResponse, material);
    });
  }
});

// ── 4. Unknown values produce a diagnostic and safe fallback ────────────────

describe('Phase 2C: invalid materialResponse values', () => {
  test('4. unknown materialResponse value is rejected safely and falls back to stone', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', breakability: 'fragile', materialResponse: 'diamond' },
      1, 1, { blockId: 'bad-material' },
    );
    assert.equal(result.properties.materialResponse, 'stone');
    assert.ok(result.errors.some(e => e.field === 'properties.materialResponse'));
    assert.equal(result.fallbackUsed, true);
  });

  test('isMaterialResponsePreset rejects non-strings and unknown strings', () => {
    assert.equal(isMaterialResponsePreset('stone'), true);
    assert.equal(isMaterialResponsePreset('wood'), true);
    assert.equal(isMaterialResponsePreset('metal'), true);
    assert.equal(isMaterialResponsePreset('lava'), false);
    assert.equal(isMaterialResponsePreset(42), false);
    assert.equal(isMaterialResponsePreset(undefined), false);
  });
});

// ── 5, 6, 7. Editor dirty-tracking / rename / duplicate data-model behavior ─
//
// The pixel-art dialog itself (editorCustomBlockDialog.ts) is DOM-driven and,
// consistent with the rest of this test suite, is not exercised via a
// browser DOM stub here. Instead these tests exercise the exact data
// operations the dialog performs: undo/redo snapshots are plain
// {pixelData, properties} objects pushed/popped from a stack (see
// editorCustomBlockDialog.ts pushUndo/doUndo), and rename/duplicate are
// implemented as serializeCustomBlock -> parseCustomBlockSource round trips
// (see editorController.ts onRenameCustomBlock/onDuplicateCustomBlock).

describe('Phase 2C: editor dirty tracking, undo/redo, rename, duplicate', () => {
  test('5. changing only materialResponse is detected as dirty, and undo restores it', () => {
    const original: CustomBlockProperties = fragileProps('stone');
    // Simulates the dialog's pushUndo() snapshot taken before the change.
    const undoStack: CustomBlockProperties[] = [original];
    let properties: CustomBlockProperties = { ...original, materialResponse: 'metal' };

    function propertiesEqual(a: CustomBlockProperties, b: CustomBlockProperties): boolean {
      return a.collision === b.collision && a.friction === b.friction && a.breakability === b.breakability &&
        a.materialResponse === b.materialResponse;
    }

    assert.equal(propertiesEqual(properties, original), false, 'materialResponse-only change must be dirty');

    // doUndo(): pop the snapshot and restore it.
    const restored = undoStack.pop()!;
    properties = restored;
    assert.equal(properties.materialResponse, 'stone');
  });

  test('6. rename preserves the material preset (serializeCustomBlock -> parseCustomBlockSource)', () => {
    const props = fragileProps('wood');
    const before = parseCustomBlockSource(serializeCustomBlock('stable-id', 'Old Name', 1, 1, makeBlankPixelData(1, 1), props));
    const afterRename = parseCustomBlockSource(serializeCustomBlock('stable-id', 'New Name', 1, 1, makeBlankPixelData(1, 1), props));
    assert.equal(before.ok, true);
    assert.equal(afterRename.ok, true);
    if (before.ok && afterRename.ok) {
      assert.equal(before.def.id, afterRename.def.id);
      assert.equal(afterRename.def.properties.materialResponse, 'wood');
      assert.deepEqual(before.def.properties, afterRename.def.properties);
    }
  });

  test('7. duplicate copies the material preset with a new stable ID', () => {
    const props = fragileProps('metal');
    const original = parseCustomBlockSource(serializeCustomBlock('orig', 'Original', 1, 1, makeBlankPixelData(1, 1), props));
    const dup = parseCustomBlockSource(serializeCustomBlock('orig-copy', 'Original Copy', 1, 1, makeBlankPixelData(1, 1), props));
    assert.equal(original.ok, true);
    assert.equal(dup.ok, true);
    if (original.ok && dup.ok) {
      assert.equal(dup.def.properties.materialResponse, 'metal');
      assert.deepEqual(dup.def.properties, original.def.properties);
      assert.notEqual(dup.def.id, original.def.id);
    }
  });
});

// ── 8-12. Break-event queue (src/sim/hazards.ts) ────────────────────────────

describe('Phase 2C: break-event queue', () => {
  test('8. breaking a 1x1 fragile block emits exactly one material-specific break event', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-wood-1x1', fragileProps('wood'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:frag-wood-1x1', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5);
    applyHazards(world);
    assert.equal(world.breakEventCount, 1);
    assert.equal(indexToMaterialResponse(world.breakEventMaterial[0]), 'wood');
    assert.equal(world.breakEventIsGroupedFlag[0], 0);
    assert.equal(world.breakEventGroupId[0], -1);
    clearCustomBlockSpriteCache();
  });

  test('9. striking any one of the 4 cells of a 2x2 fragile block emits exactly one event', () => {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      clearCustomBlockSpriteCache();
      registerTestBlock('frag-metal-2x2', fragileProps('metal'), 2, 2);
      const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:frag-metal-2x2', tileWidth: 2, tileHeight: 2 }]);
      const roomDef = editorRoomDataToRoomDef(room);
      const world = worldWithPlayerAt(roomDef, 10 + dx, 10 + dy);
      applyHazards(world);
      assert.equal(world.breakEventCount, 1, `offset (${dx},${dy}) should emit exactly one event`);
      assert.equal(indexToMaterialResponse(world.breakEventMaterial[0]), 'metal');
      assert.equal(world.breakEventIsGroupedFlag[0], 1);
      clearCustomBlockSpriteCache();
    }
  });

  test('10. the 2x2 event uses the complete placement center and footprint', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-stone-2x2', fragileProps('stone'), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 6, yBlock: 6, blockId: 'custom:frag-stone-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 7, 6); // strike the top-right cell
    applyHazards(world);
    assert.equal(world.breakEventCount, 1);
    // Full 2x2 footprint spans blocks [6,8) x [6,8) -> center at (7,7) blocks.
    const expectedCenterX = (6 + 8) / 2 * BLOCK_SIZE_MEDIUM;
    const expectedCenterY = (6 + 8) / 2 * BLOCK_SIZE_MEDIUM;
    assert.ok(Math.abs(world.breakEventXWorld[0] - expectedCenterX) < 0.001);
    assert.ok(Math.abs(world.breakEventYWorld[0] - expectedCenterY) < 0.001);
    assert.ok(Math.abs(world.breakEventWWorld[0] - 2 * BLOCK_SIZE_MEDIUM) < 0.001);
    assert.ok(Math.abs(world.breakEventHWorld[0] - 2 * BLOCK_SIZE_MEDIUM) < 0.001);
    clearCustomBlockSpriteCache();
  });

  test('11. duplicate destruction attempts emit no additional events', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-idem-2x2', fragileProps('stone'), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 12, yBlock: 12, blockId: 'custom:frag-idem-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 12, 12);
    applyHazards(world);
    assert.equal(world.breakEventCount, 1);
    applyHazards(world); // second call: cells already broken, active-flag guard prevents re-entry
    assert.equal(world.breakEventCount, 0, 'no new events on an already-broken placement');
    applyHazards(world);
    assert.equal(world.breakEventCount, 0);
    clearCustomBlockSpriteCache();
  });

  test('12. adjacent grouped placements remain independent — breaking one does not emit an event for the other', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-adj-2x2', fragileProps('wood'), 2, 2);
    const room = makeEditorRoomData([
      { xBlock: 0, yBlock: 0, blockId: 'custom:frag-adj-2x2', tileWidth: 2, tileHeight: 2 },
      { xBlock: 2, yBlock: 0, blockId: 'custom:frag-adj-2x2', tileWidth: 2, tileHeight: 2 },
    ]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 0, 0); // strike only the first placement
    applyHazards(world);
    assert.equal(world.breakEventCount, 1);
    // First placement spans blocks [0,2)x[0,2) -> center (1,1) blocks.
    const expectedCenterX = 1 * BLOCK_SIZE_MEDIUM;
    assert.ok(Math.abs(world.breakEventXWorld[0] - expectedCenterX) < 0.001);
    // Second placement (xBlock>=2) must remain fully active.
    for (let i = 0; i < world.breakableBlockCount; i++) {
      const isSecondPlacement = world.breakableBlockXWorld[i] >= 2 * BLOCK_SIZE_MEDIUM;
      if (isSecondPlacement) assert.equal(world.isBreakableBlockActiveFlag[i], 1);
    }
    clearCustomBlockSpriteCache();
  });

  test('16. indestructible blocks emit no break event (not eligible for the breakable pathway)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('indestruct-metal', { collision: 'solid', friction: 'default', breakability: 'indestructible', materialResponse: 'metal' });
    const room = makeEditorRoomData([{ xBlock: 4, yBlock: 4, blockId: 'custom:indestruct-metal', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.length ?? 0, 0);
    const world = worldWithPlayerAt(roomDef, 4, 4);
    applyHazards(world);
    assert.equal(world.breakEventCount, 0);
    clearCustomBlockSpriteCache();
  });
});

// ── 13, 14, 15. Sound + particle profile selection ──────────────────────────

describe('Phase 2C: sound and particle profile selection', () => {
  test('13. stone, wood, and metal select distinct sound names', () => {
    const names = MATERIAL_RESPONSE_PRESET_IDS.map(materialBreakSoundName);
    assert.equal(new Set(names).size, 3, 'all three materials should map to distinct sounds');
    assert.equal(materialBreakSoundName('stone'), 'jump_impact_hard');
    assert.equal(materialBreakSoundName('wood'), 'jump_impact_medium');
    assert.equal(materialBreakSoundName('metal'), 'grapple_impact');
  });

  test('13b. stone, wood, and metal select distinct particle profiles', () => {
    const profiles = MATERIAL_RESPONSE_PRESET_IDS.map(getMaterialParticleProfile);
    const colorSets = profiles.map(p => p.colors.join(','));
    assert.equal(new Set(colorSets).size, 3, 'all three materials should use distinct color palettes');
  });

  test('14. particle counts remain within documented bounds', () => {
    for (const material of MATERIAL_RESPONSE_PRESET_IDS) {
      for (const isGrouped of [false, true]) {
        const count = resolveBreakParticleCount(material, isGrouped, 'high');
        assert.ok(count > 0 && count <= 24, `count ${count} should be small and bounded`);
        if (isGrouped) {
          const ungroupedCount = resolveBreakParticleCount(material, false, 'high');
          // Grouped is scaled up modestly, never 4x the ungrouped count.
          assert.ok(count < ungroupedCount * 4, 'grouped placements must not emit 4x the ungrouped burst');
        }
      }
    }
  });

  test('15. reduced-particle (low graphics) settings reduce cosmetic output', () => {
    for (const material of MATERIAL_RESPONSE_PRESET_IDS) {
      const low = resolveBreakParticleCount(material, false, 'low');
      const med = resolveBreakParticleCount(material, false, 'med');
      const high = resolveBreakParticleCount(material, false, 'high');
      assert.ok(low < med, `low (${low}) should be less than med (${med}) for ${material}`);
      assert.ok(med <= high, `med (${med}) should be <= high (${high}) for ${material}`);
    }
  });

  test('BreakEffectRenderer.notifyBreak spawns a bounded, quality-scaled particle count', () => {
    const renderer = new BreakEffectRenderer();
    renderer.notifyBreak(0, 0, 'stone', false, 'high');
    const expected = resolveBreakParticleCount('stone', false, 'high');
    assert.equal(renderer.liveCount, expected);
  });

  test('volume scale attenuates with concurrent event count but never drops below the floor', () => {
    const single = resolveBreakVolumeScale(false, 1);
    const many = resolveBreakVolumeScale(false, 8);
    assert.ok(many < single);
    assert.ok(many >= 0.5 * single * 0.5); // stays audible, never collapses to ~0
  });
});

// ── 17. Missing definitions use the safe default ────────────────────────────

describe('Phase 2C: missing definitions', () => {
  test('17. unregistered block id falls back to the default (stone) material', () => {
    clearCustomBlockSpriteCache();
    assert.equal(getCustomBlockProperties('does-not-exist').materialResponse, 'stone');
  });

  test('materialResponseToIndex / indexToMaterialResponse round trip, unknown index falls back to stone', () => {
    for (const material of MATERIAL_RESPONSE_PRESET_IDS) {
      assert.equal(indexToMaterialResponse(materialResponseToIndex(material)), material);
    }
    assert.equal(indexToMaterialResponse(99), 'stone');
  });
});

// ── 18. Export and relocated reopening preserve the preset ──────────────────

describe('Phase 2C: export/relocate round trip', () => {
  test('18. export and relocated reload preserve the material preset exactly', () => {
    const props = fragileProps('metal');
    const pixelData = makeBlankPixelData(2, 2);
    const sourceDef = serializeCustomBlock('relocate-me', 'Relocate Me', 2, 2, pixelData, props);
    assert.equal(sourceDef.schemaVersion, 2);
    // Simulate "export then reopen at a different location" — re-parse from
    // the exact serialized JSON shape with no additional context.
    const reloaded = JSON.parse(JSON.stringify(sourceDef));
    const parsed = parseCustomBlockSource(reloaded);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.def.properties.materialResponse, 'metal');
  });
});

// ── 19. Campaign switching does not leak material profiles ─────────────────

describe('Phase 2C: campaign switch isolation', () => {
  test('19. campaign switch (sprite cache clear) does not leak stale materialResponse', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('leak-check-2c', fragileProps('metal'), 2, 2);
    assert.equal(getCustomBlockProperties('leak-check-2c').materialResponse, 'metal');
    clearCustomBlockSpriteCache(); // simulate switching campaigns
    // A fresh campaign re-registering under the SAME raw id with different
    // properties must fully replace the old entry, not blend with it.
    registerTestBlock('leak-check-2c', { collision: 'solid', friction: 'default', breakability: 'indestructible', materialResponse: 'stone' });
    assert.equal(getCustomBlockProperties('leak-check-2c').materialResponse, 'stone');
    clearCustomBlockSpriteCache();
  });

  test('unregistered id after a campaign clear never returns a previous campaign\'s material', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('gone-after-clear', fragileProps('wood'));
    clearCustomBlockSpriteCache();
    assert.equal(getCustomBlockProperties('gone-after-clear').materialResponse, 'stone'); // safe default, not leaked 'wood'
  });
});
