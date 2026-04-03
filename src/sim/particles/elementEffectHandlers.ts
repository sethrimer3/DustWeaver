/**
 * Post-contact element effect handlers — ice chill, shadow lifesteal,
 * wind scatter, and holy healing aura.
 *
 * Extracted from forces.ts as a pure code-organization refactor.
 * All scratch buffers are module-level pre-allocated singletons (no per-frame
 * allocation).
 */

import { WorldState } from '../world';
import { getElementProfile } from './elementProfiles';

// ---- Effect constants (exported for tests / documentation) ----------------

/** Radius of ice chill slow effect after an ice kill (world units). */
export const ICE_CHILL_RANGE_WORLD = 55.0;
/** Velocity scale applied to particles hit by ice chill (0–1; lower = slower). */
export const ICE_CHILL_VELOCITY_DECAY = 0.35;
/** Radius of wind scatter knockback burst after a wind kill (world units). */
export const WIND_SCATTER_RANGE_WORLD = 75.0;
/** Velocity impulse magnitude of wind scatter knockback. */
export const WIND_SCATTER_IMPULSE_WORLD = 180.0;
/** Durability restored per tick by the Holy healing aura to nearby player particles. */
export const HOLY_HEAL_RATE_PER_TICK = 0.004;
/** Durability restored to the most-wounded particle per shadow kill (lifesteal). */
export const SHADOW_LIFESTEAL_HEAL_AMOUNT = 0.4;

// ---- Pre-allocated scratch for ice chill slow events ----------------------
const _iceChillPosX        = new Float32Array(64);
const _iceChillPosY        = new Float32Array(64);
const _iceChillKillerOwner = new Int32Array(64);
let _iceChillCount = 0;

// ---- Pre-allocated scratch for shadow lifesteal events --------------------
const _shadowKillOwnerIds = new Int32Array(32);
let _shadowKillCount = 0;

// ---- Pre-allocated scratch for wind scatter knockback events --------------
const _windScatterPosX        = new Float32Array(32);
const _windScatterPosY        = new Float32Array(32);
const _windScatterKillerOwner = new Int32Array(32);
let _windScatterCount = 0;

// ---- Reset / record functions ---------------------------------------------

/** Reset all ice/shadow/wind event counters. Call once per tick before recording. */
export function resetEffectCounters(): void {
  _iceChillCount = 0;
  _shadowKillCount = 0;
  _windScatterCount = 0;
}

/** Record an ice chill event at the kill position. */
export function recordIceChillEvent(posXWorld: number, posYWorld: number, killerOwner: number): void {
  if (_iceChillCount < _iceChillPosX.length) {
    _iceChillPosX[_iceChillCount] = posXWorld;
    _iceChillPosY[_iceChillCount] = posYWorld;
    _iceChillKillerOwner[_iceChillCount] = killerOwner;
    _iceChillCount++;
  }
}

/** Record a shadow lifesteal event for the given killer owner entity. */
export function recordShadowKillEvent(killerOwner: number): void {
  if (_shadowKillCount < _shadowKillOwnerIds.length) {
    _shadowKillOwnerIds[_shadowKillCount++] = killerOwner;
  }
}

/** Record a wind scatter event at the kill position. */
export function recordWindScatterEvent(posXWorld: number, posYWorld: number, killerOwner: number): void {
  if (_windScatterCount < _windScatterPosX.length) {
    _windScatterPosX[_windScatterCount] = posXWorld;
    _windScatterPosY[_windScatterCount] = posYWorld;
    _windScatterKillerOwner[_windScatterCount] = killerOwner;
    _windScatterCount++;
  }
}

// ---- Apply functions (scan world particle arrays) -------------------------

/** Apply ice chill area-slow to enemy particles near recorded ice kill locations. */
export function applyIceChillEffects(world: WorldState): void {
  const { positionXWorld, positionYWorld, velocityXWorld, velocityYWorld,
    isAliveFlag, ownerEntityId, particleCount } = world;
  for (let c = 0; c < _iceChillCount; c++) {
    const cx = _iceChillPosX[c];
    const cy = _iceChillPosY[c];
    const killerOwner = _iceChillKillerOwner[c];
    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 0) continue;
      if (ownerEntityId[i] === killerOwner || ownerEntityId[i] === -1) continue;
      const dx = positionXWorld[i] - cx;
      const dy = positionYWorld[i] - cy;
      if (dx * dx + dy * dy < ICE_CHILL_RANGE_WORLD * ICE_CHILL_RANGE_WORLD) {
        velocityXWorld[i] *= ICE_CHILL_VELOCITY_DECAY;
        velocityYWorld[i] *= ICE_CHILL_VELOCITY_DECAY;
      }
    }
  }
}

/** Apply shadow lifesteal — heal the most-wounded particle of the killer's cluster. */
export function applyShadowLifestealEffects(world: WorldState): void {
  const { isAliveFlag, ownerEntityId, isTransientFlag,
    particleDurability, kindBuffer, particleCount } = world;
  for (let s = 0; s < _shadowKillCount; s++) {
    const shadowOwner = _shadowKillOwnerIds[s];
    let lowestDurability = Infinity;
    let lowestIdx = -1;
    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 0) continue;
      if (ownerEntityId[i] !== shadowOwner) continue;
      if (isTransientFlag[i] === 1) continue;
      if (particleDurability[i] < lowestDurability) {
        lowestDurability = particleDurability[i];
        lowestIdx = i;
      }
    }
    if (lowestIdx >= 0) {
      const maxDur = getElementProfile(kindBuffer[lowestIdx]).toughness;
      particleDurability[lowestIdx] = Math.min(particleDurability[lowestIdx] + SHADOW_LIFESTEAL_HEAL_AMOUNT, maxDur);
    }
  }
}

/** Apply wind scatter knockback burst to enemy particles near recorded wind kill locations. */
export function applyWindScatterEffects(world: WorldState): void {
  const { positionXWorld, positionYWorld, velocityXWorld, velocityYWorld,
    isAliveFlag, ownerEntityId, particleCount } = world;
  for (let w = 0; w < _windScatterCount; w++) {
    const wx = _windScatterPosX[w];
    const wy = _windScatterPosY[w];
    const killerOwner = _windScatterKillerOwner[w];
    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 0) continue;
      if (ownerEntityId[i] === killerOwner || ownerEntityId[i] === -1) continue;
      const dx = positionXWorld[i] - wx;
      const dy = positionYWorld[i] - wy;
      const dSq = dx * dx + dy * dy;
      if (dSq < WIND_SCATTER_RANGE_WORLD * WIND_SCATTER_RANGE_WORLD && dSq > 0.001) {
        const d = Math.sqrt(dSq);
        const impulse = WIND_SCATTER_IMPULSE_WORLD * (1.0 - d / WIND_SCATTER_RANGE_WORLD) / d;
        velocityXWorld[i] += dx * impulse;
        velocityYWorld[i] += dy * impulse;
      }
    }
  }
}

/**
 * Holy healing aura — orbit-mode Holy particles slowly restore durability
 * to nearby wounded allies.  Reuses the neighbor query result already
 * computed by the caller in the main neighbor pass.
 */
export function applyHolyHealingAura(
  _i: number, neighborCount: number, queryResult: number[],
  kindBuffer: Uint8Array, isAliveFlag: Uint8Array, ownerEntityId: Int32Array,
  isTransientFlag: Uint8Array, particleDurability: Float32Array,
  ownerI: number,
): void {
  for (let ni = 0; ni < neighborCount; ni++) {
    const j = queryResult[ni];
    if (isAliveFlag[j] === 0) continue;
    if (ownerEntityId[j] !== ownerI) continue;
    if (isTransientFlag[j] === 1) continue;
    const maxDur = getElementProfile(kindBuffer[j]).toughness;
    if (particleDurability[j] < maxDur) {
      particleDurability[j] = Math.min(
        particleDurability[j] + HOLY_HEAL_RATE_PER_TICK, maxDur,
      );
    }
  }
}
