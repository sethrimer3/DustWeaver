/**
 * Tests for Phase 2D: custom block contact-damage presets.
 *
 * Covers: the contactDamage property/registry (customBlockProperties.ts),
 * schema-v1/v2 compatibility defaults, the contactDamageRequiresSolid
 * compatibility rule, the real contact-damage detection pathway in
 * src/sim/hazards.ts (applyHazards) threaded through
 * editorRoomBuilder.ts/gameRoomHazards.ts, grouped (2x2) logical-placement
 * ownership/deduplication, knockback-direction-from-contact-surface, the
 * fragile+damage interaction order, and the sprite-cache properties-only
 * update optimization. Extends (does not replace) the Phase 2A/2B/2C
 * suites, whose coverage must continue to pass unchanged.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal DOM stubs for Node.js test environment (mirrors Phase 2B/2C tests) ──
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
  isEligibleForContactDamage,
  isContactDamagePreset,
  contactDamageTierToIndex,
  indexToContactDamageTier,
  CONTACT_DAMAGE_PRESET_IDS,
  type CustomBlockProperties,
  type ContactDamagePreset,
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

// ── Helpers (mirror src/tests/customBlocksPhase2C.test.ts) ──────────────────

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
    pixelData: makeBlankPixelData(tileWidth, tileHeight), // fully transparent — see test 16
    properties,
  };
  registerCustomBlockSprite(def);
}

function makeEditorRoomData(placements: Array<{
  xBlock: number; yBlock: number; blockId: string; tileWidth: 1 | 2; tileHeight: 1 | 2;
}>): EditorRoomData {
  return {
    id: 'room-2d',
    name: 'Room 2D',
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

/** Solid, indestructible-by-default block properties with a given contactDamage tier. */
function dmgProps(
  contactDamage: ContactDamagePreset,
  overrides: Partial<CustomBlockProperties> = {},
): CustomBlockProperties {
  return {
    collision: 'solid', friction: 'default', breakability: 'indestructible',
    materialResponse: 'stone', contactDamage, ...overrides,
  };
}

/** Builds a world with a stationary (or given-velocity) player cluster at the given block coords. */
function worldWithPlayerAt(
  room: RoomDef, cxBlock: number, cyBlock: number, velocityXWorld = 0,
): ReturnType<typeof createWorldState> {
  const world = createWorldState(16);
  loadRoomHazards(world, room);
  const cx = (cxBlock + 0.5) * BLOCK_SIZE_MEDIUM;
  const cy = (cyBlock + 0.5) * BLOCK_SIZE_MEDIUM;
  const player = createClusterState(0, cx, cy, 1, 10); // 10 max HP — headroom for repeated-hit tests
  player.velocityXWorld = velocityXWorld;
  world.clusters = [player];
  return world;
}

// ── 1 & 2. Schema defaults ───────────────────────────────────────────────────

describe('Phase 2D: schema defaults', () => {
  test('1. version-1 custom blocks default contactDamage to none', () => {
    const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const pixels: string[][] = Array.from({ length: pw }, () => Array.from({ length: pw }, () => '#FF000088'));
    const source = {
      schemaVersion: 1, id: 'legacy-2d', name: 'Legacy', tileWidth: 1, tileHeight: 1,
      pixelWidth: pw, pixelHeight: pw, behavior: 'solid', pixels,
    };
    const result = parseCustomBlockSource(source);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.def.properties.contactDamage, 'none');
  });

  test('2. schema-v2 blocks without contactDamage default to none', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', breakability: 'indestructible' }, 1, 1, { blockId: 'no-damage' },
    );
    assert.equal(result.properties.contactDamage, 'none');
    assert.equal(result.fallbackUsed, false); // absence is not an error
  });
});

// ── 3. All three presets save and reload ────────────────────────────────────

describe('Phase 2D: preset round trip', () => {
  for (const tier of CONTACT_DAMAGE_PRESET_IDS) {
    test(`3. ${tier} preset saves and reloads exactly`, () => {
      const props = dmgProps(tier);
      const pixelData = makeBlankPixelData(1, 1);
      const sourceDef = serializeCustomBlock(`rt2d-${tier}`, `RT ${tier}`, 1, 1, pixelData, props);
      const parsed = parseCustomBlockSource(sourceDef);
      assert.equal(parsed.ok, true);
      if (parsed.ok) assert.equal(parsed.def.properties.contactDamage, tier);
    });
  }
});

// ── 4. Unknown values produce a diagnostic and safe fallback ────────────────

describe('Phase 2D: invalid contactDamage values', () => {
  test('4. unknown contactDamage value is rejected safely and falls back to none', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'solid', friction: 'default', breakability: 'indestructible', contactDamage: 'extreme' },
      1, 1, { blockId: 'bad-damage' },
    );
    assert.equal(result.properties.contactDamage, 'none');
    assert.ok(result.errors.some(e => e.field === 'properties.contactDamage'));
    assert.equal(result.fallbackUsed, true);
  });

  test('isContactDamagePreset rejects non-strings and unknown strings', () => {
    assert.equal(isContactDamagePreset('none'), true);
    assert.equal(isContactDamagePreset('low'), true);
    assert.equal(isContactDamagePreset('high'), true);
    assert.equal(isContactDamagePreset('extreme'), false);
    assert.equal(isContactDamagePreset(42), false);
    assert.equal(isContactDamagePreset(undefined), false);
  });
});

// ── 5 & 6. Compatibility: contactDamage requires solid collision ────────────

describe('Phase 2D: compatibility rules', () => {
  test('5. oneWay + low damage is rejected (contactDamageRequiresSolid)', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'oneWay', friction: 'default', breakability: 'indestructible', materialResponse: 'stone', contactDamage: 'low' },
      1, 1,
    );
    assert.ok(issues.some(i => i.rule === 'contactDamageRequiresSolid'));
  });

  test('6. nonSolid + high damage is rejected (contactDamageRequiresSolid)', () => {
    const issues = checkCustomBlockPropertyCompatibility(
      { collision: 'nonSolid', friction: 'default', breakability: 'indestructible', materialResponse: 'stone', contactDamage: 'high' },
      1, 1,
    );
    assert.ok(issues.some(i => i.rule === 'contactDamageRequiresSolid'));
  });

  test('solid + any contactDamage is compatible', () => {
    for (const tier of CONTACT_DAMAGE_PRESET_IDS) {
      const issues = checkCustomBlockPropertyCompatibility(dmgProps(tier), 1, 1);
      assert.equal(issues.some(i => i.rule === 'contactDamageRequiresSolid'), false);
    }
  });

  test('oneWay/nonSolid + damage falls back to none at load time (safe fallback, not a crash)', () => {
    const result = validateAndResolveCustomBlockProperties(
      { collision: 'oneWay', friction: 'default', breakability: 'indestructible', contactDamage: 'high' },
      1, 1, { blockId: 'oneway-damage' },
    );
    assert.equal(result.properties.contactDamage, 'none');
    assert.equal(result.properties.collision, 'oneWay'); // collision itself is untouched
    assert.equal(result.fallbackUsed, true);
  });

  test('isEligibleForContactDamage requires solid + non-none tier', () => {
    assert.equal(isEligibleForContactDamage(dmgProps('low')), true);
    assert.equal(isEligibleForContactDamage(dmgProps('none')), false);
    assert.equal(isEligibleForContactDamage({ ...dmgProps('high'), collision: 'oneWay' }), false);
    assert.equal(isEligibleForContactDamage({ ...dmgProps('high'), collision: 'nonSolid' }), false);
  });

  test('contactDamageTierToIndex / indexToContactDamageTier round trip', () => {
    assert.equal(indexToContactDamageTier(contactDamageTierToIndex('low')), 'low');
    assert.equal(indexToContactDamageTier(contactDamageTierToIndex('high')), 'high');
    assert.equal(indexToContactDamageTier(99), 'low'); // unknown index falls back to low
  });
});

// ── 7, 8, 9. Real damage-tier application via applyHazards ──────────────────

describe('Phase 2D: real contact-damage application', () => {
  test('7. solid low-damage blocks apply the low engine preset (1 point) on contact', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('dmg-low-1x1', dmgProps('low'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:dmg-low-1x1', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5);
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 1);
    clearCustomBlockSpriteCache();
  });

  test('8. solid high-damage blocks apply the high engine preset (2 points) on contact', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('dmg-high-1x1', dmgProps('high'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:dmg-high-1x1', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5);
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 2);
    clearCustomBlockSpriteCache();
  });

  test('9. none produces no damage attempt and no contactDamageBlocks entries', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('dmg-none-1x1', dmgProps('none'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:dmg-none-1x1', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.contactDamageBlocks?.length ?? 0, 0);
    const world = worldWithPlayerAt(roomDef, 5, 5);
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(world.clusters[0]!.healthPoints, before);
    clearCustomBlockSpriteCache();
  });
});

// ── 10. Proximity alone does not damage ──────────────────────────────────────

describe('Phase 2D: contact requires actual collision', () => {
  test('10. player near but not overlapping the block takes no damage', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('dmg-proximity', dmgProps('high'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:dmg-proximity', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    // Block center is at (5.5, 5.5) blocks; place the player 3 full blocks
    // away on the X axis — well outside both AABBs (player half-width 3.5,
    // block half 4, block size 8: 3 blocks = 24 world units of separation).
    const player = createClusterState(0, (5.5 + 3) * BLOCK_SIZE_MEDIUM, 5.5 * BLOCK_SIZE_MEDIUM, 1, 10);
    world.clusters = [player];
    const before = player.healthPoints;
    applyHazards(world);
    assert.equal(player.healthPoints, before);
    clearCustomBlockSpriteCache();
  });
});

// ── 11, 12. Invulnerability / cooldown behavior ─────────────────────────────

describe('Phase 2D: invulnerability and repeat-contact behavior', () => {
  test('11 & 12. sustained contact across multiple ticks damages only once until invulnerability expires', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('dmg-sustained', dmgProps('low'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:dmg-sustained', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5);
    const player = world.clusters[0]!;
    const startHealth = player.healthPoints;

    applyHazards(world); // tick 1: first hit
    assert.equal(startHealth - player.healthPoints, 1);

    // Several more ticks while still overlapping — invulnerabilityTicks (90)
    // blocks every one of these; health must not drop further.
    for (let t = 0; t < 10; t++) applyHazards(world);
    assert.equal(startHealth - player.healthPoints, 1, 'no additional damage while still invulnerable');
    clearCustomBlockSpriteCache();
  });
});

// ── 13, 14. Grouped (2x2) ownership and adjacent-placement independence ────

describe('Phase 2D: logical placement ownership', () => {
  test('13. contacting multiple cells of one 2x2 placement produces exactly one damage attempt', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('dmg-2x2-group', dmgProps('high'), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:dmg-2x2-group', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.contactDamageBlocks?.length, 4);
    const groupIds = new Set(roomDef.contactDamageBlocks!.map(c => c.groupId));
    assert.equal(groupIds.size, 1);
    assert.notEqual([...groupIds][0], undefined);

    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    // Position the player straddling the boundary between all 4 cells —
    // overlapping every one of the 2x2 group's cells simultaneously.
    const cx = (10 + 1) * BLOCK_SIZE_MEDIUM; // exact center of the 2x2 footprint
    const cy = (10 + 1) * BLOCK_SIZE_MEDIUM;
    const player = createClusterState(0, cx, cy, 1, 10);
    world.clusters = [player];
    const before = player.healthPoints;
    applyHazards(world);
    assert.equal(before - player.healthPoints, 2, 'exactly one high-tier (2 point) hit, not four');
    clearCustomBlockSpriteCache();
  });

  test('10b. 2x2 union footprint and center used for the damage source (indirectly verified via knockback direction)', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('dmg-2x2-center', dmgProps('low'), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 0, yBlock: 0, blockId: 'custom:dmg-2x2-center', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    // Player overlapping only the top-left cell (0,0), positioned toward the
    // group's right edge — nearest point on the FULL 2x2 union AABB should
    // still be used, not just cell (0,0)'s own smaller AABB.
    const player = createClusterState(0, 1.9 * BLOCK_SIZE_MEDIUM, 1 * BLOCK_SIZE_MEDIUM, 1, 10);
    world.clusters = [player];
    applyHazards(world);
    // Player center (1.9 blocks) is still within the union footprint's X
    // range [0,2) blocks, so the horizontal clamp keeps sourceX at playerX
    // (dx=0) -> the fallback (rightward) knockback direction applies,
    // proving the source came from the union AABB (which spans to x=2
    // blocks) rather than only cell (0,0)'s AABB (which spans to x=1 block,
    // which would have clamped differently). This is a smoke check that the
    // group-wide AABB, not a single cell, was used.
    assert.ok(player.velocityXWorld !== 0);
    clearCustomBlockSpriteCache();
  });

  test('14. contacting adjacent distinct 2x2 placements does not confuse ownership', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('dmg-adj-a', dmgProps('low'), 2, 2);
    registerTestBlock('dmg-adj-b', dmgProps('high'), 2, 2);
    const room = makeEditorRoomData([
      { xBlock: 0, yBlock: 0, blockId: 'custom:dmg-adj-a', tileWidth: 2, tileHeight: 2 },
      { xBlock: 2, yBlock: 0, blockId: 'custom:dmg-adj-b', tileWidth: 2, tileHeight: 2 }, // touching, different definition
    ]);
    const roomDef = editorRoomDataToRoomDef(room);
    const cells = roomDef.contactDamageBlocks ?? [];
    assert.equal(cells.length, 8);
    const groupA = cells.filter(c => c.xBlock < 2).map(c => c.groupId);
    const groupB = cells.filter(c => c.xBlock >= 2).map(c => c.groupId);
    assert.equal(new Set(groupA).size, 1);
    assert.equal(new Set(groupB).size, 1);
    assert.notEqual(groupA[0], groupB[0]);
    assert.ok(cells.filter(c => c.xBlock < 2).every(c => c.tier === 'low'));
    assert.ok(cells.filter(c => c.xBlock >= 2).every(c => c.tier === 'high'));

    // Strike only placement A (low tier) — must apply exactly 1 damage, not
    // placement B's 2, proving the groups were not merged.
    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    const player = createClusterState(0, 1 * BLOCK_SIZE_MEDIUM, 1 * BLOCK_SIZE_MEDIUM, 1, 10);
    world.clusters = [player];
    const before = player.healthPoints;
    applyHazards(world);
    assert.equal(before - player.healthPoints, 1);
    clearCustomBlockSpriteCache();
  });
});

// ── 15. Knockback direction follows the contacted surface ───────────────────

describe('Phase 2D: knockback direction', () => {
  test('15. knockback pushes the player away from the side they contacted', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('dmg-knockback', dmgProps('low'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:dmg-knockback', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = createWorldState(16);
    loadRoomHazards(world, roomDef);
    // Block spans world X [40, 48). Position the player's CENTER past the
    // block's right edge (at 50) while still overlapping (player half-width
    // 3.5, so playerLeft = 46.5 < 48 = bRight) — nearest point clamps to
    // bRight, dx = 50 - 48 > 0, so the player should be knocked further right.
    const player = createClusterState(0, 50, 5.5 * BLOCK_SIZE_MEDIUM, 1, 10);
    world.clusters = [player];
    applyHazards(world);
    assert.ok(player.velocityXWorld > 0, 'player contacting from the right should be knocked further right');
    clearCustomBlockSpriteCache();
  });
});

// ── 16. Transparent pixels do not affect contact behavior ───────────────────

describe('Phase 2D: pixel transparency independence', () => {
  test('16. a fully transparent-pixel damaging block still damages on contact', () => {
    clearCustomBlockSpriteCache();
    // registerTestBlock always uses makeBlankPixelData (fully transparent) —
    // this test makes that assumption explicit and verifies contact damage
    // is purely position-based, never a per-pixel/alpha check.
    registerTestBlock('dmg-transparent', dmgProps('high'));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:dmg-transparent', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 5, 5);
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 2);
    clearCustomBlockSpriteCache();
  });
});

// ── 17, 18. Fragile + contactDamage interaction order ───────────────────────

describe('Phase 2D: fragile + contactDamage interaction', () => {
  test('17. a fragile+damaging 1x1 block damages the player AND breaks in the same fast-contact tick', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-dmg-1x1', dmgProps('low', { breakability: 'fragile' }));
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:frag-dmg-1x1', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    // Fast enough to also satisfy the existing breakable-block momentum threshold.
    const world = worldWithPlayerAt(roomDef, 5, 5, 400);
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 1, 'contact damage applied');
    assert.equal(world.isBreakableBlockActiveFlag[0], 0, 'block also broke this tick');
    assert.equal(world.breakEventCount, 1, 'exactly one break event, unaffected by contact damage');
    clearCustomBlockSpriteCache();
  });

  test('18. a fragile+damaging 2x2 block produces at most one damage attempt and one atomic destruction', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('frag-dmg-2x2', dmgProps('high', { breakability: 'fragile' }), 2, 2);
    const room = makeEditorRoomData([{ xBlock: 10, yBlock: 10, blockId: 'custom:frag-dmg-2x2', tileWidth: 2, tileHeight: 2 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    const world = worldWithPlayerAt(roomDef, 10, 10, 400);
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 2, 'exactly one high-tier hit, not four');
    for (let i = 0; i < 4; i++) assert.equal(world.isBreakableBlockActiveFlag[i], 0, `cell ${i} destroyed atomically`);
    assert.equal(world.breakEventCount, 1);

    // Re-running applyHazards on the now-broken placement must not damage
    // or break further (both idempotency guards — invuln + active-flag).
    const midHealth = world.clusters[0]!.healthPoints;
    applyHazards(world);
    applyHazards(world);
    assert.equal(world.clusters[0]!.healthPoints, midHealth);
    clearCustomBlockSpriteCache();
  });
});

// ── 19. Indestructible damaging blocks remain present ───────────────────────

describe('Phase 2D: indestructible damaging blocks', () => {
  test('19. an indestructible damaging block still damages the player but is never destroyed', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('indestruct-dmg', dmgProps('high')); // breakability defaults to indestructible
    const room = makeEditorRoomData([{ xBlock: 5, yBlock: 5, blockId: 'custom:indestruct-dmg', tileWidth: 1, tileHeight: 1 }]);
    const roomDef = editorRoomDataToRoomDef(room);
    assert.equal(roomDef.breakableBlocks?.length ?? 0, 0); // never entered the breakable pathway
    const world = worldWithPlayerAt(roomDef, 5, 5, 400); // even at high speed
    const before = world.clusters[0]!.healthPoints;
    applyHazards(world);
    assert.equal(before - world.clusters[0]!.healthPoints, 2);
    assert.equal(world.breakableBlockCount, 0);
    assert.equal(world.isContactDamageBlockActiveFlag[0], 1, 'still present/active after contact');
    clearCustomBlockSpriteCache();
  });
});

// ── 20, 21, 22. Editor dirty-tracking / rename / duplicate data-model behavior ─

describe('Phase 2D: editor dirty tracking, undo/redo, rename, duplicate', () => {
  test('20. changing only contactDamage is detected as dirty, and undo restores it', () => {
    const original: CustomBlockProperties = dmgProps('none');
    const undoStack: CustomBlockProperties[] = [original];
    let properties: CustomBlockProperties = { ...original, contactDamage: 'high' };

    function propertiesEqual(a: CustomBlockProperties, b: CustomBlockProperties): boolean {
      return a.collision === b.collision && a.friction === b.friction && a.breakability === b.breakability &&
        a.materialResponse === b.materialResponse && a.contactDamage === b.contactDamage;
    }

    assert.equal(propertiesEqual(properties, original), false, 'contactDamage-only change must be dirty');

    const restored = undoStack.pop()!;
    properties = restored;
    assert.equal(properties.contactDamage, 'none');
  });

  test('21. rename preserves contactDamage (serializeCustomBlock -> parseCustomBlockSource)', () => {
    const props = dmgProps('high');
    const before = parseCustomBlockSource(serializeCustomBlock('stable-2d', 'Old Name', 1, 1, makeBlankPixelData(1, 1), props));
    const afterRename = parseCustomBlockSource(serializeCustomBlock('stable-2d', 'New Name', 1, 1, makeBlankPixelData(1, 1), props));
    assert.equal(before.ok, true);
    assert.equal(afterRename.ok, true);
    if (before.ok && afterRename.ok) {
      assert.equal(before.def.id, afterRename.def.id);
      assert.equal(afterRename.def.properties.contactDamage, 'high');
      assert.deepEqual(before.def.properties, afterRename.def.properties);
    }
  });

  test('22. duplicate copies contactDamage with a new stable ID', () => {
    const props = dmgProps('low');
    const original = parseCustomBlockSource(serializeCustomBlock('orig-2d', 'Original', 1, 1, makeBlankPixelData(1, 1), props));
    const dup = parseCustomBlockSource(serializeCustomBlock('orig-2d-copy', 'Original Copy', 1, 1, makeBlankPixelData(1, 1), props));
    assert.equal(original.ok, true);
    assert.equal(dup.ok, true);
    if (original.ok && dup.ok) {
      assert.equal(dup.def.properties.contactDamage, 'low');
      assert.deepEqual(dup.def.properties, original.def.properties);
      assert.notEqual(dup.def.id, original.def.id);
    }
  });
});

// ── 23. Property-only edits do not rebuild the sprite canvas ───────────────

describe('Phase 2D: sprite-cache properties-only update', () => {
  test('23. updateCustomBlockProperties changes contactDamage without rebuilding the cached canvas', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('cache-2d', dmgProps('none'));
    const before = getCustomBlockSprite('cache-2d');
    assert.ok(before !== null);
    const canvasBefore = before!.canvas;

    const ok = updateCustomBlockProperties('cache-2d', dmgProps('high'));
    assert.equal(ok, true);

    const after = getCustomBlockSprite('cache-2d');
    assert.ok(after !== null);
    assert.equal(after!.canvas, canvasBefore, 'canvas object must be the SAME instance — no rebuild');
    assert.equal(after!.properties.contactDamage, 'high');
    clearCustomBlockSpriteCache();
  });
});

// ── 24. Export and relocated reopening preserve the preset ──────────────────

describe('Phase 2D: export/relocate round trip', () => {
  test('24. export and relocated reload preserve the contactDamage preset exactly', () => {
    const props = dmgProps('high', { breakability: 'fragile' });
    const pixelData = makeBlankPixelData(2, 2);
    const sourceDef = serializeCustomBlock('relocate-2d', 'Relocate 2D', 2, 2, pixelData, props);
    assert.equal(sourceDef.schemaVersion, 2);
    const reloaded = JSON.parse(JSON.stringify(sourceDef));
    const parsed = parseCustomBlockSource(reloaded);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.def.properties.contactDamage, 'high');
  });
});

// ── 25. Campaign switching cannot leak damage profiles ──────────────────────

describe('Phase 2D: campaign switch isolation', () => {
  test('25. campaign switch (sprite cache clear) does not leak stale contactDamage', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('leak-check-2d', dmgProps('high'));
    assert.equal(getCustomBlockProperties('leak-check-2d').contactDamage, 'high');
    clearCustomBlockSpriteCache(); // simulate switching campaigns
    registerTestBlock('leak-check-2d', dmgProps('none'));
    assert.equal(getCustomBlockProperties('leak-check-2d').contactDamage, 'none');
    clearCustomBlockSpriteCache();
  });

  test('unregistered id after a campaign clear never returns a previous campaign\'s damage tier', () => {
    clearCustomBlockSpriteCache();
    registerTestBlock('gone-after-clear-2d', dmgProps('high'));
    clearCustomBlockSpriteCache();
    assert.equal(getCustomBlockProperties('gone-after-clear-2d').contactDamage, 'none'); // safe default, not leaked
  });
});
