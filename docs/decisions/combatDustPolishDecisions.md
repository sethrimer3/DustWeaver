# Combat / Dust Polish Decisions — BUILD 359

This document captures architectural decisions made during the combat/dust
integration polish pass (BUILD 359).  See `nextSteps.md` for remaining work.

---

## 1. System Audit Summary

### How the systems interact (as of BUILD 359)

| System | Input | Output / Effect |
|---|---|---|
| **Logical mote queue** | `syncMoteQueueWithParticles` detects combat kills | `moteSlotState[i]` (AVAILABLE/DEPLETED), `moteSlotCooldownTicksLeft[i]` |
| **Physical particles** | `applyInterParticleForces` contact resolution | `isAliveFlag[i]=0`, `respawnDelayTicks[i]` |
| **Storm Weave** | `playerPrimaryWeaveId === 'storm'` | Attracts unowned Physical dust to player |
| **Shield crescent** | Primary/secondary mouse button held | `applyShieldCrescent` → spring forces on available mote particles |
| **Shield Sword Weave** | Secondary mouse button (FSM) | `tickSwordWeave` → auto-slash + crescent guard |
| **Arrow Weave** | Secondary hold/release | `startArrowLoading`/`fireArrowFromLoading` → `depleteFirstNMoteSlots` |
| **Grapple range** | Available mote ratio | `getEffectiveGrappleRangeWorld` → smoothed display circle |
| **HUD mote row** | `world.moteSlotState[]`, `world.moteRegenFlashTicksLeft[]` | Gold/depleted dots, cooldown arc, regen flash |
| **Enemy-to-player damage** | `applyInterParticleForces` core contact | Random 1-4 minus armor (physical dust count based) |
| **Old attack/block paths** | `playerAttackTriggeredFlag`, `isPlayerBlockingFlag` | **Never set by input** — vestigial no-ops (see §3) |

---

## 2. Logical Mote Depletion / Physical Particle Invariant

### The invariant (as implemented)

When a mote slot is DEPLETED, its linked physical particle must also be dead
(`isAliveFlag === 0`) until the slot regenerates.  The particle should not
orbit as an available mote while the logical slot is depleted.

### Implementation

Two collaborating functions enforce the invariant:

**`syncMoteQueueWithParticles` (step 5.1, after force resolution):**
- Detects mote-linked player particles killed this tick (`isAliveFlag === 0`).
- Marks the logical slot DEPLETED with `BASE_MOTE_REGENERATION_TICKS` cooldown.
- **New in BUILD 359**: also extends `respawnDelayTicks[pidx]` to at least
  `BASE_MOTE_REGENERATION_TICKS`, preventing the particle from respawning
  before the mote is logically available.

**`tickMoteSlotRegeneration` (step 7.5, after lifetime update):**
- Counts down slot cooldowns (2× faster when grounded).
- When a slot transitions DEPLETED → AVAILABLE:
  - Sets `moteRegenFlashTicksLeft[i] = MOTE_REGEN_FLASH_TICKS` (HUD flash).
  - **New in BUILD 359**: if `world.isAliveFlag[pidx] === 0`, sets
    `world.respawnDelayTicks[pidx] = 1` so the particle respawns on the next
    `updateParticleLifetimes` call.

**`depleteMoteSlot(world, slotIndex, cooldownTicks?)` (new in BUILD 359):**
- Central helper for directly depleting a slot by index.
- Extends the physical particle's respawn delay to match the cooldown.
- Prefer this over the lower-level per-particle helpers for new call sites.

### Known exception: airborne respawn freeze

`updateParticleLifetimes` freezes the respawn countdown for player-owned
particles while the player is airborne.  When a mote slot regenerates
(cooldown reaches 0) while the player is airborne, `tickMoteSlotRegeneration`
sets `respawnDelayTicks[pidx] = 1`, but the lifetime update will freeze that
countdown until the player lands.

Consequence: the logical slot transitions to AVAILABLE (HUD shows gold dot +
flash) while the physical particle is still dead.  This represents a 1-tick to
several-tick divergence (until landing), visible in the HUD.

**Decision**: accept this exception.  The alternative — deferring logical slot
restoration until the particle also respawns — would prevent mote regeneration
from happening while airborne, which is more disruptive to gameplay feel than
the brief visual gap.  The exception is documented here and noted in the code.

---

## 3. Old Player Attack/Block Paths (Vestigial)

**Affected code**: `applyCombatForces` in `src/sim/particles/combat.ts`,
which calls `triggerAttackLaunch`, `tickAttackMode`, and `applyBlockForces`
from `src/sim/particles/playerCombat.ts`.

**Audit result (BUILD 359)**: `playerAttackTriggeredFlag` and
`isPlayerBlockingFlag` are never set by any input handler in `gameScreen.ts`
or any related file.  The player-facing code paths (`triggerAttackLaunch`,
`applyBlockForces`) are effectively no-ops every tick.

**What still matters**: `tickAttackMode` is needed — it drives
`attackModeTicksLeft` for enemy particles in attack mode (`behaviorMode=1`),
set by `enemyAi.ts`.

**Decision**: keep `applyCombatForces` in the pipeline rather than removing it,
because:
1. `tickAttackMode` is still required for enemy AI.
2. The vestigial player paths are cheap no-ops (flag check → skip).
3. Removing the entry point would require auditing all callers.
4. Future designs may reuse these paths for a legacy-compatible mechanic.

The code is annotated with a clear comment in `combat.ts`.

**Not done**: the player-input paths (`triggerAttackLaunch`, `applyBlockForces`)
were NOT gated behind a `ENABLE_LEGACY_PLAYER_COMBAT` flag.  See `nextSteps.md`
if a future pass wants to remove them cleanly.

---

## 4. Storm Attraction — Now Gated on Equipped Weave

**Before**: `applyStormAttraction(world)` was called unconditionally in
`applyPlayerWeaveCombat`, regardless of the equipped primary weave.

**Decision**: gate Storm attraction on `world.playerPrimaryWeaveId === WEAVE_STORM`.

**Rationale**:
- The Storm Weave definition (`STORM_DEF`) describes it as "always active" for
  the Storm-equipped build, not as a universal passive.
- `isMoteSourceOrbitFlag` exists precisely to distinguish Storm (orbit) from
  non-Storm (inventory materialization) — that flag would have no effect if
  Storm attraction was always on.
- Future primary weaves should not inherit Storm's passive pickup behavior.

**Result**: when a non-Storm primary weave is equipped, unowned Physical dust
is no longer pulled toward the player.  Room-transition resets are unaffected
because `initMoteQueueFromParticles` still runs at load time.

---

## 5. Hot-Path Allocation Fix (forces.ts)

**Before**: three `new Map<number, boolean>()` objects were created every tick
inside `applyInterParticleForces` for the cluster-lookup pre-pass.

**Fix**: promoted to module-level (`_ownerIsPlayerMap`, `_ownerIsRadiantTetherMap`,
`_ownerHasTakenDamageMap`); cleared with `.clear()` at the start of each tick's
pre-pass.

**Impact**: eliminates ~3 GC-eligible object allocations per tick (~180/s at
60 fps).  This was the only hot-path allocation in `forces.ts` not already
using typed arrays.

---

## 6. Armor Calculation — Status Quo Retained

**Current formula**: `playerArmor = Math.floor(physicalDustCount / 4)` where
`physicalDustCount` is the count of alive non-transient player-owned particles.

**Evaluation**: with the new mote-sync invariant (depleted motes keep their
particle dead), `physicalDustCount` now closely tracks the logical available
mote count.  When motes are depleted in combat, the physical count drops by the
same amount, so armor reduction follows naturally.

**Decision**: retain the physical-count formula for BUILD 359.  It now has
better semantic alignment with mote state than before.  A future pass could
switch to `getAvailableMoteSlotCount(world)` if logical/physical ever diverge
in a new scenario (e.g., a future weave that depletes motes without killing
particles).  Document that as a `nextSteps.md` item.

---

## 7. Mote Kind Colors / Per-Kind Combat — Not Implemented in BUILD 359

Sword and arrow renderers still use generic gold (`#ffd700`).  Per-slot mote
kind colors are tracked in `world.moteSlotKind[]` but not exposed to renderers.

**Decision**: deferred.  See `nextSteps.md` — "Mote kind color for sword blade
and arrow".  The data is in place; the renderer change is low-risk but requires
adding a `particleMoteSlotState` field to `ParticleSnapshot` or reading from
`WorldState` directly in the renderer.

---

## 8. No-Mote Behavior — Already Consistent

All weaves already handle `moteSlotCount === 0` cleanly:
- Arrow Weave: guards on `moteSlotCount > 0 && availableMoteSlotCount < 2`.
- Sword Weave: returns false / stays ORBIT with 0 active sword motes.
- Shield crescent: `if (total === 0) return;` at the top of `applyShieldCrescent`.
- Grapple: returns full range when `moteSlotCount === 0`.

No changes were needed here.
