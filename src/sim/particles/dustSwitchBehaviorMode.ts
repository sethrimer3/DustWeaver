/**
 * Behavior-mode sentinels for the dust-switch (dust selection wheel
 * transformation) animation. Extends the existing per-particle `behaviorMode`
 * state machine (0=orbit, 1=attack, 2=block, 3=grapple chain — see
 * particles/state.ts and clusters/grappleShared.ts) with two more transient
 * states so the recall/return animation can suppress normal orbit, combat,
 * and weave-formation participation without a parallel particle-state system.
 */

/**
 * Mote is being recalled toward the moving player-center target. Custom
 * steering (see sim/weaves/dustTypeSwitch.ts) fully owns position/velocity for
 * this particle each tick; normal integration, binding, ambient, and
 * inter-particle forces all skip it.
 */
export const BEHAVIOR_MODE_DUST_SWITCH_RECALL = 4;

/**
 * Mote has just transformed at the player center and is flying back out to
 * orbit. Normal integration + binding forces are allowed (so it organically
 * eases back to its anchor), but it is still excluded from combat contact,
 * shield/weave-formation participation, and attack-launch selection until the
 * short return grace period elapses and it reverts to behaviorMode 0.
 */
export const BEHAVIOR_MODE_DUST_SWITCH_RETURN = 5;

/** True for either dust-switch transient behavior mode. */
export function isDustSwitchBehaviorMode(mode: number): boolean {
  return mode === BEHAVIOR_MODE_DUST_SWITCH_RECALL || mode === BEHAVIOR_MODE_DUST_SWITCH_RETURN;
}
