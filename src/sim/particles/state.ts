export const MAX_PARTICLES = 512;

export interface ParticleBuffers {
  positionXWorld: Float32Array;
  positionYWorld: Float32Array;
  velocityXWorld: Float32Array;
  velocityYWorld: Float32Array;
  forceX: Float32Array;
  forceY: Float32Array;
  massKg: Float32Array;
  chargeUnits: Float32Array;
  isAliveFlag: Uint8Array;
  kindBuffer: Uint8Array;
  ownerEntityId: Int32Array;
}

export function createParticleBuffers(): ParticleBuffers {
  return {
    positionXWorld: new Float32Array(MAX_PARTICLES),
    positionYWorld: new Float32Array(MAX_PARTICLES),
    velocityXWorld: new Float32Array(MAX_PARTICLES),
    velocityYWorld: new Float32Array(MAX_PARTICLES),
    forceX: new Float32Array(MAX_PARTICLES),
    forceY: new Float32Array(MAX_PARTICLES),
    massKg: new Float32Array(MAX_PARTICLES),
    chargeUnits: new Float32Array(MAX_PARTICLES),
    isAliveFlag: new Uint8Array(MAX_PARTICLES),
    kindBuffer: new Uint8Array(MAX_PARTICLES),
    ownerEntityId: new Int32Array(MAX_PARTICLES),
  };
}
