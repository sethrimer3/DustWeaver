## Phase Four — Room Preload Anticipation Policy Extraction (BUILD 443)

### What was done

Extracted the 82-line inline preload anticipation block from `gameScreen.ts`'s frame loop into a new stateless, Node-testable module: `src/screens/roomPreloadAnticipationPolicy.ts`.

### Module added: `roomPreloadAnticipationPolicy.ts`

- `dominantVelocityDirection(vx, vy)` — pure direction helper (strict `> 1.0` threshold, horizontal wins ties)
- `selectProximityTarget(px, py, room)` — first authored near transition within 10 medium blocks (inclusive `>=`/`<=`)
- `selectVelocityTarget(dir, room)` — first authored matching transition in velocity direction
- `applyRoomPreloadAnticipationPolicy(player, room, originX, originY, ports)` — single per-frame call site
- `RoomPreloadAnticipationPorts` interface — narrow structural port created once in `startGameScreen`, no per-frame allocation

### Files changed

| File | Change |
|---|---|
| `src/screens/roomPreloadAnticipationPolicy.ts` | New — stateless policy module |
| `src/tests/roomPreloadAnticipationPolicy.test.ts` | New — 44 characterization tests |
| `src/screens/gameScreen.ts` | Inline 82-line block replaced with policy call; `URGENT_PRELOAD_PROXIMITY_BLOCKS` removed |
| `src/build-info.ts` | BUILD_NUMBER 442 → 443 |
| `docs/ARCHITECTURE.md` | Added policy module documentation |
| `docs/AI_REPO_MAP.md` | Added routing row |

### Tests added

44 new tests covering: missing/dead player, nonzero room origin, all four proximity directions, exact threshold inclusivity (`>=`/`<=`), just-outside threshold, authored ordering, one proximity promotion per frame, missing/partial/fully prepared runtime entries, all four velocity directions, exact 1.0 exclusion, horizontal tie-breaking, dominant-axis behavior, and combined same/different target cases.

Suite grew from 495 to 539.

### Validation

| Command | Exit code | Notes |
|---|---|---|
| `npm test` | 0 | 539/539 pass |
| `npm run build` | 0 | chunk size warning only |
| `npx tsc --noEmit` | 0 | clean |
| `npm run lint` | 1 | 7 pre-existing errors only (editorFillBrush.test.ts) |

### Behavioral delta

None. Extraction is semantically equivalent to the original block — authored-order selection, exact proximity inclusivity, strict velocity threshold (`> 1.0`), horizontal tie-breaking all preserved. No new per-frame allocation introduced.

### Browser testing

RAF does not advance in headless environment. Boundary approach, velocity prediction, prepared/unprepared destinations, and resident readiness could not be exercised via browser.

### Compatibility

No thresholds or priorities altered. No transition geometry changed. No room-loading paths changed.

### Git status

- Branch: main
- Build: 443
- Commits: `9b970d5b`, `952911fa` (pushed, exit 0)
- Working tree: clean

### Recommended next action

Run a manual foreground cross-zone round trip in-browser using `__dwTransitionStats()` to close the combined Phase Three/Four runtime-validation gap.

---

## Phase Five — Centralize campaign-spawn starting-option application (BUILD 444)

### Baseline (Build 443, branch main, commit b0f6e65a)

| Command | Exit code | Notes |
|---|---|---|
| `npm test` | 0 | 539/539 pass |
| `npm run build` | 0 | chunk size warning only |
| `npx tsc --noEmit` | 0 | clean |
| `npm run lint` | 0 | 7 pre-existing errors in editorFillBrush.test.ts |

### Behavior characterized

Two independent starting-option application blocks existed in `src/game.ts`:

**Official campaign path** (lines ~178–199 at baseline):
- Guard: `officialSpawn !== null && progress.exploredRoomIds.length === 0`
- `startingHealth`: clamped `[1, PLAYER_INITIAL_HEALTH]`
- `startingDustContainerCount`: floored, clamped >= 0, then `Math.max(existing, normalized)` — merge semantics
- `startingDustTypes`: `stringToParticleKind` → `unlockDustType`, unknown ignored
- `startingWeaves`: checked against `WEAVE_REGISTRY`, `unlockActiveWeave`, unknown ignored

**Packed custom-campaign path** (lines ~382–411 at baseline):
- Guard: `cSpawn !== undefined`
- Creates fresh progress with `createDefaultProgress()` first
- Same health and dust/weave normalization
- `startingDustContainerCount`: `Math.max(0, Math.floor(...))` — assigned directly (fresh semantics, no merge)

### Helper API chosen

```typescript
// src/progression/campaignStartingOptions.ts
export type CampaignStartingOptionsMode = 'merge' | 'fresh';
export function applyCampaignStartingOptions(
  progress: PlayerProgress,
  spawn: CampaignSpawnData,
  mode: CampaignStartingOptionsMode,
): void;
```

Mode distinction is explicit in the call site — no hidden boolean.

### Merge vs fresh semantics

- `'merge'`: `dustContainerCount = Math.max(existing, normalized)` — official campaign path, never reduces a newly-created profile's count
- `'fresh'`: `dustContainerCount = normalized` — packed custom-campaign path, assigns exact configured value to a brand-new `createDefaultProgress()` result

### Tests added

`src/tests/campaignStartingOptions.test.ts` — 27 new tests covering:
- Health: absent/unchanged, below-1 → 1, above-max → capped, valid preserved
- Containers: absent/unchanged, negative → 0, fractional → floored, valid preserved, merge never reduces, merge increases lower count, fresh assigns exactly, default-progress case
- Dust types: valid unlocks, unknown ignored, duplicates deduplicated, existing remain, empty no-op
- Weaves: registered unlocks, unknown ignored, duplicates deduplicated, existing remain, empty no-op
- Combined: all four together, unrelated fields unchanged, merge preserves progression, fresh starts clean, spawn not mutated

### Files changed

| File | Change |
|---|---|
| `src/progression/campaignStartingOptions.ts` | New — shared helper |
| `src/tests/campaignStartingOptions.test.ts` | New — 27 characterization + behavior tests |
| `src/game.ts` | Replaced both starting-option blocks with `applyCampaignStartingOptions()`; removed `stringToParticleKind`, `unlockDustType`, `unlockActiveWeave`, `WEAVE_REGISTRY`, `PLAYER_INITIAL_HEALTH` imports |
| `src/build-info.ts` | BUILD_NUMBER 443 → 444 |
| `docs/ARCHITECTURE.md` | Added `src/progression/` bullet for campaignStartingOptions |
| `docs/AI_REPO_MAP.md` | Added routing row for campaign starting-options |

### Validation results

| Command | Exit code | Notes |
|---|---|---|
| `npm test` | 0 | 566/566 pass (27 new) |
| `npm run build` | 0 | chunk size warning only |
| `npx tsc --noEmit` | 0 | clean |
| `npm run lint` | 0 | same 7 pre-existing errors |

### Browser testing

Not exercised — RAF does not advance in headless environment. Scenarios that could not be verified via browser:
- Brand-new official profile receives configured options exactly once on first Play press
- Reopening same profile does not reapply options
- Packed custom campaign receives configured health/containers/dust/weaves
- Packed campaign without `campaignSpawn` starts normally
- Folder-based campaigns start normally (code path unchanged)
- Menu re-entry does not duplicate unlocks

### Behavioral deltas

None. Semantics are identical to the previous per-path inline code — normalization math is unchanged, unlock helpers are unchanged, guard conditions are unchanged.

### Compatibility assessment

No serialized data changed. No campaign schema changed. No API surface changed. The helper is Node-safe (no DOM imports, no mutable module state). Call sites in game.ts have equivalent behavior to what they replaced.

### Remaining risks

- Browser-path validation was not performed. The guard logic (`exploredRoomIds.length === 0`) and the `campaignSpawn !== undefined` check are unchanged, so behavioral regression is unlikely.
- `startingHealth` is optional in `PlayerProgress`; the helper sets it only when `spawn.startingHealth !== undefined`, preserving the existing skip-if-absent behavior.

### Recommended next action

Run a browser smoke test: create a new save, press Play, verify configured starting options appear; reopen the same save, verify options are not re-applied.

### Git status

- Branch: main
- Baseline commit: b0f6e65a
- Build: 444
- Auto-sync: present on repo (commits every ~10 min); no auto-sync commits occurred during this phase

---

## Phase Six — Extract the speedrun timer state machine (COMPLETE; BUILD 446)

**Claimed:** Codex on 2026-07-13. Scope is limited to the files and behavior
listed in this phase; implementation results will be recorded here before the
phase is marked complete.

**Progress:** Added `src/screens/gameRunTimer.ts` and 21 direct characterization
tests in `src/tests/gameRunTimer.test.ts`; the targeted suite passed 21/21
before replacing the inline `gameScreen.ts` state.

### Planning baseline

- Branch: `main`
- HEAD: `26c01d8` (`docs: restore Phase 4 section in RefactorPlan.md`)
- Upstream: `origin/main` at the same commit
- Build: `445` from `src/build-info.ts`
- Working tree before this plan update: clean
- Recent implementation commits reviewed:
  - `80ff977` — grapple adjustment and BUILD 445
  - `da4c16d` / `b22a817` — Phase Five plan/results and implementation
  - `9b970d5` — Phase Four implementation
  - `708f628` / `30fa60b` — original speedrun-timer feature and follow-up

Current validation at this baseline:

| Command | Exit code | Notes |
|---|---:|---|
| `npm test` | 0 | 566/566 pass |
| `npm run build` | 0 | 913 modules transformed; existing unresolved-font, Vite CJS deprecation, and large-chunk warnings only |
| `npx tsc --noEmit` | 0 | clean |
| `npm run lint` | 1 | exactly 7 pre-existing `no-explicit-any` errors in `src/tests/editorFillBrush.test.ts`, already recorded in `docs/TODO.md` |
| `git diff --check` | 0 | clean before this plan update |

### Decision and evidence

A sixth refactor phase is justified. It should extract the speedrun timer state
machine from `src/screens/gameScreen.ts` into a small Node-safe module, proposed
as `src/screens/gameRunTimer.ts`.

This is a new phase, not a continuation or repetition of completed Phases One
through Five or legacy `REFACTORING_PLAN.md` Sections 1 through 12.

The current timer behavior has one cohesive responsibility but four separate
touch points in `gameScreen.ts`:

1. Lines approximately 956–968 normalize two restored values and create three
   mutable state variables: current time, checkpoint time, and the
   waiting-for-intent flag.
2. Lines approximately 1006–1015 snapshot the checkpoint before the save
   callback and restore it after respawn.
3. Lines approximately 1354–1378 detect deliberate movement, arm the timer,
   and advance it only for a live player on an eligible gameplay frame.
4. The render call reads the current value around line 1676.

`rg` finds no direct timer-state tests under `src/tests`. Existing save-slot
validation covers persisted timer fields, and HUD code formats/displays the
value, but neither pins the in-session state transitions above. The logic is
deterministic, has no necessary DOM/render/simulation mutation, and can accept
scalar inputs without allocating in the frame loop. That makes it a better
refactor seam than another broad split based only on file length.

### Objective

Move ownership of the following state and transitions into one focused module:

- normalized current run time;
- normalized checkpoint run time;
- waiting-for-intent state;
- per-gameplay-frame arming and accumulation;
- checkpoint capture;
- checkpoint restore on respawn;
- read-only access to the current value for rendering and persistence.

The extraction is architectural and testability-focused. It must not change
timer semantics, save data, HUD appearance, gameplay pacing, or assist-mode
behavior.

### Required behavioral contract

Characterize and preserve these source-derived rules before replacing the
inline implementation:

- Missing, negative, `NaN`, and infinite initial timer values normalize to `0`.
- Positive finite initial values, including fractional milliseconds, remain
  unchanged.
- Current and checkpoint values are normalized independently.
- A new timer always begins in the waiting-for-intent state, even when restored
  with a nonzero current value.
- Intent means exactly: `moveDx !== 0`, `jumpTriggered`, or `isJumpHeldFlag`.
- Intent arms the timer only while the player exists and is alive.
- The frame that first supplies valid intent also adds that frame's
  `elapsedMs`; arming must not introduce a one-frame delay.
- Once armed, the timer advances on each subsequent eligible gameplay frame
  while the player is alive; continued input is not required.
- A missing or dead player neither arms nor advances the timer.
- Pause/menu, death, editor, loading, transition, entry-warm, and asset-decode
  holds remain enforced by the existing early returns in `gameScreen.ts`.
  The timer module must not reproduce or reorder those screen-level gates.
- Accumulation retains the current `Math.max(0, current + elapsedMs)` behavior.
- Checkpoint capture copies the current value and returns/exposes that exact
  value so `callbacks.onCheckpointReached` receives it before `onSave` runs.
- Respawn restores the current value from the checkpoint and re-enters the
  waiting-for-intent state.
- Reading the value for `renderFrame` is side-effect free.

### Proposed API boundary

Prefer a small class or factory with private mutable state. The exact naming may
follow nearby repository conventions, but the public surface should be no
broader than:

```ts
createGameRunTimer(initialRunTimerMs?, initialCheckpointRunTimerMs?)
getCurrentMs()
getCheckpointMs() // only if tests or integration need it
isWaitingForMovement() // only if characterization needs it
tick(elapsedMs, playerAlive, moveDx, jumpTriggered, jumpHeld)
captureCheckpoint()
restoreCheckpoint()
```

Use scalar `tick` arguments or a reused input object. Do not allocate a new
options object on every frame. Keep the module free of DOM, rendering,
`WorldState`, persistence, and wall-clock dependencies.

### Scope boundaries

In scope:

- `src/screens/gameRunTimer.ts` (new, or an equivalently focused name);
- `src/tests/gameRunTimer.test.ts` (new characterization tests);
- the minimal `src/screens/gameScreen.ts` integration changes;
- `src/build-info.ts` patch increment exactly once for the implementation;
- concise routing/architecture documentation updates if the new module needs
  to be discoverable.

Out of scope:

- `src/progression/saveSlots.ts` schema, migration, or formatting changes;
- `GameScreenRunOptions` or `GameScreenCallbacks` API changes;
- `gameOverlayController.ts` checkpoint/save/respawn ordering changes;
- `gameHudRenderer.ts`, `gameRender.ts`, or timer visual changes;
- frame-delta computation, `lastTimestampMs` resets, or loading-frame gates;
- assist mode, despite its current proximity to timer options;
- gameplay balance, transition logic, resident loading, editor behavior, or
  unrelated lint cleanup;
- introducing a general-purpose clock framework or event bus.

### Implementation sequence

1. Reconfirm branch, build, worktree, and the exact current timer call sites.
   If source differs materially from this baseline, stop and revise the plan
   before coding.
2. Add characterization tests for the inline contract listed above. Tests
   should exercise a Node-safe timer module directly; do not require canvas,
   RAF, browser globals, or a constructed `WorldState`.
3. Implement the smallest state owner that passes those tests. Keep all state
   instance-local so repeated game-screen sessions cannot share timer state.
4. In `gameScreen.ts`, replace the three mutable timer variables and local
   clamp helper with one timer instance.
5. Route the existing overlay callbacks through `captureCheckpoint()` and
   `restoreCheckpoint()` without changing callback order.
6. Replace the inline gameplay-frame block with one allocation-free `tick`
   call made at the same location, after the same early-return gates.
7. Read `getCurrentMs()` at the existing render input and persistence callback
   sites. Do not cache a stale copy across frames.
8. Update `docs/AI_REPO_MAP.md` and `docs/ARCHITECTURE.md` only as needed to
   identify the new ownership boundary.
9. Increment the patch component of `BUILD_NUMBER` exactly once from the value
   current when implementation begins. Do not assume it is still `445`.
10. Run targeted tests first, then the full validation set. Record exact counts,
    warnings, and any baseline-only failures in this plan when marking the phase
    complete.

### Characterization test matrix

At minimum, cover:

1. default/missing initial values normalize to zero;
2. negative, `NaN`, positive infinity, and negative infinity normalize to zero;
3. positive and fractional current/checkpoint values are preserved independently;
4. restored nonzero current time still starts waiting;
5. no input while alive leaves the timer waiting and unchanged;
6. horizontal input arms and advances on the same tick;
7. triggered jump arms and advances on the same tick;
8. held jump arms and advances on the same tick;
9. zero horizontal input does not count as intent;
10. missing/dead player cannot arm the timer;
11. dead player does not advance an already-armed timer;
12. an armed live timer advances without continued input;
13. accumulation preserves the lower bound at zero;
14. checkpoint capture stores and returns the exact current value;
15. later ticking does not mutate the stored checkpoint;
16. respawn restores the checkpoint and returns to waiting;
17. post-respawn passive frames do not advance;
18. post-respawn valid intent resumes on that same frame;
19. two timer instances remain independent;
20. getters do not mutate state.

Do not add speculative semantics for non-finite frame deltas unless a current
caller can produce them and a separate behavior change is explicitly approved.

### Acceptance criteria

- Timer state has one owner outside `gameScreen.ts`.
- `gameScreen.ts` retains only construction, scalar frame inputs, overlay
  callback delegation, and read-only consumption.
- All source-derived behavior in the contract is pinned by direct tests.
- The first intentional-input frame still counts time.
- Checkpoint capture still precedes save persistence.
- Respawn still restores the checkpoint and waits for fresh intent.
- Screen-level early-return ordering is unchanged.
- No new per-frame heap allocation is introduced.
- No DOM, render, persistence, or simulation dependency enters the timer module.
- Public game-screen callbacks/options and serialized save shape are unchanged.
- The implementation changes only the files in scope unless a concrete import
  or documentation dependency requires another minimal edit.
- The implementation increments `BUILD_NUMBER` exactly once.
- The full test suite and production build pass; lint reports no new errors
  beyond the documented baseline unless the baseline has since been repaired.

### Validation commands

Run from the repository root, in this order:

```powershell
node --import tsx --test src/tests/gameRunTimer.test.ts
npm test
npx tsc --noEmit
npm run build
npm run lint
git diff --check
git status --short --branch
```

Practical browser smoke test after automated validation:

1. Start a new or restored run and confirm the displayed timer does not move
   before deliberate movement.
2. Move or jump and confirm the timer starts immediately.
3. Open and close pause/map/skill-tomb UI and confirm covered time is not added.
4. Activate a save point, allow time to advance, die, and respawn; confirm the
   timer returns to the checkpoint value and waits for new movement.
5. Return to menu and reopen the save to confirm persistence remains unchanged.

### Risks and mitigations

- **First-input off-by-one:** Arming and accumulation currently occur in the
  same frame. Pin this before integration and keep one `tick` call at the old
  block location.
- **Checkpoint/save ordering drift:** `gameOverlayController` invokes the
  checkpoint hook before `onSave`. Do not move timer ownership into that
  controller or reorder callbacks.
- **Loading or pause time leakage:** The screen's early returns, not the timer,
  define eligible frames. Do not call `tick` earlier in `frame()`.
- **Respawn clock leakage:** Existing `onResetFrameClock` remains responsible
  for `lastTimestampMs`; the timer module only restores checkpoint state.
- **Stale render value:** Read the module's current value at render time instead
  of maintaining a mirrored local variable.
- **Cross-session leakage:** Avoid module-level mutable singleton state; every
  `startGameScreen` call must create an independent timer.
- **Scope creep:** Save migration, HUD formatting, assist mode, and loading-gate
  consolidation are separate concerns and must remain unchanged.

### Model-neutral agent instructions

Implement this as a behavior-preserving extraction, not a timer redesign.
Read `agents.md`, `docs/AI_REPO_MAP.md`, `docs/CURRENT_STATUS.md`, `docs/TODO.md`,
this phase, and the named source files before editing. Verify current source
instead of trusting line numbers, which are evidence anchors only. Add tests
before replacing inline state. Preserve call order and early-return placement.
Keep the new module Node-safe, instance-local, and allocation-free in the hot
path. Do not implement any out-of-scope cleanup encountered along the way; add
a concise TODO only for concrete deferred work. Bump the current build patch
exactly once, run the listed validation, update this phase with actual results
and commit hashes, then commit and push the coherent implementation.

### Planning-run restriction

Do not implement Phase Six in the run that authored this section. That run is
documentation-only and must commit and push only `RefactorPlan.md`.

### Completion record

Completed by Codex on 2026-07-13. Implementation commit: `91a9482`
(`Auto-sync 2026-07-13 18:58:03`, pushed to `origin/main`).

Files changed:

| File | Change |
|---|---|
| `src/screens/gameRunTimer.ts` | Added the Node-safe, instance-local timer state owner |
| `src/tests/gameRunTimer.test.ts` | Added 21 characterization tests across initialization, intent/accumulation, checkpoint/respawn, and ownership |
| `src/screens/gameScreen.ts` | Replaced three inline mutable values with one timer instance; preserved checkpoint, respawn, tick, and render call-site order |
| `src/build-info.ts` | Incremented BUILD_NUMBER 445 → 446 exactly once |
| `docs/AI_REPO_MAP.md` | Added timer routing and ownership guidance |
| `docs/ARCHITECTURE.md` | Documented the screen/timer responsibility boundary |
| `RefactorPlan.md` | Recorded claim, progress, implementation, validation, and completion |

Behavior and compatibility:

- No intended behavioral delta.
- Same-frame arming/accumulation, alive-player gating, zero lower bound,
  checkpoint-before-save ordering, and respawn waiting semantics are preserved.
- Pause, menu, editor, loading, transition, entry-warm, and decode gating remain
  in their original `gameScreen.ts` positions.
- No save schema, callback/options API, HUD formatting, assist-mode, or frame
  clock behavior changed.
- The timer has no DOM, render, persistence, `WorldState`, or wall-clock import.
- `tick` receives scalar arguments and performs no per-frame allocation.

Validation results:

| Command | Exit code | Notes |
|---|---:|---|
| `node --import tsx --test src/tests/gameRunTimer.test.ts` | 0 | 21/21 pass before and after integration |
| `npm test` | 0 | 587/587 pass (21 new; baseline 566) |
| `npx tsc --noEmit` | 0 | clean |
| `npm run build` | 0 | 914 modules transformed; existing font-resolution, Vite CJS deprecation, and large-chunk warnings only |
| `npm run lint` | 1 | exactly the 7 documented baseline `no-explicit-any` errors in `src/tests/editorFillBrush.test.ts`; no new findings |
| `npx eslint src/screens/gameRunTimer.ts src/tests/gameRunTimer.test.ts src/screens/gameScreen.ts` | 0 | all touched TypeScript files clean |
| `git diff --check` | 0 | clean |

Browser smoke test:

- Local Vite runtime returned HTTP 200 and visibly reported BUILD 446.
- Main menu, empty save-slot creation, Normal Mode selection, the full 18-room
  initial zone load, and gameplay startup completed.
- Movement input was accepted in gameplay and no browser console errors were
  recorded.
- The timer text was not visually legible in the captured dark gameplay frame,
  so display/pause/checkpoint/respawn persistence was not claimed as manually
  verified. The extracted state transitions are covered directly by the 21
  Node characterization tests.

Acceptance result: all code-level acceptance criteria are satisfied. No new
deferred work was discovered, so `docs/TODO.md` was not changed.

---

## Phase Seven — Extract the editor playtest room activation transaction (COMPLETE; BUILD 447)

### Planning baseline and decision

This phase was planned from a clean `main` worktree at `c91cd06`, synchronized
with `origin/main`, with `BUILD_NUMBER` 446. Recent history confirms Phase Six
is complete: `91a9482` contains its implementation and `c91cd06` records its
completion. This proposal does not reopen or expand any completed phase.

A further phase is justified, but not because `gameScreen.ts` is large. The
editor playtest callback currently owns a single cross-system lifecycle
transaction whose correctness depends on exact invalidation, rebuild, load,
and re-registration ordering. That is a concrete ownership boundary with stale
runtime risk and no direct characterization test.

Planning-run baseline validation:

| Command | Result |
|---|---|
| `npm test` | 587/587 tests pass |
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass; existing font-resolution, Vite CJS deprecation, and large-chunk warnings only |
| `npm run lint` | Fails only on the 7 documented baseline `no-explicit-any` errors in `src/tests/editorFillBrush.test.ts` |

### Current-code evidence

The callback passed to `createEditorController` in `src/screens/gameScreen.ts`
currently performs all of the following inline:

1. resolves a collision-safe spawn for the edited room;
2. bumps the edited room's resident-build version;
3. invalidates the edited room's runtime cache and render-chunk prewarm;
4. invalidates the edited room's resident world;
5. discovers radius-one neighboring rooms and invalidates their resident worlds
   and render-chunk prewarm state;
6. invalidates the edited room's zone-ready state;
7. queues rebuilds for the edited room and its radius-one neighbors;
8. performs the destructive room load; and
9. re-registers the newly loaded live world as the active resident world.

This ordering is policy, not incidental plumbing:

- `ResidentBuildScheduler.queueRebuildAfterEdit` explicitly leaves version
  bumping and resident-world invalidation to its caller. The editor callback is
  therefore the only owner of the complete edit-to-runtime transaction.
- `ZoneLoader.invalidateZone` clears readiness and can invalidate the active
  same-world loading session; moving it after the load would change lifecycle
  semantics.
- `ensureResident` must occur before `setActiveResidentId` and
  `setResidentWorld`, and the world registered after loading must be the fresh
  live `world`, not a pre-load reference.
- `bfsNearbyRooms(..., 1)` supplies a unique, radius-one neighbor list in
  authored transition order. That radius and order determine which dependent
  resident/prewarm/rebuild state is refreshed.

The block accumulated through separate correctness fixes rather than one
designed owner: spawn resolution (`d76214f`), runtime-cache invalidation
(`18ae1bc`), resident invalidation/rebuild (`5fce6f2`), neighboring-room
coverage (`d985118`), zone invalidation (`4df9839`), active resident
re-registration (`4115a99`), chunk-prewarm invalidation (`6f44b1e`), and stale
build-version handling (`28e33bb`). Existing tests cover the individual
scheduler, cache, zone, resident, and graph helpers, but no test characterizes
their combined editor transaction or proves that the post-load world is the
one re-registered.

This is distinct from the completed resident-build scheduler and transition
execution phases. Those owners remain unchanged and are dependencies/ports of
this editor-to-runtime coordinator; Phase Seven must not absorb their policy.

### Objective

Create one Node-safe, port-injected coordinator for applying an edited room to
the live playtest runtime, tentatively
`src/screens/gameEditorRoomActivationCoordinator.ts`. Replace the inline
callback body in `gameScreen.ts` with one coordinator call while preserving the
transaction's current operations, arguments, ordering, synchronous failure
behavior, and neighbor selection exactly.

The coordinator owns only orchestration: which existing operations run and in
what order. It must not own cache implementations, resident construction,
build scheduling policy, zone loading, room graph traversal policy, spawn
collision logic, or room loading internals.

### Exact scope

In scope:

- Add `src/screens/gameEditorRoomActivationCoordinator.ts` with a small typed
  port interface and one synchronous transaction entry point.
- Add `src/tests/gameEditorRoomActivationCoordinator.test.ts` containing
  characterization tests driven by recording fakes/sentinels.
- Make the smallest integration edit in `src/screens/gameScreen.ts`: construct
  or pass the existing operations and replace the inline editor callback body
  with the coordinator call.
- Use a getter/callback for the active `world` so it is read only after
  `loadRoom` returns.
- Update `docs/AI_REPO_MAP.md` and `docs/ARCHITECTURE.md` with the new ownership
  boundary.
- Increment the patch component of `BUILD_NUMBER` exactly once for the coherent
  implementation, then record actual results and commits in this phase.

Explicitly excluded:

- No changes to editor tools, editing gestures, serialization/export, room
  definitions, saved room data, or editor UI.
- No changes to `ResidentBuildScheduler`, `ResidentRoomManager`,
  `RoomRuntimeCache`, `ZoneLoader`, chunk-prewarm implementations, their
  priorities, or their public behavior.
- No change to `bfsNearbyRooms`, graph traversal radius/order, transition
  definitions, transition execution, boundary walls, trigger geometry, room
  load phases, or resident activation helpers.
- Do not add runtime-cache invalidation or version bumps for neighbors; the
  current callback does neither.
- No asynchronous conversion, batching, retries, error recovery, swallowed
  exceptions, performance redesign, or generalized lifecycle framework.
- No save-schema, timer, overlay, campaign-option, skill-tomb, checkpoint,
  respawn, camera, render, audio, or gameplay changes.
- No cleanup based only on file length and no unrelated TODO or lint repair.

### Behavioral contract to preserve

For one callback invocation, the extracted transaction must preserve these
observable rules:

1. Resolve the safe spawn from the incoming room and requested coordinates
   before any invalidation. Pass the resolved coordinates, original room, and
   original `preserveCamera` flag to `loadRoom` unchanged.
2. Bump the edited room's resident-build version exactly once, before cache or
   resident invalidation. Do not bump any neighbor version.
3. Invalidate runtime-cache state for the edited room exactly once. Do not
   invalidate runtime-cache state for neighbors.
4. Invalidate edited-room chunk-prewarm state and resident-world state before
   processing neighbors.
5. Derive a unique radius-one neighbor list with the existing
   `bfsNearbyRooms` behavior and the existing room registry. Exclude the edited
   room and preserve returned order; do not broaden the radius.
6. For every returned neighbor, invalidate resident-world state and then
   chunk-prewarm state, preserving current per-neighbor and neighbor-list order.
7. Invalidate the edited room's zone after room/neighbor invalidation and
   before any rebuild queueing. Use `roomDef.worldNumber ?? 1` exactly.
8. Queue the edited room rebuild first, then one rebuild for each neighbor in
   the same order. Complete all queueing before loading the room.
9. Call `loadRoom` synchronously after all invalidation and queue operations.
10. Only after `loadRoom` returns, read the current live world through the
    injected getter. Then call `ensureResident(roomDef)`,
    `setActiveResidentId(roomDef.id)`, and
    `setResidentWorld(roomDef.id, freshWorld, true)` in that order.
11. Do not catch or translate errors. If any operation throws, later operations
    do not run; specifically, a throwing `loadRoom` must prevent all post-load
    resident registration.
12. Do not mutate the incoming room definition, registry, or neighbor list in
    the coordinator. Existing port implementations retain responsibility for
    their own state changes.

### Characterization tests required before integration

Use recording ports and distinct old/new world sentinels. Tests must cover:

- a room with no neighbors, asserting the full exact call sequence;
- one and multiple radius-one neighbors in authored graph order;
- cycles/duplicate graph paths, proving each radius-one neighbor is handled
  once and the edited room is not treated as its own neighbor;
- the edited-room-only version bump and runtime-cache invalidation rules;
- edited-room invalidation before neighbor invalidation, zone invalidation
  before rebuild queueing, edited-room rebuild before neighbor rebuilds, and
  all queueing before load;
- explicit `worldNumber` and the missing-world-number fallback of `1`;
- collision-adjusted spawn forwarding and both `preserveCamera` values;
- a loader fake that swaps the live world sentinel, proving the coordinator
  reads and registers the new world only after load;
- exact `ensureResident` -> active-ID -> active-world registration ordering;
- a throwing loader, proving no post-load world read or resident registration
  occurs and the original error propagates;
- no mutation of the supplied room definition and registry; and
- the existing graph helper's direct missing-target behavior if a fixture
  includes a transition to an absent registry entry, so extraction does not
  silently introduce filtering that the current callback lacks.

Tests should assert semantic call records and arguments, not source text,
private fields, or incidental implementation structure. The new module must be
importable by the Node test runner without DOM, canvas, Electron, renderer,
asset, or browser initialization.

### Implementation sequence

1. Re-read the current callback and the immediately used APIs; confirm the
   planning baseline has not drifted and keep Phase Six closed.
2. Add the coordinator test with recording ports and establish the complete
   current call-order contract before modifying `gameScreen.ts`.
3. Add the narrow coordinator and its typed ports. Reuse
   `bfsNearbyRooms(..., registry, 1)` rather than reimplementing graph policy.
4. Run the new focused test and TypeScript check before integration.
5. Wire existing `gameScreen.ts` collaborators into the coordinator. Ensure the
   world port is a getter that observes the value assigned by `loadRoom`, not a
   captured snapshot.
6. Replace only the current inline editor playtest transaction. Remove imports
   only if the extraction makes them genuinely unused; do not rearrange nearby
   editor, transition, preload, or gameplay code.
7. Run the focused test again, then the full automated validation and targeted
   lint. Perform the editor smoke checks below.
8. Update the architecture/map documentation, bump `BUILD_NUMBER` once, and
   record the implementation files, results, limitations, and commit hashes in
   this phase. Commit and push one coherent phase.

### Acceptance criteria

- The `createEditorController` playtest callback delegates the complete
  edit-to-runtime transaction to one named coordinator; it no longer spells out
  the multi-system sequence inline.
- The coordinator is synchronous, Node-safe, port-injected, and contains no DOM,
  render, asset, Electron, save, or wall-clock dependency.
- Focused characterization tests prove every behavioral-contract item above,
  including exact sequence, neighbor scope/order, edited-only policies,
  post-load fresh-world registration, and failure short-circuiting.
- Existing cache, scheduler, zone, resident, graph, room-loading, and transition
  implementations are unchanged.
- No intended runtime behavior, persistence format, room data, UI, geometry, or
  performance policy changes.
- `BUILD_NUMBER` advances from the then-current value by exactly one patch step.
- Full tests, TypeScript, and production build pass. Targeted lint for touched
  TypeScript files passes; full lint introduces no findings beyond a precisely
  documented pre-existing baseline.
- Documentation names the new ownership boundary and `git diff --check` is
  clean.

### Manual smoke checks

In a local development build:

1. Enter the editor for the active room, make a small reversible geometry edit,
   and playtest it. Confirm the player uses a collision-safe spawn and the edit
   is visible immediately.
2. Repeat with camera preservation both enabled and disabled through existing
   editor paths, confirming current camera behavior is unchanged.
3. Edit a room with a connected neighbor, playtest, transition to the neighbor
   and back, and confirm neither room displays stale geometry or resident state.
4. Repeat an edit/playtest cycle twice to exercise build-version invalidation;
   confirm an older pending build never replaces the latest edited world.
5. Watch the browser console throughout and record any errors. Do not claim
   lifecycle behavior as manually verified unless the relevant edit,
   transition, and return path were actually observed.

### Validation commands

```bash
node --import tsx --test src/tests/gameEditorRoomActivationCoordinator.test.ts
npx tsc --noEmit
npm test
npm run build
npm run lint
npx eslint src/screens/gameEditorRoomActivationCoordinator.ts src/tests/gameEditorRoomActivationCoordinator.test.ts src/screens/gameScreen.ts
git diff --check
git status --short --branch
```

Full lint currently has seven baseline `no-explicit-any` errors in
`src/tests/editorFillBrush.test.ts`. Phase Seven must not fix them incidentally;
record the exact baseline and require zero new lint findings.

### Risks and mitigations

- **Stale world re-registration:** Passing `world` by value when constructing
  ports would preserve the pre-load world. Require a post-load getter and prove
  it with distinct sentinels.
- **Ordering drift:** Grouping operations by subsystem can subtly move zone
  invalidation or queueing. Assert one exact semantic call record.
- **Neighbor policy expansion:** A seemingly safer implementation could add
  neighbor version bumps/runtime invalidation, filtering, or a wider radius.
  Encode the current edited-only policies and radius-one output in tests.
- **Partial-failure redesign:** Transactions and rollback may sound desirable
  but would change current synchronous exception behavior. Propagate errors and
  stop at the throwing port.
- **Node import contamination:** Importing browser-heavy screen modules into the
  coordinator would undermine focused tests. Depend on types, the pure graph
  helper, and injected operations only.
- **Completed-phase creep:** Resident scheduling, transition execution, preload
  anticipation, campaign options, and run timing already have owners. Treat
  them strictly as unchanged dependencies or out-of-scope systems.

### Model-neutral Codex/Claude instructions

Implement only Phase Seven as a behavior-preserving extraction. Read
`agents.md`, the required repository docs, all of `RefactorPlan.md`, and the
named source/API files before editing. Treat every earlier phase as closed.
Verify current code rather than trusting evidence line numbers. First add
recording-port characterization tests for the complete editor playtest room
activation sequence. Then extract that sequence into the narrow Node-safe,
port-injected coordinator described here and replace only its inline callback
in `gameScreen.ts`. Preserve exact spawn, invalidation, neighbor, zone, rebuild,
load, fresh-world registration, and exception ordering; do not change any
underlying subsystem or broaden neighbor policy. Keep the active world behind a
getter evaluated after `loadRoom`. Make no unrelated cleanup. Bump the build
patch exactly once, update only the required architecture/map and phase records,
run every listed validation plus the practical smoke checks, document exact
results and limitations, then commit and push the completed phase. Stop after
Phase Seven.

### Planning-run restriction

Do not implement Phase Seven in the run that authored this section. This run is
documentation-only: update, commit, and push only `RefactorPlan.md`; do not
change source, tests, other documentation, room data, or `BUILD_NUMBER`.

### Completion record

Completed by Codex on 2026-07-13. Planning commit: `d2793a3`
(`Auto-sync 2026-07-13 19:18:03`). Implementation commits: `389a62a`
(`Auto-sync 2026-07-13 19:58:03`) and `d137bc3`
(`Auto-sync 2026-07-13 20:08:03`). All three commits were pushed to
`origin/main` before this completion record was written.

Files changed:

| File | Change |
|---|---|
| `src/screens/gameEditorRoomActivationCoordinator.ts` | Added the synchronous, Node-safe, port-injected owner of the editor playtest activation transaction |
| `src/tests/gameEditorRoomActivationCoordinator.test.ts` | Added 11 recording-port characterization tests for ordering, neighbor policy, spawn/camera forwarding, fresh-world registration, mutation safety, and failure propagation |
| `src/screens/gameScreen.ts` | Replaced only the inline editor playtest transaction with one coordinator call and concrete runtime ports |
| `src/build-info.ts` | Incremented `BUILD_NUMBER` 446 -> 447 exactly once |
| `docs/AI_REPO_MAP.md` | Added routing guidance for editor playtest activation and invalidation work |
| `docs/ARCHITECTURE.md` | Documented the editor-to-runtime ownership boundary |
| `RefactorPlan.md` | Recorded the completed implementation, validation, and practical smoke-test results |

Implementation decisions and behavioral contract:

- No intended runtime behavioral delta.
- Safe-spawn resolution, edited-room version/runtime/chunk/resident
  invalidation, radius-one neighbor discovery and invalidation, zone
  invalidation, edited-first rebuild queueing, room loading, and active
  resident registration retain their original exact sequence.
- The coordinator reuses `bfsNearbyRooms(..., registry, 1)` and does not add
  filtering, sorting, version bumps, or runtime-cache invalidation for
  neighbors.
- The active world remains behind a getter evaluated only after `loadRoom`
  returns, so the resident record receives the newly loaded world.
- The production callback's `preserveCamera` argument is actually optional.
  Its type is therefore `boolean | undefined`, and characterization covers
  unchanged forwarding of `true`, `false`, and `undefined`.
- Exceptions remain synchronous and unaltered. A throwing loader prevents the
  fresh-world read and every post-load resident operation.
- No cache, scheduler, zone, resident, graph, transition, preload, editor UI,
  room-data, persistence, or geometry implementation changed.

Characterization development:

- The first pre-integration focused run passed 9/10 tests. The one failure was
  an introduced fixture error: the helper's default world number converted an
  intended missing `worldNumber` case into world 2. The fixture was corrected
  without changing production behavior, after which 10/10 passed.
- Integration exposed the callback's optional `preserveCamera` type during the
  TypeScript check. The port was corrected from `boolean` to
  `boolean | undefined`, and an eleventh test was added to pin undefined
  passthrough. Final focused validation passes 11/11.

Validation results:

| Command | Exit code | Notes |
|---|---:|---|
| `node --import tsx --test src/tests/gameEditorRoomActivationCoordinator.test.ts` | 0 | 11/11 pass after integration |
| `node --import tsx --test src/tests/gameEditorRoomActivationCoordinator.test.ts src/tests/residentBuildScheduler.test.ts src/tests/roomTransitionLoadCoordinator.test.ts src/tests/roomPreloadAnticipationPolicy.test.ts src/tests/entryWarmDecision.test.ts` | 0 | 119/119 related lifecycle tests pass |
| `npm test` | 0 | 598/598 pass (11 new; baseline 587) |
| `npx tsc --noEmit` | 0 | clean |
| `npm run build` | 0 | production Vite build passes; existing Vite CJS deprecation, unresolved-at-build-time Cinzel font, and large-chunk warnings only |
| `npm run lint` | 1 | exactly the 7 documented baseline `no-explicit-any` errors in `src/tests/editorFillBrush.test.ts`; no new findings |
| `npx eslint src/screens/gameEditorRoomActivationCoordinator.ts src/tests/gameEditorRoomActivationCoordinator.test.ts src/screens/gameScreen.ts` | 0 | all touched TypeScript files clean |
| `git diff --check` | 0 | clean before the completion record |

Browser smoke test:

- The local Vite runtime returned HTTP 200 and visibly reported BUILD 447.
- Main menu, empty save-slot creation, Normal Mode selection, initial zone
  loading, gameplay startup, pause-menu editor entry, and return to gameplay
  all completed.
- In the active room, the top edge was extended so height changed from 58 to
  59. Confirm/playtest returned to gameplay, and re-entering the editor showed
  height 59, demonstrating immediate activation of the edited definition.
- A second cycle reversed the same edit from height 59 to 58 and successfully
  returned to gameplay again. This exercised repeated invalidation/rebuild/load
  activation without an observed stale replacement.
- Browser console errors: none. The console did contain existing
  resident-build and freeze-profiler warnings during the exceptionally slow
  instrumented initial zone load; these were performance diagnostics, not
  activation exceptions.
- Collision-safe spawn selection, all three camera-preservation argument forms,
  radius-one ordering, fresh-world timing, and loader failure behavior are
  directly covered by characterization tests. The browser pass did not visibly
  inspect the resolved spawn coordinate, exercise a separate camera-preserving
  editor path, or perform a connected-neighbor transition away and back, so
  those manual observations are not claimed.
- Electron validation was not run because neither the phase plan nor repository
  instructions require Electron-specific behavior for this Node-safe/browser
  extraction.

Acceptance result: all code-level acceptance criteria are satisfied. The
practical browser pass confirmed two reversible edit/playtest cycles with no
console errors, subject to the explicit manual limitations above. No new
deferred work was discovered, so `docs/TODO.md` was not changed. Phase Seven is
closed; do not repeat or expand it.

### Follow-up connected-neighbor validation

Completed manually in the local browser on 2026-07-13 at BUILD 447. In the
connected lobby room, Stone Hollow (`lobby`), the room height was reversibly
changed from 58 to 59 and the edited room was playtested. The authored right
transition was then traversed into Stone Crossing (`w1_room1`), followed by its
authored left transition back to Stone Hollow. Re-entering the editor after the
round trip still showed height 59, so neither the neighbor activation nor the
return activation replaced the latest edit with stale geometry or an older
resident build. The height was then restored to 58 and playtested again.

The browser console contained no errors and no stale-build diagnostics during
the round trip. Dev Mode was enabled only to make movement practical through
browser-generated discrete keypresses; both normal authored room-transition
triggers executed. No repository source, room data, build number, or save
schema was changed by this validation. This closes the recorded connected-
neighbor manual limitation without reopening Phase Seven.

---

## Phase Eight — Extract the skill-tomb activation transaction (COMPLETE; BUILD 448)

**Claimed:** Codex on 2026-07-13. Phases One through Seven remain closed.

**Completed:** Codex on 2026-07-13. Added the Node-safe
`gameSkillTombActivation.ts` transaction and 18 direct characterization tests
before production integration. `gameOverlayController.ts` now delegates only
the deterministic transaction through one stable structural port object; its
guards, activation-time live-world getter, modal construction, and close
lifecycle remain in place. `BUILD_NUMBER` advanced exactly once from 447 to
448. Focused, related, TypeScript, touched-file lint, full test, and production
build validation pass. Full lint has only the seven documented baseline
`no-explicit-any` errors in `src/tests/editorFillBrush.test.ts`.

### Planning baseline and current validation

This phase was planned from `main` at
`b47e9bffa3d544eac4efc40c791c052f482f326d`, tracking `origin/main` with
ahead/behind counts `0/0`, a clean working tree, and `BUILD_NUMBER` 447. There
are no commits after the Phase Seven completion commit and no unrelated or
auto-sync changes to preserve at this baseline. Phases One through Seven are
closed and remain out of scope.

Planning-run validation:

| Command | Exit code | Notes |
|---|---:|---|
| `npm test` | 0 | 598/598 pass; 9 suites, 0 failed/skipped/cancelled |
| `npx tsc --noEmit` | 0 | clean |
| `npm run build` | 0 | 915 modules transformed; existing Vite CJS deprecation, unresolved-at-build-time Cinzel font, and large-chunk warnings only |
| `npm run lint` | 1 | exactly the 7 documented baseline `no-explicit-any` errors in `src/tests/editorFillBrush.test.ts`; no other findings |
| `git diff --check` | 0 | planning-only diff is whitespace-clean |
| `git status --short --branch` | 0 | only `RefactorPlan.md` is modified for this planning result |

The first sandboxed build attempt exited 1 because esbuild could not read
`../../..` or resolve `vite.config.ts` under the restricted environment. The
identical build rerun with normal repository access exited 0, classifying the
first result as environment-only rather than a source regression.

### Decision and current-code evidence

Phase Eight is justified by a concrete ownership and testability boundary, not
by file length. `openSkillTombMenu` in
`src/screens/gameOverlayController.ts` currently combines DOM/modal lifecycle
with a deterministic gameplay/progression transaction:

1. It obtains the live world through `getWorld()` and selects exactly
   `world.clusters[0]` (`openSkillTombMenu`, lines approximately 113-124).
2. It converts the player's absolute position to room-local coordinates using
   `getCurrentRoomOrigin()` and asks `SkillTombRenderer.getNearbyTombIndex` for
   the interactable save tomb (approximately lines 128-133).
3. For a valid index and tomb position, it writes `lastSaveRoomId` and rounded
   `lastSaveSpawnBlock`, then invokes `onCheckpointReached` before `onSave`
   (approximately lines 134-144).
4. Whether or not a valid tomb position was returned, an existing player is
   healed to maximum health (approximately lines 147-149).
5. It scans `world.particleCount` entries and restores only non-transient
   particles owned by that player: dead particles with a positive respawn
   delay are shortened to one tick, while alive particles regain their element
   profile's toughness (approximately lines 150-159).
6. It then passes the captured player position and healed health values into
   the browser-only `showSkillTombMenu` UI (approximately lines 162-181).

No direct test under `src/tests` imports or characterizes
`gameOverlayController`, `openSkillTombMenu`, or this combined transaction.
The controller imports `showDeathScreen`, `showMapOnlyModal`,
`showSkillTombMenu`, and the canvas-oriented `SkillTombRenderer`, so direct
Node characterization would unnecessarily require browser/UI collaborators.
In contrast, `createWorldState`, `createClusterState`, `PlayerProgress`, and
`getElementProfile` are already used by Node tests and are sufficient to test
the deterministic mutation policy after renderer lookups are represented as
narrow ports.

History reinforces the lifecycle risk. Commit `d293b8e0` introduced the
overlay extraction and the save/heal transaction, `708f628` added the timer
checkpoint callback, `a5d875c` fixed checkpoint-before-save ordering, and
`4227878` replaced a captured `WorldState` with `getWorld()` after resident
activation exposed a stale-world bug. The transaction therefore contains
correctness behavior accumulated through multiple fixes but still lacks a
direct characterization boundary.

This is architectural work because it separates deterministic progression and
simulation mutation from DOM/modal orchestration. It does not add a feature,
change a save point, alter healing, or redesign overlays. It is stronger than
the other visible candidates: the current transition/performance TODOs require
measurement or behavior optimization, the seven lint findings are isolated
test typing debt, and completed game-screen/resident/transition/timer/editor
coordinators already own their respective boundaries.

### Objective and ownership boundary

Create a small Node-safe module, tentatively
`src/screens/gameSkillTombActivation.ts`, that owns exactly the synchronous
skill-tomb activation transaction:

- locate a tomb relative to the current room origin through injected lookup
  ports;
- update the last-save room and rounded block coordinates when a valid tomb
  position exists;
- preserve checkpoint-before-save callback ordering;
- heal the selected player cluster;
- restore the current player's eligible particle state; and
- return the scalar values needed to open the existing menu.

`gameOverlayController.ts` continues to own overlay guards, map/modal closing,
open-state flags, cleanup functions, DOM menu construction, close callbacks,
loadout writes, frame-clock reset, and save-on-close behavior. The new module
must not import UI, DOM, canvas, renderer classes, Electron, storage, or the run
timer implementation.

### Behavioral contract to preserve

- `openSkillTombMenu` still returns immediately when the menu is already open
  or `progress` is absent, and still closes the map-only modal before marking
  the skill-tomb menu open.
- The live world is still obtained at activation time through `getWorld()`;
  it must not be captured when the overlay controller is constructed.
- The transaction selects exactly `world.clusters[0]`. It does not search by
  `isPlayerFlag` or fall back to another cluster.
- When cluster zero is absent, no room-origin or tomb lookup occurs, no save or
  particle state changes, and the menu receives zero for player position,
  health, and maximum health.
- With a player, the nearby-tomb query receives
  `player.positionXWorld - currentRoomOriginXWorld` and the corresponding Y
  value exactly.
- A negative nearby index skips tomb-position lookup and checkpoint/save
  mutation, but does not skip player/particle healing.
- A nonnegative index whose position lookup returns `null` also skips progress
  writes and checkpoint/save callbacks while preserving healing.
- A valid tomb position writes the current room ID, then assigns a new
  `lastSaveSpawnBlock` tuple using `Math.round(tombCoordinate /
  BLOCK_SIZE_MEDIUM)` independently for X and Y.
- Progress writes complete before callbacks. `onCheckpointReached`, when
  present, runs before `onSave`, when present. Missing callbacks are no-ops.
- Exceptions are not caught or translated. A throwing checkpoint callback
  prevents save, healing, and menu construction; a throwing save callback
  prevents healing and menu construction, matching current synchronous
  short-circuit behavior.
- An existing player's `healthPoints` becomes exactly `maxHealthPoints`, and
  both health values returned for the menu equal that maximum. The returned
  player X/Y values are the original absolute world coordinates.
- The particle loop visits only indices below `world.particleCount`.
- Particles whose `ownerEntityId` differs from `player.entityId` are unchanged.
- Owned transient particles are unchanged regardless of alive/dead state.
- Owned non-transient dead particles change only when
  `respawnDelayTicks > 0`, in which case the delay becomes exactly `1`.
- Owned non-transient alive particles have `particleDurability` reset to
  `getElementProfile(kindBuffer[index]).toughness`; their respawn delay is not
  changed by this transaction.
- No unrelated world buffers, cluster fields, progress fields, tomb lookup
  data, room data, or loadout data are mutated.
- `showSkillTombMenu` still receives the current room ID through the existing
  controller getter after the deterministic transaction, and its close
  callback behavior remains unchanged.

### Proposed testable API boundary

The exact names may follow nearby conventions, but keep the surface no broader
than this structural shape:

```ts
export interface SkillTombActivationPorts {
  getCurrentRoomOrigin(): readonly [number, number];
  getCurrentRoomId(): string;
  getNearbyTombIndex(localXWorld: number, localYWorld: number): number;
  getTombPosition(index: number): { xWorld: number; yWorld: number } | null;
  onCheckpointReached?: () => void;
  onSave?: () => void;
}

export interface SkillTombActivationResult {
  playerXWorld: number;
  playerYWorld: number;
  playerHealthPoints: number;
  playerMaxHealthPoints: number;
}

export function applySkillTombActivation(
  world: WorldState,
  progress: PlayerProgress,
  ports: SkillTombActivationPorts,
): SkillTombActivationResult;
```

The port must be structural; do not import `SkillTombRenderer`. If preserving
the current conditional getter call pattern requires splitting room-origin and
room-ID getters exactly as shown, prefer that over eager scalar capture. The
controller should create stable port wrappers once rather than rebuilding a
dependency object inside every menu activation.

### Required scope

- Add `src/screens/gameSkillTombActivation.ts` (or an equivalently focused
  name) with the Node-safe transaction and result type.
- Add `src/tests/gameSkillTombActivation.test.ts` with direct characterization
  against real `createWorldState`/`createClusterState` buffers and recording
  lookup/callback ports.
- Make the smallest integration edit in
  `src/screens/gameOverlayController.ts`: delegate the deterministic block and
  retain all UI/open/close lifecycle code in place.
- Increment `BUILD_NUMBER` exactly once from the value current when Phase Eight
  implementation begins.
- Update `docs/AI_REPO_MAP.md`, `docs/ARCHITECTURE.md`, and this phase's
  completion record only as needed to name the new owner and actual results.

Optional only when mechanically necessary:

- Remove `BLOCK_SIZE_MEDIUM` and `getElementProfile` imports from
  `gameOverlayController.ts` after their sole uses move to the new module.
- Export a narrow tomb-position structural type if it avoids duplication and
  does not pull renderer/browser dependencies into the Node-safe module.

### Explicit exclusions

- No changes to death-screen respawn selection, campaign-spawn fallback,
  map-only behavior, overlay mutual-exclusion rules, controller destroy logic,
  or pause gating.
- No changes to `showSkillTombMenu`, its UI, loadout/weave editing, menu-close
  saving, input prompts, `SkillTombRenderer`, tomb dust animation, interaction
  radius, or tomb placement.
- No changes to `GameRunTimer`, checkpoint values, timer arming/accumulation,
  save-slot schema/migration, `PlayerProgress` shape, or persistence format.
- No changes to player/particle healing amounts, element toughness,
  regeneration rates, lifetime processing, transient semantics, ownership
  rules, particle capacity, or simulation tick order.
- No changes to rooms, saved campaign data, room transitions, resident loading,
  caches, preload policy, editor activation, rendering, audio, camera, gameplay
  balance, or platform behavior.
- Do not generalize this into an overlay state machine, interaction framework,
  event bus, service locator, lifecycle manager, or generic transaction system.
- Do not fix unrelated lint findings or perform cleanup based on file length.

### Characterization-test matrix

Before replacing the production block, add direct tests covering at minimum:

1. missing cluster zero returns all-zero menu values and performs no port calls
   or mutations;
2. cluster zero is used even when a later cluster has `isPlayerFlag === 1`;
3. absolute player position is returned while exact room-local coordinates are
   passed to the nearby lookup;
4. negative nearby index skips position lookup and save/checkpoint work but
   still heals the player and eligible particles;
5. nonnegative index plus `null` tomb position has the same no-save behavior;
6. valid tomb position writes current room ID and independently rounded block
   coordinates, including fractional values that distinguish `Math.round`;
7. semantic call recording proves room/progress writes precede checkpoint,
   checkpoint precedes save, and all save work precedes healing;
8. absent optional callbacks still allow progress writes and healing;
9. checkpoint callback failure propagates and prevents save/healing;
10. save callback failure propagates and prevents healing;
11. player health becomes max health and returned health values match it;
12. owned alive non-transient particles reset durability from their exact kind
    profiles without changing respawn delays;
13. owned dead non-transient particles with positive delay become delay 1,
    while delay-zero dead particles remain unchanged;
14. owned transient particles and all particles owned by other entities remain
    unchanged;
15. indices at or above `particleCount` remain untouched even when backing
    arrays contain sentinel data;
16. unrelated cluster, world-buffer, and progress fields remain unchanged;
17. lookup inputs/returned tomb-position objects are not mutated; and
18. repeated calls use the supplied live world independently and do not retain
    cross-session or prior-world state.

Tests should assert semantic values and call records, not source text, private
controller fields, or incidental implementation structure. Establish these
tests against the extracted transaction before replacing the inline production
block.

### Implementation sequence

1. Reconfirm the branch, build, worktree, current callback, and absence of
   direct transaction tests. Keep Phases One through Seven closed.
2. Add the recording-port characterization tests and the narrow Node-safe
   transaction module without changing the production callback.
3. Run the focused tests and `npx tsc --noEmit`; correct only test-fixture or
   contract mismatches supported by current source.
4. In `gameOverlayController.ts`, create stable wrappers for the current room
   getters, renderer lookup methods, and optional callbacks. Keep `getWorld()`
   at activation time.
5. Replace only the deterministic local-variable/save/heal/particle block with
   `applySkillTombActivation`, then pass its returned scalars to the existing
   `showSkillTombMenu` call.
6. Preserve the menu-open guard, map close, state flag, menu room-ID getter,
   on-close loadout/save behavior, and cleanup code in their current order.
7. Remove only imports made genuinely unused by the extraction. Do not move
   death or map-only logic.
8. Run focused tests again, relevant existing timer/progression/particle tests,
   touched-file lint, then all standard validation and the practical browser
   smoke checks.
9. Bump `BUILD_NUMBER` once, update required architecture/map/phase records,
   commit and push the coherent implementation, and stop after Phase Eight.

### Acceptance criteria

- `openSkillTombMenu` delegates exactly one deterministic activation operation
  to a named Node-safe module and otherwise retains its overlay/UI ownership.
- The new module imports no DOM, UI, canvas, renderer class, Electron, storage,
  or timer implementation.
- Characterization tests pin every contract item above, including conditional
  port calls, coordinate frames, progress/callback/healing order, exception
  short-circuiting, particle filters, buffer bounds, and live-world isolation.
- The controller still obtains the current world at activation time and does
  not capture a stale resident world.
- Save-point coordinates, callback order, healing, menu arguments, menu guards,
  close behavior, and persistence semantics are unchanged.
- No public save schema, progress shape, room data, UI, renderer, simulation,
  transition, resident, or gameplay behavior changes.
- No per-frame work or allocation is added. At most one small result object is
  allocated per explicit menu activation, with no world/buffer copying.
- `BUILD_NUMBER` advances by exactly one patch step for the implementation.
- Focused and full tests, TypeScript, and production build pass. Targeted lint
  passes; full lint has no findings beyond the documented baseline unless that
  baseline is independently repaired before implementation.
- Documentation identifies the new boundary and `git diff --check` is clean.

### Validation commands

Run from the repository root:

```powershell
node --import tsx --test src/tests/gameSkillTombActivation.test.ts
node --import tsx --test src/tests/gameSkillTombActivation.test.ts src/tests/gameRunTimer.test.ts src/tests/campaignStartingOptions.test.ts
npx tsc --noEmit
npx eslint src/screens/gameSkillTombActivation.ts src/tests/gameSkillTombActivation.test.ts src/screens/gameOverlayController.ts
npm test
npm run build
npm run lint
git diff --check
git status --short --branch
```

Full lint currently has exactly seven baseline `no-explicit-any` errors in
`src/tests/editorFillBrush.test.ts`. Do not fix them incidentally; require zero
new findings. If the sandboxed Vite build repeats the access-denied
`vite.config.ts` failure, rerun the identical command with normal repository
access and record both results.

### Practical browser smoke checks

Use a disposable local browser save with a reachable save tomb:

1. Damage the player, activate the tomb, and confirm the existing menu opens
   with the player healed to maximum health.
2. Close the menu and confirm loadout/weave selection and save-on-close behavior
   remain unchanged.
3. Move away and attempt interaction, confirming a missing nearby tomb does not
   update the last-save location or checkpoint while the existing interaction
   guard behavior remains unchanged.
4. After a valid activation, advance the run timer, die, choose Return to Last
   Save, and confirm the player returns to the same rounded tomb location and
   the timer restores to its checkpoint value.
5. Exercise a room transition before another activation so `getWorld()` is
   proven to use the live resident world rather than a construction-time world.
6. Record console errors and relevant warnings. Do not claim particle-buffer
   healing as visually verified unless debug instrumentation exposes it; the
   direct Node tests are authoritative for those buffer rules.

Electron validation is not required unless implementation introduces an
unexpected platform-specific dependency, which this phase explicitly forbids.

### Risks and mitigations

- **Stale world capture:** The overlay previously had a real stale-world bug.
  Keep `getWorld()` in `openSkillTombMenu` and pass the returned live world to
  each transaction call; test repeated calls with distinct worlds.
- **Coordinate-frame drift:** Renderer tomb positions are room-local while the
  player/menu coordinates are absolute. Record exact lookup inputs and returned
  menu values in tests.
- **Checkpoint/save reordering:** Saving before checkpoint capture persists the
  wrong timer. Assert progress writes -> checkpoint -> save -> healing as one
  semantic sequence.
- **Healing on no-save paths:** The current code heals whenever a player exists,
  even if tomb lookup fails. Pin negative-index and null-position cases.
- **Particle overreach:** Reordering filters can revive transient or foreign
  particles. Test ownership first, transient exclusion, alive/dead branches,
  and `particleCount` bounds with distinct sentinels.
- **Exception redesign:** Catching callback errors or moving healing earlier
  would alter current partial-failure behavior. Propagate errors and preserve
  short-circuiting.
- **Renderer contamination:** Importing `SkillTombRenderer` would keep the new
  module browser-bound. Use structural lookup ports only.
- **Completed-phase creep:** Phase Six owns timer state and Phase Seven owns
  editor room activation. Treat their callbacks/behavior as unchanged external
  dependencies rather than reopening either phase.

### Performance and allocation considerations

This transaction runs only on explicit skill-tomb menu activation, not in the
fixed tick or render loop. Preserve the single bounded scan through
`world.particleCount`; do not replace it with array materialization, filtering,
sorting, cloning, or an unbounded capacity scan. Construct port wrappers once
per overlay-controller instance. A single small scalar result object per menu
activation is acceptable and replaces four mutable locals; no per-frame
allocation, world clone, TypedArray copy, or renderer-state copy is allowed.

### Model-neutral Codex/Claude instructions

Implement only Phase Eight as a behavior-preserving extraction. Read
`agents.md`, all required repository docs, all of `RefactorPlan.md`, and the
named overlay/world/progress/renderer sources before editing. Treat Phases One
through Seven as closed. Verify current source rather than trusting planning
line numbers. First add direct Node characterization for the full deterministic
skill-tomb activation contract, including conditional lookups, coordinate
conversion, progress writes, checkpoint-before-save ordering, healing,
particle ownership/transient/alive rules, exception short-circuiting, and
live-world isolation. Then extract only that transaction into a narrow
Node-safe module with structural ports and integrate it into
`openSkillTombMenu`; leave all overlay guards, UI construction, close behavior,
death/map handling, timer internals, renderer behavior, save schema, and
gameplay policy unchanged. Make no unrelated cleanup. Bump the current build
patch exactly once, update only required architecture/map/phase records, run
every listed validation plus practical browser checks, document exact results
and limitations, commit and push, then stop after Phase Eight.

### Planning-run restriction

Do not implement Phase Eight in the run that authored this section. This run is
planning-only: update, commit, and push only `RefactorPlan.md`. Do not change
source code, tests, `BUILD_NUMBER`, save version, room/campaign data, or any
unrelated documentation.

### Completion record

Phase Eight was completed on 2026-07-13 at BUILD 448. Phases One through Seven
remained closed, and no work outside the Phase Eight boundary was taken on.

Implementation results:

- Added `src/screens/gameSkillTombActivation.ts` as the Node-safe owner of the
  deterministic save-point, checkpoint/save ordering, player-healing, and
  owned-particle-healing transaction.
- Added `src/tests/gameSkillTombActivation.test.ts` with all 18 planned
  characterization cases, including failure short-circuiting, exact coordinate
  frames, bounded particle access, and repeated live-world isolation.
- Replaced only the inline transaction in `openSkillTombMenu` with one call to
  `applySkillTombActivation`. The overlay controller retains its guard, map
  close, activation-time `getWorld()`, modal creation, save-on-close, and
  cleanup ownership.
- Added stable structural ports once per overlay-controller instance. The new
  module has no DOM, UI, canvas, renderer-class, storage, Electron, or timer-
  implementation dependency and adds no per-frame work.
- Updated `docs/AI_REPO_MAP.md` and `docs/ARCHITECTURE.md` only to identify the
  new ownership boundary. No room/campaign data, save schema, progress shape,
  timer policy, renderer behavior, gameplay balance, or unrelated source was
  changed.
- Advanced `BUILD_NUMBER` exactly once from 447 to 448.

Final validation:

| Command | Exit code | Result |
|---|---:|---|
| `node --import tsx --test src/tests/gameSkillTombActivation.test.ts` | 0 | 18/18 tests pass |
| `node --import tsx --test src/tests/gameSkillTombActivation.test.ts src/tests/gameRunTimer.test.ts src/tests/campaignStartingOptions.test.ts` | 0 | 66/66 tests pass across 12 suites |
| `npx tsc --noEmit` | 0 | clean |
| `npx eslint src/screens/gameSkillTombActivation.ts src/tests/gameSkillTombActivation.test.ts src/screens/gameOverlayController.ts` | 0 | clean |
| `npm test` | 0 | 616/616 tests pass across 12 suites; 0 failed/skipped/cancelled |
| `npm run build` | 0 | 916 modules transformed; existing Vite CJS deprecation, unresolved-at-build-time Cinzel font, and large-chunk warnings only |
| `npm run lint` | 1 | exactly the seven pre-existing `no-explicit-any` errors in `src/tests/editorFillBrush.test.ts`; zero new findings |

Practical browser smoke used a disposable local save. The app displayed Build
448, entered a new Normal Mode game in the official campaign lobby, and an
off-tomb interaction left the skill-tomb overlay closed without a new runtime
error. The official campaign currently places its only save tomb in
`seal_chamber`, far from the lobby, so the full heal, save-on-close,
death/checkpoint, and transition-before-reactivation route was not practical in
this disposable run. Those transaction paths are covered by the direct 18-case
Node suite; particle-buffer healing remains test-verified rather than visually
claimed.

All Phase Eight acceptance criteria are satisfied within the documented full-
lint and manual-smoke limitations. Phase Eight is closed; do not expand it or
begin another phase as part of this implementation run.
