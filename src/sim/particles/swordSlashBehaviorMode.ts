/**
 * Behavior-mode sentinel for the Sword Weave crescent slash.
 *
 * Extends the per-particle `behaviorMode` state machine (0=orbit, 1=attack,
 * 2=block/shield, 3=grapple chain, 4=dust-switch recall, 5=dust-switch return,
 * 6=bow arrow) with one more transient state so a mote participating in the
 * sword crescent can be fully owned by the Sword Weave (rear staging → forward
 * crescent sweep) without a parallel particle-state system.
 *
 * A mote in this mode is skipped by normal integration and owner-anchor
 * binding (swordWeave.ts fully manages its position each tick) and is excluded
 * from Shield crescent placement. When the swipe completes (or is cancelled) it
 * is handed back to behaviorMode 0, so it either returns to Storm following or
 * is picked up in place by the Shield crescent per the sword→shield handoff.
 */
export const BEHAVIOR_MODE_SWORD_SLASH = 7;

/** True while a particle is currently controlled as a sword-crescent mote. */
export function isSwordSlashBehaviorMode(mode: number): boolean {
  return mode === BEHAVIOR_MODE_SWORD_SLASH;
}
