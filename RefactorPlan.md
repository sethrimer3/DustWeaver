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

## Phase Seven — Extract the editor playtest room activation transaction (PROPOSED; baseline BUILD 446)

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
