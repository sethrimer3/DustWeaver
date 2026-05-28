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

// ── Schema version ────────────────────────────────────────────────────────────

/**
 * Bump this when the baked template format or wall-geometry algorithm changes.
 * Mismatches cause a safe fallback to `buildRoomWallTemplate()`.
 */
export const BAKED_WALL_SCHEMA_VERSION = 1;

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
    hashStr(w.soundHardness ?? '');
    hashStr(String(w.rampOrientation ?? ''));
    hashBool(w.isPillarHalfWidth);
  }

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
    if (import.meta.env.DEV) {
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
    if (import.meta.env.DEV) {
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
  ];
  for (const [name, arr] of arrays) {
    if (!Array.isArray(arr) || arr.length !== n) {
      if (import.meta.env.DEV) {
        console.warn(
          `[wallTemplate] roomId=${roomId} source=fallback reason=invalid_array` +
          ` (field=${name} length=${Array.isArray(arr) ? arr.length : 'not-array'} expected=${n})`,
        );
      }
      return undefined;
    }
  }

  // ── Hydrate into typed arrays ─────────────────────────────────────────────
  if (import.meta.env.DEV) {
    console.log(`[wallTemplate] roomId=${roomId} source=baked wallCount=${n}`);
  }

  return {
    wallCount: n,
    xWorld:                Float32Array.from(baked.xWorld),
    yWorld:                Float32Array.from(baked.yWorld),
    wWorld:                Float32Array.from(baked.wWorld),
    hWorld:                Float32Array.from(baked.hWorld),
    isPlatformFlag:        Uint8Array.from(baked.isPlatformFlag),
    platformEdge:          Uint8Array.from(baked.platformEdge),
    themeIndex:            Uint8Array.from(baked.themeIndex),
    soundHardnessIndex:    Uint8Array.from(baked.soundHardnessIndex),
    isInvisibleFlag:       Uint8Array.from(baked.isInvisibleFlag),
    rampOrientationIndex:  Uint8Array.from(baked.rampOrientationIndex),
    isPillarHalfWidthFlag: Uint8Array.from(baked.isPillarHalfWidthFlag),
    isIceFlag:             Uint8Array.from(baked.isIceFlag),
    isUltraIceFlag:        Uint8Array.from(baked.isUltraIceFlag),
  };
}
