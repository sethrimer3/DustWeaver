/**
 * roomFileLoader.ts — Room source-selection service for runtime gameplay.
 *
 * This module is the single authoritative place that decides WHERE room data
 * comes from during gameplay:
 *
 *   loadRoomForGameplay(roomId):
 *     1. Return room from ROOM_REGISTRY if already loaded.
 *     2. If a valid derived room-file cache is active (Electron only), load
 *        the room from its individual file, validate its hash, hydrate it,
 *        and register it before returning.
 *     3. Fall back to canonical ROOM_REGISTRY lookup (returns undefined when
 *        the room is missing — caller must handle the missing-room case).
 *
 * Source-of-truth hierarchy (never invert):
 *   1. Campaign file (.dwcampaign.json)   — canonical, shareable
 *   2. ROOMS/manifest.json               — derived, staleness indicator
 *   3. ROOMS/<roomId>_room.json          — derived, runtime cache
 *
 * Browser / GitHub Pages:
 *   window.dustweaverElectron is absent in browser mode.  Every Electron-
 *   specific branch is guarded by checking window.dustweaverElectron before
 *   invoking any IPC.  Browser callers get the same ROOM_REGISTRY-based
 *   behaviour they always had.
 *
 * BUILD 381
 */

import type { RoomDef } from './roomDef';
import type { SavedCampaignV1 } from './campaignSchema';
import type { RoomCacheManifest } from './roomCacheManifest';
import { validateManifest, isRoomCacheManifest } from './roomCacheManifest';
import { deterministicStringify } from '../utils/deterministicHash';
import { isSavedRoomV2, hydrateV2Room } from './roomSchemaV2';
import { roomJsonDefToRoomDef } from './roomJsonLoader';
import { ROOM_REGISTRY, registerRoom, clearRegistryAndApplyCampaignMetadata } from './rooms';
import type { WorldMapJsonDef } from '../editor/worldMapData';

// ── SHA-256 content hash ──────────────────────────────────────────────────────

/**
 * Computes the same 16-character SHA-256 hex hash as `computeContentHash` in
 * `electron/main.cjs`.  Uses the Web Crypto API (SubtleCrypto) which is
 * available in all modern browsers and in the Electron renderer process.
 *
 * NOTE: This must stay algorithmically in sync with `computeContentHash` in
 * `electron/main.cjs`.  Both serialize `value` using `deterministicStringify`
 * (which is itself a duplicate of the same function in main.cjs), hash the
 * result with SHA-256, and return the first 16 hex characters.
 * See docs/campaign-room-cache-architecture.md for details.
 *
 * Exported so that the browser ZIP export path (editorExport.ts) can compute
 * room and campaign hashes without duplicating the implementation.
 */
export async function computeContentHash(value: unknown): Promise<string> {
  const text = deterministicStringify(value);
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ── Module-level cache state ──────────────────────────────────────────────────

/** Manifest for the currently active room file cache. Null = no cache active. */
let _activeManifest: RoomCacheManifest | null = null;
/** Campaign ID of the currently active cache. Null = no cache active. */
let _activeCampaignId: string | null = null;
/** Whether the active cache belongs to the official campaign. */
let _activeIsOfficialCampaign = false;
/**
 * worldMap for the currently active campaign.  Stored here so that
 * `loadRoomForGameplayAsync` can be called without passing worldMap explicitly
 * (e.g. from the preload scheduler or room-transition fallback path).
 *
 * Set when the room cache is activated and cleared when it is deactivated.
 */
let _activeWorldMap: WorldMapJsonDef | null = null;

/**
 * Room IDs whose lazy load is currently in-flight.  Used to avoid firing
 * duplicate IPC calls when the player stands in a transition zone for more
 * than one frame before the room data arrives.
 */
const _pendingLoadIds = new Set<string>();

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns the Electron IPC API if available. Absent in browser/GitHub Pages mode.
 * All Electron-specific branches MUST use this guard.
 */
function getElectronApi(): (typeof window)['dustweaverElectron'] {
  return typeof window !== 'undefined' ? window.dustweaverElectron : undefined;
}

/**
 * Computes the stable content hash for a campaign, excluding volatile fields
 * (timestamps in `editor` and `metadata`).  Must produce the same result as
 * `computeCampaignHash` in `electron/main.cjs` — both use `deterministicStringify`
 * then SHA-256 (first 16 hex chars).
 *
 * NOTE: `deterministicStringify` in `src/utils/deterministicHash.ts` and in
 * `electron/main.cjs` are intentional duplicates (main.cjs cannot import
 * TypeScript directly).  They must produce identical output for the same input.
 * `computeContentHash` here mirrors `computeContentHash` in main.cjs exactly
 * (deterministicStringify → SHA-256 → first 16 hex chars).
 * See docs/campaign-room-cache-architecture.md for details.
 */
export async function computeCampaignHashForValidation(campaign: SavedCampaignV1): Promise<string> {
  return computeContentHash({
    v: campaign.v,
    kind: campaign.kind,
    campaign: campaign.campaign,
    worldMap: campaign.worldMap,
    rooms: campaign.rooms,
    // Intentionally excluded: campaign.editor (lastEditedIso) and
    // campaign.metadata (lastEditedAt) — these are volatile timestamps.
  });
}

// ── Cache state management ────────────────────────────────────────────────────

/**
 * Activates the room file cache for a given campaign.
 * Called after successfully validating or generating a manifest.
 *
 * @param manifest            The validated room cache manifest.
 * @param campaignId          The campaign ID.
 * @param isOfficialCampaign  Whether this is the built-in DustWeaver campaign.
 * @param worldMap            The campaign's worldMap — stored so that
 *                            `loadRoomForGameplayAsync` can be called without
 *                            an explicit worldMap argument (e.g. from the
 *                            preload scheduler).  Pass `undefined` only when
 *                            the worldMap is guaranteed to be supplied at every
 *                            `loadRoomForGameplayAsync` call site.
 */
export function activateCampaignRoomCache(
  manifest: RoomCacheManifest,
  campaignId: string,
  isOfficialCampaign: boolean,
  worldMap?: WorldMapJsonDef,
): void {
  _activeManifest = manifest;
  _activeCampaignId = campaignId;
  _activeIsOfficialCampaign = isOfficialCampaign;
  _activeWorldMap = worldMap ?? null;
}

/**
 * Deactivates the room file cache.
 * Called when returning from a custom campaign session to the main menu.
 */
export function deactivateCampaignRoomCache(): void {
  _activeManifest = null;
  _activeCampaignId = null;
  _activeIsOfficialCampaign = false;
  _activeWorldMap = null;
  _pendingLoadIds.clear();
}

/** Returns true if a room file cache is currently active (Electron only). */
export function isRoomFileCacheActive(): boolean {
  return _activeManifest !== null && _activeCampaignId !== null;
}

/**
 * Returns the worldMap for the currently active campaign, or null if no cache
 * is active.  Used by the preload scheduler and room-transition fallback path
 * to call `loadRoomForGameplayAsync` without passing worldMap explicitly.
 */
export function getActiveWorldMap(): WorldMapJsonDef | null {
  return _activeWorldMap;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Reads and validates the room cache manifest for the given campaign.
 *
 * Returns:
 *   { isValid: true,  manifest }   — cache is fresh; use room files.
 *   { isValid: false, manifest?, reason } — cache is missing or stale.
 *
 * Never throws — all errors are caught and returned as isValid: false.
 */
export async function validateCampaignRoomCache(
  campaign: SavedCampaignV1,
  isOfficialCampaign: boolean,
): Promise<{ isValid: boolean; manifest: RoomCacheManifest | null; reason: string }> {
  const electronApi = getElectronApi();
  if (electronApi === undefined) {
    return { isValid: false, manifest: null, reason: 'Not running in Electron' };
  }

  const campaignId = campaign.campaign.id;
  let result: Awaited<ReturnType<typeof electronApi.readRoomCacheManifest>>;
  try {
    result = await electronApi.readRoomCacheManifest(campaignId, isOfficialCampaign);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { isValid: false, manifest: null, reason: `IPC error reading manifest: ${msg}` };
  }

  if (!result.ok || result.manifest === undefined) {
    return {
      isValid: false,
      manifest: null,
      reason: result.error ?? 'Manifest file not found or unreadable',
    };
  }

  if (!isRoomCacheManifest(result.manifest)) {
    return { isValid: false, manifest: null, reason: 'Manifest has invalid or unknown structure' };
  }

  const manifest = result.manifest as RoomCacheManifest;
  const campaignHash = await computeCampaignHashForValidation(campaign);
  const validation = validateManifest(manifest, campaignId, campaignHash);

  if (!validation.isValid) {
    return { isValid: false, manifest, reason: validation.reason ?? 'Validation failed' };
  }

  // Verify that every file listed in the manifest actually exists on disk.
  // Missing files would cause delayed runtime failures during lazy loading;
  // better to detect them here and trigger full regeneration now.
  // This check is Electron-only — browser mode has no filesystem access.
  if (electronApi.validateRoomCacheFiles !== undefined) {
    let filesResult: Awaited<ReturnType<NonNullable<typeof electronApi.validateRoomCacheFiles>>>;
    try {
      filesResult = await electronApi.validateRoomCacheFiles(campaignId, isOfficialCampaign);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Non-fatal: log the error and treat cache as invalid so it regenerates.
      return { isValid: false, manifest, reason: `IPC error validating room files: ${msg}` };
    }
    if (!filesResult.ok) {
      return {
        isValid: false,
        manifest,
        reason: filesResult.error ?? 'Room cache file validation failed',
      };
    }
  }

  return { isValid: true, manifest, reason: '' };
}

// ── Cache generation ──────────────────────────────────────────────────────────

/**
 * Generates (or regenerates) the room cache for a campaign using the existing
 * `exportCampaignWithProgress` IPC, then re-reads and returns the resulting
 * manifest.
 *
 * Callers may supply an `onStatusUpdate` callback to receive human-readable
 * progress messages.  A full progress modal is connected through the existing
 * `onExportProgress` IPC; `onStatusUpdate` is a lightweight text-only hook
 * for callers that want status text without the full modal UI.
 *
 * Returns the resulting manifest on success, or null on failure.
 * Never throws — all errors are caught and returned as null.
 */
export async function generateCampaignRoomCache(
  campaign: SavedCampaignV1,
  isOfficialCampaign: boolean,
  onStatusUpdate?: (message: string) => void,
): Promise<RoomCacheManifest | null> {
  const electronApi = getElectronApi();
  if (electronApi === undefined) return null;

  onStatusUpdate?.('Generating room cache…');

  let exportResult: Awaited<ReturnType<typeof electronApi.exportCampaignWithProgress>>;
  try {
    exportResult = await electronApi.exportCampaignWithProgress(campaign, { isOfficialCampaign });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[roomFileLoader] Cache generation IPC error:', msg);
    onStatusUpdate?.(`Cache generation failed: ${msg}`);
    return null;
  }

  if (!exportResult.ok) {
    console.warn('[roomFileLoader] Cache generation failed:', exportResult.error);
    onStatusUpdate?.(`Cache generation failed: ${exportResult.error ?? 'unknown error'}`);
    return null;
  }

  onStatusUpdate?.('Room cache generated. Verifying…');

  // Re-read the manifest to get the freshly-written version for validation.
  const campaignId = campaign.campaign.id;
  let manifestResult: Awaited<ReturnType<typeof electronApi.readRoomCacheManifest>>;
  try {
    manifestResult = await electronApi.readRoomCacheManifest(campaignId, isOfficialCampaign);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[roomFileLoader] Failed to re-read manifest after generation:', msg);
    return null;
  }

  if (!manifestResult.ok || manifestResult.manifest === undefined) {
    console.warn('[roomFileLoader] Manifest missing after generation:', manifestResult.error);
    return null;
  }

  if (!isRoomCacheManifest(manifestResult.manifest)) {
    console.warn('[roomFileLoader] Generated manifest has invalid structure');
    return null;
  }

  const manifest = manifestResult.manifest as RoomCacheManifest;
  const campaignHash = await computeCampaignHashForValidation(campaign);
  const validation = validateManifest(manifest, campaignId, campaignHash);
  if (!validation.isValid) {
    console.warn('[roomFileLoader] Generated manifest still invalid:', validation.reason);
    return null;
  }

  onStatusUpdate?.('Room cache ready.');
  return manifest;
}

// ── Startup room loading from file cache ──────────────────────────────────────

/**
 * Ensures the room file cache is valid for the given campaign.
 *
 * Algorithm:
 *   1. Validate existing manifest.
 *   2. If valid: activate the cache and return the manifest.
 *   3. If invalid/missing: attempt to generate the cache, then validate again.
 *   4. If generation fails or the new manifest is still invalid: log a warning
 *      and return null (caller should fall back to packed campaign).
 *
 * Pass `onStatusUpdate` to receive status messages for display in a loading
 * screen.  Full export progress is available via `electronApi.onExportProgress`
 * and can be connected to the existing `ExportProgressModal` if needed.
 *
 * Returns the validated manifest on success, or null on failure.
 * Browser mode (no dustweaverElectron) always returns null immediately.
 */
export async function ensureCampaignRoomCache(
  campaign: SavedCampaignV1,
  isOfficialCampaign: boolean,
  onStatusUpdate?: (message: string) => void,
): Promise<RoomCacheManifest | null> {
  const electronApi = getElectronApi();
  if (electronApi === undefined) return null; // Browser mode — not supported.

  onStatusUpdate?.('Checking room cache…');
  const { isValid, manifest, reason } = await validateCampaignRoomCache(campaign, isOfficialCampaign);

  if (isValid && manifest !== null) {
    onStatusUpdate?.('Room cache is up to date.');
    activateCampaignRoomCache(manifest, campaign.campaign.id, isOfficialCampaign, campaign.worldMap);
    return manifest;
  }

  // Cache is missing or stale — regenerate it.
  console.warn(
    `[roomFileLoader] Room cache missing or stale for campaign "${campaign.campaign.id}": ${reason}. ` +
    'Regenerating…',
  );
  onStatusUpdate?.(`Generating room cache (${reason})…`);

  const generatedManifest = await generateCampaignRoomCache(campaign, isOfficialCampaign, onStatusUpdate);
  if (generatedManifest === null) {
    console.warn(
      `[roomFileLoader] Cache generation failed for "${campaign.campaign.id}". ` +
      'Falling back to packed campaign data.',
    );
    return null;
  }

  activateCampaignRoomCache(generatedManifest, campaign.campaign.id, isOfficialCampaign, campaign.worldMap);
  return generatedManifest;
}

// ── Room hydration from file data ─────────────────────────────────────────────

/**
 * Hydrates a raw room-file payload (SavedRoomV2 shape) into a `RoomDef`,
 * applying world-map metadata overlay from the campaign's worldMap.
 *
 * `roomData` is typed as `unknown` because it arrives from IPC (JSON parse)
 * and must be validated by `isSavedRoomV2` before use.  Callers must NOT
 * cast to `SavedRoomV2` before passing — let this function do the guard.
 *
 * Returns null if the data is invalid or hydration fails.
 */
function hydrateRoomFileData(
  roomData: unknown,
  worldMap: WorldMapJsonDef,
): RoomDef | null {
  if (!isSavedRoomV2(roomData)) {
    console.warn('[roomFileLoader] Room file data is not a valid SavedRoomV2');
    return null;
  }
  try {
    const jsonDef = hydrateV2Room(roomData);
    // Overlay world-map metadata (mapX, mapY, name, worldNumber) so that rooms
    // loaded from individual files have the same metadata as rooms loaded from
    // the packed campaign's worldMap section.
    const wmEntry = worldMap.rooms.find(r => r.id === roomData.id);
    if (wmEntry !== undefined) {
      jsonDef.mapX = wmEntry.mapX;
      jsonDef.mapY = wmEntry.mapY;
      jsonDef.name = wmEntry.name;
      jsonDef.worldNumber = wmEntry.worldId;
    }
    return roomJsonDefToRoomDef(jsonDef);
  } catch (e) {
    console.warn('[roomFileLoader] Failed to hydrate room data:', e);
    return null;
  }
}

// ── Startup: populate ROOM_REGISTRY from file cache ───────────────────────────

/**
 * Populates ROOM_REGISTRY from the derived room file cache in a single batch
 * IPC call.  Validates each room's content hash against the manifest before
 * registering it.  Rooms that fail hash validation are skipped with a warning
 * and will be absent from the registry (caller should fall back to the packed
 * campaign for any missing rooms).
 *
 * @param campaign            The packed campaign (for worldMap metadata overlay
 *                            and world-name registration).
 * @param manifest            The validated room cache manifest.
 * @param campaignId          The campaign ID (for IPC path resolution).
 * @param isOfficialCampaign  Whether to use the official campaign path.
 *
 * @returns  `true` if ALL rooms in the manifest were successfully loaded and
 *           registered.  `false` if any rooms were skipped (hash mismatch,
 *           read error, or hydration failure) — caller may fall back to the
 *           packed campaign.
 *
 * NEVER throws — all errors are caught and returned as `false`.
 *
 * NOTE: This function clears ROOM_REGISTRY (via `clearRegistryAndApplyCampaignMetadata`)
 * before loading rooms.  Do not call it while gameplay is running.
 */
export async function populateRegistryFromRoomFiles(
  campaign: SavedCampaignV1,
  manifest: RoomCacheManifest,
  campaignId: string,
  isOfficialCampaign: boolean,
): Promise<boolean> {
  const electronApi = getElectronApi();
  if (electronApi === undefined) return false;

  // Clear the registry and apply world-map metadata (world names) from the
  // campaign.  Individual rooms are then registered as they are read from files.
  clearRegistryAndApplyCampaignMetadata(campaign);

  let batchResult: Awaited<ReturnType<typeof electronApi.readAllRoomFiles>>;
  try {
    batchResult = await electronApi.readAllRoomFiles(campaignId, isOfficialCampaign);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[roomFileLoader] Failed to read room files batch:', msg);
    return false;
  }

  if (!batchResult.ok || batchResult.rooms === undefined) {
    console.warn('[roomFileLoader] readAllRoomFiles failed:', batchResult.error);
    return false;
  }

  const expectedRoomCount = Object.keys(manifest.rooms).length;
  const receivedRooms = batchResult.rooms;
  let registeredCount = 0;
  let skippedCount = 0;

  for (const { roomId, data, expectedHash } of receivedRooms) {
    // Validate content hash before using the file data.
    const actualHash = await computeContentHash(data);
    if (actualHash !== expectedHash) {
      console.warn(
        `[roomFileLoader] Room "${roomId}": hash mismatch ` +
        `(expected ${expectedHash}, got ${actualHash}). Skipping.`,
      );
      skippedCount++;
      continue;
    }

    const roomDef = hydrateRoomFileData(data, campaign.worldMap);
    if (roomDef === null) {
      console.warn(`[roomFileLoader] Room "${roomId}": hydration failed. Skipping.`);
      skippedCount++;
      continue;
    }

    registerRoom(roomDef);
    registeredCount++;
  }

  console.log(
    `[roomFileLoader] Loaded ${registeredCount}/${expectedRoomCount} rooms from file cache ` +
    `(${skippedCount} skipped).`,
  );

  // Return true only if every expected room was loaded successfully.
  return skippedCount === 0 && registeredCount === expectedRoomCount;
}

// ── Runtime: single-room file loading ─────────────────────────────────────────

/**
 * Loads a single room from its derived room file.
 *
 * Used by `loadRoomForGameplayAsync` for lazy per-room loading during gameplay:
 * rooms are loaded on demand as the player approaches them rather than all
 * at startup.  The preload scheduler calls `loadRoomForGameplayAsync` for
 * adjacent rooms in idle time, so rooms are typically ready before a transition
 * fires.
 *
 * Returns null if the file cache is not active, the room is not in the manifest,
 * the file cannot be read, the hash mismatches, or hydration fails.
 * Never throws.
 */
export async function loadRoomFromFileCache(
  roomId: string,
  worldMap: WorldMapJsonDef,
): Promise<RoomDef | null> {
  const electronApi = getElectronApi();
  if (electronApi === undefined || _activeManifest === null || _activeCampaignId === null) {
    return null;
  }

  const entry = _activeManifest.rooms[roomId];
  if (entry === undefined) {
    console.warn(`[roomFileLoader] Room "${roomId}" is not in the active manifest.`);
    return null;
  }

  let result: Awaited<ReturnType<typeof electronApi.readRoomFile>>;
  try {
    result = await electronApi.readRoomFile(_activeCampaignId, roomId, _activeIsOfficialCampaign);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[roomFileLoader] IPC error reading room "${roomId}":`, msg);
    return null;
  }

  if (!result.ok || result.roomData === undefined) {
    console.warn(`[roomFileLoader] Failed to read room "${roomId}":`, result.error);
    return null;
  }

  // Validate content hash before using the data.
  const actualHash = await computeContentHash(result.roomData);
  if (result.expectedHash !== undefined && actualHash !== result.expectedHash) {
    console.warn(
      `[roomFileLoader] Room "${roomId}" hash mismatch ` +
      `(expected ${result.expectedHash}, got ${actualHash}). File may be corrupted.`,
    );
    return null;
  }

  return hydrateRoomFileData(result.roomData, worldMap);
}

// ── Primary gameplay API ──────────────────────────────────────────────────────

/**
 * Returns the `RoomDef` for `roomId` using the best available source:
 *
 *   1. ROOM_REGISTRY (already in memory — the fast synchronous path).
 *      In gameplay mode, rooms are placed here either from the packed campaign
 *      at startup, or lazily via `loadRoomForGameplayAsync` (file cache or
 *      packed campaign fallback).
 *
 * This synchronous overload returns `undefined` when the room is absent.
 * The caller (`gameTransitions.ts`) handles missing rooms by triggering a lazy
 * load via `loadRoomForGameplayAsync` when the file cache is active.
 *
 * For lazy-loaded rooms the data path is:
 *   file → IPC → `hydrateRoomFileData` → registerRoom → ROOM_REGISTRY → this function
 */
export function loadRoomForGameplay(roomId: string): RoomDef | undefined {
  return ROOM_REGISTRY.get(roomId);
}

/**
 * Asynchronous variant of `loadRoomForGameplay` that also attempts to load
 * the room from the file cache if it is not already in ROOM_REGISTRY.
 *
 * Used by the preload scheduler and the room-transition fallback path to
 * pre-populate ROOM_REGISTRY before (or when) a room transition fires.
 *
 * `worldMap` is optional: if omitted the function uses the worldMap stored
 * when the cache was activated (see `activateCampaignRoomCache`).  Pass it
 * explicitly when calling from a context that already has the worldMap (e.g.
 * startup code); omit it from the preload scheduler and transition fallback
 * where only the roomId is available.
 *
 * Deduplicates concurrent loads: if a load for `roomId` is already in-flight,
 * this call returns `undefined` immediately rather than firing a second IPC
 * request.  The room will be in ROOM_REGISTRY by the time the in-flight load
 * completes.
 *
 * Returns the `RoomDef` on success, or `undefined` when neither the registry
 * nor the file cache has the room.
 */
export async function loadRoomForGameplayAsync(
  roomId: string,
  worldMap?: WorldMapJsonDef,
): Promise<RoomDef | undefined> {
  const existing = ROOM_REGISTRY.get(roomId);
  if (existing !== undefined) return existing;

  // Deduplicate concurrent in-flight loads for the same room.
  if (_pendingLoadIds.has(roomId)) {
    return undefined;
  }

  // Resolve worldMap: use the stored active worldMap if not explicitly provided.
  const map = worldMap ?? _activeWorldMap;
  if (map === null) {
    // No worldMap available — file-cache loading is not possible.
    // This is expected in browser mode or before a campaign has been activated.
    if (import.meta.env.DEV) {
      console.debug(
        `[roomFileLoader] loadRoomForGameplayAsync("${roomId}"): ` +
        'no worldMap available (browser mode or no active campaign). Returning undefined.',
      );
    }
    return undefined;
  }

  _pendingLoadIds.add(roomId);
  try {
    // Room is not in registry — try the file cache.
    const roomDef = await loadRoomFromFileCache(roomId, map);
    if (roomDef !== null) {
      registerRoom(roomDef);
      if (import.meta.env.DEV) {
        // ROOM_REGISTRY grows lazily; each entry here was loaded on demand
        // rather than at startup.  The registry is never actively evicted —
        // rooms accumulate as the player explores.  For typical campaign sizes
        // (~80 rooms) this is not a memory concern.
        console.debug(
          `[roomFileLoader] Lazy-loaded "${roomId}". ` +
          `ROOM_REGISTRY now has ${ROOM_REGISTRY.size} room(s) (no eviction).`,
        );
      }
      return roomDef;
    }
  } finally {
    _pendingLoadIds.delete(roomId);
  }

  return undefined;
}
