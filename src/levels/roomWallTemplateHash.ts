/**
 * roomWallTemplateHash.ts — Baked wall template validation and hydration.
 *
 * Provides:
 *   - `BAKED_WALL_SCHEMA_VERSION` — bump when the baked format changes.
 *   - `computeWallTemplateSourceHash()` — deterministic hash of all wall-affecting
 *     inputs from a `RoomJsonDef`.  Used to detect stale baked data.
 *   - `hydrateAndValidateBakedWallTemplate()` — validates, recomputes the hash,
 *     and hydrates a `RoomJsonBakedWallTemplate` into a `RoomWallTemplate`.
 *     Returns `undefined` on any failure and emits a DEV warning.
 *
 * DESIGN (BUILD 420+):
 *   The hash does NOT include transition geometry because boundary walls are now
 *   complete solid edge rectangles that are independent of transitions.
 *   Only wall-affecting inputs (dimensions, interiorWalls properties, block
 *   theme, sound hardness, BLOCK_SIZE_MEDIUM, schema version) are hashed.
 */

import type { RoomJsonDef, RoomJsonBakedWallTemplate } from '../editor/roomJsonSchema';
import type { RoomWallTemplate } from './roomDef';
import { BLOCK_SIZE_MEDIUM } from './roomDef';
import { blockThemeToIndex, indexToBlockTheme } from './blockTheme';
import { decodeSurfaceRimStyle } from '../render/walls/surfaceRimStyle';

// ── Schema version ────────────────────────────────────────────────────────────

/**
 * Bump this when the baked template format or wall-geometry algorithm changes.
 * Mismatches cause a safe fallback to `buildRoomWallTemplate()`.
 */
export const BAKED_WALL_SCHEMA_VERSION = 2;

// ── Source hash ───────────────────────────────────────────────────────────────

/**
 * Deterministic djb2-style hash of all wall-affecting inputs in a `RoomJsonDef`.
 *
 * Covers:
 *   - schema version, BLOCK_SIZE_MEDIUM
 *   - room dimensions (widthBlocks, heightBlocks)
 *   - room blockTheme / blockThemeId / soundHardness
 *   - all interiorWall properties
 *
 * Does NOT cover transitions — boundary walls are independent of transitions.
 * Returns a lowercase hex string (8 chars).
 */
export function computeWallTemplateSourceHash(json: RoomJsonDef): string {
  let h = 5381;

  function mix(n: number): void {
    // djb2: h = ((h << 5) + h) ^ n, clamped to 32-bit signed
    h = (((h << 5) + h) ^ n) | 0;
  }

  function hashStr(s: string): void {
    for (let i = 0; i < s.length; i++) {
      mix(s.charCodeAt(i));
    }
    mix(0); // null-separator between fields
  }

  function hashNum(n: number): void {
    // Encode as a fixed-length string representation for stability
    hashStr(n.toString());
  }

  function hashBool(b: boolean | undefined): void {
    // 0 = false, 1 = true, 2 = undefined — distinct values prevent collisions
    mix(b === undefined ? 2 : b ? 1 : 0);
  }

  // ── Schema anchors ──────────────────────────────────────────────────────
  hashNum(BAKED_WALL_SCHEMA_VERSION);
  hashNum(BLOCK_SIZE_MEDIUM);

  // ── Room dimensions ─────────────────────────────────────────────────────
  hashNum(json.widthBlocks);
  hashNum(json.heightBlocks);

  // ── Room-level theme and hardness ───────────────────────────────────────
  hashStr(json.blockTheme ?? '');
  hashStr(json.blockThemeId ?? '');
  hashStr(json.soundHardness ?? '');

  // ── Interior walls ──────────────────────────────────────────────────────
  hashNum(json.interiorWalls.length);
  for (const w of json.interiorWalls) {
    hashNum(w.xBlock);
    hashNum(w.yBlock);
    hashNum(w.wBlock);
    hashNum(w.hBlock);
    hashBool(w.isPlatform);
    hashStr(String(w.platformEdge ?? ''));
    hashStr(w.blockTheme ?? '');
    hashStr(w.blockThemeId ?? '');
    hashStr(String(w.rampOrientation ?? ''));
    // Must stay in lockstep with scripts/bake-room-wall-templates.mjs — a
    // mismatch would let a stale baked template survive a stairs edit.
    hashStr(String(w.stairsOrientation ?? ''));
    hashStr(String(w.roughStairOrientation ?? ''));
    hashBool(w.isPillarHalfWidth);
    hashStr(String(w.r ?? ''));
  }
  // Surface Rim style table content — two rooms with different `rimStyles`
  // tables (but coincidentally identical `r` indices) must not collide.
  hashStr(JSON.stringify(json.rimStyles ?? []));

  // Return as unsigned 32-bit hex
  const unsigned = h >>> 0;
  return unsigned.toString(16).padStart(8, '0');
}

// ── Hydration ─────────────────────────────────────────────────────────────────

/**
 * Validates a `RoomJsonBakedWallTemplate` from the room JSON and, if valid,
 * hydrates it into a `RoomWallTemplate`.
 *
 * Validation steps:
 *   1. Schema version must equal `BAKED_WALL_SCHEMA_VERSION`.
 *   2. Source hash must match `computeWallTemplateSourceHash(json)`.
 *   3. All arrays must have length equal to `wallCount`.
 *
 * Returns `undefined` on any failure and emits a DEV warning with the reason.
 * Returns the hydrated `RoomWallTemplate` on success.
 */
export function hydrateAndValidateBakedWallTemplate(
  json: RoomJsonDef,
  baked: RoomJsonBakedWallTemplate,
): RoomWallTemplate | undefined {
  const roomId = json.id;

  // ── 1. Schema version ────────────────────────────────────────────────────
  if (baked.schemaVersion !== BAKED_WALL_SCHEMA_VERSION) {
    if (import.meta.env?.DEV) {
      console.warn(
        `[wallTemplate] roomId=${roomId} source=fallback reason=schema_version` +
        ` (baked=${baked.schemaVersion} expected=${BAKED_WALL_SCHEMA_VERSION})`,
      );
    }
    return undefined;
  }

  // ── 2. Source hash ───────────────────────────────────────────────────────
  const expectedHash = computeWallTemplateSourceHash(json);
  if (baked.sourceHash !== expectedHash) {
    if (import.meta.env?.DEV) {
      console.warn(
        `[wallTemplate] roomId=${roomId} source=fallback reason=stale_hash` +
        ` (baked=${baked.sourceHash} expected=${expectedHash})`,
      );
    }
    return undefined;
  }

  // ── 3. Array lengths ─────────────────────────────────────────────────────
  const n = baked.wallCount;
  const arrays: [string, number[]][] = [
    ['xWorld', baked.xWorld],
    ['yWorld', baked.yWorld],
    ['wWorld', baked.wWorld],
    ['hWorld', baked.hWorld],
    ['isPlatformFlag', baked.isPlatformFlag],
    ['platformEdge', baked.platformEdge],
    ['themeIndex', baked.themeIndex],
    ['soundHardnessIndex', baked.soundHardnessIndex],
    ['isInvisibleFlag', baked.isInvisibleFlag],
    ['rampOrientationIndex', baked.rampOrientationIndex],
    ['isPillarHalfWidthFlag', baked.isPillarHalfWidthFlag],
    ['isIceFlag', baked.isIceFlag],
    ['isUltraIceFlag', baked.isUltraIceFlag],
    ['rimStyleIndex', baked.rimStyleIndex],
  ];
  for (const [name, arr] of arrays) {
    if (!Array.isArray(arr) || arr.length !== n) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[wallTemplate] roomId=${roomId} source=fallback reason=invalid_array` +
          ` (field=${name} length=${Array.isArray(arr) ? arr.length : 'not-array'} expected=${n})`,
        );
      }
      return undefined;
    }
  }

  // ── Hydrate into typed arrays ─────────────────────────────────────────────
  if (import.meta.env?.DEV) {
    console.log(`[wallTemplate] roomId=${roomId} source=baked wallCount=${n}`);
  }

  // ── Remap theme indices using themeNames (ensures session-order independence)
  // themeNames[i] is the theme name for local index i+3.  Re-register each
  // name via blockThemeToIndex so that the runtime Uint8Array holds the
  // current session index regardless of load order.
  let resolvedThemeIndex: Uint8Array;
  if (Array.isArray(baked.themeNames) && baked.themeNames.length > 0) {
    const remap = new Uint8Array(256);
    // Identity map for indices 0-2 (legacy) and 255 (default).
    for (let i = 0; i < 256; i++) remap[i] = i;
    for (let i = 0; i < baked.themeNames.length; i++) {
      const localIdx = i + 3;
      const name = baked.themeNames[i];
      if (name) remap[localIdx] = blockThemeToIndex(name);
    }
    resolvedThemeIndex = Uint8Array.from(baked.themeIndex, localIdx => remap[localIdx]);
  } else {
    resolvedThemeIndex = Uint8Array.from(baked.themeIndex);
  }

  // isRocketBlockFlag is not part of the baked schema (added after baking was
  // introduced) — derive it from the resolved theme index, same as gameRoomWalls
  // derives isIceFlag/isUltraIceFlag from theme at build time.
  const isRocketBlockFlag = Uint8Array.from(
    resolvedThemeIndex, idx => (indexToBlockTheme(idx) === 'rocketBlock' ? 1 : 0),
  );

  return {
    wallCount: n,
    xWorld:                Float32Array.from(baked.xWorld),
    yWorld:                Float32Array.from(baked.yWorld),
    wWorld:                Float32Array.from(baked.wWorld),
    hWorld:                Float32Array.from(baked.hWorld),
    isPlatformFlag:        Uint8Array.from(baked.isPlatformFlag),
    platformEdge:          Uint8Array.from(baked.platformEdge),
    themeIndex:            resolvedThemeIndex,
    soundHardnessIndex:    Uint8Array.from(baked.soundHardnessIndex),
    isInvisibleFlag:       Uint8Array.from(baked.isInvisibleFlag),
    rampOrientationIndex:  Uint8Array.from(baked.rampOrientationIndex),
    isPillarHalfWidthFlag: Uint8Array.from(baked.isPillarHalfWidthFlag),
    isIceFlag:             Uint8Array.from(baked.isIceFlag),
    isUltraIceFlag:        Uint8Array.from(baked.isUltraIceFlag),
    isRocketBlockFlag,
    rimStyleIndex:         Uint16Array.from(baked.rimStyleIndex),
    rimStyleTable:         (baked.rimStyles ?? []).map(decodeSurfaceRimStyle),
  };
}
