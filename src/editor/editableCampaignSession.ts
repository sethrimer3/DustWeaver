/**
 * Editable campaign session — tracks a custom campaign being authored or
 * edited in the editor.
 *
 * An EditableCampaignSession is created either from:
 *   - A brand-new blank campaign ("Create New Campaign" dialog).
 *   - A packed campaign loaded from disk for editing.
 *   - A browser-imported packed campaign.
 *
 * The session holds the authoritative campaign metadata and world-map state.
 * Pending room edits are tracked separately in EditorController.pendingRoomEdits.
 *
 * This file is intentionally kept free of DOM/browser dependencies so it can
 * be used from both the UI and future headless export utilities.
 */

import type { SavedCampaignV1, SavedCampaignMetadata } from '../levels/campaignSchema';
import type { WorldMapJsonDef, WorldMapWorldEntry, WorldMapRoomEntry } from './worldMapData';
import type { EditorRoomData } from './editorState';
import { editorRoomDataToJson } from './roomJson';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import { BUILD_NUMBER } from '../build-info';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CampaignSessionSource =
  | 'main'
  | 'packed-repo'
  | 'browser-import'
  | 'new-draft';

/**
 * An in-memory editing context for a custom campaign.
 * The editor controller owns this object for the duration of a campaign-editing
 * session. It must not be confused with (or mutate) the main campaign's
 * ROOM_REGISTRY or global world-map metadata.
 */
export interface EditableCampaignSession {
  source: CampaignSessionSource;
  /** The full packed campaign as it was when the session started (or was just created). */
  campaign: SavedCampaignV1;
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY: new blank campaign
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateNewCampaignParams {
  id: string;
  title: string;
  creator: string;
  description: string;
  initialRoomId: string;
  initialRoomWidthBlocks: number;
  initialRoomHeightBlocks: number;
  worldName: string;
}

/** Sanitizes a raw string into a safe campaign ID. */
export function sanitizeCampaignId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'my_campaign';
}

/**
 * Creates a new blank campaign session with one empty starter room.
 * The starter room has:
 *   - No interior walls
 *   - No enemies
 *   - No transitions
 *   - A centered player spawn
 *   - Default theme/background/lighting
 */
export function createNewCampaignSession(params: CreateNewCampaignParams): EditableCampaignSession {
  const safeId = sanitizeCampaignId(params.id);
  const w = Math.max(4, params.initialRoomWidthBlocks);
  const h = Math.max(4, params.initialRoomHeightBlocks);
  const spawnX = Math.floor(w / 2);
  const spawnY = Math.max(0, h - 4); // near floor, not buried

  const now = new Date().toISOString();

  const initialRoom = {
    v: 2 as const,
    id: params.initialRoomId,
    name: params.initialRoomId,
    world: 1,
    map: [0, 0] as [number, number],
    size: [w, h] as [number, number],
    spawn: [spawnX, spawnY] as [number, number],
    solids: { byTheme: {} },
  };

  const worldMap: WorldMapJsonDef = {
    worlds: [{ id: 1, name: params.worldName }],
    rooms: [{
      id: params.initialRoomId,
      name: params.initialRoomId,
      worldId: 1,
      mapX: 0,
      mapY: 0,
    }],
  };

  const meta: SavedCampaignMetadata = {
    id: safeId,
    title: params.title,
    creator: params.creator,
    description: params.description,
    initialRoomId: params.initialRoomId,
    initialRoomImagePath: null,
    // Pre-place the campaign spawn at the same position as the starter room's
    // player spawn so new campaigns export correctly without needing a manual placement.
    campaignSpawn: {
      roomId: params.initialRoomId,
      xBlock: spawnX,
      yBlock: spawnY,
    },
  };

  const campaign: SavedCampaignV1 = {
    v: 1,
    kind: 'DustWeaverCampaign',
    campaign: meta,
    worldMap,
    rooms: [initialRoom],
    editor: {
      createdWithBuild: String(BUILD_NUMBER),
      lastEditedIso: now,
    },
  };

  return { source: 'new-draft', campaign };
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY: from existing packed campaign
// ─────────────────────────────────────────────────────────────────────────────

/** Creates an editable session from an already-loaded SavedCampaignV1. */
export function createSessionFromPackedCampaign(
  campaign: SavedCampaignV1,
  source: CampaignSessionSource,
): EditableCampaignSession {
  return { source, campaign };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles a SavedCampaignV1 from the current editing state.
 * Collects all rooms from the ROOM_REGISTRY snapshot (the campaign rooms),
 * merges in pending room edits, and combines with world-map metadata and
 * campaign metadata from the session.
 *
 * @param session         The active campaign session.
 * @param pendingRoomEdits  Map of roomId → current EditorRoomData for unsaved changes.
 * @param worldMap          Current world-map snapshot from the editor.
 */
export function assembleExportCampaign(
  session: EditableCampaignSession,
  pendingRoomEdits: ReadonlyMap<string, EditorRoomData>,
  allRegistryRooms: ReadonlyMap<string, { id: string }>,
  worldMap: WorldMapJsonDef,
): SavedCampaignV1 {
  // Build a map of room id → EditorRoomData, preferring pending edits.
  // For rooms without pending edits, re-dehydrate from the original session rooms.
  const originalRoomById = new Map<string, (typeof session.campaign.rooms)[number]>();
  for (const room of session.campaign.rooms) {
    originalRoomById.set(room.id, room);
  }

  const outputRooms: (typeof session.campaign.rooms) = [];
  const handledIds = new Set<string>();

  // 1. All rooms from the registry (the live set — includes newly-added rooms).
  for (const [id] of allRegistryRooms) {
    const pending = pendingRoomEdits.get(id);
    if (pending !== undefined) {
      const jsonDef = editorRoomDataToJson(pending);
      outputRooms.push(dehydrateRoom(jsonDef));
    } else {
      // No pending edits — use the original saved room if available.
      const original = originalRoomById.get(id);
      if (original !== undefined) {
        outputRooms.push(original);
      }
      // else: room exists in registry but not in original save and not in pending edits —
      //       this means it was created from scratch without being explicitly saved.
      //       The caller should always save current room before exporting.
    }
    handledIds.add(id);
  }

  // 2. Any pending edits for rooms that are no longer in the registry (shouldn't happen
  //    normally, but be safe).
  for (const [id, data] of pendingRoomEdits) {
    if (handledIds.has(id)) continue;
    const jsonDef = editorRoomDataToJson(data);
    outputRooms.push(dehydrateRoom(jsonDef));
  }

  // Sync world-map metadata into room fields.
  const wmRoomById = new Map<string, WorldMapRoomEntry>();
  for (const r of worldMap.rooms) wmRoomById.set(r.id, r);

  const adjustedRooms = outputRooms.map(room => {
    const wm = wmRoomById.get(room.id);
    if (!wm) return room;
    return {
      ...room,
      name: wm.name,
      world: wm.worldId,
      map: [wm.mapX, wm.mapY] as [number, number],
    };
  });

  return {
    v: 1,
    kind: 'DustWeaverCampaign',
    metadata: {
      version: (() => {
        const prev = session.campaign.metadata?.version;
        return (typeof prev === 'number' && Number.isInteger(prev) && prev >= 1) ? prev + 1 : 1;
      })(),
      lastEditedAt: new Date().toISOString(),
    },
    campaign: {
      ...session.campaign.campaign,
    },
    worldMap,
    rooms: adjustedRooms,
    editor: {
      createdWithBuild: String(BUILD_NUMBER),
      lastEditedIso: new Date().toISOString(),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORLD-MAP HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a WorldMapJsonDef from the current ROOM_REGISTRY and world-map stores.
 * Used when exporting to collect the current map layout.
 */
export function buildWorldMapFromRegistry(
  worldNames: ReadonlyMap<number, string>,
  registryRooms: ReadonlyMap<string, { id: string; name: string; worldNumber: number; mapX: number; mapY: number }>,
): WorldMapJsonDef {
  const worldsMap = new Map<number, WorldMapWorldEntry>();
  const rooms: WorldMapRoomEntry[] = [];

  for (const [, room] of registryRooms) {
    if (!worldsMap.has(room.worldNumber)) {
      worldsMap.set(room.worldNumber, {
        id: room.worldNumber,
        name: worldNames.get(room.worldNumber) ?? `World ${room.worldNumber}`,
      });
    }
    rooms.push({
      id: room.id,
      name: room.name,
      worldId: room.worldNumber,
      mapX: room.mapX,
      mapY: room.mapY,
    });
  }

  const worlds = [...worldsMap.values()].sort((a, b) => a.id - b.id);
  return { worlds, rooms };
}
