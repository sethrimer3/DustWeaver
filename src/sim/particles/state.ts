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

  // ---- Combat / behavior --------------------------------------------------
  /**
   * Behavior mode per particle:
   *   0 = normal orbit around owner
   *   1 = attack — launched in attack direction; binding forces suppressed
   *   2 = block  — positioned as shield; anchor target overridden by combat.ts
   */
  behaviorMode:        Uint8Array;
  /** Current durability.  Decremented by elemental damage; reset to toughness on respawn. */
  particleDurability:  Float32Array;
  /**
   * Remaining ticks before a combat-killed (isAliveFlag=0) particle respawns.
   * Set to profile.regenerationRateTicks on combat kill; counted down by lifetime.ts.
   * 0 means no pending respawn.
   */
  respawnDelayTicks:   Float32Array;
  /**
   * Ticks remaining in attack-launch mode for this particle.
   * When this reaches 0, behaviorMode resets to 0 (orbit).
   */
  attackModeTicksLeft: Float32Array;
  /**
   * When 1, this particle is transient (e.g., a stone shard or lava trail ember).
   * Transient particles do NOT respawn when they expire or are destroyed.
   * Their buffer slots are recycled by findFreeParticleSlot() after they die.
   */
  isTransientFlag:     Uint8Array;

  // ---- Weave binding -------------------------------------------------------
  /**
   * Which Weave slot this particle is bound to:
   *   0 = unbound (no weave assigned — enemy particles, background, etc.)
   *   1 = primary Weave
   *   2 = secondary Weave
   * Set at spawn time when the player loadout is applied.
   */
  weaveSlotId:         Uint8Array;
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
    behaviorMode:        new Uint8Array(MAX_PARTICLES),
    particleDurability:  new Float32Array(MAX_PARTICLES),
    respawnDelayTicks:   new Float32Array(MAX_PARTICLES),
    attackModeTicksLeft: new Float32Array(MAX_PARTICLES),
    isTransientFlag:     new Uint8Array(MAX_PARTICLES),
    weaveSlotId:         new Uint8Array(MAX_PARTICLES),
  };
}
