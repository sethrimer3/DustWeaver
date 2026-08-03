/** Void Dust's deterministic grapple-replacement directional dash. */

import type { WorldState } from '../world';
import { ParticleKind } from '../particles/kinds';
import type { ClusterState } from './state';

export const VOID_DASH_BRAKE_DURATION_SEC = 0.5;
export const VOID_DASH_LAUNCH_SPEED_WORLD_PER_SEC = 300;
export const VOID_DASH_DIRECTION_COUNT = 16;

export interface VoidDashState {
  isBraking: boolean;
  elapsedSec: number;
  startVelocityXWorld: number;
  startVelocityYWorld: number;
  launchDirXWorld: number;
  launchDirYWorld: number;
}

export function createVoidDashState(): VoidDashState {
  return {
    isBraking: false,
    elapsedSec: 0,
    startVelocityXWorld: 0,
    startVelocityYWorld: 0,
    launchDirXWorld: 1,
    launchDirYWorld: 0,
  };
}

export function resetVoidDashState(state: VoidDashState): void {
  Object.assign(state, createVoidDashState());
}

export function isVoidDustEquipped(world: WorldState): boolean {
  return world.selectedDustKind === ParticleKind.Void;
}

/** Returns the nearest of 16 directions; all four cardinal axes are exact slots. */
export function quantizeVoidDashDirection(dx: number, dy: number): { x: number; y: number } {
  const stepRad = (Math.PI * 2) / VOID_DASH_DIRECTION_COUNT;
  const angleRad = Math.round(Math.atan2(dy, dx) / stepRad) * stepRad;
  const x = Math.cos(angleRad);
  const y = Math.sin(angleRad);
  return {
    x: Math.abs(x) < 1e-12 ? 0 : x,
    y: Math.abs(y) < 1e-12 ? 0 : y,
  };
}

export function startVoidDash(
  world: WorldState,
  player: ClusterState,
  aimXWorld: number,
  aimYWorld: number,
): boolean {
  const dx = aimXWorld - player.positionXWorld;
  const dy = aimYWorld - player.positionYWorld;
  if (dx * dx + dy * dy < 1) return false;

  const direction = quantizeVoidDashDirection(dx, dy);
  const state = world.voidDash;
  state.isBraking = true;
  state.elapsedSec = 0;
  state.startVelocityXWorld = player.velocityXWorld;
  state.startVelocityYWorld = player.velocityYWorld;
  state.launchDirXWorld = direction.x;
  state.launchDirYWorld = direction.y;
  player.isFastFallModeFlag = 0;
  return true;
}

/** Returns true when this action owns velocity and normal movement must be skipped. */
export function updateVoidDash(player: ClusterState, world: WorldState, dtSec: number): boolean {
  const state = world.voidDash;
  if (!state.isBraking) return false;

  state.elapsedSec = Math.min(VOID_DASH_BRAKE_DURATION_SEC, state.elapsedSec + dtSec);
  const remaining = 1 - state.elapsedSec / VOID_DASH_BRAKE_DURATION_SEC;
  player.velocityXWorld = state.startVelocityXWorld * remaining;
  player.velocityYWorld = state.startVelocityYWorld * remaining;

  if (state.elapsedSec >= VOID_DASH_BRAKE_DURATION_SEC - 1e-9) {
    state.elapsedSec = VOID_DASH_BRAKE_DURATION_SEC;
    player.velocityXWorld = state.launchDirXWorld * VOID_DASH_LAUNCH_SPEED_WORLD_PER_SEC;
    player.velocityYWorld = state.launchDirYWorld * VOID_DASH_LAUNCH_SPEED_WORLD_PER_SEC;
    state.isBraking = false;
  }
  return true;
}
