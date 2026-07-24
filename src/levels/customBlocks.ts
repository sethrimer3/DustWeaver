/**
 * customBlocks.ts — Campaign-local custom block definitions, validation,
 * and ID utilities.
 *
 * A custom block is a designer-painted pixel sprite that fills a 1×1 or 2×2
 * world-tile footprint and collides as a standard solid block.
 *
 * On-disk format (stored in SavedCampaignV1.customBlockDefs[]):
 *   { schemaVersion, id, name, tileWidth, tileHeight, pixelWidth, pixelHeight,
 *     behavior, pixels }
 *
 * Room references use a namespaced ID: "custom:<id>"
 */

import { BLOCK_SIZE_SMALL } from './roomDef';
import type { CustomBlockProperties } from './customBlockProperties';
import {
  DEFAULT_CUSTOM_BLOCK_PROPERTIES,
  validateAndResolveCustomBlockProperties,
} from './customBlockProperties';

// ── Constants ────────────────────────────────────────────────────────────────

/** Current on-disk schema version written by the editor. */
export const CUSTOM_BLOCK_SCHEMA_VERSION = 2 as const;
/** Oldest schema version this build still loads (with defaults applied). */
export const CUSTOM_BLOCK_MIN_SCHEMA_VERSION = 1 as const;
export const CUSTOM_BLOCK_NAMESPACE = 'custom' as const;
export const CUSTOM_BLOCK_ID_PREFIX = 'custom:' as const;

/** Pixels per world tile (verified from BLOCK_SIZE_SMALL). */
export const CUSTOM_BLOCK_PIXELS_PER_TILE = BLOCK_SIZE_SMALL; // 8

/** Safe slug regex: lowercase letters, digits, hyphens only. */
export const CUSTOM_BLOCK_ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/** Canonical #RRGGBBAA hex color regex. */
export const RGBA_HEX_RE = /^#[0-9A-F]{8}$/;

// ── Source format (on disk / in SavedCampaignV1) ─────────────────────────────

/**
 * A single custom block definition as stored in the campaign JSON.
 *
 * schemaVersion 1 (legacy): `behavior: "solid"`, no `properties` field.
 * schemaVersion 2 (current): `properties` replaces `behavior`; the block
 * always collides/renders using the resolved property preset mapping in
 * `customBlockProperties.ts`.
 */
export interface CustomBlockSourceDefV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  tileWidth: 1 | 2;
  tileHeight: 1 | 2;
  pixelWidth: number;
  pixelHeight: number;
  behavior: 'solid';
  pixels: string[][];
}

export interface CustomBlockSourceDefV2 {
  schemaVersion: 2;
  id: string;
  name: string;
  /** Tile width: 1 or 2. */
  tileWidth: 1 | 2;
  /** Tile height: 1 or 2. */
  tileHeight: 1 | 2;
  /** Pixel width = tileWidth × CUSTOM_BLOCK_PIXELS_PER_TILE. */
  pixelWidth: number;
  /** Pixel height = tileHeight × CUSTOM_BLOCK_PIXELS_PER_TILE. */
  pixelHeight: number;
  /** Engine-defined preset properties. See customBlockProperties.ts. */
  properties: CustomBlockProperties;
  /** Exactly pixelHeight rows, each with exactly pixelWidth "#RRGGBBAA" entries. */
  pixels: string[][];
}

/** Union of all on-disk schema versions this build can parse. */
export type CustomBlockSourceDef = CustomBlockSourceDefV1 | CustomBlockSourceDefV2;

// ── Runtime validated definition ─────────────────────────────────────────────

/** Validated runtime representation of a custom block. */
export interface CustomBlockDef {
  readonly id: string;
  readonly namespacedId: string; // "custom:<id>"
  readonly name: string;
  readonly tileWidth: 1 | 2;
  readonly tileHeight: 1 | 2;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** RGBA bytes packed as Uint8ClampedArray row-major (y * w + x) * 4 */
  readonly pixelData: Uint8ClampedArray;
  /** Fully-resolved, validated property bundle (never undefined at runtime). */
  readonly properties: CustomBlockProperties;
  /**
   * In-memory-only counter bumped whenever this def's pixel data changes
   * (create/edit-with-pixel-change/duplicate/import). Never serialized —
   * exists purely so the editor UI can cheaply detect a sprite change
   * without hashing the full pixel buffer every frame (see
   * editorUISignatures.ts's computeCustomBlockRegistrySig). Absent/undefined
   * is equivalent to 0.
   */
  readonly spriteRevision?: number;
}

// ── Editor placement (in EditorRoomData) ─────────────────────────────────────

export interface EditorCustomBlockPlacement {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** "custom:<id>" */
  blockId: string;
  /** Cached tile dimensions (1 or 2) — derived from the block def at load time. */
  tileWidth: 1 | 2;
  tileHeight: 1 | 2;
}

// ── ID utilities ──────────────────────────────────────────────────────────────

/** Returns the namespaced form "custom:<id>" for a raw block ID. */
export function toNamespacedId(id: string): string {
  return `${CUSTOM_BLOCK_ID_PREFIX}${id}`;
}

/** Strips "custom:" prefix; returns null if not a custom block ID. */
export function rawIdFromNamespaced(namespacedId: string): string | null {
  if (!namespacedId.startsWith(CUSTOM_BLOCK_ID_PREFIX)) return null;
  return namespacedId.slice(CUSTOM_BLOCK_ID_PREFIX.length);
}

/** Returns true if the namespaced ID belongs to a custom block. */
export function isCustomBlockId(namespacedId: string): boolean {
  return namespacedId.startsWith(CUSTOM_BLOCK_ID_PREFIX);
}

/**
 * Converts a display name into a safe slug ID.
 * Examples: "Weathered Stone" → "weathered-stone", "My Block!" → "my-block"
 */
export function nameToSlugId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'block';
}

/**
 * Makes a slug unique given a set of already-used IDs.
 * Appends -2, -3, etc. as needed.
 */
export function makeUniqueId(base: string, usedIds: ReadonlySet<string>): string {
  if (!usedIds.has(base)) return base;
  for (let n = 2; n < 9999; n++) {
    const candidate = `${base}-${n}`;
    if (!usedIds.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

/** Returns true if the string is a valid canonical #RRGGBBAA hex color. */
export function isValidRgbaHex(color: string): boolean {
  return RGBA_HEX_RE.test(color);
}

/** Normalizes any CSS color string to canonical "#RRGGBBAA" format. */
export function normalizeColor(color: string): string | null {
  if (RGBA_HEX_RE.test(color)) return color;
  // Accept #RGB, #RGBA, #RRGGBB forms via a temporary canvas.
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return `#${hex2(d[0])}${hex2(d[1])}${hex2(d[2])}${hex2(d[3])}`;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0').toUpperCase();
}

/** Parses "#RRGGBBAA" into [r,g,b,a] bytes (0-255). Returns null on error. */
export function parseRgbaHex(color: string): [number, number, number, number] | null {
  if (!RGBA_HEX_RE.test(color)) return null;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const a = parseInt(color.slice(7, 9), 16);
  return [r, g, b, a];
}

/** Converts [r,g,b,a] bytes to "#RRGGBBAA". */
export function toRgbaHex(r: number, g: number, b: number, a: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a)}`;
}

/** Transparent pixel sentinel. */
export const TRANSPARENT_PIXEL = '#00000000' as const;

// ── Validation ────────────────────────────────────────────────────────────────

export interface CustomBlockValidationError {
  field: string;
  expected: string;
  received: string;
  blockId?: string;
  filePath?: string;
}

/**
 * Validates a raw parsed JSON object against the CustomBlockSourceDef schema.
 * Returns an array of errors. Empty means valid.
 */
export function validateCustomBlockSource(
  data: unknown,
  context?: { blockId?: string; filePath?: string },
): CustomBlockValidationError[] {
  const errors: CustomBlockValidationError[] = [];
  const ctx = context ?? {};

  function err(field: string, expected: string, received: string): void {
    errors.push({ field, expected, received, ...ctx });
  }

  if (typeof data !== 'object' || data === null) {
    err('root', 'object', String(typeof data));
    return errors;
  }

  const d = data as Record<string, unknown>;

  // schemaVersion
  const schemaVersion = d['schemaVersion'];
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    err('schemaVersion', '1 or 2', String(schemaVersion));
    return errors; // Can't continue without known version.
  }

  // id
  const id = d['id'];
  if (typeof id !== 'string' || id.length === 0) {
    err('id', 'non-empty string', String(typeof id));
  } else if (!CUSTOM_BLOCK_ID_RE.test(id)) {
    err('id', 'safe slug (a-z, 0-9, hyphen)', id);
  }

  // name
  if (typeof d['name'] !== 'string' || (d['name'] as string).trim().length === 0) {
    err('name', 'non-empty string', String(d['name']));
  }

  // tileWidth / tileHeight
  const tw = d['tileWidth'];
  const th = d['tileHeight'];
  if (tw !== 1 && tw !== 2) {
    err('tileWidth', '1 or 2', String(tw));
  }
  if (th !== 1 && th !== 2) {
    err('tileHeight', '1 or 2', String(th));
  }

  // pixelWidth / pixelHeight
  const expectedPW = typeof tw === 'number' ? tw * CUSTOM_BLOCK_PIXELS_PER_TILE : null;
  const expectedPH = typeof th === 'number' ? th * CUSTOM_BLOCK_PIXELS_PER_TILE : null;
  const pw = d['pixelWidth'];
  const ph = d['pixelHeight'];

  if (typeof pw !== 'number' || !Number.isInteger(pw) || pw <= 0) {
    err('pixelWidth', `positive integer (${String(expectedPW)})`, String(pw));
  } else if (expectedPW !== null && pw !== expectedPW) {
    err('pixelWidth', String(expectedPW), String(pw));
  }

  if (typeof ph !== 'number' || !Number.isInteger(ph) || ph <= 0) {
    err('pixelHeight', `positive integer (${String(expectedPH)})`, String(ph));
  } else if (expectedPH !== null && ph !== expectedPH) {
    err('pixelHeight', String(expectedPH), String(ph));
  }

  // behavior (schemaVersion 1 only — v2 uses `properties` instead, validated
  // separately and never fatally since it always has a safe fallback).
  if (schemaVersion === 1 && d['behavior'] !== 'solid') {
    err('behavior', '"solid"', String(d['behavior']));
  }

  // pixels
  const pixels = d['pixels'];
  if (!Array.isArray(pixels)) {
    err('pixels', 'array of rows', String(typeof pixels));
    return errors;
  }

  const numRows = typeof ph === 'number' ? ph : -1;
  const numCols = typeof pw === 'number' ? pw : -1;

  if (numRows > 0 && pixels.length !== numRows) {
    err('pixels.length', `${numRows} rows`, `${pixels.length} rows`);
  }

  for (let row = 0; row < pixels.length; row++) {
    const rowArr = pixels[row];
    if (!Array.isArray(rowArr)) {
      err(`pixels[${row}]`, 'array of color strings', String(typeof rowArr));
      continue;
    }
    if (numCols > 0 && rowArr.length !== numCols) {
      err(`pixels[${row}].length`, `${numCols} entries`, `${rowArr.length} entries`);
    }
    for (let col = 0; col < rowArr.length; col++) {
      const color = rowArr[col];
      if (typeof color !== 'string' || !isValidRgbaHex(color)) {
        err(`pixels[${row}][${col}]`, '#RRGGBBAA hex string', String(color));
        if (errors.length > 20) return errors; // Cap early for large bad files.
      }
    }
  }

  return errors;
}

/**
 * Validates and converts a raw source def into a validated CustomBlockDef.
 * Returns { ok: true, def } or { ok: false, errors }.
 */
export function parseCustomBlockSource(
  data: unknown,
  context?: { blockId?: string; filePath?: string },
): { ok: true; def: CustomBlockDef; propertyWarnings: CustomBlockValidationError[] } | { ok: false; errors: CustomBlockValidationError[] } {
  const errors = validateCustomBlockSource(data, context);
  if (errors.length > 0) return { ok: false, errors };

  const d = data as CustomBlockSourceDef;
  const pw = d.pixelWidth;
  const ph = d.pixelHeight;
  const pixelData = new Uint8ClampedArray(pw * ph * 4);

  for (let row = 0; row < ph; row++) {
    for (let col = 0; col < pw; col++) {
      const rgba = parseRgbaHex(d.pixels[row][col])!;
      const base = (row * pw + col) * 4;
      pixelData[base]     = rgba[0];
      pixelData[base + 1] = rgba[1];
      pixelData[base + 2] = rgba[2];
      pixelData[base + 3] = rgba[3];
    }
  }

  // Property resolution never fails the parse — unknown/incompatible values
  // fall back to safe defaults and are reported as diagnostics only.
  const rawProperties = d.schemaVersion === 2 ? d.properties : undefined;
  const { properties, errors: propertyWarnings } = validateAndResolveCustomBlockProperties(
    rawProperties,
    d.tileWidth,
    d.tileHeight,
    context,
  );

  return {
    ok: true,
    def: {
      id: d.id,
      namespacedId: toNamespacedId(d.id),
      name: d.name,
      tileWidth:   d.tileWidth,
      tileHeight:  d.tileHeight,
      pixelWidth:  pw,
      pixelHeight: ph,
      pixelData,
      properties,
    },
    propertyWarnings,
  };
}

/**
 * Serializes a CustomBlockDef (with current pixel edits from the editor)
 * back into a CustomBlockSourceDef ready for JSON.stringify.
 */
export function serializeCustomBlock(
  id: string,
  name: string,
  tileWidth: 1 | 2,
  tileHeight: 1 | 2,
  pixelData: Uint8ClampedArray,
  properties: CustomBlockProperties = DEFAULT_CUSTOM_BLOCK_PROPERTIES,
): CustomBlockSourceDefV2 {
  const pw = tileWidth * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const ph = tileHeight * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const pixels: string[][] = [];
  for (let row = 0; row < ph; row++) {
    const rowArr: string[] = [];
    for (let col = 0; col < pw; col++) {
      const base = (row * pw + col) * 4;
      rowArr.push(toRgbaHex(
        pixelData[base],
        pixelData[base + 1],
        pixelData[base + 2],
        pixelData[base + 3],
      ));
    }
    pixels.push(rowArr);
  }
  return {
    schemaVersion: 2,
    id,
    name,
    tileWidth,
    tileHeight,
    pixelWidth: pw,
    pixelHeight: ph,
    properties,
    pixels,
  };
}

/**
 * Builds a blank pixel data array (all transparent) for the given tile size.
 */
export function makeBlankPixelData(tileWidth: 1 | 2, tileHeight: 1 | 2): Uint8ClampedArray {
  const pw = tileWidth * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const ph = tileHeight * CUSTOM_BLOCK_PIXELS_PER_TILE;
  return new Uint8ClampedArray(pw * ph * 4);
}

// ── Placement helpers ─────────────────────────────────────────────────────────

/** Returns the tile footprint width for a namespaced ID using the registry. */
export function getBlockTileWidth(blockId: string, registry: Map<string, CustomBlockDef>): 1 | 2 {
  const rawId = rawIdFromNamespaced(blockId);
  if (rawId === null) return 1;
  return registry.get(rawId)?.tileWidth ?? 1;
}

/** Returns the tile footprint height for a namespaced ID using the registry. */
export function getBlockTileHeight(blockId: string, registry: Map<string, CustomBlockDef>): 1 | 2 {
  const rawId = rawIdFromNamespaced(blockId);
  if (rawId === null) return 1;
  return registry.get(rawId)?.tileHeight ?? 1;
}

// ── Path safety ───────────────────────────────────────────────────────────────

/** Returns true if the path is safe (relative, no escaping). */
export function isSafeCampaignRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (/^[a-zA-Z]:/.test(path)) return false; // Windows absolute path (C:\…)
  if (path.startsWith('/') || path.startsWith('\\')) return false; // Unix/UNC absolute
  if (path.startsWith('//') || path.startsWith('\\\\')) return false; // UNC \\server or //server
  if (path.includes('..')) return false; // Parent traversal
  if (/[<>"|?*]/.test(path)) return false; // Reserved path characters
  // Reject null bytes and control characters (U+0000-U+001F) without a regex literal
  for (let ci = 0; ci < path.length; ci++) {
    if (path.charCodeAt(ci) <= 0x1f) return false;
  }
  // Reject URI-like paths: anything with a scheme (letters followed by ://)
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(path)) return false;
  return true;
}

// ── Missing-texture fallback ─────────────────────────────────────────────────

/** Returns a conspicuous magenta/black checkerboard ImageData for missing blocks. */
export function makeMissingTextureData(pixelWidth: number, pixelHeight: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixelWidth * pixelHeight * 4);
  for (let row = 0; row < pixelHeight; row++) {
    for (let col = 0; col < pixelWidth; col++) {
      const base = (row * pixelWidth + col) * 4;
      const checker = (row + col) % 2 === 0;
      data[base]     = checker ? 255 : 0;
      data[base + 1] = 0;
      data[base + 2] = checker ? 255 : 0;
      data[base + 3] = 255;
    }
  }
  return data;
}

// ── Reconciliation ────────────────────────────────────────────────────────────

/** A single issue found during reconciliation. */
export interface CustomBlockReconciliationIssue {
  kind:
    | 'registry_missing_from_room_usage'   // Block in registry but never placed
    | 'room_reference_not_in_registry'     // Room references a block not in registry
    | 'duplicate_id_in_registry';          // Duplicate key (shouldn't happen with Map, for future manifest checks)
  blockId: string;
  roomIds?: string[];
  detail?: string;
}

/**
 * Reconciles registry definitions against room references.
 *
 * @param registryIds  - Set of raw block IDs in the current registry.
 * @param roomsById    - Map of roomId → list of namespaced block IDs referenced in that room.
 * @returns Array of issues; empty means consistent.
 */
export function reconcileCustomBlocks(
  registryIds: ReadonlySet<string>,
  roomsById: ReadonlyMap<string, readonly string[]>,
): CustomBlockReconciliationIssue[] {
  const issues: CustomBlockReconciliationIssue[] = [];

  // Build reverse map: rawId → rooms that reference it
  const usageMap = new Map<string, string[]>();
  for (const [roomId, blockIds] of roomsById) {
    for (const namespacedId of blockIds) {
      const rawId = namespacedId.startsWith(CUSTOM_BLOCK_ID_PREFIX)
        ? namespacedId.slice(CUSTOM_BLOCK_ID_PREFIX.length)
        : namespacedId;
      if (!usageMap.has(rawId)) usageMap.set(rawId, []);
      usageMap.get(rawId)!.push(roomId);
    }
  }

  // Find room references to blocks not in registry
  for (const [rawId, rooms] of usageMap) {
    if (!registryIds.has(rawId)) {
      issues.push({
        kind: 'room_reference_not_in_registry',
        blockId: rawId,
        roomIds: rooms,
        detail: `Block "${rawId}" is referenced in ${rooms.length} room(s) but missing from registry`,
      });
    }
  }

  // Find registry entries never placed in any room
  for (const rawId of registryIds) {
    if (!usageMap.has(rawId)) {
      issues.push({
        kind: 'registry_missing_from_room_usage',
        blockId: rawId,
        detail: `Block "${rawId}" is registered but not placed in any room`,
      });
    }
  }

  return issues;
}

/**
 * Scans all rooms for custom block placements.
 * Returns a map of rawId → array of roomIds that contain it.
 */
export function scanCustomBlockUsage(
  roomsById: ReadonlyMap<string, { customBlockPlacements?: ReadonlyArray<readonly [number, number, string]> }>,
): Map<string, string[]> {
  const usageMap = new Map<string, string[]>();
  for (const [roomId, room] of roomsById) {
    for (const [, , namespacedId] of (room.customBlockPlacements ?? [])) {
      const rawId = namespacedId.startsWith(CUSTOM_BLOCK_ID_PREFIX)
        ? namespacedId.slice(CUSTOM_BLOCK_ID_PREFIX.length)
        : namespacedId;
      if (!usageMap.has(rawId)) usageMap.set(rawId, []);
      usageMap.get(rawId)!.push(roomId);
    }
  }
  return usageMap;
}

/**
 * Returns the count of rooms where a block is placed, by scanning rawRoomsById.
 * Each room is counted once regardless of how many times the block appears there.
 */
export function countCustomBlockUsage(
  rawId: string,
  roomsById: ReadonlyMap<string, { customBlockPlacements?: ReadonlyArray<readonly [number, number, string]> }>,
): { count: number; roomIds: string[] } {
  const namespacedId = toNamespacedId(rawId);
  const roomIds: string[] = [];
  for (const [roomId, room] of roomsById) {
    const placements = room.customBlockPlacements ?? [];
    if (placements.some(([, , id]) => id === namespacedId)) {
      roomIds.push(roomId);
    }
  }
  return { count: roomIds.length, roomIds };
}
