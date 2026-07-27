import { ParticleKind } from '../sim/particles/kinds';

/** Conservative world-space tuning for collectible Light Dust illumination. */
export const LIGHT_DUST_BASE_RADIUS_WORLD = 12;
export const LIGHT_DUST_RADIUS_PER_AVAILABLE_MOTE = 0.75;
export const LIGHT_DUST_MAX_RADIUS_WORLD = 24;
export const LIGHT_DUST_INTENSITY_PER_MOTE = 0.025;

interface LightDustParticleView {
  readonly isAliveFlag: Uint8Array;
  readonly kindBuffer: Uint8Array;
  readonly ownerEntityId: Int32Array;
}

/** Ownership/availability policy shared by rendering and Node-side tests. */
export function isAvailablePlayerLightDust(
  particles: LightDustParticleView,
  particleIndex: number,
  playerEntityId: number,
): boolean {
  return particles.isAliveFlag[particleIndex] === 1
    && particles.kindBuffer[particleIndex] === ParticleKind.Light
    && particles.ownerEntityId[particleIndex] === playerEntityId;
}
