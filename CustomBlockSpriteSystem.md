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

## Test Results

Phase 1B adds 59 deterministic unit tests in `src/tests/customBlocks.test.ts` covering:

- Path safety (URL, UNC, null byte, control chars, traversal)
- Stable ID semantics (rename preserves ID, duplicate creates new ID)
- RGBA round-trip fidelity (all 256 alpha values, transparent pixels, 2×2)
- Validation error cases (bad id, bad name, wrong schema, invalid colors, wrong dimensions)
- 2×2 validation and parsing
- Reconciliation (unused blocks, missing references, room lists)
- Usage scanning (scanCustomBlockUsage, countCustomBlockUsage)
- Blank and missing-texture pixel data
- Older campaigns without custom blocks

Total test suite: **737 tests, 0 failures**.

---

## Known Limitations

1. **Gameplay sprite overlay not yet implemented.** Custom blocks register their sprites at gameplay start, but the gameplay room renderer (snapshot/cluster pipeline) does not yet draw the custom sprites over the wall tiles. Custom blocks appear as solid `blackRock` walls during gameplay. The sprite cache is populated and ready; a future phase can add a post-wall-render overlay pass.

2. **Unsaved-change dialog not integrated.** The pixel editor does not hook into the project's save/discard/cancel dialog when the user closes the editor with unsaved changes (clicking Cancel simply discards edits). A formal unsaved-change flow requires the editor modal to participate in the global history system.

3. **Undo history is bounded at 50 but not per-block isolated.** The undo stack is local to one open dialog session; it is always empty when the dialog opens.

4. **No cross-campaign ID namespace collision detection.** If two campaigns define the same block ID, exporting them together (not currently possible) would be ambiguous.

5. **Symlink escape is not checked.** `isSafeCampaignRelativePath` does not check for symlinks; this requires OS-level path canonicalization that is not available in the browser context.

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
