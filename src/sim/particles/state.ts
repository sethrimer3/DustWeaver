export const MAX_PARTICLES = 1024;

export interface ParticleBuffers {
  positionXWorld:    Float32Array;
  positionYWorld:    Float32Array;
  velocityXWorld:    Float32Array;
  velocityYWorld:    Float32Array;
  forceX:            Float32Array;
  forceY:            Float32Array;
  massKg:            Float32Array;
  chargeUnits:       Float32Array;
  isAliveFlag:       Uint8Array;
  kindBuffer:        Uint8Array;
  ownerEntityId:     Int32Array;
  // ---- Lifetime -----------------------------------------------------------
  /** Age in simulation ticks.  Reset to 0 on respawn. */
  ageTicks:          Float32Array;
  /** Maximum age before the particle respawns at its owner. */
  lifetimeTicks:     Float32Array;
  // ---- Anchor / orbit -----------------------------------------------------
  /** Angle (radians) from owner center at which this particle was spawned. */
  anchorAngleRad:    Float32Array;
  /** Distance from owner center at which this particle orbits. */
  anchorRadiusWorld: Float32Array;
  // ---- Noise phase --------------------------------------------------------
  /** Per-particle seed mixed into the noise hash for staggered perturbation. */
  noiseTickSeed:     Uint32Array;
  // ---- Fluid disturbance --------------------------------------------------
  /**
   * For Fluid background particles: 0 = fully transparent (undisturbed),
   * 1 = fully visible (maximally disturbed).  Decays each tick and is bumped
   * by nearby fast-moving non-Fluid particles.  Always 0 for non-Fluid kinds.
   */
  disturbanceFactor: Float32Array;
}

export function createParticleBuffers(): ParticleBuffers {
  return {
    positionXWorld:    new Float32Array(MAX_PARTICLES),
    positionYWorld:    new Float32Array(MAX_PARTICLES),
    velocityXWorld:    new Float32Array(MAX_PARTICLES),
    velocityYWorld:    new Float32Array(MAX_PARTICLES),
    forceX:            new Float32Array(MAX_PARTICLES),
    forceY:            new Float32Array(MAX_PARTICLES),
    massKg:            new Float32Array(MAX_PARTICLES),
    chargeUnits:       new Float32Array(MAX_PARTICLES),
    isAliveFlag:       new Uint8Array(MAX_PARTICLES),
    kindBuffer:        new Uint8Array(MAX_PARTICLES),
    ownerEntityId:     new Int32Array(MAX_PARTICLES),
    ageTicks:          new Float32Array(MAX_PARTICLES),
    lifetimeTicks:     new Float32Array(MAX_PARTICLES),
    anchorAngleRad:    new Float32Array(MAX_PARTICLES),
    anchorRadiusWorld: new Float32Array(MAX_PARTICLES),
    noiseTickSeed:     new Uint32Array(MAX_PARTICLES),
    disturbanceFactor: new Float32Array(MAX_PARTICLES),
  };
}
