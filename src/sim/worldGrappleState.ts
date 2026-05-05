/**
 * Grapple hook sub-state for WorldState.
 *
 * All fields related to the player's grapple hook, zip mechanics, rope
 * attachment, failure visual effects, miss animation, and geometric
 * corner-wrapping live here.
 *
 * WorldState extends this interface; consumers always work through WorldState
 * and never need to import GrappleWorldState directly.
 */

/** Maximum number of grapple corner wrap points (geometric wrapping, Phase 2). */
export const MAX_GRAPPLE_WRAP_POINTS = 3;

/**
 * Grapple input mode — controls whether the grapple is held or toggled.
 *
 * Hold (0): Hold left mouse button to keep the grapple active; release to drop.
 * Toggle (1): Click once to fire/attach; click again to release. Holding is
 *             not required in this mode.
 *
 * The setting is stored on WorldState so it is trivially exposable in the
 * settings menu without plumbing through additional context.
 */
export const enum GrappleInputMode {
  Hold   = 0,
  Toggle = 1,
}

export interface GrappleWorldState {
  // ---- Rope attachment point (grapple hooked onto a room rope) -----------
  /**
   * Index of the room rope the player's grapple is currently attached to.
   * -1 when the grapple is not attached to a rope.
   */
  grappleRopeIndex: number;
  /**
   * Float segment index (e.g. 2.7 = 70 % between segment 2 and segment 3) along
   * the attached rope.  Only meaningful when grappleRopeIndex >= 0.
   */
  grappleRopeAttachSegF: number;

  // ---- Grapple hook -------------------------------------------------------
  /** 1 while the player's grapple hook is attached to an anchor point. */
  isGrappleActiveFlag: 0 | 1;
  /** World-space X coordinate of the grapple anchor point. */
  grappleAnchorXWorld: number;
  /** World-space Y coordinate of the grapple anchor point. */
  grappleAnchorYWorld: number;
  /**
   * Fixed rope length (world units) set at fire time.
   * The player is constrained to stay within this distance of the anchor.
   */
  grappleLengthWorld: number;
  /**
   * Total amount of rope pulled in during the current grapple session (world units).
   * Accumulates while the jump button is held; grapple breaks when this exceeds
   * GRAPPLE_MAX_PULL_IN_WORLD.  Reset to 0 on each new grapple fire.
   */
  grapplePullInAmountWorld: number;
  /** Remaining ticks for the grapple attach sparkle burst effect. */
  grappleAttachFxTicks: number;
  /** World-space effect center for grapple attach burst. */
  grappleAttachFxXWorld: number;
  grappleAttachFxYWorld: number;
  /**
   * Start index in the particle buffer of the GRAPPLE_SEGMENT_COUNT chain particles.
   * -1 if not yet allocated. These slots are reserved by the game screen at startup.
   */
  grappleParticleStartIndex: number;
  /**
   * Number of consecutive ticks the jump button has been held while the grapple
   * is active.  Used for tap-vs-hold detection:
   *   • ≤ GRAPPLE_JUMP_TAP_THRESHOLD_TICKS on release → tap → release grapple
   *   • > threshold while held → hold → retract rope
   * Reset to 0 on grapple fire / release.
   */
  grappleJumpHeldTickCount: number;

  /**
   * 1 when the player has a grapple charge available; 0 when spent.
   * Resets to 1 when the player touches the ground or grapples onto a top surface.
   * Prevents firing a second grapple until recharged.
   */
  hasGrappleChargeFlag: 0 | 1;

  // ---- Grapple input mode --------------------------------------------------
  /**
   * Controls how the left mouse button interacts with the grapple.
   * GrappleInputMode.Hold   (0): hold to keep active, release to drop.
   * GrappleInputMode.Toggle (1): click to attach, click again to release.
   */
  grappleInputMode: GrappleInputMode;

  // ---- Grapple zip mechanics -----------------------------------------------
  /**
   * 1 when the player has activated a zip toward the anchor.
   * Activated explicitly by pressing right mouse button while the grapple is
   * attached.  The player rockets toward the anchor; upon arrival momentum
   * stops and a zip-jump window opens.
   * Works on any surface (floor, wall, ceiling).
   */
  isGrappleZipActiveFlag: 0 | 1;
  /**
   * Set to 1 for one tick when the player requests a zip (right-click while
   * grapple is attached).  Consumed by tickGrappleZip to activate the zip
   * state machine.  Cleared by releaseGrapple and by zip activation.
   */
  isGrappleZipTriggeredFlag: 0 | 1;
  /** 1 when the player has arrived at the zip target and is sticking. */
  isGrappleStuckFlag: 0 | 1;
  /**
   * Ticks since the player came to a complete stop while grapple-stuck.
   * Used for zip-jump detection: if the player jumps within GRAPPLE_ZIP_JUMP_WINDOW_TICKS
   * of stopping they receive a high-velocity zip-jump in the surface normal direction.
   * 0 while still decelerating.
   */
  grappleStuckStoppedTickCount: number;
  /**
   * Normalized X component of the surface normal at the zip target (direction from
   * anchor toward the player's arrival position).  Set when zip is activated.
   * Used to determine zip-jump direction and arrival target position.
   */
  grappleZipNormalXWorld: number;
  /**
   * Normalized Y component of the surface normal at the zip target.
   * Positive Y = pointing downward (ceiling zip), negative Y = pointing upward (floor zip).
   */
  grappleZipNormalYWorld: number;

  // ---- Down key tracking (for grapple retraction, movement crouch) ---------
  /**
   * Set to 1 for one tick when the down key (S / ArrowDown) is first pressed.
   * Preserved across tick() while grapple is active, like playerJumpTriggeredFlag.
   * Consumed by applyGrappleClusterConstraint (discarded) and movement.ts.
   */
  playerDownTriggeredFlag: 0 | 1;

  // ---- Grapple proximity bounce sprite state --------------------------------
  /**
   * Ticks remaining in the post-proximity-bounce sprite window.
   * While > 0 the player renders the jumping sprite rotated toward the
   * wall/ceiling they bounced off.  Counts down each tick; 0 = inactive.
   */
  grappleProximityBounceTicksLeft: number;
  /**
   * Canvas rotation angle (radians) to apply to the jumping sprite during the
   * proximity bounce sprite window.  0 = no rotation (floor bounce, unused),
   * -π/2 = left-wall bounce, +π/2 = right-wall bounce, π = ceiling bounce.
   */
  grappleProximityBounceRotationAngleRad: number;

  // ---- Grapple failure visual FX -------------------------------------------
  grappleFailBeamTicksLeft: number;
  grappleFailBeamTotalTicks: number;
  grappleFailBeamStartXWorld: number;
  grappleFailBeamStartYWorld: number;
  grappleFailBeamEndXWorld: number;
  grappleFailBeamEndYWorld: number;

  grappleEmptyFxTicksLeft: number;
  grappleEmptyFxTotalTicks: number;
  grappleEmptyFxXWorld: number;
  grappleEmptyFxYWorld: number;

  // ---- Grapple miss state (limp chain) ------------------------------------
  /** 1 while the grapple chain is in "miss" mode (extended to full length, falling limp). */
  isGrappleMissActiveFlag: 0 | 1;
  /** 1 while the grapple chain is retracting back to the player and cannot attach. */
  isGrappleRetractingFlag: 0 | 1;
  /** Direction X the grapple was fired in (normalized). */
  grappleMissDirXWorld: number;
  /** Direction Y the grapple was fired in (normalized). */
  grappleMissDirYWorld: number;
  /** Ticks since the grapple miss started. */
  grappleMissTickCount: number;

  // ── Phase 9: Grapple out-of-range tension ──────────────────────────────────
  /**
   * Number of consecutive ticks the attached grapple rope has exceeded the
   * current effective grapple range.  0 while the rope length is within range.
   *
   * When this reaches `GRAPPLE_OUT_OF_RANGE_BREAK_TICKS` (45) the grapple
   * breaks automatically.  Reset to 0 in `releaseGrapple`.
   */
  grappleOutOfRangeTicks: number;
  /**
   * Visual tension factor in [0, 1].
   *
   * 0 = rope within range (no tension).
   * Ramps from 0 → 1 as grappleOutOfRangeTicks approaches the break threshold.
   * 1 = rope breaks next tick.
   *
   * Used by the influence circle renderer to pulse/flicker the ring as a
   * "rope under tension" warning.  Reset to 0 in `releaseGrapple`.
   */
  grappleTensionFactor: number;

  // ── Phase 10: Grapple surface-anchor state ─────────────────────────────────
  /**
   * Outward surface normal at the current grapple anchor (unit axis vector).
   *
   * Set when the grapple attaches to a wall face via `fireGrapple`. Points
   * away from the wall toward the player at the moment of attachment.
   *
   * 0,0 when not attached to a wall (rope grapple or not active).
   *
   * Used by debug rendering and surface-aware validation: the anchor is a
   * surface-contact point; validate it by checking the referenced wall still
   * exists, NOT by testing whether the point is inside solid geometry.
   */
  grappleAnchorNormalXWorld: number;
  grappleAnchorNormalYWorld: number;

  // ── Zip stuck lock position ────────────────────────────────────────────────
  /**
   * World-space X position at which to lock the player during the stuck phase.
   *
   * For normal (unobstructed) arrival: set to (anchorX + normalX * halfExtent).
   * For blocked zip completion: set to the player's position after the last
   * swept AABB step against the obstructing wall.
   *
   * This prevents the stuck phase from snapping the player back to the
   * original anchor-surface target when they stopped at an intermediate wall.
   * Reset by releaseGrapple and set whenever isGrappleStuckFlag transitions 0→1.
   */
  grappleZipStickXWorld: number;
  /** World-space Y position to lock the player during the stuck phase. */
  grappleZipStickYWorld: number;

  // ── Zip impact FX ──────────────────────────────────────────────────────────
  /**
   * Ticks remaining for the zip impact shockwave + dust plume effect.
   * 0 = inactive.  Ticked down every tick by tick.ts.
   */
  zipImpactFxTicksLeft: number;
  /** Total ticks for the zip impact FX (used for alpha / progress calculation). */
  zipImpactFxTotalTicks: number;
  /** World-space X center of the zip impact FX. */
  zipImpactFxXWorld: number;
  /** World-space Y center of the zip impact FX. */
  zipImpactFxYWorld: number;
  /**
   * Scale factor for the zip impact FX.
   * 1.0 = normal zip completion shockwave.
   * 1.35 = successful zip-jump (slightly larger ring communicates the timed jump).
   */
  zipImpactFxScale: number;
  /**
   * Surface normal X at the zip impact point — used to orient the dust plume.
   * If no surface was hit, this may be set to the reverse of the zip direction.
   */
  zipImpactFxNormalXWorld: number;
  /** Surface normal Y at the zip impact point. */
  zipImpactFxNormalYWorld: number;
  /**
   * 1 once the zip impact FX has fired for the current stuck session.
   * Prevents the shockwave from re-triggering every tick while decelerating.
   * Reset to 0 on zip activation (isGrappleZipTriggeredFlag consumed) and by
   * releaseGrapple.
   */
  hasZipImpactFxFiredFlag: 0 | 1;

  // ── Debug: grapple collision visualization ──────────────────────────────────
  /**
   * Stores the last grapple sweep segment (from/to) and raw hit point so the
   * debug overlay can visualise the continuous collision detection path.
   * Written by fireGrapple; reset each fire.
   * These fields are only consumed by the renderer and have no physics effect.
   */
  grappleDebugSweepFromXWorld: number;
  grappleDebugSweepFromYWorld: number;
  grappleDebugSweepToXWorld:   number;
  grappleDebugSweepToYWorld:   number;
  /** Raw raycast hit point before the surface-epsilon offset is applied. */
  grappleDebugRawHitXWorld: number;
  grappleDebugRawHitYWorld: number;
  /**
   * 1 for one frame after a grapple fire so the renderer knows the debug data
   * is fresh.  Not ticked down; cleared lazily when grapple releases.
   */
  isGrappleDebugActiveFlag: 0 | 1;

  // ── Grapple retraction ramp (Phase 1) ─────────────────────────────────────
  /**
   * Number of consecutive ticks the down/crouch key has been held while the
   * grapple is active.  Used to compute the retraction ramp-up factor so the
   * first ~0.15 s retracts at partial speed, reaching full speed by ~0.35 s.
   * Reset to 0 in releaseGrapple, fireGrapple, and when the key is released.
   */
  grappleRetractHeldTicks: number;

  // ── Grapple geometric wrapping (Phase 2) ──────────────────────────────────
  /**
   * Debug/feature flag.  1 = geometric corner wrapping is active; 0 = disabled.
   * Defaults to 0 (off).  Toggle via debug panel / settings to prototype wrapping.
   */
  isGrappleWrappingEnabled: 0 | 1;
  /**
   * Number of active wrap-corner points on the current grapple (0–MAX_GRAPPLE_WRAP_POINTS).
   * Cleared by releaseGrapple and fireGrapple.
   */
  grappleWrapPointCount: number;
  /** World-X of each wrap corner, indexed 0..grappleWrapPointCount-1. */
  grappleWrapPointXWorld: Float32Array;
  /** World-Y of each wrap corner, indexed 0..grappleWrapPointCount-1. */
  grappleWrapPointYWorld: Float32Array;
  /**
   * Wall index (into world.wallXWorld etc.) for the wall whose corner produced
   * each wrap point.  -1 if unknown.  Used for validity checks (e.g. breakable
   * walls that have since been destroyed).
   */
  grappleWrapPointWallIndex: Int16Array;
}

/** Returns the default-initialised grapple state for use in createWorldState(). */
export function createGrappleWorldState(): GrappleWorldState {
  return {
    grappleRopeIndex:                      -1,
    grappleRopeAttachSegF:                 0.0,
    isGrappleActiveFlag:                   0,
    grappleAnchorXWorld:                   0.0,
    grappleAnchorYWorld:                   0.0,
    grappleLengthWorld:                    0.0,
    grapplePullInAmountWorld:              0.0,
    grappleAttachFxTicks:                  0,
    grappleAttachFxXWorld:                 0.0,
    grappleAttachFxYWorld:                 0.0,
    grappleParticleStartIndex:             -1,
    grappleJumpHeldTickCount:              0,
    hasGrappleChargeFlag:                  1,
    grappleInputMode:                      GrappleInputMode.Hold,
    isGrappleZipActiveFlag:                0,
    isGrappleZipTriggeredFlag:             0,
    isGrappleStuckFlag:                    0,
    grappleStuckStoppedTickCount:          0,
    grappleZipNormalXWorld:                0.0,
    grappleZipNormalYWorld:                -1.0,
    grappleZipStickXWorld:                 0.0,
    grappleZipStickYWorld:                 0.0,
    zipImpactFxTicksLeft:                  0,
    zipImpactFxTotalTicks:                 16,
    zipImpactFxXWorld:                     0.0,
    zipImpactFxYWorld:                     0.0,
    zipImpactFxScale:                      1.0,
    zipImpactFxNormalXWorld:               0.0,
    zipImpactFxNormalYWorld:               -1.0,
    hasZipImpactFxFiredFlag:               0,
    playerDownTriggeredFlag:               0,
    grappleProximityBounceTicksLeft:       0,
    grappleProximityBounceRotationAngleRad: 0,
    grappleFailBeamTicksLeft:              0,
    grappleFailBeamTotalTicks:             14,
    grappleFailBeamStartXWorld:            0.0,
    grappleFailBeamStartYWorld:            0.0,
    grappleFailBeamEndXWorld:              0.0,
    grappleFailBeamEndYWorld:              0.0,
    grappleEmptyFxTicksLeft:               0,
    grappleEmptyFxTotalTicks:              12,
    grappleEmptyFxXWorld:                  0.0,
    grappleEmptyFxYWorld:                  0.0,
    isGrappleMissActiveFlag:               0,
    isGrappleRetractingFlag:               0,
    grappleMissDirXWorld:                  0.0,
    grappleMissDirYWorld:                  0.0,
    grappleMissTickCount:                  0,
    grappleOutOfRangeTicks:                0,
    grappleTensionFactor:                  0,
    grappleAnchorNormalXWorld:             0.0,
    grappleAnchorNormalYWorld:             0.0,
    grappleDebugSweepFromXWorld:           0.0,
    grappleDebugSweepFromYWorld:           0.0,
    grappleDebugSweepToXWorld:             0.0,
    grappleDebugSweepToYWorld:             0.0,
    grappleDebugRawHitXWorld:              0.0,
    grappleDebugRawHitYWorld:              0.0,
    isGrappleDebugActiveFlag:              0,
    grappleRetractHeldTicks:               0,
    isGrappleWrappingEnabled:              0,
    grappleWrapPointCount:                 0,
    grappleWrapPointXWorld:                new Float32Array(MAX_GRAPPLE_WRAP_POINTS),
    grappleWrapPointYWorld:                new Float32Array(MAX_GRAPPLE_WRAP_POINTS),
    grappleWrapPointWallIndex:             new Int16Array(MAX_GRAPPLE_WRAP_POINTS).fill(-1),
  };
}
