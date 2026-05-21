# Campaign Room-Cache Architecture

> Last updated: BUILD 381

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

### How gameplay chooses between room files and canonical campaign data (BUILD 381)

When a custom packed campaign is launched for play in **Electron**:

```
game.ts (customCampaignPlay path)
│
├─ await source.loadPackedCampaign()          ← parse .dwcampaign.json
│                                              (always needed for metadata)
├─ ensureCampaignRoomCache(campaign, false)   ← validate or generate cache
│    │
│    ├─ validateCampaignRoomCache()           ← read manifest, compute hash
│    │    ├─ dw:read-room-cache-manifest IPC
│    │    └─ compute SHA-256 campaign hash → compare to manifest.campaignHash
│    │
│    ├─ if cache valid ──────────────────────→ return manifest
│    │
│    └─ if cache stale/missing:
│         exportCampaignWithProgress IPC      ← regenerate all room files
│         re-read manifest → validate
│
└─ if manifest returned:
│    populateRegistryFromRoomFiles()          ← load ALL rooms from files
│    │    dw:read-all-room-files IPC (single batch call)
│    │    for each room: validate SHA-256 hash → hydrateV2Room → roomJsonDefToRoomDef
│    │    registerRoom() for each
│    └─ ROOM_REGISTRY now populated from derived files ✓
│
└─ if manifest null (IPC failure, hash mismatch, etc.):
     registerRoomsFromPackedCampaign()        ← fall back to parsed packed campaign
```

In **Browser / GitHub Pages** mode, `window.dustweaverElectron` is absent.
`ensureCampaignRoomCache` returns `null` immediately and the packed campaign
path is always used.  Browser behaviour is identical to BUILD 380.

### Room transition data path (Electron, valid cache)

During gameplay, room transitions call `ROOM_REGISTRY.get(roomId)` synchronously.
Since all rooms were loaded from derived room files at startup, every room
transition reads data that originated from a derived room file.  The
`loadRoomForGameplay(roomId)` function in `roomFileLoader.ts` is the canonical
entry point for this lookup.

### Adjacent room preloading

The existing `roomPreloadScheduler.ts` (BFS idle-time preloader) handles geometry
precomputation (`RoomWallTemplate`, `EdgeExtensionCache`) for adjacent rooms.
Since all rooms are eagerly loaded into ROOM_REGISTRY at startup, there is no
additional data-preloading step required for room transitions.

The `loadRoomForGameplayAsync(roomId, worldMap)` function in `roomFileLoader.ts`
provides lazy per-room loading from the file cache for future use cases where
not all rooms are loaded at startup (e.g. very large campaigns).

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
| `src/levels/roomFileLoader.ts` | **NEW** Source-selection service: `ensureCampaignRoomCache`, `populateRegistryFromRoomFiles`, `loadRoomForGameplay` |
| `src/editor/editorExport.ts` | `exportMainCampaignJson()`, `exportCampaignJson()`, Electron progress helper |
| `src/editor/editorExportProgressModal.ts` | DOM progress modal shown during Electron export |
| `electron/main.cjs` | `dw:export-campaign-with-progress`, `dw:read-room-cache-manifest`, `dw:read-room-file`, `dw:read-all-room-files` IPC handlers |
| `electron/preload.cjs` | Exposes all IPC channels to the renderer |
| `src/electron.d.ts` | TypeScript types for all Electron IPC surface |
| `src/screens/roomRuntimeCache.ts` | In-memory geometry cache for precomputed wall templates |
| `src/screens/roomPreloadScheduler.ts` | BFS idle-time preloader for nearby rooms (geometry only) |

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

1. **Official campaign room cache not yet wired.**  The official DustWeaver
   campaign (`initRoomRegistry()` in `rooms.ts`) still loads from the packed
   campaign file.  The same `ensureCampaignRoomCache` + `populateRegistryFromRoomFiles`
   pipeline can be applied there once the official campaign has a stable room
   cache on disk.

2. **No lazy per-room loading during gameplay.**  All rooms are loaded at startup
   (either from files or from the packed campaign).  `loadRoomForGameplayAsync`
   in `roomFileLoader.ts` provides the infrastructure for future lazy loading
   if startup time becomes a concern for very large campaigns.

3. **Progress UI during first-load cache generation.**  Currently a minimal status
   overlay is shown.  Full progress bar UI can be connected via
   `electronApi.onExportProgress` / `offExportProgress` — the same infrastructure
   used by the editor export modal — without further changes to the IPC layer.

4. **Custom campaign edit mode.**  The `customCampaignEdit` path in `game.ts`
   still calls `registerRoomsFromPackedCampaign` directly.  Room file validation
   is not needed there because the editor always reads from the canonical campaign
   session object.


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

### Current behaviour (BUILD 380)

The runtime always loads rooms from the source that was available at build/startup time:

| Campaign type | Source |
|---------------|--------|
| Official DustWeaver campaign | TypeScript-bundled `ROOM_REGISTRY` (fastest; no I/O) |
| Folder-based campaign | `ROOMS/*.json` files via `loadRoomJsonFiles()` (Vite glob, browser fetch) |
| Packed custom campaign | Parsed from `.dwcampaign.json` at startup (all rooms hydrated) |

After the initial load, `roomRuntimeCache` and `roomPreloadScheduler` precompute
wall templates and edge-extension caches for nearby rooms in idle time.

### Cache validation at startup (planned next step)

For Electron + packed custom campaigns, a future pass will:

1. Call `dw:read-room-cache-manifest` to read `manifest.json`.
2. Compute `campaignHash` from the loaded campaign.
3. Compare against `manifest.campaignHash`.
4. If **valid**: load rooms lazily from individual room files via
   `dw:read-room-file` IPC (avoids reparsing the full campaign on each
   room transition).
5. If **invalid or absent**: regenerate the room cache from the campaign file
   (same export pipeline as the editor, but triggered automatically).

This will be implemented when the Electron-packaged custom campaign use case
is prioritised.

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

---

## Key Source Files

| File | Role |
|------|------|
| `src/utils/deterministicHash.ts` | FNV-1a hash + deterministic JSON stringify (renderer-side) |
| `src/levels/roomCacheManifest.ts` | `RoomCacheManifest` types, `validateManifest()`, `ExportProgressEvent` |
| `src/editor/editorExport.ts` | `exportMainCampaignJson()`, `exportCampaignJson()`, Electron progress helper |
| `src/editor/editorExportProgressModal.ts` | DOM progress modal shown during Electron export |
| `electron/main.cjs` | `dw:export-campaign-with-progress`, `dw:read-room-cache-manifest` IPC handlers |
| `electron/preload.cjs` | Exposes `exportCampaignWithProgress`, `onExportProgress`, `offExportProgress`, `readRoomCacheManifest` |
| `src/electron.d.ts` | TypeScript types for all Electron IPC surface |
| `src/screens/roomRuntimeCache.ts` | In-memory geometry cache for precomputed wall templates |
| `src/screens/roomPreloadScheduler.ts` | BFS idle-time preloader for nearby rooms |

---

## Adding a New Campaign

### Via Electron editor

1. Create a new campaign in the editor.
2. Click **Export Campaign**.
3. The full `.dwcampaign.json` file and all derived room files are written to
   `userData/CUSTOM_CAMPAIGNS/<id>/`.

### Via file share

1. Recipient places `<campaign>.dwcampaign.json` in the custom campaigns folder.
2. On first load, the game detects missing room cache and generates it
   (planned — see "Runtime Room Loading" above).
3. Subsequent loads use the cached room files for faster startup.

---

## Backward Compatibility

- Old campaigns that have no `manifest.json` will load normally (no crash).
- Old `manifest.json` files that are arrays of room ID strings are detected and
  treated as "no manifest" — the cache will be regenerated on next export.
- The `dw:save-official-campaign` IPC channel is retained for backward
  compatibility; `dw:export-campaign-with-progress` is preferred for new code.

---

## Security Notes

- All campaign IDs passed through IPC are validated against `SAFE_CAMPAIGN_ID_RE`
  (`/^[a-zA-Z0-9_-]+$/`) before being used in filesystem paths.  This prevents
  path traversal attacks from malicious campaign names.
- Room IDs are similarly validated against `SAFE_ROOM_ID_RE`.
- Hashes are used for cache invalidation only; they are not cryptographically
  secure and must not be relied upon for authentication.
