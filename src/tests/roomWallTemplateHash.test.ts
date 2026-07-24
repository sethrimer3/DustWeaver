/**
 * Tests for hydrateAndValidateBakedWallTemplate and computeWallTemplateSourceHash.
 *
 * Covers:
 *   1. Dynamic theme remap: local baked indices are remapped to the current runtime
 *      session's theme registry regardless of registration order.
 *   2. Legacy / no-themeNames path: baked templates without themeNames pass through
 *      themeIndex values unchanged.
 *   3. Stale hash fallback: a mismatched sourceHash returns undefined.
 *   4. Invalid array length fallback: a wallCount mismatch returns undefined.
 *   5. Empty themeNames: no remap, indices pass through unchanged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hydrateAndValidateBakedWallTemplate,
  computeWallTemplateSourceHash,
  BAKED_WALL_SCHEMA_VERSION,
} from '../levels/roomWallTemplateHash';
import { blockThemeToIndex, WALL_THEME_DEFAULT_INDEX } from '../levels/blockTheme';
import type { RoomJsonDef, RoomJsonBakedWallTemplate } from '../editor/roomJsonSchema';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal RoomJsonDef with no interior walls — enough for hash/hydration tests. */
function makeRoomJson(overrides?: Partial<RoomJsonDef>): RoomJsonDef {
  return {
    id: 'test-room',
    name: 'Test Room',
    worldNumber: 1,
    widthBlocks: 20,
    heightBlocks: 15,
    playerSpawnBlock: [10, 7],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    skillTombs: [],
    ...overrides,
  } as RoomJsonDef;
}

/** Returns the zero-filled arrays required by RoomJsonBakedWallTemplate for wallCount n. */
function zeroArrays(n: number): Pick<
  RoomJsonBakedWallTemplate,
  | 'xWorld' | 'yWorld' | 'wWorld' | 'hWorld'
  | 'isPlatformFlag' | 'platformEdge'
  | 'soundHardnessIndex' | 'isInvisibleFlag'
  | 'rampOrientationIndex' | 'isPillarHalfWidthFlag'
  | 'isIceFlag' | 'isUltraIceFlag' | 'rimStyleIndex'
> {
  const z = new Array<number>(n).fill(0);
  return {
    xWorld: [...z],
    yWorld: [...z],
    wWorld: [...z],
    hWorld: [...z],
    isPlatformFlag: [...z],
    platformEdge: [...z],
    soundHardnessIndex: [...z],
    isInvisibleFlag: [...z],
    rampOrientationIndex: [...z],
    isPillarHalfWidthFlag: [...z],
    isIceFlag: [...z],
    isUltraIceFlag: [...z],
    rimStyleIndex: new Array<number>(n).fill(0xFFFF),
  };
}

/** Builds a valid baked template that will pass all validation checks. */
function makeBaked(
  json: RoomJsonDef,
  themeIndex: number[],
  themeNames?: string[],
): RoomJsonBakedWallTemplate {
  const n = themeIndex.length;
  return {
    schemaVersion: BAKED_WALL_SCHEMA_VERSION,
    sourceHash: computeWallTemplateSourceHash(json),
    wallCount: n,
    themeIndex,
    ...(themeNames !== undefined ? { themeNames } : {}),
    ...zeroArrays(n),
    rimStyles: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('dynamic theme remap: local baked indices map to runtime session indices', () => {
  // Register themes in a different order than the bake order.
  // Bake order: crystalBlue → local 3, verdureMoss → local 4
  // Runtime order here: verdureMoss first, then a filler, then crystalBlue
  const mossIdx    = blockThemeToIndex('verdureMoss');
  const _fillerIdx = blockThemeToIndex('testFillerTheme'); // intentionally advances the registry
  void _fillerIdx;
  const crystalIdx = blockThemeToIndex('crystalBlue');

  // crystalIdx > mossIdx because crystalBlue was registered later in this session
  assert.notEqual(crystalIdx, mossIdx, 'theme indices must differ for the remap to be meaningful');

  const json = makeRoomJson();
  // themeNames[0] = 'crystalBlue' → local index 3
  // themeNames[1] = 'verdureMoss' → local index 4
  const baked = makeBaked(json, [255, 3, 4, 3], ['crystalBlue', 'verdureMoss']);

  const tpl = hydrateAndValidateBakedWallTemplate(json, baked);

  assert.ok(tpl, 'hydration must succeed with a valid baked template');
  assert.equal(tpl.wallCount, 4);

  // 255 (WALL_THEME_DEFAULT_INDEX) is identity-mapped (no themeNames entry covers it)
  assert.equal(tpl.themeIndex[0], WALL_THEME_DEFAULT_INDEX);

  // Local index 3 (crystalBlue) → current runtime index for crystalBlue
  assert.equal(tpl.themeIndex[1], crystalIdx, 'local 3 must resolve to crystalIdx');
  // Local index 4 (verdureMoss) → current runtime index for verdureMoss
  assert.equal(tpl.themeIndex[2], mossIdx,    'local 4 must resolve to mossIdx');
  // Repeated local index 3 must be consistent
  assert.equal(tpl.themeIndex[3], crystalIdx, 'repeated local 3 must resolve consistently');
});

test('legacy path: no themeNames passes themeIndex values through unchanged', () => {
  const json = makeRoomJson();
  const baked = makeBaked(json, [0, 1, 2, 255]);
  // No themeNames field — legacy behavior

  const tpl = hydrateAndValidateBakedWallTemplate(json, baked);

  assert.ok(tpl, 'hydration must succeed for legacy baked template');
  assert.equal(tpl.themeIndex[0], 0);
  assert.equal(tpl.themeIndex[1], 1);
  assert.equal(tpl.themeIndex[2], 2);
  assert.equal(tpl.themeIndex[3], WALL_THEME_DEFAULT_INDEX);
});

test('stale hash: mismatched sourceHash returns undefined', () => {
  const json = makeRoomJson();
  const baked: RoomJsonBakedWallTemplate = {
    schemaVersion: BAKED_WALL_SCHEMA_VERSION,
    sourceHash: 'deadbeef',   // wrong hash
    wallCount: 1,
    themeIndex: [0],
    ...zeroArrays(1),
  };

  const tpl = hydrateAndValidateBakedWallTemplate(json, baked);

  assert.equal(tpl, undefined, 'stale hash must cause fallback to undefined');
});

test('invalid array length: wallCount mismatch returns undefined', () => {
  const json = makeRoomJson();
  // wallCount=3 but themeIndex only has 2 entries
  const baked: RoomJsonBakedWallTemplate = {
    schemaVersion: BAKED_WALL_SCHEMA_VERSION,
    sourceHash: computeWallTemplateSourceHash(json),
    wallCount: 3,
    themeIndex: [0, 1],        // length 2 ≠ wallCount 3 → validation failure
    ...zeroArrays(3),
  };

  const tpl = hydrateAndValidateBakedWallTemplate(json, baked);

  assert.equal(tpl, undefined, 'array length mismatch must cause fallback to undefined');
});

test('empty themeNames: no remap, dynamic indices pass through unchanged', () => {
  // Ensure index 3 is registered so blockThemeToIndex('someKnownTheme') === 3 is handled
  // We don't need a specific index — just verify identity-mapping when themeNames is empty.
  const json = makeRoomJson();
  const baked = makeBaked(json, [3], []);

  const tpl = hydrateAndValidateBakedWallTemplate(json, baked);

  assert.ok(tpl, 'empty themeNames must not break hydration');
  // Empty themeNames triggers the no-remap branch; index 3 passes through as 3
  assert.equal(tpl.themeIndex[0], 3, 'empty themeNames: index 3 must remain 3');
});
