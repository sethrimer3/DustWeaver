/**
 * Tests for Phase 2G: custom block pixel-material LIQUID interaction presets
 * (seal / drain).
 *
 * Covers: the liquidInteraction property/registry (customBlockProperties.ts),
 * schema-v1/v2 compatibility defaults, the CustomBlockLiquidMask class, real
 * seal/drain enforcement via PixelMaterialSystem.stepLiquidParticle (the
 * single authoritative liquid-movement-eligibility pathway), real room-load
 * wiring (editorRoomBuilder.ts -> gameRoomHazards.ts / gameRoomPixelMaterials.ts),
 * fragile-seal/drain mask invalidation via the real destruction pathway
 * (sim/hazards.ts), 1x1/2x2 footprints, adjacent-placement independence,
 * overlap-rejection, initial drain-overlap policy, performance/fast-path
 * behavior, and interaction preservation with all prior-phase properties.
 * Extends (does not replace) the Phase 2A-2F suites, whose coverage must
 * continue to pass unchanged.
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
  checkCustomBlockPropertyCompatibility,
  isCustomBlockLiquidInteractionPreset,
  liquidInteractionTierToIndex,
  indexToLiquidInteractionTier,
  isEligibleForLiquidInteraction,
  CUSTOM_BLOCK_LIQUID_INTERACTION_PRESET_IDS,
  type CustomBlockProperties,
  type CustomBlockLiquidInteractionPreset,
  type CollisionPreset,
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
import { loadRoomPixelMaterials } from '../screens/gameRoomPixelMaterials';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { applyHazards } from '../sim/hazards';
import { PixelMaterialSystem } from '../sim/pixelMaterials/pixelMaterialSystem';
import { SolidMask } from '../sim/pixelMaterials/pixelMaterialSolid';
import {
  MATERIAL_SAND,
  MATERIAL_WATER,
  MATERIAL_SANDSTONE,
} from '../sim/pixelMaterials/pixelMaterialTypes';
import { CustomBlockLiquidMask } from '../sim/pixelMaterials/customBlockLiquidMask';

// ── Helpers (mirror src/tests/customBlocksPhase2F.test.ts) ──────────────────

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
    id: 'room-2g',
    name: 'Room 2G',
    worldNumber: 0,
    mapX: 0,
    mapY: 0,
    blockTheme: 'blackRock',
    backgroundId: undefined,
    lightingEffect: undefined,
    songId: '_continue',
    widthBlocks: 40,
    heightBlocks: 30,
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

/** Block properties with a given liquidInteraction tier, collision, and optional overrides. */
function liquidProps(
  liquidInteraction: CustomBlockLiquidInteractionPreset,
  collision: CollisionPreset = 'solid',
  overrides: Partial<CustomBlockProperties> = {},
): CustomBlockProperties {
  return {
    collision, friction: 'default', breakability: 'indestructible',
    materialResponse: 'stone', contactDamage: 'none', breakResistance: 'standard',
    windResponse: 'passThrough', liquidInteraction, ...overrides,
  };
}

/** Builds a world (hazards + pixel materials) with a player cluster at given block coords/velocity. */
function worldWithPlayerAt(
  room: RoomDef, cxBlock: number, cyBlock: number, velocityXWorld: number,
): ReturnType<typeof createWorldState> {
  const world = createWorldState(16);
  loadRoomHazards(world, room);
  loadRoomPixelMaterials(world, room);
  const cx = (cxBlock + 0.5) * BLOCK_SIZE_MEDIUM;
  const cy = (cyBlock + 0.5) * BLOCK_SIZE_MEDIUM;
  const player = createClusterState(0, cx, cy, 1, 10);
  player.velocityXWorld = velocityXWorld;
  world.clusters = [player];
  return world;
}

function makeSystem(w = 60, h = 60): PixelMaterialSystem {
  return new PixelMaterialSystem(w, h, new SolidMask(w, h));
}

// ── 1, 2. Schema defaults ────────────────────────────────────────────────────

describe('Phase 2G: schema defaults', () => {
  test('1. version-1 custom blocks default liquidInteraction to none', () => {
    const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const pixels: string[][] = Array.from({ length: pw }, () => Array.from({ length: pw }, () => '#FF000088'));
    const source = {
      schemaVersion: 1, id: 'legacy-2g', name: 'Legacy', tileWidth: 1, tileHeight: 1,
      pixelWidth: pw, pixelHeight: pw, behavior: 'solid', pixels,
    };
    const result = parseCustomBlockSource(source);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.def.properties.liquidInteraction, 'none');
  });

  test('2. schema-v2 blocks without liquidInteraction default to none (absence is not an error)', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', breakability: 'indestructible' }, 1, 1, { blockId: 'no-liquid' },
    );
    assert.equal(result.properties.liquidInteraction, 'none');
    assert.equal(result.fallbackUsed, false);
  });
});

// ── 3. All three presets save and reload ────────────────────────────────────

describe('Phase 2G: preset round trip', () => {
  for (const tier of CUSTOM_BLOCK_LIQUID_INTERACTION_PRESET_IDS) {
    test(`3. ${tier} preset saves and reloads exactly`, () => {
      const props = liquidProps(tier);
      const pixelData = makeBlankPixelData(1, 1);
      const sourceDef = serializeCustomBlock(`rt2g-${tier.toLowerCase()}`, `RT ${tier}`, 1, 1, pixelData, props);
      const parsed = parseCustomBlockSource(sourceDef);
      assert.equal(parsed.ok, true);
      if (parsed.ok) assert.equal(parsed.def.properties.liquidInteraction, tier);
    });
  }
});

// ── 4. Unknown values / type guard / numeric packing ────────────────────────

describe('Phase 2G: invalid liquidInteraction values and packing', () => {
  test('4. unknown liquidInteraction value is rejected safely and falls back to none', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', liquidInteraction: 'evaporate' },
      1, 1, { blockId: 'bad-liquid' },
    );
    assert.equal(result.properties.liquidInteraction, 'none');
    assert.ok(result.errors.some(e => e.field === 'properties.liquidInteraction'));
    assert.equal(result.fallbackUsed, true);
  });

  test('isCustomBlockLiquidInteractionPreset rejects non-strings and unknown strings', () => {
    assert.equal(isCustomBlockLiquidInteractionPreset('none'), true);
    assert.equal(isCustomBlockLiquidInteractionPreset('seal'), true);
    assert.equal(isCustomBlockLiquidInteractionPreset('drain'), true);
    assert.equal(isCustomBlockLiquidInteractionPreset('evaporate'), false);
    assert.equal(isCustomBlockLiquidInteractionPreset(42), false);
    assert.equal(isCustomBlockLiquidInteractionPreset(undefined), false);
  });

  test('liquidInteractionTierToIndex / indexToLiquidInteractionTier round trip', () => {
    assert.equal(indexToLiquidInteractionTier(liquidInteractionTierToIndex('seal')), 'seal');
    assert.equal(indexToLiquidInteractionTier(liquidInteractionTierToIndex('drain')), 'drain');
    assert.equal(indexToLiquidInteractionTier(99), 'seal'); // unknown index falls back to seal
  });
});

// ── 5. All collision presets can use seal and drain (no compatibility rule) ─

describe('Phase 2G: liquidInteraction is compatible with every collision preset', () => {
  test('5a. solid/oneWay/nonSolid all accept seal with zero compatibility issues', () => {
    for (const collision of ['solid', 'oneWay', 'nonSolid'] as const) {
      assert.equal(checkCustomBlockPropertyCompatibility(liquidProps('seal', collision), 1, 1).length, 0);
    }
  });

  test('5b. solid/oneWay/nonSolid all accept drain with zero compatibility issues', () => {
    for (const collision of ['solid', 'oneWay', 'nonSolid'] as const) {
      assert.equal(checkCustomBlockPropertyCompatibility(liquidProps('drain', collision), 1, 1).length, 0);
    }
  });

  test('isEligibleForLiquidInteraction requires only a non-none tier, no collision requirement', () => {
    assert.equal(isEligibleForLiquidInteraction(liquidProps('seal', 'nonSolid')), true);
    assert.equal(isEligibleForLiquidInteraction(liquidProps('drain', 'oneWay')), true);
    assert.equal(isEligibleForLiquidInteraction(liquidProps('none')), false);
  });
});

// ── 6. CustomBlockLiquidMask unit behavior ──────────────────────────────────

describe('Phase 2G: CustomBlockLiquidMask', () => {
  test('6a. a fresh mask is empty and every cell reads tier 0', () => {
    const mask = new CustomBlockLiquidMask(20, 20);
    assert.equal(mask.isEmpty, true);
    assert.equal(mask.tierAt(5, 5), 0);
    assert.equal(mask.tierAt(-1, 0), 0, 'out of bounds reads as no modifier');
    assert.equal(mask.tierAt(100, 100), 0);
  });

  test('6b. markRect sets tier and flips isEmpty; clearRect restores it', () => {
    const mask = new CustomBlockLiquidMask(20, 20);
    mask.markRect(5, 5, 8, 8, 1);
    assert.equal(mask.isEmpty, false);
    assert.equal(mask.tierAt(5, 5), 1);
    assert.equal(mask.tierAt(7, 7), 1);
    assert.equal(mask.tierAt(8, 8), 0, 'exclusive upper bound');
    mask.clearRect(5, 5, 8, 8);
    assert.equal(mask.isEmpty, true);
    assert.equal(mask.tierAt(5, 5), 0);
  });

  test('6c. overlapping markRect calls resolve deterministically to the higher tier (drain > seal)', () => {
    const mask = new CustomBlockLiquidMask(20, 20);
    mask.markRect(0, 0, 5, 5, 1); // seal
    mask.markRect(2, 2, 7, 7, 2); // drain, overlapping
    assert.equal(mask.tierAt(3, 3), 2, 'overlap resolves to drain regardless of write order');
    const mask2 = new CustomBlockLiquidMask(20, 20);
    mask2.markRect(2, 2, 7, 7, 2); // drain first
    mask2.markRect(0, 0, 5, 5, 1); // seal second, overlapping
    assert.equal(mask2.tierAt(3, 3), 2, 'order-independent: drain still wins');
  });
});

// ── 7. Fast path: empty/null mask is byte-identical to pre-Phase-2G behavior ─

describe('Phase 2G: fast path — empty/null liquidMask changes nothing', () => {
  test('7a. null liquidMask (pre-Phase-2G rooms) behaves exactly like plain liquid movement', () => {
    const sys = makeSystem();
    assert.equal(sys.liquidMask, null, 'default is null');
    sys.place(30, 20, MATERIAL_WATER);
    sys.step();
    assert.equal(sys.getMaterialAt(30, 21), MATERIAL_WATER, 'water falls normally with no mask at all');
  });

  test('7b. an empty (non-null) mask produces the exact same result as a null mask', () => {
    const sysNull = makeSystem();
    sysNull.place(30, 20, MATERIAL_WATER);
    sysNull.step();

    const sysEmpty = makeSystem();
    sysEmpty.liquidMask = new CustomBlockLiquidMask(60, 60);
    sysEmpty.place(30, 20, MATERIAL_WATER);
    sysEmpty.step();

    assert.equal(sysEmpty.getMaterialAt(30, 21), sysNull.getMaterialAt(30, 21));
    assert.equal(sysEmpty.isOccupied(30, 20), sysNull.isOccupied(30, 20));
  });

  test('7c. a room with only none-tier custom blocks preserves existing pixel-material liquid behavior', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('liquid-none', liquidProps('none'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:liquid-none', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    loadRoomPixelMaterials(world, roomDef);
    assert.equal(world.pixelMaterialSystem.liquidMask?.isEmpty, true);
    world.pixelMaterialSystem.place(20, 20, MATERIAL_WATER);
    world.pixelMaterialSystem.step();
    assert.equal(world.pixelMaterialSystem.getMaterialAt(20, 21), MATERIAL_WATER);
    clearCustomBlockSpriteCache();
  });
});

// ── 8. Seal behavior ─────────────────────────────────────────────────────────

describe('Phase 2G: seal prevents liquid movement into its footprint', () => {
  test('8a. seal prevents downward liquid movement into its footprint', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    // Seal the entire row below (down + both diagonal destinations) so the
    // test isolates "does seal block downward/diagonal entry" from the
    // separate horizontal-spread rule (covered by 8c).
    sys.liquidMask.markRect(29, 21, 32, 22, 1);
    sys.place(30, 20, MATERIAL_WATER);
    sys.step();
    assert.equal(sys.particleCount, 1, 'the particle must not have been removed');
    for (let x = 29; x <= 31; x++) {
      assert.equal(sys.getMaterialAt(x, 21), 0, `sealed cell (${x},21) must remain empty`);
    }
  });

  test('8b. seal prevents diagonal movement into its footprint', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    // Block straight-down with solid, seal both diagonals, forcing an all-blocked step
    // (isolated from horizontal spread, which is covered separately by 8c).
    sys.solid!.markRect(30, 21, 31, 22);
    sys.liquidMask.markRect(29, 21, 30, 22, 1); // seal diagonal-left destination
    sys.liquidMask.markRect(31, 21, 32, 22, 1); // seal diagonal-right destination
    sys.place(30, 20, MATERIAL_WATER);
    sys.step();
    assert.equal(sys.getMaterialAt(29, 21), 0, 'sealed diagonal-left cell must remain empty');
    assert.equal(sys.getMaterialAt(31, 21), 0, 'sealed diagonal-right cell must remain empty');
    assert.equal(sys.particleCount, 1, 'the particle must not have been removed');
  });

  test('8c. seal prevents horizontal spreading into its footprint', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    // Solid floor everywhere in range so only horizontal spread remains as an option.
    sys.solid!.markRect(25, 21, 36, 22);
    sys.liquidMask.markRect(29, 20, 30, 21, 1); // seal left neighbor
    sys.liquidMask.markRect(31, 20, 32, 21, 1); // seal right neighbor
    sys.place(30, 20, MATERIAL_WATER);
    sys.step();
    assert.equal(sys.getMaterialAt(30, 20), MATERIAL_WATER, 'both horizontal neighbors sealed — water cannot spread');
  });

  test('9. a block beside, but not in, the movement destination has no effect', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    // Seal a cell far off to the side of the actual fall path — must not affect the fall.
    sys.liquidMask.markRect(0, 21, 1, 22, 1);
    sys.place(30, 20, MATERIAL_WATER);
    sys.step();
    assert.equal(sys.getMaterialAt(30, 21), MATERIAL_WATER, 'an unrelated sealed cell must not block the actual fall');
  });

  test('10. a solid custom block with seal blocks the player normally AND explicitly seals liquid (no conflicting collision)', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    // Solid+seal across the whole row under/around the particle so diagonal escape is impossible.
    sys.solid!.markRect(29, 21, 32, 22);
    sys.liquidMask.markRect(29, 21, 32, 22, 1);
    sys.place(30, 20, MATERIAL_WATER);
    sys.step();
    // Solid alone would already block the fall — seal is redundant but explicit, and must not
    // introduce any double-blocking artifact (still exactly one particle, still not fallen through).
    assert.equal(sys.particleCount, 1);
    for (let x = 29; x <= 31; x++) assert.equal(sys.getMaterialAt(x, 21), 0, `row 21 cell ${x} must stay empty`);
  });

  test('11. a non-solid seal block blocks liquid but has no player-collision meaning at the pixel-material layer', () => {
    // isRegionFree only consults `solid` (the world-tile mask), never `liquidMask` for
    // non-liquid queries — so a seal-only, non-solid block leaves canOccupy/solid semantics
    // completely untouched; only stepLiquidParticle's dedicated liquid gate consults it.
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(29, 21, 32, 22, 1); // seal the whole row, NOT solid
    assert.equal(sys.canOccupy(30, 21), true, 'non-solid seal cell is still free for non-liquid occupancy checks');
    sys.place(30, 20, MATERIAL_WATER);
    sys.step();
    assert.equal(sys.particleCount, 1, 'liquid is still blocked by seal despite the cell being non-solid');
    for (let x = 29; x <= 31; x++) assert.equal(sys.getMaterialAt(x, 21), 0, `row 21 cell ${x} must stay empty`);
  });
});

// ── 12. Drain behavior ───────────────────────────────────────────────────────

describe('Phase 2G: drain removes liquid attempting to enter its footprint', () => {
  test('12a. drain removes liquid attempting to fall into it', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(29, 21, 31, 22, 2);
    sys.place(30, 20, MATERIAL_WATER);
    assert.equal(sys.particleCount, 1);
    sys.step();
    assert.equal(sys.particleCount, 0, 'the particle must be entirely removed, not merely stopped');
    assert.equal(sys.isOccupied(30, 20), false);
    assert.equal(sys.isOccupied(30, 21), false, 'the drain cell itself never gains an occupant');
  });

  test('12b. drain removes liquid attempting diagonal movement into it', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.solid!.markRect(30, 21, 31, 22); // block straight-down so the particle tries diagonal
    // Drain BOTH diagonal destinations so the outcome doesn't depend on the
    // deterministic left/right preference alternation.
    sys.liquidMask.markRect(29, 21, 30, 22, 2);
    sys.liquidMask.markRect(31, 21, 32, 22, 2);
    sys.place(30, 20, MATERIAL_WATER);
    sys.step();
    assert.equal(sys.particleCount, 0, 'diagonal entry into a drain cell removes the particle');
  });

  test('12c. drain removes liquid attempting horizontal spreading into it', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.solid!.markRect(25, 21, 36, 22); // solid floor forces horizontal spread
    sys.liquidMask.markRect(29, 20, 30, 21, 2); // drain to the left
    sys.liquidMask.markRect(31, 20, 32, 21, 1); // seal to the right (so the spread direction is deterministic)
    sys.place(30, 20, MATERIAL_WATER);
    sys.step();
    assert.equal(sys.particleCount, 0, 'horizontal entry into a drain cell removes the particle');
  });

  test('13. drain does not remove sand or sandstone', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(29, 21, 31, 22, 2);
    sys.place(30, 20, MATERIAL_SAND);
    sys.step();
    assert.equal(sys.particleCount, 1, 'sand must fall normally into the "drain" cell — drain only affects liquid');
    assert.equal(sys.getMaterialAt(30, 21), MATERIAL_SAND);
  });

  test('13b. drain does not remove sandstone (static, never moves, unaffected either way)', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(29, 20, 31, 21, 2);
    sys.place(30, 20, MATERIAL_SANDSTONE);
    sys.step();
    assert.equal(sys.particleCount, 1);
    assert.equal(sys.getMaterialAt(30, 20), MATERIAL_SANDSTONE);
  });

  test('14. drained particles leave no occupancy or active-set remnants', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(29, 21, 31, 22, 2);
    sys.place(30, 20, MATERIAL_WATER);
    assert.equal(sys.activeCount, 1);
    sys.step();
    assert.equal(sys.occupiedCount, 0);
    assert.equal(sys.particleCount, 0);
    assert.equal(sys.activeCount, 0);
    assert.equal(sys.getParticleAtCell(30, 20), undefined);
  });

  test('15. a liquid particle is drained at most once (never double-processed)', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(29, 21, 31, 22, 2);
    sys.place(30, 20, MATERIAL_WATER);
    assert.doesNotThrow(() => { sys.step(); sys.step(); sys.step(); });
    assert.equal(sys.particleCount, 0);
  });

  test('16. a solid + drain block never drains anything — the particle can never reach the cell in the first place', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    // Solid+drain across the whole row so the particle truly cannot reach ANY
    // destination this step (down, both diagonals) — isolates "does solid+drain
    // ever drain" from "did it merely move elsewhere". Horizontal spread at its
    // own row is still open, so only assert it was never REMOVED (drained).
    sys.solid!.markRect(29, 21, 32, 22);
    sys.liquidMask.markRect(29, 21, 32, 22, 2);
    sys.place(30, 20, MATERIAL_WATER);
    sys.step();
    assert.equal(sys.particleCount, 1, 'solid blocks entry before drain can ever trigger — particle remains');
  });
});

// ── 17. Room-load initial drain-overlap policy ──────────────────────────────

describe('Phase 2G: initial authored-liquid/drain overlap is resolved at room-init time', () => {
  test('17. authored water sitting on a drain footprint is removed at room load, before the first simulation step', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('drain-init', liquidProps('drain'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:drain-init', tileWidth: 1, tileHeight: 1 }]);
    const roomDef: RoomDef = {
      ...editorRoomDataToRoomDef(room),
      pixelMaterials: [{ xPixel: 5 * BLOCK_SIZE_MEDIUM, yPixel: 5 * BLOCK_SIZE_MEDIUM, material: MATERIAL_WATER }],
    };
    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    loadRoomPixelMaterials(world, roomDef);
    assert.equal(world.pixelMaterialSystem.particleCount, 0, 'the overlapping water must already be gone right after load, before any step()');
    clearCustomBlockSpriteCache();
  });
});

// ── 18, 19. 2x2 footprint coverage ───────────────────────────────────────────

describe('Phase 2G: 2x2 seal/drain footprint coverage', () => {
  test('18. a 2x2 seal placement covers its full footprint', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(10, 10, 12, 12, 1);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        assert.equal(sys.liquidMask.tierAt(10 + dx, 10 + dy), 1, `cell (${dx},${dy}) of the 2x2 footprint must be sealed`);
      }
    }
  });

  test('19. a 2x2 drain placement covers its full footprint', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(10, 10, 12, 12, 2);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        assert.equal(sys.liquidMask.tierAt(10 + dx, 10 + dy), 2, `cell (${dx},${dy}) of the 2x2 footprint must drain`);
      }
    }
  });

  test('20. adjacent seal/drain placements remain independent', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(10, 10, 11, 11, 1); // seal at (10,10)
    sys.liquidMask.markRect(11, 10, 12, 11, 2); // drain at (11,10), adjacent
    assert.equal(sys.liquidMask.tierAt(10, 10), 1);
    assert.equal(sys.liquidMask.tierAt(11, 10), 2);
    sys.liquidMask.clearRect(10, 10, 11, 11);
    assert.equal(sys.liquidMask.tierAt(10, 10), 0, 'clearing one placement');
    assert.equal(sys.liquidMask.tierAt(11, 10), 2, 'must not disturb the adjacent placement');
  });
});

// ── 21. Real room-load wiring: one entry per placement ──────────────────────

describe('Phase 2G: room builder — liquidInteractionBlocks is one entry per placement', () => {
  test('21a. a 1x1 seal placement registers exactly one liquidInteractionBlocks entry', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('liquid-1x1', liquidProps('seal'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:liquid-1x1', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.liquidInteractionBlocks?.length, 1);
    assert.deepEqual(roomDef.liquidInteractionBlocks![0], { xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1, tier: 'seal' });
    clearCustomBlockSpriteCache();
  });

  test('21b. a 2x2 block placement registers exactly ONE liquidInteractionBlocks entry, not four', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('liquid-2x2', liquidProps('drain'), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:liquid-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.liquidInteractionBlocks?.length, 1);
    assert.deepEqual(roomDef.liquidInteractionBlocks![0], { xBlock: 10, yBlock: 10, wBlock: 2, hBlock: 2, tier: 'drain' });
    clearCustomBlockSpriteCache();
  });

  test('21c. a none placement registers no liquidInteractionBlocks entry at all', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('liquid-none-reg', liquidProps('none'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:liquid-none-reg', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.liquidInteractionBlocks, undefined);
    clearCustomBlockSpriteCache();
  });

  test('21d. loadRoomPixelMaterials builds a non-empty liquidMask from liquidInteractionBlocks', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('liquid-load', liquidProps('drain'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:liquid-load', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    loadRoomPixelMaterials(world, roomDef);
    const mask = world.pixelMaterialSystem.liquidMask;
    assert.ok(mask !== null);
    assert.equal(mask!.isEmpty, false);
    assert.equal(mask!.tierAt(5 * BLOCK_SIZE_MEDIUM, 5 * BLOCK_SIZE_MEDIUM), 2);
    clearCustomBlockSpriteCache();
  });

  test('21e. a non-solid placement (no wall generated at all) still registers liquidInteractionBlocks', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('liquid-nonsolid', liquidProps('seal', 'nonSolid'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:liquid-nonsolid', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.liquidInteractionBlocks?.length, 1, 'liquid interaction is independent of generateWall/collision');
    assert.equal(roomDef.liquidInteractionBlocks![0].tier, 'seal');
    clearCustomBlockSpriteCache();
  });

  test('21f. a room with no liquid-modifying custom blocks builds an empty liquidMask (fast path applies)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('liquid-none-load', liquidProps('none'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:liquid-none-load', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    loadRoomPixelMaterials(world, roomDef);
    assert.equal(world.pixelMaterialSystem.liquidMask?.isEmpty, true);
    clearCustomBlockSpriteCache();
  });
});

// ── 22. Fragile invalidation via the real destruction pathway ──────────────

describe('Phase 2G: fragile seal/drain mask invalidation on destruction', () => {
  test('22a. an unbroken fragile 1x1 seal block occludes liquid; breaking it clears the mask immediately', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('fragile-seal', liquidProps('seal', 'solid', { breakability: 'fragile' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:fragile-seal', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5, 400); // plenty of momentum

    const sys = world.pixelMaterialSystem;
    const bx = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    assert.equal(sys.liquidMask?.tierAt(bx, by), 1, 'seal must occlude before destruction');

    applyHazards(world);
    assert.equal(world.isBreakableBlockActiveFlag[0], 0, 'the fragile block must actually break');
    assert.equal(sys.liquidMask?.tierAt(bx, by), 0, 'mask must be cleared immediately after destruction');
    clearCustomBlockSpriteCache();
  });

  test('22b (24). fragile 1x1 destruction removes drain behavior', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('fragile-drain', liquidProps('drain', 'solid', { breakability: 'fragile' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:fragile-drain', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5, 400);
    const sys = world.pixelMaterialSystem;
    const bx = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    assert.equal(sys.liquidMask?.tierAt(bx, by), 2);
    applyHazards(world);
    assert.equal(world.isBreakableBlockActiveFlag[0], 0);
    assert.equal(sys.liquidMask?.tierAt(bx, by), 0);
    clearCustomBlockSpriteCache();
  });

  test('25. grouped fragile 2x2 destruction removes the full liquid footprint atomically', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('fragile-liquid-2x2', liquidProps('seal', 'solid', { breakability: 'fragile', breakResistance: 'weak' }), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:fragile-liquid-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 10, 10, 200); // breaks weak(150)

    const sys = world.pixelMaterialSystem;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const cx = (10 + dx + 0.5) * BLOCK_SIZE_MEDIUM;
        const cy = (10 + dy + 0.5) * BLOCK_SIZE_MEDIUM;
        assert.equal(sys.liquidMask?.tierAt(cx, cy), 1, `cell (${dx},${dy}) must seal before destruction`);
      }
    }

    applyHazards(world);
    for (let i = 0; i < 4; i++) assert.equal(world.isBreakableBlockActiveFlag[i], 0, 'all 4 cells must break atomically');
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const cx = (10 + dx + 0.5) * BLOCK_SIZE_MEDIUM;
        const cy = (10 + dy + 0.5) * BLOCK_SIZE_MEDIUM;
        assert.equal(sys.liquidMask?.tierAt(cx, cy), 0, `cell (${dx},${dy}) must no longer seal after the group breaks`);
      }
    }
    clearCustomBlockSpriteCache();
  });

  test('22 (adjacent placements remain independent under destruction): breaking one fragile seal never clears a neighboring placement', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('fragile-liq-adj', liquidProps('seal', 'solid', { breakability: 'fragile', breakResistance: 'weak' }));
    registerTestBlock('indestruct-liq-adj', liquidProps('seal', 'solid', { breakability: 'indestructible' }));
    const room = makeEditorRoomData([
      { xBlock: 0, yBlock: 0, blockId: 'custom:fragile-liq-adj', tileWidth: 1, tileHeight: 1 },
      { xBlock: 2, yBlock: 0, blockId: 'custom:indestruct-liq-adj', tileWidth: 1, tileHeight: 1 },
    ]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 0, 0, 200); // breaks weak(150)
    const sys = world.pixelMaterialSystem;

    const otherX = (2 + 0.5) * BLOCK_SIZE_MEDIUM;
    const otherY = (0 + 0.5) * BLOCK_SIZE_MEDIUM;
    applyHazards(world);
    assert.equal(world.isBreakableBlockActiveFlag[0], 0, 'the fragile placement must break');
    assert.equal(sys.liquidMask?.tierAt(otherX, otherY), 1, 'the neighboring indestructible seal must be untouched');
    clearCustomBlockSpriteCache();
  });

  test('26. an indestructible liquid modifier never enters the breakable pathway and can never be cleared', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('indestruct-liquid', liquidProps('drain', 'solid', { breakability: 'indestructible' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:indestruct-liquid', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.length ?? 0, 0);
    const world = worldWithPlayerAt(roomDef, 5, 5, 500);
    applyHazards(world);
    const bx = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    assert.equal(world.pixelMaterialSystem.liquidMask?.tierAt(bx, by), 2);
    clearCustomBlockSpriteCache();
  });
});

// ── Overlap rejection (room-build validation) ───────────────────────────────

describe('Phase 2G: overlapping liquid-modifier placements are rejected at room-build time', () => {
  test('an overlapping second placement is not registered for liquid interaction (first wins)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('overlap-a', liquidProps('seal', 'nonSolid'));
    registerTestBlock('overlap-b', liquidProps('drain', 'nonSolid'), 2, 2);
    // overlap-a at (5,5) 1x1; overlap-b at (5,5) 2x2 — same top-left cell, deliberately malformed.
    const room = makeEditorRoomData([
      { xBlock: 5, yBlock: 5, blockId: 'custom:overlap-a', tileWidth: 1, tileHeight: 1 },
      { xBlock: 5, yBlock: 5, blockId: 'custom:overlap-b', tileWidth: 2, tileHeight: 2 },
    ]);
    const roomDef = editorRoomDataToRoomDef(room);
    // Only the first (non-overlapping-at-registration-time) placement is registered.
    assert.equal(roomDef.liquidInteractionBlocks?.length, 1);
    assert.equal(roomDef.liquidInteractionBlocks![0].tier, 'seal');
    clearCustomBlockSpriteCache();
  });
});

// ── 27-29. Unrelated systems remain unchanged ───────────────────────────────

describe('Phase 2G: wind, sandstone, contact-damage, and break-resistance are unaffected', () => {
  test('27. wind behavior remains unchanged when a block also seals/drains liquid', () => {
    const sys = makeSystem();
    sys.windMask = null;
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(29, 21, 31, 22, 1);
    sys.place(30, 20, MATERIAL_SAND);
    sys.applyWindForce({ centerXPx: 20, centerYPx: 20, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });
    assert.ok(sys.getParticleAtCell(30, 20)!.windVelX > 0, 'wind still applies normally — liquidMask never interferes with wind');
  });

  test('28. sandstone impact/erosion behavior remains unchanged alongside a liquid mask', () => {
    const sys = makeSystem();
    sys.liquidMask = new CustomBlockLiquidMask(60, 60);
    sys.liquidMask.markRect(0, 0, 1, 1, 2); // unrelated drain elsewhere
    sys.place(10, 10, MATERIAL_SANDSTONE);
    sys.applyPlayerImpactFracture(5, 10, 3.5, 10, 400, 0, 0);
    assert.equal(sys.getMaterialAt(10, 10), MATERIAL_SAND, 'impact fracture must still work exactly as before Phase 2G');
  });

  test('29a. contact damage and break resistance remain unchanged on a fragile, damaging, sealing block', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('seal-dmg', liquidProps('seal', 'solid', { breakability: 'fragile', contactDamage: 'high', breakResistance: 'reinforced' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:seal-dmg', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5, 200); // below reinforced(350) — does not break
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 2, 'contact damage is unaffected by liquid interaction');
    assert.equal(world.isBreakableBlockActiveFlag[0], 1, 'block must not break below its reinforced threshold');
    const bx = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    assert.equal(world.pixelMaterialSystem.liquidMask?.tierAt(bx, by), 1, 'still seals since it never broke');
    clearCustomBlockSpriteCache();
  });

  test('29b. a metal sealing block still emits exactly one material-specific break event when destroyed', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('seal-metal', liquidProps('seal', 'solid', { breakability: 'fragile', materialResponse: 'metal', breakResistance: 'weak' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:seal-metal', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5, 200); // breaks weak(150)
    applyHazards(world);
    assert.equal(world.breakEventCount, 1);
    assert.equal(world.breakEventMaterial[0], 2, 'metal index (2)');
    clearCustomBlockSpriteCache();
  });

  test('a fragile, reinforced, damaging metal drain uses each prior system independently', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('kitchen-sink', liquidProps('drain', 'solid', {
      breakability: 'fragile', contactDamage: 'high', breakResistance: 'reinforced', materialResponse: 'metal', windResponse: 'block',
    }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:kitchen-sink', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.[0]?.liquidInteraction, 'drain');
    assert.equal(roomDef.breakableBlocks?.[0]?.windResponse, 'block');
    assert.equal(roomDef.breakableBlocks?.[0]?.breakResistance, 'reinforced');
    const world = worldWithPlayerAt(roomDef, 5, 5, 200); // below reinforced(350)
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 2, 'contact damage independent of drain');
    assert.equal(world.isBreakableBlockActiveFlag[0], 1, 'still standing below reinforced threshold');
    clearCustomBlockSpriteCache();
  });
});

// ── 30-32. Editor dirty-tracking / rename / duplicate data-model behavior ───

describe('Phase 2G: editor dirty tracking, undo/redo, rename, duplicate', () => {
  test('30. changing only liquidInteraction is detected as dirty, and undo restores it', () => {
    const original: CustomBlockProperties = liquidProps('none');
    const undoStack: CustomBlockProperties[] = [original];
    let properties: CustomBlockProperties = { ...original, liquidInteraction: 'drain' };

    function propertiesEqual(a: CustomBlockProperties, b: CustomBlockProperties): boolean {
      return a.collision === b.collision && a.friction === b.friction && a.breakability === b.breakability &&
        a.materialResponse === b.materialResponse && a.contactDamage === b.contactDamage &&
        a.breakResistance === b.breakResistance && a.windResponse === b.windResponse &&
        a.liquidInteraction === b.liquidInteraction;
    }

    assert.equal(propertiesEqual(properties, original), false, 'liquidInteraction-only change must be dirty');

    const restored = undoStack.pop()!;
    properties = restored;
    assert.equal(properties.liquidInteraction, 'none');
  });

  test('31. rename preserves liquidInteraction (serializeCustomBlock -> parseCustomBlockSource)', () => {
    const props = liquidProps('seal');
    const before = parseCustomBlockSource(serializeCustomBlock('stable-2g', 'Old Name', 1, 1, makeBlankPixelData(1, 1), props));
    const afterRename = parseCustomBlockSource(serializeCustomBlock('stable-2g', 'New Name', 1, 1, makeBlankPixelData(1, 1), props));
    assert.equal(before.ok, true);
    assert.equal(afterRename.ok, true);
    if (before.ok && afterRename.ok) {
      assert.equal(before.def.id, afterRename.def.id);
      assert.equal(afterRename.def.properties.liquidInteraction, 'seal');
      assert.deepEqual(before.def.properties, afterRename.def.properties);
    }
  });

  test('32. duplicate copies liquidInteraction with a new stable ID', () => {
    const props = liquidProps('drain');
    const original = parseCustomBlockSource(serializeCustomBlock('orig-2g', 'Original', 1, 1, makeBlankPixelData(1, 1), props));
    const dup = parseCustomBlockSource(serializeCustomBlock('orig-2g-copy', 'Original Copy', 1, 1, makeBlankPixelData(1, 1), props));
    assert.equal(original.ok, true);
    assert.equal(dup.ok, true);
    if (original.ok && dup.ok) {
      assert.equal(dup.def.properties.liquidInteraction, 'drain');
      assert.deepEqual(dup.def.properties, original.def.properties);
      assert.notEqual(dup.def.id, original.def.id);
    }
  });
});

// ── 33. Property-only edits do not rebuild the sprite canvas ───────────────

describe('Phase 2G: sprite-cache properties-only update', () => {
  test('33. updateCustomBlockProperties changes liquidInteraction without rebuilding the cached canvas', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('cache-2g', liquidProps('none'));
    const before = getCustomBlockSprite('cache-2g');
    assert.ok(before !== null);
    const canvasBefore = before!.canvas;

    const ok = updateCustomBlockProperties('cache-2g', liquidProps('drain'));
    assert.equal(ok, true);

    const after = getCustomBlockSprite('cache-2g');
    assert.ok(after !== null);
    assert.equal(after!.canvas, canvasBefore, 'canvas object must be the SAME instance — no rebuild');
    assert.equal(after!.properties.liquidInteraction, 'drain');
    clearCustomBlockSpriteCache();
  });
});

// ── 34. Export and relocated reopening preserve the preset ──────────────────

describe('Phase 2G: export/relocate round trip', () => {
  test('34. export and relocated reload preserve the liquidInteraction preset exactly', () => {
    const props = liquidProps('seal');
    const pixelData = makeBlankPixelData(2, 2);
    const sourceDef = serializeCustomBlock('relocate-2g', 'Relocate 2G', 2, 2, pixelData, props);
    assert.equal(sourceDef.schemaVersion, 2);
    const reloaded = JSON.parse(JSON.stringify(sourceDef));
    const parsed = parseCustomBlockSource(reloaded);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.def.properties.liquidInteraction, 'seal');
  });
});

// ── 35. Campaign switching clears liquid-mask state ─────────────────────────

describe('Phase 2G: campaign switch isolation', () => {
  test('35a. campaign switch (sprite cache clear) does not leak stale liquidInteraction', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('leak-check-2g', liquidProps('drain'));
    assert.equal(getCustomBlockProperties('leak-check-2g').liquidInteraction, 'drain');
    clearCustomBlockSpriteCache(); // simulate switching campaigns
    registerTestBlock('leak-check-2g', liquidProps('none'));
    assert.equal(getCustomBlockProperties('leak-check-2g').liquidInteraction, 'none');
    clearCustomBlockSpriteCache();
  });

  test('35b. a freshly loaded room after a campaign switch gets its own liquidMask instance (no shared state)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('liquid-switch', liquidProps('drain'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:liquid-switch', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const worldA = createWorldState(16);
    loadRoomHazards(worldA, roomDef);
    loadRoomPixelMaterials(worldA, roomDef);

    const worldB = createWorldState(16);
    const emptyRoom = { walls: [] } as unknown as RoomDef;
    loadRoomHazards(worldB, emptyRoom);
    loadRoomPixelMaterials(worldB, emptyRoom);

    assert.equal(worldA.pixelMaterialSystem.liquidMask?.isEmpty, false);
    assert.equal(worldB.pixelMaterialSystem.liquidMask?.isEmpty, true, 'a room with no liquid blocks must not see the other world\'s mask state');
    clearCustomBlockSpriteCache();
  });
});

// ── 36-38. Backward compatibility ───────────────────────────────────────────

describe('Phase 2G: backward compatibility', () => {
  test('36. a hand-authored breakableBlocks entry with no liquidInteraction field never registers as a seal/drain', () => {
    const world = createWorldState(16);
    const room = {
      breakableBlocks: [{ xBlock: 4, yBlock: 4 }], // no liquidInteraction — pre-Phase-2G shape
    } as unknown as RoomDef;
    assert.doesNotThrow(() => loadRoomHazards(world, room));
    assert.equal(world.breakableBlockLiquidTier[0], 0);
  });

  test('37a. built-in walls (no custom blocks at all) preserve their existing behavior', () => {
    const world = createWorldState(16);
    const room = { walls: [] } as unknown as RoomDef;
    loadRoomHazards(world, room);
    loadRoomPixelMaterials(world, room);
    assert.equal(world.pixelMaterialSystem.liquidMask?.isEmpty, true);
    world.pixelMaterialSystem.place(10, 10, MATERIAL_WATER);
    world.pixelMaterialSystem.step();
    assert.equal(world.pixelMaterialSystem.getMaterialAt(10, 11), MATERIAL_WATER, 'water falls exactly as before Phase 2G');
  });

  test('37b. water-zone-style RoomDef shape (no pixel materials) loads without error and is unaffected', () => {
    const world = createWorldState(16);
    const room = { walls: [], waterZones: [{ xBlock: 1, yBlock: 1, wBlock: 2, hBlock: 2 }] } as unknown as RoomDef;
    assert.doesNotThrow(() => { loadRoomHazards(world, room); loadRoomPixelMaterials(world, room); });
    assert.equal(world.pixelMaterialSystem.liquidMask?.isEmpty, true);
  });

  test('38. all existing Phase 2A-2F property tests keep passing (spot check: full default bundle includes liquidInteraction: none)', () => {
    const result = validateAndResolveCustomBlockProperties(undefined, 1, 1);
    assert.equal(result.properties.liquidInteraction, 'none');
    assert.equal(result.properties.windResponse, 'passThrough');
    assert.equal(result.properties.collision, 'solid');
    assert.equal(result.properties.breakability, 'indestructible');
  });
});

// ── Performance: no modifier-specific processing beyond the fast-path check ─

describe('Phase 2G: performance — empty mask adds no work beyond the isEmpty check', () => {
  test('a large room with an empty liquidMask steps many liquid particles quickly (no per-particle mask scan cost)', () => {
    const sys = makeSystem(400, 260);
    sys.liquidMask = new CustomBlockLiquidMask(400, 260);
    for (let i = 0; i < 200; i++) {
      const x = 10 + (i % 180);
      const y = 10 + Math.floor(i / 180) * 2;
      sys.place(x, y, MATERIAL_WATER);
    }
    const start = performance.now();
    for (let i = 0; i < 50; i++) sys.step();
    const elapsedMs = performance.now() - start;
    assert.ok(elapsedMs < 500, `200 liquid particles over 50 steps with an empty mask should be fast, took ${elapsedMs}ms`);
  });

  test('markRect on a large mask does not allocate per cell beyond the typed array itself (constant-time tierAt)', () => {
    const mask = new CustomBlockLiquidMask(480, 270);
    mask.markRect(100, 100, 108, 108, 1);
    const start = performance.now();
    let acc = 0;
    for (let i = 0; i < 100000; i++) acc += mask.tierAt(100 + (i % 8), 100 + (i % 8));
    const elapsedMs = performance.now() - start;
    assert.ok(acc >= 0);
    assert.ok(elapsedMs < 200, `100000 tierAt lookups should be near-instant, took ${elapsedMs}ms`);
  });
});
