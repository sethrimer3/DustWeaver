/**
 * Environmental hazard simulation logic.
 *
 * Called as step 0.1 in the tick pipeline (after cluster movement, before
 * particle force accumulation).
 *
 * Handles:
 *   - Spike damage + knockback
 *   - Springboard bounce
 *   - Water zone buoyancy flag
 *   - Lava zone damage
 *   - Breakable block destruction
 *   - Crumble block damage/destruction by dust particles
 *   - Dust boost jar breaking
 *   - Firefly jar breaking + firefly AI movement
 *
 * All logic is deterministic — no Math.random, no DOM, no wall-clock time.
 */

import { WorldState, MAX_FIREFLIES, FIREFLIES_PER_JAR, MAX_BREAK_EVENTS } from './world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { nextFloat, nextFloatRange } from './rng';
import { applyPlayerDamageWithKnockback } from './playerDamage';
import { overlapAABB } from './physics/collision';
import { aabbOverlapsWallSolid } from './stairsWorldGeometry';
import {
  PLAYER_WATER_STATE_OUTSIDE,
  PLAYER_WATER_STATE_SUBMERGED,
  PLAYER_WATER_STATE_SURFACE,
  WATER_SUBMERGED_ENTER_RATIO,
  WATER_SUBMERGED_EXIT_RATIO,
  WATER_SURFACE_STATE_TOLERANCE_WORLD,
  computeWaterSkipBounce,
  type PlayerWaterState,
} from './clusters/playerWaterPhysics';
import { MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED } from './momentumCombatConfig';
import { rechargeGrappleCharge } from './clusters/grappleShared';
import {
  checkShieldLiquidSurfaceContact,
  computeShieldLiquidSkipVelocity,
  isPlayerOverlappingLiquidZoneAabb,
  SHIELD_LIQUID_SKIP_MIN_SPEED_X,
} from './stormweave/shieldLiquidSurface';
import { recordShieldImpact } from './stormweave/shieldWeave';
import { traceLaserBeam, distancePointToSegmentWorld, type TerrainRayCallback } from './laserTraceContract';
import { raycastToWallWithNormal } from './clusters/radiantWebBeams';

// ── Constants ────────────────────────────────────────────────────────────────

/** Damage dealt by spikes per contact (with invulnerability cooldown). */
const SPIKE_DAMAGE = 2;
/** Invulnerability ticks after taking spike damage (60 ticks ≈ 1 second). */
const SPIKE_INVULN_TICKS = 60;

/** Damage dealt by a laser beam per contact (with invulnerability cooldown). Matches spike damage. */
const LASER_DAMAGE = 2;
/** Invulnerability ticks after taking laser damage (60 ticks ≈ 1 second). Matches spike invuln. */
const LASER_INVULN_TICKS = 60;
/** Half-thickness of a laser beam's damaging/solid cross-section (world units). */
const LASER_HALF_THICKNESS_WORLD = 3.0;
/** Upper bound for a reflected beam's terrain raycast — generously larger than any room. */
const LASER_MAX_REFLECT_RANGE_WORLD = 8192;

/**
 * Minimum total speed (wu/s) required for a shallow water impact to skip off
 * the surface instead of submerging. Reuses the momentum-combat "invulnerability
 * speed" threshold so a stone-skip always requires attack-grade momentum.
 */
const WATER_SKIP_MIN_SPEED_WORLD = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED;

/** Upward launch speed when bouncing off a springboard (world units/s). */
const SPRINGBOARD_LAUNCH_SPEED_WORLD = 420.0;
/** Animation duration for springboard bounce (ticks). */
const SPRINGBOARD_ANIM_TICKS = 12;

// ── Water physics tuning ─────────────────────────────────────────────────────

/** Damage dealt by lava per contact (with invulnerability cooldown). */
const LAVA_ZONE_DAMAGE = 1;
/** Invulnerability ticks after taking lava damage (30 ticks ≈ 0.5 second). */
const LAVA_ZONE_INVULN_TICKS = 30;

/**
 * Minimum momentum (speed × mass approximation) to break a breakable block.
 * Player mass is implicitly 1.0, so this is effectively a speed threshold.
 * A fast dash-like burst (~373 px/s) should break blocks; normal running
 * (~105 px/s) should not. This is the 'standard' break-resistance tier
 * (Phase 2E) — the name and value are UNCHANGED from pre-Phase-2E so every
 * existing built-in breakable block and every custom fragile block that
 * doesn't set breakResistance keeps byte-identical behavior.
 */
const BREAKABLE_MOMENTUM_THRESHOLD_WORLD = 250.0;

/**
 * Phase 2E break-resistance tiers, chosen from DustWeaver's real movement
 * speed scale (see src/sim/clusters/movementConstants.ts):
 *   - MAX_RUN_SPEED_WORLD_PER_SEC = 105 (legacy top-speed reference; the
 *     current Movement V2 grounded-input target is
 *     GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC = 120)
 *   - an elevated speed tier of ~157.5 (1.3–1.5x normal ground speed —
 *     e.g. a fast direction-reversal skid or momentum carried from a
 *     grapple/bounce)
 *   - GRAPPLE_ZIP_SPEED_WORLD_PER_SEC = 210
 *   - FAST_MAX_FALL_APPROACH_PER_SEC = 300 (fast-dive vertical speed alone;
 *     combined with any horizontal movement the total magnitude comfortably
 *     exceeds 300)
 *
 * 'weak' (150) sits just above that elevated ~157.5 tier so genuinely
 * elevated horizontal speed — not just normal running/walking — reliably
 * breaks a weak block, while ordinary running (105–120) and any
 * resting/low-speed contact never do.
 *
 * 'standard' (250, BREAKABLE_MOMENTUM_THRESHOLD_WORLD) is unchanged.
 *
 * 'reinforced' (350) sits above a fast dive alone (300) but is reachable by
 * combining a fast dive with elevated horizontal/grapple-zip momentum, or a
 * grapple-zip release chained into a dash — i.e. deliberately achievable
 * through normal high-speed DustWeaver mechanics, never impossible.
 */
const BREAKABLE_RESISTANCE_WEAK_THRESHOLD_WORLD = 150.0;
const BREAKABLE_RESISTANCE_REINFORCED_THRESHOLD_WORLD = 350.0;

/**
 * The ONE authoritative place that maps a packed break-resistance tier index
 * (0=weak, 1=standard, 2=reinforced — see breakResistanceToIndex in
 * customBlockProperties.ts) to the momentum threshold a fragile placement
 * must meet to break. No other code path compares resistance tiers directly.
 */
function resolveBreakThresholdWorld(resistanceIndex: number): number {
  switch (resistanceIndex) {
    case 0: return BREAKABLE_RESISTANCE_WEAK_THRESHOLD_WORLD;
    case 2: return BREAKABLE_RESISTANCE_REINFORCED_THRESHOLD_WORLD;
    default: return BREAKABLE_MOMENTUM_THRESHOLD_WORLD; // 1 = standard, and any invalid index falls back safely.
  }
}

/**
 * Phase 2D custom-block contact-damage tiers, matched to the existing
 * low(1)/high(2) damage scale already used throughout the hazard/enemy
 * roster (LAVA_ZONE_DAMAGE = 1, SPIKE_DAMAGE = 2, and the majority of enemy
 * contact-damage constants across src/sim/clusters/*Config.ts). No new
 * damage scale is introduced — these two constants simply give the existing
 * 1/2 tiers stable, engine-owned names for the contact-damage property.
 */
const CUSTOM_BLOCK_CONTACT_DAMAGE_LOW = 1;
const CUSTOM_BLOCK_CONTACT_DAMAGE_HIGH = 2;

/**
 * Destroys one breakable-block cell: deactivates its flag and zeroes its
 * corresponding wall's dimensions (removing collision). Idempotent — calling
 * this on an already-inactive cell would double-clear an already-cleared
 * wall, which is harmless, but callers should guard with the active-flag
 * check to avoid redundant work (see the Phase 2B group-destroy loop above).
 * Shared by both the single-cell path and the Phase 2B multi-cell group path
 * so there is exactly one place that mutates breakable-block/wall state.
 */
function destroyBreakableBlockCell(world: WorldState, index: number): void {
  world.isBreakableBlockActiveFlag[index] = 0;
  const wi = world.breakableBlockWallIndex[index];
  if (wi >= 0 && wi < world.wallCount) {
    world.wallWWorld[wi] = 0;
    world.wallHWorld[wi] = 0;
  }
  // Phase 2D: a fragile+damaging block that is destroyed must stop damaging
  // the player — deactivate any contact-damage cell at the same world
  // position. Matched by position (like customBlockGameplayRenderer.ts's
  // isFragilePlacementBroken) rather than a shared index, since the
  // breakable and contact-damage arrays are independently populated and
  // sized. A tiny epsilon guards against float accumulation; cell centers
  // are computed identically in gameRoomHazards.ts so an exact match is
  // the common case.
  const xWorld = world.breakableBlockXWorld[index];
  const yWorld = world.breakableBlockYWorld[index];
  for (let ci = 0; ci < world.contactDamageBlockCount; ci++) {
    if (world.isContactDamageBlockActiveFlag[ci] === 0) continue;
    if (Math.abs(world.contactDamageBlockXWorld[ci] - xWorld) < 0.5 &&
        Math.abs(world.contactDamageBlockYWorld[ci] - yWorld) < 0.5) {
      world.isContactDamageBlockActiveFlag[ci] = 0;
    }
  }

  // Phase 2F: a fragile windbreak/dampener must stop attenuating wind the
  // moment it breaks. `destroyBreakableBlockCell` runs inside `applyHazards`,
  // which the tick pipeline calls AFTER this tick's wind application and
  // pixel-material step (see tick.ts) — clearing here takes effect starting
  // the NEXT tick's `applyWindForce` calls, exactly the same documented
  // one-tick lag already accepted for the analogous solid-mask sync (see
  // pixelMaterialSolidSync.ts). Only this cell's own native-pixel rect is
  // cleared — a targeted region, not a full room-mask rebuild — matching
  // that same file's "cheap, bounded, not a full rescan" precedent. Each
  // breakable-block cell is exactly one grid block (even 2x2 fragile custom
  // blocks decompose into 4 independent 1x1 cells — see the class doc
  // comment on `RoomBreakableBlockDef`), so a single BLOCK_SIZE_MEDIUM
  // square centered at (xWorld, yWorld) is always this cell's exact
  // footprint.
  if (world.breakableBlockWindTier[index] !== 0) {
    const windMask = world.pixelMaterialSystem.windMask;
    if (windMask !== null) {
      const half = BLOCK_SIZE_MEDIUM * 0.5;
      windMask.clearRect(xWorld - half, yWorld - half, xWorld + half, yWorld + half);
    }
  }

  // Phase 2G: a fragile seal/drain block must stop sealing/draining pixel-
  // material liquid the moment it breaks — same one-tick-lag/targeted-region
  // precedent as the wind-mask clear above (this runs inside `applyHazards`,
  // which the tick pipeline calls after this tick's liquid step — see
  // tick.ts — so the clear takes effect starting the NEXT tick). Each
  // breakable-block cell is exactly one grid block (even 2x2 fragile custom
  // blocks decompose into 4 independent 1x1 cells), so a single
  // BLOCK_SIZE_MEDIUM square centered at (xWorld, yWorld) is always this
  // cell's exact footprint.
  if (world.breakableBlockLiquidTier[index] !== 0) {
    const liquidMask = world.pixelMaterialSystem.liquidMask;
    if (liquidMask !== null) {
      const half = BLOCK_SIZE_MEDIUM * 0.5;
      liquidMask.clearRect(xWorld - half, yWorld - half, xWorld + half, yWorld + half);
    }
  }

  // Phase 2H: a fragile wind-vent block must stop emitting the moment it
  // breaks. Uses an explicit runtime OWNERSHIP LINK (the index resolved once
  // at hazard-load time in gameRoomHazards.ts), not a position-matching scan
  // — so all four cells of a grouped 2x2 fragile vent (which all carry the
  // SAME `breakableBlockWindVentIndex`) independently but idempotently
  // deactivate the one shared logical vent, and contacting/destroying any of
  // them never produces more than one deactivation. `applyCustomBlockWindVents`
  // (called earlier this tick, before this hazard pass — see tick.ts) already
  // emitted this tick's impulse before the vent was destroyed, so — exactly
  // like the wind/liquid mask clears above — this takes effect starting the
  // NEXT tick, not retroactively.
  const windVentIndex = world.breakableBlockWindVentIndex[index];
  if (windVentIndex >= 0 && windVentIndex < world.windVentCount) {
    world.windVentActiveFlag[windVentIndex] = 0;
  }
}

/**
 * Records one break event for the render layer to consume (Phase 2C).
 *
 * This is the ONLY place that pushes to the break-event queue — it is called
 * exactly once per destroyed LOGICAL placement (once for a 1x1 cell, once for
 * a complete 2x2 group), never once per cell. Bounded by MAX_BREAK_EVENTS;
 * silently drops overflow events since they are purely cosmetic (sound +
 * particles) and never affect collision, damage, or persistence.
 */
function emitBreakEvent(
  world: WorldState,
  centerXWorld: number,
  centerYWorld: number,
  widthWorld: number,
  heightWorld: number,
  material: number,
  groupId: number,
  isGrouped: boolean,
): void {
  if (world.breakEventCount >= MAX_BREAK_EVENTS) return;
  const ei = world.breakEventCount++;
  world.breakEventXWorld[ei] = centerXWorld;
  world.breakEventYWorld[ei] = centerYWorld;
  world.breakEventWWorld[ei] = widthWorld;
  world.breakEventHWorld[ei] = heightWorld;
  world.breakEventMaterial[ei] = material;
  world.breakEventGroupId[ei] = groupId;
  world.breakEventIsGroupedFlag[ei] = isGrouped ? 1 : 0;
}

/** Interaction radius for jars (world units). */
const JAR_INTERACT_RADIUS_WORLD = 10.0;

/**
 * Number of ticks to wait between hits on the same crumble block.
 * Prevents a single fast-moving particle stream from consuming multiple hits.
 * At 60 ticks/s this gives a ~0.5 s window.
 */
const CRUMBLE_HIT_COOLDOWN_TICKS = 30;

/** Firefly wander speed (world units/s). */
const FIREFLY_SPEED_WORLD = 30.0;
/** Firefly direction change interval (ticks). */
const FIREFLY_DIRECTION_CHANGE_TICKS = 90;
/** Margin from world edges for firefly clamping (world units). */
const FIREFLY_EDGE_MARGIN_WORLD = 12.0;

/** Half-size of a springboard hitbox in world units. */
const SPRINGBOARD_HALF_WIDTH_WORLD = BLOCK_SIZE_MEDIUM * 0.5;
const SPRINGBOARD_HALF_HEIGHT_WORLD = BLOCK_SIZE_MEDIUM * 0.25;

// ── Spike direction encoding ─────────────────────────────────────────────────
export const SPIKE_DIR_UP = 0;
export const SPIKE_DIR_DOWN = 1;
export const SPIKE_DIR_LEFT = 2;
export const SPIKE_DIR_RIGHT = 3;

/**
 * Bounces a firefly along one axis: clamps `pos` to [min, max] and reflects
 * `vel` so the firefly always moves away from whichever edge it hit.
 */
function bounceAxis(
  pos: number, vel: number, min: number, max: number,
): { pos: number; vel: number } {
  if (pos < min) return { pos: min, vel: Math.abs(vel) };
  if (pos > max) return { pos: max, vel: -Math.abs(vel) };
  return { pos, vel };
}

/**
 * Pre-computes player water state (AABB overlap + submersion ratio) before
 * applyClusterMovement so that playerMovement reads the correct flag for this tick.
 * applyHazards() re-runs the same detection to apply buoyancy/drag physics.
 *
 * Uses AABB overlap instead of center-point: entry fires when the player's
 * feet first break the water surface.
 */
function updatePlayerWaterDetection(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) {
    world.isPlayerInWaterFlag = 0;
    world.playerWaterState = PLAYER_WATER_STATE_OUTSIDE;
    world.playerWaterZoneIndex = -1;
    world.playerWaterSubmersionRatio = 0;
    world.playerBuoyancySurfaceYWorld = 0;
    world.playerBuoyancyDepthFactor = 0;
    return;
  }

  const previousState = world.playerWaterState;
  const previousZoneIndex = world.playerWaterZoneIndex;
  const pLeft = player.positionXWorld - player.halfWidthWorld;
  const pRight = player.positionXWorld + player.halfWidthWorld;
  const pTop = player.positionYWorld - player.halfHeightWorld;
  const pBottom = player.positionYWorld + player.halfHeightWorld;
  const playerHeight = player.halfHeightWorld * 2;

  let bestZoneIndex = -1;
  let bestSubmersion = 0;
  let bestSurfaceYWorld = 0;

  for (let i = 0; i < world.waterZoneCount; i++) {
    if (world.frozenWaterZoneMask[i] === 1) continue;
    const wLeft = world.waterZoneXWorld[i];
    const wTop = world.waterZoneYWorld[i];
    const wRight = wLeft + world.waterZoneWWorld[i];
    const wBottom = wTop + world.waterZoneHWorld[i];
    if (pRight <= wLeft || pLeft >= wRight || pTop >= wBottom) continue;

    const overlaps = pBottom > wTop;
    const retainsSurfaceContact = previousState !== PLAYER_WATER_STATE_OUTSIDE
      && i === previousZoneIndex
      && pBottom >= wTop - WATER_SURFACE_STATE_TOLERANCE_WORLD
      && pBottom <= wTop + WATER_SURFACE_STATE_TOLERANCE_WORLD;
    if (!overlaps && !retainsSurfaceContact) continue;

    const overlapTop = Math.max(pTop, wTop);
    const overlapBottom = Math.min(pBottom, wBottom);
    const overlapHeight = Math.max(0, overlapBottom - overlapTop);
    const submersion = playerHeight > 0.1
      ? Math.min(1, overlapHeight / playerHeight)
      : 0;
    if (bestZoneIndex < 0 || submersion > bestSubmersion) {
      bestZoneIndex = i;
      bestSubmersion = submersion;
      bestSurfaceYWorld = wTop;
    }
  }

  if (bestZoneIndex < 0) {
    world.isPlayerInWaterFlag = 0;
    world.playerWaterState = PLAYER_WATER_STATE_OUTSIDE;
    world.playerWaterZoneIndex = -1;
    world.playerWaterSubmersionRatio = 0;
    world.playerBuoyancySurfaceYWorld = 0;
    world.playerBuoyancyDepthFactor = 0;
    return;
  }

  const remainsSubmerged = previousState === PLAYER_WATER_STATE_SUBMERGED
    && bestZoneIndex === previousZoneIndex;
  const submergedThreshold = remainsSubmerged
    ? WATER_SUBMERGED_EXIT_RATIO
    : WATER_SUBMERGED_ENTER_RATIO;
  const nextState: PlayerWaterState = bestSubmersion >= submergedThreshold
    ? PLAYER_WATER_STATE_SUBMERGED
    : PLAYER_WATER_STATE_SURFACE;

  world.isPlayerInWaterFlag = 1;
  world.playerWaterState = nextState;
  world.playerWaterZoneIndex = bestZoneIndex;
  world.playerWaterSubmersionRatio = bestSubmersion;
  world.playerBuoyancySurfaceYWorld = bestSurfaceYWorld;
  world.playerBuoyancyDepthFactor = bestSubmersion;
}

export function computePlayerWaterState(world: WorldState): void {
  updatePlayerWaterDetection(world);
  const player = world.clusters[0];
  if (player !== undefined) {
    world.playerWaterPreMovementBottomYWorld = player.positionYWorld + player.halfHeightWorld;
  }
}

/**
 * Resets the shield liquid-surface contact latch — call on room load, player
 * death/respawn, shield release, or loss of all motes to ensure the next
 * surface approach fires a fresh skip rather than being suppressed.
 *
 * This is deliberately separate from resetShieldWeaveState (which owns only
 * the shield arc geometry/mote state) so the hazard module controls its own
 * latch lifecycle without coupling shieldWeave.ts to HazardWorldState.
 */
export function resetShieldLiquidContactLatch(world: WorldState): void {
  world.shieldLiquidContactLatchFlag = 0;
  world.shieldLiquidContactLatchZoneIndex = -1;
  world.shieldLiquidContactLatchKind = 0;
}

/**
 * Main hazard update — called once per tick after cluster movement.
 */
export function applyHazards(world: WorldState): void {
  // Phase 2C: break events are a one-tick queue — always reset at the top so a
  // stale event from a previous tick can never be double-processed by the
  // render layer, even on the early-return path below.
  world.breakEventCount = 0;

  const dtSec = world.dtMs / 1000.0;
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;

  const px = player.positionXWorld;
  const py = player.positionYWorld;
  const phw = player.halfWidthWorld;
  const phh = player.halfHeightWorld;

  // ── Tick down invulnerability timers ──────────────────────────────────────
  if (world.spikeInvulnTicks > 0) world.spikeInvulnTicks -= 1;
  if (world.laserInvulnTicks > 0) world.laserInvulnTicks -= 1;
  if (world.lavaInvulnTicks > 0) world.lavaInvulnTicks -= 1;

  // ── Springboard anim countdowns ──────────────────────────────────────────
  for (let i = 0; i < world.springboardCount; i++) {
    if (world.springboardAnimTicks[i] > 0) world.springboardAnimTicks[i] -= 1;
  }

  // ── Spikes ───────────────────────────────────────────────────────────────
  // Only the half of the spike's footprint nearest its base (i.e. opposite the
  // pointed tip) is damaging — for an upward spike that's the bottom half
  // (bottom 4px of a 1×1 spike, bottom 8px of a 2×2 spike). This keeps a
  // shallow graze of the thin tip from registering as a hit; the player must
  // be overlapping the thicker base region to actually take damage.
  if (world.spikeInvulnTicks === 0) {
    for (let i = 0; i < world.spikeCount; i++) {
      // A crumble spike whose linked crumble-block record has already been
      // broken (isCrumbleBlockActiveFlag === 0) is fully inert — no damage,
      // no further contact checks — matching how a destroyed crumble wall's
      // wallWWorld/wallHWorld are zeroed so the collision sweep ignores it.
      const crumbleIdx = world.spikeCrumbleBlockIndex[i];
      if (crumbleIdx >= 0 && world.isCrumbleBlockActiveFlag[crumbleIdx] === 0) continue;

      const sx = world.spikeXWorld[i];
      const sy = world.spikeYWorld[i];
      const sizeBlocks = world.spikeSizeBlocks[i] || 1;
      const half = sizeBlocks * BLOCK_SIZE_MEDIUM * 0.5;
      const sLeft = sx - half;
      const sRight = sx + half;
      const sTop = sy - half;
      const sBottom = sy + half;

      // Restrict the hazard AABB to the base half, opposite the tip direction.
      let hazLeft = sLeft, hazRight = sRight, hazTop = sTop, hazBottom = sBottom;
      switch (world.spikeDirection[i]) {
        case SPIKE_DIR_UP:    hazTop = sy;    break; // tip up    → base is bottom half
        case SPIKE_DIR_DOWN:  hazBottom = sy; break; // tip down  → base is top half
        case SPIKE_DIR_LEFT:  hazLeft = sx;   break; // tip left  → base is right half
        case SPIKE_DIR_RIGHT: hazRight = sx;  break; // tip right → base is left half
      }

      if (overlapAABB(px, py, phw, phh, hazLeft, hazTop, hazRight, hazBottom)) {
        // A crumble spike breaks (no damage) when the player meets the same
        // momentum-attack break requirement used by the momentum-shatter path
        // for crumble walls (crackedBlockShatter.ts / movementAxisResolvers.ts
        // — cluster.isHighVelocityAttacking). Casual contact still deals
        // normal spike damage exactly like a non-crumble spike.
        if (crumbleIdx >= 0 && player.isHighVelocityAttacking === 1) {
          world.isCrumbleBlockActiveFlag[crumbleIdx] = 0;
          world.crumbleBlockHitsRemaining[crumbleIdx] = 0;
          break; // one spike interaction per tick
        }

        const sourceXWorld = sx;
        const sourceYWorld = sy;
        // Throw the player back the way they came: reverse their velocity
        // vector and halve its magnitude, so the damage/knockback blend below
        // starts from a bounce-back rather than the incoming momentum.
        player.velocityXWorld = -player.velocityXWorld * 0.5;
        player.velocityYWorld = -player.velocityYWorld * 0.5;
        applyPlayerDamageWithKnockback(player, SPIKE_DAMAGE, sourceXWorld, sourceYWorld);
        world.spikeInvulnTicks = SPIKE_INVULN_TICKS;
        break; // one spike hit per tick
      }
    }
  }

  // ── Lasers ───────────────────────────────────────────────────────────────
  // The unobstructed beam length is solid (collision comes from the wall
  // added at load time — see loadRoomHazards) exactly like before. Every
  // tick, each beam is re-traced against the current Shield Weave arc (see
  // laserTraceContract.ts): if the shield is active, has at least one mote,
  // and its real curved surface intersects the beam before the terrain hit,
  // the beam reflects exactly once off that surface using the standard
  // reflection equation. Contact/segment results are stored per-tick for the
  // renderer; damage checks use segment-distance (not AABB) so an angled
  // reflected segment is checked accurately.
  const terrainRay: TerrainRayCallback = (ox, oy, dx, dy, maxRange) =>
    raycastToWallWithNormal(world, ox, oy, dx, dy, maxRange);
  const shieldGeometry = world.shieldWeave.isActive ? world.shieldWeave : undefined;
  const playerHitRadius = Math.max(phw, phh);

  for (let i = 0; i < world.laserCount; i++) {
    const lx = world.laserXWorld[i];
    const ly = world.laserYWorld[i];
    const length = world.laserLengthWorld[i];
    let dirXWorld = 0, dirYWorld = 0;
    switch (world.laserDirection[i]) {
      case SPIKE_DIR_UP:    dirXWorld = 0;  dirYWorld = -1; break;
      case SPIKE_DIR_DOWN:  dirXWorld = 0;  dirYWorld = 1;  break;
      case SPIKE_DIR_LEFT:  dirXWorld = -1; dirYWorld = 0;  break;
      default: /* SPIKE_DIR_RIGHT */ dirXWorld = 1; dirYWorld = 0; break;
    }

    const trace = traceLaserBeam(lx, ly, dirXWorld, dirYWorld, length, shieldGeometry, terrainRay, LASER_MAX_REFLECT_RANGE_WORLD);

    world.laserIncomingEndXWorld[i] = trace.incoming.endXWorld;
    world.laserIncomingEndYWorld[i] = trace.incoming.endYWorld;
    if (trace.hasReflection && trace.reflection !== null) {
      world.laserHasReflectionFlag[i] = 1;
      world.laserContactXWorld[i] = trace.reflection.contactXWorld;
      world.laserContactYWorld[i] = trace.reflection.contactYWorld;
      world.laserOutgoingStartXWorld[i] = trace.reflection.outgoing.startXWorld;
      world.laserOutgoingStartYWorld[i] = trace.reflection.outgoing.startYWorld;
      world.laserOutgoingEndXWorld[i] = trace.reflection.outgoing.endXWorld;
      world.laserOutgoingEndYWorld[i] = trace.reflection.outgoing.endYWorld;
      recordShieldImpact(world.shieldWeave, trace.reflection.contactXWorld, trace.reflection.contactYWorld);
    } else {
      world.laserHasReflectionFlag[i] = 0;
    }

    if (world.laserInvulnTicks > 0) continue;

    const hitRadius = LASER_HALF_THICKNESS_WORLD + playerHitRadius;
    const incomingDistance = distancePointToSegmentWorld(
      px, py, trace.incoming.startXWorld, trace.incoming.startYWorld, trace.incoming.endXWorld, trace.incoming.endYWorld,
    );
    let hitXWorld = trace.incoming.endXWorld;
    let hitYWorld = trace.incoming.endYWorld;
    let hit = incomingDistance <= hitRadius;

    // A reflected beam's incoming leg never damages the player through the
    // shield (the shield is the terminus of that leg); only the outgoing
    // reflected leg — starting a small epsilon beyond the contact point — can.
    if (trace.hasReflection && trace.reflection !== null) {
      hit = false;
      const outgoingDistance = distancePointToSegmentWorld(
        px, py,
        trace.reflection.outgoing.startXWorld, trace.reflection.outgoing.startYWorld,
        trace.reflection.outgoing.endXWorld, trace.reflection.outgoing.endYWorld,
      );
      if (outgoingDistance <= hitRadius) {
        hit = true;
        hitXWorld = trace.reflection.outgoing.startXWorld;
        hitYWorld = trace.reflection.outgoing.startYWorld;
      }
    }

    if (hit) {
      applyPlayerDamageWithKnockback(player, LASER_DAMAGE, hitXWorld, hitYWorld);
      world.laserInvulnTicks = LASER_INVULN_TICKS;
      break; // one laser hit per tick
    }
  }

  // ── Springboards ─────────────────────────────────────────────────────────
  // Only trigger when player is falling and lands on the springboard's top face.
  if (player.velocityYWorld >= 0) {
    for (let i = 0; i < world.springboardCount; i++) {
      const sbx = world.springboardXWorld[i];
      const sby = world.springboardYWorld[i];
      const sbLeft = sbx - SPRINGBOARD_HALF_WIDTH_WORLD;
      const sbRight = sbx + SPRINGBOARD_HALF_WIDTH_WORLD;
      const sbTop = sby - SPRINGBOARD_HALF_HEIGHT_WORLD;

      // Check if player bottom is near springboard top and horizontally aligned
      const playerBottom = py + phh;
      const playerLeft = px - phw;
      const playerRight = px + phw;

      if (
        playerBottom >= sbTop && playerBottom <= sbTop + 4.0 &&
        playerRight > sbLeft && playerLeft < sbRight
      ) {
        // Bounce!
        player.velocityYWorld = -SPRINGBOARD_LAUNCH_SPEED_WORLD;
        player.isGroundedFlag = 0;
        player.varJumpTimerTicks = 0; // no variable jump sustain from spring
        world.springboardAnimTicks[i] = SPRINGBOARD_ANIM_TICKS;
        break;
      }
    }
  }

  // ── Water zones ──────────────────────────────────────────────────────────
  // Water forces were applied in playerMovement before integration. Refresh
  // contact after collision resolution and publish upper-surface transitions
  // as a one-record sequence for the cosmetic ripple system.
  const preMovementWaterState = world.playerWaterState;
  const preMovementSurfaceYWorld = world.playerBuoyancySurfaceYWorld;
  updatePlayerWaterDetection(world);

  const currentBottomYWorld = player.positionYWorld + player.halfHeightWorld;
  const enteredThroughTop = preMovementWaterState === PLAYER_WATER_STATE_OUTSIDE
    && world.playerWaterState !== PLAYER_WATER_STATE_OUTSIDE
    && player.velocityYWorld > 0
    && world.playerWaterPreMovementBottomYWorld <= world.playerBuoyancySurfaceYWorld
      + WATER_SURFACE_STATE_TOLERANCE_WORLD
    && currentBottomYWorld > world.playerBuoyancySurfaceYWorld;
  const exitedThroughTop = preMovementWaterState !== PLAYER_WATER_STATE_OUTSIDE
    && world.playerWaterState === PLAYER_WATER_STATE_OUTSIDE
    && player.velocityYWorld < 0
    && world.playerWaterPreMovementBottomYWorld >= preMovementSurfaceYWorld
      - WATER_SURFACE_STATE_TOLERANCE_WORLD
    && currentBottomYWorld < preMovementSurfaceYWorld
      + WATER_SURFACE_STATE_TOLERANCE_WORLD;

  // Capture the impact velocity before any skip bounce rewrites it, so the
  // splash event and entry-speed readout always reflect the actual impact.
  const entryVelocityXWorld = player.velocityXWorld;
  const entryVelocityYWorld = player.velocityYWorld;

  if (enteredThroughTop || exitedThroughTop) {
    world.playerWaterSurfaceEventSequence += 1;
    world.playerWaterSurfaceEventKind = enteredThroughTop ? 1 : 2;
    world.playerWaterSurfaceEventXWorld = player.positionXWorld;
    world.playerWaterSurfaceEventYWorld = enteredThroughTop
      ? world.playerBuoyancySurfaceYWorld
      : preMovementSurfaceYWorld;
    world.playerWaterSurfaceEventVelocityXWorld = entryVelocityXWorld;
    world.playerWaterSurfaceEventVelocityYWorld = entryVelocityYWorld;
  }

  world.playerWaterEntrySpeedWorld = enteredThroughTop
    ? Math.hypot(entryVelocityXWorld, entryVelocityYWorld)
    : 0;

  // ── Shield Weave water surfing ───────────────────────────────────────────
  // When the shield crescent contacts the water's exposed top surface from
  // above, directly below the player, with sufficient horizontal speed, the
  // player skips off the surface. This takes priority over and prevents the
  // ordinary stone-skip below from also firing in the same tick.
  let shieldWaterSkipFired = false;
  if (world.isPlayerInWaterFlag === 1 && world.playerWaterZoneIndex >= 0) {
    const wzi = world.playerWaterZoneIndex;
    const wLeft = world.waterZoneXWorld[wzi];
    const wTop = world.waterZoneYWorld[wzi];
    const wRight = wLeft + world.waterZoneWWorld[wzi];
    const playerBottom = player.positionYWorld + player.halfHeightWorld;

    // Shield must be active and |vx| strictly > threshold.
    const shieldIsActive = world.shieldWeave.isActive && world.shieldWeave.moteCount >= 1;
    const absVx = Math.abs(entryVelocityXWorld);
    const approachingContact = entryVelocityYWorld >= -SHIELD_LIQUID_SKIP_MIN_SPEED_X;

    // Latch-separation check: if the latch is set for this same zone, check
    // whether the shield is still touching. If not, clear the latch so the
    // next approach can fire.
    if (
      world.shieldLiquidContactLatchFlag === 1 &&
      world.shieldLiquidContactLatchKind === 1 &&
      world.shieldLiquidContactLatchZoneIndex === wzi
    ) {
      // Latch clears when the player's AABB no longer overlaps the zone at all
      // (player has escaped). Using AABB overlap (not arc-band proximity) avoids
      // false-separation when the arc is submerged past the surface band.
      // Additionally, the latch clears immediately if the shield deactivates.
      const stillInZone = shieldIsActive && isPlayerOverlappingLiquidZoneAabb(
        player.positionXWorld, player.halfWidthWorld,
        player.positionYWorld, player.halfHeightWorld,
        wLeft, wTop, wRight, wTop + world.waterZoneHWorld[wzi],
      );
      if (!stillInZone) {
        world.shieldLiquidContactLatchFlag = 0;
        world.shieldLiquidContactLatchZoneIndex = -1;
        world.shieldLiquidContactLatchKind = 0;
      }
    }

    // Only attempt a skip when: shield active, speed qualifies, not already
    // latched to this zone (persistent overlap suppression), not frozen water.
    if (
      shieldIsActive &&
      absVx > SHIELD_LIQUID_SKIP_MIN_SPEED_X &&
      approachingContact &&
      world.frozenWaterZoneMask[wzi] === 0 &&
      !(world.shieldLiquidContactLatchFlag === 1 &&
        world.shieldLiquidContactLatchKind === 1 &&
        world.shieldLiquidContactLatchZoneIndex === wzi)
    ) {
      // When the arc doesn't directly sample the surface band but the player
      // entered through the top this tick (high-speed tunnel), also attempt.
      // This ensures the skip fires even when the player crossed the surface
      // in a single frame without the arc sitting in the ±2px surface band.
      let contact = checkShieldLiquidSurfaceContact(
        world.shieldWeave,
        wLeft, wTop, wRight,
        player.positionXWorld, player.halfWidthWorld, playerBottom,
        entryVelocityYWorld,
        'water', wzi,
      );
      // Swept-entry fallback: if enteredThroughTop and arc didn't detect
      if (contact === null && enteredThroughTop) {
        contact = {
          xWorld: player.positionXWorld,
          yWorld: wTop,
          normalX: 0,
          normalY: -1,
          liquidKind: 'water',
          zoneIndex: wzi,
        };
      }
      if (contact !== null) {
        // Apply the shield-liquid skip velocity using the pre-friction incoming vx.
        const skipVel = computeShieldLiquidSkipVelocity(entryVelocityXWorld);
        player.velocityXWorld = skipVel.velocityXWorld;
        player.velocityYWorld = skipVel.velocityYWorld;

        // Keep the player out of the water this tick.
        world.isPlayerInWaterFlag = 0;
        world.playerWaterState = PLAYER_WATER_STATE_OUTSIDE;
        world.playerWaterZoneIndex = -1;
        world.playerWaterSubmersionRatio = 0;

        // Emit a water-skip event so existing spray VFX can respond.
        world.playerWaterSkipEventSequence += 1;
        world.playerWaterSkipEventXWorld = player.positionXWorld;
        world.playerWaterSkipEventYWorld = contact.yWorld;
        world.playerWaterSkipEventVelocityXWorld = entryVelocityXWorld;
        world.playerWaterSkipEventVelocityYWorld = entryVelocityYWorld;

        // Latch: suppress re-triggering on persistent overlap.
        world.shieldLiquidContactLatchFlag = 1;
        world.shieldLiquidContactLatchZoneIndex = wzi;
        world.shieldLiquidContactLatchKind = 1;

        shieldWaterSkipFired = true;
      }
    }
  } else if (world.shieldLiquidContactLatchKind === 1) {
    // Player left all water zones — clear water latch unconditionally.
    world.shieldLiquidContactLatchFlag = 0;
    world.shieldLiquidContactLatchZoneIndex = -1;
    world.shieldLiquidContactLatchKind = 0;
  }

  // ── Water skip (stone-skip bounce) ─────────────────────────────────────
  // A shallow, fast impact skips off the surface like a thrown stone rather
  // than submerging: the vertical velocity flips upward and the player never
  // actually enters the water this tick.
  // Excluded when a shield water skip already fired this tick (they must not
  // both apply in the same tick).
  if (enteredThroughTop && !shieldWaterSkipFired) {
    const bounce = computeWaterSkipBounce(
      entryVelocityXWorld,
      entryVelocityYWorld,
      WATER_SKIP_MIN_SPEED_WORLD,
    );
    if (bounce.skip) {
      player.velocityYWorld = bounce.velocityYWorld;
      world.isPlayerInWaterFlag = 0;
      world.playerWaterState = PLAYER_WATER_STATE_OUTSIDE;
      world.playerWaterZoneIndex = -1;
      world.playerWaterSubmersionRatio = 0;

      world.playerWaterSkipEventSequence += 1;
      world.playerWaterSkipEventXWorld = player.positionXWorld;
      world.playerWaterSkipEventYWorld = world.playerWaterSurfaceEventYWorld;
      world.playerWaterSkipEventVelocityXWorld = entryVelocityXWorld;
      world.playerWaterSkipEventVelocityYWorld = entryVelocityYWorld;
    }
  }

  // ── Grapple recharge at water surface ───────────────────────────────────
  // When overlapping a non-frozen water zone with any part of the player
  // hitbox above that zone's top surface, restore grapple charge.
  if (
    world.isPlayerInWaterFlag === 1 &&
    world.playerWaterZoneIndex >= 0 &&
    world.frozenWaterZoneMask[world.playerWaterZoneIndex] === 0 &&
    player.positionYWorld - player.halfHeightWorld < world.playerBuoyancySurfaceYWorld
  ) {
    rechargeGrappleCharge(world);
  }

  world.isPlayerWasInWaterLastTickFlag = world.isPlayerInWaterFlag;

  // ── Lava zones ───────────────────────────────────────────────────────────
  // Shield Weave lava surfing: when the shield crescent contacts the lava's
  // exposed top surface from above with sufficient horizontal speed, the player
  // skips off and lava damage for that contact is suppressed. The shield must
  // be aimed such that the crescent is directly below the player (not sideways
  // or upward). A shield that only contacts the lava's side, bottom, or
  // interior does not provide lava immunity.
  {
    const shieldIsActive = world.shieldWeave.isActive && world.shieldWeave.moteCount >= 1;

    // Latch-separation: if latched to a lava zone, check whether the shield
    // is still touching. If not, clear the latch.
    if (
      world.shieldLiquidContactLatchFlag === 1 &&
      world.shieldLiquidContactLatchKind === 2
    ) {
      const lzi = world.shieldLiquidContactLatchZoneIndex;
      let stillInZone = false;
      if (lzi >= 0 && lzi < world.lavaZoneCount) {
        const lLeft = world.lavaZoneXWorld[lzi];
        const lTop = world.lavaZoneYWorld[lzi];
        const lRight = lLeft + world.lavaZoneWWorld[lzi];
        const lBottom = lTop + world.lavaZoneHWorld[lzi];
        stillInZone = shieldIsActive && isPlayerOverlappingLiquidZoneAabb(
          player.positionXWorld, player.halfWidthWorld,
          player.positionYWorld, player.halfHeightWorld,
          lLeft, lTop, lRight, lBottom,
        );
      }
      if (!stillInZone) {
        world.shieldLiquidContactLatchFlag = 0;
        world.shieldLiquidContactLatchZoneIndex = -1;
        world.shieldLiquidContactLatchKind = 0;
      }
    }

    for (let i = 0; i < world.lavaZoneCount; i++) {
      const lLeft = world.lavaZoneXWorld[i];
      const lTop = world.lavaZoneYWorld[i];
      const lRight = lLeft + world.lavaZoneWWorld[i];
      const lBottom = lTop + world.lavaZoneHWorld[i];

      if (!overlapAABB(px, py, phw, phh, lLeft, lTop, lRight, lBottom)) continue;

      // Check whether the shield qualifies for a lava surface skip for this zone.
      const absVx = Math.abs(player.velocityXWorld);
      const movingTowardSurface = player.velocityYWorld >= -SHIELD_LIQUID_SKIP_MIN_SPEED_X;
      const notLatched = !(world.shieldLiquidContactLatchFlag === 1 &&
        world.shieldLiquidContactLatchKind === 2 &&
        world.shieldLiquidContactLatchZoneIndex === i);

      if (
        shieldIsActive &&
        absVx > SHIELD_LIQUID_SKIP_MIN_SPEED_X &&
        movingTowardSurface &&
        notLatched
      ) {
        const playerBottom = player.positionYWorld + player.halfHeightWorld;
        // Capture incoming vx before any modification.
        const incomingVx = player.velocityXWorld;
        // Primary: arc-band contact check
        let contact = checkShieldLiquidSurfaceContact(
          world.shieldWeave,
          lLeft, lTop, lRight,
          player.positionXWorld, player.halfWidthWorld, playerBottom,
          player.velocityYWorld,
          'lava', i,
        );
        // Swept fallback: if the arc didn't directly sample the surface band but
        // the player just entered from above AND the shield is aimed in the
        // downward semicircle (sin(directionAngle) > 0, i.e. the crescent faces
        // downward), treat the player footprint center as the contact point.
        // Shields aimed sideways (sin ≈ 0) or upward (sin < 0) do not qualify.
        if (contact === null) {
          const shieldSinDir = Math.sin(world.shieldWeave.directionAngleRad);
          if (
            shieldSinDir > 0 &&
            playerBottom >= lTop &&
            playerBottom <= lTop + player.halfHeightWorld
          ) {
            contact = {
              xWorld: player.positionXWorld,
              yWorld: lTop,
              normalX: 0,
              normalY: -1,
              liquidKind: 'lava',
              zoneIndex: i,
            };
          }
        }
        if (contact !== null) {
          // Apply skip velocity using the pre-friction incoming vx.
          const skipVel = computeShieldLiquidSkipVelocity(incomingVx);
          player.velocityXWorld = skipVel.velocityXWorld;
          player.velocityYWorld = skipVel.velocityYWorld;

          // Record a shield impact at the contact point for impact VFX.
          recordShieldImpact(world.shieldWeave, contact.xWorld, contact.yWorld);

          // Latch: suppress re-triggering on persistent overlap.
          world.shieldLiquidContactLatchFlag = 1;
          world.shieldLiquidContactLatchZoneIndex = i;
          world.shieldLiquidContactLatchKind = 2;

          // Lava damage is suppressed for this qualifying shield contact.
          break;
        }
      }

      if (world.lavaInvulnTicks === 0) {
        // Shield did not qualify — apply ordinary lava damage.
        const sourceXWorld = Math.max(lLeft, Math.min(px, lRight));
        const sourceYWorld = Math.max(lTop, Math.min(py, lBottom));
        applyPlayerDamageWithKnockback(player, LAVA_ZONE_DAMAGE, sourceXWorld, sourceYWorld);
        world.lavaInvulnTicks = LAVA_ZONE_INVULN_TICKS;
        break;
      }
    }
  }

  // Captured BEFORE the contact-damage section below so the breakable-block
  // momentum-threshold check (further down) reflects the player's actual
  // incoming speed, not the post-knockback velocity that
  // applyPlayerDamageWithKnockback may have just blended in. Without this, a
  // fragile+damaging block's own contact-damage knockback could sap enough
  // momentum to make the SAME hit fail the break threshold immediately
  // afterward, silently preventing fragile+damaging blocks from ever
  // breaking. Spikes/springboards/water/lava run before this point and can
  // still affect this captured speed — that ordering is unchanged from
  // pre-Phase-2D behavior.
  const playerSpeedBeforeContactDamage = Math.sqrt(
    player.velocityXWorld * player.velocityXWorld +
    player.velocityYWorld * player.velocityYWorld,
  );

  // ── Custom block contact damage (Phase 2D) ──────────────────────────────
  // Runs BEFORE the breakable-block section below so a fragile+damaging
  // block applies its contact damage first, then (independently, subject to
  // its own momentum threshold) is destroyed in the same tick — matching the
  // documented ordering. Damage itself does not depend on player momentum;
  // it is a plain solid-contact check, exactly like spikes/lava above.
  //
  // Every occupied cell of a grouped (2x2) placement shares one logical
  // damage owner (contactDamageBlockGroupId) so contacting two of its cells
  // in the same tick still produces at most one applyPlayerDamageWithKnockback
  // call — the knockback source point is the nearest point on the FULL
  // placement's union AABB, not just the one cell found first, so multi-cell
  // contact always resolves to the same result regardless of scan order.
  // Reuses the existing damage/knockback/invulnerability function verbatim
  // (see src/sim/playerDamage.ts) — no parallel damage system is introduced.
  {
    const bHalf = BLOCK_SIZE_MEDIUM * 0.5;
    for (let i = 0; i < world.contactDamageBlockCount; i++) {
      if (world.isContactDamageBlockActiveFlag[i] === 0) continue;

      const bx = world.contactDamageBlockXWorld[i];
      const by = world.contactDamageBlockYWorld[i];
      const bLeft = bx - bHalf;
      const bRight = bx + bHalf;
      const bTop = by - bHalf;
      const bBottom = by + bHalf;

      if (!overlapAABB(px, py, phw, phh, bLeft, bTop, bRight, bBottom)) continue;

      const groupId = world.contactDamageBlockGroupId[i];
      let srcLeft = bLeft, srcRight = bRight, srcTop = bTop, srcBottom = bBottom;

      if (groupId >= 0) {
        let minXWorld = bx, maxXWorld = bx;
        let minYWorld = by, maxYWorld = by;
        for (let j = 0; j < world.contactDamageBlockCount; j++) {
          if (world.contactDamageBlockGroupId[j] !== groupId) continue;
          if (world.isContactDamageBlockActiveFlag[j] === 0) continue;
          const jx = world.contactDamageBlockXWorld[j];
          const jy = world.contactDamageBlockYWorld[j];
          if (jx < minXWorld) minXWorld = jx;
          if (jx > maxXWorld) maxXWorld = jx;
          if (jy < minYWorld) minYWorld = jy;
          if (jy > maxYWorld) maxYWorld = jy;
        }
        srcLeft = minXWorld - bHalf;
        srcRight = maxXWorld + bHalf;
        srcTop = minYWorld - bHalf;
        srcBottom = maxYWorld + bHalf;
      }

      // Nearest point on the (possibly grouped) footprint to the player
      // center — identical pattern to the lava-zone source point above, so
      // knockback direction follows whichever side the player is actually
      // touching rather than always pointing one fixed way.
      const sourceXWorld = Math.max(srcLeft, Math.min(px, srcRight));
      const sourceYWorld = Math.max(srcTop, Math.min(py, srcBottom));
      const damagePoints = world.contactDamageBlockTier[i] === 1
        ? CUSTOM_BLOCK_CONTACT_DAMAGE_HIGH
        : CUSTOM_BLOCK_CONTACT_DAMAGE_LOW;

      // applyPlayerDamageWithKnockback itself no-ops while the player is
      // still invulnerable from a previous hit this tick or a recent one,
      // so even if two DISTINCT damaging placements are both contacted this
      // tick, at most one ever produces a real effect — no separate
      // per-block cooldown bookkeeping is needed here.
      applyPlayerDamageWithKnockback(player, damagePoints, sourceXWorld, sourceYWorld);
      break; // one damage attempt per tick, mirrors the spike/lava pattern above.
    }
  }

  // ── Breakable blocks ─────────────────────────────────────────────────────
  {
    // Uses the speed captured BEFORE the contact-damage section above ran —
    // see playerSpeedBeforeContactDamage's doc comment.
    const playerSpeed = playerSpeedBeforeContactDamage;

    for (let i = 0; i < world.breakableBlockCount; i++) {
      if (world.isBreakableBlockActiveFlag[i] === 0) continue;

      const bx = world.breakableBlockXWorld[i];
      const by = world.breakableBlockYWorld[i];
      const bHalf = BLOCK_SIZE_MEDIUM * 0.5;
      const bLeft = bx - bHalf;
      const bRight = bx + bHalf;
      const bTop = by - bHalf;
      const bBottom = by + bHalf;

      // Phase 2E: every cell of a grouped placement carries the same
      // resistance tier (resolved once in editorRoomBuilder.ts), so reading
      // it from the struck cell alone already reflects the whole placement.
      if (
        overlapAABB(px, py, phw, phh, bLeft, bTop, bRight, bBottom) &&
        playerSpeed >= resolveBreakThresholdWorld(world.breakableBlockResistance[i])
      ) {
        // Break the struck cell, and — for Phase 2B multi-cell placements —
        // atomically break every other cell sharing its logical group id in
        // the SAME pass. This is the "one logical placement" destroy: no
        // partial state persists even mid-frame, and re-entering this branch
        // for an already-broken cell is a no-op (guarded by the active-flag
        // check at the top of the loop), so duplicate destruction callbacks
        // within one frame are idempotent.
        //
        // Phase 2C: the cell that first initiates the destroy owns the ONE
        // break event for the whole placement. For a grouped (2x2) placement
        // the event's footprint/center covers the union of all member cells,
        // computed BEFORE any cell is deactivated (every group member is
        // still active at this point — the atomic-group invariant guarantees
        // a group is either fully active or fully destroyed, and the
        // active-flag check above already proved this cell was active).
        const material = world.breakableBlockMaterial[i];
        const groupId = world.breakableBlockGroupId[i];

        if (groupId >= 0) {
          let minXWorld = bx, maxXWorld = bx;
          let minYWorld = by, maxYWorld = by;
          for (let j = 0; j < world.breakableBlockCount; j++) {
            if (world.breakableBlockGroupId[j] !== groupId) continue;
            const jx = world.breakableBlockXWorld[j];
            const jy = world.breakableBlockYWorld[j];
            if (jx < minXWorld) minXWorld = jx;
            if (jx > maxXWorld) maxXWorld = jx;
            if (jy < minYWorld) minYWorld = jy;
            if (jy > maxYWorld) maxYWorld = jy;
          }
          emitBreakEvent(
            world,
            (minXWorld + maxXWorld) * 0.5,
            (minYWorld + maxYWorld) * 0.5,
            (maxXWorld - minXWorld) + BLOCK_SIZE_MEDIUM,
            (maxYWorld - minYWorld) + BLOCK_SIZE_MEDIUM,
            material,
            groupId,
            true,
          );
        } else {
          emitBreakEvent(world, bx, by, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_MEDIUM, material, -1, false);
        }

        destroyBreakableBlockCell(world, i);

        if (groupId >= 0) {
          for (let j = 0; j < world.breakableBlockCount; j++) {
            if (j === i) continue;
            if (world.breakableBlockGroupId[j] !== groupId) continue;
            if (world.isBreakableBlockActiveFlag[j] === 0) continue;
            destroyBreakableBlockCell(world, j);
          }
        }
      }
    }
  }

  // ── Crumble blocks ───────────────────────────────────────────────────────
  // Destroyed by any dust particle (from any cluster) touching the block, OR
  // by the player body AABB overlapping (player walks into it).
  // 2-hit system: first contact cracks the block, second destroys it.
  {
    // Fallback half-extent only used if a crumble block somehow has no linked
    // wall slot (shouldn't happen in practice — gameRoomHazards.ts always
    // allocates one for non-spike crumble blocks unless MAX_WALLS is
    // exhausted) so contact-break never silently does nothing.
    const bHalf = BLOCK_SIZE_MEDIUM * 0.5;
    for (let i = 0; i < world.crumbleBlockCount; i++) {
      if (world.isCrumbleBlockActiveFlag[i] === 0) continue;
      // Crumble spikes aren't solid walls and use a different footprint/break
      // rule (momentum-attack contact, handled in the spike-damage loop
      // above) — skip them here so this rect-shaped contact-break path
      // doesn't apply a wrong 1-block AABB or double-break the same entry.
      if (world.crumbleBlockSpikeIndex[i] >= 0) continue;

      // Tick down cooldown
      if (world.crumbleBlockHitCooldownTicks[i] > 0) {
        world.crumbleBlockHitCooldownTicks[i] -= 1;
        continue;
      }

      // Use the block's REAL authored footprint (wBlock x hBlock), not a
      // fixed one-block box — a 2x2+ crumble block must register contact
      // anywhere across its full extent. The linked wall slot
      // (crumbleBlockWallIndex) already carries the true world-space AABB
      // (wallXWorld/YWorld/WWorld/HWorld) plus shape-orientation data, so we
      // derive the footprint from it and reuse `aabbOverlapsWallSolid` for
      // the actual hit test — this keeps stairs (and any other shape with
      // an already-established "solid vs empty notch" contract) from
      // regressing into a naive full-rectangle AABB: a contact point sitting
      // in a stairs block's empty upper corner still correctly reports no
      // hit, exactly as it does for non-crumble stair walls.
      const wi = world.crumbleBlockWallIndex[i];
      let bLeft: number, bTop: number, bRight: number, bBottom: number;
      if (wi >= 0) {
        bLeft   = world.wallXWorld[wi];
        bTop    = world.wallYWorld[wi];
        bRight  = bLeft + world.wallWWorld[wi];
        bBottom = bTop + world.wallHWorld[wi];
      } else {
        const bx = world.crumbleBlockXWorld[i];
        const by = world.crumbleBlockYWorld[i];
        bLeft   = bx - bHalf;
        bRight  = bx + bHalf;
        bTop    = by - bHalf;
        bBottom = by + bHalf;
      }

      // Check player body AABB
      let hit = wi >= 0
        ? aabbOverlapsWallSolid(world, wi, px - phw, py - phh, px + phw, py + phh)
        : overlapAABB(px, py, phw, phh, bLeft, bTop, bRight, bBottom);

      // Check any alive particle from any cluster
      if (!hit) {
        for (let p = 0; p < world.particleCount; p++) {
          if (world.isAliveFlag[p] === 0) continue;
          const partX = world.positionXWorld[p];
          const partY = world.positionYWorld[p];
          // Quick reject against the block's own bounding box before the
          // (potentially per-step) shape-aware test.
          if (partX < bLeft || partX > bRight || partY < bTop || partY > bBottom) continue;
          if (wi >= 0 ? aabbOverlapsWallSolid(world, wi, partX, partY, partX, partY) : true) {
            hit = true;
            break;
          }
        }
      }

      if (hit) {
        world.crumbleBlockHitsRemaining[i] -= 1;
        if (world.crumbleBlockHitsRemaining[i] === 0) {
          // Fully destroyed
          world.isCrumbleBlockActiveFlag[i] = 0;
          const wi = world.crumbleBlockWallIndex[i];
          if (wi >= 0 && wi < world.wallCount) {
            world.wallWWorld[wi] = 0;
            world.wallHWorld[wi] = 0;
          }
        } else {
          // Cracked — start cooldown before next hit
          world.crumbleBlockHitCooldownTicks[i] = CRUMBLE_HIT_COOLDOWN_TICKS;
        }
      }
    }
  }

  // ── Dust boost jars ──────────────────────────────────────────────────────
  for (let i = 0; i < world.dustBoostJarCount; i++) {
    if (world.isDustBoostJarActiveFlag[i] === 0) continue;

    const jx = world.dustBoostJarXWorld[i];
    const jy = world.dustBoostJarYWorld[i];
    const dx = px - jx;
    const dy = py - jy;
    if (dx * dx + dy * dy <= JAR_INTERACT_RADIUS_WORLD * JAR_INTERACT_RADIUS_WORLD) {
      // Break the jar — dust spawning is handled by gameScreen
      world.isDustBoostJarActiveFlag[i] = 0;
    }
  }

  // ── Firefly jars ─────────────────────────────────────────────────────────
  for (let i = 0; i < world.fireflyJarCount; i++) {
    if (world.isFireflyJarActiveFlag[i] === 0) continue;

    const jx = world.fireflyJarXWorld[i];
    const jy = world.fireflyJarYWorld[i];
    const dx = px - jx;
    const dy = py - jy;
    if (dx * dx + dy * dy <= JAR_INTERACT_RADIUS_WORLD * JAR_INTERACT_RADIUS_WORLD) {
      // Break the jar and release fireflies
      world.isFireflyJarActiveFlag[i] = 0;

      for (let f = 0; f < FIREFLIES_PER_JAR; f++) {
        if (world.fireflyCount >= MAX_FIREFLIES) break;
        const fi = world.fireflyCount++;
        world.fireflyXWorld[fi] = jx + nextFloatRange(world.rng, -6, 6);
        world.fireflyYWorld[fi] = jy + nextFloatRange(world.rng, -6, 6);
        const angle = nextFloat(world.rng) * Math.PI * 2;
        world.fireflyVelXWorld[fi] = Math.cos(angle) * FIREFLY_SPEED_WORLD;
        world.fireflyVelYWorld[fi] = Math.sin(angle) * FIREFLY_SPEED_WORLD;
      }
    }
  }

  // ── Firefly movement ─────────────────────────────────────────────────────
  for (let i = 0; i < world.fireflyCount; i++) {
    // Periodic direction changes based on tick + index
    if ((world.tick + i * 17) % FIREFLY_DIRECTION_CHANGE_TICKS === 0) {
      const angle = nextFloat(world.rng) * Math.PI * 2;
      world.fireflyVelXWorld[i] = Math.cos(angle) * FIREFLY_SPEED_WORLD;
      world.fireflyVelYWorld[i] = Math.sin(angle) * FIREFLY_SPEED_WORLD;
    }

    world.fireflyXWorld[i] += world.fireflyVelXWorld[i] * dtSec;
    world.fireflyYWorld[i] += world.fireflyVelYWorld[i] * dtSec;

    // Clamp to world bounds and bounce
    const bx = bounceAxis(world.fireflyXWorld[i], world.fireflyVelXWorld[i], FIREFLY_EDGE_MARGIN_WORLD, world.worldWidthWorld  - FIREFLY_EDGE_MARGIN_WORLD);
    world.fireflyXWorld[i]    = bx.pos;
    world.fireflyVelXWorld[i] = bx.vel;
    const by = bounceAxis(world.fireflyYWorld[i], world.fireflyVelYWorld[i], FIREFLY_EDGE_MARGIN_WORLD, world.worldHeightWorld - FIREFLY_EDGE_MARGIN_WORLD);
    world.fireflyYWorld[i]    = by.pos;
    world.fireflyVelYWorld[i] = by.vel;
  }
}
