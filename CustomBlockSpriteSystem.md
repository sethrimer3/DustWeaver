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

## Future Predefined Properties

A later version could add engine-defined preset properties to custom blocks without changing the core sprite system. These would be additional optional fields in `CustomBlockSourceDef` validated at parse time.

Candidate properties (document only — not implemented):

| Property | Type | Description |
|----------|------|-------------|
| `friction` | `number` | Surface friction coefficient (0–1). Affects sliding. |
| `breakability` | `'none' \| 'dust' \| 'projectile'` | Whether dust or projectiles can chip the block. |
| `damageOnContact` | `number` | Damage dealt to the player each frame of contact. |
| `materialResponse` | `'stone' \| 'wood' \| 'metal'` | Sound and particle effect category on impact. |
| `windResponse` | `number` | Scale factor for wind-particle interaction near this block. |
| `liquidInteraction` | `'seal' \| 'drain' \| 'none'` | How liquids behave when adjacent to this block. |

None of these properties would be executable code; all would be validated against a strict enum or numeric range and interpreted by the engine.
