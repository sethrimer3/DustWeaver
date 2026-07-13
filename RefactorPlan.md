# DustWeaver Refactor Plan

**Repository:** `sethrimer3/DustWeaver`  
**Baseline branch:** `main`  
**Baseline build:** `442`  
**Baseline commits reviewed:** `eceae262`, `cea80fad`, `7b4f3886`, `7943b3a5`  
**Document status:** Active implementation plan  
**Intended agents:** Codex, Claude, or another repository-capable coding agent

---

## 1. Decision

A further refactor phase is productive.

The next phase should extract the **room preload anticipation policy** from the main `gameScreen.ts` frame loop. This is the remaining transition-adjacent block that decides which destination room should receive urgent work based on:

- player proximity to a room boundary;
- player velocity direction;
- runtime-cache readiness;
- sprite/background decode readiness;
- render-chunk prewarm readiness;
- resident-world readiness.

This phase is justified because the current inline block coordinates four independent preparation systems and embeds priority policy directly inside the gameplay frame loop. It is small enough to extract safely, active enough to benefit future transition work, and deterministic enough to characterize thoroughly.

This is an architectural/testability refactor. It is **not** a speculative performance optimization.

---

## 2. Work Completed So Far

### Phase One — Room activation and render-state derivation

**Commit:** `eceae262`  
**Build:** 440

Completed:

- Consolidated duplicated full-load and resident-hot-swap activation logic.
- Centralized room render-state derivation.
- Centralized wall-prewarm context and wall-template snapshot adaptation.
- Fixed the async transition path so the outgoing resident world is invalidated before shared-world mutation.
- Added characterization tests and documentation.

Primary result:

- Both room-activation paths now use shared lifecycle helpers.
- Prewarm and adoption render-state keys derive from one source of truth.

### Phase Two — Resident build scheduler and zone-transition state

**Commit:** `cea80fad`  
**Build:** 441

Completed:

- Extracted the resident build queue from the `startGameScreen` closure.
- Extracted active build-session state.
- Extracted room-version stale-build guards.
- Extracted initial zone-load progress.
- Added `ResidentBuildScheduler`, `ZoneTransitionState`, and `InitialZoneLoadProgress`.
- Added characterization coverage for deduplication, priority upgrades, stale-version rejection, budget gating, failure recovery, and reset behavior.

Primary result:

- Resident background builds now have one explicit owner and are independently testable.

### Phase Three — Room-transition execution coordinator

**Commits:** `7b4f3886`, `7943b3a5`  
**Build:** 442

Completed:

- Added `roomTransitionLoadCoordinator.ts`.
- Moved transition path selection and execution out of `gameScreen.ts`.
- Moved async load-generator state and cross-zone pending activation into the coordinator.
- Preserved the async DEV log distinction between `cold` and `partial`.
- Added `ZoneTransitionState.clear()` for reset/shutdown.
- Added 27 tests covering:
  - four-way path precedence;
  - resident integrity rejection;
  - hot-swap ordering;
  - velocity application;
  - async lifecycle;
  - cross-zone lifecycle;
  - entry warming;
  - reset behavior.
- Fixed the cross-zone re-entry defect that could re-defer the target transition indefinitely.
- Simplified the `gameScreen.ts` loading branches to coordinator calls.

Primary result:

- Transition execution now has one explicit owner.
- Boundary detection, background resident building, room loading, zone preparation, and transition execution remain separate responsibilities.

### Remaining validation note from Phase Three

The cross-zone correction is well covered by unit tests but still merits one foreground manual round trip between the two campaign zones when a normal browser environment is available.

---

## 3. Current Evidence for Phase Four

The relevant inline block remains in:

`src/screens/gameScreen.ts`

It currently performs two policies every gameplay frame.

### Proximity policy

When the player is within 10 medium blocks of a transition-facing boundary, the first matching transition in authored order receives:

1. runtime-cache priority promotion if not fully prepared;
2. aggressive theme-sprite and background decoding when the target room is loaded;
3. unconditional render-chunk prewarm promotion/creation;
4. resident-world build priority `1` when the target resident is not ready.

Only one proximity target is boosted per frame.

### Velocity-direction policy

When either velocity axis has magnitude greater than `1.0` world unit per tick:

1. the dominant axis selects `left`, `right`, `up`, or `down`;
2. horizontal wins an exact magnitude tie;
3. the first transition matching that direction receives resident-build priority `2` when not ready.

### Existing scheduler contracts

`ResidentBuildScheduler` already defines:

- priority `1`: proximity target;
- priority `2`: velocity-direction target;
- lower numbers are more urgent;
- duplicate room requests coalesce;
- a more urgent request upgrades an existing queued or active task;
- priority never downgrades.

`roomRenderChunkWarmScheduler.ts` independently contains nearly identical dominant-velocity direction logic for initial queue ordering. That duplicated decision rule can drift unless it is shared.

### Why extraction is useful

The inline block currently mixes:

- geometric target selection;
- motion interpretation;
- readiness queries;
- asset decode requests;
- runtime-cache queue promotion;
- chunk-prewarm queue promotion;
- resident-build queue promotion.

This is a coherent policy boundary, not merely a long block of rendering code.

Extraction will:

- make threshold and target-selection behavior independently testable;
- prevent priority drift across preload systems;
- make `gameScreen.ts` easier to reason about;
- allow future transition-preparation tuning without editing the main frame loop;
- centralize the duplicated dominant-direction rule;
- preserve scheduler ownership rather than creating a new scheduler.

---

## 4. Phase Four Objective

Extract the stateless **room preload anticipation policy** from `gameScreen.ts`.

A suitable module name is:

`src/screens/roomPreloadAnticipationPolicy.ts`

The exact name may change if repository conventions support a clearer name.

The module should own the policy that answers:

- Is the player close enough to a transition boundary to promote that target?
- Which transition target is selected when more than one is eligible?
- Does current velocity predict a likely transition direction?
- Which existing preparation systems should be notified for each selected target?

It must not own:

- queues;
- workers;
- timers;
- animation frames;
- runtime caches;
- resident worlds;
- render-chunk stores;
- asset loaders;
- room transitions themselves.

---

## 5. Required Behavioral Contract

Preserve the current behavior exactly unless a defect is reproduced and explicitly accepted.

### Player eligibility

- No work occurs when the player cluster is missing.
- No work occurs when the player is dead.
- Position checks use room-local coordinates:
  - `positionXWorld - currentRoomOriginXWorld`;
  - `positionYWorld - currentRoomOriginYWorld`.

### Proximity target selection

- Proximity threshold remains `10` medium blocks.
- `right`: player local X is greater than or equal to the right threshold.
- `left`: player local X is less than or equal to the left threshold.
- `down`: player local Y is greater than or equal to the bottom threshold.
- `up`: player local Y is less than or equal to the top threshold.
- Transitions are checked in authored array order.
- The first near transition wins.
- At most one proximity target is promoted per frame.
- Trigger-strip alignment is not added in this refactor; proximity remains boundary-direction based.

### Proximity side effects

For the selected target:

1. Read its runtime-cache entry.
2. When absent or not fully prepared:
   - call the current runtime preload schedule’s `prioritize(roomId)` when a handle exists;
   - request theme-sprite decoding when the target room is in `ROOM_REGISTRY`;
   - request background decoding when the target room is in `ROOM_REGISTRY`.
3. Always call `ensureChunkPrewarmQueued(roomId, 'proximity')`.
4. If the resident is missing or not runtime-ready, enqueue:
   - priority: `1`;
   - reason: `'proximity'`.

Preserve this action order unless repository evidence proves it is irrelevant.

### Velocity target selection

- Minimum velocity remains a strict `> 1.0` comparison.
- If neither absolute axis exceeds the threshold, no velocity target is selected.
- The dominant axis determines direction.
- Horizontal wins when absolute X and Y are equal.
- Positive X selects `right`; negative X selects `left`.
- Positive Y selects `down`; negative Y selects `up`.
- Transitions are checked in authored order.
- The first matching transition wins.
- At most one velocity target is considered per frame.

### Velocity side effects

For the selected target:

- if the resident is missing or not runtime-ready, enqueue:
  - priority: `2`;
  - reason: `'velocityDirection'`.

### Interaction between both policies

- Proximity and velocity policies may select the same target in one frame.
- Do not add policy-level deduplication unless current observable behavior proves it equivalent.
- The resident scheduler’s existing coalescing and no-downgrade rules remain authoritative.
- Proximity priority `1` must continue to win over velocity priority `2`.

---

## 6. Target Architecture

Prefer a stateless, Node-safe module with narrow structural ports.

A reasonable shape is:

- pure helper for dominant transition direction;
- pure helper for selecting the first proximity target;
- pure helper for selecting the first velocity-direction target;
- one stateless application function that invokes existing systems through injected ports.

Do not require this exact API if a smaller interface preserves the same boundary.

### Suggested properties

- No class unless state is genuinely required.
- No module-level mutable state.
- No DOM imports.
- No import of `gameScreen.ts`.
- No generic manager or event bus.
- No new scheduling mechanism.
- No per-frame arrays, maps, sets, closures, or result-object allocation.
- Dependency/port object should be created once during `startGameScreen`, not once per frame.
- Existing player and room objects should be passed directly rather than copied into new per-frame objects.

### Shared direction helper

The dominant-direction rule is duplicated in `roomRenderChunkWarmScheduler.ts`.

Centralize it only if:

- exact threshold and tie semantics are characterized first;
- the shared helper has a neutral dependency location;
- no circular import is introduced;
- no runtime allocation is added.

A small pure helper may live in the new policy module or another existing pure transition/prewarm helper module. Do not create a broad utility barrel solely for one function.

---

## 7. Planned File Scope

Expected additions:

- `src/screens/roomPreloadAnticipationPolicy.ts`
- `src/tests/roomPreloadAnticipationPolicy.test.ts`

Expected modifications:

- `src/screens/gameScreen.ts`
- `src/screens/roomRenderChunkWarmScheduler.ts` only if sharing the direction helper
- `ARCHITECTURE.md`
- `docs/AI_REPO_MAP.md`
- `docs/TODO.md` only for concrete discoveries or validation limitations
- `src/build-info.ts`
- this `RefactorPlan.md`

Avoid unrelated edits.

---

## 8. Characterization and Regression Tests

Add focused tests before replacing the inline block.

### Player and coordinate behavior

- Missing player causes no calls.
- Dead player causes no calls.
- Nonzero room origins are subtracted correctly.
- Local coordinates, not global coordinates, control proximity.

### Boundary proximity

For each direction:

- exactly at the threshold counts as near;
- just outside the threshold does not count;
- room width/height are interpreted using `BLOCK_SIZE_MEDIUM`.

### Transition ordering

- When multiple transitions are near, the first authored transition wins.
- Only one proximity target is promoted in one frame.
- When multiple transitions share the velocity direction, the first wins.

### Runtime-cache behavior

- Missing cache entry triggers runtime priority and decode requests.
- Partial cache entry triggers runtime priority and decode requests.
- Fully prepared cache entry skips runtime priority and decode requests.
- Chunk prewarm is still ensured when runtime data is fully prepared.
- Missing target room prevents decode calls but does not suppress the existing target-ID queue calls.

### Resident behavior

- Missing resident triggers priority `1` for proximity.
- Non-ready resident triggers priority `1`.
- Ready resident suppresses the proximity resident request.
- Missing/non-ready velocity target triggers priority `2`.
- Ready velocity target suppresses the velocity request.

### Velocity direction

- `vx > 1` selects right.
- `vx < -1` selects left.
- `vy > 1` selects down.
- `vy < -1` selects up.
- Exactly `1.0` or `-1.0` does not qualify.
- Equal absolute X/Y magnitude selects the horizontal direction.
- The larger absolute axis wins otherwise.

### Combined behavior

- Proximity and velocity may target different rooms in one frame.
- Proximity and velocity may target the same room.
- When both target the same room, priority `1` remains the effective scheduler priority through existing scheduler semantics.
- Side-effect ordering remains stable where meaningful.

### Shared helper parity

When direction logic is shared with the chunk-prewarm scheduler:

- existing velocity-ordering behavior remains unchanged;
- threshold strictness remains unchanged;
- horizontal tie behavior remains unchanged;
- positive/negative direction mapping remains unchanged.

Tests should assert observable decisions and calls, not private implementation fields.

---

## 9. Implementation Sequence

1. Read repository instructions and this document.
2. Inspect current `main`; do not rely only on the commit descriptions above.
3. Confirm branch, build number, and working-tree state.
4. Record baseline:
   - `npm test`;
   - `npm run build`;
   - `npx tsc --noEmit`;
   - `npm run lint`.
5. Confirm the known lint baseline. At the time this plan was written, `docs/TODO.md` records seven pre-existing `no-explicit-any` findings in `src/tests/editorFillBrush.test.ts`.
6. Trace every caller and dependency in the inline preload block.
7. Add focused policy tests.
8. Implement the stateless module.
9. Create its dependency ports once in `startGameScreen`.
10. Replace the inline block with one narrow call.
11. Remove moved constants and duplicate direction logic when safe.
12. Search for stale comments and old policy copies.
13. Review the hot path for new allocation or repeated lookups.
14. Update architecture and repository-routing docs.
15. Increment the build number according to repository rules.
16. Run full validation.
17. Perform browser smoke testing where the environment permits.
18. Update this document’s checklists, work log, validation results, and improvement ideas.
19. Commit and push according to repository instructions.
20. Stop. Do not begin another refactor phase.

---

## 10. Validation Plan

### Automated

Run and report exact exit codes for:

```bash
npm test
npm run build
npx tsc --noEmit
npm run lint
```

Classify every failure as:

- introduced by this phase;
- confirmed pre-existing;
- environmental;
- unrelated but newly discovered;
- intentionally deferred.

Do not describe lint as passing if it exits nonzero, even when all findings are pre-existing.

### Browser checks

Where possible, verify:

- approaching each room boundary slowly;
- moving rapidly toward each transition direction;
- changing direction before reaching a boundary;
- a fully prepared destination;
- an unprepared destination;
- a resident-ready destination;
- a resident-not-ready destination;
- proximity and velocity selecting the same target;
- proximity and velocity selecting different targets;
- transition completion after each case;
- no duplicate queue work or console errors.

Use existing diagnostics where available:

- resident diagnostics;
- prewarm diagnostics;
- `__dwTransitionStats()`;
- `__dwBenchTransition`;
- `__dwBenchPingPong`.

Also perform one foreground cross-zone round trip if possible to close the remaining Phase Three runtime-validation gap.

### Performance check

No performance gain is required.

Confirm instead that the refactor introduces no:

- new per-frame allocation;
- new frame-loop scan beyond the existing transition scans;
- duplicate asset decoding requests beyond current behavior;
- extra scheduler calls;
- additional animation frames or timers.

Any optimization proposal requires measurement and belongs in **Ideas for Improvement**, not silently in this implementation.

---

## 11. Acceptance Criteria

Phase Four is complete only when:

- preload anticipation policy no longer lives inline in `gameScreen.ts`;
- the new module has one coherent responsibility;
- proximity and velocity semantics are characterized;
- all existing priority numbers and reasons are preserved;
- runtime, decode, chunk-warm, and resident side effects remain behaviorally equivalent;
- dominant-direction logic has one source of truth where safely possible;
- the new code is Node-testable;
- no new per-frame allocation is introduced;
- no scheduler is duplicated or replaced;
- gameplay and transition behavior remain compatible;
- all introduced failures are fixed;
- docs and this plan are updated;
- the final working tree and push status are reported.

---

## 12. Non-Goals

Do not include these in Phase Four:

- changing preload thresholds;
- changing resident priorities;
- changing transition trigger geometry;
- changing room-loading paths;
- changing async loading behavior;
- changing cross-zone behavior;
- unifying all preload schedulers;
- replacing `requestIdleCallback`;
- moving resident scheduler ownership;
- changing chunk memory budgets;
- regenerating stale baked wall templates;
- optimizing large-room wall merging without measurements;
- fixing unrelated lint findings;
- broadly splitting the rest of `gameScreen.ts`;
- refactoring editor, combat, audio, or persistence systems.

---

## 13. Risks and Controls

### Risk: changing first-match behavior

Control:

- test authored transition ordering;
- preserve the current `break` behavior.

### Risk: altering threshold inclusivity

Control:

- test exact boundary values;
- preserve `>=`/`<=` for proximity and strict `>` for velocity.

### Risk: adding per-frame garbage

Control:

- create dependency objects once;
- pass existing room/player objects;
- avoid result arrays and temporary maps;
- inspect the final hot path.

### Risk: over-centralizing scheduler behavior

Control:

- keep queue ownership in existing schedulers;
- the new module only selects and requests.

### Risk: action-count drift

Control:

- event-log tests should capture which ports are called and in what order;
- preserve the fact that chunk warming is ensured even when runtime data is prepared.

### Risk: auto-sync commit fragmentation

Control:

- do not reset or rewrite auto-sync commits;
- validate the final combined tree;
- report the complete commit sequence.

---

## 14. Alternatives Considered

### Broader `gameScreen.ts` frame decomposition

**Decision:** Defer.

Reason:

- higher blast radius;
- mixes simulation, input, rendering, UI, and profiling;
- no single next responsibility boundary is as clear as the preload policy;
- line count alone is not a reason to extract.

### Campaign-start option deduplication in `src/game.ts`

**Decision:** Defer as a smaller future cleanup.

Reason:

- official and custom campaign paths still duplicate health, dust-container, dust-type, and weave starting-option application;
- useful, but lower impact than the active transition-preparation policy.

### Stale baked wall-template regeneration

**Decision:** Important, but not a refactor phase.

Reason:

- it is a content/build-artifact correction;
- it should be completed separately because stale hashes currently force slower fallback wall-template construction.

### Further transition performance optimization

**Decision:** Defer until measured.

Reason:

- `docs/TODO.md` explicitly requires representative browser transition timings before selecting another bottleneck;
- Phase Four changes ownership/testability only and should not claim speed improvements.

---

## 15. AI Agent Operating Instructions

These instructions are model-neutral and apply equally to Codex, Claude, or another coding agent.

### Before working

- Read this entire document.
- Read repository instructions and architecture docs.
- Treat current code as authoritative when it differs from this plan.
- Inspect all commits after the baseline listed above.
- Preserve unrelated user changes.
- Do not reset, force-checkout, or rewrite auto-sync commits.
- Record baseline commands and exact results in this document.

### While working

- Keep the phase limited to preload anticipation.
- Add tests before deleting the inline implementation.
- Prefer evidence over line-count reduction.
- Preserve exact semantics unless a defect is reproduced.
- Do not hide pre-existing failures.
- Do not claim runtime or performance validation that did not occur.
- Share concise progress updates with the user during long work.
- Add concrete improvement ideas to this document instead of expanding scope silently.

### Updating this document

The agent must update:

1. **Implementation Checklist**
2. **Validation Results**
3. **Agent Work Log**
4. **Ideas for Improvement**
5. **Final Phase Report**

Do not overwrite previous work-log entries. Append new entries.

### Reporting progress

Use this format in the work log:

```markdown
### YYYY-MM-DD HH:MM — Agent/model

**Status:** investigating | testing | implementing | validating | blocked | complete

**Work completed:**
- ...

**Evidence/findings:**
- ...

**Validation:**
- `command` — exit code — result

**Blockers/limitations:**
- ...

**Next action:**
- ...
```

### Reporting improvement ideas

Each idea must include:

- evidence;
- expected value;
- risk;
- whether it belongs in this phase;
- status: `candidate`, `accepted`, `deferred`, or `rejected`.

Do not implement a deferred idea without user authorization or a new approved phase.

### Final report requirement

When implementation ends, append a concise final phase report containing:

- baseline architecture;
- behavior characterized;
- module/interface added;
- files changed;
- exact behavioral deltas;
- tests added;
- exact validation commands and exit codes;
- browser scenarios exercised;
- performance observations and limitations;
- compatibility assessment;
- remaining risks;
- one recommended next action;
- build number;
- branch, commit hashes, push result, and working-tree status.

---

## 16. Implementation Checklist

- [ ] Read repository instructions and current architecture.
- [ ] Confirm current `main`, build number, and working tree.
- [ ] Record baseline test/build/typecheck/lint results.
- [ ] Trace the current preload anticipation block and ports.
- [ ] Add player/coordinate characterization tests.
- [ ] Add four-direction proximity threshold tests.
- [ ] Add transition-ordering tests.
- [ ] Add runtime-cache/decode behavior tests.
- [ ] Add resident-readiness tests.
- [ ] Add velocity threshold/dominant-axis tests.
- [ ] Add combined proximity/velocity tests.
- [ ] Add shared direction-helper parity tests if applicable.
- [ ] Implement the stateless policy module.
- [ ] Wire dependencies once in `startGameScreen`.
- [ ] Replace the inline frame-loop block.
- [ ] Remove duplicate constants/helpers where safe.
- [ ] Inspect for new hot-path allocation.
- [ ] Update architecture and repository-routing docs.
- [ ] Increment build number.
- [ ] Run full automated validation.
- [ ] Run available browser smoke checks.
- [ ] Attempt one foreground cross-zone round trip.
- [ ] Update work log and ideas.
- [ ] Append final phase report.
- [ ] Review diff, commit, and push.
- [ ] Confirm final working tree status.

---

## 17. Validation Results

To be completed by the implementing agent.

| Command / Scenario | Exit / Result | Classification | Notes |
|---|---:|---|---|
| `npm test` baseline | Pending | Pending | |
| `npm run build` baseline | Pending | Pending | |
| `npx tsc --noEmit` baseline | Pending | Pending | |
| `npm run lint` baseline | Pending | Pending | Confirm known seven test-file findings |
| Focused policy tests | Pending | Pending | |
| Final `npm test` | Pending | Pending | |
| Final `npm run build` | Pending | Pending | |
| Final `npx tsc --noEmit` | Pending | Pending | |
| Final `npm run lint` | Pending | Pending | |
| Browser preload checks | Pending | Pending | |
| Cross-zone foreground check | Pending | Pending | |

---

## 18. Agent Work Log

### 2026-07-12 — Planning review

**Status:** plan created

**Work completed:**

- Reviewed current Build 442 transition architecture.
- Reviewed the remaining inline proximity/velocity preload policy.
- Reviewed runtime preload, chunk-prewarm, resident-build, and shared neighborhood APIs.
- Compared this candidate with broader `gameScreen` extraction, campaign-start deduplication, stale baked-template regeneration, and speculative performance work.

**Evidence/findings:**

- The inline policy coordinates four preparation systems from the gameplay frame loop.
- Resident priorities `1` and `2` are already formal scheduler contracts.
- Dominant velocity-direction logic is duplicated in the chunk-prewarm scheduler.
- The policy is deterministic and can be extracted without taking queue ownership.
- A narrow stateless extraction has meaningful testability value and limited behavioral risk.

**Validation:**

- Repository source and recent commits inspected through the connected GitHub repository.
- No source changes made during planning.
- No local validation commands run during planning.

**Blockers/limitations:**

- This planning environment did not execute the repository locally.
- Browser transition timings remain an explicit separate measurement task.
- Phase Three cross-zone behavior still merits a foreground manual pass.

**Next action:**

- Implement Phase Four according to this document.

---

## 19. Ideas for Improvement

### Idea A — Foreground cross-zone validation

**Evidence:** Phase Three’s cross-zone path was unit-tested but not exercised in a normal foreground browser.

**Expected value:** Closes the highest remaining runtime-validation gap.

**Risk:** Low.

**Belongs in Phase Four:** Validation only; no architectural expansion.

**Status:** accepted.

### Idea B — Campaign spawn starting-options helper

**Evidence:** `src/game.ts` applies starting health, dust-container count, dust types, and weaves separately in official and custom campaign paths.

**Expected value:** Removes duplicated progression initialization and prevents future drift.

**Risk:** Low to medium because official and fresh custom progress have slightly different initial-state assumptions.

**Belongs in Phase Four:** No.

**Status:** deferred.

### Idea C — Regenerate stale official-room baked templates

**Evidence:** `docs/TODO.md` lists official rooms with `stale_hash` fallback behavior.

**Expected value:** Restores the intended baked wall-template fast path.

**Risk:** Medium; generated content must match current authored room data.

**Belongs in Phase Four:** No; content/build artifact task.

**Status:** deferred.

### Idea D — Further split `gameScreen.ts`

**Evidence:** The file remains large after three extractions.

**Expected value:** Potentially improves maintainability.

**Risk:** High without a precise responsibility boundary.

**Belongs in Phase Four:** No.

**Status:** candidate only when a cohesive, high-churn responsibility is demonstrated.

### Idea E — Measured preload tuning

**Evidence:** Thresholds and priorities are currently hard-coded and browser timing data remains incomplete.

**Expected value:** Could improve transition readiness.

**Risk:** Medium to high if changed without representative measurements.

**Belongs in Phase Four:** No.

**Status:** deferred pending `__dwTransitionStats()` evidence.

---

## 20. Final Phase Report

To be appended by the implementing agent after Phase Four is complete.

Do not delete the planning sections above.
