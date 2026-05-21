# Campaign Room-Cache Architecture

> Last updated: BUILD 382

## Overview

DustWeaver uses a **two-tier file architecture** for campaign data:

| Tier | File | Status | Description |
|------|------|--------|-------------|
| 1 | `<campaign>.dwcampaign.json` | **Canonical** | The full packed campaign; single shareable source of truth |
| 2 | `ROOMS/*.json` + `ROOMS/manifest.json` | **Derived cache** | Generated from the campaign file; never edited by hand |

The campaign file is the only file users ever need to share.  All derived files
are regenerated automatically when needed.

---

## Principles

1. **Never treat room files as editable source files.**  Room files are artifacts
   generated from the campaign file.  If they diverge, the campaign file wins.

2. **Stale-cache detection via content hash.**  A SHA-256 hash of the full
   campaign content (excluding volatile timestamps) is stored in `manifest.json`.
   At load time the hash is recomputed and compared; any mismatch triggers
   regeneration.

3. **Selective room updates.**  Only rooms whose per-room hash changed are
   rewritten.  Unchanged room files are skipped so a small edit to one room
   does not rewrite all 80+ room files.

4. **Progress is visible.**  In Electron editor mode the export UI shows a
   live progress modal ("Exporting room 12 / 84: Marble Cavern") so users
   always know what is happening and how long it will take.

5. **Browser / GitHub Pages is never broken.**  All Electron-specific code is
   guarded behind `if (window.dustweaverElectron !== undefined)`.  Browser
   users get the same download-based export they always had.

6. **Derived files are preferred at runtime when valid.**  In Electron, once the
   room cache is validated, rooms are loaded from the individual derived room
   files instead of reparsing the full packed campaign.  This keeps the data
   path clean and future-proofs lazy per-room loading.

---

## File Locations

### Official DustWeaver campaign (Electron dev build)
```
<repo>/
  ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/
    DustweaverCampaign.dwcampaign.json  ← canonical
    ROOMS/
      manifest.json                     ← enhanced manifest (derived)
      lobby_room.json                   ← derived room file
      ...
```

### Official campaign (Electron packaged build)
```
userData/
  CAMPAIGNS/DUSTWEAVER_CAMPAIGN/
    DustweaverCampaign.dwcampaign.json
    ROOMS/
      manifest.json
      ...
```

### Custom campaigns (Electron)
```
userData/
  CUSTOM_CAMPAIGNS/<campaign-id>/
    <campaign-id>.dwcampaign.json      ← canonical
    ROOMS/
      manifest.json                    ← derived
      room_0_0_room.json               ← derived
      ...
```

---

## Manifest Format

`ROOMS/manifest.json` — written by every export, never edited by hand:

```json
{
  "campaignId": "DUSTWEAVER_CAMPAIGN",
  "campaignName": "DustWeaver",
  "campaignHash": "a3f2bc7e1d405c90",
  "campaignVersion": 7,
  "campaignSchemaVersion": 1,
  "roomCacheVersion": 1,
  "exportedAt": "2026-05-20T12:00:00.000Z",
  "rooms": {
    "lobby": {
      "roomId": "lobby",
      "file": "lobby_room.json",
      "hash": "b4c91f2d3e087a56",
      "updatedAt": "2026-05-20T12:00:00.000Z"
    }
  }
}
```

Fields:

| Field | Description |
|-------|-------------|
| `campaignHash` | SHA-256 (first 16 hex chars) of the deterministic JSON of the campaign data (rooms, worldMap, campaign metadata). Excludes `lastEditedIso`, `exportedAt`, and other volatile timestamps. |
| `campaignVersion` | Monotonic revision counter from `SavedCampaignV1.metadata.version`. |
| `roomCacheVersion` | Version of the manifest format itself (currently `1`). Increment when the schema changes incompatibly. |
| `rooms[id].hash` | SHA-256 of the deterministic JSON of the individual `SavedRoomV2` room data. |

### Legacy manifest format

Older exports wrote `manifest.json` as a plain JSON array of room ID strings.
The loader detects this format and falls back gracefully — it will not validate
room hashes but will not crash.

---

## Export Flow (Electron editor)

When the user clicks **Export Campaign** in the Electron editor:

```
Renderer                               Main Process (IPC)
   │                                         │
   ├─ assembleExportCampaign()               │
   ├─ createExportProgressModal(uiRoot)       │
   ├─ electronApi.onExportProgress(cb)        │
   ├─ electronApi.exportCampaignWithProgress ─►
   │                                         ├─ Validate payload
   │  ◄─ { step: 'serializing', ... }        │
   │  ◄─ { step: 'writing-campaign', ... }   ├─ Write .dwcampaign.json
   │  ◄─ { step: 'exporting-room', ... }     ├─ For each room:
   │    (repeated N times)                   │    compute hash
   │                                         │    skip if unchanged
   │                                         │    else write _room.json
   │  ◄─ { step: 'writing-manifest', ... }   ├─ Write manifest.json
   │  ◄─ { step: 'cleaning-stale', ... }     ├─ Remove orphan files
   │  ◄─ { step: 'complete', ... }           │
   │                                         ◄─ return { ok, campaignDir }
   ├─ electronApi.offExportProgress()         │
   └─ modal auto-dismisses after 2 s         │
```

Progress status text examples:

- `"Serializing campaign…"`
- `"Writing campaign file…"`
- `"Exporting room 12 / 84: Marble Cavern"`
- `"Writing room manifest…"`
- `"Cleaning up stale files…"`
- `"Export complete — 5 room(s) written, 79 unchanged"`

---

## Export Flow (Browser / GitHub Pages)

The browser path is unchanged from BUILD 301:

1. `assembleExportCampaign()` builds the `SavedCampaignV1` object.
2. `JSON.stringify(exported, null, 2)` serialises it.
3. A Blob URL download is triggered.

No room files or manifest are written in browser mode — the user downloads a
single `.dwcampaign.json` file and must commit it to the repo themselves.

---

## Runtime Room Loading

### Gameplay startup (BUILD 382 — lazy loading)

**Gameplay mode** no longer eagerly loads all rooms at startup when a valid
room file cache exists.  Both the official campaign and custom campaigns now
use lazy loading in Electron:

```
startup
│
├─ Fetch packed campaign file               ← always needed for metadata
├─ ensureCampaignRoomCache()               ← validate or generate file cache
│
├─ if file cache valid (Electron):
│    applyOfficialCampaignMetadata()       ← set revision metadata + spawn
│    clearRegistryAndApplyCampaignMetadata()
│    │   Populates world names + map positions from campaign.worldMap
│    │   Registry is EMPTY at this point
│    └─ loadRoomForGameplayAsync(startRoomId)
│         Loads ONLY the start room from the derived room file.
│         Adjacent rooms are loaded lazily by the preload scheduler.
│
└─ if file cache unavailable (browser, IPC failure, etc.):
     initRoomRegistry() / registerRoomsFromPackedCampaign()
     ← full eager load as before (all rooms at startup)
```

**Editor mode** is unaffected: it calls `initRoomRegistry()` and
`registerRoomsFromPackedCampaign()` directly.  Room files are derived
artifacts, not editable source files.

### Official campaign (Electron, valid cache)

`main.ts` now:
1. Fetches the official packed campaign (for metadata).
2. Calls `ensureCampaignRoomCache(campaign, true)` — validates or regenerates
   the derived room file cache.
3. If a valid manifest is returned, calls `applyOfficialCampaignMetadata` +
   `clearRegistryAndApplyCampaignMetadata` + `loadRoomForGameplayAsync(startRoomId)`.
4. Starts the game with ONLY the start room in ROOM_REGISTRY.
5. Falls back to `initRoomRegistry()` (full eager load) if anything fails.

### Custom campaign (Electron, valid cache)

`game.ts` now:
1. Calls `ensureCampaignRoomCache(campaign, false)`.
2. If a valid manifest is returned, calls `clearRegistryAndApplyCampaignMetadata` +
   `loadRoomForGameplayAsync(startRoomId)`.
3. Falls back to `registerRoomsFromPackedCampaign(campaign)` if anything fails.

### Browser / GitHub Pages

`window.dustweaverElectron` is absent.  The file-cache path is skipped.
`initRoomRegistry()` / `registerRoomsFromPackedCampaign()` are used as before.
All rooms are loaded at startup (unchanged behaviour).

### Room transition lazy loading

When the player triggers a room transition:

1. `gameTransitions.ts` calls `ROOM_REGISTRY.get(targetRoomId)`.
2. **If the room is in the registry**: transition fires immediately (as before).
3. **If the room is NOT in the registry and file cache is active**:
   - `loadRoomForGameplayAsync(targetRoomId)` is called (fire-and-forget).
   - A clear warning is logged: _"Room X not yet loaded — triggering urgent
     lazy load. Transition will fire next frame."_
   - The transition does NOT fire this frame.
   - On the NEXT frame (once the async load resolves and registers the room),
     the transition check fires again and succeeds.
   - This produces a ≤1-frame delay, invisible to the player in practice since
     the preload scheduler loads adjacent rooms ahead of time.
4. **If the room is NOT in the registry and file cache is inactive**:
   - Same warning as before: "transition points to missing room".

### Adjacent room preloading (lazy-load mode)

`roomPreloadScheduler.ts` now accepts an optional `loadRoomAsync` callback
(set to `loadRoomForGameplayAsync` when the file cache is active):

```
After each room load:
│
scheduleRoomPreloads(currentRoom, ..., loadRoomAsync)
│
BFS discovers adjacent rooms (radius 1 and 2 via transitions).
│
For each nearby roomId:
  ├─ if in ROOM_REGISTRY and wall template cached: skip (already done)
  ├─ if in ROOM_REGISTRY but not wall-cached: build templates in idle time
  └─ if NOT in ROOM_REGISTRY and loadRoomAsync provided:
       void loadRoomAsync(roomId)  ← fire-and-forget IPC
       roomId re-added to work queue
       next idle tick: room is now in registry → build wall templates
```

Result: radius-1 and radius-2 rooms are loaded from file cache and have
wall templates built before the player can normally reach them.

### In-memory room cache behaviour

Rooms are stored in `ROOM_REGISTRY` once loaded.  There is no active eviction:
rooms accumulate in memory as the player explores.  For typical campaign sizes
(~80 rooms) this is not a concern.  The registry grows lazily (one room per
transition visit or preload), rather than all at once at startup.

The existing `RoomRuntimeCache` (wall templates + edge extensions) is a
bounded LRU with 10 slots — unchanged.

### How gameplay chooses between room files and canonical campaign data (Electron)

```
ROOM_REGISTRY.get(roomId)
  │
  ├─ hit: return RoomDef (already loaded — from file cache or packed campaign)
  └─ miss:
       loadRoomForGameplayAsync(roomId)
         │
         ├─ file cache active: loadRoomFromFileCache → IPC → validate hash →
         │    hydrateRoomFileData → registerRoom → return RoomDef
         └─ file cache inactive: return undefined
              (caller handles missing room or falls back to packed campaign)
```

---

## Custom Campaign First-Load Cache Generation

When a user opens a custom `.dwcampaign.json` for play in Electron and no valid
room cache exists:

1. `ensureCampaignRoomCache` is called with the parsed campaign.
2. If the manifest is absent or stale, `generateCampaignRoomCache` triggers
   `dw:export-campaign-with-progress` IPC (the same pipeline used by the editor).
3. A minimal status `<div>` overlay ("Generating room cache…") is shown during
   generation.  Full progress bar UI can be connected in a future pass via the
   existing `electronApi.onExportProgress` event stream.
4. After generation, the manifest is re-read and validated.
5. If validation still fails (e.g. disk full), a warning is logged and the game
   falls back to the packed campaign.

Opening a newer version of a custom campaign (bumped `metadata.version` or
changed room content) triggers a hash mismatch, which causes the cache to be
regenerated before gameplay starts.

---

## Stale Cache Detection

The cache is considered stale (needs regeneration) if any of the following are true:

| Check | Reason |
|-------|--------|
| `manifest.json` is absent | First run after placing a new campaign file |
| `manifest.campaignId !== campaign.id` | Wrong campaign |
| `manifest.roomCacheVersion !== ROOM_CACHE_VERSION` | Manifest format changed |
| `manifest.campaignHash !== computedHash(campaign)` | Campaign content changed |
| A room file listed in `manifest.rooms` is absent | Partial export or manual deletion |

The `validateManifest()` function in `src/levels/roomCacheManifest.ts` implements
all checks except file-existence (which requires filesystem access).

Per-room hash validation is performed in `populateRegistryFromRoomFiles()` in
`roomFileLoader.ts` when rooms are read from files at startup.

---

## deterministicStringify Duplication

Two copies of `deterministicStringify` exist intentionally:

| File | Context | Notes |
|------|---------|-------|
| `src/utils/deterministicHash.ts` | TypeScript renderer / browser | ES module, imported by game code |
| `electron/main.cjs` | Node.js CommonJS main process | Cannot import TS source directly |

Both produce identical output for the same input (sorted object keys,
preserved array order, JSON primitives, `undefined` omitted).

**Why both exist:** The Electron main process runs as CommonJS and cannot use
`import()` to load TypeScript source at runtime.  A bundled version of the
TypeScript file is not available to main.cjs either (Vite bundles the renderer,
not main.cjs).  The duplication is therefore unavoidable without a non-trivial
build-system change.

**How to keep them in sync:** The comment at the top of each copy names the
other.  If the algorithm changes in one, update the other immediately.
The room-hash values stored in `manifest.json` are computed by main.cjs (Node
SHA-256) and validated by `roomFileLoader.ts` (SubtleCrypto SHA-256) — if they
diverge the manifest will be considered stale on every startup.

Similarly, `computeContentHash` in `main.cjs` and the local `computeContentHash`
in `src/levels/roomFileLoader.ts` are intentional mirrors.  Both do:
`deterministicStringify(value)` → SHA-256 → first 16 hex chars.

---

## Key Source Files

| File | Role |
|------|------|
| `src/utils/deterministicHash.ts` | Deterministic JSON stringify + FNV-1a hash (renderer-side) |
| `src/levels/roomCacheManifest.ts` | `RoomCacheManifest` types, `validateManifest()`, `ExportProgressEvent` |
| `src/levels/roomFileLoader.ts` | Source-selection service: `ensureCampaignRoomCache`, `activateCampaignRoomCache` (stores worldMap), `loadRoomForGameplayAsync` (lazy per-room load, worldMap optional), `isRoomFileCacheActive`, `getActiveWorldMap` |
| `src/levels/rooms.ts` | `clearRegistryAndApplyCampaignMetadata` (populates world names + map positions), `applyOfficialCampaignMetadata` (sets revision metadata without touching registry) |
| `src/main.ts` | Official campaign startup: Electron → file cache → lazy start room; Browser → `initRoomRegistry()` |
| `src/game.ts` | Custom campaign play: Electron → file cache → lazy start room; Browser → `registerRoomsFromPackedCampaign()` |
| `src/editor/editorExport.ts` | `exportMainCampaignJson()`, `exportCampaignJson()`, Electron progress helper |
| `src/editor/editorExportProgressModal.ts` | DOM progress modal shown during Electron export |
| `electron/main.cjs` | `dw:export-campaign-with-progress`, `dw:read-room-cache-manifest`, `dw:read-room-file`, `dw:read-all-room-files` IPC handlers |
| `electron/preload.cjs` | Exposes all IPC channels to the renderer |
| `src/electron.d.ts` | TypeScript types for all Electron IPC surface |
| `src/screens/roomRuntimeCache.ts` | In-memory geometry cache for precomputed wall templates |
| `src/screens/roomPreloadScheduler.ts` | BFS idle-time preloader for nearby rooms; in lazy mode also loads room DATA via `loadRoomAsync` callback |
| `src/screens/gameTransitions.ts` | Room transition trigger; in lazy mode calls `loadRoomForGameplayAsync` when target room is missing |

---

## Adding a New Campaign

### Via Electron editor

1. Create a new campaign in the editor.
2. Click **Export Campaign**.
3. The full `.dwcampaign.json` file and all derived room files are written to
   `userData/CUSTOM_CAMPAIGNS/<id>/`.

### Via file share

1. Recipient places `<campaign>.dwcampaign.json` in the custom campaigns folder.
2. On first play (Electron), `ensureCampaignRoomCache` detects the missing/stale
   manifest and triggers automatic regeneration before gameplay starts.
3. Subsequent loads use the derived room files for room loading.

---

## Backward Compatibility

- Old campaigns that have no `manifest.json` will load normally (the cache will
  be generated on first play in Electron; browser mode is unaffected).
- Old `manifest.json` files that are arrays of room ID strings are detected and
  treated as "no manifest" — the cache will be regenerated.
- The `dw:save-official-campaign` IPC channel is retained for backward
  compatibility; `dw:export-campaign-with-progress` is preferred for new code.

---

## Security Notes

- All campaign IDs passed through IPC are validated against `SAFE_CAMPAIGN_ID_RE`
  (`/^[a-zA-Z0-9_-]+$/`) before being used in filesystem paths.  This prevents
  path traversal attacks from malicious campaign names.
- Room IDs are similarly validated against `SAFE_ROOM_ID_RE`.
- Room file paths from the manifest are validated to stay within the `ROOMS/`
  directory before reading (path traversal guard in `dw:read-room-file` and
  `dw:read-all-room-files`).
- Hashes are used for cache invalidation only; they are not cryptographically
  secure and must not be relied upon for authentication.

---

## Known Limitations / Next Steps

1. **No active room eviction.**  Rooms accumulate in `ROOM_REGISTRY` as the
   player explores.  For very large campaigns (200+ rooms) this could become
   a memory concern.  An LRU eviction strategy can be added to `ROOM_REGISTRY`
   in a future pass — keep current room and last N recently-visited rooms,
   evict far-away rooms.  The `roomPreloadScheduler` will re-load evicted
   rooms before the player reaches them.

2. **Progress UI during first-load cache generation.**  Currently a minimal
   status overlay is shown.  Full progress bar UI can be connected via
   `electronApi.onExportProgress` / `offExportProgress` — the same
   infrastructure used by the editor export modal — without further changes
   to the IPC layer.

3. **Custom campaign edit mode.**  The `customCampaignEdit` path in `game.ts`
   still calls `registerRoomsFromPackedCampaign` directly.  Room file
   validation is not needed there because the editor always reads from the
   canonical campaign session object.  This is correct and intentional.

4. **BFS depth limited by loaded rooms.**  The preload scheduler can only
   discover radius-2 rooms through already-loaded rooms.  If a campaign has
   long unvisited chains, deeper rooms won't be discovered until the player
   loads the intermediate rooms.  This is acceptable for typical campaign
   layouts where radius-1 rooms are always loaded before the player reaches
   radius-2 rooms.

