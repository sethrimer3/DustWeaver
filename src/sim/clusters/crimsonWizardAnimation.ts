/**
 * Pure sprite/animation-frame selection for the Crimson Wizard boss.
 *
 * The frame is derived entirely from `crimsonWizardState` + `crimsonWizardStateTicks`,
 * so both the sim (to know when to cast fireballs) and the renderer (to know which
 * sprite to draw) can call the same functions without any extra per-cluster state.
 */
import {
  CW_ATTACK_ABOVE_FRAME_COUNT,
  CW_ATTACK_FRAME_COUNT,
  CW_FLYING_ABOVE_FRAME_TICKS,
  CW_GROUND_ATTACK_FRAME_TICKS,
  CW_GROUND_CAST_HOLD_TICKS,
  CW_GROUND_IDLE_TICKS,
  CW_GROUND_POST_CAST_WAIT_TICKS,
  CW_GROUND_WIND_DOWN_TICKS,
  CW_GROUND_WIND_UP_TICKS,
  CW_STATE_GROUND_FIRE_BALLS,
} from './crimsonWizardConfig';

export const CW_SPRITE_IDLE = 0;
export const CW_SPRITE_ATTACK = 1;
export const CW_SPRITE_ATTACK_ABOVE = 2;

export type CrimsonWizardSpriteKind =
  | typeof CW_SPRITE_IDLE
  | typeof CW_SPRITE_ATTACK
  | typeof CW_SPRITE_ATTACK_ABOVE;

export interface CrimsonWizardSpriteFrame {
  /** Which sprite sheet to draw from. */
  kind: CrimsonWizardSpriteKind;
  /** 1-based frame index into CrimsonWizard_Attacking_Frame_N / _Above_Frame_N. Unused (0) for idle. */
  frameIndex: number;
  /** True while the boss is standing on the ground (idle or ground-casting). */
  isGrounded: boolean;
  /** True during the hold-on-frame-6 window while the fireball volley is actually cast. */
  isCasting: boolean;
}

const WIND_UP_END = CW_GROUND_IDLE_TICKS + CW_GROUND_WIND_UP_TICKS;
const CAST_END = WIND_UP_END + CW_GROUND_CAST_HOLD_TICKS;
const WAIT_END = CAST_END + CW_GROUND_POST_CAST_WAIT_TICKS;
const WIND_DOWN_END = WAIT_END + CW_GROUND_WIND_DOWN_TICKS;

/** True while `stateTicks` falls within the cast-hold window (fireballs should be emitted). */
export function isCrimsonWizardGroundCasting(stateTicks: number): boolean {
  return stateTicks > WIND_UP_END && stateTicks <= CAST_END;
}

/** True once the ground-cast attack's full animation timeline has finished. */
export function isCrimsonWizardGroundCastDone(stateTicks: number): boolean {
  return stateTicks > WIND_DOWN_END;
}

function groundCastFrame(stateTicks: number): CrimsonWizardSpriteFrame {
  if (stateTicks <= CW_GROUND_IDLE_TICKS) {
    return { kind: CW_SPRITE_IDLE, frameIndex: 0, isGrounded: true, isCasting: false };
  }
  if (stateTicks <= WIND_UP_END) {
    const t = stateTicks - CW_GROUND_IDLE_TICKS;
    const frameIndex = Math.min(CW_ATTACK_FRAME_COUNT, Math.max(1, Math.ceil(t / CW_GROUND_ATTACK_FRAME_TICKS)));
    return { kind: CW_SPRITE_ATTACK, frameIndex, isGrounded: true, isCasting: false };
  }
  if (stateTicks <= WAIT_END) {
    return { kind: CW_SPRITE_ATTACK, frameIndex: CW_ATTACK_FRAME_COUNT, isGrounded: true, isCasting: isCrimsonWizardGroundCasting(stateTicks) };
  }
  if (stateTicks <= WIND_DOWN_END) {
    const t = stateTicks - WAIT_END;
    const frameIndex = Math.max(1, CW_ATTACK_FRAME_COUNT - Math.floor((t - 1) / CW_GROUND_ATTACK_FRAME_TICKS));
    return { kind: CW_SPRITE_ATTACK, frameIndex, isGrounded: true, isCasting: false };
  }
  return { kind: CW_SPRITE_IDLE, frameIndex: 0, isGrounded: true, isCasting: false };
}

function flyingFrame(stateTicks: number): CrimsonWizardSpriteFrame {
  const frameIndex = 1 + (Math.floor(stateTicks / CW_FLYING_ABOVE_FRAME_TICKS) % CW_ATTACK_ABOVE_FRAME_COUNT);
  return { kind: CW_SPRITE_ATTACK_ABOVE, frameIndex, isGrounded: false, isCasting: false };
}

/** Selects the sprite/frame to draw for the boss's current attack state + state ticks. */
export function getCrimsonWizardSpriteFrame(state: number, stateTicks: number): CrimsonWizardSpriteFrame {
  if (state === CW_STATE_GROUND_FIRE_BALLS) return groundCastFrame(stateTicks);
  return flyingFrame(stateTicks);
}
