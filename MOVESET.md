# MOVESET

This document lists the currently implemented movement techniques and their exact tuning values (60 FPS reference).

## Core Ground / Air Movement

- **Run (Left / Right)**
  - Max run speed: **105 world units/sec**.
  - Ground acceleration: **800 units/sec²**.
  - Air acceleration: **520 units/sec²**.
  - Turn acceleration: **1466.7 units/sec²**.
- **Sprint (hold Shift)**
  - Grounded sprint top-speed multiplier: **1.5×** (run speed becomes **157.5 units/sec**).
  - Extra sprint friction multiplier while slowing down: **0.5×** (slides longer than normal run).
- **Crouch (hold S / ArrowDown while grounded)**
  - Input condition: grounded + crouch input held (binary state toggle).
- **Jump (ground jump)**
  - Initial jump speed: **300 units/sec** upward.
- **Variable Jump Height**
  - Sustain window: **12 ticks** (**0.20s**) while jump is held.
  - Early release applies stronger jump-cut gravity (**2.5× gravity** while rising).
- **Apex Float**
  - Applies when |vertical speed| < **33 units/sec** and jump is held.
  - Gravity multiplier at apex: **0.5×**.
- **Fast Fall**
  - Normal fall cap: **160.5 units/sec**.
  - Fast-fall cap: **240 units/sec**.
  - Fast-fall cap approach rate: **300 units/sec²**.

## Jump Forgiveness Systems

- **Coyote Time**
  - Duration: **6 ticks** (~**0.10s**) after walking off a ledge.
- **Jump Buffer**
  - Duration: **6 ticks** (~**0.10s**) before landing.

## Wall Movement

- **Wall Slide**
  - Max slide descent speed: **17 units/sec**.
- **Wall Jump**
  - Horizontal launch speed: **147 units/sec** away from wall.
  - Vertical launch speed: first wall jump **152 units/sec** (142 + 10 bonus); subsequent wall jumps **71 units/sec** (142 × 0.5).
- **Post-Wall-Jump Air Acceleration**
  - After any wall jump, horizontal air acceleration is **doubled (2×)** until the player lands, making steering away from the wall snappier.
- **Wall Jump Force-Time**
  - Input override window: **10 ticks** (~**0.167s**).
- **Wall Jump Lockout**
  - Same-wall re-grab suppression: **12 ticks** (**0.20s**).

## Skid Tech

- **Skid**
  - Triggers when sprinting, grounded, and reversing direction while speed exceeds threshold.
  - Velocity threshold to qualify for skid direction checks: **5 units/sec**.
  - Skid deceleration multiplier: **1.5×**.
- **Skid Jump Boost**
  - Jump speed multiplier while skidding: **1.153×** (targets ~6 small blocks of height).
- **Skid Debris (visual)**
  - Debris spawns at the bottom-front foot while skidding.

## Grapple Movement (Special Techniques)

- **Grapple Fire**
  - Max cast length: **96 units**.
  - Minimum valid attach distance: **20 units**.
- **Pendulum Swing**
  - Rope is inextensible; outward radial velocity is removed at rope limit.
  - Tangential damping: **0.12/sec**.
- **Tap Release**
  - Tap window: **6 ticks** (~**0.10s**).
  - Tap-release hop boost: **53 units/sec** upward.
- **Hold Retract**
  - Pull-in speed: **60 units/sec**.
  - Max retract speed ratio per tick: **1.1×**.
- **Rope Break on Over-Pull**
  - Rope snaps after cumulative pull-in exceeds **100 units**.
- **Top-Surface Grapple Attach**
  - Can attach to horizontal top surfaces.
  - **Corner rule:** if the hit is on a block corner, it is treated as a **vertical side hit**, not a top-surface hit.
- **Top-Surface Zip**
  - Zip speed: **472.5 units/sec**.
  - Arrival threshold: **1.0 unit**.
- **Top-Surface Stick**
  - Velocity decay factor: **0.05/tick** while stuck.
  - Considered stopped below **1.0 units/sec**.
- **Stuck Super Jump Window**
  - Window after fully stopping: **10 ticks** (~**0.167s**).
  - Jump multiplier in window: **1.331×** vertical jump speed (targets ~8 small blocks of height).
- **Grapple Miss Mode**
  - Chain extension speed: **400 units/sec**.
  - Miss mode timeout: **90 ticks** (**1.5s**).

## Notes

- Current movement tuning constants and logic live in:
  - `src/sim/clusters/movement.ts`
  - `src/sim/clusters/grapple.ts`
  - `src/sim/clusters/dashConstants.ts` (enemy dodge cooldown/recharge constants)
- Debug HUD can display movement flags/counters for testing (grounded, coyote, wall slide, grapple state, skid, sprint, etc.).
