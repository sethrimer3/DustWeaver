# Room Loading Optimizations

Last reviewed: 2026-07-03

This document consolidates room-loading and room-transition optimization work that has been discussed, implemented, reverted, or researched for DustWeaver. It is meant to prevent repeated work and to give future AI/code agents a single place to check before proposing another generic room-loading pass.

Scope caveat: this file is a source-and-discussion consolidation, not a full Git-history audit. Because the repository was reverted after some atlas work, this document distinguishes between **current/retained mechanisms**, **previously attempted or reverted work**, and **research candidates**. Verify current source before treating any item as live code.

---

## Current diagnosis in one paragraph

Room loading has been attacked from several angles: asset decode readiness, phased/async loading, static per-room runtime caching, idle-time nearby-room preparation, worker offload for heavy static prep, baked wall templates, incremental wall-template merge fallback, render-chunk prewarming/adoption, entry-viewport warming, gameplay-safe bake suppression, resident/frozen room worlds, compact/lazy room-file loading, and transition profiling. The remaining work should be measurement-led. Do not assume the next bottleneck is `loadRoom()` as a whole; inspect transition phase timings, prewarm readiness, first-entry resident build phases, stale baked wall-template warnings, and any visible render-layer failures.

---

## Existing documents that may already mention this area

Check these before proposing new work:

- `PERFORMANCE_DIAGNOSIS.md` — historical and current rendering/transition diagnosis, especially room-transition freezes, sprite decode readiness, and chunk/render cache failures.
- `performanceOptimizationDecisions.md` — build-by-build performance decisions and preservation notes.
- `nextSteps.md` — current performance priority list and known caveats.
- `docs/CURRENT_STATUS.md` — high-level current status and known caveats.
- `docs/AI_REPO_MAP.md` — source map for agents.

This file does not replace those files. It summarizes optimization attempts specifically around room loading and transition latency.

---

## Optimization attempts and current mechanisms

### 1. Sprite and background asset preloading / decode readiness

Problem addressed: rooms could show blank fallback tiles or freeze visually while block sprites/backgrounds loaded lazily after room entry.

Implemented or previously implemented mechanisms:

- Room sprite/background preload utilities load folder-theme block sprites for the current room and nearby rooms.
- Browser image decode is triggered where available so sprites are rasterized before first use.
- Background decode readiness is tracked so the loading overlay can wait for room backgrounds, not only tile sprites.
- Radius-1 rooms receive stronger decode-aware preloading; radius-2 rooms are cheaper load-only candidates.
- Current-room sprite/background decode is scheduled during room-load completion phases.

Important caveat:

- Non-folder themes and older world-sprite themes may not be fully represented in folder-theme readiness checks. If first-entry stalls remain, inspect whether the actual room theme goes through the preload/decode path.

### 2. Fade-covered synchronous load

Problem addressed: early `loadRoom()` work could run synchronously in one RAF callback and cause a visible stall or partial room construction.

Mechanism:

- A fade-out/fade-in room transition covers synchronous or semi-synchronous loading at maximum fade so the player does not see incomplete construction.

Current status:

- This is a mitigation, not the final architecture. Later work split room loading into phases, added cache/prewarm paths, and explored resident hot-swap work.

### 3. Phased room-load generator

Problem addressed: too much room initialization happened in one synchronous call.

Mechanisms to verify in current source:

- Room load work is split across phases/generator slices rather than one monolithic call.
- Typical phase boundaries include:
  - room metadata, renderer state, blocker/lighting setup, world reset;
  - player spawn, player particles, mote queue;
  - background wall grid and enemy spawn;
  - background particles, grapple chains, wall template application/build;
  - hazards, ropes, falling blocks, grasshoppers, dialogue, dust piles;
  - environment effects, wall decorations, interpolation/camera, sprite preloading, preload scheduling.
- Cache-hit transitions can be effectively instant.
- Cache-miss transitions should use async/loading overlay paths rather than freezing active gameplay.

### 4. Prepared room runtime cache

Problem addressed: static pure room data was rebuilt on every room visit.

Mechanisms to verify in current source:

- A runtime room cache stores per-room static data such as:
  - merged room wall templates;
  - ambient-light blocker key sets;
  - dark-ambient blocker key sets;
  - static wall-decoration geometry.
- Cache entries should be LRU- or capacity-limited.
- Mutable visit state must not be cached: enemies, hazard state, rope physics, particles, falling block offsets, crumble hit counts, and dust-pile collection state vary per visit unless explicitly handled by resident/frozen world state.

Current status:

- A slow transition often means the relevant prepared room entry was absent, partial, evicted, stale, or still pending in worker/preload scheduling.

### 5. Prepared runtime build consolidation

Problem addressed: wall templates, blocker sets, and decorations were prepared in separate places with repeated or inconsistent logic.

Mechanisms to preserve:

- Centralize static room preparation in one module rather than duplicating wall/blocker/decor logic across render, preload, and resident build paths.
- Wall-template priority should be:
  1. runtime cache;
  2. valid baked wall template;
  3. runtime fallback merge.
- Record timing breakdowns for wall, blocker, decoration, and total prep time.

Current status:

- Future changes should avoid reintroducing duplicate blocker/wall/decor build paths unless a measured bottleneck requires it.

### 6. Idle-time BFS room preloader

Problem addressed: adjacent rooms were not prepared before the player crossed a boundary.

Mechanisms to verify/preserve:

- Nearby room runtime preparation should be scheduled after each room load.
- The scheduler should BFS through room transitions, using manifest adjacency when available so it can discover nearby unloaded rooms.
- Radius-1 rooms should be prioritized ahead of radius-2 rooms.
- Scheduling should use `requestIdleCallback` when available, with safe fallbacks.
- Each idle callback should process limited work and check time budget before beginning heavy work.
- Rooms already fully prepared should be skipped.
- Proximity/velocity hints can prioritize the likely target room.

Current status:

- This avoids many cold transitions, but it is best-effort. If the player outruns the idle/worker/prewarm pipeline, the loading overlay should cover the miss.

### 7. Heavy-room cost guards and worker offload

Problem addressed: heavy adjacent-room preloads could freeze active gameplay when built synchronously in an idle callback or forced timeout.

Mechanisms to verify/preserve:

- Estimate build cost from wall count, background-block area, decoration count, or similar room-complexity inputs.
- Dispatch heavy radius-1/radius-2 rooms to a Web Worker when possible.
- If the worker is unavailable and the preload is speculative, skip heavy synchronous work rather than forcing it onto the main thread.
- Keep an urgent cheap-build path for safe small rooms only.

Current status:

- A skipped heavy preload means a later transition may show the loading overlay. That is preferable to freezing active gameplay for speculative work.

### 8. Off-main-thread room preparation worker

Problem addressed: heavy static preparation for wall templates, blocker sets, and decorations should not block gameplay.

Mechanisms to verify/preserve:

- A room preparation worker can build static runtime data outside the main thread.
- Transfer typed-array buffers back zero-copy where possible.
- Deduplicate pending room IDs so the same room is not prepared multiple times.
- Worker results should write into the shared room runtime cache only when still valid.

Current status:

- Worker availability matters. If the worker fails, fallback behavior should avoid large active-gameplay freezes.

### 9. Lazy Electron room-file cache and manifest adjacency

Problem addressed: loading all campaign rooms and all room data eagerly can be expensive, especially for large campaigns.

Mechanisms to verify/preserve:

- Prefer a source hierarchy such as:
  1. canonical campaign file;
  2. derived room manifest;
  3. individual derived room files.
- In Electron file-cache mode, hydrate rooms asynchronously from individual files when possible.
- Keep manifest adjacency available so preloading can discover nearby unloaded rooms.
- Validate derived room cache data with hashes/versioning.

Current status:

- This reduces startup/registry pressure but adds a cold path: the target room may need data hydration before it can be prepared or warmed.

### 10. Baked wall templates in room JSON

Problem addressed: the wall merge pass can be expensive and super-linear/O(n^2) for many authored wall rectangles.

Mechanisms to verify/preserve:

- Room JSON may carry `bakedWallTemplate` data.
- Runtime wall-template priority should be cache -> baked -> fallback merge.
- A bake script should hydrate room solids/special walls, build complete boundary walls, run the merge pass, compute source hashes, and write baked templates.
- Valid baked templates should skip runtime merge.

Current status:

- Missing or stale baked templates can still push rooms into fallback merge. If the console reports stale baked wall-template warnings, investigate those before inventing a new renderer optimization.

### 11. Incremental wall-template fallback

Problem addressed: when cache and baked wall templates are both missing, fallback wall merge can create a large single-frame spike.

Mechanisms to verify/preserve:

- Fallback wall-template build should be incremental/time-budgeted.
- Room load and resident build paths should yield between expensive slices.
- The expensive merge should not be bundled with unrelated load work in one frame.

Current status:

- Incremental fallback reduces per-frame spikes, but first-entry total wait time can still be noticeable for very large rooms if no cache/baked/worker result exists.

### 12. Chunked wall/background rendering

Problem addressed: drawing or rebuilding whole-room wall/background canvases is too expensive for large rooms.

Mechanisms to verify/preserve:

- Wall rendering should use chunk canvases, not one giant room-sized canvas.
- Background blocks should also render through chunk canvases.
- Dirty chunks should rebuild under per-frame caps.
- Only visible chunks plus a safety margin should be blitted.
- Chunk cache memory caps should avoid per-frame churn.
- Memory estimates should use actual block/chunk sizes.

Current status:

- This is render-side, but it directly affects room entry because first visible chunks may otherwise be built during or immediately after transition.

### 13. Idle-time render-chunk prewarming and adoption

Problem addressed: even when runtime room data is ready, the first frame in a new room can hitch while visible wall/background chunks are built.

Mechanisms to verify/preserve:

- Pre-build wall/background chunks during idle time.
- Priority order should favor radius-1 rooms and entry viewport chunks first.
- Back off when recent frame times are poor.
- Defer rooms whose runtime data or sprites are not ready rather than baking incorrect fallback chunks.
- Order chunks by likely movement direction where possible.
- On room entry, adopt prewarmed chunks before first render.
- Reject stale render-state keys rather than adopting incorrect visuals.
- Evict stale/higher-radius prewarm chunks under memory pressure.

Current status:

- If a transition is not hot, inspect diagnostics for missing runtime data, missing wall chunks, missing background chunks, stale render state, empty adoption, or incomplete entry-viewport coverage.

### 14. Entry-viewport warm

Problem addressed: if prewarmed chunks are missing or incomplete, the first gameplay frame after room entry can still pop in or trigger expensive build work.

Mechanisms to verify/preserve:

- Track an entry warm phase such as `idle`, `warming`, `ready`, or `timedOut`.
- Run entry warm before player input/simulation/camera/render resumes.
- Keep loading overlay visible during entry warm.
- Allow safe baking during entry warm, but forbid it during normal gameplay.
- Bound entry warm with a timeout so it cannot become an indefinite loading screen.

Current status:

- Entry warm bridges full hot transitions and cold loading. If prewarming is insufficient, entry warm should create a short covered delay rather than an uncovered hitch.

### 15. Gameplay-safe baking suppression and stable fallbacks

Problem addressed: shaded sprite and procedural sprite baking can use expensive pixel operations during active gameplay as the camera moves into new chunks.

Mechanisms to verify/preserve:

- Bound shaded/procedural variant caches rather than keying on exact world positions.
- During active gameplay render, expensive bake paths should return stable cached fallback canvases rather than running `getImageData`/`putImageData` or returning `null`.
- Stable fallback canvases prevent repeated fallback rebuild loops.
- Shaded variants should bake during loading/prewarm/entry-warm phases, not during active gameplay.

Current status:

- Freeze profiler output should show zero `bake`/`edge` spikes during active gameplay. Any gameplay bake spike means a guard or instrumentation path is missing.

### 16. Resident/frozen room-world architecture

Problem addressed: even phased room loading still rebuilds enemies/hazards/ropes/walls for rooms that could remain resident/frozen.

Mechanisms to verify/preserve:

- Build a complete `WorldState` for nearby rooms without a player cluster.
- Include enemies, hazards, ropes, falling blocks, background fluid, dust piles, and walls where appropriate.
- Use deterministic per-room RNG derived from campaign seed, room ID, and world number so background builds do not perturb active gameplay RNG.
- Spread resident construction across RAF frames.
- Use cache/baked/incremental wall-template logic inside resident builds.

Current status:

- Desired long-term direction is zone/world residency: keep rooms in a world/zone resident and frozen, with longer loading primarily between zones. First-entry resident build of very large rooms can still be a bottleneck if not prepared before activation.

### 17. Large-room area-system audit

Problem addressed: large sparse rooms can look slow because of width x height grids.

Findings from previous work:

- O(W x H) ambient darkness/lit-air passes were identified as likely issues and should be avoided or memoized.
- Dense background wall grid allocation may be more of a memory/GC concern than the dominant multi-second freeze, but it should still be watched on huge rooms.
- DEV-only full-grid scans should not run during transitions.
- Enemy-specific dense nav grids matter only where those enemies exist in large rooms.

Current status:

- Sparse grid conversion may reduce memory in huge sparse rooms, but do not prioritize it until profiler data implicates memory/GC or dense-grid scans.

### 18. Complete boundary walls and trigger strips

Problem addressed: transition geometry and room-edge handling have caused correctness problems and map-sketch regressions.

Mechanisms to preserve:

- Complete boundary walls should be generated independently of transition triggers.
- Trigger strips should remain separate from solid boundary geometry.
- Baked wall-template generation should include complete boundary walls.

Current status:

- Do not alter transition trigger thresholds, spawn resolution rules, boundary-wall construction, or map-sketch rendering without evidence and targeted tests.

### 19. Render-state key memoization

Problem addressed: repeated render-state key generation can sort/join blocker sets and become measurable in transition/prewarm paths.

Mechanisms to verify/preserve:

- Memoize render-state key computation where blocker-set identity and primitive render arguments are stable.
- Use shared sentinels for empty blockers where safe.

Current status:

- Helps adoption/prewarm/render-state checks, but in-browser transition timing is needed before treating it as the dominant fix.

### 20. Profiling and diagnostics

Problem addressed: repeated optimization attempts were being made without enough measurement.

Mechanisms to verify/preserve:

- Track frame context and bake/chunk/load-phase work.
- Keep a render profiler available through debug UI.
- Record per-transition total time, phase time, longest phase, room dimensions, content counts, and prewarm cache summary.
- Useful DEV globals may include:
  - `__dwTransitionStats(n)`;
  - `__dwLastTransition()`;
  - `__dwTransitionVerbose(on)`;
  - `__dwBenchTransition(roomId, opts?)`;
  - `__dwBenchPingPong(roomA, roomB, iterations)`.

Current status:

- The next optimization should start by capturing real browser/Electron transition timings. Node tests do not substitute for live transition measurements.

### 21. Scene-light and bloom optimizations

Problem addressed: room-entry and per-frame rendering can be polluted by lighting/bloom work.

Mechanisms to preserve:

- Mark scene-light occluders dirty on room-ID changes rather than every frame.
- Cull scene lights to viewport.
- Skip bloom work for empty frames where possible.

Current status:

- These are adjacent optimizations. Preserve them, but do not assume they are the direct cause of multi-second room loads unless profiler data points there.

### 22. Maintainability refactors that preserved performance behavior

Problem addressed: large monolithic files make performance-sensitive paths risky to edit.

Mechanisms to preserve:

- Refactors should preserve allocation-free hot paths, cache invalidation behavior, room-change-only dirty flags, and dialogue/trigger pre-conversion.
- Any extraction touching room load/render code should include a note about preserved behavior.

Current status:

- Maintainability refactors reduce the risk of reintroducing per-frame allocations or changing transition ordering.

---

## Reverted / unsafe attempt: sprite atlas runtime integration

A sprite atlas generation and validation pipeline was previously explored. The build-time parts were promising, but runtime integration caused a severe visual regression after the repo was later reverted.

Observed regression:

- Gameplay loaded into a mostly black room.
- Player sprite and UI/timer rendered.
- Some object sprites could render.
- Room walls/background/folder-theme environment visuals were missing or black.
- A visual setting intended to disable atlas usage did not restore the room visuals, suggesting the integration modified the legacy render path, cached empty chunks, inverted the setting, or affected chunk/layer state.

Lessons:

1. Do not reintroduce runtime atlas rendering until the legacy path can be proven untouched when atlas mode is disabled.
2. Any atlas setting should be positive and explicit: `Use sprite atlases (experimental)`, default false. Avoid confusing negative labels such as `disable sprite atlas usage`.
3. Atlas rendering must be a strict wrapper around legacy drawing, never a replacement.
4. If atlas lookup fails, image is not ready, metadata is missing, sprite key mismatches, or draw fails, immediately draw the legacy sprite.
5. Failed or empty atlas draws must never be cached as valid wall/background chunks.
6. Chunk cache keys must distinguish render sources if atlas output can differ from legacy output.
7. Toggling atlas mode must invalidate any chunks/prewarmed chunks built under the previous mode.
8. Platform/generated-shaped sprites should remain legacy until a dedicated atlas shape pipeline exists.

Safe future order, if atlas work is revisited:

1. Generate atlases as derived assets only.
2. Validate atlas metadata and pixel-perfect crops against source PNGs.
3. Add diagnostics and manual preview tooling.
4. Add a disabled-by-default runtime flag.
5. Prove atlas disabled means zero atlas lookups/draws and exact legacy rendering.
6. Only then test atlas rendering in one narrow draw path.
7. Do not tune performance until visual parity is proven in normal gameplay.

---

## Research findings: plausible optimizations not yet confirmed implemented

These are candidates, not recommendations to implement blindly. Each should be gated by transition-profiler evidence and a small A/B benchmark.

### A. Worker-side render chunk prewarming with `OffscreenCanvas` + `ImageBitmap`

Why it may help: if heavy wall/background chunk rasterization still happens on the main thread, the browser can miss idle windows or produce long frames. `OffscreenCanvas` can run canvas work in a worker, and `transferToImageBitmap()` can produce transferable display-ready bitmaps.

Possible DustWeaver application:

- Move part of wall/background chunk rasterization into a dedicated render-prewarm worker.
- Send a serializable render command stream plus pre-decoded assets or atlas/image bitmaps.
- Return chunk `ImageBitmap`s for adoption.

Risks:

- Worker canvas parity can differ across browser/Electron versions.
- Asset access in workers is stricter.
- Many transferred bitmaps can create memory pressure.
- `ImageBitmap.close()` discipline is required.

Evidence needed:

- Transition stats showing chunk prewarm slices, entry warm, or first visible chunk building are still a top bottleneck.

### B. `createImageBitmap` asset pipeline

Why it may help: `createImageBitmap()` creates bitmap objects asynchronously from images/blobs/canvases and can reduce first-draw decode/upload stalls in some cases.

Possible DustWeaver application:

- Add a `bitmapAssetCache` beside the normal image cache.
- Feature-detect `createImageBitmap` and keep `HTMLImageElement.decode()` fallback.
- Start with room backgrounds or one folder block theme only.
- Explicitly close evicted bitmaps.

Risks:

- `img.decode()` may already be sufficient in Chromium/Electron.
- Keeping both image elements and bitmaps can increase memory.
- Cache eviction must release resources.

Evidence needed:

- Profiler/Long Animation Frames data showing image decode, first draw, or GPU upload during room entry or entry warm.

### C. Texture atlas / sprite atlas for folder block themes

Why it may help: reducing many individual image sources into fewer atlas images can reduce request/decode bookkeeping and draw-source churn.

Safe build-time application:

- Generate atlas PNG/JSON pairs into a derived folder.
- Validate pixel-perfect crops against source sprites.
- Keep old individual sprite loading as the only runtime path until visual parity is proven.

Runtime caution:

- Previous runtime atlas integration caused black/missing room visuals. Do not reintroduce without a hard kill switch, exact legacy fallback, and chunk cache separation.

### D. Persistent pre-rendered room-entry chunk cache

Why it may help: current prewarm caches may be session-memory only. Official campaign rooms revisited across launches could benefit from persistent entry-viewport render products or intermediate manifests.

Possible DustWeaver application:

- Persist compact chunk manifests first: visible entry chunks, bounds, render-state key, asset revision, dirty dependencies.
- Later consider encoded PNG/WebP chunk images for static official campaigns.
- Invalidate on room hash, render-state key, graphics-quality tier, asset revision, and game version.

Risks:

- Stale visuals from invalidation bugs.
- Encoded images may shift cost from rendering to decode.
- Best suited for official/static campaigns, not active editor rooms.

### E. Binary or streamable derived room/runtime payloads

Why it may help: JSON parse/hydration can still be a cold-path cost after moving to derived room files and baked wall templates.

Possible DustWeaver application:

- For official campaign exports, add optional binary sidecars for static runtime fields: baked wall typed arrays, blocker keys, decorations, adjacency, and dimensions.
- Keep canonical JSON as source of truth.
- Use typed arrays and transferable buffers where possible.

Risks:

- Binary formats increase maintenance cost and can obscure editor/debug workflows.
- Not worthwhile if transition stats point mostly to rendering, sprite decode, or resident-world construction.

### F. Prioritized cooperative scheduler wrapper

Why it may help: preload/chunk-warm work may need more consistent background scheduling than raw `requestIdleCallback` in some environments.

Possible DustWeaver application:

- Create a single `backgroundWorkScheduler` abstraction using:
  1. `scheduler.postTask(..., { priority: 'background' })` where available;
  2. `requestIdleCallback` where useful;
  3. `MessageChannel`/`setTimeout(0)` fallback;
  4. optional `navigator.scheduling.isInputPending()` checks to yield early.

Risks:

- Scheduling APIs vary by browser/Electron version.
- Scattering direct priority API calls makes debugging harder. Keep it behind one wrapper.

### G. Long Animation Frames API integration

Why it may help: game timers may not attribute GC, style/layout, image decode/upload, Canvas internals, or browser-internal work. Long Animation Frames can report frames delayed beyond 50 ms and provide script timing attribution where supported.

Possible DustWeaver application:

- Add DEV-only `PerformanceObserver` for `long-animation-frame` entries.
- Correlate LoAF entries with room transition IDs.
- Store a compact ring buffer in transition stats.

Risks:

- Attribution can be incomplete, especially for workers. Use it alongside internal timers, not as a replacement.

### H. More aggressive zone residency / predictive resident build policy

Why it may help: if the remaining delay is first-entry resident build, the fix may be earlier prediction rather than more micro-optimization.

Possible DustWeaver application:

- Build resident worlds in priority order:
  1. current room direct exits;
  2. likely movement direction / velocity target;
  3. rooms visible on the map path;
  4. rest of zone during pause/menu/loading.
- Add a memory budget and degrade to static runtime prep only when resident `WorldState` memory is too high.

Risks:

- Resident worlds include mutable state and memory-heavy arrays. Aggressive residency can create memory pressure and GC pauses if not bounded.

### I. Separate static base chunks from dynamic lighting overlays

Why it may help: if lighting changes invalidate whole wall chunks, splitting base tile rasterization from lighting/shadow overlays could reduce entry warm and prewarm costs.

Possible DustWeaver application:

- Cache base wall/background chunks keyed by geometry/theme.
- Cache or compute lighting overlays separately keyed by lighting/blocker state.
- Reuse base chunks even when ambient-light parameters differ.

Risks:

- Extra compositing can cost more than it saves on small rooms.
- Attempt only if diagnostics show lighting invalidation causing expensive wall chunk rebuilds or stale render-state misses.

### J. Higher-risk / lower-confidence possibilities

- **WASM for hot preprocessing kernels.** Consider only if a measured JS kernel remains CPU-bound after caching/incremental/worker work.
- **Sparse large-room grid adapters.** Worth revisiting only if memory/GC or dense-grid scans are implicated.
- **Full WebGL/WebGPU tile renderer.** Possible long-term renderer direction, but it is a renderer rewrite, not a focused room-loading fix.

---

## Optimizations intentionally avoided or constrained

These constraints matter because they prevent repeat attempts that are likely to break correctness.

1. **Do not cache mutable visit state** unless it is explicitly part of resident/frozen world state.
2. **Do not rebuild heavy speculative rooms synchronously when the worker is unavailable.** Skip speculative work and let the async overlay cover a later miss.
3. **Do not adopt prewarmed chunks with stale render-state keys.** Incorrect visuals are worse than a short entry-warm/loading delay.
4. **Do not casually alter boundary walls, trigger strips, spawn resolution, or map-sketch rendering.** These are regression-prone.
5. **Do not re-enable legacy edge-extension cache building in normal gameplay** unless current source proves it is needed.
6. **Do not optimize dense grids before measuring.** Dense allocation may matter for memory, but it may not be the multi-second freeze source.
7. **Do not reintroduce runtime sprite atlas rendering as a broad integration.** Prior runtime integration caused black/missing room visuals. If revisited, isolate it behind a positive experimental flag and prove legacy rendering is untouched.

---

## What likely remains to measure next

Use actual transition data before changing code. The most plausible remaining bottleneck categories are:

1. **Cold target room data path**
   - Room not yet hydrated from derived/Electron room-file cache.
   - Manifest adjacency discovers the room, but data/worker/prewarm did not finish before crossing.

2. **Runtime cache miss or eviction**
   - Prepared room cache entry missing, partial, evicted, or stale.
   - Worker still pending or skipped.
   - Baked template missing or stale, causing fallback incremental merge.

3. **Resident first-entry build**
   - Resident world not built before activation.
   - Large room still pays enemy/hazard/wall setup in resident generator phases.

4. **Sprite/background decode first-entry cost**
   - Folder sprites or background decode not finished.
   - Non-folder/world sprites not represented in readiness checks.

5. **Render chunk prewarm/adoption miss**
   - Wall chunks missing.
   - Background chunks missing.
   - Stale render-state key.
   - Entry viewport not covered.
   - Prewarm evicted due to memory budget or not queued soon enough.

6. **Visual layer/chunk cache regression**
   - Player/UI render but walls/background are black or missing.
   - Check wall/background chunk build, layer order, darkness overlay, canvas state restoration, and cached empty chunks.

7. **Large-room special systems**
   - Dense background wall grid is likely memory rather than time, but still watch huge rooms.
   - Enemy-specific nav grids matter only where those enemies are active.

8. **Browser-internal stalls not covered by game timers**
   - GC, image decode/upload, Canvas internals, style/layout, and other browser work should be checked with Long Animation Frames data if internal timers do not explain the delay.

---

## Recommended measurement workflow

1. Enable the debug overlay and freeze/transition profiler.
2. Run live browser/Electron transition tests, not just Node tests.
3. Use available DEV globals, for example:

```js
__dwBenchPingPong('room_a_id', 'room_b_id', 10)
__dwTransitionStats(20)
__dwLastTransition()
```

4. For slow transitions, identify:
   - transition outcome: `residentWorldHot`, `hot`, `entryWarm`, `loading`, etc.;
   - longest phase;
   - whether runtime cache was ready;
   - whether wall/background prewarm data existed;
   - whether adoption rejected stale data;
   - whether entry viewport coverage was complete;
   - whether sprites/backgrounds were decoded;
   - whether gameplay frames show `bake` / `edge` work;
   - whether Long Animation Frames entries show browser-internal or unattributed main-thread stalls.
5. For black/missing room visuals, first disable or remove any experimental render path, clear chunk caches, and verify legacy wall/background rendering before doing any performance tuning.
6. Only then choose the next optimization target.

---

## Quick glossary

- **Runtime prepared room**: static room data cached in a prepared-room runtime cache — wall template, blockers, decorations.
- **Baked wall template**: wall merge result persisted in room JSON so runtime can skip expensive merge.
- **Render chunk prewarm**: wall/background chunk canvases built in idle time before entering a room.
- **Entry warm**: short covered warm pass immediately after room load/transition before gameplay resumes.
- **Resident world**: frozen `WorldState` for a room, built without the player and activated later.
- **Hot transition**: transition where runtime data and entry render chunks are ready enough to avoid loading overlay.
- **Loading transition**: cache/prewarm miss handled by phased async load behind overlay.

---

## Bottom line

DustWeaver has already had broad, sophisticated room-loading optimization attempts. Future work should not be another generic "optimize room loading" pass. It should be measurement-led and targeted to the slowest observed transition phase or readiness miss reason. Recent sprite atlas runtime work is specifically marked unsafe because it caused black/missing room visuals; do not reintroduce it as a runtime path until legacy rendering can be proven completely unaffected when atlas mode is disabled.
