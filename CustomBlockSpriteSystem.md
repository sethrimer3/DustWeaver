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

## Phase 2C: Material-Response Presets and Break Feedback

Phase 2C adds the first real break sound and break particle effect for the
breakable-block system (built-in and custom alike), gated by a new
engine-defined `materialResponse` property. Resolves "Remaining Limitations"
#3 from Phase 2B ("No dedicated break particle/sound effect exists yet").

### Final Property Shape and Default

```json
{
  "properties": {
    "collision": "solid",
    "friction": "default",
    "breakability": "fragile",
    "materialResponse": "stone"
  }
}
```

`materialResponse` is a strict enum — `'stone' | 'wood' | 'metal'` — added to
`CustomBlockProperties` (`src/levels/customBlockProperties.ts`) alongside
`collision`/`friction`/`breakability`. No schema version bump:
`CUSTOM_BLOCK_SCHEMA_VERSION` stays `2`. Defaults to `'stone'`:

- Schema-v1 blocks (no `properties` object at all).
- Schema-v2 blocks saved before Phase 2C (`properties` present, `materialResponse` absent).
- Unregistered/missing custom block definitions (`DEFAULT_CUSTOM_BLOCK_PROPERTIES`).
- Built-in (non-custom-block) breakable blocks authored directly in a room, which have no `materialResponse` field on `RoomBreakableBlockDef` at all.

Unknown values (e.g. `"materialResponse": "diamond"`) never crash — they
produce a structured `CustomBlockValidationError` (`field:
'properties.materialResponse'`) via `validateAndResolveCustomBlockProperties`
and fall back to `'stone'`, exactly mirroring how an unknown `collision` or
`breakability` value is handled. Saving through the editor always writes the
resolved value explicitly (via `serializeCustomBlock`), never omits it.

Room placements are unaffected: a room only ever references a custom block by
its stable ID (`"custom:<id>"`); `materialResponse` lives entirely in the
block **definition**, resolved once and cached, never duplicated per
placement in room JSON.

### Material Registry Design

`MATERIAL_RESPONSE_PRESET_REGISTRY` (`src/levels/customBlockProperties.ts`) is
the single authoritative source of labels/descriptions, following the exact
`PresetMeta<T>` shape already used by `COLLISION_PRESET_REGISTRY` /
`FRICTION_PRESET_REGISTRY` / `BREAKABILITY_PRESET_REGISTRY`:

| Preset | Label | Description |
|---|---|---|
| `stone` | Stone | Heavy stone-like break sound and rocky debris. |
| `wood` | Wood | Lighter wooden crack and splinter-like debris. |
| `metal` | Metal | Metallic impact and spark-like debris. |

Two small numeric-packing helpers, `materialResponseToIndex` /
`indexToMaterialResponse`, map the enum to/from a `0|1|2` index for
`Uint8Array` storage in `WorldState` (`world.breakableBlockMaterial`,
`world.breakEventMaterial`) — the same pattern `blockThemeToIndex` already
uses for wall themes. Unknown indices decode back to `'stone'`.

`materialResponse` is selectable on **indestructible** blocks too (no
compatibility rule blocks it) so it is already resolved and cached for a
future impact-feedback phase — but in Phase 2C no break event is ever emitted
for a block that never enters the breakable pathway in the first place
(`isEligibleForBreakablePathway` still requires `breakability === 'fragile'`
+ solid collision + a 1×1/2×2 footprint, unchanged from Phase 2B).

### Editor Integration

- A **Material response** dropdown was added to the custom-block dialog's
  existing Properties section (`editorCustomBlockDialog.ts`), built with the
  same generic `makePropertyRow` helper the other three properties use — no
  new UI plumbing.
- `propertiesEqual` (drives dirty-state detection) now also compares
  `materialResponse`, so a materialResponse-only change is correctly flagged
  dirty and triggers the existing Save/Discard/Keep-Editing prompt on cancel.
- Undo/redo is unaffected structurally: each undo/redo stack entry is already
  `{ pixelData, properties }` — since `materialResponse` lives inside
  `properties`, it is captured and restored for free.
- Rename (`onRenameCustomBlock`) and Duplicate (`onDuplicateCustomBlock`) in
  `editorController.ts` both pass `def.properties` straight through
  `serializeCustomBlock`, so `materialResponse` is preserved by rename and
  copied (with a newly generated stable ID) by duplicate with zero
  materialResponse-specific code.
- The palette card badge (`editorUI.ts`) now appends ` · Stone` / ` · Wood` /
  ` · Metal` alongside the existing collision/friction/breakability badges.

### Runtime Profile and the Sprite-Rebuild Optimization

`materialResponse` is resolved and validated exactly once, in the same place
as the other three properties — inside `validateAndResolveCustomBlockProperties`,
called from `parseCustomBlockSource` at block-registration time
(campaign load, block create, block edit). The simulation loop never parses
or re-validates properties; `src/sim/hazards.ts` only ever reads a packed
`Uint8Array` index that was resolved ahead of time by `gameRoomHazards.ts` at
room-load time.

A materialResponse-only edit does not rebuild the pixel sprite: previously
*any* saved edit (pixel or property) called `invalidateCustomBlockSprite`,
which deletes and rebuilds the cached `OffscreenCanvas`/`HTMLCanvasElement`
and re-uploads pixel data, even if only a dropdown changed. Phase 2C adds
`updateCustomBlockProperties(rawId, properties)` to
`customBlockSpriteCache.ts`, which replaces only the cached `properties`
field on the existing sprite entry, leaving the canvas object untouched.
`editorController.ts`'s `onEditCustomBlock` now byte-compares the saved
pixel data against the previous definition's pixel data; if unchanged, it
calls `updateCustomBlockProperties` instead of
`invalidateCustomBlockSprite`/`registerCustomBlockSprite` (falling back to a
full rebuild if the block was not already cached, so a properties-only save
of an uncached block still ends up registered). Renaming already skipped
sprite invalidation entirely before Phase 2C (unchanged) — it still does.

Campaign switching clears material profiles exactly as it already cleared
collision/friction/breakability: `clearCustomBlockSpriteCache()` empties the
whole property cache, and every hazard array (including the new
`world.breakableBlockMaterial`) is fully repopulated by `loadRoomHazards` on
the next room load — no cross-campaign leakage is possible.

### Break-Event Architecture

Rather than triggering sound and particles directly from every destroyed
breakable-block cell (which would fan out ×4 for a 2×2 group), Phase 2C adds
one small, engine-owned, one-tick break-event queue to `WorldState`
(`src/sim/worldHazardState.ts`):

```
breakEventCount:         number         // reset to 0 at the top of every applyHazards() call
breakEventXWorld/YWorld: Float32Array   // full-footprint center (world units)
breakEventWWorld/HWorld: Float32Array   // full-footprint size (world units)
breakEventMaterial:      Uint8Array     // packed materialResponse index
breakEventGroupId:       Int16Array     // -1 if ungrouped
breakEventIsGroupedFlag: Uint8Array     // 1 if a multi-cell (2x2) placement
```

Bounded by `MAX_BREAK_EVENTS = 8` — generous for anything a single
player-sized AABB could plausibly overlap in one tick; overflow events are
silently dropped since they are purely cosmetic and never affect collision or
destruction state.

`applyHazards` (`src/sim/hazards.ts`) is the **only** writer, via a small
`emitBreakEvent(...)` helper called at exactly the point where a cell's
destruction transaction begins — reusing the already-established atomic
group-destroy transaction from Phase 2B, not a new one:

- **1×1 (ungrouped)**: one event, centered on the cell, footprint =
  `BLOCK_SIZE_MEDIUM × BLOCK_SIZE_MEDIUM`.
- **2×2 (grouped)**: the struck cell scans every cell sharing its `groupId`
  (all of which are guaranteed still active — the group is atomic, so it is
  either fully intact or fully destroyed) to compute the union AABB *before*
  any cell is deactivated, emits **one** event covering the complete
  placement, and only then proceeds to destroy all 4 cells. The struck cell
  is the one that "owns" the emission — matching the requirement that the
  cell which first initiates group destruction owns the one effect.

The consuming side (`src/screens/gameBreakEvents.ts`, called once per
physics tick from the same fixed-step accumulator loop that already drives
`tickCrumbleDebrisEvents`) drains the queue: for each event it converts the
packed material index back to `'stone'|'wood'|'metal'`, spawns particles via
`BreakEffectRenderer.notifyBreak`, and plays the mapped sound via
`PlayerSfxManager.play`. This pathway is not exposed to campaign-authored
code in any way — it is pure `WorldState` → render-layer plumbing.

**Duplicate/re-entrant safety**: the outer per-cell
`isBreakableBlockActiveFlag[i] === 0` guard (unchanged from Phase 2B) means a
cell already destroyed this tick or a previous tick can never re-enter the
branch that calls `emitBreakEvent`, so repeated `applyHazards` calls on an
already-broken placement emit zero additional events. **Adjacent-placement
independence**: events are scoped to one `groupId` at a time, so breaking one
2×2 placement never touches — and never emits an event for — an adjacent
placement, grouped or not.

### Sound Mapping

`src/audio/breakSfx.ts` is a pure, DOM-free, audio-hardware-free selection
boundary — the "testable sound-event selection boundary" alternative to
mocking browser audio globals. It maps each material to an **existing**
`PlayerSfxManager` sound name (no new sound assets were added):

| Material | Reused sound | Rationale |
|---|---|---|
| `stone` | `jump_impact_hard` | Heaviest existing impact — reads as a rock/masonry thud. |
| `wood` | `jump_impact_medium` | A lighter impact than stone — reads as a duller wooden crack. |
| `metal` | `grapple_impact` | The grapple hook's metal-on-surface clink is the closest existing metallic sound in the project. |

All three presets resolve to **distinct** existing assets (no two materials
collapse onto the same sound). `resolveBreakVolumeScale(isGrouped,
concurrentEventCount)` gives grouped (2×2) breaks a modestly higher base
volume than a lone 1×1 cell, and attenuates by `1/√n` (floored at 0.5×) when
multiple break events fire in the same tick, so a pile-up of simultaneous
breaks does not clip or sum into an overloud burst. Sound is played through
the existing `PlayerSfxManager`, so it automatically honors the existing SFX
volume/mute setting (`getSfxVolume()`) and requires no `AudioContext` in
tests — `materialBreakSoundName`/`resolveBreakVolumeScale` are pure functions
tested directly.

### Particle Mapping

`src/render/breakEffectRenderer.ts`'s `BreakEffectRenderer` mirrors the
existing `CrumbleDebrisRenderer` pattern exactly: bounded typed-array pools
(`MAX_DEBRIS = 100`), its own module-local deterministic LCG (never
`Math.random`, never serialized, never read by the simulation), gravity +
gentle gray/tan/spark-colored fade-out. Each material gets a distinct,
bounded, engine-owned profile (`getMaterialParticleProfile`):

| Material | Colors | Feel | Base count (1×1) | Grouped count (2×2) |
|---|---|---|---|---|
| `stone` | gray/brown | compact rocky debris, moderate speed/gravity | 10 | 16 |
| `wood` | tan/brown | small splinter-like debris, slightly lighter gravity | 9 | 14 |
| `metal` | yellow/white/gray | brief fast sparks, low gravity, short lifetime | 8 | 13 |

Grouped (2×2) placements scale up modestly (≈1.6×), never 4× — a pile of 4
cells' worth of destruction reads as "one bigger event," not four
independent bursts layered on top of each other. `resolveBreakParticleCount`
is a pure function (material, isGrouped, quality) → count, directly
unit-tested without a canvas or renderer instance.

Effects are purely cosmetic: `notifyBreak`/`update`/`render` never touch
`WorldState`, collision, damage, movement, or room persistence.

### Low-Graphics Behavior

`resolveBreakParticleCount` scales the base/grouped count by the active
`GraphicsQuality` tier (`getGraphicsQuality()`, `'low'|'med'|'high'`):
`low` → ×0.4, `med` → ×1.0 (baseline), `high` → ×1.3. This visibly reduces
(never increases beyond a modest bump) cosmetic particle output on `low`
while leaving sound behavior unaffected (sound is not part of "reduced
particles"). Sound already respects the game's existing volume/mute
settings via `PlayerSfxManager`.

### 1×1 and 2×2 Effect Behavior Summary

| | 1×1 fragile | 2×2 fragile |
|---|---|---|
| Break events emitted | 1 | 1 (never 4) |
| Event center | cell center | union-footprint center of all 4 cells |
| Event footprint | 1 block × 1 block | 2 blocks × 2 blocks |
| Sound plays | once | once |
| Particle burst | `baseCount` | `groupedCount` (≈1.6×, not 4×) |
| Adjacent placements | independent | independent (scoped by `groupId`) |

### Backward Compatibility

- Schema-v1 blocks, and schema-v2 blocks saved before Phase 2C, load exactly
  as before and resolve `materialResponse` to `'stone'` with zero validation
  errors (absence is not an error — only an explicit unknown value is).
- All existing stable IDs, room references, 1×1/2×2 fragile behavior,
  indestructible/non-solid/one-way/slippery behavior, and built-in breakable
  blocks are unchanged in every respect except that breaking now produces
  sound + particles where previously nothing happened.
- The break momentum threshold (`BREAKABLE_MOMENTUM_THRESHOLD_WORLD`) and the
  absence of resistance tiers are both unchanged, per this phase's scope.
- Room reload semantics are unchanged: broken blocks (and their break-event
  cosmetic history, which is transient and per-tick anyway) respawn on
  reload, exactly matching Phase 2B.
- Export and campaign relocation preserve `materialResponse` through the
  ordinary `serializeCustomBlock` → `parseCustomBlockSource` round trip — no
  special-cased persistence was added.

### Tests (Phase 2C)

New file `src/tests/customBlocksPhase2C.test.ts` (27 tests) exercises the
real pipeline (`editorRoomDataToRoomDef` → `loadRoomHazards` → `applyHazards`)
wherever practical, not just registry helpers — schema-v1/v2 defaults, all
three presets round-tripping through `serializeCustomBlock`/
`parseCustomBlockSource`, unknown-value fallback with a structured
diagnostic, dirty-tracking/undo-redo/rename/duplicate at the data-model level
(the pixel-art dialog itself is DOM-driven and, consistent with the rest of
this suite, is not exercised via a browser DOM stub), the real break-event
queue for 1×1 and all four struck-cell offsets of a 2×2 group, exact
union-footprint center/size assertions, duplicate-destruction and
adjacent-placement independence, distinct sound/particle profile selection,
bounded and quality-scaled particle counts, indestructible blocks emitting no
event, missing-definition fallback, export/relocation round trip, and
campaign-switch isolation. Two pre-existing Phase 2A round-trip-equality
assertions in `customBlockProperties.test.ts` (tests 2 and 17) were updated
to include `materialResponse: 'stone'` in their expected literal, since the
resolved property bundle now legitimately has one more field — no other
Phase 2A/2B test was touched, and all 848 tests in the suite pass.

### Manual Validation (Honest Status)

- **Automated**: `npx tsc --noEmit`, `npm run lint`, `npm test` (848/848
  passing), and `npm run build` were all actually run for this phase.
- **Not performed**: no manual verification was done in an actual running
  game or editor session — no live browser/editor click-through of creating
  stone/wood/metal 1×1 and 2×2 fragile blocks, breaking them and listening
  for distinct sounds, confirming one burst per logical placement, confirming
  adjacent-block independence, or confirming low-graphics behavior visually.
  All verification was done through the automated test suite exercising the
  real `editorRoomDataToRoomDef`, `loadRoomHazards`, and `applyHazards` code
  paths (not mocks), plus direct unit tests of the pure sound/particle
  selection functions — but no actual audio was heard and no actual frame was
  rendered by a human or automated UI driver.
- Anyone relying on this phase for a real campaign should manually create a
  stone, wood, and metal fragile block (both 1×1 and 2×2), place and break
  each in-game, and confirm the sound/particle feel before shipping.

### Remaining Limitations

1. **No dedicated new sound or particle assets** — all three materials reuse
   existing `PlayerSfxManager` sounds and a generic colored-rectangle debris
   particle; a future phase could commission material-specific assets.
2. **Metal's sound is a reasonable existing-asset proxy, not a purpose-built
   metallic clang** — `grapple_impact` was the closest fit available.
3. **`materialResponse` on indestructible blocks is inert in Phase 2C** — it
   is resolved and cached for a future impact-feedback phase but no event
   fires for a block that is never destroyed.
4. **Break events are transient, one-tick state** — like all Phase 2B
   destruction state, nothing about a break event persists across a room
   reload (matches existing behavior; not a regression).
5. **`MAX_BREAK_EVENTS = 8`** is a hard per-tick ceiling; astronomically
   unlikely to be hit by a single player-sized AABB, but overflow events are
   silently dropped rather than queued.

## Phase 2D: Contact-Damage Presets

Phase 2D adds an engine-defined `contactDamage` property so a solid custom
block can damage the player on contact, reusing the existing hazard damage
pathway verbatim rather than building a second health/damage system.

### The New Property and Defaults

```json
{
  "properties": {
    "collision": "solid",
    "friction": "default",
    "breakability": "indestructible",
    "materialResponse": "metal",
    "contactDamage": "low"
  }
}
```

`contactDamage` is a strict enum — `'none' | 'low' | 'high'` — added to
`CustomBlockProperties` (`src/levels/customBlockProperties.ts`) alongside the
three Phase 2A properties and Phase 2C's `materialResponse`. No schema
version bump: `CUSTOM_BLOCK_SCHEMA_VERSION` stays `2`. Defaults to `'none'`:

- Schema-v1 blocks (no `properties` object at all).
- Schema-v2 blocks saved before Phase 2D (`properties` present, `contactDamage` absent).
- Unregistered/missing custom block definitions (`DEFAULT_CUSTOM_BLOCK_PROPERTIES`).
- Built-in (non-custom-block) breakable/solid blocks, which have no
  `contactDamage` concept at all and are entirely unaffected — `none` is not
  something authors ever see for them, it is simply the absence of the new
  `RoomDef.contactDamageBlocks` mechanism.

Unknown values (e.g. `"contactDamage": "extreme"`) never crash — they produce
a structured `CustomBlockValidationError` (`field: 'properties.contactDamage'`)
via `validateAndResolveCustomBlockProperties` and fall back to `'none'`,
exactly mirroring how an unknown `materialResponse` or `breakability` value
is handled. Saving through the editor always writes the resolved value
explicitly. Room placements are unaffected: a room only ever references a
custom block by its stable ID; `contactDamage` lives entirely in the block
**definition**.

### Registry and Compatibility Rules

`CONTACT_DAMAGE_PRESET_REGISTRY` follows the exact `PresetMeta<T>` shape every
other preset registry uses:

| Preset | Label | Description |
|---|---|---|
| `none` | None | Does not damage the player. |
| `low` | Low | Applies the engine's lower contact-damage preset. |
| `high` | High | Applies the engine's stronger contact-damage preset. |

`contactDamageTierToIndex` / `indexToContactDamageTier` pack the two
*damaging* tiers (`'none'` is never stored — see Runtime Representation
below) into a `0|1` index for `Uint8Array` storage, the same pattern
`materialResponseToIndex` established in Phase 2C.

**Compatibility rule — `contactDamageRequiresSolid`**: `contactDamage !==
'none'` combined with `collision !== 'solid'` (i.e. `oneWay` or `nonSolid`)
is rejected, added to `checkCustomBlockPropertyCompatibility` alongside the
existing `fragileRequiresSolid`/`nonSolidNoFriction`/
`fragileRequiresSupportedFootprint` rules. This keeps Phase 2D entirely on
the existing solid-contact collision pathway rather than adding a new
trigger-volume system for one-way/non-solid blocks. At **save time** the
editor blocks saving and shows the exact issue message (the dialog's
existing `checkCustomBlockPropertyCompatibility`-gated Save button needed no
changes — the new rule flows through the same mechanism). At **load time**
(untrusted/legacy JSON), the combination never crashes: `contactDamage`
safely falls back to `'none'` while `collision` itself is left untouched, and
a diagnostic is recorded.

Both fragile and indestructible solid blocks may use contact damage — there
is no rule linking `contactDamage` to `breakability` (see "Interaction with
Fragile Blocks" below for how the two combine at runtime).

### Editor Integration

- A **Contact damage** dropdown was added to the custom-block dialog's
  Properties section (`editorCustomBlockDialog.ts`), built with the same
  generic `makePropertyRow` helper every other property uses.
- `propertiesEqual` (drives dirty-state detection) now also compares
  `contactDamage`, so a contactDamage-only change is correctly flagged dirty.
- Undo/redo needed no new plumbing: each snapshot is already the full
  `{ pixelData, properties }` object, so `contactDamage` is captured/restored
  for free.
- Rename and Duplicate both pass `def.properties` straight through
  `serializeCustomBlock`, so `contactDamage` is preserved by rename and
  copied (with a newly generated stable ID) by duplicate with zero
  contactDamage-specific code.
- The palette card badge (`editorUI.ts`) now appends ` · Dmg:Low` /
  ` · Dmg:High` (nothing for `none`) alongside the existing badges.
- Invalid combinations (`oneWay`/`nonSolid` + damage) show the exact
  `contactDamageRequiresSolid` message via the dialog's existing
  `refreshCompatibilityMessage`/Save-blocking mechanism — no new UI code.
- No raw damage, knockback, cooldown, or invulnerability number is ever
  exposed in the UI — only the three-value enum dropdown.

### Runtime Representation

`contactDamage` is resolved and validated exactly once, in the same place as
every other property — inside `validateAndResolveCustomBlockProperties`,
called from `parseCustomBlockSource` at block-registration time (campaign
load, block create, block edit). The simulation loop never parses or
re-validates properties; `src/sim/hazards.ts` only ever reads a packed
`Uint8Array` tier index resolved ahead of time by `gameRoomHazards.ts` at
room-load time.

A contactDamage-only edit does not rebuild the pixel sprite: it reuses the
exact `updateCustomBlockProperties` fast path Phase 2C introduced for
materialResponse-only edits — `editorController.ts`'s `onEditCustomBlock`
byte-compares saved pixel data against the previous definition and, if
unchanged, updates only the cached `properties` field, leaving the
`OffscreenCanvas`/`HTMLCanvasElement` untouched. Renaming already skipped
sprite invalidation before Phase 2C/2D — unchanged.

Campaign switching clears damage profiles exactly as it already cleared the
other three properties: `clearCustomBlockSpriteCache()` empties the whole
property cache, and `world.contactDamageBlockCount`/arrays are fully
repopulated by `loadRoomHazards` on the next room load — no cross-campaign
leakage is possible. Missing/unregistered definitions fall back to
`DEFAULT_CUSTOM_BLOCK_PROPERTIES.contactDamage = 'none'` via
`getCustomBlockProperties`.

Because `editorRoomDataToRoomDef` re-resolves each placement's properties
fresh from the sprite cache every time it runs (on export, on resident-room
rebuild, on reopening a room), changing a block definition's `contactDamage`
tier and re-running that conversion automatically updates every placement of
that block — no placement coordinates are rewritten, and no per-placement
cache invalidation is needed.

### Contact-Detection Architecture

Contact damage is **not** derived from a per-frame scan of custom block
placements, and it does not hook into the physics wall-collision resolver
(which does not retain a "which walls were touched this tick" list to begin
with — see the Phase 2D investigation notes below). Instead it follows the
exact same shape every other hazard in `src/sim/hazards.ts` already uses:
`RoomDef.contactDamageBlocks` (`RoomContactDamageBlockDef[]`) is a small,
room-scoped, pre-resolved array — built once by `editorRoomBuilder.ts` from
solid custom-block placements with `contactDamage !== 'none'`
(`isEligibleForContactDamage`), independent of whether the placement is also
fragile — and loaded into bounded `WorldState` arrays
(`MAX_CONTACT_DAMAGE_BLOCKS = 32`) by `gameRoomHazards.ts`. `applyHazards`
then does a plain AABB-overlap check against this small array, exactly like
the existing spike/lava-zone loops: no momentum requirement, no wall-index
lookup, no dependency on sprite pixel data (see "Transparent Pixels" below).

**Investigation findings** (`src/sim/clusters/movementAxisResolvers.ts`,
`movementCollision.ts`): the collision resolver iterates the wall array and
resolves position/velocity per wall every tick, but only records two
booleans (`isTouchingWallLeftFlag`/`isTouchingWallRightFlag`, used for wall
jumps) — it does not retain "which wall index was touched this tick"
anywhere. Reusing that layer directly was not viable without adding new
resolver-side bookkeeping, which risks touching the collision engine itself
(explicitly out of scope). The bounded-array-plus-AABB-check pattern already
used by every other hazard type *is* "the existing collision info" pathway
in this codebase's architecture — it avoids scanning custom block placements
or the full wall array, scanning only the small, pre-resolved
`contactDamageBlockCount` (≤ 32) array instead.

**Damage and knockback mapping** — reuses `applyPlayerDamageWithKnockback`
(`src/sim/playerDamage.ts`) verbatim, the same function every hazard in the
game already calls:

| Tier | Damage points | Existing constant matched | Knockback | Invulnerability |
|---|---|---|---|---|
| `none` | — | — (no array entry created at all) | — | — |
| `low` | 1 | `LAVA_ZONE_DAMAGE` | `applyPlayerDamageWithKnockback`'s existing linear formula (`MIN_DAMAGE_KNOCKBACK_SPEED_WORLD + damage × DAMAGE_KNOCKBACK_SPEED_PER_DAMAGE_WORLD`) | `INVULNERABILITY_DURATION_TICKS` (90 ticks), same as every hazard |
| `high` | 2 | `SPIKE_DAMAGE` | Same formula, proportionally stronger from the higher damage input | Same 90-tick window |

`CUSTOM_BLOCK_CONTACT_DAMAGE_LOW = 1` / `CUSTOM_BLOCK_CONTACT_DAMAGE_HIGH = 2`
(`src/sim/hazards.ts`) are new named constants, but their *values* are not
new — they match the dominant 1/2 damage scale already used by
`LAVA_ZONE_DAMAGE`, `SPIKE_DAMAGE`, and the large majority of enemy
contact-damage constants across `src/sim/clusters/*Config.ts` (surveyed
before choosing these values). No separate knockback or invulnerability
constant was introduced — both come free from `applyPlayerDamageWithKnockback`
simply being called with a damage amount of 1 or 2, identical to how spikes
and lava already produce their own knockback/invulnerability behavior.

**Knockback direction** follows the contacted surface: the source point
passed to `applyPlayerDamageWithKnockback` is the nearest point on the
block's (or, for a grouped placement, the full union) AABB to the player
center — the exact same nearest-point-on-AABB pattern the existing lava-zone
code already uses. This means knockback is never a fixed one-way push; it
reflects whichever side of the block the player is actually touching.

### Logical Placement Ownership and 2×2 Deduplication

`RoomContactDamageBlockDef.groupId` is a new, independent id space
(`src/levels/roomElementDefs.ts`), directly analogous to
`RoomBreakableBlockDef.groupId` from Phase 2B — minted by its own counter in
`editorRoomBuilder.ts` (`nextContactDamageGroupId`), separate from the
breakable-block group counter, since the two arrays are never compared
against each other. A 1×1 damaging placement gets one ungrouped
(`groupId: -1`) entry; a 2×2 damaging placement gets four entries (one per
occupied cell) sharing one group id — **never** inferred by matching
adjacent cells with the same custom block ID, which would incorrectly merge
two separate touching placements of the same definition.

At contact time (`src/sim/hazards.ts`), when the player overlaps any cell of
a grouped placement, the handler scans every cell sharing that `groupId`
(only counting cells still active — see below) to compute the union AABB
*before* deciding on the damage source point, then calls
`applyPlayerDamageWithKnockback` **once** and `break`s out of the scan. This
guarantees:

- Contacting two or more cells of the same 2×2 placement in one simulation
  update still produces exactly one damage attempt, with a source point
  derived from the whole placement's footprint (not whichever single cell
  happened to be scanned first).
- Two adjacent, distinct placements (even of the same underlying block
  definition) never have their cells merged — each keeps its own `groupId`
  and its own damage tier.
- `applyPlayerDamageWithKnockback`'s own `invulnerabilityTicks` gate is the
  ultimate backstop: even if two *different* placements were both contacted
  in the same tick, at most one produces a real effect, since the first
  successful call sets `invulnerabilityTicks` for the rest of the tick (and
  well beyond it) and the scan `break`s after the first overlapping cell
  regardless.

`isContactDamageBlockActiveFlag` deactivates contact-damage cells when their
underlying fragile block is destroyed (see below) — indestructible damaging
blocks simply stay active for the room's lifetime.

### Interaction with Fragile Blocks

A block may combine `breakability: fragile` with `contactDamage: low | high`.
The two properties are independent axes checked by two separate,
uncorrelated array-driven loops in `applyHazards`, run in this order every
tick:

1. **Custom block contact damage** runs first. It is a plain solid-contact
   check with no momentum requirement — the player takes damage on contact
   regardless of speed, exactly like touching a spike.
2. **Breakable blocks** runs second, applying its own unchanged momentum
   threshold (`BREAKABLE_MOMENTUM_THRESHOLD_WORLD`, untouched by this phase)
   to decide whether to perform the existing atomic destruction transaction.

**A real ordering bug was found and fixed while writing this phase's
tests**: `applyPlayerDamageWithKnockback` mutates the player's velocity as
part of its knockback blend. Since the breakable-block section originally
recomputed the player's speed from *current* velocity, a fragile+damaging
block's own knockback could sap enough momentum to make the very same hit
fail the momentum threshold immediately afterward — silently preventing
fragile+damaging blocks from ever breaking on the hit that damaged the
player. The fix: the player's speed is now captured once, immediately before
the contact-damage section runs (`playerSpeedBeforeContactDamage`), and the
breakable-block section uses that captured value instead of recomputing it
post-knockback. This preserves every pre-existing hazard interaction
(spikes/springboards/water/lava still run, and can still affect this
captured speed, exactly as before) while decoupling the momentum check from
contact-damage's own velocity mutation.

With this fix, a fragile+damaging block that is struck fast enough to break
applies its damage **and** breaks in the same tick — one damage attempt, one
atomic destruction, never four damage attempts from a 2×2 group's four
cells. Duplicate/re-entrant calls to `applyHazards` on an already-broken
placement produce neither additional damage nor additional destruction (the
same active-flag and invulnerability guards apply).

### Transparent Pixels

Contact detection is purely position-based (cell center ± half the block
size) — it never reads `pixelData` or alpha values. A fully transparent
custom block (as every registry test in this phase uses, via
`makeBlankPixelData`) damages the player identically to an opaque one;
transparent pixels never create a "safe" hole in the collision/damage
surface.

### Backward Compatibility

- Schema-v1 blocks, and schema-v2 blocks saved before Phase 2D, load exactly
  as before and resolve `contactDamage` to `'none'` with zero validation
  errors.
- All existing stable IDs, room references, collision/friction presets,
  1×1/2×2 fragile behavior, material-response sounds/particles, built-in
  hazards and damage, and export/campaign relocation are unchanged.
- The break momentum threshold is unchanged; no resistance tiers were added.
- Room reload semantics are unchanged: contact-damage cells (like breakable
  cells) are transient `WorldState` arrays rebuilt from `RoomDef` on every
  room load — nothing about "has this block already damaged the player"
  persists across a reload.
- Campaigns with no custom blocks at all are entirely unaffected —
  `room.contactDamageBlocks` is simply `undefined`/absent.

### Tests (Phase 2D)

New file `src/tests/customBlocksPhase2D.test.ts` (33 tests) exercises the
real pipeline (`editorRoomDataToRoomDef` → `loadRoomHazards` → `applyHazards`)
for every damage-application scenario rather than only asserting registry
mappings — schema-v1/v2 defaults, all three presets round-tripping,
unknown-value fallback with a structured diagnostic, the
`contactDamageRequiresSolid` compatibility rule (both directions: editor-save
rejection data and load-time safe fallback), real low/high damage
application via `applyHazards`, proximity-without-collision producing no
damage, sustained multi-tick contact producing only one hit while
invulnerable, grouped 2×2 ownership/deduplication (including adjacent
distinct placements), knockback direction following the contacted side,
transparent-pixel independence, the fragile+damage interaction order (including
the ordering bug fix above), indestructible damaging blocks remaining
present, dirty-tracking/undo-redo/rename/duplicate at the data-model level,
the sprite-cache properties-only update (asserting the cached canvas object
reference is unchanged), and export/relocation and campaign-switch
isolation. Three pre-existing round-trip-equality assertions
(`customBlockProperties.test.ts` tests 2 and 17, and
`customBlocksPhase2B.test.ts` test 24) were updated to include
`contactDamage: 'none'` in their expected literals, since the resolved
property bundle now legitimately has one more field — no other Phase
2A/2B/2C test was touched, and all 881 tests in the suite pass.

### Manual Validation (Honest Status)

- **Automated**: `npx tsc --noEmit`, `npm run lint`, `npm test` (881/881
  passing), and `npm run build` were all actually run for this phase.
- **Not performed**: no manual verification was done in an actual running
  game or editor session for this phase either. As documented in the Phase
  2C section above, this environment's headless Chromium reproducibly stalls
  or crashes on this project's editor/campaign-loading flows — confirmed
  again to be a pre-existing, base-branch-reproducible limitation, not
  something introduced by this phase (see Phase 2C's "Manual Validation"
  section for the investigation). All verification here was done through
  the automated test suite exercising the real `editorRoomDataToRoomDef`,
  `loadRoomHazards`, and `applyHazards` code paths (not mocks) — but no
  actual frame was rendered, no actual collision was observed visually, and
  no actual knockback/damage feedback was seen by a human or an automated UI
  driver.
- Anyone relying on this phase for a real campaign should manually create
  low- and high-damage solid blocks (both 1×1 and 2×2, fragile and
  indestructible), touch each side and the top surface, confirm normal
  invulnerability behavior on sustained contact, place two identical
  damaging blocks beside each other, and confirm material-specific break
  feedback still fires correctly for a fragile+damaging block, before
  shipping.

### Remaining Limitations

1. **No trigger-volume system** — contact damage only applies to solid
   blocks; a future phase could add a genuinely non-blocking damage/trigger
   zone, but that is explicitly out of scope here.
2. **Two fixed tiers only** — no resistance tiers, no per-block numeric
   tuning, no damage-over-time; `low`/`high` map to fixed constants.
3. **Contact-damage cells are transient, room-scoped state** — like
   breakable-block state, nothing persists across a room reload (matches
   existing behavior, not a regression).
4. **`MAX_CONTACT_DAMAGE_BLOCKS = 32`** is a hard per-room ceiling on
   damaging cells, mirroring `MAX_BREAKABLE_BLOCKS`.
5. **The ordering-bug fix (`playerSpeedBeforeContactDamage`) is scoped
   narrowly** — it only changes what velocity the breakable-block section
   reads for its momentum check; it does not change how spikes, springboards,
   water, or lava zones interact with each other or with breakable blocks,
   preserving all pre-existing hazard-ordering behavior.

## Proposed Phase 2E: Wind-Response Presets (Not Implemented)

Recommendation: **wind-response presets**, ahead of break-resistance tiers
and liquid-interaction presets, should be the next phase — with a caveat
(see below).

- **Break-resistance tiers** were the natural next step after Phase 2C but
  are now largely covered in spirit by this phase's damage tiers; a true
  resistance-tier phase would mean multiple momentum thresholds instead of
  the single existing constant. This is well-defined and low-risk (still a
  fixed enum, no raw numbers), but is the least visually interesting of the
  three remaining candidates and would mostly matter for advanced level
  design (blocks that need a running start vs. a sprint-dash to break) —
  reasonable, but not obviously more valuable than wind response.
- **Wind response** reuses the existing wind-particle force system
  (`pixelMaterialMovementWind.ts`, `environmentalDust`) the same way
  `materialResponse` reused `PlayerSfxManager`/`CrumbleDebrisRenderer` and
  `contactDamage` reused `applyPlayerDamageWithKnockback` — a bounded enum of
  wind-interaction presets (e.g. `none | blocksWind | deflects`) mapped to
  existing force/occlusion behavior, with no new physics engine. It is
  purely cosmetic/environmental (does not touch player health or collision),
  making it a lower-risk phase than a damage-adjacent one.
- **Liquid interaction** (`'seal' | 'drain' | 'none'`) reaches into the
  water-zone buoyancy system, which is more architecturally entangled (it
  drives player movement physics directly, not just a cosmetic layer or a
  contact-damage check), and is more likely to interact unexpectedly with
  the existing water-zone/frozen-zone mechanics than wind response would.

Caveat: unlike Phase 2A→2D, none of these three remaining candidates has as
clean and obvious a reuse target as `applyPlayerDamageWithKnockback` was for
this phase — whichever is chosen next should start with the same
investigation-first approach (locate the existing wind/liquid system,
document its constants and integration points) before committing to a
property shape, since the "right" existing pathway to reuse is less
obvious for wind/liquid than it was for damage.

Not implemented in this phase — no code changes were made toward it.

Not implemented in this phase — no code changes were made toward it.
