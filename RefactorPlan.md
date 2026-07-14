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

## Phase Six — Extract the speedrun timer state machine (PROPOSED; baseline BUILD 445)

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
