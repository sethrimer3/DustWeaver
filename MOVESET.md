# MOVESET

This document lists the currently implemented movement techniques and their exact tuning values (60 FPS reference).

Movement V2: sprint has been removed entirely — there is no Shift-modified
movement state anywhere in the game. Walking speed is a single, constant
grounded-input target. What used to require holding Shift (the skid
technique) is now a speed-scaled technique triggered purely by deliberately
reversing direction at or above walking speed — see "Skid Tech" below.

## Core Ground / Air Movement

- **Run (Left / Right)**
  - Grounded-input walking-speed target: **120 world units/sec**
    (`GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC`) — the single authoritative
    walking speed; there is no separate faster sprint gait.
  - Ground acceleration: **800 units/sec²**.
  - Air acceleration: **520 units/sec²**.
  - Turn acceleration (reversal / deceleration toward zero): **1466.7 units/sec²**,
    applied uniformly whether current speed is below or above the walking-speed
    target — a deliberate reversal always decelerates existing velocity through
    zero, even from external over-cap momentum (grapple, bounce, etc.).
- **Crouch (hold S / ArrowDown while grounded)**
  - Input condition: grounded + crouch input held (binary state toggle).
    Fully blocks horizontal acceleration; unmodified by any other key.
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

## Skid Tech (Movement V2 — speed-scaled, no Shift required)

- **Skid Activation**
  - Triggers when: grounded, not grappling/grapple-stuck, not on normal or
    ultra ice, not in water, horizontal input is nonzero and opposite the
    player's current horizontal velocity, and `abs(velocityX)` is at or
    above walking speed (120, with a tiny floating-point tolerance).
  - The signed horizontal velocity at the instant of entry is latched
    (`skidEntryVelocityXWorld`) and used for jump-height and particle
    scaling — never the live, already-decelerating velocity.
  - Detected in an authoritative phase (`updatePlayerSkidState`,
    `src/sim/clusters/playerSkid.ts`) that runs before vertical/jump
    movement each tick, so a same-tick reversal + jump press is never lost.
  - Ends when: velocity crosses into the new direction, input is released
    or no longer opposes the original direction, the player leaves the
    ground beyond the coyote-time window without consuming a skid jump, or
    the player enters water/ice/ultra-ice/grapple movement.
- **Skid Jump Boost**
  - Available only while an active skid has not yet been consumed.
  - Target bonus apex height (small blocks):
    `bonusBlocks = 1 + max(0, abs(skidEntryVelocityXWorld) - 120) / 30`
    — continuous, not stepped. 120 → +1, 135 → +1.5, 150 → +2, 180 → +3,
    210 → +4, 300 → +7 small blocks.
  - The launch speed needed to reach that added height is derived from the
    idealized held-jump model `height(v) = v·sustainTime + v²/(2·gravity)`,
    inverted for `v`, using the currently active base jump speed and
    gravity (including live debug overrides). See
    `src/sim/clusters/skidJumpHeight.ts` — one authoritative helper, shared
    by the direct grounded jump, coyote jump, and landing-buffered ground
    jump paths. Wall jumps, water jumps, grapple jump-off, zip jumps, and
    springboards/kinetic blocks never receive this bonus.
- **Skid Debris (visual)**
  - Debris spawns at the bottom-front foot while skidding, scaled by a
    soft-knee curve of the latched skid-entry speed (see
    `computeSkidVisualSpeedWorld` in `src/render/skidDebrisRenderer.ts`):
    `effectiveVisualSpeed = walkingSpeed + softKnee·log1p(max(0, skidSpeed − walkingSpeed) / softKnee)`,
    `softKnee = 90`. Near-linear close to walking speed; smooth diminishing
    returns at extreme (grapple-launch-range) speed — no hard clamp.
    Distinct from the separate high-speed *landing* skid dust effect
    (`playerLandingSkidSpeedFactor`), which is unrelated to direction reversal.

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
  - Zip speed: **210 units/sec**.
  - Arrival threshold: **4.0 units**.
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
  - `src/sim/clusters/movementConstants.ts`
  - `src/sim/clusters/playerSkid.ts` (skid activation/termination state machine)
  - `src/sim/clusters/skidJumpHeight.ts` (authoritative skid-jump launch-speed solver)
  - `src/sim/clusters/grapple.ts`
  - `src/sim/clusters/dashConstants.ts` (enemy dodge cooldown/recharge constants)
- Debug HUD can display movement flags/counters for testing (grounded, coyote, wall slide, grapple state, skid, etc.).
