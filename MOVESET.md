# MOVESET

This document lists the player movement actions and advanced movement techniques currently implemented in DustWeaver.

## Core Ground / Air Movement

- **Run (Left / Right):** Standard horizontal movement with separate ground and air acceleration.
- **Sprint (hold Shift):** Increases grounded top speed.
- **Crouch (hold S):** Enters crouch state while grounded.
- **Jump:** Standard grounded jump.
- **Variable Jump Height:** Hold jump for a higher jump; release early for a short hop.
- **Apex Float:** Near the top of the arc, holding jump softens gravity briefly.
- **Fast Fall:** Hold down while airborne/falling to increase max downward speed.

## Jump Forgiveness Systems

- **Coyote Time:** Jump can still trigger for a short window after leaving a ledge.
- **Jump Buffer:** Jump input made slightly before landing is buffered and fires on landing.

## Wall Movement

- **Wall Slide:** While falling and pressing into a wall, descent is capped to a slower slide speed.
- **Wall Jump:** Jump away from a wall with a strong outward + upward launch.
- **Wall Jump Force-Time:** Briefly preserves outward momentum so you cannot instantly steer back into the same wall.
- **Wall Jump Lockout:** Short lockout that prevents same-wall climb spam.

## Dash / Skid Tech

- **Dash:** Quick horizontal burst with cooldown.
- **Skid:** If sprinting and reversing direction on ground, enters skid state.
- **Skid Jump Boost:** Jumping out of a skid gives extra jump height.
- **Skid Debris (visual):** Debris particles spawn from the bottom-front foot while skidding.

## Grapple Movement (Special Techniques)

- **Grapple Fire:** Shoot hook toward aim point; attaches to valid wall hit.
- **Pendulum Swing:** Rope constraint preserves tangential velocity for natural swinging.
- **Tap Release:** Quick jump tap while grappling releases the hook (includes a small hop boost).
- **Hold Retract:** Holding jump while grappling shortens rope and increases swing speed.
- **Rope Break on Over-Pull:** Retracting past max pull-in snaps rope and launches player with built momentum.
- **Top-Surface Grapple Attach:** Grapple can detect and attach to horizontal ledge top surfaces.
- **Top-Surface Zip:** Player zips toward top-surface anchor point.
- **Top-Surface Stick:** On arrival, player sticks and rapidly decelerates to near-stop.
- **Stuck Super Jump Window:** If you jump shortly after coming to a full stuck stop, jump gets a major height boost.
- **Grapple Miss Mode:** Missed grapple shots still show an extended chain that goes limp/falls.

## Notes

- Current movement tuning constants and logic live in:
  - `src/sim/clusters/movement.ts`
  - `src/sim/clusters/grapple.ts`
- Debug HUD can display movement flags/counters for testing (grounded, coyote, wall slide, grapple state, skid, sprint, etc.).
