# DustWeaver — Room Loading & Rendering Optimizations

_Working log for the room-load / render optimization pass started BUILD 431._
_Companion to [`docs/systems/PERFORMANCE_DIAGNOSIS.md`](docs/systems/PERFORMANCE_DIAGNOSIS.md) (freeze diagnosis) — this
file focuses on **throughput and consistency** of the load + prewarm + adopt pipeline._

---

## How the pipeline fits together (map before touching it)

Understanding the data flow is a prerequisite for optimizing it safely, because
several caches are keyed against each other:

```
                    ┌─────────────────────────────────────────────┐
   idle time  ───▶  │ roomPreloadScheduler → buildPreparedRoomRuntime│ ── builds ──▶ RoomRuntimeCache
   (rIC slots)      │   (or dispatched to the preparation Worker)   │              (wallTemplate,
                    └─────────────────────────────────────────────┘               blockerKeys,
                                        │                                          darkBlockerKeys,
                                        ▼                                          wallDecorations)
                    ┌─────────────────────────────────────────────┐
   idle time  ───▶  │ roomRenderChunkWarmScheduler                 │ ── builds ──▶ roomRenderCacheStore
                    │   reads RoomRuntimeCache.blockerKeys,        │              (per-room wall/bg
                    │   computes renderStateKey, bakes chunks      │               chunk snapshots +
                    └─────────────────────────────────────────────┘               renderStateKey)
                                        │
             player crosses transition  ▼
                    ┌─────────────────────────────────────────────┐
   load frame ───▶  │ makeLoadRoomPhases (Phase A)                 │
                    │   recomputes renderStateKey, then            │
                    │   adoptPrewarmedChunksForRoom(...)           │
                    └─────────────────────────────────────────────┘
                                        │
                    renderStateKey match?  ──── yes ──▶ chunks adopted, zero rebuild hitch
                                        │
                                        └──────── no ──▶ chunks DISCARDED, rebuilt on first frames
```

The critical invariant: **the `renderStateKey` computed at *build* time (prewarm
scheduler, reading `RoomRuntimeCache.blockerKeys`) must equal the one computed at
*adopt* time (Phase A / resident hot-swap).** The key folds in the ambient-light
`blockerKeys` set, so the two paths must build that set *identically*. Any
divergence silently throws away idle-built chunks and reintroduces the
first-frame wall-rebuild hitch the whole prewarm system exists to eliminate.

---

## Implemented — BUILD 431

### 1. Single source of truth for ambient-light blocker keys ✅

**Problem.** The `blockerKeys` / `darkBlockerKeys` `Set<string>` construction was
**copy-pasted in four places**, each an independent chance to drift:

| Path | File | Role in the key invariant |
|------|------|---------------------------|
| Cache population | `preparedRoomRuntime.ts` → `buildPreparedRoomRuntime` | Feeds the prewarm scheduler's **build-time** key |
| Room entry (cold) | `gameLoadRoomPhases.ts` → Phase A cache-miss branch | Computes the **adopt-time** key |
| Room entry (hot-swap) | `gameLoadRoomPhases.ts` → `applyResidentRoomActivation` | Computes the **adopt-time** key for resident swaps |
| (implicit) | prewarm scheduler consumes `RoomRuntimeCache.blockerKeys` | Depends on path #1 being correct |

Because these builds gate prewarm-chunk adoption (see invariant above), silent
drift here is not a cosmetic bug — it's a **rendering-performance regression**
(discarded prewarm work + on-entry rebuild spikes) that would be nearly invisible
in review.

**Fix.** Extracted the exact logic into one referentially-transparent helper,
`buildRoomAmbientBlockerKeys(room)`, in new module
[`src/levels/roomAmbientBlockers.ts`](src/levels/roomAmbientBlockers.ts). All
three gameplay call sites now delegate to it. The helper:

- has no DOM / world-state / RNG dependencies, so it is equally callable from the
  main thread, the preparation Worker, or a unit test;
- allocates the two `Set`s lazily, returning `undefined` for rooms with no
  blockers (matches the historical `RoomRuntimeEntry` sentinel — no wasted
  empty-`Set` allocation on the common case);
- is locked down by [`src/tests/roomAmbientBlockers.test.ts`](src/tests/roomAmbientBlockers.test.ts)
  (6 cases covering blockers, `isDark`, background-block footprint expansion,
  non-light-blocking blocks, and merged sets).

**Net effect.** ~55 lines of triplicated logic collapse to three one-line
delegations; the build-time and adopt-time keys are now provably derived from the
same code, guaranteeing prewarmed chunks are adopted rather than rebuilt.

**Verification.** `tsc --noEmit` clean; full suite 65/65 green
(`npm test`).

---

## Backlog — ranked opportunities found during this pass

Ordered by (value ÷ risk). Each notes why it wasn't done in this pass so the next
session can pick up with context.

### B1. Numeric-packed chunk keys in `chunkRenderCache` — _low value, medium risk_

`renderVisibleChunks` and `_checkRange` allocate a `` `${cx},${cy}` `` string per
visible chunk **every frame**, for two caches (walls + bg). At ~6–12 visible
chunks each that's ~24–48 short-lived strings/frame (~1.5–3k/sec of GC garbage).

A packed integer key (`cx * 65536 + cy`; `cx,cy` are always ≥ 0 and small — see
the `Math.max(0, …)` clamp in `_fillChunkRange`) would eliminate the allocation.
**Blocked on:** `injectWarmedChunks` / `extractCleanChunks` exchange
`Map<string, HTMLCanvasElement>` with `roomRenderCacheStore` and the prewarm
renderers, so the `"cx,cy"` string is a cross-module contract. Converting the
internal representation means translating at that boundary, which risks the
delicate adoption path for a GC win a modern engine mostly absorbs. Deferred as
not worth the risk until profiling shows chunk-key GC is material.

### B2. Cache `bgWallGrid` occupancy in `RoomRuntimeEntry` — _low–medium value, low risk_

Phase C rebuilds `world.bgWallGrid` (a `Uint8Array`) from `room.backgroundBlocks`
via nested `dy/dx` loops on **every** room load. The result is referentially
transparent, so it fits the existing "cache pure per-room data" pattern: store
the built grid on the runtime entry and `world.bgWallGrid.set(cached)` (a fast
native copy) instead of re-looping. Win scales with background density; marginal
for sparse rooms. **Cost:** up to `width × height` bytes per cached room (≤16),
e.g. ~256 KB for a 512² room. Left out to avoid adding memory pressure the
prewarm eviction budget already juggles — revisit if a large dense room shows a
measurable Phase-C cost in the freeze profiler.

### B3. Reduce repeated `RoomRuntimeCache.get()` churn per load — _very low value_

`makeLoadRoomPhases` calls `roomRuntimeCache.get(room.id)` in Phases A, D, and F;
each `get()` does a `delete`+`set` to promote LRU order. Caching a single local
is **not** safe as-is because Phase D may `set()` a *new* entry between the reads
(cold-cache path), so the Phase-A reference goes stale. Would need a small
restructure to thread the entry through. A few Map ops per load — negligible;
noted only for completeness.

### B4. Base-tile / lighting-overlay chunk split — _high value, high effort_

(Carried over from `docs/systems/PERFORMANCE_DIAGNOSIS.md` §Future Work.) `setActiveBlockLighting`
invalidates whole wall chunks. Separating static base tiles from the lighting
overlay would allow lighting-only edits (and possibly some room-to-room
transitions that share geometry) to rebuild only the cheap overlay layer. Large
change to the chunk renderer; out of scope for an incremental pass.

---

## Guardrails (don't regress these while optimizing)

- **The renderStateKey invariant** described at the top. Any new place that needs
  blocker keys MUST call `buildRoomAmbientBlockerKeys` — never re-derive inline.
- Everything already listed under **"Already Well-Optimised Areas"** in
  `docs/systems/PERFORMANCE_DIAGNOSIS.md` (chunked rendering, idle prewarm, BFS memoisation,
  bounded variant caches, `computeRenderStateKey` WeakMap memo).
- Blocker builds and any new per-room derived data must stay referentially
  transparent (same `RoomDef` → same output) so they remain Worker-safe and
  cacheable.
