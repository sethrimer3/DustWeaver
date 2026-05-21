# Campaign Room-Cache Architecture

> Last updated: BUILD 380

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
