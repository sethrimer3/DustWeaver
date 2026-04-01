# MOVESET

This document lists the currently implemented movement techniques and their key tuning values (60 FPS reference).

## Core Ground / Air Movement

- **Run (Left / Right)**
  - Max run speed: **105 world units/sec**.
  - Ground acceleration: **800 units/sec²**.
  - Air acceleration: **520 units/sec²**.
  - Turn acceleration: **1466.7 units/sec²**.
- **Sprint (hold Shift)**
  - Grounded sprint top-speed multiplier: **1.5×** (run speed becomes **157.5 units/sec**).
  - Extra sprint friction multiplier while slowing down: **0.5×** (slides longer than normal run).
- **Sprint Burst (tap Shift)**
  - One-shot horizontal speed set to **373 units/sec**.
  - Cooldown: **180 ticks** (**3.0s**).
  - Recharge ring animation: **36 ticks** (**0.6s**) after cooldown completes.
- **Crouch (hold S / ArrowDown while grounded)**
  - Enters crouch state while grounded.
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
  - Vertical launch speed: **147 units/sec** upward.
- **Wall Jump Force-Time**
  - Input override window: **10 ticks** (~**0.167s**).
- **Wall Jump Lockout**
  - Same-wall re-grab suppression: **12 ticks** (**0.20s**).

## Sprint Burst / Skid Tech

- **Skid**
  - Triggers when sprinting, grounded, and reversing direction while speed exceeds threshold.
  - Velocity threshold to qualify for skid direction checks: **5 units/sec**.
  - Skid deceleration multiplier: **1.5×**.
- **Skid Jump Boost**
  - Jump speed multiplier while skidding: **1.5×**.
- **Skid Debris (visual)**
  - Debris spawns at the bottom-front foot while skidding.

## Grapple Movement (Special Techniques)

- **Grapple Fire**
  - Max cast length: **influence radius** (`GRAPPLE_MAX_LENGTH_WORLD`).
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
  - Jump multiplier in window: **2.0×** vertical jump speed.
- **Grapple Miss Mode**
  - Chain extension speed: **400 units/sec**.
  - Miss mode timeout: **90 ticks** (**1.5s**).

## Notes

- Current movement tuning constants and logic live in:
  - `src/sim/clusters/movement.ts`
  - `src/sim/clusters/grapple.ts`
  - `src/sim/clusters/dashConstants.ts` (shared cooldown/recharge constants, now used by sprint burst)
- Debug HUD can display movement flags/counters for testing (grounded, coyote, wall slide, grapple state, skid, sprint, etc.).
