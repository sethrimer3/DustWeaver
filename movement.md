# Movement V2

This is the authoritative reference for the active player-movement runtime. Values are derived from `src/sim/clusters/` and related collision/hazard modules. Unless stated otherwise, speeds are world units per second (wu/s), acceleration is wu/s², and deterministic simulation runs at 60 fixed steps per second (`dt = 1/60 s`).

## Coordinate system and units

World X increases right and decreases left. World Y increases down and decreases up, so an upward launch is stored as a negative Y velocity. `BLOCK_SIZE_SMALL` is 8 world units; medium and large block constants currently alias the same 8-unit size. Horizontal and vertical velocity use wu/s.

## Normal ground movement

- Walking input target: 120 wu/s.
- Ground acceleration: 800 wu/s². Reversing uses 1,466.7 wu/s².
- No-input ground friction/deceleration: 800 wu/s² immediately.
- Input never clamps externally earned over-cap momentum. After 0.75 s (45 continuously grounded ticks), held input bleeds over-cap speed toward 120 wu/s at 800 wu/s². Airborne ticks reset that grace timer, so repeated jumps preserve momentum.
- Crouching requires Down while grounded, reduces player half-height from 10 to 8 wu while keeping the feet fixed, and blocks horizontal acceleration.
- Sprint is removed. Shift does not increase speed and the runtime writes the legacy sprint input/state fields as zero.

## Air movement

- Input-speed target: 100 wu/s; acceleration: 520 wu/s².
- With no input, air friction is 60 wu/s².
- Opposite-direction input uses the 1,466.7 wu/s² turn acceleration while below the input target.
- At or above 100 wu/s, ordinary input neither adds speed nor decelerates earned momentum; no-input friction still applies.
- After a wall jump, normal air acceleration is multiplied by 2 until landing. Turn acceleration remains 1,466.7 wu/s².
- A rocket-block jump gives uncapped air acceleration at 0.5 of the applicable acceleration: normally 260 wu/s², or 733.35 wu/s² while reversing.

## Jumping

- Base launch: 255 wu/s upward; gravity: 900 wu/s².
- Held variable-jump sustain: 0.20 s (12 ticks), during which gravity cannot reduce the stored launch speed.
- Releasing jump while rising cancels sustain and applies 2.5× gravity (2,250 wu/s²).
- Held apex float applies below `|vy| < 35 wu/s` at 0.5× gravity (450 wu/s²).
- Normal fall cap: 160.5 wu/s. Fast-fall cap: 240 wu/s; its cap approaches at 300 wu/s². Holding jump while committed to fast fall brakes toward the normal cap at a net 350 wu/s².
- Coyote time: 6 ticks (0.10 s). Jump buffer source duration: 120 ms, quantized to 7 ticks.
- Corner correction searches horizontal offsets through 3 wu on an upward corner bonk. Block-pop assistance raises the player by at most 2 wu over a ledge lip.

## Dynamic skid system

A direction-reversal skid requires all of the following: grounded; input opposing the current horizontal velocity; entry speed at least the 120 wu/s walking target; and no normal ice, ultra ice, water contact, active grapple, or grapple-stuck movement. Sprint is not required. Strength is latched from absolute horizontal velocity on skid entry and does not change as the player brakes.

The exact added full-jump height is continuous, not rounded into tiers:

```text
bonusBlocks =
  1 + Math.max(0, skidEntrySpeed - walkingSpeed) / 30;
```

| Skid-entry speed | Added full-jump height |
|---:|---:|
| 120 wu/s | 1 block |
| 135 wu/s | 1.5 blocks |
| 150 wu/s | 2 blocks |
| 180 wu/s | 3 blocks |
| 210 wu/s | 4 blocks |
| 300 wu/s | 7 blocks |

Launch velocity is derived from target apex height rather than multiplied linearly. With target height `h`, gravity `g = 900`, and sustain `t = 0.20`, runtime solves `h = v*t + v²/(2g)`:

```text
v = -g*t + sqrt((g*t)^2 + 2*g*h)
h = baseHeldJumpTargetHeight + bonusBlocks * 8
baseHeldJumpTargetHeight = 255 * 0.20 + 255^2 / (2 * 900) = 87.125 wu
```

The 60 Hz fixed-step test (including 12-tick sustain and apex-float gravity) measures a base apex of 85.500 wu. Entry speeds 120, 135, 150, 180, 210, and 300 wu/s measure total apexes of 93.416, 97.134, 101.312, 109.193, 117.059, and 140.599 wu: gains of 7.916, 11.634, 15.812, 23.693, 31.559, and 55.099 wu respectively (approximately 1, 1.5, 2, 3, 4, and 7 blocks).

## Skid particles

At walking-speed direction-reversal entry, the baseline is 3 particles per tick, 2 wu horizontal and 1 wu vertical spawn spread, 30 wu/s horizontal variance, and 15–55 wu/s upward velocity. Particles inherit 18% of the latched entry velocity in the original travel direction. Count, spread, horizontal variance, and vertical range scale with entry speed using the soft knee

```text
scale = 1 + 3 * excess / (excess + 120)
excess = Math.max(0, skidEntrySpeed - 120)
```

Thus scaling starts at 1 and approaches (but never reaches) 4. The visual pool is bounded at 120 particles, recycles the oldest entry, uses 400 ms lifetimes and 200 wu/s² particle gravity, and uses a deterministic LCG (`state = state * 1664525 + 1013904223`, unsigned 32-bit) seeded with 1.

Direction-reversal particles use the latched skid speed/direction above. High-speed landing-skid particles are a separate one-tick effect: they begin above 157.5 wu/s, use `factor = min((speed - 157.5) / 157.5, 4)`, scale by `1 + factor`, spawn from foot center, and do not use the reversal-direction inheritance.

## Surface-specific movement

- Normal ice: 80 wu/s² ground acceleration and 35 wu/s² no-input deceleration; it suppresses skids.
- Ultra ice: lateral input and deceleration are suppressed and horizontal velocity is preserved. First contact supplies at least 52.5 wu/s in facing direction if needed; normal grounded contact clears the state.
- Water: retained gravity is 0.18×; upward buoyancy acceleration is `80 + 280 * submersionRatio`; exponential horizontal drag is 2.8/s and vertical drag is `3.0 + 4.5 * (1 - submersionRatio)` per second. Enter/exit submerged hysteresis is 0.55/0.35. Water jump non-additively restores at least 127.5 wu/s upward.
- Water skipping requires at least 175 wu/s total entry speed and an entry angle below 45° from horizontal. Y velocity reflects upward and is steepened to at least a 5° launch angle.
- Axis-aligned bounce pads reflect the contacted component with restitution 0.5 (normal) or 1.0 (strong); ramp pads use the equivalent normal-vector reflection.
- Springboards launch upward at 420 wu/s, cancel variable sustain, and animate for 12 ticks.
- Kinetic launch blocks replace the contacted-axis velocity with 280 wu/s away from the block.

## Wall movement

- Wall-slide downward cap: 17 wu/s.
- Wall jump: 147 wu/s horizontal. Vertical speeds are 152 wu/s first (`142 + 10`), 121.6 wu/s second (`152 * 0.8`), and 71 wu/s thereafter (`142 * 0.5`).
- Forced outward velocity: 10 ticks. Same-wall input/re-grab lockout: 12 ticks.
- Wall grace: 100 ms / 6 ticks. Proximity: 3 wu.
- Minimum jumpable wall face: 4 small blocks = 32 wu; minimum player overlap is 8 wu.
- Post-wall-jump normal air-control multiplier: 2× until landing.

## Grapple and zip movement

- Retraction ramps from 54 to 162 wu/s over 21 ticks (0.35 s). Total pull-in is limited to 150 wu before break.
- Tangential velocity scales by `oldRopeLength / newRopeLength`, limited to 1.1× per tick and 540 wu/s.
- Swing damping is 0.12/s and applies only when no horizontal direction is held; outward radial velocity is removed at the rope limit.
- Grapple jump-off subtracts 255 wu/s from Y while preserving swing momentum.
- Zip travels at 210 wu/s and arrives within one zip step plus 4 wu. Stuck velocity is multiplied by 0.7 per tick and counts stopped at 10 wu/s.
- Zip-jump window: 0.15 s / 9 ticks. Zip-jump speed: `255 * 1.331 = 339.405 wu/s` along the normalized launch vector.
- Held horizontal input of magnitude at least 0.5 biases the launch vector by 0.35 (65% surface normal, 35% input) before normalization.
- A jump during zip travel preserves X and Y momentum at 1.0× and adds `255 * 0.6 = 153 wu/s` upward.

## Damage knockback

For applied damage `d`, horizontal target speed is `sign(playerX - sourceX) * (90 + 18*d)`; equal-X hits use +X. Vertical target is always `-60 wu/s`. Each velocity component blends `new = old * 0.3 + target * 0.7`, then grounded state is cleared.

## Removed and deprecated behavior

- Sprint and its speed/friction constants are removed. Shift has no movement-speed effect.
- The fixed skid-jump multiplier is removed; skid launches use target-height conversion.
- `playerSprintHeldFlag`, `isSprintingFlag`, and `isSlidingFlag` remain as inert compatibility/snapshot fields and are written as zero.
- `MAX_RUN_SPEED_WORLD_PER_SEC` (105), `AIR_MOVE_SPEED_WORLD_PER_SEC` (105), `AIR_BRAKING_PER_SEC2` (1,000), `MOMENTUM_DECAY_PER_SEC2` (25), `HIGH_SPEED_STEERING_FACTOR` (0.35), and `AIR_DECELERATION_PER_SEC2` (600) remain defined for compatibility or other references but are not the active Movement V2 horizontal-control path. Active targets/friction are the values documented above.
