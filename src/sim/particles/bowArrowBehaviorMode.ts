/**
 * Behavior-mode sentinel for the actual-mote Bow Weave arrow.
 *
 * Extends the per-particle `behaviorMode` state machine (0=orbit, 1=attack,
 * 2=block/shield, 3=grapple chain, 4=dust-switch recall, 5=dust-switch return)
 * with one more transient state so a mote reserved as part of the bow arrow can
 * be fully owned by the Bow Weave (assembly line + outbound flight) without a
 * parallel particle-state system.
 *
 * A mote in this mode:
 *   • is skipped by normal integration and owner-anchor binding (bowArrow.ts
 *     fully manages its position/velocity each tick), and
 *   • is excluded from ordinary Shield crescent slot placement, so the central
 *     arrow corridor stays clear and an arrow mote is never simultaneously a
 *     shield-slot mote.
 *
 * On launch resolution (wall bounce or max-distance curve-home) the mote is
 * handed back to behaviorMode 0 with an initial velocity, so the standard Storm
 * pursuit gradually reclaims it — there is no dedicated "returning" owned state.
 */
export const BEHAVIOR_MODE_BOW_ARROW = 6;

/** True when a particle is currently reserved/controlled as a bow arrow mote. */
export function isBowArrowBehaviorMode(mode: number): boolean {
  return mode === BEHAVIOR_MODE_BOW_ARROW;
}
