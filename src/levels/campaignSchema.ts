/**
 * Packed custom campaign schema (v1).
 *
 * A packed campaign is a single `.dwcampaign.json` file that encapsulates all
 * rooms, world-map data, and campaign metadata. It is the canonical format for
 * custom campaigns committed to the repository under ASSETS/CAMPAIGNS/CUSTOM/.
 *
 * Schema shape:
 * {
 *   "v": 1,
 *   "kind": "DustWeaverCampaign",
 *   "campaign": { id, title, creator, description, initialRoomId, ... },
 *   "worldMap": { worlds: [...], rooms: [...] },
 *   "rooms": [ SavedRoomV2, ... ],
 *   "editor": { createdWithBuild, lastEditedIso }
 * }
 *
 * Rooms are stored in the compact SavedRoomV2 format reusing the existing
 * dehydrate/hydrate pipeline. No second room format is introduced.
 */

import type { WorldMapJsonDef } from '../editor/worldMapData';
import type { SavedRoomV2 } from './roomSchemaV2';
import { isSavedRoomV2, hydrateV2Room } from './roomSchemaV2';
import { roomJsonDefToRoomDef } from './roomJsonLoader';
import type { RoomDef } from './roomDef';

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA VERSION
// ─────────────────────────────────────────────────────────────────────────────

export const SAVED_CAMPAIGN_SCHEMA_VERSION = 1 as const;
export const SAVED_CAMPAIGN_KIND = 'DustWeaverCampaign' as const;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface SavedCampaignMetadata {
  id: string;
  title: string;
  creator: string;
  description: string;
  initialRoomId: string;
  initialRoomImagePath: string | null;
}

export interface SavedCampaignEditorInfo {
  /** Build number string that last wrote this file, e.g. "283". */
  createdWithBuild: string;
  /** ISO 8601 timestamp of last edit. */
  lastEditedIso: string;
}

/** Single-file packed custom campaign, v1. */
export interface SavedCampaignV1 {
  v: 1;
  kind: 'DustWeaverCampaign';
  campaign: SavedCampaignMetadata;
  worldMap: WorldMapJsonDef;
  rooms: SavedRoomV2[];
  editor: SavedCampaignEditorInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE GUARD
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if `data` looks structurally like a SavedCampaignV1. */
export function isSavedCampaignV1(data: unknown): data is SavedCampaignV1 {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d['v'] === 1 && d['kind'] === SAVED_CAMPAIGN_KIND;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/** Regex for safe campaign IDs: letters (upper or lower), digits, underscores, hyphens. */
export const CAMPAIGN_ID_SAFE_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates a parsed JSON object against the SavedCampaignV1 schema.
 * Returns an array of human-readable error strings. Empty means valid.
 */
export function validateSavedCampaign(data: unknown): string[] {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return ['Root value must be a non-null object'];
  }
  const d = data as Record<string, unknown>;

  // Schema version check first — gives the clearest error for wrong-version files.
  if (typeof d['v'] !== 'number') {
    errors.push('Missing or non-numeric "v" (schema version) field');
  } else if (d['v'] !== 1) {
    errors.push(`Unsupported schema version ${d['v']} — expected 1. Update DustWeaver to load this campaign.`);
    // Version mismatch makes all other checks meaningless.
    return errors;
  }

  if (d['kind'] !== SAVED_CAMPAIGN_KIND) {
    errors.push(`Expected kind "${SAVED_CAMPAIGN_KIND}", got "${String(d['kind'])}"`);
  }

  // ── campaign metadata ───────────────────────────────────────────────────
  const meta = d['campaign'];
  if (typeof meta !== 'object' || meta === null) {
    errors.push('"campaign" field must be a non-null object');
  } else {
    const m = meta as Record<string, unknown>;
    if (typeof m['id'] !== 'string' || m['id'].trim().length === 0) {
      errors.push('campaign.id must be a non-empty string');
    } else if (!CAMPAIGN_ID_SAFE_RE.test(m['id'] as string)) {
      errors.push(`campaign.id "${m['id']}" contains unsafe characters — use only a-z, 0-9, _ and -`);
    }
    if (typeof m['title'] !== 'string' || m['title'].trim().length === 0) {
      errors.push('campaign.title must be a non-empty string');
    }
    if (typeof m['initialRoomId'] !== 'string' || m['initialRoomId'].trim().length === 0) {
      errors.push('campaign.initialRoomId must be a non-empty string');
    }
  }

  // ── worldMap ────────────────────────────────────────────────────────────
  const wm = d['worldMap'];
  if (typeof wm !== 'object' || wm === null) {
    errors.push('"worldMap" field must be a non-null object');
  } else {
    const w = wm as Record<string, unknown>;
    if (!Array.isArray(w['worlds'])) {
      errors.push('worldMap.worlds must be an array');
    }
    if (!Array.isArray(w['rooms'])) {
      errors.push('worldMap.rooms must be an array');
    }
  }

  // ── rooms ───────────────────────────────────────────────────────────────
  const rooms = d['rooms'];
  if (!Array.isArray(rooms)) {
    errors.push('"rooms" field must be a non-empty array');
    // Stop here — all subsequent room checks would crash.
    return errors;
  }
  if (rooms.length === 0) {
    errors.push('"rooms" array must contain at least one room');
    return errors;
  }

  const roomIds = new Set<string>();
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    if (!isSavedRoomV2(room)) {
      errors.push(`rooms[${i}] is not a valid SavedRoomV2 (missing v:2 or malformed)`);
      continue;
    }
    if (roomIds.has(room.id)) {
      errors.push(`Duplicate room id "${room.id}" at index ${i}`);
    } else {
      roomIds.add(room.id);
    }

    // Validate room dimensions.
    const [w, h] = room.size;
    if (typeof w !== 'number' || typeof h !== 'number' || w < 4 || h < 4 || w > 1024 || h > 1024) {
      errors.push(`rooms[${i}] ("${room.id}") has invalid dimensions [${w}, ${h}]`);
    }

    // Validate spawn block is within room.
    const [sx, sy] = room.spawn;
    if (!Number.isInteger(sx) || !Number.isInteger(sy)) {
      errors.push(`rooms[${i}] ("${room.id}") spawn coordinates must be integers, got [${sx},${sy}]`);
    } else if (sx < 0 || sy < 0 || sx >= w || sy >= h) {
      errors.push(`rooms[${i}] ("${room.id}") spawn [${sx},${sy}] is outside room bounds [${w}×${h}]`);
    }

    // Validate room hydrates successfully.
    try {
      hydrateV2Room(room);
    } catch (e) {
      errors.push(`rooms[${i}] ("${room.id}") failed to hydrate: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Validate initialRoomId exists in rooms.
  if (typeof meta === 'object' && meta !== null) {
    const m = meta as Record<string, unknown>;
    const initId = m['initialRoomId'];
    if (typeof initId === 'string' && initId.trim().length > 0 && !roomIds.has(initId)) {
      errors.push(`campaign.initialRoomId "${initId}" does not exist in rooms[]`);
    }
  }

  // Validate transition targetRoomIds exist in rooms.
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    if (!isSavedRoomV2(room) || !Array.isArray(room.transitions)) continue;
    for (let ti = 0; ti < room.transitions.length; ti++) {
      const tr = room.transitions[ti];
      if (typeof tr.to === 'string' && tr.to.trim().length > 0 && !roomIds.has(tr.to)) {
        errors.push(`rooms[${i}] ("${room.id}") transition[${ti}] targets unknown room "${tr.to}"`);
      }
    }
  }

  // Validate worldMap room ids correspond to real rooms where possible.
  if (Array.isArray(wm && (wm as Record<string, unknown>)['rooms'])) {
    const wmRooms = (wm as Record<string, unknown[]>)['rooms'];
    for (let i = 0; i < wmRooms.length; i++) {
      const wmRoom = wmRooms[i] as Record<string, unknown>;
      const wmRoomId = wmRoom['id'];
      if (typeof wmRoomId === 'string' && wmRoomId.trim().length > 0 && !roomIds.has(wmRoomId)) {
        errors.push(`worldMap.rooms[${i}] references unknown room "${wmRoomId}"`);
      }
    }
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// HYDRATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hydrates all rooms in a validated SavedCampaignV1 into runtime RoomDef objects.
 * Returns a Map<roomId, RoomDef>. Throws if any room fails to hydrate.
 *
 * Does NOT mutate the global ROOM_REGISTRY — call registerRoomsFromPackedCampaign
 * from rooms.ts to load this result into the registry.
 */
export function hydrateSavedCampaignToRoomDefs(campaign: SavedCampaignV1): Map<string, RoomDef> {
  const result = new Map<string, RoomDef>();

  for (const savedRoom of campaign.rooms) {
    const jsonDef = hydrateV2Room(savedRoom);
    // Overlay world map metadata so mapX/mapY/name/worldNumber come from the worldMap.
    const wmRoom = campaign.worldMap.rooms.find(r => r.id === savedRoom.id);
    if (wmRoom !== undefined) {
      jsonDef.mapX = wmRoom.mapX;
      jsonDef.mapY = wmRoom.mapY;
      jsonDef.name = wmRoom.name;
      jsonDef.worldNumber = wmRoom.worldId;
    }
    const roomDef = roomJsonDefToRoomDef(jsonDef);
    result.set(roomDef.id, roomDef);
  }

  return result;
}
