# Campaign Room-Cache Architecture

> Last updated: BUILD 385

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

4. **Progress is always visible.**  In Electron, whether the export is triggered
   from the editor ("Export Campaign") or automatically during first-load cache
   generation / stale-cache regeneration, a live progress modal is shown so
   users always know what is happening.  The same `ExportProgressModal` component
   and the same `electronApi.onExportProgress` IPC event stream are used in both
   contexts (see [Progress UI](#progress-ui)).

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
  "exportedAt": "2026-05-21T12:00:00.000Z",
  "rooms": {
    "lobby": {
      "roomId": "lobby",
      "file": "lobby_room.json",
      "hash": "b4c91f2d3e087a56",
      "updatedAt": "2026-05-21T12:00:00.000Z"
    }
  },
  "adjacency": {
    "lobby": {
      "roomId": "lobby",
      "targets": ["corridor_01", "upper_passage"]
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
| `adjacency[id].targets` | Deduplicated list of room IDs reachable by direct transition from `id`. Derived from `SavedTransition.to` during export. Only rooms present in `manifest.rooms` are included. |

### Adjacency index

`manifest.adjacency` is a derived preload-optimisation index.  It is **not
editable source data**.

**Why it exists:**  The room preload scheduler performs a BFS from the current
room to discover which rooms to preload.  Without the adjacency index, BFS can
only traverse rooms that are already hydrated in `ROOM_REGISTRY`.  In lazy-load
mode only the current room is loaded at startup, which means the scheduler could
not discover radius-2 neighbours (neighbours of neighbours) until radius-1 rooms
had been lazily fetched and registered.

With the adjacency index, the BFS can look up transition targets for rooms that
are not yet in the registry using the manifest data written at export time.  This
means radius-2 rooms are discovered and queued for lazy loading in the same idle
pass that processes radius-1 rooms, substantially improving preload coverage when
the player moves quickly through a long corridor of unloaded rooms.

**Backward compatibility:** `adjacency` is an optional field.  Old manifests that
do not have it remain valid.  When `adjacency` is absent, the preload scheduler
falls back silently to registry-only BFS — the same behaviour as before.

**Safety:** The adjacency index is generated with the same room-ID safety rules
as the rest of the manifest.  Targets are only included if they are present in
`manifest.rooms`.  The scheduler additionally checks that each target is a
non-empty string before using it.

### Legacy manifest format

Older exports wrote `manifest.json` as a plain JSON array of room ID strings.
The loader detects this format and falls back gracefully — it will not validate
room hashes but will not crash.

---

## Progress UI

### Overview

The same `ExportProgressModal` component (`src/editor/editorExportProgressModal.ts`)
and the same `electronApi.onExportProgress` IPC event stream are reused for all
three contexts where cache generation can occur:

| Context | Triggered by |
|---------|-------------|
| **Editor export** | User clicks "Export Campaign" in Electron editor mode |
| **First-load cache generation** | Custom campaign opened in Electron play mode with no valid cache |
| **Stale-cache regeneration** | Campaign file updated since last export; detected at startup |
| **Official campaign cache generation** | Official campaign missing or stale on Electron startup |

The `createExportProgressModal(root, title?)` function accepts an optional `title`
parameter.  The editor uses the default title (`'📦 Exporting Campaign'`); the
cache-generation path passes `'🔄 Generating Room Cache'` to distinguish the two
contexts visually.

### How progress events flow

```
Renderer (game.ts or main.ts)          Main Process (electron/main.cjs)
   │                                         │
   ├─ show statusDiv "Checking room cache…"  │
   ├─ electronApi.onExportProgress(cb) ──────► ipcRenderer.on('dw:export-progress')
   ├─ ensureCampaignRoomCache()              │
   │    └─ generateCampaignRoomCache()       │
   │         └─ exportCampaignWithProgress ─►
   │                                         ├─ sendProgress({step:'serializing'…})
   │  ◄─ { step: 'serializing', … }         │
   │    cb fires → modal lazily created,     │
   │    statusDiv hidden                     │
   │  ◄─ { step: 'writing-campaign', … }    ├─ Write .dwcampaign.json
   │  ◄─ { step: 'exporting-room', … } ×N  ├─ For each room: hash → skip/write
   │  ◄─ { step: 'writing-manifest', … }   ├─ Write manifest.json
   │  ◄─ { step: 'cleaning-stale', … }     ├─ Remove orphan files
   │  ◄─ { step: 'complete', … }           │
   │                                        ◄─ return { ok, campaignDir }
   ├─ electronApi.offExportProgress()        │
   ├─ modal.destroy() (if created)           │
   └─ statusDiv.remove()                     │
```

**Key behaviour:** the full progress modal is created *lazily* — only when the
first `dw:export-progress` event arrives.  If the manifest is already fresh and
no generation is needed, zero events fire and the modal is never constructed.
The user only sees a brief "Checking room cache…" text overlay that disappears
almost instantly.

### Progress event payloads (from `electron/main.cjs`)

| `step` | Additional fields | When emitted |
|--------|-------------------|-------------|
| `'serializing'` | — | Before writing anything (validation complete) |
| `'writing-campaign'` | — | About to write the `.dwcampaign.json` file |
| `'exporting-room'` | `roomIndex`, `totalRooms`, `roomId` | For each room processed |
| `'writing-manifest'` | — | About to write `manifest.json` |
| `'cleaning-stale'` | — | About to scan for orphan room files |
| `'complete'` | `writtenRooms`, `skippedRooms` | All files written successfully |
| `'error'` | `message` | Any fatal error during generation |

The modal's detail line shows `N / M rooms — <roomId> (pct%)` for each
`exporting-room` event so users can see exactly which room is being processed.

### Browser / GitHub Pages

In browser mode `window.dustweaverElectron` is `undefined`.  The entire
`if (window.dustweaverElectron !== undefined)` block in `game.ts` and `main.ts`
is skipped.  No status overlay, no progress modal, no Electron IPC is attempted.
The packed campaign path (`registerRoomsFromPackedCampaign` / `initRoomRegistry`)
is used unchanged.

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

In browser (GitHub Pages) mode the user downloads **two files**:

1. **`[campaignId].dwcampaign.json`** (or `DustweaverCampaign.dwcampaign.json`)  
   The canonical packed campaign.  This is the only file needed to re-import
   the campaign.

2. **`[campaignId]_ROOMS.zip`** (or `DustweaverCampaign_ROOMS.zip`)  
   A derived room-cache ZIP with the same structure as the Electron ROOMS/
   directory.  Useful for inspection, tooling, or seeding a server-side cache.

ZIP structure:
```
ROOMS/
  manifest.json          ← same format as the Electron manifest
  <roomId>_room.json     ← one file per room
  ...
```

The ZIP is generated asynchronously in `downloadRoomCacheZip()` in
`src/editor/editorExport.ts` using `src/utils/minimalZipWriter.ts` (a
store-only, no-dependency ZIP builder).  Room hashes and campaign hash are
computed via `computeContentHash` (Web Crypto SHA-256), matching the Electron
manifest format exactly.

The main `.dwcampaign.json` download starts immediately (synchronously); the
ZIP download fires immediately afterwards (`void downloadRoomCacheZip(...)`).
Both downloads are triggered by separate `<a>.click()` calls.

**Source-of-truth rule:** the `.dwcampaign.json` is canonical; the ZIP is a
derived convenience artifact.  Sharing only the JSON is always sufficient.

In DEV builds, timing logs are emitted to the console:
```
[campaignPerf] room "lobby" hash+stringify: 2.10ms
[campaignPerf] room-cache ZIP generation: 48.30ms (84 room(s))
```

---

## Rolling Backups (Electron)

Before overwriting the packed campaign file, both export handlers
(`dw:save-official-campaign` and `dw:export-campaign-with-progress`) create
a timestamped backup of the **existing** packed campaign file.

Backup location: `<campaignDir>/BACKUPS/`

Backup filename pattern:
```
DustweaverCampaign_2026-05-21T03-44-12-123Z.dwcampaign.json
<campaignId>_2026-05-21T03-44-12-123Z.dwcampaign.json
```

Rules:
- A backup is only created if the packed file **already exists** and is readable.
- At most **10** backups are kept per campaign.  When the 11th is written,
  the oldest backup is deleted until only 10 remain.
- Backup files are sorted lexicographically (ISO timestamps sort correctly
  as strings → oldest first → pruning removes the first entries).
- If backup creation fails, a warning is logged and the export continues.

The BACKUPS directory contains only the canonical packed files — not derived
room files.  Individual room files are not backed up because they can always
be regenerated from the canonical file.

---

## Runtime Room Loading

### Gameplay startup (lazy loading)

**Gameplay mode** no longer eagerly loads all rooms at startup when a valid
room file cache exists.  Both the official campaign and custom campaigns now
use lazy loading in Electron:

```
startup
│
├─ Fetch packed campaign file               ← always needed for metadata
├─ ensureCampaignRoomCache()               ← validate or generate file cache
│    (progress modal shown if regeneration needed — see Progress UI above)
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
2. Shows a minimal "Checking room cache…" overlay.
3. Calls `ensureCampaignRoomCache(campaign, true)` — validates or regenerates
   the derived room file cache (full progress modal shown if needed).
4. If a valid manifest is returned, calls `applyOfficialCampaignMetadata` +
   `clearRegistryAndApplyCampaignMetadata` + `loadRoomForGameplayAsync(startRoomId)`.
5. Starts the game with ONLY the start room in ROOM_REGISTRY.
6. Falls back to `initRoomRegistry()` (full eager load) if anything fails.

### Saved-game resume with lazy loading

When the player resumes an official save, `game.ts` receives the `lastSaveRoomId`
from the selected save slot.  In lazy-load mode this room is typically **not** in
ROOM_REGISTRY (only the campaign start room was loaded at startup).

`game.ts` now handles this:
1. If `savedRoomId` is set, `isRoomFileCacheActive()` is true, and the room is
   absent from `ROOM_REGISTRY`:
   - `await loadRoomForGameplayAsync(savedRoomId)` is called before
     `startGameScreen`.
   - If the load succeeds, the game starts in the saved room as expected.
   - If the load fails (file missing, hash mismatch, etc.), a warning is logged
     and the game falls back to the campaign start room.
2. If the file cache is inactive (browser mode, cache disabled), this async path
   is skipped entirely — the existing behaviour is preserved.
3. Custom campaign play is unaffected (it doesn't use `lastSaveRoomId` and
   starts fresh).

This prevents the scenario where a player resumes a save and is silently
deposited in the lobby / campaign start room instead of their saved location
because the saved room wasn't yet loaded.

### Custom campaign (Electron, valid cache)

`game.ts` now:
1. Shows a minimal "Checking room cache…" overlay.
2. Calls `ensureCampaignRoomCache(campaign, false)`.
   If regeneration is needed, the full progress modal is shown automatically.
3. If a valid manifest is returned, calls `clearRegistryAndApplyCampaignMetadata` +
   `loadRoomForGameplayAsync(startRoomId)`.
4. Falls back to `registerRoomsFromPackedCampaign(campaign)` if anything fails.

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

`roomPreloadScheduler.ts` accepts an optional `loadRoomAsync` callback
(set to `loadRoomForGameplayAsync` when the file cache is active):

```
After each room load:
│
scheduleRoomPreloads(currentRoom, ..., loadRoomAsync)
│
BFS discovers adjacent rooms (radius 1 and 2 via room transitions).
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

**BFS discovery with manifest adjacency index:** When the room file cache is
active and the manifest includes an `adjacency` index, the preloader can traverse
neighbours of rooms that are NOT yet in `ROOM_REGISTRY`.  This means radius-2
rooms are discovered and queued for lazy loading in the same idle pass that
processes radius-1 rooms, without waiting for those intermediate rooms to be
hydrated first.

When `adjacency` is absent (old manifests or non-file-cache mode), the scheduler
falls back to registry-only BFS as before: it can only follow transitions from
rooms already in the registry, and re-discovers deeper rooms after each room
loads.

### In-memory room registry behaviour (ROOM_REGISTRY eviction intentionally deferred)

Rooms are stored in `ROOM_REGISTRY` (a `Map<string, RoomDef>`) once loaded.
There is **no active eviction**: rooms accumulate in memory as the player
explores.

**Why eviction is intentionally deferred:**
- Typical campaign size is ~80 rooms × ~10–50 KB each ≈ 0.5–4 MB of room data.
  This is negligible compared to texture atlases, audio buffers, and particle
  simulation arrays.
- Eviction would require the preload scheduler to re-load evicted rooms before
  the player can reach them.  Adding LRU eviction safely requires careful
  interaction with the preload scheduler, transition system, and the
  `RoomRuntimeCache` (wall templates + edge extensions) — a separate, non-trivial
  change.
- The lazy-loading architecture already prevents the *startup* cost of loading
  all rooms at once; the memory saved by eviction at runtime is not worth the
  implementation risk at this stage.

In DEV builds, `loadRoomForGameplayAsync` logs the current `ROOM_REGISTRY` size
after each lazy registration so developers can monitor accumulation:
```
[roomFileLoader] Lazy-loaded "marble_cavern". ROOM_REGISTRY now has 7 room(s) (no eviction).
```

When eviction is added in a future pass, the recommended approach is an LRU
strategy that always keeps the current room and the most-recently-visited N rooms
(e.g. N = 20), evicting far-away rooms.  The `roomPreloadScheduler` will
re-load evicted rooms from the file cache before the player reaches them again.

The existing `RoomRuntimeCache` (wall templates + edge extensions) already uses
a **bounded LRU with 10 slots** — unchanged.

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

1. A minimal "Checking room cache…" text overlay is shown immediately.
2. `ensureCampaignRoomCache` validates the existing manifest (fast path).
3. If the manifest is absent or stale, `generateCampaignRoomCache` triggers
   `dw:export-campaign-with-progress` IPC (the same pipeline used by the editor).
4. The first IPC progress event (`serializing`) causes the text overlay to be
   hidden and replaced by the full `ExportProgressModal` with title
   `'🔄 Generating Room Cache'`.
5. The modal shows live status for each step (serializing, writing-campaign,
   exporting-room N / M with room ID and percentage, writing-manifest,
   cleaning-stale, complete / error).
6. After generation, the manifest is re-read and validated.
7. If validation still fails (e.g. disk full), a warning is logged and the game
   falls back to the packed campaign.
8. The text overlay and modal (if shown) are both removed in the `finally` block.

Opening a newer version of a custom campaign (bumped `metadata.version` or
changed room content) triggers a hash mismatch, which causes the cache to be
regenerated before gameplay starts — with the same full progress UI.

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

**Hash vs. version rule:**
- `campaignHash` (SHA-256) is the **authoritative stale-cache check**.
- `campaignVersion` is written to the manifest as a convenience diagnostic
  (useful for debugging) but is **not** used as the primary staleness signal.
- If the hash matches but `campaignVersion` is lower than expected, the cache
  is still considered valid — the hash wins.
- If the hash mismatches, the cache is always regenerated, regardless of
  `campaignVersion`.

The `validateManifest()` function in `src/levels/roomCacheManifest.ts`
implements the hash/ID/version checks.

The **missing file check** is performed by `dw:validate-room-cache-files` IPC,
called from `validateCampaignRoomCache()` in `roomFileLoader.ts`.  If any file
listed in `manifest.rooms` is absent, validation returns `isValid: false` with
a message like `"Room cache is incomplete: missing file ROOMS/foo_room.json"`.
This triggers full cache regeneration instead of a delayed runtime error.

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
| `src/utils/minimalZipWriter.ts` | Store-only ZIP builder for browser room-cache ZIP export |
| `src/levels/roomCacheManifest.ts` | `RoomCacheManifest` types, `validateManifest()`, `ExportProgressEvent` |
| `src/levels/roomFileLoader.ts` | Source-selection service: `ensureCampaignRoomCache`, `validateCampaignRoomCache` (incl. file-existence check), `activateCampaignRoomCache`, `loadRoomForGameplayAsync`, `isRoomFileCacheActive`, `computeContentHash` (exported for browser ZIP export) |
| `src/levels/rooms.ts` | `clearRegistryAndApplyCampaignMetadata`, `applyOfficialCampaignMetadata`, `ROOM_REGISTRY` |
| `src/main.ts` | Official campaign startup: Electron → status overlay + lazy modal → file cache → lazy start room; Browser → `initRoomRegistry()` |
| `src/game.ts` | Custom campaign play and official gameplay: Electron → status overlay + lazy modal → file cache → lazy start room + **saved-room pre-load**; Browser → `registerRoomsFromPackedCampaign()` |
| `src/editor/editorExport.ts` | `exportMainCampaignJson()`, `exportCampaignJson()`, Electron progress helper, **browser ZIP export via `downloadRoomCacheZip()`** |
| `src/editor/editorExportProgressModal.ts` | Reusable DOM progress modal. `createExportProgressModal(root, title?)` — accepts optional title for non-export contexts |
| `electron/main.cjs` | `dw:export-campaign-with-progress`, `dw:save-official-campaign`, `dw:read-room-cache-manifest`, `dw:read-room-file`, `dw:read-all-room-files`, **`dw:validate-room-cache-files`** IPC handlers; **atomic write helpers** (`writeJsonAtomic`, `writeTextAtomic`); **rolling backup helpers** (`ensureRollingBackup`, `pruneBackups`) |
| `electron/preload.cjs` | Exposes all IPC channels to the renderer |
| `src/electron.d.ts` | TypeScript types for all Electron IPC surface |
| `src/screens/roomRuntimeCache.ts` | In-memory geometry cache for precomputed wall templates (bounded LRU, 10 slots) |
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
   manifest and triggers automatic regeneration with a full progress UI before
   gameplay starts.
3. Subsequent loads use the derived room files for lazy room loading.

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

1. **No active ROOM_REGISTRY eviction (intentionally deferred).**  Rooms accumulate
   in `ROOM_REGISTRY` as the player explores.  This is acceptable for typical
   campaign sizes (~80 rooms).  See the [In-memory room registry behaviour](#in-memory-room-registry-behaviour-room_registry-eviction-intentionally-deferred)
   section above for the full rationale and a recommended future LRU strategy.

2. **Custom campaign edit mode.**  The `customCampaignEdit` path in `game.ts`
   still calls `registerRoomsFromPackedCampaign` directly.  Room file
   validation is not needed there because the editor always reads from the
   canonical campaign session object.  This is correct and intentional.

3. **BFS depth limited by loaded rooms.**  The preload scheduler discovers
   adjacent rooms by inspecting the transition portals of already-loaded rooms.
   Deep unvisited room chains are not discovered until the player loads
   intermediate rooms.  This is acceptable for typical campaign layouts.
   See the [Adjacent room preloading](#adjacent-room-preloading-lazy-load-mode)
   section above for a description of the current behaviour and a potential
   future enhancement using manifest-stored room-adjacency metadata.

