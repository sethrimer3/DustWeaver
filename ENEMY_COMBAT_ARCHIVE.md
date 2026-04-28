# Enemy Combat Archive

This document archives the enemy dust combat system that was removed in **BUILD 194**.

---

## `triggerEnemyAttackLaunch` (enemyCombat.ts)

Enemies launched their orbit particles toward the player using an attack direction + spread.

- Worked identically to `triggerAttackLaunch` for the player, but targeted the player cluster position.
- Each particle kind used its own `attackParams` (speed, halfSpreadRad, loopStrength).
- Particles were fanned out based on their index within their kind group.
- Holy particles used a full-circle spread; others used a linear spread.
- Loop-strength particles received a perpendicular kick for curling trajectories.
- After launch, particles entered `behaviorMode = 1` (attack mode) with a per-kind duration.

## `applyEnemyBlockForces` (enemyCombat.ts)

Enemies used their particles as a defensive shield when `enemyAiIsBlockingFlag === 1`.

- **Flying Eye**: Spun all particles in a tight full protective circle (360° spread) around the enemy centre.
- **Rolling Enemy**: Formed a wide crescent arc (±135°, nearly a semicircle) facing the player. The block direction pointed toward the player so the crescent was interposed between enemy and player.
- **Other enemies**: Used the standard player shield grid (via `computeShieldTarget`), with the shield direction pointing away from the player.
- On block end (`enemyAiIsBlockingFlag === 0`), any particles still in `behaviorMode = 2` (block mode) were released back to orbit mode.

## `rockElementalDust.ts` (Rock Elemental dust orbit / projectile)

Rock Elemental enemies orbited Earth particles in a ring and fired them as projectiles.

- Particles were arranged in an expanding/contracting ring using parametric angles.
- On attack state, particles were launched radially outward from the orbit ring as projectiles.
- Orbit radius and angular speed varied with the Rock Elemental's current AI state.
- The system pre-allocated scratch buffers for per-kind orbit indices.
- Called as step 0.5c in the tick pipeline.

## Enemy AI Attack/Block Decisions (enemyAi.ts)

Enemy clusters made per-tick combat decisions:

### Attack Decision
- Triggered when the player was within `ENEMY_ATTACK_RANGE_WORLD` (213 world units).
- Required `enemyAiAttackCooldownTicks === 0` and not currently blocking.
- Set `enemyAttackTriggeredFlag = 1` and stored the direction toward the player.
- Applied a cooldown of `ENEMY_ATTACK_COOLDOWN_TICKS` (120 ticks, ~2 seconds at 60 fps).

### Block Decision
- Scanned all alive player-owned particles in attack mode (`behaviorMode === 1`).
- Triggered when `incomingThreatCount >= 1` (any player attack particle heading toward this enemy within `ENEMY_BLOCK_DETECTION_RANGE_WORLD` = 107 units with dot product > 0.5).
- Required not already blocking and block cooldown elapsed.
- Block direction: Rolling enemies shielded toward the player; others shielded away from the player.
- Lasted `ENEMY_BLOCK_DURATION_TICKS` (55 ticks) before auto-releasing.
- Staggered attack cooldown during block: set to `ENEMY_BLOCK_COOLDOWN_TICKS` (60 ticks).

### Flying Eye Threat Response
- When `incomingThreatCount >= 1`, the flying eye also triggered a dodge directly away from the player.
- This was separate from the spontaneous dodge and occurred at lower threat threshold than the `incomingThreatCount >= 2` condition used for generic dodge.

---

*All these systems were removed in BUILD 194 to simplify enemy behavior and remove the bidirectional particle combat meta.*
