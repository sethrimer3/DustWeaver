/**
 * roomFileCacheState.ts — Module-level state for the active campaign room-file cache.
 *
 * Extracted from roomFileLoader.ts so that the cache lifecycle (activate /
 * deactivate / query) can be reasoned about independently of the file I/O and
 * hydration logic that lives in roomFileLoader.ts.
 *
 * PUBLIC API (re-exported by roomFileLoader.ts for backward compatibility):
 *   activateCampaignRoomCache, deactivateCampaignRoomCache,
 *   isRoomFileCacheActive, isOfficialCampaignCacheActive,
 *   getActiveCampaignId, getActiveRoomAdjacency, getActiveWorldMap
 *
 * INTERNAL helpers (used only by roomFileLoader.ts):
 *   getActiveManifest, roomFilePendingLoadIds
 */

import type { RoomCacheManifest } from './roomCacheManifest';
import type { WorldMapJsonDef } from '../editor/worldMapData';

// ── State variables ───────────────────────────────────────────────────────────

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
 *
 * Stored here alongside the other cache-lifecycle state so that
 * `deactivateCampaignRoomCache` can clear it atomically.
 */
export const roomFilePendingLoadIds = new Set<string>();

// ── Cache lifecycle ───────────────────────────────────────────────────────────

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
  roomFilePendingLoadIds.clear();
}

// ── Cache query helpers ───────────────────────────────────────────────────────

/** Returns true if a room file cache is currently active (Electron only). */
export function isRoomFileCacheActive(): boolean {
  return _activeManifest !== null && _activeCampaignId !== null;
}

/**
 * Returns true if the currently active room file cache belongs to the official
 * DustWeaver campaign.
 *
 * Use this to decide whether to preserve the cache across main-menu visits:
 * the official campaign cache should remain active while the player is on the
 * main menu so that lazy loading continues to work when they press Play again.
 */
export function isOfficialCampaignCacheActive(): boolean {
  return _activeIsOfficialCampaign && _activeManifest !== null && _activeCampaignId !== null;
}

/** Returns the active campaign ID, or null if no cache is active. */
export function getActiveCampaignId(): string | null {
  return _activeCampaignId;
}

/**
 * Returns the adjacency index from the currently active room cache manifest,
 * or null if no cache is active or the manifest has no adjacency data.
 *
 * The adjacency index maps each roomId to its directly-connected neighbours as
 * recorded at export time.  Use this to seed BFS in the preload scheduler so
 * radius-2 rooms can be discovered even when intermediate rooms are not yet
 * hydrated in ROOM_REGISTRY.
 */
export function getActiveRoomAdjacency(): import('./roomCacheManifest').RoomCacheManifest['adjacency'] | null {
  return _activeManifest?.adjacency ?? null;
}

/**
 * Returns the worldMap for the currently active campaign, or null if no cache
 * is active.  Used by the preload scheduler and room-transition fallback path
 * to call `loadRoomForGameplayAsync` without passing worldMap explicitly.
 */
export function getActiveWorldMap(): WorldMapJsonDef | null {
  return _activeWorldMap;
}

/**
 * Returns the manifest for the currently active cache, or null if no cache
 * is active.
 *
 * @internal Used only by `roomFileLoader.ts` — external callers should use the
 * higher-level query helpers (`isRoomFileCacheActive`, `getActiveRoomAdjacency`,
 * etc.) or go through `loadRoomFromFileCache` / `loadRoomForGameplayAsync`.
 */
export function getActiveManifest(): RoomCacheManifest | null {
  return _activeManifest;
}

/**
 * Returns the `isOfficialCampaign` flag for the currently active cache.
 *
 * @internal Used only by `roomFileLoader.ts` when making IPC calls that require
 * the raw flag value (rather than the combined `isOfficialCampaignCacheActive`
 * predicate that also checks for a non-null manifest and campaign ID).
 */
export function getActiveIsOfficialCampaign(): boolean {
  return _activeIsOfficialCampaign;
}
