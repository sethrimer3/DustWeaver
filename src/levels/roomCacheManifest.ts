/**
 * roomCacheManifest.ts — Room cache manifest types and validation utilities.
 *
 * The room cache manifest (`manifest.json`) lives in the ROOMS/ directory
 * alongside the individual room files.  It records which room files exist,
 * their content hashes, and the campaign metadata needed to detect staleness.
 *
 * Source-of-truth hierarchy (never invert this):
 *   1. Campaign file (.dwcampaign.json) — canonical, human-shareable.
 *   2. manifest.json               — derived; tracks room-file state.
 *   3. Individual room files        — derived; generated from the campaign.
 *
 * Consequences:
 *   - Never edit room files or manifest.json manually.
 *   - Always regenerate from "Export Campaign" in the Electron editor.
 *   - If manifest is missing or stale, regenerate from the campaign file.
 */

// ── Versioning ────────────────────────────────────────────────────────────────

/**
 * Version of the room-cache manifest format.  Increment when the manifest
 * schema changes incompatibly so that old caches are detected and rebuilt.
 */
export const ROOM_CACHE_VERSION = 1 as const;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Per-room adjacency entry in the manifest adjacency index.
 *
 * This is derived preload-optimisation metadata, not editable source data.
 * Generated from each room's `SavedTransition.to` fields during export and
 * stored in `manifest.adjacency` so the preload scheduler can discover
 * radius-2 neighbours without requiring all intermediate rooms to already
 * be hydrated in ROOM_REGISTRY.
 */
export interface AdjacencyEntry {
  /** The room ID this entry describes (redundant with the key for robustness). */
  roomId: string;
  /**
   * Deduplicated list of target room IDs reachable via direct transitions.
   * Only includes room IDs that are present in `manifest.rooms`.
   */
  targets: string[];
}

/** Per-room entry stored in the manifest. */
export interface RoomCacheEntry {
  /** Room ID — matches the `id` field of the SavedRoomV2 data. */
  roomId: string;
  /** Relative path from the ROOMS directory to the room's JSON file. */
  file: string;
  /**
   * SHA-256 hash (first 16 hex chars) of the deterministic JSON serialisation
   * of the room's SavedRoomV2 content.  Computed by `computeContentHash` in
   * both `electron/main.cjs` (Node crypto) and `src/levels/roomFileLoader.ts`
   * (Web Crypto SubtleCrypto) — both must produce identical output.
   *
   * Does NOT include volatile fields like timestamps.
   */
  hash: string;
  /** ISO 8601 UTC timestamp of when this entry was last written. */
  updatedAt: string;
}

/** Full room cache manifest written alongside the individual room files. */
export interface RoomCacheManifest {
  /** Campaign ID — matches `campaign.id` in the .dwcampaign.json file. */
  campaignId: string;
  /** Human-readable campaign name for diagnostics. */
  campaignName: string;
  /**
   * SHA-256 hash (first 16 hex chars) of the full deterministic campaign
   * serialisation.  Computed from all room data and campaign metadata,
   * excluding volatile fields (exportedAt, lastEditedIso, etc.).
   *
   * This is the authoritative stale-cache check.  If this hash does not match
   * the hash recomputed from the current campaign file, the cache is stale
   * and must be regenerated — regardless of `campaignVersion`.
   */
  campaignHash: string;
  /**
   * Campaign export revision counter from `SavedCampaignRevisionMetadata.version`.
   * Monotonically increasing; 0 when the campaign lacks revision metadata.
   *
   * This is a convenience diagnostic, NOT a replacement for the hash check.
   * The system uses `campaignHash` as the primary staleness signal.  A newer
   * version with a matching hash means no game-content changes were made
   * (e.g. only volatile metadata was updated), so the cache is still valid.
   * A lower version with a matching hash should not happen in normal use, but
   * is tolerated — hash wins.
   */
  campaignVersion: number;
  /** Schema version of the campaign file (`SavedCampaignV1.v`, currently 1). */
  campaignSchemaVersion: number;
  /** Version of this manifest format (`ROOM_CACHE_VERSION`). */
  roomCacheVersion: typeof ROOM_CACHE_VERSION;
  /** ISO 8601 UTC timestamp of when this manifest was written. */
  exportedAt: string;
  /**
   * Map of roomId → per-room cache entry.
   * The Record key is the roomId string and must match `RoomCacheEntry.roomId`.
   * The redundancy is intentional: the key enables O(1) lookups, while the
   * nested field ensures the roomId is always available in the serialised entry.
   */
  rooms: Record<string, RoomCacheEntry>;
  /**
   * Optional adjacency index: maps each roomId to the set of rooms reachable
   * via its direct transitions.
   *
   * This is derived preload-optimisation metadata, not editable source data.
   * It allows the room preload scheduler to discover radius-2 neighbours
   * via BFS even when intermediate rooms have not yet been hydrated into
   * ROOM_REGISTRY.
   *
   * Generated during export from each room's `SavedTransition.to` fields.
   * Only rooms present in `manifest.rooms` appear as both keys and targets.
   *
   * **Backward-compatible:** absent in old manifests.  When missing, the
   * preload scheduler falls back to registry-only BFS (existing behaviour).
   */
  adjacency?: Record<string, AdjacencyEntry>;
}

// ── Type guard ────────────────────────────────────────────────────────────────

/** Returns `true` if `value` has the structural shape of a `RoomCacheManifest`. */
export function isRoomCacheManifest(value: unknown): value is RoomCacheManifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m['campaignId'] === 'string' &&
    typeof m['campaignHash'] === 'string' &&
    m['roomCacheVersion'] === ROOM_CACHE_VERSION &&
    typeof m['rooms'] === 'object' &&
    m['rooms'] !== null &&
    !Array.isArray(m['rooms'])
  );
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Result returned by `validateManifest`. */
export interface ManifestValidationResult {
  isValid: boolean;
  /** Human-readable reason why the manifest is invalid (absent when valid). */
  reason?: string;
}

/**
 * Checks whether a `RoomCacheManifest` is compatible with a given campaign.
 *
 * Validates:
 *  - Campaign ID matches.
 *  - Room cache version matches the current format.
 *  - Campaign hash matches (content has not changed).
 *
 * Does NOT validate that individual room files actually exist on disk — that
 * must be done separately because this function has no filesystem access.
 */
export function validateManifest(
  manifest: RoomCacheManifest,
  campaignId: string,
  campaignHash: string,
): ManifestValidationResult {
  if (manifest.campaignId !== campaignId) {
    return {
      isValid: false,
      reason: `Campaign ID mismatch: manifest has "${manifest.campaignId}", expected "${campaignId}"`,
    };
  }
  if (manifest.roomCacheVersion !== ROOM_CACHE_VERSION) {
    return {
      isValid: false,
      reason:
        `Room cache version mismatch: manifest has ${manifest.roomCacheVersion}, ` +
        `expected ${ROOM_CACHE_VERSION}`,
    };
  }
  if (manifest.campaignHash !== campaignHash) {
    return {
      isValid: false,
      reason: 'Campaign content has changed — room cache is stale and must be regenerated',
    };
  }
  return { isValid: true };
}

// ── Progress events ───────────────────────────────────────────────────────────

/**
 * Union of all export-progress event step names.
 * Emitted from the Electron main process via `dw:export-progress` IPC events
 * and consumed by the editor progress modal in the renderer.
 */
export type ExportProgressStep =
  | 'serializing'
  | 'writing-campaign'
  | 'exporting-room'
  | 'writing-manifest'
  | 'cleaning-stale'
  | 'complete'
  | 'error';

/**
 * Progress event payload sent by `dw:export-campaign-with-progress`.
 * The renderer receives these via `dustweaverElectron.onExportProgress()`.
 */
export interface ExportProgressEvent {
  step: ExportProgressStep;
  /** Human-readable message describing the current step. */
  message: string;
  /** Present during `exporting-room`: 1-based index of the room being written. */
  roomIndex?: number;
  /** Present during `exporting-room`: total number of rooms. */
  totalRooms?: number;
  /** Present during `exporting-room`: ID of the room being written. */
  roomId?: string;
  /** Present on `complete`: number of rooms whose file was not rewritten (hash match). */
  skippedRooms?: number;
  /** Present on `complete`: number of rooms whose file was written or updated. */
  writtenRooms?: number;
}
