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
 *   "metadata": { "version": 1, "lastEditedAt": "2026-05-15T21:42:00.000Z" },
 *   "campaign": { id, title, creator, description, initialRoomId, ... },
 *   "worldMap": { worlds: [...], rooms: [...] },
 *   "rooms": [ SavedRoomV2, ... ],
 *   "editor": { createdWithBuild, lastEditedIso }
 * }
 *
 * The `metadata` field is optional for backward compatibility — older
 * .dwcampaign.json files without it will still load successfully.
 *
 * Rooms are stored in the compact SavedRoomV2 format reusing the existing
 * dehydrate/hydrate pipeline. No second room format is introduced.
 */

import type { WorldMapJsonDef } from '../editor/worldMapData';
import type { SavedRoomV2 } from './roomSchemaV2';
import { isSavedRoomV2, hydrateV2Room } from './roomSchemaV2';
import { roomJsonDefToRoomDef } from './roomJsonLoader';
import type { RoomDef } from './roomDef';
import type { CustomBlockSourceDef } from './customBlocks';
import { stringToParticleKind } from '../editor/roomJsonSchema';
import { WEAVE_REGISTRY } from '../sim/weaves/weaveDefinition';
import { PASSIVE_TECHNIQUE_DEFINITIONS, PassiveTechniqueId } from '../progression/passiveTechniques';

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA VERSION
// ─────────────────────────────────────────────────────────────────────────────

export const SAVED_CAMPAIGN_SCHEMA_VERSION = 1 as const;
export const SAVED_CAMPAIGN_KIND = 'DustWeaverCampaign' as const;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Campaign-level spawn point — the single location where the player starts the
 * campaign (as opposed to room-local playerSpawnBlock which is a per-room fallback).
 * Optional; absent in older campaigns and in campaigns that have not had a
 * Campaign Spawn marker placed yet.
 */
export interface CampaignSpawnData {
  /** ID of the room in which the campaign starts. */
  roomId: string;
  /** Block X coordinate within that room. */
  xBlock: number;
  /** Block Y coordinate within that room. */
  yBlock: number;
  /**
   * Optional starting dust-mote count for the player at campaign start.
   * Defines both the initial mote count and the campaign's baseline mote capacity,
   * without upper clamping (0 is a legal value). Undefined defaults to standard capacity (10).
   */
  startingHealth?: number;
  /**
   * Optional starting number of dust containers.
   * Each container adds 4 capacity for dust particles. Clamped to >= 0.
   */
  startingDustContainerCount?: number;
  /**
   * Optional list of collectible dust type names the player starts with.
   * Names must match the string keys in the ParticleKind name map
   * (e.g., "Golden", "Ice", "Void", "FireDust" for the equippable fire mote —
   * note "Fire" alone refers to the internal lava/ember VFX kind, not the
   * equippable Fire Dust mote).
   * Unknown names are silently ignored.
   */
  startingDustTypes?: string[];
  /**
   * Optional list of weave IDs unlocked at campaign start
   * (e.g., "storm", "shield", "arrow").
   * Unknown IDs are silently ignored.
   */
  startingWeaves?: string[];
  /**
   * Optional list of passive technique IDs unlocked at campaign start
   * (e.g., "cycle"). Unknown IDs are silently ignored.
   */
  startingPassives?: string[];
}

export interface SavedCampaignMetadata {
  id: string;
  title: string;
  creator: string;
  description: string;
  initialRoomId: string;
  initialRoomImagePath: string | null;
  /**
   * Campaign-level singleton spawn point placed in the editor.
   * When present, takes precedence over initialRoomId + room playerSpawnBlock.
   * Optional for backward compatibility — older campaigns without it fall back
   * to initialRoomId + that room's playerSpawnBlock.
   */
  campaignSpawn?: CampaignSpawnData;
}

export interface SavedCampaignEditorInfo {
  /** Build number string that last wrote this file, e.g. "283". */
  createdWithBuild: string;
  /** ISO 8601 timestamp of last edit. */
  lastEditedIso: string;
}

/**
 * Export revision metadata written by the editor on every packed campaign export.
 * `version` increments each time the campaign is exported; `lastEditedAt` is an
 * ISO 8601 UTC timestamp of the export moment.
 *
 * This field is optional — older campaigns without it will still load.
 */
export interface SavedCampaignRevisionMetadata {
  /** Monotonically increasing export revision counter. Starts at 1. */
  version: number;
  /** ISO 8601 UTC timestamp of when this export was produced. */
  lastEditedAt: string;
}

/** Single-file packed custom campaign, v1. */
export interface SavedCampaignV1 {
  v: 1;
  kind: 'DustWeaverCampaign';
  /** Optional export revision metadata. Absent in campaigns exported before BUILD 317. */
  metadata?: SavedCampaignRevisionMetadata;
  campaign: SavedCampaignMetadata;
  worldMap: WorldMapJsonDef;
  rooms: SavedRoomV2[];
  editor: SavedCampaignEditorInfo;
  /**
   * Optional inline custom block definitions for this campaign.
   * Absent in campaigns without custom blocks — older campaigns load unchanged.
   * Each entry is a fully self-contained CustomBlockSourceDef.
   */
  customBlockDefs?: CustomBlockSourceDef[];
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

  // ── revision metadata (optional — absent in older exports) ─────────────
  const revMeta = d['metadata'];
  if (revMeta !== undefined) {
    if (typeof revMeta !== 'object' || revMeta === null) {
      errors.push('"metadata" field must be a non-null object when present');
    } else {
      const rm = revMeta as Record<string, unknown>;
      if (typeof rm['version'] !== 'number' || !Number.isInteger(rm['version']) || rm['version'] < 1) {
        errors.push('metadata.version must be a positive integer when present');
      }
      if (typeof rm['lastEditedAt'] !== 'string') {
        errors.push('metadata.lastEditedAt must be a string when present');
      }
    }
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

  // ── campaignSpawn ───────────────────────────────────────────────────────
  if (typeof meta === 'object' && meta !== null) {
    const m = meta as Record<string, unknown>;
    const spawn = m['campaignSpawn'];
    if (spawn !== undefined) {
      if (typeof spawn !== 'object' || spawn === null) {
        errors.push('campaignSpawn must be a non-null object when present');
      } else {
        const s = spawn as Record<string, unknown>;
        const roomId = s['roomId'];
        let spawnRoom: SavedRoomV2 | null = null;
        if (typeof roomId !== 'string' || roomId.trim().length === 0) {
          errors.push('campaignSpawn.roomId must be a non-empty string');
        } else if (!roomIds.has(roomId)) {
          errors.push(`campaignSpawn.roomId "${roomId}" does not exist in rooms[]`);
        } else {
          spawnRoom = rooms.find((r: unknown) => isSavedRoomV2(r) && r.id === roomId) as SavedRoomV2 ?? null;
        }

        const xBlock = s['xBlock'];
        const yBlock = s['yBlock'];
        if (typeof xBlock !== 'number' || !Number.isInteger(xBlock)) {
          errors.push('campaignSpawn.xBlock must be a finite integer');
        }
        if (typeof yBlock !== 'number' || !Number.isInteger(yBlock)) {
          errors.push('campaignSpawn.yBlock must be a finite integer');
        }
        if (spawnRoom !== null && typeof xBlock === 'number' && Number.isInteger(xBlock) &&
            typeof yBlock === 'number' && Number.isInteger(yBlock)) {
          const [rw, rh] = spawnRoom.size;
          if (xBlock < 0 || xBlock >= rw) {
            errors.push(`campaignSpawn.xBlock ${xBlock} out of room bounds [0, ${rw})`);
          }
          if (yBlock < 0 || yBlock >= rh) {
            errors.push(`campaignSpawn.yBlock ${yBlock} out of room bounds [0, ${rh})`);
          }
        }

        for (const [field, val] of [
          ['startingHealth', s['startingHealth']],
          ['startingDustContainerCount', s['startingDustContainerCount']],
        ] as const) {
          if (val !== undefined && (typeof val !== 'number' || !Number.isInteger(val) || val < 0)) {
            errors.push(`campaignSpawn.${field} must be a non-negative integer when present`);
          }
        }

        function validateIdArray(field: string, val: unknown, isKnown: (id: string) => boolean): void {
          if (val === undefined) return;
          if (!Array.isArray(val)) {
            errors.push(`campaignSpawn.${field} must be an array when present`);
            return;
          }
          const seen = new Set<string>();
          for (const item of val) {
            if (typeof item !== 'string') {
              errors.push(`campaignSpawn.${field} must contain only strings`);
              continue;
            }
            if (seen.has(item)) {
              errors.push(`campaignSpawn.${field} contains duplicate id "${item}"`);
              continue;
            }
            seen.add(item);
            if (!isKnown(item)) {
              errors.push(`campaignSpawn.${field} contains unknown id "${item}"`);
            }
          }
        }

        validateIdArray('startingDustTypes', s['startingDustTypes'], id => {
          // Recognized legacy/internal names remain structurally loadable so
          // old campaigns reach the starting-options sanitizer. The editor
          // emits only DUST_KIND_OPTIONS, and application grants only the
          // equippable kinds (see EQUIPPABLE_KINDS in sim/particles/kinds.ts).
          return stringToParticleKind(id) !== null;
        });
        validateIdArray('startingWeaves', s['startingWeaves'], id => WEAVE_REGISTRY.has(id));
        validateIdArray('startingPassives', s['startingPassives'], id => PASSIVE_TECHNIQUE_DEFINITIONS.has(id as PassiveTechniqueId));
      }
    }
  }

  return errors;
}

/**
 * Fast top-level validation for campaign import/load paths.
 * This intentionally avoids full per-room hydration/transition validation so
 * large campaigns can be indexed and edited without blocking.
 */
export function validateSavedCampaignTopLevel(data: unknown): string[] {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null) {
    return ['Root value must be a non-null object'];
  }
  const d = data as Record<string, unknown>;

  if (d['kind'] !== SAVED_CAMPAIGN_KIND) {
    errors.push(`Expected kind "${SAVED_CAMPAIGN_KIND}", got "${String(d['kind'])}"`);
  }
  if (d['v'] !== 1) {
    errors.push(`Unsupported schema version ${String(d['v'])} — expected 1.`);
  }

  const campaign = d['campaign'];
  const initialRoomId = (
    typeof campaign === 'object' &&
    campaign !== null &&
    typeof (campaign as Record<string, unknown>)['initialRoomId'] === 'string'
  )
    ? ((campaign as Record<string, unknown>)['initialRoomId'] as string).trim()
    : '';

  if (initialRoomId.length === 0) {
    errors.push('campaign.initialRoomId must be a non-empty string');
  }

  const rooms = d['rooms'];
  if (!Array.isArray(rooms)) {
    errors.push('"rooms" field must be an array');
    return errors;
  }

  const roomIds = new Set<string>();
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    if (typeof room !== 'object' || room === null) {
      errors.push(`rooms[${i}] must be an object`);
      continue;
    }
    const id = (room as Record<string, unknown>)['id'];
    if (typeof id !== 'string' || id.trim().length === 0) {
      errors.push(`rooms[${i}].id must be a non-empty string`);
      continue;
    }
    if (roomIds.has(id)) {
      errors.push(`Duplicate room id "${id}" at index ${i}`);
      continue;
    }
    roomIds.add(id);
  }

  if (initialRoomId.length > 0 && !roomIds.has(initialRoomId)) {
    errors.push(`campaign.initialRoomId "${initialRoomId}" does not exist in rooms[]`);
  }

  if (typeof campaign === 'object' && campaign !== null) {
    const spawn = (campaign as Record<string, unknown>)['campaignSpawn'];
    if (spawn !== undefined && typeof spawn === 'object' && spawn !== null) {
      const spawnRoomId = (spawn as Record<string, unknown>)['roomId'];
      if (typeof spawnRoomId !== 'string' || spawnRoomId.trim().length === 0) {
        errors.push('campaignSpawn.roomId must be a non-empty string');
      } else if (!roomIds.has(spawnRoomId)) {
        errors.push(`campaignSpawn.roomId "${spawnRoomId}" does not exist in rooms[]`);
      }
    }
  }

  return errors;
}

/**
 * Returns the room ID where gameplay should start for a campaign.
 *
 * Priority:
 * 1. `campaign.campaignSpawn.roomId` — the explicit campaign spawn room.
 * 2. `campaign.initialRoomId` — the fallback initial room.
 *
 * Used by both `main.ts` (official campaign) and `game.ts` (custom campaign)
 * to determine which room to load first during lazy-loading startup.
 */
export function getCampaignStartRoomId(campaign: SavedCampaignV1): string {
  return campaign.campaign.campaignSpawn?.roomId ?? campaign.campaign.initialRoomId;
}



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
