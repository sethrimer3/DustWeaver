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
