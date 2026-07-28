# Current Status

Last updated by AI repo Bible pass. Verify against source before relying on any detailed implementation claim.

## Project state

DustWeaver is an active TypeScript/Vite game with Electron development support. The current source and docs describe a deterministic particle/cluster-based action platformer/metroidvania-style game with custom campaign/editor support, lazy room loading, room transitions, render chunk caching, resident-room work, and compact room data formats.

The top-level `README.md` is broad and older in some gameplay details, but still useful for core simulation/rendering principles: fixed-step deterministic simulation, snapshot-based rendering, particle/cluster entities, and layer separation. `nextSteps.md`, `docs/decisions/performanceOptimizationDecisions.md`, and `docs/render-chunk-prewarming.md` are more useful for recent room-loading and performance work.

## Recent implementation status

### BUILD 555 snapshot integration

BUILD 555 completes the missing Bow/Sword scalar integration across both allocating and reusable simulation-to-render snapshots. BUILD 554's restored Bow and Sword runtime/render systems did not compile in the final tree because their renderer-required fields were absent from `WorldSnapshot`.

### Room transition and loading performance

Recent work has focused on making room transitions nearly instant and avoiding large-room freezes.

Completed or present according to current docs/source:

- Per-transition profiler and dev globals such as `__dwTransitionStats`, `__dwBenchTransition`, and `__dwBenchPingPong`.
- `computeRenderStateKey` memoization in `roomRenderCacheStore.ts`.
- Prepared room runtime cache with room wall templates, edge extension, ambient blocker keys, dark blocker keys, and wall decorations.
- Async room-transition fallback through a phased load generator.
- Decode-aware room sprite/background preloading.
- Idle-time render chunk prewarming and zero-copy adoption on room entry.
- Complete boundary walls plus independent trigger strips instead of boundary holes.
- Baked wall templates persisted through room JSON and preferred at runtime.
- Incremental wall-template fallback for large wall-template work.
- Resident world/room work, including resident world builder, resident manager, player transfer, and zone resident loader entry points.

### Room data and schema compression

Recent room-data work includes compact schema v3 storage for 1x1 walls, water/lava layers, ambient blockers, background layers, and baked wall template preservation. Old v2/v3 legacy fields are intended to remain readable through the hydrator. Audit and round-trip validation helpers exist for room data correctness.

### Editor

Palette previews were added broadly across current palette categories. Some enemies still use procedural previews because no sprite asset exists. Crumble/falling block preview helper logic exists, but corresponding palette entries may not exist yet.

### Electron/local development

`package.json` scripts include `--no-sandbox` for Electron local development. `.nvmrc` is noted in `nextSteps.md` as pinning Node 22. Use current repo files to verify before changing runtime requirements.

## Known issues / incomplete work

High-confidence from current docs:

- In-browser transition timing still needs capture. Node-side tests/builds are not a substitute for live transition stats.
- The next transition bottleneck should be selected based on measured phases from `__dwTransitionStats()` / `__dwBenchPingPong()`.
- Possible remaining bottlenecks include first-entry resident wall-template builds on very large rooms, sprite/background decode on first room entry, and dense grid allocation/memory concerns in huge sparse rooms.
- `evictStalePrewarmedChunks` (`src/screens/roomRenderChunkWarmScheduler.ts`) already enforces a per-quality memory budget with radius/size-ordered eviction; this is implemented and tested, not a stub.
- Radius-3 chunk warming is not fully adaptive yet; it gates primarily on high graphics mode and could be improved with frame-time gating.
- Prewarm panel exposure in pause-menu debug UI may still be missing.
- Editor palette previews for some enemies remain procedural until assets are added.
- (Resolved BUILD 559) Crumble/falling block palette entries were investigated and deliberately not added — superseded by the Block Modifier panel in `editorUI.ts`, which lets any eligible block item place as crumble or falling. See `docs/Todo.md`.
- CI build smoke testing is not documented as present; adding GitHub Actions for `npm ci && npm run build` remains a likely follow-up.

User-known issues to verify before editing:

- World-map sketch rendering can regress when removing outside room-edge artifacts.
- Ultra ice behavior may still need polish: wall contact should stop slip, touching ultra ice should reset grapple, and stuck zero-velocity on ice should return control.
- Desired long-term direction is to keep rooms within a world/zone loaded or resident/frozen, with longer loading only between zones.

## Current priorities

1. Capture real browser transition timings with `__dwBenchPingPong(roomA, roomB, iterations)` and inspect `__dwTransitionStats(n)`.
2. Use measured phase data to choose the next bottleneck rather than guessing.
3. Preserve transition safety: complete boundary walls, trigger strips, baked/cache-first wall templates, resident activation semantics, and map sketch correctness.
4. Harden resident-room/zone-loaded architecture toward the desired world/zone residency model.
5. Keep editor docs/tools current as palette, room schema, and campaign authoring evolve.

## Caveats

- This status was created from targeted source and documentation inspection, not a full exhaustive tree crawl.
- Some top-level README gameplay description may be older than the current metroidvania/room-transition architecture. Prefer current source and recent planning docs for implementation decisions.
- Any file map or status note here should be updated when an agent discovers source drift.
