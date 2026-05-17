# Performance Optimization Decisions

## BUILD 350 — gameRender modular refactor

### Performance-related changes made

1. **Preserved allocation-free adaptive quality path while extracting logic**
   - **System:** `src/screens/gameRender.ts` → `src/screens/gameRenderQuality.ts`
   - **What changed:** Moved quality-tier resolution and adaptive reduction logic into `applyRenderQualitySettings`, keeping the module-level `_adaptiveQcScratch` object and `_lastChunkCacheQuality` cache key behavior.
   - **Why safe:** The same fields are written with the same formulas and thresholds as before, and all side effects (`setQualityParams`, sunbeam toggles/density, dust caps, chunk-cache memory caps) run in the same frame order.
   - **Category:** Reduces allocations / prevents unnecessary recomputation (preserved existing no-allocation strategy and quality-change-only cache cap updates).

2. **Preserved quality-change-only chunk-cache memory updates**
   - **System:** wall/background chunk cache budget controls
   - **What changed:** Kept the quality-key gate (`graphicsQuality` + adaptive tier) so cache memory limits are only reapplied when the tier changes.
   - **Why safe:** No runtime behavior change; avoids redundant setter churn each frame.
   - **Category:** Reduces repeated work / improves caching behavior.

3. **Preserved single-pass scene-light occluder invalidation policy**
   - **System:** `src/screens/gameRender.ts` → `src/screens/gameRenderSceneLighting.ts`
   - **What changed:** Moved scene-light pass logic into `renderSceneLightingPass` while keeping `_lastLightingRoomId` and marking occluders dirty only on room-id change.
   - **Why safe:** Same room-change detection and wall projection math; lighting rendering inputs are unchanged.
   - **Category:** Prevents unnecessary recomputation.

### Performance opportunities noticed but not implemented

1. `renderSceneLightingPass` still allocates a mapped wall array when room changes (`currentRoom.walls.map(...)`). This is infrequent and currently acceptable, but could be replaced with a reusable scratch buffer if room-switch spikes become visible.
2. `src/screens/gameScreen.ts` remains the largest runtime file and likely still has opportunities for further low-risk extraction of orchestration-only logic.
3. `src/editor/editorController.ts` is still very large and could benefit from additional module extraction for non-hot-path editor UI/controller concerns.

### Risky optimizations intentionally avoided

1. Did **not** alter render ordering, blend/composite sequence, or clip behavior, since that could change visual output.
2. Did **not** change snapshot shapes, save/campaign schemas, or editor serialization paths.
3. Did **not** introduce new caching/pooling structures in hot paths beyond existing patterns, to avoid subtle behavior or invalidation bugs.

## BUILD 351 — gameScreen editor-backdrop extraction

### Performance-related changes made

1. **Extracted editor-consumption render path into a dedicated module without changing draw order**
   - **System:** `src/screens/gameScreen.ts` → `src/screens/gameScreenEditorBackdrop.ts`
   - **What changed:** Moved the editor-mode backdrop render block (world background, walls/hazards/entities, tomb effects, particle fallback, upscale, and debug overlay) into `renderEditorBackdrop`.
   - **Why safe:** The same render functions are called in the same sequence with the same inputs and debug flags; only call location changed.
   - **Category:** Improves maintainability while preserving rendering efficiency.

2. **Preserved zero-extra-pass behavior in editor mode**
   - **System:** editor mode render branch in gameplay frame loop
   - **What changed:** Kept single backdrop pass + single upscale + optional WebGL overlay + bloom composite exactly as before.
   - **Why safe:** No new intermediate passes or repeated composites were introduced.
   - **Category:** Prevents unnecessary repeated work.

### Performance opportunities noticed but not implemented

1. `renderEditorBackdrop` still invokes `performance.now()` separately for procedural background effects in editor mode; this is low impact and was left untouched for behavior parity.
2. `gameScreen.ts` still contains a very large frame/update loop and room-load generator; additional extraction opportunities remain.

### Risky optimizations intentionally avoided

1. Did **not** merge or reorder editor backdrop draw calls, to avoid visual/debug parity regressions.
2. Did **not** alter editor update gating or input consumption semantics.

## BUILD 352 — gameScreen dialogue-setup extraction

### Performance-related changes made

1. **Moved room-load dialogue visit setup into shared dialogue handler module**
   - **System:** `src/screens/gameScreen.ts` → `src/screens/gameDialogueHandler.ts`
   - **What changed:** Extracted Phase E dialogue reset + trigger-conversation pre-conversion into `prepareRoomDialogueVisitState(...)`.
   - **Why safe:** The same operations execute during room load with the same data shape; only orchestration location changed.
   - **Category:** Maintainability refactor while preserving hot-path allocation strategy.

2. **Preserved no-allocation trigger checks in frame loop**
   - **System:** dialogue trigger detection in `checkDialogueTriggers(...)`
   - **What changed:** Kept pre-converted `cachedRoomConversations` as the frame-loop input; conversion still occurs only on room load.
   - **Why safe:** Per-frame trigger checks still read cached objects and do not allocate in the hot path.
   - **Category:** Prevents unnecessary per-frame allocations.

### Performance opportunities noticed but not implemented

1. Conversation cloning during room load still allocates nested entry arrays by design for runtime isolation; this remains acceptable because it is outside the frame hot path.
2. `gameScreen.ts` still contains large transition and tick orchestration blocks that can be extracted in future low-risk passes.

### Risky optimizations intentionally avoided

1. Did **not** alter trigger-fire semantics (once-per-visit behavior, room-load reset timing).
2. Did **not** change dialogue renderer timing or active-conversation lifecycle.

## BUILD 353 — gameScreen cloak-update extraction

### Performance-related changes made

1. **Moved per-frame cloak update into a dedicated helper module**
   - **System:** `src/screens/gameScreen.ts` → `src/screens/gamePlayerCloakUpdate.ts`
   - **What changed:** Extracted the `updatePlayerCloaks(...)` function that drives `PlayerCloak` and `PhantomCloakExtension` each render frame using render-interpolated player position.
   - **Why safe:** The function has no return value and mutates only the two renderer objects; interpolation logic and guard conditions are preserved identically.
   - **Category:** Maintainability refactor — zero change to per-frame allocation profile or render output.

2. **Preserved render-interpolated position usage**
   - **System:** cloak animation in `gamePlayerCloakUpdate.ts`
   - **What changed:** `cloakInterpXWorld`/`cloakInterpYWorld` are still computed as the blend between `prevClusterPosX[0]`/`prevClusterPosY[0]` and the post-tick position using `renderAlpha`.
   - **Why safe:** This blend avoids the one-tick visual lead that causes cloak jitter at >60 Hz refresh rates.
   - **Category:** Correctness preservation — no performance delta.

### Performance opportunities noticed but not implemented

1. `gameScreen.ts` still contains the fixed-tick physics loop with per-tick crumble-block debris event scanning that could be extracted in a future low-risk pass.
2. `editorController.ts` update() function is closure-heavy and difficult to decompose without threading many parameters.

### Risky optimizations intentionally avoided

1. Did **not** change the render-interpolation formula.
2. Did **not** alter the guard condition (alive + player flag) for the update.

## BUILD 354 — Crumble debris event tick extraction

### Performance-related changes made

1. **Moved per-tick crumble event scan into a dedicated helper module**
   - **System:** `src/screens/gameScreen.ts` → `src/screens/gameCrumbleDebrisEvents.ts`
   - **What changed:** Extracted `tickCrumbleDebrisEvents(...)` that scans crumble-block state and drives `CrumbleDebrisRenderer` each tick.
   - **Why safe:** Pure move — same scan loop, same `update(dtMs)` call, same state mutation via the same pre-allocated arrays. No allocation added.
   - **Category:** Maintainability refactor — zero change to per-tick allocation profile.

2. **Preserved pre-allocated Uint8Array prev-state pattern**
   - `prevCrumbleActive` and `prevCrumbleHits` remain `Uint8Array` allocated once at game start, passed by reference, mutated in-place per tick.
   - **Category:** Correctness preservation — no performance delta.

### Performance opportunities noticed but not implemented

1. The fixed-step accumulator loop still captures cluster prev-positions and falling-block prev-offsets inline; these may be extracted in a future maintainability pass.
