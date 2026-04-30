
````markdown
# DustWeaver Ordered Mote Economy and Weave Interaction Roadmap

## Purpose

This document defines the staged implementation plan for DustWeaver's ordered mote economy, dynamic grapple range, and integrated Storm, Shield, Sword, Arrow, and Grapple Weave behavior.

The current codebase already has a Phase 1 Shield Sword MVP. That MVP added a `shield_sword` weave, a sword state machine, a visual sword renderer, auto-targeting, slash damage, and right-mouse transition into the existing Shield Weave crescent.

However, the current sword is still mostly a gameplay and visual shell. It does not yet use the player's true ordered mote economy. This roadmap replaces the old proportional multi-dust idea with a stronger system:

> The player's dust motes are an ordered queue. Earlier motes take the leading, central, or highest-impact positions in each weave formation. Destroyed motes enter cooldown and temporarily disappear from the active queue. When they regenerate, they return to the player's available mote pool.

This system should become foundational across multiple weaves, especially Grapple, Shield, Sword, Arrow, and Storm.

---

# Core Design Principles

## 1. Ordered Mote Queue

The player's equipped dust motes should be represented as an ordered list.

Example:

```text
[1] Gold
[2] Gold
[3] Water
[4] Plant
[5] Void
[6] Gold
[7] Water
[8] Plant
````

This order matters.

Earlier motes should be used for the highest-impact positions:

* Sword: tip and forward blade positions
* Shield: center and near-center positions
* Arrow: arrowhead and front shaft
* Grapple: hook tip and early tether links
* Storm: preferred orbit layer or priority positions

The first mote is not merely "first in inventory." It is the leading-edge mote.

## 2. Destroyed Motes Enter Cooldown

Destroyed or fully depleted motes should not immediately vanish forever and should not be instantly replaced permanently.

Instead:

1. The logical mote slot becomes depleted.
2. It starts a regeneration cooldown.
3. While depleted, it cannot be used by sword, shield, grapple, arrow, or storm formations.
4. Other available motes compact forward to fill active formation positions.
5. When the cooldown completes, the mote returns to availability.

This gives combat consequences without permanent resource loss.

## 3. Extra Dust Containers Increase Resilience, Not Maximum Range

Collecting more dust containers should not make the grapple infinitely longer.

Instead, grapple range should be based on the percentage of currently available motes compared to the player's total mote capacity.

Example:

```text
Player has 4 total motes and loses 1.
Available ratio = 3 / 4 = 75%.
Grapple range becomes 75% of full range.

Player has 20 total motes and loses 5.
Available ratio = 15 / 20 = 75%.
Grapple range also becomes 75% of full range.
```

This means collecting more containers makes the player more resilient to range loss, but does not directly increase the maximum grapple length.

## 4. Motes Assigned to a Weave Still Count as Available Unless Destroyed

If motes are temporarily forming a sword, shield, arrow, grapple hook, or storm orbit, they should still count as alive and available unless they are actually depleted or destroyed.

The grapple range should shrink because motes are lost, not because motes are temporarily being used in a formation.

## 5. Weaves Map the Same Ordered Queue Differently

The ordered mote queue should be a shared resource layer.

Each weave asks:

```ts
getAvailableOrderedMoteSlots(player)
```

Then each weave maps those slots into a different formation.

The queue is the same. The shape is different.

## 6. Do Not Implement All Weave Changes at Once

This system affects multiple central mechanics. Implement it in phases.

The order should be:

1. Add logical ordered mote slots.
2. Add depletion and regeneration cooldowns.
3. Make grapple range depend on available mote ratio.
4. Update the grapple range circle.
5. Integrate shield with ordered motes.
6. Integrate sword with ordered motes.
7. Integrate combined sword plus shield behavior.
8. Later, update arrow, storm, and other interactions.

Do not begin by rewriting all particle physics or all weave logic.

---

# Important Current Codebase Facts

The codebase currently has these constraints:

* Player motes are real simulated particles in `ParticleBuffers`.
* Rendering currently assumes one visual particle equals one real simulated particle.
* Shield Weave currently moves actual player-owned motes into a crescent.
* Storm Weave currently attracts and claims particles.
* The Phase 1 sword renderer is separate from the real particle system.
* The Phase 1 sword does not yet consume, reserve, or reorder actual motes.
* The weave system does not currently have a robust upgrade hierarchy.
* The current implementation should avoid broad refactors of `forces.ts`, WebGL particle rendering, or input handling.

This roadmap should preserve what already works while gradually replacing the resource model underneath.

---

# Terminology

## Logical Mote Slot

A persistent slot in the player's ordered mote queue.

It represents one dust mote worth of player capacity.

Fields may include:

```ts
moteSlotKind
moteSlotOriginalOrderIndex
moteSlotCurrentState
moteSlotCooldownTicksLeft
moteSlotEnergy
moteSlotMaxEnergy
moteSlotAssignedWeave
moteSlotParticleIndex
```

## Available Mote

A logical mote slot that is not depleted and can be used by formations.

## Depleted Mote

A logical mote slot that has been destroyed or fully spent and is waiting for cooldown regeneration.

## Active Formation

The currently visible arrangement of motes for a weave, such as:

* Sword blade
* Shield crescent
* Grapple hook/tether
* Arrow
* Storm orbit

## Reserve Motes

Available logical motes that are not currently needed for the active formation but can fill gaps when earlier motes are depleted.

## Circle of Influence

The visible circle around the player showing current grapple range.

This same circle also becomes the detection radius for passive sword readiness.

---

# Phase 0: Stabilize the Existing Phase 1 Shield Sword

## Goal

Before changing the resource model, make sure the current Phase 1 Shield Sword implementation is stable.

## Tasks

1. Audit current files:

   * `src/sim/weaves/swordWeave.ts`
   * `src/render/effects/swordWeaveRenderer.ts`
   * `src/sim/weaves/weaveCombat.ts`
   * `src/sim/weaves/weaveDefinition.ts`
   * `src/sim/world.ts`
   * `src/render/snapshot.ts`
   * `src/render/snapshotTypes.ts`
   * `src/screens/gameRender.ts`
   * `src/screens/gameScreen.ts`

2. Confirm:

   * Sword state machine does not get stuck.
   * Shield transition still works.
   * Releasing RMB exits shield correctly.
   * Auto-targeting ignores dead enemies.
   * Slash damage only happens once per enemy per slash.
   * Renderer has no hot-path allocations.
   * Existing Storm, Shield, Arrow, and Grapple behavior still works.

3. Keep this phase strictly bug-fix only.

## Do Not

* Do not add ordered mote slots yet.
* Do not change grapple range yet.
* Do not change particle collision.
* Do not add multi-dust behavior.

## Exit Criteria

* Typecheck passes.
* Build passes.
* Shield Sword MVP still functions.
* Existing weaves still function.

---

# Phase 1: Add the Logical Ordered Mote Queue

## Goal

Create a persistent ordered mote layer that represents the player's dust loadout independently from the current particle rendering and physics implementation.

This is the foundation for everything else.

## Design

The player should have an ordered list of logical mote slots.

Each slot should know:

```ts
kind: ParticleKind
originalOrderIndex: number
state: available | depleted
cooldownTicksLeft: number
energy: number
maxEnergy: number
assignedWeave: none | storm | shield | sword | arrow | grapple
particleIndex: number
```

This does not need to replace real particles immediately.

At first, it can be a parallel resource model used for high-level decisions.

## Tasks

1. Identify where player dust capacity and loadout are currently defined.
2. Create a new module, likely something like:

```text
src/sim/motes/orderedMoteQueue.ts
```

or:

```text
src/sim/weaves/moteQueue.ts
```

3. Add helper functions:

```ts
getTotalMoteSlotCount(world): number
getAvailableMoteSlotCount(world): number
getAvailableMoteRatio(world): number
getAvailableOrderedMoteSlots(world): OrderedMoteSlot[]
markMoteSlotDepleted(world, slotIndex, cooldownTicks): void
tickMoteSlotRegeneration(world): void
```

4. Add logical mote queue state to `WorldState`, using typed arrays if consistent with the codebase style.

Suggested structure:

```ts
moteSlotCount: number;
moteSlotKind: Uint8Array;
moteSlotOriginalOrderIndex: Uint16Array;
moteSlotState: Uint8Array;
moteSlotCooldownTicksLeft: Uint16Array;
moteSlotEnergy: Float32Array;
moteSlotMaxEnergy: Float32Array;
moteSlotAssignedWeave: Uint8Array;
moteSlotParticleIndex: Int16Array;
```

5. Initialize the queue from current player loadout and dust container capacity.

6. For the first implementation, support only the currently implemented player dust type if necessary.

7. Add regeneration ticking somewhere appropriate in the simulation tick pipeline.

## Important Rules

* Original order should remain stable.
* Depleted slots should be skipped when forming active formations.
* Regenerated slots should return to availability.
* Do not permanently reorder the player's inventory.
* Active formation order should be computed from currently available slots sorted by original order.

## Example

Original queue:

```text
1 2 3 4 5
```

Sword length 3:

```text
1 2 3
```

If slots 1 and 3 are depleted:

```text
Available slots: 2 4 5
Sword becomes: 2 4 5
```

If slot 1 regenerates:

```text
Available slots: 1 2 4 5
Sword can smoothly re-form as: 1 2 4
```

The visual transition should be smooth, but the logical order is deterministic.

## Do Not

* Do not rewrite the particle engine.
* Do not force every existing particle to become queue-backed yet.
* Do not implement sword, shield, grapple changes in this phase except for reading the queue in debug mode.

## Exit Criteria

* The game has a valid ordered mote queue.
* The queue initializes correctly.
* Available ratio can be read.
* Depletion and regeneration can be simulated.
* Existing gameplay is not broken.

---

# Phase 2: Mote Depletion and Regeneration Cooldown

## Goal

Make mote loss a shared system that can affect grapple range, sword length, shield density, and other weave behaviors.

## Design

When a mote is destroyed or fully spent, its logical mote slot should enter cooldown.

This cooldown should be the source of recovery, rather than instant replacement.

## Tasks

1. Identify current mote destruction points:

   * Particle collision
   * Shield blocking
   * Sword hit energy spending, later
   * Arrow use, later
   * Grapple strain or breakage, later

2. Add a safe helper:

```ts
depleteMoteSlot(world, slotIndex, reason): void
```

3. Add regeneration helper:

```ts
tickMoteRegeneration(world): void
```

4. Add tunables:

```ts
const BASE_MOTE_REGENERATION_TICKS = 180;
const FAST_REGENERATION_TICKS = 90;
const SLOW_REGENERATION_TICKS = 300;
```

5. Add debug display for:

   * Total mote slots
   * Available mote slots
   * Depleted mote slots
   * Available ratio
   * Current effective grapple range

6. If current real particles do not yet map cleanly to logical slots, add a temporary mapping strategy:

   * Each player-owned particle can store or infer a `moteSlotIndex`.
   * If direct mapping is too risky, implement depletion only through new weave systems first.

## Important Rule

A mote assigned to a sword, shield, arrow, or grapple is not depleted merely because it is assigned.

It is depleted only when it is destroyed, spent, or fully exhausted.

## Do Not

* Do not change grapple range yet unless Phase 1 is stable.
* Do not add multi-dust logic.
* Do not change WebGL rendering.

## Exit Criteria

* Mote slots can be depleted.
* Mote slots regenerate after cooldown.
* The ordered queue skips depleted motes.
* Debug display confirms available ratio changes correctly.

---

# Phase 3: Dynamic Grapple Range Based on Available Mote Ratio

## Goal

Make the grappling hook's maximum range dynamically shrink and recover based on the percentage of available motes.

The player should never get a longer maximum grapple merely by collecting more dust containers. Instead, more containers make the grapple range more resilient against mote loss.

## Formula

Use:

```ts
availableRatio = availableMoteCount / totalMoteCount
targetGrappleRange = fullGrappleRange * availableRatio
```

Optionally clamp to a minimum:

```ts
targetGrappleRange = fullGrappleRange * clamp(availableRatio, MIN_GRAPPLE_RANGE_RATIO, 1.0)
```

Recommended tunables:

```ts
const FULL_GRAPPLE_RANGE_WORLD = existingFullRange;
const MIN_GRAPPLE_RANGE_RATIO = 0.25;
const GRAPPLE_RANGE_VISUAL_LERP = 0.12;
```

## Examples

```text
4 total motes, 1 depleted:
availableRatio = 3 / 4 = 0.75
grapple range = 75%

20 total motes, 5 depleted:
availableRatio = 15 / 20 = 0.75
grapple range = 75%
```

## Tasks

1. Locate current grapple range constant or calculation.
2. Replace current effective range with:

```ts
getEffectiveGrappleRangeWorld(world)
```

3. Ensure the effective range is used for:

   * Grapple target detection
   * Grapple validity
   * Grapple range circle
   * Sword enemy influence circle later

4. Add a smoothed visual radius for the circle:

```ts
displayedGrappleRangeWorld = lerp(displayedGrappleRangeWorld, targetGrappleRangeWorld, smoothing)
```

5. The grapple circle should shrink and grow smoothly as motes are depleted or regenerated.

6. Do not let the grapple become longer than the existing intended full range.

7. Decide minimum behavior:

   * If the player has zero available motes, should grapple be disabled?
   * Or should it retain a small emergency range?

Recommended:

* Use a small minimum ratio such as 0.2 or 0.25 unless the game explicitly wants total vulnerability.

## Do Not

* Do not make grapple range scale upward with total mote count.
* Do not use raw available mote count as range.
* Do not make the circle snap instantly.

## Exit Criteria

* Grapple range shrinks when motes are depleted.
* Grapple range recovers when motes regenerate.
* Extra containers increase resilience, not max range.
* Grapple circle accurately shows current range.
* Grapple hook cannot exceed the circle.

---

# Phase 4: Circle of Influence Unification

## Goal

Use the current effective grapple range circle as the player's broader "circle of influence."

This circle should be used by Sword Weave to decide when to form into ready stance.

## Design

The circle has two roles:

1. It shows current grapple range.
2. It defines the enemy detection radius for passive sword readiness.

This makes the player's resource health visible and mechanically important.

## Tasks

1. Add helper:

```ts
getCircleOfInfluenceRadiusWorld(world): number
```

Initially this should return the effective grapple range.

2. Update Sword Weave:

   * Enemy inside circle of influence: sword can form and enter ready stance.
   * Enemy outside circle of influence: sword should return to orbit or inventory space unless RMB behavior is active.

3. The sword should not necessarily attack just because an enemy is inside the circle.

Use two radii:

```ts
circleOfInfluenceRadiusWorld = current grapple range
swordAttackRangeWorld = current sword length/range
```

Behavior:

```text
Enemy inside circle of influence:
  sword forms and readies

Enemy inside sword attack range:
  sword can auto-swing
```

## Exit Criteria

* Grapple circle affects sword readiness.
* Sword readiness and sword attack range are separate.
* The player can visually understand why sword forms before it can hit.

---

# Phase 5: Shield Weave Uses Ordered Mote Queue

## Goal

Make Shield Weave formation use the ordered mote queue.

The earliest available motes should go to the strongest and most central positions of the shield.

## Behavior

If the player has Shield Weave and holds RMB:

* If Storm Weave is unlocked or active:

  * available motes move from their current orbit positions into shield formation.
* If Storm Weave is not unlocked:

  * motes emerge from the player's dimensional inventory space into shield formation.
  * when blocking ends, motes return to that space and disappear visually.

## Shield Position Mapping

The first mote should go to the center.

Then alternate outward from the center:

```text
slot 0: center
slot 1: slightly above center
slot 2: slightly below center
slot 3: upper-mid
slot 4: lower-mid
slot 5+: outer edges
```

This makes early loadout slots the strongest defensive slots.

## Tasks

1. Update shield formation helper to accept ordered available mote slots.
2. Replace arbitrary particle collection order with deterministic queue order.
3. Add center-out ordering.
4. Add or preserve shield thickness if possible.
5. Ensure depleted mote slots are not used.
6. Ensure shield density decreases when motes are depleted.
7. If Storm is unlocked:

   * existing physical particles should move into shield.
8. If Storm is not unlocked:

   * materialize temporary shield particles from inventory space.
9. On RMB release:

   * if Storm is unlocked, return motes to orbit.
   * if Storm is not unlocked, send motes back into inventory space and hide/remove them.

## Important Implementation Note

Do not break the existing shield collision behavior.

The current shield works because real particles occupy the crescent and collide with incoming particles.

For this phase, it is acceptable for the shield to use real particles as it currently does, but their selection and positioning should be driven by the ordered mote queue.

## Exit Criteria

* Shield center uses the earliest available motes.
* Destroyed shield motes deplete their logical slots.
* Shield grows weaker/less dense when motes are depleted.
* Shield recovers as motes regenerate.
* RMB still feels responsive.

---

# Phase 6: Sword Uses Ordered Mote Queue

## Goal

Replace the Phase 1 render-only sword illusion with a sword that uses the ordered mote queue.

The sword should form from the earliest available motes and shrink if not enough motes are available.

## Behavior

If the player has Sword Weave:

* When no RMB is held and an enemy is inside the circle of influence:

  * motes form a sword.
  * the sword enters ready stance.
* If enemy is inside actual sword range:

  * sword auto-swings.
* If no enemy is inside circle of influence:

  * sword returns to Storm orbit if Storm is unlocked.
  * otherwise sword returns to dimensional inventory space.

## Sword Length

The sword should have a fixed maximum length.

Extra dust containers should not make the sword longer.

Instead, extra motes increase resilience.

Example:

```text
MAX_SWORD_MOTES = 8

Player has 20 motes available:
  Sword uses first 8.
  Sword is full length.
  12 motes are reserve.

Player has 4 motes available:
  Sword uses first 4.
  Sword is half length.

Player had 8 motes, lost 4:
  Sword uses 4 remaining available motes.
  Sword is half length until regeneration.
```

## Sword Slot Mapping

```text
slot 0 = sword tip
slot 1 = upper blade
slot 2 = mid blade
slot 3 = lower blade
slot N = closest to crossguard
```

The first available mote is always the tip.

## Visual Rule

The sword should show its current active length clearly.

Every swipe should include a visible swipe effect at the current sword tip. This helps the player feel the current reduced or restored range.

## Tasks

1. Update `swordWeave.ts` to read ordered available mote slots.
2. Determine:

```ts
activeSwordMoteCount = min(MAX_SWORD_MOTES, availableMoteCount)
swordLengthRatio = activeSwordMoteCount / MAX_SWORD_MOTES
currentSwordReachWorld = FULL_SWORD_REACH_WORLD * swordLengthRatio
```

3. Use `currentSwordReachWorld` for:

   * auto-swing range
   * slash hit detection
   * slash trail endpoint
   * sword renderer blade length

4. If `activeSwordMoteCount` is zero:

   * sword cannot form
   * sword cannot attack
   * crossguard may appear dim or hidden
   * no crash

5. On slash:

   * hit detection should use current sword length.
   * visual swipe should end at the current tip.
   * if the sword depletes a mote due to energy cost or collision, recompute active slots.

6. If a front mote is destroyed:

   * remaining available motes compact forward.
   * reserve motes fill from the back.
   * animate the blade re-forming if possible.

## Do Not

* Do not implement proportional multi-dust ratios.
* Do not make the sword longer because the player has more containers.
* Do not make unavailable/depleted motes appear in the sword.

## Exit Criteria

* Sword length depends on active available mote count up to a fixed cap.
* Extra motes act as reserves.
* Sword attack range matches visual length.
* Sword tip swipe effect matches current sword length.
* Destroyed motes reduce sword length or consume reserves.
* Regeneration restores sword length.

---

# Phase 7: Combined Shield and Sword Behavior

## Goal

Implement the new combined behavior when the player has both Shield Weave and Sword Weave.

## Desired Behavior

If the player has both Shield Weave and Sword Weave:

### When RMB is not held

* Sword behavior is passive.
* If enemy is in circle of influence, sword forms into ready stance.
* If enemy is in sword range, sword auto-swings.
* If no enemy is nearby, motes return to orbit or inventory space.

### When RMB is clicked and held

The sequence should be:

```text
1. Motes quickly form sword if not already formed.
2. Sword performs a full swipe toward the mouse.
3. Sword transforms into shield crescent.
4. Shield remains active as long as RMB is held.
```

### When RMB is released

```text
Motes return to Storm orbit if Storm is unlocked.
Otherwise, motes return to dimensional inventory space and disappear visually.
```

## Guard Swipe

The RMB guard swipe is different from passive auto-swing.

It should:

* Aim toward the mouse.
* Use current sword length.
* Produce a clear swipe trail at the tip.
* Possibly damage enemies in the swipe arc.
* Immediately transition into shield formation after the swipe.
* Feel like the sword "unfurls" into a shield.

## Suggested State Flow

```text
IDLE_OR_ORBIT
  -> SWORD_FORMING
  -> SWORD_READY
  -> SWORD_AUTO_WINDUP
  -> SWORD_AUTO_SLASH
  -> SWORD_RECOVERY

RMB held:
  -> GUARD_SWORD_FORMING
  -> GUARD_MOUSE_SLASH
  -> SHIELD_FORMING
  -> SHIELD_HOLD

RMB released:
  -> RETURN_TO_ORBIT_OR_INVENTORY
```

## Tasks

1. Decide how the code detects "has both Shield and Sword."

   * If the codebase only supports one secondary weave, this may require a `shield_sword` combined weave to represent the combo.
   * If unlocks are separate from equip slots, use unlock state to determine combo behavior.

2. Preserve the existing `shield_sword` Phase 1 weave if it is already the combined form.

3. Add a specific RMB guard-swipe state.

4. Guard swipe should use mouse aim direction, not nearest enemy.

5. After guard swipe completes, call or reuse the shield crescent logic.

6. Releasing RMB exits shield and returns motes.

## Important Design Rule

The RMB sequence should not feel like:

```text
shield appears instantly
```

It should feel like:

```text
sword cuts open into shield
```

This is the signature animation.

## Exit Criteria

* Passive sword works when RMB is not held.
* RMB hold triggers sword swipe toward mouse.
* Shield forms after the swipe while RMB remains held.
* Releasing RMB returns motes correctly.
* The whole sequence is smooth.

---

# Phase 8: Storm Weave Integration

## Goal

Clarify how motes behave when Storm Weave is unlocked versus when it is not unlocked.

## Design

Storm Weave changes the source and return behavior of motes.

### If Storm Weave is unlocked

Motes exist passively around the player.

When another weave activates:

```text
storm orbit -> sword / shield / arrow / grapple
```

When done:

```text
sword / shield / arrow / grapple -> storm orbit
```

### If Storm Weave is not unlocked

Motes are stored in dimensional inventory space.

When a weave activates:

```text
inventory space -> sword / shield / arrow / grapple
```

When done:

```text
sword / shield / arrow / grapple -> inventory space
```

## Tasks

1. Add helper:

```ts
hasStormWeaveUnlocked(world): boolean
```

2. Add materialization behavior for non-storm cases:

   * Motes emerge from player center or a small dimensional pocket effect.
   * They form the active weave shape.
   * They disappear back into the player when released.

3. Add visual distinction:

   * Storm source: motes fly from orbit.
   * Inventory source: motes pop/stream out from player center or behind player.

4. Ensure non-storm motes still use the ordered queue.

## Exit Criteria

* Shield works without Storm.
* Sword works without Storm.
* With Storm unlocked, motes visibly move from orbit.
* Without Storm unlocked, motes emerge from inventory space.
* Return behavior matches source behavior.

---

# Phase 9: Grapple Weave Uses Ordered Mote Queue

## Goal

Make the grappling hook directly reflect the ordered mote queue.

The first available mote should become the hook tip, and later motes should form the tether or determine resilience.

## Behavior

The grapple hook's maximum range is already handled by available mote ratio from Phase 3.

Now the hook itself should also use ordered motes.

## Mapping

```text
slot 0 = grapple hook tip
slot 1 = first tether segment
slot 2 = second tether segment
slot 3+ = additional tether stability/resilience
```

## Tasks

1. Locate grapple creation and tether rendering.
2. Make grapple validity use current effective grapple range.
3. Make grapple visual length match current range.
4. Optionally map the first available mote's dust type to hook behavior later.
5. When motes are depleted, update range and circle smoothly.
6. If grapple is currently attached and range shrinks below current tether length:

   * decide whether tether shortens smoothly
   * or breaks if target is now out of range

Recommended behavior:

* While attached, range shrink should increase tether tension.
* If the target remains far outside current range for a grace period, the grapple breaks.

Suggested tunables:

```ts
const GRAPPLE_RANGE_SHRINK_GRACE_TICKS = 20;
const GRAPPLE_OUT_OF_RANGE_BREAK_TICKS = 45;
```

## Exit Criteria

* Grapple range reflects available mote percentage.
* Grapple circle matches usable range.
* Grapple does not get longer from extra containers.
* Grapple becomes more resilient with more containers.
* Grapple behavior remains central and reliable.

---

# Phase 10: Arrow Weave Uses Ordered Mote Queue

## Goal

Make Arrow Weave use the same ordered mote queue.

## Mapping

```text
slot 0 = arrowhead
slot 1 = front shaft
slot 2 = rear shaft
slot 3+ = reserve
```

## Behavior

* The earliest available motes form the arrow.
* If arrowhead mote is depleted, later motes compact forward.
* Arrow strength or effect may depend on the first mote.
* Arrow length should have a cap.
* Extra motes improve resilience or number of arrows, not infinite arrow size.

## Tasks

1. Update Arrow Weave to request ordered available mote slots.
2. Determine arrow mote count cap.
3. Use first available mote as arrowhead.
4. Integrate depletion cooldown on arrow impact if needed.
5. Preserve existing Arrow Weave behavior until the ordered version is stable.

## Exit Criteria

* Arrow uses ordered mote slots.
* Arrowhead is meaningful.
* Depleted motes reduce arrow formation quality.
* Existing Arrow Weave does not break.

---

# Phase 11: Visual Language and UI Feedback

## Goal

Make the ordered mote economy understandable to the player.

The player must understand:

* Which motes are available.
* Which motes are depleted.
* Which motes are regenerating.
* Why grapple range shrank.
* Why sword length is shorter.
* Why shield center changed.

## UI Elements

### Grapple Range Circle

Already central.

Should:

* Shrink smoothly with mote loss.
* Grow smoothly with regeneration.
* Maybe pulse or flicker when motes are depleted.

### Mote Queue Display

Add a small visual queue near the HUD or inventory.

Example:

```text
[1][2][3][4][5][6][7][8]
```

Depleted motes:

* Dimmed
* Cracked
* Transparent
* With cooldown ring

Available motes:

* Bright and ordered

### Formation Preview

Optional later:

* Show how current queue maps into sword, shield, arrow, and grapple.

## Tasks

1. Add debug-only mote queue display first.
2. Add player-facing display later.
3. Add cooldown visualization.
4. Add clear feedback when a mote regenerates.
5. Add clear feedback when grapple range changes.

## Exit Criteria

* Player can understand why range or sword length changed.
* Debug UI helps agents verify queue behavior.
* No major UI redesign is required for initial implementation.

---

# Phase 12: Save Data and Migration

## Goal

Persist the ordered mote queue and regeneration state safely.

## Tasks

1. Decide which fields need to persist.
2. Likely persist:

   * loadout order
   * unlocked dust types
   * dust containers
3. Possibly do not persist momentary combat depletion across room loads unless desired.

Recommended:

* Do not persist momentary mote depletion across save/load initially.
* Rebuild full mote queue from loadout on room load.
* Later, if desired, persist depleted cooldown state.

## Save Rules

For initial implementation:

```text
Save loadout order.
Save dust containers.
Save unlocked dust types.
Do not save temporary combat depletion.
```

This avoids save corruption risk.

## Exit Criteria

* Old saves load.
* New fields have defaults.
* No undefined queue state on old saves.
* Dev testing defaults are clearly marked.

---

# Phase 13: Polish and Balancing

## Goal

Make the system feel good.

## Tuning Areas

### Grapple

* Full range
* Minimum range
* Smooth shrink/grow speed
* Break behavior when attached and range shrinks

### Mote Regeneration

* Base cooldown
* Whether cooldown differs by dust type
* Whether being grounded affects cooldown
* Whether combat delays regeneration

### Sword

* Max sword mote count
* Minimum energy needed to swing
* Auto-swing radius
* Sword readiness circle
* Slash damage
* Slash arc
* Tip VFX

### Shield

* Center strength
* Shield density
* Mote spacing
* Regeneration during shield hold
* Whether shield center motes are more likely to be hit

### UI

* Grapple circle visibility
* Mote depletion feedback
* Cooldown clarity

## Exit Criteria

* Losing motes feels dangerous but not instantly punishing.
* Grapple range shrink is noticeable but not frustrating.
* Sword length reduction is visually clear.
* Shield weakening is understandable.
* Regeneration feels satisfying.

---

# Recommended Implementation Order Summary

## Phase 0

Stabilize current Phase 1 Shield Sword.

## Phase 1

Add logical ordered mote queue.

## Phase 2

Add depletion and regeneration cooldown.

## Phase 3

Make grapple range depend on available mote ratio.

## Phase 4

Use grapple range circle as circle of influence.

## Phase 5

Make Shield Weave use ordered motes.

## Phase 6

Make Sword Weave use ordered motes and dynamic length.

## Phase 7

Implement combined Shield plus Sword RMB guard-swipe behavior.

## Phase 8

Implement Storm versus inventory-space source behavior.

## Phase 9

Update Grapple Weave to use ordered mote logic more deeply.

## Phase 10

Update Arrow Weave to use ordered mote logic.

## Phase 11

Add UI and visual feedback.

## Phase 12

Add safe save/load handling.

## Phase 13

Polish and balance.

---

# Agent Guidelines

## Do

* Work in small phases.
* Preserve existing behavior until a replacement is stable.
* Add debug output early.
* Use deterministic ordering.
* Keep gameplay formulas simple.
* Use typed arrays if consistent with current sim code.
* Avoid hot-path allocations.
* Keep visual range and mechanical range aligned.
* Run typecheck and build after each phase.

## Do Not

* Do not implement proportional multi-dust sword ratios.
* Do not refactor the entire particle engine in one pass.
* Do not change the WebGL renderer unless absolutely necessary.
* Do not make grapple max range increase with dust containers.
* Do not make sword max length increase with dust containers.
* Do not let active formation assignment count as depletion.
* Do not let motes duplicate between inventory, storm orbit, sword, shield, arrow, and grapple.
* Do not allow permanent mote loss unless intentionally designed.
* Do not break existing Grapple behavior.

---

# Critical Invariants

These must always remain true:

1. Total logical mote slots are determined by dust container capacity and loadout.
2. Available mote count plus depleted mote count equals total mote count.
3. Depleted motes are skipped by active formations.
4. Active formations use available motes in original loadout order.
5. Extra mote containers increase resilience, not maximum grapple range.
6. Grapple visual circle must match actual usable grapple range.
7. Sword attack range must match visible sword length.
8. Shield center must use earliest available motes.
9. Motes should not visually duplicate across formations.
10. Releasing a weave returns motes to Storm orbit if Storm is unlocked, or to inventory space if not.

---

# Example Final Behavior

## Scenario 1: Player Has 4 Motes

```text
Total motes: 4
Available motes: 4
Grapple range: 100%
Sword length: up to 4/8 if max sword length is 8
```

Player loses 1 mote:

```text
Available motes: 3
Grapple range: 75%
Sword length: 3/8
Shield density reduced
```

## Scenario 2: Player Has 20 Motes

```text
Total motes: 20
Available motes: 20
Grapple range: 100%
Sword length: full, because it only needs 8 motes
Reserve motes: 12
```

Player loses 5 motes:

```text
Available motes: 15
Grapple range: 75%
Sword length: still full if at least 8 motes are available
Reserve motes: 7
```

This is the intended resilience effect.

## Scenario 3: Shield Plus Sword RMB Hold

```text
Enemy is nearby.
Sword is ready.

Player holds RMB:
1. Sword aims toward mouse.
2. Sword performs a guard swipe.
3. Sword unfolds into shield crescent.
4. Shield remains active while RMB is held.

Player releases RMB:
1. Shield dissolves.
2. Motes return to Storm orbit or inventory space.
```

---

# Long-Term Design Direction

This ordered mote queue should become one of DustWeaver's signature systems.

It turns dust loadout into a physical combat language:

* First motes are the leading edge.
* Lost motes weaken the player visibly.
* More containers create resilience.
* Regeneration restores the player's range and formations.
* Every weave becomes a different expression of the same ordered dust body.


```

My strongest recommendation: **do not give an agent the whole roadmap as an implementation prompt all at once.** Put this in an `.md` design document, then ask an agent to implement only **Phase 0 and Phase 1** first. The ordered mote queue is now the foundation, and if that foundation is wrong, every later weave will inherit the mistake.
```
