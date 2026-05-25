# Render Chunk Prewarming

DustWeaver prebakes wall and background render chunks for nearby rooms while the
player is in the current room.  This means the first frames of a room transition
are served from already-built canvases rather than cold-built tiles, eliminating
the first-entry hitch on large rooms.

---

## How it works

### 1 — Room preload pipeline

When the player enters a room `scheduleRoomPreloads` queues nearby rooms for
data + sprite loading (`roomPreloadScheduler.ts`).  After those items are
scheduled, `scheduleChunkPrewarms` (from `roomRenderChunkWarmScheduler.ts`) is
called with the same room graph.  It queues chunk-warm tasks for:

- **Radius 1** – rooms directly connected by a transition.
- **Radius 2** – rooms one hop beyond those.
- **Radius 3** – two hops beyond (only when `graphics = 'high'` or frame time
  is consistently low).

### 2 — Idle-time scheduling

The warmer runs exclusively during browser idle time via `requestIdleCallback`
(with a `setTimeout(…, 50)` fallback on browsers that lack it).

Each idle callback:
1. Checks whether the average frame time is above `FRAME_TIME_PAUSE_THRESHOLD_MS`
   (default 20 ms / 50 fps).  If so, it reschedules without doing any work.
2. Processes at most `MAX_CHUNKS_PER_IDLE` (default 6) chunks per callback, and
   stops early if `timeRemaining()` drops below `MIN_IDLE_REMAINING_MS`
   (default 4 ms) — whichever limit is hit first.
3. Schedules another callback if work remains.

No chunk building ever happens during a normal game-render frame.

### 3 — Chunk-warm tasks

For each room in the queue the warmer computes likely-visible chunks using the
**entrance viewport**:

```
camera centred on the arrival spawn block
  → offsetXPx = vpWidth/2  − spawnX × scalePx
  → offsetYPx = vpHeight/2 − spawnY × scalePx
```

Visible chunks in that viewport are queued first; then a one-chunk margin around
them; then the rest of the room (working outward).  For radius-2/3 rooms only
the entrance chunks are queued unless there is plenty of idle time.

### 4 — Renderer integration

Two renderers expose prewarm APIs:

| Renderer | Prewarm function | Adopt on entry |
|---|---|---|
| `blockSpriteRenderer` | `prewarmWallChunksForRoom` | `adoptPrewarmedWallChunks` |
| `backgroundBlockRenderer` | `prewarmBgChunksForRoom` | `adoptPrewarmedBgChunks` |

**Prewarm** saves/restores all module-level render state so the active room is
never disturbed.  Each room's warmed chunks are stored in a separate
`RoomChunkCache` instance keyed by room ID.

**Adopt** (`adoptPrewarmedChunksForRoom` in the scheduler, called from
`gameScreen.ts` Phase A) injects the warmed caches into the live renderers at
transition time.  This is a zero-copy hand-off: no chunk canvases are
re-allocated.  Hit/miss counters are updated for the debug panel.

### 5 — Sprite readiness gate

Chunks are only built once `areRoomSpritesReady(roomId)` returns `true`.  Tasks
that are not yet sprite-ready are skipped and re-queued (up to
`MAX_SPRITE_WAIT_RETRIES` times, default 5).  This prevents fallback grey
rectangles from being baked into cached canvases.

### 6 — Room / quality invalidation

When `scheduleChunkPrewarms` is called again (e.g. the player changes rooms), it
cancels any in-flight handle and starts fresh.  Warmed caches from a previous
session are evicted for rooms that are no longer in the new work queue.
Graphics-quality changes are handled because `scalePx` is baked into each cache;
a zoom/quality change causes the `layoutRef` identity check to invalidate the
cache on first use.

---

## Constants

All tuning constants live near the top of
`src/screens/roomRenderChunkWarmScheduler.ts`.

| Constant | Default | Description |
|---|---|---|
| `MAX_CHUNKS_PER_IDLE` | `6` | Maximum chunks built in a single idle callback. |
| `MIN_IDLE_REMAINING_MS` | `4` | Stop processing if `timeRemaining()` drops below this. |
| `IDLE_FALLBACK_DELAY_MS` | `50` | `setTimeout` delay used when `requestIdleCallback` is unavailable. |
| `FRAME_TIME_PAUSE_THRESHOLD_MS` | `20` | Pause all prewarming when mean frame time exceeds this (≈50 fps). |
| `MAX_PREWARM_RADIUS` | `3` | Maximum BFS radius from the current room. |
| `RADIUS3_HIGH_QUALITY_ONLY` | `true` | Limit radius-3 warming to `graphics='high'` or stable frame times. |
| `MAX_SPRITE_WAIT_RETRIES` | `5` | Drop a task after this many deferred attempts if sprites never arrive. |

Renderer-side constants live near the top of each renderer file:
- `blockSpriteRenderer.ts` — `_prewarmWallCaches` / `_prewarmWallLayouts` maps
  (unbounded; LRU eviction is handled by the scheduler on room change).
- `backgroundBlockRenderer.ts` — `_prewarmBgCaches` map.

---

## Debug stats (Prewarm panel)

Enable the overlay by pressing the debug-panel key in-game and activating the
**Prewarm** panel (or toggle `debugPanelManager` defaults in code).

| Stat | Meaning |
|---|---|
| **queue** | Number of warm tasks still pending. |
| **wall chunks** | Total warmed wall chunk canvases in memory. |
| **bg chunks** | Total warmed background chunk canvases in memory. |
| **warmed/slice** | Chunks built in the last idle callback. |
| **ms/slice** | Wall-clock time spent in the last idle callback. |
| **radius** | Current BFS radius (1–3) being worked on. |
| **hits / misses** | Chunk-cache hits and misses recorded on the most recent room entry. |
| **paused (frame time)** | Shown when prewarming is suspended due to high frame time. |

---

## Tuning guide

**Warmer feels too aggressive (stutter during gameplay)**
- Reduce `MAX_CHUNKS_PER_IDLE` (try 2–3).
- Lower `FRAME_TIME_PAUSE_THRESHOLD_MS` (try 16 ms / 60 fps).
- Increase `MIN_IDLE_REMAINING_MS` (try 8 ms).

**Transitions still hitch on slow hardware**
- Increase `MAX_CHUNKS_PER_IDLE` slightly.
- Lower `FRAME_TIME_PAUSE_THRESHOLD_MS` so the warmer runs at lower performance
  margins (careful — this risks stutter on weak machines).

**Radius-3 rooms are wasted CPU**
- Set `MAX_PREWARM_RADIUS = 2` to disable three-hop warming entirely.
- Or leave `RADIUS3_HIGH_QUALITY_ONLY = true` (default) so it only runs when
  `graphics = 'high'`.

**Memory concerns**
- Each warmed chunk canvas is typically `~2–4 KB` for a 32×32 px tile at zoom
  1.0.  A full 30-chunk room × 2 layers × 5 rooms ≈ ~1 MB.
- The current implementation evicts all non-adjacent warmed rooms when the
  scheduler is re-initialized on room change.  For tighter memory control,
  implement `evictStalePrewarmedChunks` (currently a no-op stub in the
  scheduler) with an LRU size cap.

---

## Integration points

| File | Role |
|---|---|
| `src/screens/roomRenderChunkWarmScheduler.ts` | Scheduler, BFS queue, idle callbacks, stats |
| `src/render/walls/blockSpriteRenderer.ts` | Wall chunk prewarm / adopt / evict APIs |
| `src/render/walls/backgroundBlockRenderer.ts` | Background chunk prewarm / adopt / evict APIs |
| `src/render/walls/chunkRenderCache.ts` | `injectWarmedChunks` / `extractCleanChunks` on `RoomChunkCache` |
| `src/render/walls/blockWallLayoutCache.ts` | `getCurrentWallLayout` / `setPrebuiltWallLayout` for identity preservation |
| `src/screens/gameScreen.ts` | Calls `scheduleChunkPrewarms` (Phase F) and `adoptPrewarmedChunksForRoom` (Phase A) |
| `src/render/hud/renderProfiler.ts` | Prewarm debug panel rendering |
| `src/ui/debugPanelManager.ts` | `'prewarm'` panel ID registration |

---

## Known limitations / next steps

- **LRU memory cap** (`evictStalePrewarmedChunks`) is currently a no-op stub.
  Implement it if memory growth is observed after walking through many rooms.
- Radius-3 warming only gates on `graphics='high'` today; a future improvement
  could also gate on `getLastFrameMs() < FRAME_TIME_PAUSE_THRESHOLD_MS` to be
  fully adaptive.
- The prewarm panel is not yet exposed as a toggle button in the pause-menu
  debug section; add it to `pauseMenu.ts` if preferred.

See also: `nextSteps.md` for outstanding work items.
