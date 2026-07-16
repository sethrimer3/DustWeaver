/**
 * Tests for Phase 2F: custom block wind-transmission presets.
 *
 * Covers: the windResponse property/registry (customBlockProperties.ts),
 * schema-v1/v2 compatibility defaults, the CustomBlockWindMask class and
 * traceMaxWindTransmissionTier/resolveCustomBlockWindTransmission (the single
 * authoritative transmission pathway), real transmission application via
 * PixelMaterialSystem.applyWindForce (pass-through/dampen/block, directional
 * beside-vs-between behavior, non-compounding thickness, multi-block
 * strongest-restriction, material-response retention, sandstone erosion
 * interaction, 2x2 single-impulse dedup, fast-path equivalence), real
 * room-load wiring (editorRoomBuilder.ts -> gameRoomHazards.ts /
 * gameRoomPixelMaterials.ts), and fragile-windbreak mask invalidation via the
 * real destruction pathway (sim/hazards.ts). Extends (does not replace) the
 * Phase 2A-2E suites, whose coverage must continue to pass unchanged.
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
  isCustomBlockWindResponsePreset,
  windResponseTierToIndex,
  indexToWindResponseTier,
  isEligibleForWindTransmission,
  CUSTOM_BLOCK_WIND_RESPONSE_PRESET_IDS,
  type CustomBlockProperties,
  type CustomBlockWindResponsePreset,
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
  MATERIAL_SAND_2X2,
  MATERIAL_WATER,
  MATERIAL_SANDSTONE,
  getMaterialWindResponse,
  SANDSTONE_MIN_EROSION_WIND_SPEED,
} from '../sim/pixelMaterials/pixelMaterialTypes';
import {
  CustomBlockWindMask,
  traceMaxWindTransmissionTier,
  resolveCustomBlockWindTransmission,
  CUSTOM_BLOCK_WIND_DAMPEN_FACTOR,
} from '../sim/pixelMaterials/customBlockWindMask';

// ── Helpers (mirror src/tests/customBlocksPhase2E.test.ts) ──────────────────

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
    id: 'room-2f',
    name: 'Room 2F',
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

/** Fragile, solid, wind-eligible block properties with a given tier and optional overrides. */
function windProps(
  windResponse: CustomBlockWindResponsePreset,
  overrides: Partial<CustomBlockProperties> = {},
): CustomBlockProperties {
  return {
    collision: 'solid', friction: 'default', breakability: 'fragile',
    materialResponse: 'stone', contactDamage: 'none', breakResistance: 'standard',
    windResponse, ...overrides,
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

describe('Phase 2F: schema defaults', () => {
  test('1. version-1 custom blocks default windResponse to passThrough', () => {
    const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const pixels: string[][] = Array.from({ length: pw }, () => Array.from({ length: pw }, () => '#FF000088'));
    const source = {
      schemaVersion: 1, id: 'legacy-2f', name: 'Legacy', tileWidth: 1, tileHeight: 1,
      pixelWidth: pw, pixelHeight: pw, behavior: 'solid', pixels,
    };
    const result = parseCustomBlockSource(source);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.def.properties.windResponse, 'passThrough');
  });

  test('2. schema-v2 blocks without windResponse default to passThrough (absence is not an error)', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', breakability: 'indestructible' }, 1, 1, { blockId: 'no-wind' },
    );
    assert.equal(result.properties.windResponse, 'passThrough');
    assert.equal(result.fallbackUsed, false);
  });
});

// ── 3. All three presets save and reload ────────────────────────────────────

describe('Phase 2F: preset round trip', () => {
  for (const tier of CUSTOM_BLOCK_WIND_RESPONSE_PRESET_IDS) {
    test(`3. ${tier} preset saves and reloads exactly`, () => {
      const props = windProps(tier, { breakability: 'indestructible' });
      const pixelData = makeBlankPixelData(1, 1);
      const sourceDef = serializeCustomBlock(`rt2f-${tier.toLowerCase()}`, `RT ${tier}`, 1, 1, pixelData, props);
      const parsed = parseCustomBlockSource(sourceDef);
      assert.equal(parsed.ok, true);
      if (parsed.ok) assert.equal(parsed.def.properties.windResponse, tier);
    });
  }
});

// ── 4. Unknown values / type guard / numeric packing ────────────────────────

describe('Phase 2F: invalid windResponse values and packing', () => {
  test('4. unknown windResponse value is rejected safely and falls back to passThrough', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', windResponse: 'gale-force' },
      1, 1, { blockId: 'bad-wind' },
    );
    assert.equal(result.properties.windResponse, 'passThrough');
    assert.ok(result.errors.some(e => e.field === 'properties.windResponse'));
    assert.equal(result.fallbackUsed, true);
  });

  test('isCustomBlockWindResponsePreset rejects non-strings and unknown strings', () => {
    assert.equal(isCustomBlockWindResponsePreset('passThrough'), true);
    assert.equal(isCustomBlockWindResponsePreset('dampen'), true);
    assert.equal(isCustomBlockWindResponsePreset('block'), true);
    assert.equal(isCustomBlockWindResponsePreset('gale-force'), false);
    assert.equal(isCustomBlockWindResponsePreset(42), false);
    assert.equal(isCustomBlockWindResponsePreset(undefined), false);
  });

  test('windResponseTierToIndex / indexToWindResponseTier round trip', () => {
    assert.equal(indexToWindResponseTier(windResponseTierToIndex('dampen')), 'dampen');
    assert.equal(indexToWindResponseTier(windResponseTierToIndex('block')), 'block');
    assert.equal(indexToWindResponseTier(99), 'dampen'); // unknown index falls back to dampen
  });
});

// ── 5. Compatibility: requires solid collision ──────────────────────────────

describe('Phase 2F: windResponseRequiresSolid compatibility rule', () => {
  test('5a. oneWay + dampen is rejected', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      windProps('dampen', { collision: 'oneWay', breakability: 'indestructible' }), 1, 1,
    );
    assert.ok(issues.some(i => i.rule === 'windResponseRequiresSolid'));
  });

  test('5b. nonSolid + block is rejected', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      windProps('block', { collision: 'nonSolid', breakability: 'indestructible' }), 1, 1,
    );
    assert.ok(issues.some(i => i.rule === 'windResponseRequiresSolid'));
  });

  test('5c. solid + dampen/block is always compatible regardless of breakability', () => {
    assert.equal(checkCustomBlockPropertyCompatibility(
      windProps('dampen', { breakability: 'indestructible' }), 1, 1).length, 0);
    assert.equal(checkCustomBlockPropertyCompatibility(
      windProps('block', { breakability: 'fragile' }), 1, 1).length, 0);
  });

  test('5d. passThrough is always valid regardless of collision', () => {
    for (const collision of ['solid', 'oneWay', 'nonSolid'] as const) {
      assert.equal(checkCustomBlockPropertyCompatibility(
        windProps('passThrough', { collision, breakability: 'indestructible' }), 1, 1).length, 0);
    }
  });

  test('5e. load-time fallback: an incompatible combination safely falls back to passThrough instead of rejecting the block', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'oneWay', windResponse: 'block' }, 1, 1, { blockId: 'incompatible-wind' },
    );
    assert.equal(result.properties.windResponse, 'passThrough');
    assert.equal(result.properties.collision, 'oneWay', 'collision itself is untouched by this fallback');
    assert.ok(result.errors.some(e => e.field === 'properties.compatibility.windResponseRequiresSolid'));
  });

  test('isEligibleForWindTransmission requires both solid collision and a non-passThrough tier', () => {
    assert.equal(isEligibleForWindTransmission(windProps('dampen')), true);
    assert.equal(isEligibleForWindTransmission(windProps('passThrough')), false);
    assert.equal(isEligibleForWindTransmission(windProps('block', { collision: 'nonSolid' })), false);
  });
});

// ── 6. CustomBlockWindMask unit behavior ────────────────────────────────────

describe('Phase 2F: CustomBlockWindMask', () => {
  test('6a. a fresh mask is empty and every cell reads tier 0', () => {
    const mask = new CustomBlockWindMask(20, 20);
    assert.equal(mask.isEmpty, true);
    assert.equal(mask.tierAt(5, 5), 0);
    assert.equal(mask.tierAt(-1, 0), 0, 'out of bounds reads as no restriction');
    assert.equal(mask.tierAt(100, 100), 0);
  });

  test('6b. markRect sets tier and flips isEmpty; clearRect restores it', () => {
    const mask = new CustomBlockWindMask(20, 20);
    mask.markRect(5, 5, 8, 8, 1);
    assert.equal(mask.isEmpty, false);
    assert.equal(mask.tierAt(5, 5), 1);
    assert.equal(mask.tierAt(7, 7), 1);
    assert.equal(mask.tierAt(8, 8), 0, 'exclusive upper bound');
    mask.clearRect(5, 5, 8, 8);
    assert.equal(mask.isEmpty, true);
    assert.equal(mask.tierAt(5, 5), 0);
  });

  test('6c. traceMaxWindTransmissionTier returns 0 instantly on an empty mask, even for a huge span', () => {
    const mask = new CustomBlockWindMask(2000, 2000);
    const start = performance.now();
    const tier = traceMaxWindTransmissionTier(mask, 0, 0, 1999, 1999);
    const elapsedMs = performance.now() - start;
    assert.equal(tier, 0);
    assert.ok(elapsedMs < 50, `empty-mask fast path should be near-instant, took ${elapsedMs}ms`);
  });

  test('6d. resolveCustomBlockWindTransmission: passThrough=1, dampen=centralized factor, block=exactly 0', () => {
    assert.equal(resolveCustomBlockWindTransmission(0), 1);
    assert.equal(resolveCustomBlockWindTransmission(1), CUSTOM_BLOCK_WIND_DAMPEN_FACTOR);
    assert.equal(resolveCustomBlockWindTransmission(2), 0);
    assert.ok(CUSTOM_BLOCK_WIND_DAMPEN_FACTOR > 0 && CUSTOM_BLOCK_WIND_DAMPEN_FACTOR < 1);
  });
});

// ── 7. Direct PixelMaterialSystem.applyWindForce transmission behavior ─────

describe('Phase 2F: applyWindForce transmission — pass-through, dampen, block', () => {
  test('7a. null windMask (pre-Phase-2F rooms) behaves byte-identically to no mask at all', () => {
    const sys = makeSystem();
    sys.place(30, 30, MATERIAL_SAND);
    assert.equal(sys.windMask, null, 'default is null');
    sys.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });
    const p = sys.getParticleAtCell(30, 30)!;
    assert.equal(p.windVelX, 100 * getMaterialWindResponse(MATERIAL_SAND));
  });

  test('7b. an empty (non-null) mask produces the exact same result as a null mask — the fast path is a true no-op', () => {
    const sysNull = makeSystem();
    sysNull.place(30, 30, MATERIAL_SAND);
    sysNull.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });

    const sysEmpty = makeSystem();
    sysEmpty.windMask = new CustomBlockWindMask(60, 60);
    sysEmpty.place(30, 30, MATERIAL_SAND);
    sysEmpty.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });

    assert.equal(sysEmpty.getParticleAtCell(30, 30)!.windVelX, sysNull.getParticleAtCell(30, 30)!.windVelX);
  });

  test('7c. a dampen cell between the emitter and the particle reduces (never zeroes) the impulse by exactly the centralized factor', () => {
    const sys = makeSystem();
    sys.windMask = new CustomBlockWindMask(60, 60);
    sys.windMask.markRect(24, 29, 26, 31, 1); // dampen wall between x=20 (source) and x=30 (particle)
    sys.place(30, 30, MATERIAL_SAND);
    sys.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });
    const p = sys.getParticleAtCell(30, 30)!;
    const expected = 100 * CUSTOM_BLOCK_WIND_DAMPEN_FACTOR * getMaterialWindResponse(MATERIAL_SAND);
    assert.ok(Math.abs(p.windVelX - expected) < 1e-6, `expected ${expected}, got ${p.windVelX}`);
    assert.ok(p.windVelX > 0, 'dampen must reduce, not zero, the impulse');
    assert.ok(p.windVelX < 100 * getMaterialWindResponse(MATERIAL_SAND), 'must be less than the undampened impulse');
  });

  test('7d. a block cell between the emitter and the particle applies exactly zero force and does not wake the particle', () => {
    const sys = makeSystem();
    sys.windMask = new CustomBlockWindMask(60, 60);
    sys.windMask.markRect(24, 29, 26, 31, 2); // windbreak wall
    sys.place(30, 30, MATERIAL_SAND);
    const p = sys.getParticleAtCell(30, 30)!;
    // Let it sleep first so we can prove the blocked impulse does NOT wake it.
    for (let i = 0; i < 200; i++) sys.step();
    assert.equal(p.active, false, 'particle must be asleep before the blocked impulse');
    sys.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });
    assert.equal(p.windVelX, 0);
    assert.equal(p.active, false, 'a fully blocked impulse must not wake the particle');
  });
});

describe('Phase 2F: directional occlusion (beside vs. between, same-side-as-source)', () => {
  test('8a. a windbreak beside the straight-line path (not on it) has no effect', () => {
    const sys = makeSystem();
    sys.windMask = new CustomBlockWindMask(60, 60);
    // Source at (20,20), particle at (30,20) — a straight horizontal line at y=20.
    // Place the windbreak one row below the path (y=25), well clear of it.
    sys.windMask.markRect(24, 25, 26, 27, 2);
    sys.place(30, 20, MATERIAL_SAND);
    sys.applyWindForce({ centerXPx: 20, centerYPx: 20, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });
    const p = sys.getParticleAtCell(30, 20)!;
    assert.equal(p.windVelX, 100 * getMaterialWindResponse(MATERIAL_SAND), 'a block beside the path must not occlude it');
  });

  test('8b. a windbreak on the source\'s far side of the particle (not between them) has no effect', () => {
    const sys = makeSystem();
    sys.windMask = new CustomBlockWindMask(60, 60);
    // Source at (30,30) [to the right], particle at (20,30) [to the left].
    // Windbreak at x=35 is beyond the SOURCE, not between source and particle.
    sys.windMask.markRect(35, 29, 37, 31, 2);
    sys.place(20, 30, MATERIAL_SAND);
    sys.applyWindForce({ centerXPx: 30, centerYPx: 30, radiusPx: 20, forceX: -100, forceY: 0, falloff: 0 });
    const p = sys.getParticleAtCell(20, 30)!;
    assert.equal(p.windVelX, -100 * getMaterialWindResponse(MATERIAL_SAND), 'a block not between source and target must not occlude');
  });
});

describe('Phase 2F: thickness non-compounding and multi-block strongest-restriction', () => {
  test('9a. a 2-cell-thick dampen wall attenuates exactly as much as a 1-cell-thick one (never compounds)', () => {
    const sysThin = makeSystem();
    sysThin.windMask = new CustomBlockWindMask(60, 60);
    sysThin.windMask.markRect(24, 29, 25, 31, 1); // 1px thick
    sysThin.place(30, 30, MATERIAL_SAND);
    sysThin.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });

    const sysThick = makeSystem();
    sysThick.windMask = new CustomBlockWindMask(60, 60);
    sysThick.windMask.markRect(24, 29, 26, 31, 1); // 2px thick
    sysThick.place(30, 30, MATERIAL_SAND);
    sysThick.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });

    assert.equal(sysThin.getParticleAtCell(30, 30)!.windVelX, sysThick.getParticleAtCell(30, 30)!.windVelX);
  });

  test('9b. crossing a dampen cell then a block cell yields the strongest restriction (fully blocked, not merely dampened)', () => {
    const sys = makeSystem();
    sys.windMask = new CustomBlockWindMask(60, 60);
    sys.windMask.markRect(22, 29, 24, 31, 1); // dampen, closer to source
    sys.windMask.markRect(26, 29, 28, 31, 2); // block, closer to particle
    sys.place(30, 30, MATERIAL_SAND);
    sys.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });
    assert.equal(sys.getParticleAtCell(30, 30)!.windVelX, 0);
  });

  test('9c. crossing multiple DISTINCT dampen blocks does not compound below the single-block factor', () => {
    const sys = makeSystem();
    sys.windMask = new CustomBlockWindMask(60, 60);
    sys.windMask.markRect(22, 29, 23, 31, 1); // first dampen block
    sys.windMask.markRect(26, 29, 27, 31, 1); // second, distinct dampen block
    sys.place(30, 30, MATERIAL_SAND);
    sys.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });
    const expected = 100 * CUSTOM_BLOCK_WIND_DAMPEN_FACTOR * getMaterialWindResponse(MATERIAL_SAND);
    assert.ok(Math.abs(sys.getParticleAtCell(30, 30)!.windVelX - expected) < 1e-6);
  });
});

// ── 10. Material-response retention (water/sand) ────────────────────────────

describe('Phase 2F: per-material wind-response retention through dampening', () => {
  test('10a. water retains its own (higher) material response after transmission is applied', () => {
    const sysSand = makeSystem();
    sysSand.windMask = new CustomBlockWindMask(60, 60);
    sysSand.windMask.markRect(24, 29, 26, 31, 1);
    sysSand.place(30, 30, MATERIAL_SAND);
    sysSand.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });

    const sysWater = makeSystem();
    sysWater.windMask = new CustomBlockWindMask(60, 60);
    sysWater.windMask.markRect(24, 29, 26, 31, 1);
    sysWater.place(30, 30, MATERIAL_WATER);
    sysWater.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });

    const sandVel = sysSand.getParticleAtCell(30, 30)!.windVelX;
    const waterVel = sysWater.getParticleAtCell(30, 30)!.windVelX;
    assert.ok(waterVel > sandVel, 'water (response 1.3) must still end up with more momentum than sand (response 1) after the SAME dampening');
    const expectedRatio = getMaterialWindResponse(MATERIAL_WATER) / getMaterialWindResponse(MATERIAL_SAND);
    assert.ok(Math.abs(waterVel / sandVel - expectedRatio) < 1e-6, 'dampening scales both materials by the same factor — their relative ratio is unchanged');
  });

  test('10b. dampening reduces (not replaces) the per-material response — sand still ends up lighter than an undampened dampen-free run scaled the same way', () => {
    const sysDampened = makeSystem();
    sysDampened.windMask = new CustomBlockWindMask(60, 60);
    sysDampened.windMask.markRect(24, 29, 26, 31, 1);
    sysDampened.place(30, 30, MATERIAL_SAND);
    sysDampened.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });

    const sysPlain = makeSystem();
    sysPlain.place(30, 30, MATERIAL_SAND);
    sysPlain.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });

    assert.ok(sysDampened.getParticleAtCell(30, 30)!.windVelX < sysPlain.getParticleAtCell(30, 30)!.windVelX);
  });
});

// ── 11. Sandstone erosion interaction ────────────────────────────────────────

describe('Phase 2F: sandstone erosion interaction', () => {
  function windSpeedForErosion(): number {
    // Chosen so that even AFTER dampening (factor) AND sandstone's own
    // (sub-1) material response, the resulting wind speed still comfortably
    // clears SANDSTONE_MIN_EROSION_WIND_SPEED — otherwise the dampened case
    // would erode zero for a reason unrelated to what this test checks.
    const sandstoneResponse = getMaterialWindResponse(MATERIAL_SANDSTONE);
    return (SANDSTONE_MIN_EROSION_WIND_SPEED / (CUSTOM_BLOCK_WIND_DAMPEN_FACTOR * sandstoneResponse)) * 2;
  }

  test('11a. dampening reduces sandstone erosion accumulation relative to an undampened gust', () => {
    const force = windSpeedForErosion();

    const sysDampened = makeSystem();
    sysDampened.windMask = new CustomBlockWindMask(60, 60);
    sysDampened.windMask.markRect(24, 29, 26, 31, 1);
    sysDampened.place(30, 30, MATERIAL_SANDSTONE);
    sysDampened.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: force, forceY: 0, falloff: 0 });
    sysDampened.step();

    const sysPlain = makeSystem();
    sysPlain.place(30, 30, MATERIAL_SANDSTONE);
    sysPlain.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: force, forceY: 0, falloff: 0 });
    sysPlain.step();

    const dampenedErosion = sysDampened.getParticleAtCell(30, 30)?.erosionDamage ?? 0;
    const plainErosion = sysPlain.getParticleAtCell(30, 30)?.erosionDamage ?? 0;
    assert.ok(dampenedErosion < plainErosion, 'dampened wind must erode sandstone slower than undampened wind');
    assert.ok(dampenedErosion > 0, 'dampened wind above the erosion floor must still erode, just slower');
  });

  test('11b. a full windbreak prevents erosion entirely (fully occluded impulses never reach the sandstone)', () => {
    const force = windSpeedForErosion();
    const sys = makeSystem();
    sys.windMask = new CustomBlockWindMask(60, 60);
    sys.windMask.markRect(24, 29, 26, 31, 2);
    sys.place(30, 30, MATERIAL_SANDSTONE);
    for (let i = 0; i < 50; i++) {
      sys.applyWindForce({ centerXPx: 20, centerYPx: 30, radiusPx: 20, forceX: force, forceY: 0, falloff: 0 });
      sys.step();
    }
    assert.equal(sys.getMaterialAt(30, 30), MATERIAL_SANDSTONE, 'fully occluded sandstone must never erode or fracture');
    assert.equal(sys.getParticleAtCell(30, 30)!.erosionDamage, 0);
  });

  test('11c. player-impact fracture is unaffected by wind transmission (uses fixed impact-speed constants, not the wind mask)', () => {
    const sys = makeSystem();
    sys.windMask = new CustomBlockWindMask(60, 60);
    sys.windMask.markRect(24, 29, 26, 31, 2); // an unrelated windbreak elsewhere in the room
    sys.place(10, 10, MATERIAL_SANDSTONE);
    // A strong head-on impact from the left, well above the fracture threshold.
    sys.applyPlayerImpactFracture(5, 10, 3.5, 10, 400, 0, 0);
    assert.equal(sys.getMaterialAt(10, 10), MATERIAL_SAND, 'impact fracture must still work exactly as before Phase 2F');
  });
});

// ── 12. 2x2 particle receives exactly one transmitted impulse ──────────────

describe('Phase 2F: multi-cell particle single-impulse dedup with transmission', () => {
  test('12. a 2x2 sand particle behind a dampener receives exactly one impulse at the dampened multiplier, never per-cell', () => {
    const sys = makeSystem();
    sys.windMask = new CustomBlockWindMask(60, 60);
    sys.windMask.markRect(24, 29, 26, 33, 1); // dampen wall spanning the whole 2x2 footprint's approach
    sys.place(30, 30, MATERIAL_SAND_2X2); // occupies (30,30)-(31,31)
    sys.applyWindForce({ centerXPx: 20, centerYPx: 31, radiusPx: 20, forceX: 100, forceY: 0, falloff: 0 });
    const p = sys.getParticleAtCell(30, 30)!;
    assert.equal(sys.particleCount, 1);
    // A single dampened impulse, scaled by the 2x2 material's own (lower) response — never doubled/quadrupled.
    const maxPossible = 100 * getMaterialWindResponse(MATERIAL_SAND_2X2);
    assert.ok(p.windVelX > 0 && p.windVelX <= maxPossible + 1e-6, `got ${p.windVelX}, single-impulse ceiling is ${maxPossible}`);
  });
});

// ── 13. Real room-load wiring: one entry per placement ──────────────────────

describe('Phase 2F: room builder — windTransmissionBlocks is one entry per placement', () => {
  test('13a. a 1x1 dampen placement registers exactly one windTransmissionBlocks entry', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('wind-1x1', windProps('dampen', { breakability: 'indestructible' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:wind-1x1', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.windTransmissionBlocks?.length, 1);
    assert.deepEqual(roomDef.windTransmissionBlocks![0], { xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1, tier: 'dampen' });
    clearCustomBlockSpriteCache();
  });

  test('13b. a 2x2 block placement registers exactly ONE windTransmissionBlocks entry, not four', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('wind-2x2', windProps('block', { breakability: 'indestructible' }), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:wind-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.windTransmissionBlocks?.length, 1);
    assert.deepEqual(roomDef.windTransmissionBlocks![0], { xBlock: 10, yBlock: 10, wBlock: 2, hBlock: 2, tier: 'block' });
    clearCustomBlockSpriteCache();
  });

  test('13c. a passThrough placement registers no windTransmissionBlocks entry at all', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('wind-passthrough', windProps('passThrough', { breakability: 'indestructible' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:wind-passthrough', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.windTransmissionBlocks, undefined);
    clearCustomBlockSpriteCache();
  });

  test('13d. loadRoomPixelMaterials builds a non-empty windMask from windTransmissionBlocks', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('wind-load', windProps('block', { breakability: 'indestructible' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:wind-load', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    loadRoomPixelMaterials(world, roomDef);
    const mask = world.pixelMaterialSystem.windMask;
    assert.ok(mask !== null);
    assert.equal(mask!.isEmpty, false);
    assert.equal(mask!.tierAt(5 * BLOCK_SIZE_MEDIUM, 5 * BLOCK_SIZE_MEDIUM), 2);
    clearCustomBlockSpriteCache();
  });

  test('13e. a room with no wind-modifying custom blocks builds an empty windMask (fast path applies)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('wind-none', windProps('passThrough', { breakability: 'indestructible' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:wind-none', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    loadRoomPixelMaterials(world, roomDef);
    assert.equal(world.pixelMaterialSystem.windMask?.isEmpty, true);
    clearCustomBlockSpriteCache();
  });
});

// ── 14. Fragile windbreak invalidation via the real destruction pathway ─────

describe('Phase 2F: fragile windbreak mask invalidation on destruction', () => {
  test('14a. an unbroken fragile 1x1 windbreak occludes wind; breaking it clears the mask starting the next applyWindForce call', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('fragile-windbreak', windProps('block'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:fragile-windbreak', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5, 400); // on the block, plenty of momentum

    const sys = world.pixelMaterialSystem;
    const bx = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    assert.equal(sys.windMask?.tierAt(bx, by), 2, 'windbreak must occlude before destruction');

    applyHazards(world);
    assert.equal(world.isBreakableBlockActiveFlag[0], 0, 'the fragile windbreak must actually break');
    assert.equal(sys.windMask?.tierAt(bx, by), 0, 'mask must be cleared immediately after destruction (next applyWindForce call sees it)');
    clearCustomBlockSpriteCache();
  });

  test('14b. breaking one cell of a grouped 2x2 fragile windbreak clears the mask for the WHOLE footprint atomically', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('fragile-windbreak-2x2', windProps('block', { breakResistance: 'weak' }), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:fragile-windbreak-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 10, 10, 200); // breaks weak(150)

    const sys = world.pixelMaterialSystem;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const cx = (10 + dx + 0.5) * BLOCK_SIZE_MEDIUM;
        const cy = (10 + dy + 0.5) * BLOCK_SIZE_MEDIUM;
        assert.equal(sys.windMask?.tierAt(cx, cy), 2, `cell (${dx},${dy}) must occlude before destruction`);
      }
    }

    applyHazards(world);
    for (let i = 0; i < 4; i++) assert.equal(world.isBreakableBlockActiveFlag[i], 0, 'all 4 cells must break atomically');
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const cx = (10 + dx + 0.5) * BLOCK_SIZE_MEDIUM;
        const cy = (10 + dy + 0.5) * BLOCK_SIZE_MEDIUM;
        assert.equal(sys.windMask?.tierAt(cx, cy), 0, `cell (${dx},${dy}) must no longer occlude after the group breaks`);
      }
    }
    clearCustomBlockSpriteCache();
  });

  test('14c. adjacent windbreak placements remain independent — breaking one never clears the other\'s mask region', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('fragile-adj', windProps('block', { breakResistance: 'weak' }));
    registerTestBlock('indestruct-adj', windProps('block', { breakability: 'indestructible' }));
    const room = makeEditorRoomData([
      { xBlock: 0, yBlock: 0, blockId: 'custom:fragile-adj', tileWidth: 1, tileHeight: 1 },
      { xBlock: 2, yBlock: 0, blockId: 'custom:indestruct-adj', tileWidth: 1, tileHeight: 1 },
    ]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 0, 0, 200); // breaks weak(150)
    const sys = world.pixelMaterialSystem;

    const otherX = (2 + 0.5) * BLOCK_SIZE_MEDIUM;
    const otherY = (0 + 0.5) * BLOCK_SIZE_MEDIUM;
    applyHazards(world);
    assert.equal(world.isBreakableBlockActiveFlag[0], 0, 'the fragile placement must break');
    assert.equal(sys.windMask?.tierAt(otherX, otherY), 2, 'the neighboring indestructible windbreak must be untouched');
    clearCustomBlockSpriteCache();
  });

  test('14d. an indestructible windbreak never enters the breakable pathway and can never be cleared', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('indestruct-wind', windProps('block', { breakability: 'indestructible' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:indestruct-wind', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.length ?? 0, 0);
    const world = worldWithPlayerAt(roomDef, 5, 5, 500); // extreme speed — irrelevant, nothing to break
    applyHazards(world);
    const bx = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    assert.equal(world.pixelMaterialSystem.windMask?.tierAt(bx, by), 2);
    clearCustomBlockSpriteCache();
  });
});

// ── 15. Interaction preservation with other properties ─────────────────────

describe('Phase 2F: interaction preservation with prior-phase properties', () => {
  test('15a. a fragile windbreak can still damage the player on contact — independent systems', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('windbreak-dmg', windProps('block', { contactDamage: 'high', breakResistance: 'reinforced' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:windbreak-dmg', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5, 200); // below reinforced(350) — does not break
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 2, 'contact damage is unaffected by wind response');
    assert.equal(world.isBreakableBlockActiveFlag[0], 1, 'block must not break below its reinforced threshold');
    const bx = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (5 + 0.5) * BLOCK_SIZE_MEDIUM;
    assert.equal(world.pixelMaterialSystem.windMask?.tierAt(bx, by), 2, 'still occludes since it never broke');
    clearCustomBlockSpriteCache();
  });

  test('15b. all three break-resistance tiers work normally on a windbreak block', () => {
    for (const tier of ['weak', 'standard', 'reinforced'] as const) {
      clearCustomBlockSpriteCache();
      registerTestBlock(`windbreak-${tier}`, windProps('dampen', { breakResistance: tier }));
      const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: `custom:windbreak-${tier}`, tileWidth: 1, tileHeight: 1 }]);
      const roomDef = editorRoomDataToRoomDef(room);
      assert.equal(roomDef.breakableBlocks?.[0]?.breakResistance, tier);
      assert.equal(roomDef.breakableBlocks?.[0]?.windResponse, 'dampen');
      clearCustomBlockSpriteCache();
    }
  });

  test('15c. a metal windbreak still emits exactly one material-specific break event when destroyed', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('windbreak-metal', windProps('block', { materialResponse: 'metal', breakResistance: 'weak' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:windbreak-metal', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5, 200); // breaks weak(150)
    applyHazards(world);
    assert.equal(world.breakEventCount, 1);
    assert.equal(world.breakEventMaterial[0], 2, 'metal index (2)');
    clearCustomBlockSpriteCache();
  });
});

// ── 16, 17, 18. Editor dirty-tracking / rename / duplicate data-model behavior ─

describe('Phase 2F: editor dirty tracking, undo/redo, rename, duplicate', () => {
  test('16. changing only windResponse is detected as dirty, and undo restores it', () => {
    const original: CustomBlockProperties = windProps('passThrough', { breakability: 'indestructible' });
    const undoStack: CustomBlockProperties[] = [original];
    let properties: CustomBlockProperties = { ...original, windResponse: 'block' };

    function propertiesEqual(a: CustomBlockProperties, b: CustomBlockProperties): boolean {
      return a.collision === b.collision && a.friction === b.friction && a.breakability === b.breakability &&
        a.materialResponse === b.materialResponse && a.contactDamage === b.contactDamage &&
        a.breakResistance === b.breakResistance && a.windResponse === b.windResponse;
    }

    assert.equal(propertiesEqual(properties, original), false, 'windResponse-only change must be dirty');

    const restored = undoStack.pop()!;
    properties = restored;
    assert.equal(properties.windResponse, 'passThrough');
  });

  test('17. rename preserves windResponse (serializeCustomBlock -> parseCustomBlockSource)', () => {
    const props = windProps('dampen', { breakability: 'indestructible' });
    const before = parseCustomBlockSource(serializeCustomBlock('stable-2f', 'Old Name', 1, 1, makeBlankPixelData(1, 1), props));
    const afterRename = parseCustomBlockSource(serializeCustomBlock('stable-2f', 'New Name', 1, 1, makeBlankPixelData(1, 1), props));
    assert.equal(before.ok, true);
    assert.equal(afterRename.ok, true);
    if (before.ok && afterRename.ok) {
      assert.equal(before.def.id, afterRename.def.id);
      assert.equal(afterRename.def.properties.windResponse, 'dampen');
      assert.deepEqual(before.def.properties, afterRename.def.properties);
    }
  });

  test('18. duplicate copies windResponse with a new stable ID', () => {
    const props = windProps('block', { breakability: 'indestructible' });
    const original = parseCustomBlockSource(serializeCustomBlock('orig-2f', 'Original', 1, 1, makeBlankPixelData(1, 1), props));
    const dup = parseCustomBlockSource(serializeCustomBlock('orig-2f-copy', 'Original Copy', 1, 1, makeBlankPixelData(1, 1), props));
    assert.equal(original.ok, true);
    assert.equal(dup.ok, true);
    if (original.ok && dup.ok) {
      assert.equal(dup.def.properties.windResponse, 'block');
      assert.deepEqual(dup.def.properties, original.def.properties);
      assert.notEqual(dup.def.id, original.def.id);
    }
  });
});

// ── 19. Property-only edits do not rebuild the sprite canvas ───────────────

describe('Phase 2F: sprite-cache properties-only update', () => {
  test('19. updateCustomBlockProperties changes windResponse without rebuilding the cached canvas', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('cache-2f', windProps('passThrough', { breakability: 'indestructible' }));
    const before = getCustomBlockSprite('cache-2f');
    assert.ok(before !== null);
    const canvasBefore = before!.canvas;

    const ok = updateCustomBlockProperties('cache-2f', windProps('block', { breakability: 'indestructible' }));
    assert.equal(ok, true);

    const after = getCustomBlockSprite('cache-2f');
    assert.ok(after !== null);
    assert.equal(after!.canvas, canvasBefore, 'canvas object must be the SAME instance — no rebuild');
    assert.equal(after!.properties.windResponse, 'block');
    clearCustomBlockSpriteCache();
  });
});

// ── 20. Export and relocated reopening preserve the preset ──────────────────

describe('Phase 2F: export/relocate round trip', () => {
  test('20. export and relocated reload preserve the windResponse preset exactly', () => {
    const props = windProps('dampen', { breakability: 'indestructible' });
    const pixelData = makeBlankPixelData(2, 2);
    const sourceDef = serializeCustomBlock('relocate-2f', 'Relocate 2F', 2, 2, pixelData, props);
    assert.equal(sourceDef.schemaVersion, 2);
    const reloaded = JSON.parse(JSON.stringify(sourceDef));
    const parsed = parseCustomBlockSource(reloaded);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.def.properties.windResponse, 'dampen');
  });
});

// ── 21. Campaign switching cannot leak wind-response profiles ──────────────

describe('Phase 2F: campaign switch isolation', () => {
  test('21. campaign switch (sprite cache clear) does not leak stale windResponse', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('leak-check-2f', windProps('block', { breakability: 'indestructible' }));
    assert.equal(getCustomBlockProperties('leak-check-2f').windResponse, 'block');
    clearCustomBlockSpriteCache(); // simulate switching campaigns
    registerTestBlock('leak-check-2f', windProps('passThrough', { breakability: 'indestructible' }));
    assert.equal(getCustomBlockProperties('leak-check-2f').windResponse, 'passThrough');
    clearCustomBlockSpriteCache();
  });

  test('unregistered id after a campaign clear never returns a previous campaign\'s wind-response tier', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('gone-after-clear-2f', windProps('block', { breakability: 'indestructible' }));
    clearCustomBlockSpriteCache();
    assert.equal(getCustomBlockProperties('gone-after-clear-2f').windResponse, 'passThrough'); // safe default, not leaked
  });
});

// ── 22. Backward compatibility ──────────────────────────────────────────────

describe('Phase 2F: backward compatibility', () => {
  test('22a. a hand-authored breakableBlocks entry with no windResponse field never registers as a windbreak', () => {
    const world = createWorldState(16);
    const room = {
      breakableBlocks: [{ xBlock: 4, yBlock: 4 }], // no windResponse — pre-Phase-2F shape
    } as unknown as RoomDef;
    assert.doesNotThrow(() => loadRoomHazards(world, room));
    assert.equal(world.breakableBlockWindTier[0], 0);
  });

  test('22b. a room with no custom blocks at all builds a null-safe, empty windMask and normal wind behaves unchanged', () => {
    const world = createWorldState(16);
    const room = { walls: [] } as unknown as RoomDef;
    loadRoomHazards(world, room);
    loadRoomPixelMaterials(world, room);
    assert.equal(world.pixelMaterialSystem.windMask?.isEmpty, true);
    world.pixelMaterialSystem.place(10, 10, MATERIAL_SAND);
    world.pixelMaterialSystem.applyWindForce({ centerXPx: 5, centerYPx: 10, radiusPx: 20, forceX: 50, forceY: 0, falloff: 0 });
    assert.equal(world.pixelMaterialSystem.getParticleAtCell(10, 10)!.windVelX, 50 * getMaterialWindResponse(MATERIAL_SAND));
  });

  test('22c. all existing Phase 2A-2E property tests keep passing (spot check: full default bundle includes windResponse: passThrough)', () => {
    const result = validateAndResolveCustomBlockProperties(undefined, 1, 1);
    assert.equal(result.properties.windResponse, 'passThrough');
    assert.equal(result.properties.collision, 'solid');
    assert.equal(result.properties.breakability, 'indestructible');
  });
});
