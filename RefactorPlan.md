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
