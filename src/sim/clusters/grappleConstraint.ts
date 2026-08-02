/**
 * grappleConstraint.ts — Per-tick grapple rope constraint and swing physics.
 *
 * Extracted from grapple.ts so that the fire/init/FX logic (grapple.ts) and
 * the per-tick constraint physics live in separate, focused modules.
 *
 * Exported: applyGrappleClusterConstraint
 *
 * Called from tick.ts at step 0.25 (after applyClusterMovement) to enforce
 * the rope length and apply pendulum physics.  See grapple.ts for the full
 * developer notes on the physics model.
 */

import { WorldState } from '../world';
import { PLAYER_JUMP_SPEED_WORLD, VAR_JUMP_TIME_TICKS } from './movement';
import { moveClusterByDelta } from './movementCollision';
import {
  GRAPPLE_MIN_LENGTH_WORLD,
  raycastWalls,
  releaseGrapple,
} from './grappleShared';
import { tickGrappleWrapping } from './grappleWrapping';
import { tickGrappleZip } from './grappleZip';
import {
  canMoveGrappleCarryBlockToward,
  pullGrappleCarryBlockToward,
} from '../grappleCarryBlocks';

// ============================================================================
// Tuning constants — used only by applyGrappleClusterConstraint
// ============================================================================

/**
 * Base speed at which the rope shortens while the down key is held (world units per second).
 * Applied at the start of a retraction hold before the ramp reaches full speed.
 * Tuned slightly below the old 60 wu/s value so hold-down retraction has
 * a little more readable wind-up.
 */
const GRAPPLE_PULL_IN_SPEED_BASE_WORLD_PER_SEC = 54.0;

/**
 * Full speed at which the rope shortens while the down key is held (world units per second).
 * Reached after GRAPPLE_PULL_IN_RAMP_TICKS ticks of continuous hold.
 * Shorter rope = tighter swing radius = faster rotation = bigger launch when released.
 */
const GRAPPLE_PULL_IN_SPEED_WORLD_PER_SEC = 162.0;

/**
 * Number of ticks over which the retraction speed ramps from the base speed
 * to the full speed.  At 60 fps this is 0.35 seconds.
 * Prevents an instantaneous velocity spike when the player starts retracting.
 */
const GRAPPLE_PULL_IN_RAMP_TICKS = 21;

/**
 * Maximum total rope that can be pulled in before the grapple breaks (world units).
 * This is a tension limit — pulling too hard snaps the rope and the player flies
 * off with their accumulated swing momentum.  Acts as the skill ceiling for the mechanic.
 * Raised from 100 to 150 to give more retraction time at the higher pull speed.
 */
const GRAPPLE_MAX_PULL_IN_WORLD = 150.0;

/**
 * Maximum ratio by which tangential velocity can increase in a single tick due
 * to rope shortening (conservation of angular momentum).  Prevents extreme
 * speed spikes when the rope is very short.  1.1 = max 10 % boost per tick.
 */
const GRAPPLE_MAX_RETRACT_SPEED_RATIO = 1.1;

/**
 * Maximum tangential speed (world units/second) the player can reach via rope
 * retraction.  Acts as a hard cap so unbounded speed cannot accumulate even
 * when the rope is very short and angular-momentum conservation would produce
 * extreme values.  540 wu/s ≈ 9 wu/tick at 60 fps — fast but safe.
 */
const GRAPPLE_MAX_TANGENTIAL_SPEED_WORLD_PER_SEC = 540.0;

const GRAPPLE_CARRY_TENSION_SLACK_WORLD = 1.0;
const GRAPPLE_CARRY_TENSION_PULL_SPEED_WORLD_PER_SEC = 36.0;
const GRAPPLE_CARRY_REEL_PULL_SPEED_WORLD_PER_SEC = 44.0;

/**
 * Upward velocity impulse (world units/second) added to the player when they
 * press jump to release the grapple.  This is a "jump off the rope" that adds
 * upward momentum to whatever swing velocity the player has.
 * Applied by *subtracting* from velocityYWorld — negative Y is upward.
 */
const GRAPPLE_JUMP_OFF_SPEED_WORLD = PLAYER_JUMP_SPEED_WORLD;

// ============================================================================
// Constraint function
// ============================================================================

/**
 * Step 0.25 — Enforces the rope constraint and applies swing physics.
 *
 * Called after applyClusterMovement (which applies gravity and floor collision)
 * so the constraint acts on the fully-updated cluster position and velocity.
 *
 * Controls:
 *   • Jump (W/Space/Up) → release grapple + upward velocity impulse.
 *   • Down (S/ArrowDown) held → retract (shorten) the rope.
 *     Shortening conserves angular momentum so the player swings faster.
 *     RMB while attached → activate zip: player rockets toward the anchor,
 *     momentum stops on arrival, then a 0.15 s zip-jump window opens.
 *     Jump in window = high-velocity zip-jump biased by held input direction.
 *     Miss window = grapple releases quietly, no automatic impulse.
 *
 * Pipeline per tick:
 *   1. Consume playerJumpTriggeredFlag and playerDownTriggeredFlag.
 *   2. Delegate zip activation + state machine to tickGrappleZip.
 *   3. If zip active → skip normal swing.
 *   4. Jump pressed (normal swing) → release with upward impulse.
 *   5. While down held (retraction):
 *      a. Decompose velocity into radial + tangential components.
 *      b. Shorten the rope.
 *      c. Scale tangential velocity by (oldLength / newLength) to conserve
 *         angular momentum.
 *      d. Recompose velocity from radial + boosted tangential.
 *   6. Enforce rope length: if player distance > ropeLength, snap position
 *      onto the rope circle and remove the outward radial velocity component.
 *   7. Post-constraint wall collision check to prevent ground clipping.
 *   8. Preserve tangential velocity indefinitely unless another gameplay
 *      force, collision, or rope retraction changes it.
 */
export function applyGrappleClusterConstraint(world: WorldState): void {
  if (world.isGrappleActiveFlag === 0) return;

  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) {
    releaseGrapple(world);
    return;
  }

  const dtSec = world.dtMs / 1000.0;
  if (world.grappleCarryBlockIndex >= 0) {
    const bi = world.grappleCarryBlockIndex;
    if (bi >= world.grappleCarryBlockCount) {
      releaseGrapple(world);
      return;
    }
    world.grappleAnchorXWorld = world.grappleCarryBlockXWorld[bi];
    world.grappleAnchorYWorld = world.grappleCarryBlockYWorld[bi];
  }

  // ── Jump input ────────────────────────────────────────────────────────────
  // movement.ts preserves playerJumpTriggeredFlag when grapple is active so we
  // can detect the rising edge of a jump press here.
  const jumpJustPressed = world.playerJumpTriggeredFlag === 1;
  world.playerJumpTriggeredFlag = 0; // consume — grapple owns the flag while active

  // ── Ordinary ("quiet") release request ────────────────────────────────────
  // Set by gameCommandProcessor.ts on Hold-mode mouse/gamepad-button-up or a
  // Toggle-mode second click. That command processing happens once per
  // rendered frame, outside the deterministic fixed tick, so it only queues
  // the request here rather than releasing immediately. Consuming (and
  // clearing) it now means it is applied at most once and jump-off — handled
  // immediately below — always takes priority when both land on the same
  // tick, per the intended jump-off-over-quiet-release ordering.
  const quietReleaseRequested = world.isGrappleQuietReleaseRequestedFlag === 1;
  world.isGrappleQuietReleaseRequestedFlag = 0;

  // Consume the down triggered flag so it does not accumulate during grapple.
  // (Retraction uses playerCrouchHeldFlag; playerDownTriggeredFlag was only
  //  needed by the old double-tap zip detection which has been replaced by RMB.)
  world.playerDownTriggeredFlag = 0;

  if (tickGrappleZip(world, player, jumpJustPressed, dtSec)) {
    // Zip owns jump handling internally (zip-jump window). If a quiet release
    // was also requested this tick and zip did not already end the grapple
    // (e.g. via the miss-window release), honor it now so mouse-up during a
    // zip still reliably detaches, matching pre-existing behavior.
    if (quietReleaseRequested && world.isGrappleActiveFlag === 1) {
      releaseGrapple(world);
    }
    return;
  }

  // Jump-off already handles its own release below and must win over a
  // same-tick quiet release; quietReleaseRequested is otherwise honored at
  // the end of this function, after this tick's swing physics (retraction +
  // rope-length constraint) has finished updating the player's true velocity.

  // ════════════════════════════════════════════════════════════════════════════
  // Normal grapple — pendulum swing
  // ════════════════════════════════════════════════════════════════════════════

  // ── Phase 2: Geometric wrapping tick ─────────────────────────────────────
  // Must run before the constraint so wrap points are current this tick.
  if (world.isGrappleWrappingEnabled === 1) {
    tickGrappleWrapping(world, player);
  }

  // ── Jump input: release grapple + upward impulse ──────────────────────────
  // Any jump press immediately releases the grapple and gives the player an
  // upward velocity boost so they can "jump off" the rope.
  if (jumpJustPressed) {
    player.velocityYWorld -= GRAPPLE_JUMP_OFF_SPEED_WORLD;
    player.varJumpTimerTicks = VAR_JUMP_TIME_TICKS;
    player.varJumpSpeedWorld = player.velocityYWorld;
    releaseGrapple(world, false, true);
    return;
  }

  // ── Compute radial direction from anchor to player ────────────────────────
  // Phase 2: When wrapping is enabled and wrap points exist, the active swing
  // anchor is the newest wrap point rather than the main grapple anchor.
  const ax = (world.isGrappleWrappingEnabled === 1 && world.grappleWrapPointCount > 0)
    ? world.grappleWrapPointXWorld[world.grappleWrapPointCount - 1]
    : world.grappleAnchorXWorld;
  const ay = (world.isGrappleWrappingEnabled === 1 && world.grappleWrapPointCount > 0)
    ? world.grappleWrapPointYWorld[world.grappleWrapPointCount - 1]
    : world.grappleAnchorYWorld;
  const dx = player.positionXWorld - ax;
  const dy = player.positionYWorld - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1.0) {
    // Degenerate — player at anchor point. No swing physics to run this tick,
    // but a pending quiet release must still be honored with current velocity.
    if (quietReleaseRequested) releaseGrapple(world);
    return;
  }

  const invDist = 1.0 / dist;
  // Unit vector pointing from anchor toward player (outward / radial direction)
  const nx = dx * invDist;
  const ny = dy * invDist;

  // ── Rope retraction (hold down / S) ───────────────────────────────────────
  // While the down key is held the rope shortens, and angular momentum is
  // conserved: v_tangential_new = v_tangential_old × (L_old / L_new).
  // This is why figure skaters spin faster when they pull their arms in.
  // A ramp-up over GRAPPLE_PULL_IN_RAMP_TICKS prevents an instant speed spike
  // on the first tick of a retraction hold.
  if (world.playerCrouchHeldFlag === 1) {
    world.grappleRetractHeldTicks++;
    // Ramp: starts at base speed on tick 1, reaches full speed at RAMP_TICKS.
    const rampFactor = Math.max(
      GRAPPLE_PULL_IN_SPEED_BASE_WORLD_PER_SEC / GRAPPLE_PULL_IN_SPEED_WORLD_PER_SEC,
      Math.min(1.0, world.grappleRetractHeldTicks / GRAPPLE_PULL_IN_RAMP_TICKS),
    );
    const pullThisTick = GRAPPLE_PULL_IN_SPEED_WORLD_PER_SEC * rampFactor * dtSec;
    const oldLength = world.grappleLengthWorld;
    const newLength = Math.max(oldLength - pullThisTick, GRAPPLE_MIN_LENGTH_WORLD);

    if (newLength < oldLength) {
      // Wall obstruction check: shortening the rope snaps the player toward
      // the anchor.  If a wall blocks that path, stop retraction rather than
      // pulling the player through geometry.  Cast from the player toward the
      // anchor; only check up to however far the player would actually move.
      // When retractDistWorld <= 0 the player is already within the new rope
      // length, so no snap occurs and no wall check is needed.
      const retractDistWorld = dist - newLength;
      const isRetractPathClear = retractDistWorld <= 0 || raycastWalls(
        world,
        player.positionXWorld, player.positionYWorld,
        -nx, -ny,
        retractDistWorld,
      ) === null;

      if (world.grappleCarryBlockIndex >= 0) {
        const bi = world.grappleCarryBlockIndex;
        const towardPlayerX = nx;
        const towardPlayerY = ny;
        if (canMoveGrappleCarryBlockToward(world, bi, towardPlayerX, towardPlayerY)) {
          const pullSpeed = GRAPPLE_CARRY_REEL_PULL_SPEED_WORLD_PER_SEC * rampFactor;
          pullGrappleCarryBlockToward(world, bi, towardPlayerX, towardPlayerY, pullSpeed);
        } else if (isRetractPathClear) {
          world.grappleLengthWorld = newLength;
        }
      } else if (isRetractPathClear) {
        // Decompose velocity into radial and tangential components relative to
        // the anchor→player axis.
        const vRadial = player.velocityXWorld * nx + player.velocityYWorld * ny;
        const vTangX  = player.velocityXWorld - vRadial * nx;
        const vTangY  = player.velocityYWorld - vRadial * ny;

        // Scale tangential velocity to conserve angular momentum (L = m·v·r).
        // The ratio is clamped to prevent extreme spikes when the rope is very short.
        const ratio = Math.min(oldLength / newLength, GRAPPLE_MAX_RETRACT_SPEED_RATIO);
        let newVTangX = vTangX * ratio;
        let newVTangY = vTangY * ratio;

        // Hard cap on tangential speed to prevent unbounded acceleration when
        // the rope becomes very short.  Clamp after the ratio is applied so the
        // cap is consistent regardless of rope length.
        const tangSpeedSq = newVTangX * newVTangX + newVTangY * newVTangY;
        const maxTangSpeedSq = GRAPPLE_MAX_TANGENTIAL_SPEED_WORLD_PER_SEC * GRAPPLE_MAX_TANGENTIAL_SPEED_WORLD_PER_SEC;
        if (tangSpeedSq > maxTangSpeedSq) {
          const invTangSpeed = 1.0 / Math.sqrt(tangSpeedSq);
          newVTangX *= GRAPPLE_MAX_TANGENTIAL_SPEED_WORLD_PER_SEC * invTangSpeed;
          newVTangY *= GRAPPLE_MAX_TANGENTIAL_SPEED_WORLD_PER_SEC * invTangSpeed;
        }

        player.velocityXWorld = vRadial * nx + newVTangX;
        player.velocityYWorld = vRadial * ny + newVTangY;

        world.grappleLengthWorld        = newLength;
        world.grapplePullInAmountWorld += (oldLength - newLength);

        // Snap limit: too much accumulated tension breaks the rope
        if (world.grapplePullInAmountWorld >= GRAPPLE_MAX_PULL_IN_WORLD) {
          releaseGrapple(world);
          return;
        }
      }
      // If a wall blocks retraction, or if newLength equals GRAPPLE_MIN_LENGTH_WORLD,
      // no further pull occurs this tick.
    }
  } else {
    // Crouch key released — reset ramp counter so the next press starts fresh.
    world.grappleRetractHeldTicks = 0;
  }

  // ── Enforce rope length constraint ────────────────────────────────────────
  // If the player has drifted beyond the current rope length (due to gravity,
  // movement, or the rope shortening around them), move their position back
  // onto the rope circle using the collision-safe helper so the correction
  // cannot push them through a wall.  The outward radial velocity component
  // is removed afterward to prevent the rope from being stretched further.
  // The tangential (swing) component is fully preserved — this is what makes
  // the pendulum feel physical rather than scripted.
  const ropeLength = world.grappleLengthWorld;

  if (world.grappleCarryBlockIndex >= 0) {
    const bi = world.grappleCarryBlockIndex;
    const towardPlayerX = nx;
    const towardPlayerY = ny;
    if (
      dist > ropeLength + GRAPPLE_CARRY_TENSION_SLACK_WORLD &&
      canMoveGrappleCarryBlockToward(world, bi, towardPlayerX, towardPlayerY)
    ) {
      const stretchWorld = dist - ropeLength;
      const stretchFactor = Math.min(1, stretchWorld / 24);
      pullGrappleCarryBlockToward(
        world,
        bi,
        towardPlayerX,
        towardPlayerY,
        GRAPPLE_CARRY_TENSION_PULL_SPEED_WORLD_PER_SEC * stretchFactor,
      );
      world.grappleLengthWorld = Math.max(world.grappleLengthWorld, dist - GRAPPLE_CARRY_TENSION_SLACK_WORLD);
      if (quietReleaseRequested) releaseGrapple(world);
      return;
    }
  }

  if (dist > ropeLength) {
    // Target position: player centre on the rope circle.
    const targetX = ax + nx * ropeLength;
    const targetY = ay + ny * ropeLength;
    const deltaX  = targetX - player.positionXWorld;
    const deltaY  = targetY - player.positionYWorld;

    // Move toward the target safely.  moveClusterByDelta uses the same
    // axis-separated sub-stepped sweep as normal movement, so the snap cannot
    // carry the player through solid geometry.  If a wall obstructs the path
    // the player stops at the wall face rather than being clipped inside it.
    // If a bounce pad is contacted, moveClusterByDelta applies the reflected
    // real velocity (based on the swing momentum, not the snap delta), and we
    // release the grapple so the player travels with the bounce trajectory.
    const snapResult = moveClusterByDelta(player, world, deltaX, deltaY, false, dtSec);
    if (snapResult.bounced) {
      // Reflected swing velocity is already on the player cluster (applied by
      // moveClusterByDelta).  Release the grapple so normal movement takes over.
      releaseGrapple(world, false);
      return;
    }

    // Remove outward velocity component (rope can only pull — never push).
    // Use the pre-snap nx/ny direction; the position change is a small
    // correction so the angular error is negligible.
    const velDotN = player.velocityXWorld * nx + player.velocityYWorld * ny;
    if (velDotN > 0) {
      player.velocityXWorld -= velDotN * nx;
      player.velocityYWorld -= velDotN * ny;
    }
  }

  // Movement V2 intentionally applies no passive swing damping. Tangential
  // velocity persists until another gameplay force, collision, or retraction
  // changes it.

  // ── Honor a pending quiet release, now that this tick's retraction and
  // rope-length constraint have both finished updating the player's genuine
  // swing velocity. This is the sole authoritative point for an ordinary
  // release: it preserves full physical velocity (horizontal + vertical) and
  // explicitly excludes any position-only correction — the outward-velocity
  // removal above stays because it is real rope tension, not a fabricated
  // snap-derived velocity.
  if (quietReleaseRequested && world.isGrappleActiveFlag === 1) {
    releaseGrapple(world);
  }
}
