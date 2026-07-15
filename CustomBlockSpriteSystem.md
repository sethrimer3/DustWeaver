# Custom Block Sprite System

Campaign-local pixel-art blocks that fill a 1×1 or 2×2 tile footprint, collide as solid walls, and survive export and campaign relocation.

---

## Phase 1A Audit Findings

The following gaps or defects were found in the Phase 1A implementation and addressed in Phase 1B.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Pencil/eraser strokes had no Bresenham interpolation — fast mouse movement skipped pixels | Medium | Fixed |
| 2 | Canvas `mouseleave` ended the stroke instead of a global `mouseup` — dragging outside the canvas cut the stroke short | Medium | Fixed |
| 3 | `isSafeCampaignRelativePath` did not reject `http://`, `file://`, `//UNC` paths | Medium | Fixed |
| 4 | Library management missing: no Rename, Duplicate, or usage-count display | High | Fixed |
| 5 | Gameplay never registered custom block sprite cache — custom sprites were invisible during gameplay (blocks appeared as blackRock walls) | Medium | Fixed (registry now populated on campaign load) |
| 6 | No reconciliation utility to compare registry vs room references | Medium | Fixed |
| 7 | No `CustomBlockSpriteSystem.md` documentation | — | Fixed (this file) |

**Not defects (working correctly in Phase 1A):**
- Collision via baked wall template works in editor and gameplay.
- Undo/redo grouping (one undo entry per stroke) was correct.
- Flood fill was iterative (stack-based) — no stack-overflow risk.
- Export round-trip preserves IDs and RGBA values.
- Campaign schema includes `customBlockDefs?` array.
- Missing-block fallback renders conspicuous magenta/black checkerboard.

---

## Schema and Folder Layout

Custom block definitions are stored **inline** in the packed campaign JSON (`*.dwcampaign.json`) under the top-level `customBlockDefs` array. No separate folder or file-per-block layout is used; the entire custom-block library travels with the campaign.

> **Note:** the shape below is the legacy schemaVersion-1 format, kept for compatibility. See "Phase 2A: Safe Predefined Properties" further down for the current schemaVersion-2 format (`properties` object replaces `behavior`), which is what the editor now writes on every save.

### Per-block JSON shape

```jsonc
{
  "schemaVersion": 1,
  "id": "weathered-stone",           // stable slug: [a-z0-9][a-z0-9-]*[a-z0-9]
  "name": "Weathered Stone",         // display name (mutable, ID is stable)
  "tileWidth": 1,                    // 1 or 2
  "tileHeight": 1,                   // 1 or 2
  "pixelWidth": 8,                   // tileWidth × 8
  "pixelHeight": 8,                  // tileHeight × 8
  "behavior": "solid",               // always "solid"
  "pixels": [                        // pixelHeight rows × pixelWidth columns
    ["#FF0000FF", "#00FF00FF", ...], // row 0
    ...
  ]
}
```

Colors are canonical uppercase `#RRGGBBAA` hex strings only.

---

## Stable ID Rules

- Generated from the display name at creation time via `nameToSlugId`: lowercase, hyphens only, trimmed.
- If the slug collides, `-2`, `-3`, … are appended until unique.
- The ID never changes after creation — rename changes only the `name` field.
- IDs must match `/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/`.
- The namespaced form `custom:<id>` is used in room references and palette items.
- IDs must not collide with any built-in block type (namespacing via `custom:` prefix ensures this).

---

## Library Management Behavior

### Create
The `+1×1` / `+2×2` buttons in the Custom Blocks palette open the pixel editor dialog. On save, the block is added to the campaign-local registry and its sprite is cached.

### Edit sprite
The `✏ Edit` button opens the pixel editor with the existing pixels. On save, the registry entry and cached sprite are both updated. All placed instances reflect the new sprite immediately (they share the same cached canvas).

### Rename
The `✎ Rename` button prompts for a new display name. Only the `name` field changes; the `id` and all room references remain unchanged.

### Duplicate
The `⧉ Dup` button creates a new block with:
- A new unique ID (original ID + suffix)
- Display name: `<original> Copy`
- An independent copy of the pixel buffer (mutations to one do not affect the other)

### Delete
The `🗑` button checks all rooms (committed + current in-editor) for placements. If the block is in use, deletion is blocked with a list of affected rooms. If unused, the block is removed from the registry and its sprite cache entry is released.

### Usage count
Each block card displays how many rooms contain at least one placement of that block. This is recomputed when blocks are created, deleted, or duplicated.

---

## 2×2 Placement Representation

A 2×2 placement is stored as a single `[xBlock, yBlock, "custom:<id>"]` entry in `room.customBlockPlacements`. The `tileWidth` and `tileHeight` fields on the runtime `EditorCustomBlockPlacement` object are derived from the registry at room-load time.

For collision, the placement is converted to a solid `RoomWallDef` with `wBlock: tileWidth, hBlock: tileHeight` in `editorRoomBuilder.ts`. The wall is then baked into the room's `bakedWallTemplate` on export and used by both editor and gameplay.

Overlap checking during placement uses the full `tileWidth × tileHeight` footprint.

---

## Validation Rules

`validateCustomBlockSource` enforces:

1. `schemaVersion === 1`
2. `id` matches the safe-slug regex
3. `name` is a non-empty, non-whitespace string
4. `tileWidth` ∈ {1, 2}; `tileHeight` ∈ {1, 2}
5. `pixelWidth === tileWidth × 8`; `pixelHeight === tileHeight × 8`
6. `behavior === "solid"`
7. `pixels` has exactly `pixelHeight` rows, each with exactly `pixelWidth` uppercase `#RRGGBBAA` strings

Errors stop further validation after a `schemaVersion` mismatch; pixel errors are capped at 20 to avoid flooding on large corrupt files.

---

## Path Security

`isSafeCampaignRelativePath(path)` rejects:

- Empty paths
- Windows absolute paths (`C:\…`)
- Unix absolute paths (`/…`, `\…`)
- UNC paths (`//server`, `\\server`)
- Parent traversal (`..`)
- Reserved characters: `< > " | ? *`
- Null bytes and control characters (U+0000–U+001F)
- URI schemes (`http://`, `file://`, `ftp://`, etc.)

Custom blocks are JSON data only and must never execute code. The `parseCustomBlockSource` validator rejects all non-`"solid"` behavior strings.

---

## Persistence Behavior

Custom block definitions are saved as part of the campaign JSON via `buildExportCampaign`. The flow:

1. The editor holds the registry in `state.customBlockRegistry` (in-memory only).
2. On export (`onExportCampaignJson`), all registry entries are serialized to `CustomBlockSourceDef[]` and passed to `buildExportCampaign`, which includes them in the output as `customBlockDefs`.
3. On campaign load (editor or gameplay), each `customBlockDef` entry is validated via `parseCustomBlockSource`. Malformed entries are skipped with a warning; they do not abort the load.

There is no per-block file — all blocks travel in the single campaign JSON, so the usual atomic-file-write semantics of the campaign exporter protect the whole library.

---

## Runtime Caching and Cleanup

The sprite cache (`src/render/customBlockSpriteCache.ts`) is a module-level `Map<string, CustomBlockSprite>` keyed by raw block ID.

- **One canvas per definition**: all placed instances of the same block share the same cached `HTMLCanvasElement` / `OffscreenCanvas`. No pixel parsing happens during rendering.
- **Register**: `registerCustomBlockSprite(def)` builds the canvas and stores it.
- **Targeted invalidation**: `invalidateCustomBlockSprite(def)` removes the old canvas and calls `registerCustomBlockSprite` to rebuild only that block's sprite.
- **Rename without pixel change**: does not call `invalidateCustomBlockSprite` — the cached canvas is still valid.
- **Delete**: `invalidateCustomBlockSprite` removes the cache entry for the deleted block.
- **Campaign switch / editor close**: `clearCustomBlockSpriteCache()` clears the entire cache.
- **Gameplay start**: custom block defs are registered in the sprite cache when a packed campaign is loaded for play (in `game.ts`), so sprites are available for any overlay renderer that draws them.

---

## Missing-Reference Behavior

When a room references a block ID not in the registry:

- The `EditorCustomBlockPlacement` retains the original `blockId` string.
- `tileWidth` and `tileHeight` fall back to `1` (their cached value is not updated for unknown blocks).
- `getOrFallbackSprite` returns a conspicuous magenta/black checkerboard sprite and caches it under the missing ID to avoid rebuilding every frame.
- The wall is still baked as a solid collision tile at `[xBlock, yBlock]` with a 1×1 footprint unless the footprint was preserved in the room data.
- A diagnostic warning is logged.
- The missing block is never silently replaced with a different block.

The `reconcileCustomBlocks` utility can be called to compare the registry against all room references and report:
- `room_reference_not_in_registry` — a room uses a block not in the registry.
- `registry_missing_from_room_usage` — a block is defined but never placed.

---

## Import, Export, and Portability

- Export bundles all `customBlockDefs` inline in the campaign JSON — no separate asset files.
- On reload from a different directory, all custom block definitions are present in the JSON; no path resolution is needed.
- Stable IDs and uppercase hex colors are deterministic across machines and OS.
- Deleted blocks are not included in new exports (only the live registry is serialized).
- Malformed blocks in an imported campaign are skipped with a warning; the rest of the campaign loads normally.

---

## Performance Limits

No explicit file-count or per-block file-size limits are enforced in Phase 1B. The practical limit is the campaign JSON file size (limited by the exporter's memory and the browser's local-storage quota for imported campaigns). Extremely large pixel buffers (e.g., hundreds of 2×2 blocks) will slow export and camera.

---

## Phase 1C: Gameplay Rendering, Unsaved-Change Protection, Symlink Containment

### Gameplay Rendering Path

Custom block sprites are now drawn during gameplay and editor-backdrop rendering.

**Flow:**
1. Campaign load → `game.ts` calls `registerCustomBlockSprite(def)` for every `customBlockDef`.
2. `roomJsonToRoomDef.ts` copies `json.customBlockPlacements` into `RoomDef.customBlockPlacements`.
3. Every `gameRender.ts` frame: after `renderWalls(...)`, `renderCustomBlockSprites(ctx, currentRoom, ox, oy, zoom)` is called.
4. For each placement: `getOrFallbackSprite(rawId, 1, 1)` looks up the cached canvas; the returned sprite's own `tileWidth`/`tileHeight` fields drive the destination rectangle.
5. `drawCustomBlockSprite` calls `ctx.drawImage` with `imageSmoothingEnabled = false` for nearest-neighbor scaling.
6. The editor-backdrop renderer (`gameScreenEditorBackdrop.ts`) follows the same call after `renderWalls`.

**Why after walls:** the standard wall renderer draws blackRock tiles for every solid tile including custom block footprints. Custom sprites paint over those tiles without needing to suppress the underlying wall draw, keeping the wall renderer untouched.

### Cached Sprite Integration

- One `OffscreenCanvas` (or `HTMLCanvasElement`) per block ID — created once at campaign load, or after a sprite edit.
- `invalidateCustomBlockSprite(def)` + `registerCustomBlockSprite(def)` replaces the cached canvas on save. All future frame draws see the new sprite automatically.
- `clearCustomBlockSpriteCache()` is called on campaign unload, preventing stale sprites from leaking to the next campaign.
- Multiple placements of one block always retrieve the same object via `getOrFallbackSprite`.

### Transparency and Layering Behavior

- `imageSmoothingEnabled = false` ensures exact RGBA sampling; no color blending across pixel boundaries.
- Fully transparent and semitransparent pixels are preserved exactly as painted (alpha channel passed through `putImageData`).
- No background is drawn beneath transparent pixels from this renderer — the underlying wall tile (blackRock) appears through them. If the designer wants an opaque block, they should paint all pixels with `alpha = 255`.
- Z-order: custom sprites render above walls and below clusters, hazards, and particles (same as decorations).

### Cache Invalidation Behavior

| Trigger | Action |
|---------|--------|
| Edit + save a block | `invalidateCustomBlockSprite(def)` deletes the old entry; `registerCustomBlockSprite(def)` builds a new canvas |
| Campaign unload | `clearCustomBlockSpriteCache()` clears all entries |
| Campaign switch | Cache is cleared before loading the new campaign — no ID collisions possible |
| Missing block ID at render time | `getOrFallbackSprite` returns a cached magenta/black checkerboard; caches it to avoid per-frame rebuild |

### Unsaved-Change Handling

`editorCustomBlockDialog.ts` tracks dirty state:

- `savedPixelData` — snapshot of the pixel data at dialog open time.
- `isDirty()` — byte-wise comparison of `pixelData` vs `savedPixelData`.
- **Cancel** and **Escape**: if `isDirty()`, a confirmation sub-dialog appears with three choices:
  - **Save & Close**: validates → serializes → calls `onResult({ action: 'save', … })` → clears dirty state.
  - **Discard Changes**: closes dialog without saving → `onResult({ action: 'cancel' })`.
  - **Keep Editing**: dismisses the confirmation and returns to the pixel editor.
- If nothing was changed, Cancel/Escape closes immediately without prompting.
- A failed save (validation error) keeps the dialog open and leaves `pixelData` intact.
- `savedPixelData.set(pixelData)` is called after a successful save to clear dirty status.

### Symlink Containment Strategy

`electron/campaignExport.cjs` now includes `checkPathInsideCampaignDir(targetPath, allowedDir, label)`:

1. Resolves `allowedDir` with `fs.realpathSync` (symlink-aware).
2. Resolves `targetPath` with `fs.realpathSync`; if the path does not yet exist, walks up to the nearest existing ancestor.
3. Checks that the resolved target path starts with the resolved allowed dir.
4. Returns `{ ok: false, error, realTarget, realAllowed }` on violation.

This check is applied at the campaign write path, packed campaign file, individual room writes, and stale room file deletion. `isSafeCampaignRelativePath` (lexical) remains unchanged and is the first layer; `checkPathInsideCampaignDir` is the second, symlink-aware layer.

**Platform limitation (Windows):** Windows requires elevated privileges or Developer Mode to create symlinks unprivileged. The symlink-escape test detects this and logs a diagnostic instead of failing. The lexical checks (`isSafeCampaignRelativePath`, `SAFE_ROOM_ID_RE`) remain effective on all platforms.

---

## Test Results

Phase 1C adds **23 additional tests** in `src/tests/customBlocksPhase1C.test.ts` covering:

- Sprite registered and retrievable after `registerCustomBlockSprite` (gameplay not blackRock)
- Exact RGBA bytes (including semitransparent and fully transparent) preserved
- 1×1 sprite has 1×1 tileWidth/tileHeight; 2×2 has 2×2
- Multiple placements → same cached object reference
- Missing definition → fallback checkerboard sprite (not null)
- Campaign switch clears cache → no cross-campaign sprite leak
- `invalidateCustomBlockSprite` + re-register updates all future lookups
- Dirty-state: unchanged buffer not dirty; edited pixel marks dirty
- Discard restores persisted state; save clears dirty state; failed save preserves edits
- Symlink escape rejected for paths outside allowed dir; legitimate subpaths accepted
- Built-in rooms without `customBlockPlacements` are skipped by renderer (field = undefined)
- RGBA round-trip fidelity for semitransparent and fully transparent pixels
- Existing lexical path checks unchanged

Phase 1B tests: 59 in `src/tests/customBlocks.test.ts`.

**Total test suite after Phase 1C: 760 tests, 0 failures.**

---

## Manual Smoke Test

The Electron dev server was not available in this environment (Windows Home, requires PowerShell elevation for symlinks; browser dev mode was not started). The following checks were performed by code inspection:

| Check | Method | Result |
|-------|--------|--------|
| Custom sprites render in gameplay | Code: `renderCustomBlockSprites` called in `gameRender.ts` after `renderWalls` | ✅ Wired |
| Editor backdrop also draws sprites | Code: same call in `gameScreenEditorBackdrop.ts` | ✅ Wired |
| `customBlockPlacements` flows from JSON to RoomDef | Code: `roomJsonToRoomDef.ts` now copies the field | ✅ Confirmed |
| Cancel with unsaved changes shows prompt | Code: `attemptCancel()` checks `isDirty()` before acting | ✅ Wired |
| Discard restores saved state | Code: `discardBtn` calls `onResult({ action: 'cancel' })` without save | ✅ Wired |
| Symlink escape rejected | Tests: `checkPathInsideCampaignDir` tested with temp dir | ✅ Tested |
| Type checking | `npx tsc --noEmit` | ✅ 0 errors |
| Production build | `npm run build` | ✅ Success |
| Full test suite | `npm test` | ✅ 760 pass, 0 fail |

**Manual browser/Electron run was not performed.** Blocking factor: Electron requires a running desktop session and the test environment does not have one active during this session.

---

## Known Limitations

1. **Undo history is bounded at 50 but not per-block isolated.** The undo stack is local to one open dialog session; it is always empty when the dialog opens. Undoing back to the persisted state does not clear dirty status (the undo stack does not track which state corresponds to the last save).

2. **No cross-campaign ID namespace collision detection.** If two campaigns define the same block ID, importing them together would be ambiguous.

3. **Windows symlink limitation.** `checkPathInsideCampaignDir` fully protects against symlink escape on Linux and macOS. On Windows, unprivileged symlinks require Developer Mode or elevation; if those are unavailable, the symlink check still runs but cannot be triggered by an attacker who also cannot create symlinks. The lexical checks remain fully effective on all platforms.

4. **Transparent pixels reveal the underlying wall tile.** Since `renderCustomBlockSprites` draws over blackRock tiles without erasing them first, transparent pixels in a custom block will show the blackRock tile through them. This is intentional (saves a clear pass) but means designers must use alpha = 255 for fully opaque blocks if they don't want the blackRock edge visible.

---

## Phase 2A: Safe Predefined Properties

Custom blocks can now carry an engine-defined `properties` object selecting **collision**, **friction**, and **breakability** presets. No scripts, callbacks, shaders, or arbitrary physics numbers are involved — every preset id maps to an existing, already-shipped engine behavior.

### Schema Version 2

```jsonc
{
  "schemaVersion": 2,
  "id": "weathered-stone",
  "name": "Weathered Stone",
  "tileWidth": 1,
  "tileHeight": 1,
  "pixelWidth": 8,
  "pixelHeight": 8,
  "properties": {
    "collision": "solid",       // "solid" | "oneWay" | "nonSolid"
    "friction": "default",      // "default" | "slippery"
    "breakability": "indestructible" // "indestructible" | "fragile"
  },
  "pixels": []
}
```

`behavior: "solid"` (schemaVersion 1) is replaced by the `properties` object in schemaVersion 2. `CUSTOM_BLOCK_SCHEMA_VERSION` is now `2`; the parser still accepts `1` (`CUSTOM_BLOCK_MIN_SCHEMA_VERSION`).

### Version-1 Compatibility

- `validateCustomBlockSource` accepts `schemaVersion` `1` or `2`. Version-1 blocks are validated exactly as before (`behavior === "solid"` required); version-2 blocks validate the `properties` object instead and ignore `behavior`.
- `parseCustomBlockSource` always resolves a full `CustomBlockProperties` bundle. For a version-1 block with no `properties` field, `validateAndResolveCustomBlockProperties(undefined, …)` returns the defaults `{ collision: "solid", friction: "default", breakability: "indestructible" }` with **zero** diagnostics — this is exactly the old Phase-1 behavior, not a fallback-from-error path.
- Editing and saving a version-1 block through the editor always writes it back out as schemaVersion 2 (`serializeCustomBlock` only emits v2). Room references (`custom:<id>`) are untouched by this upgrade.

### Property Registry (`src/levels/customBlockProperties.ts`)

The registry is the single authoritative source for both validation and editor UI. For each preset it defines:

- **Serialized id** (`'solid' | 'oneWay' | 'nonSolid'`, etc.)
- **Display label** and **editor description** (`COLLISION_PRESET_REGISTRY`, `FRICTION_PRESET_REGISTRY`, `BREAKABILITY_PRESET_REGISTRY`)
- **Validation**: `isCollisionPreset` / `isFrictionPreset` / `isBreakabilityPreset` type guards; `validateAndResolveCustomBlockProperties` never throws — unknown values fall back to the default and are reported as a `CustomBlockValidationError` (`field`, `expected`, `received`, `blockId`).
- **Compatibility rules**: `checkCustomBlockPropertyCompatibility(properties, tileWidth, tileHeight)` returns a list of violated rules; never silently rewrites anything itself.
- **Runtime behavior mapping**: `resolveWallBehavior(properties)` returns `{ generateWall, isPlatformFlag, platformEdge, blockTheme }` built entirely from existing `RoomWallDef` fields. `isEligibleForBreakablePathway(properties, tileWidth, tileHeight)` decides whether a placement should be routed to the existing breakable-block system.
- **Default value**: `DEFAULT_CUSTOM_BLOCK_PROPERTIES = { collision: 'solid', friction: 'default', breakability: 'indestructible' }`.

JSON never names an internal class or module — only a preset id string, which this registry maps to behavior.

### Implemented Presets and the Existing Pathways They Reuse

| Property | Preset | Existing engine pathway reused |
|---|---|---|
| Collision | `solid` (default) | Ordinary `RoomWallDef` wall, `isPlatformFlag: 0` — unchanged from Phase 1. |
| Collision | `oneWay` | `RoomWallDef.isPlatformFlag = 1`, `platformEdge = 0` (top) — the same one-way platform resolution already used by `resolveWallsY`/`resolveWallsX` in `src/sim/clusters/movementAxisResolvers.ts`. |
| Collision | `nonSolid` | No wall is generated for the placement at all (parallel to `RoomBackgroundBlockDef`'s "visual only, no collision" behavior) — collision resolvers never see it, but the sprite still renders via `customBlockPlacements`. |
| Friction | `default` | `RoomWallDef.blockTheme = 'blackRock'` — unchanged. |
| Friction | `slippery` | `RoomWallDef.blockTheme = 'ice'` — the same ice-surface low-friction acceleration/deceleration constants in `src/sim/clusters/movementConstants.ts` (`ICE_GROUND_ACCELERATION_PER_SEC2`, `ICE_GROUND_DECELERATION_PER_SEC2`), applied via the existing `wallIsIceFlag` derivation. No new friction number is introduced. |
| Breakability | `indestructible` (default) | No special handling — an ordinary solid/one-way/non-solid wall. |
| Breakability | `fragile` | The block's placement is **not** added to the normal wall array. Instead its `(xBlock, yBlock)` is pushed into `RoomDef.breakableBlocks`, which `gameRoomHazards.ts` already turns into its own wall plus a `world.breakableBlockXWorld/…/isBreakableBlockActiveFlag` entry using the existing momentum-threshold destruction logic (`BREAKABLE_MOMENTUM_THRESHOLD_WORLD` in `src/sim/hazards.ts`). No new damage or destruction system was written. |

### Compatibility Rules

- `nonSolid` + `friction !== 'default'` → **incompatible** (`nonSolidNoFriction`): non-solid blocks never collide, so friction has no effect.
- `fragile` + `collision !== 'solid'` → **incompatible** (`fragileRequiresSolid`): the breakable pathway replaces a solid wall; one-way/non-solid fragile blocks are not defined.
- `fragile` + footprint not 1×1 or 2×2 → **incompatible** (`fragileRequiresSupportedFootprint`): as of Phase 2B both 1×1 and 2×2 fragile footprints are supported (see "Phase 2B" below); any other footprint (not possible today — `tileWidth`/`tileHeight` are only ever 1 or 2 — kept for future-proofing) is rejected.
- At **load time** (untrusted/legacy JSON), an incompatible combination never crashes the campaign: `validateAndResolveCustomBlockProperties` forces the incompatible field back to its default (e.g. fragile + an unsupported footprint → `breakability: 'indestructible'`) and reports the fallback as a diagnostic.
- In the **editor**, incompatible combinations are never silently rewritten — Save is blocked and the exact rule violated is shown in the dialog's error line.

### Runtime Resolution and Caching

- `src/render/customBlockSpriteCache.ts`'s existing per-block cache (`registerCustomBlockSprite` / `invalidateCustomBlockSprite` / `getOrFallbackSprite`) now also stores the resolved `CustomBlockProperties` alongside each cached sprite canvas. One definition → one validated property profile, shared by every placement — no re-parsing or re-validation happens during rendering or collision building.
- `editorRoomBuilder.ts`'s `editorRoomDataToRoomDef` reads each custom block's properties from this cache (`getCustomBlockProperties`) when converting placements into `RoomWallDef`/`RoomBreakableBlockDef` entries. Saving an edited definition re-registers the cache entry; the next `editorRoomDataToRoomDef` call (and the next campaign export) picks up the new behavior for every existing placement automatically — no room JSON is rewritten.
- Renaming a block only changes its `name` field and does not call `invalidateCustomBlockSprite`, so neither its sprite canvas nor its cached properties are rebuilt (matches the existing rename/rebuild-avoidance behavior documented above).
- `clearCustomBlockSpriteCache()` (called on every campaign load/switch) clears cached properties along with cached sprites — two campaigns that happen to reuse the same local block ID can never see each other's property profile.
- Gameplay rendering (`customBlockGameplayRenderer.ts`) reads `sprite.properties.breakability` from the same cache entry (not JSON) to decide whether a placement is a fragile block; if so, it checks the sim's `world.isBreakableBlockActiveFlag` (matched by world position against `world.breakableBlockXWorld/YWorld`) and skips drawing the sprite once broken — the complete placement disappears, never a partial fragment.

### Editor Controls

`editorCustomBlockDialog.ts` gained a **Properties** section between the footprint selector and the pixel canvas:

- Three dropdowns (Collision, Friction, Breakability), each backed directly by the registry (`COLLISION_PRESET_REGISTRY`, etc.) so labels/descriptions can never drift from validation.
- A one-line description under each dropdown, e.g. "Can be passed from below and stood on from above." for One-way.
- A live compatibility line: if the current combination violates a rule, it is shown in orange and **Save is blocked** with the same message — never silently corrected.
- Property changes call `pushUndo()` before applying, so Undo/Redo restores both pixel data and properties together (the existing 50-entry bounded undo stack now snapshots `{ pixelData, properties }`).
- Property changes are included in the existing dirty-check (`isDirty()` now also compares `properties` against the saved snapshot), so Cancel/Escape with only a property change (no pixel edits) still triggers the Save & Close / Discard / Keep Editing prompt.
- Save always serializes via `serializeCustomBlock(..., properties)`, which always emits schemaVersion 2.
- The custom-block palette card (`editorUI.ts`) now shows a small text indicator per block, e.g. `One-way · Slippery · Fragile`, with a tooltip explaining it.

### Known Limitations (Phase 2A, superseded by Phase 2B below)

1. ~~2×2 fragile blocks are not supported.~~ **Resolved in Phase 2B** — see below.
2. **One-way platform edges 2/3 (left/right) are not exposed.** The underlying engine only fully implements top/bottom edges today (edges 2/3 are "reserved for future" in `movementAxisResolvers.ts`); the custom-block `oneWay` preset always uses the top edge, matching every other authored one-way wall in the game.
3. **Broken-fragile-block detection in the renderer is a position match, not an index handle.** `customBlockGameplayRenderer.ts` looks up `world.isBreakableBlockActiveFlag` by comparing world coordinates each frame. This avoids new per-placement bookkeeping but means two breakable entries that happen to share the exact same world position (not possible today) would be ambiguous — documented so no future system reuses this shortcut unchanged.
4. **No persistence of broken-fragile state across a full room reload.** This matches the existing built-in breakable-block behavior (`gameRoomHazards.ts` resets `isBreakableBlockActiveFlag` to 1 on room (re)load); custom fragile blocks (1×1 and 2×2 alike) intentionally behave identically rather than adding new persistence.

---

## Phase 2B: Multi-Cell Fragile Custom Blocks (2×2)

### Why 2×2 Fragile Was Previously Unsupported

`RoomDef.breakableBlocks` (`RoomBreakableBlockDef`) is inherently a **single-cell** mechanism: one entry = one `(xBlock, yBlock)` = one wall = one `world.isBreakableBlockActiveFlag` slot, destroyed independently by `src/sim/hazards.ts`. A naive 2×2 fragile block would need either (a) four independent single-cell entries — which could be struck and destroyed one quarter at a time, leaving 1–3 orphaned solid quarters and fragments — or (b) a brand-new multi-cell physics/destruction system, which Phase 2A explicitly declined to build. Phase 2A's `fragileRequires1x1` compatibility rule blocked 2×2+fragile at both the editor and the loader for exactly this reason.

### The Fix: Logical Placement Grouping, Not a New Engine

Phase 2B does **not** add a new destruction system. It adds one small, backward-compatible field — `groupId?: number` — to the existing `RoomBreakableBlockDef` (`src/levels/roomElementDefs.ts`) and threads it through the existing pipeline:

1. **Editor → RoomDef** (`editorRoomDataToRoomDef` in `src/editor/editorRoomBuilder.ts`): a 2×2 fragile custom block placement is expanded into **four** ordinary `RoomBreakableBlockDef` cells (one per occupied tile, exactly as if four separate 1×1 fragile blocks had been authored at those coordinates), and all four are tagged with the same `groupId` (a counter unique within the room). A 1×1 fragile placement still produces exactly one cell with `groupId` omitted (`undefined`), byte-identical to pre-Phase-2B behavior.
2. **Room load** (`loadRoomHazards` in `src/screens/gameRoomHazards.ts`): copies `b.groupId ?? -1` into a new parallel array, `world.breakableBlockGroupId: Int16Array` (`src/sim/worldHazardState.ts`). `-1` means "ungrouped" (every pre-Phase-2B breakable block, and every 1×1 custom fragile block).
3. **Destruction** (`applyHazards` in `src/sim/hazards.ts`): when the momentum-threshold check breaks cell `i` (via the new shared `destroyBreakableBlockCell(world, index)` helper, which deactivates the flag and zeroes the matching wall's `wWorld`/`hWorld` — the single place that mutates breakable/wall state), it then checks `world.breakableBlockGroupId[i]`. If it is `>= 0`, the loop scans every **other** cell sharing that group id and destroys any that are still active, in the same pass. This is the atomic transaction: whichever of the 4 cells is struck, all 4 become inactive and lose their collision within the same tick, with no intermediate partial state observable between them.

### The 9-Step Transaction, Mapped to Code

| Spec step | Implementation |
|---|---|
| 1. Resolve struck cell → placement | The struck cell's `world.breakableBlockGroupId[i]` *is* the placement identity — no separate lookup table needed. |
| 2. Verify not already processed | The per-cell `isBreakableBlockActiveFlag[i] === 0` guard at the top of the hazard loop and inside the group-destroy inner loop — re-striking an already-broken cell (or its already-broken groupmates) is a no-op. |
| 3. Gather the exact 4 occupied tiles | Done once, at room-build time, in `editorRoomDataToRoomDef` — the 4 cells pushed for one placement are exactly its footprint, from authoritative `EditorCustomBlockPlacement` data (`xBlock/yBlock/tileWidth/tileHeight`), never inferred by scanning neighboring tiles for a matching block ID. |
| 4. Remove collision for all 4 | `destroyBreakableBlockCell` zeroes `wallWWorld`/`wallHWorld` for each cell's own wall index. |
| 5. Remove render/placement state for all 4 | `customBlockGameplayRenderer.ts` checks the **anchor** cell's breakable entry (one of the 4, since the anchor tile is always cell `(dx=0, dy=0)` of the group) via `isFragilePlacementBroken`; because the group destroys atomically, the anchor's flag flips to inactive in the same tick as the other 3, so the whole sprite disappears in one frame — never a partial quarter. |
| 6. Update runtime room state | All mutation is on the sim `WorldState` (`isBreakableBlockActiveFlag`, `wallWWorld/HWorld`) — no authored room JSON or custom block definition is ever touched. |
| 7. Trigger break effects in a controlled way | The engine has no per-cell particle/sound effect for breakable blocks today (only the cracked-brick fill in `src/render/hazards.ts`, gated by the same active-flag, so it already stops drawing all 4 cells together — no fan-out to suppress). |
| 8. Mark dirty | The sim's existing per-tick wall/flag mutation is what the renderer already reads every frame — no additional dirty flag needed (matches how single-cell fragile blocks already work). |
| 9. Prevent duplicate destruction same frame | The active-flag guard makes every step idempotent: calling `applyHazards` (or hitting the same/groupmate cell) again in the same tick is a safe no-op. Covered by an automated test (see below). |

### Backward Compatibility

- `groupId` is optional on `RoomBreakableBlockDef` and defaults to `-1` in `world.breakableBlockGroupId` when absent — pre-Phase-2B room JSON (with no `groupId` field on any breakable-block entry) loads and behaves identically to before.
- No schema version bump: `CUSTOM_BLOCK_SCHEMA_VERSION` stays `2`. Nothing changed in the on-disk custom block **definition** format (`CustomBlockSourceDefV2`) — 2×2 fragile is purely a property-compatibility and room-building change, not a serialization change.
- 1×1 fragile custom blocks are completely unaffected: `isEligibleForBreakablePathway` still routes them to a single ungrouped cell, and `editorRoomDataToRoomDef` still pushes exactly one `RoomBreakableBlockDef` with no `groupId`.

### Editor Changes

- `checkCustomBlockPropertyCompatibility`'s `fragileRequiresSupportedFootprint` rule now accepts both 1×1 and 2×2 (previously `fragileRequires1x1` rejected anything but 1×1). `nonSolid + fragile` and `fragile` with `oneWay` collision remain blocked via the unchanged `fragileRequiresSolid` rule.
- The editor's live compatibility line (`editorCustomBlockDialog.ts`) and Save-blocking behavior are unchanged in mechanism — they simply now report zero issues for a 2×2 solid+fragile combination instead of one.
- Property changes (including flipping a definition between fragile and indestructible) continue to participate in dirty tracking, undo/redo (`{ pixelData, properties }` snapshots), Save/Discard/Cancel, duplicate, rename, and export exactly as in Phase 2A — none of that machinery is footprint-aware, so it needed no changes for 2×2.

### Runtime Property Hardening Findings (Audit)

- **Collision**: `resolveWallBehavior` is unchanged and correctly covers the complete `wBlock × hBlock` footprint for `solid`/`oneWay`; `nonSolid` generates no wall. Switching a placement's definition from `solid` to `nonSolid` (or vice versa) takes effect the next time `editorRoomDataToRoomDef` runs (e.g. next export or resident-room rebuild) with no room-data rewrite, since the wall array is rebuilt from the cache-resolved properties every time.
- **Friction**: a 2×2 placement produces one `RoomWallDef` (for solid/oneWay, non-fragile) or four grouped breakable cells (fragile) — in both cases there is exactly one property profile per placement (read once from the sprite cache), so there is no way for "multiple occupancy cells" to disagree; there is only ever one wall (or one group) per placement. `nonSolid` blocks never generate a wall, so friction can never apply to them (enforced by `nonSolidNoFriction`).
- **Friction hardening bug found and fixed**: prior to Phase 2B, `gameRoomHazards.ts` built the breakable-pathway wall for *every* breakable block (built-in or fragile custom, 1×1 or would-be 2×2) with a hardcoded default wall theme and never set `wallIsIceFlag`, so a `fragile` + `slippery` custom block silently lost its ice friction the moment it was routed to the breakable pathway — the `resolveWallBehavior().blockTheme === 'ice'` result was computed but discarded. Fixed by adding an optional `blockTheme?: 'blackRock' | 'ice'` field to `RoomBreakableBlockDef` (`src/levels/roomElementDefs.ts`), populated by `editorRoomBuilder.ts` only when the resolved theme is `'ice'` (left `undefined` for the default case, preserving the exact pre-existing `WALL_THEME_DEFAULT_INDEX` sentinel rather than forcing a concrete "blackRock" index), and consumed by `loadRoomHazards` in `gameRoomHazards.ts` to set both `wallThemeIndex` and `wallIsIceFlag` correctly on the breakable cell's wall. This applies to both 1×1 and 2×2 fragile+slippery blocks alike.
- **Breakability**: `indestructible` blocks are never passed to `isEligibleForBreakablePathway` (it requires `breakability === 'fragile'`), so they can never enter the breakable/group-destroy path. Missing/unregistered block IDs fall back to `DEFAULT_CUSTOM_BLOCK_PROPERTIES` (`collision: solid, breakability: indestructible`) via `getCustomBlockProperties`, so an unresolvable placement still renders its full solid footprint rather than silently vanishing or half-colliding.
- **Campaign switching**: `clearCustomBlockSpriteCache()` clears the property cache; `world.breakableBlockGroupId` (like all hazard arrays) is fully repopulated by `loadRoomHazards` on every room (re)load, so no group id or destruction state can leak between rooms or campaigns.

### Effect Emission Policy

One logical placement → at most one visible disappearance event, never four. Concretely: the engine's only current "effect" for a breaking block is that the cracked-brick overlay (`src/render/hazards.ts`) and the custom sprite (`customBlockGameplayRenderer.ts`) stop being drawn once `isBreakableBlockActiveFlag` is 0; since the group-destroy loop flips all 4 flags in the same tick, all 4 quarters (and the whole custom sprite) disappear in the same frame. There is no per-cell particle/sound system to fan out ×4 in the first place — if a future phase adds one (see below), it must gate on "is this the group's first cell processed this pass" (the outer loop index `i`) to preserve this one-emission-per-placement policy.

### Persistence / Reset Semantics

Identical to built-in single-cell breakable blocks: `isBreakableBlockActiveFlag` (and now `breakableBlockGroupId`) live only in the transient sim `WorldState`, rebuilt from `RoomDef.breakableBlocks` every time `loadRoomHazards` runs. Leaving and re-entering a room, or reloading the campaign, respawns every fragile custom block (1×1 and 2×2 alike) — there is no persistent "broken" flag written back into room JSON or campaign save state. This matches the explicit constraint against inventing new persistent campaign mutation for custom blocks.

### Tests (Phase 2B)

New file `src/tests/customBlocksPhase2B.test.ts` (24 tests, grouped into 5 `describe` blocks), plus 2 updated assertions in `src/tests/customBlockProperties.test.ts` (the `fragileRequires1x1`/"2x2 fragile is flagged incompatible" test and the `isEligibleForBreakablePathway` 2×2 test, both flipped from "rejected" to "accepted" since that is the exact limitation this phase removes — no other Phase 2A test was touched):

1. **Compatibility rule relaxation** (tests 1–8): solid 2×2 fragile now has zero compatibility issues; solid 1×1 fragile unchanged; `nonSolid`/`oneWay` + fragile still blocked by `fragileRequiresSolid` regardless of footprint; `nonSolidNoFriction` still fires independent of footprint; `isEligibleForBreakablePathway` returns `true` for 2×2 solid+fragile; `validateAndResolveCustomBlockProperties` no longer falls back 2×2 solid+fragile to indestructible, but still does for non-solid 2×2 fragile.
2. **`editorRoomBuilder` grouping** (tests 9–14, real `editorRoomDataToRoomDef` calls, not mocks): 1×1 fragile still yields exactly one ungrouped cell; 2×2 fragile yields exactly 4 cells at the correct 4 coordinates sharing one group id with no plain wall generated; two touching 2×2 placements of the *same* definition get two distinct group ids; fragile+slippery threads `blockTheme: 'ice'` onto the breakable cell while fragile+default leaves it `undefined`; a placement referencing an unregistered/missing block ID falls back to one full-footprint solid wall, not a breakable entry.
3. **Atomic destruction transaction** (tests 15–20, real `createWorldState` + `loadRoomHazards` + `applyHazards`): 1×1 fragile destruction is unchanged; striking **any** of the 4 cells (parametrized over all 4 offsets) destroys all 4 atomically; destruction zeroes collision (`wallWWorld`/`wallHWorld`) for all 4 corresponding walls; two adjacent same-definition 2×2 placements remain independently destructible (striking one leaves the other's 4 cells untouched); calling `applyHazards` multiple times in the same tick after destruction is idempotent (`assert.doesNotThrow`, flags stay at 0); a player below the momentum threshold does not break any cell.
4. **Renderer suppression** (test 21): a broken 2×2 placement (anchor cell inactive) is not drawn at all, exercising the real `renderCustomBlockSprites`.
5. **Backward compatibility** (tests 22–24): a hand-built `RoomBreakableBlockDef` with no `groupId`/`blockTheme` fields at all loads via `loadRoomHazards` without throwing, resolves to group `-1`, and still breaks correctly under `applyHazards`; clearing the sprite cache (simulated campaign switch) and re-registering the same block ID under different properties fully replaces the old entry with no leakage; a spot-check that base Phase 2A compatibility rules (solid/oneWay/nonSolid, `nonSolidNoFriction`) still hold.

### Manual Validation (Honest Status)

- **Automated**: `npx tsc --noEmit`, `npm run lint`, `npm test` (821/821 passing, 0 pre-existing failures, 2 Phase 2A tests updated to reflect the now-intended 2×2-fragile-is-compatible behavior), and `npm run build` were all actually run for this phase, and all passed.
- **Not performed**: no manual verification was done in an actual running game or editor session (no live browser/editor click-through of creating a 2×2 fragile block, placing it, running into it from each of the 4 sides in the real renderer, saving/reloading a real campaign file, or exercising undo/redo/copy-paste/duplicate/delete through the actual editor UI). All verification of gameplay behavior (atomic destruction, collision removal, renderer suppression, friction theming, backward compatibility) was done through the automated test suite described above (`src/tests/customBlocksPhase2B.test.ts`), which exercises the real `editorRoomDataToRoomDef`, `loadRoomHazards`, `applyHazards`, and `renderCustomBlockSprites` code paths (not mocks of them) but does not drive an actual UI or rendered frame.
- Anyone relying on this phase for a real campaign should manually place a 2×2 fragile block in the editor, save, reload, and break it in-game from each side before shipping, since that end-to-end path has not been clicked through by a human or an automated UI driver.

### Remaining Limitations

1. **No true persistence of broken state across room reload** (by design — matches built-in behavior; see above).
2. **Group ids are per-room and stored in an `Int16Array`** — in practice bounded by `MAX_BREAKABLE_BLOCKS` (32 total breakable-block cells per room today, in `src/sim/worldHazardState.ts`), which is the real ceiling on how many 2×2 fragile blocks (8 cells each including a same-room neighbor) plus 1×1 fragile/built-in breakable blocks can coexist in one room, not the much larger Int16 range.
3. **No dedicated break particle/sound effect exists yet for breakable blocks of any kind** (built-in or custom) — Phase 2B preserves whatever the engine already does (nothing beyond the visual disappearance) rather than inventing one.
4. **Renderer broken-detection is still a position match** (limitation #3 above, inherited from Phase 2A) — now also relied upon for 2×2 anchor-cell lookup; still safe because anchor-cell coordinates are unique per placement.

### Proposed Phase 2C: Additional Engine-Defined Properties (Not Implemented)

| Property | Type | Description |
|----------|------|-------------|
| `damageOnContact` (hazard/damage preset) | enum tier, not a raw number | Reuses existing damage constants at a small number of tiers. |
| `windResponse` | enum tier | Scale factor for wind-particle interaction near this block, from a fixed set of presets. |
| `liquidInteraction` | `'seal' \| 'drain' \| 'none'` | How liquids behave when adjacent to this block. |
| `materialResponse` | `'stone' \| 'wood' \| 'metal'` | Sound and particle effect category on impact — this is also where a first real per-break effect (see "Remaining Limitations" #3) would naturally land. |
| Trigger behavior | — | Firing an event/transition when the player touches or breaks the block. |
| More breakability profiles | `'dust' \| 'projectile'` | Weakness to specific damage sources, mirroring `CrumbleVariant`. |
| Break resistance tiers | enum tier | Multiple momentum thresholds instead of the single existing constant, still validated against a fixed enum, not an arbitrary number. |

None of these would be executable code; all would be validated against a strict enum (never an arbitrary numeric range) and interpreted by the engine, following the same registry pattern as Phase 2A/2B.
