/**
 * Deterministic runtime simulation for Stormweave's life-mote cloud.
 *
 * The cloud is visual state derived from canonical player health. It is not
 * serialized and never owns or mutates gameplay life.
 */

import { getShieldMoteAngleRad, type ShieldArcGeometry } from './shieldWeave';
import { normalizeMoteCount } from '../playerMoteLife';
import { MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED } from '../momentumCombatConfig';

export const STORMWEAVE_RESTING_REGION_WORLD = 15;

const MAX_LIFE_MOTES = 32;
const MAX_PLAYER_PATH_SAMPLES = 256;
export const STORMWEAVE_TRAIL_LIFETIME_SEC = 0.68;
export const STORMWEAVE_TRAIL_SAMPLE_SPACING_WORLD = 1.5;
export const STORMWEAVE_TRAIL_SAMPLES_PER_MOTE = 32;
export const STORMWEAVE_GLOW_ATTACK_SEC = 3;
const TRAIL_STATIONARY_SAMPLE_INTERVAL_SEC = 0.05;
const TRAIL_REBASE_DURATION_SEC = STORMWEAVE_TRAIL_LIFETIME_SEC;
const TRAIL_SAMPLE_DISCONTINUITY_WORLD = 10;
const PLAYER_DISCONTINUITY_DISTANCE_WORLD = 80;
const ATTRACTION_PER_SEC2 = 7.5;
const VELOCITY_DAMPING_PER_SEC = 4.8;
const MAX_CATCH_UP_SPEED_WORLD_PER_SEC = 155;
const SEPARATION_RADIUS_WORLD = 7;
const SEPARATION_ACCEL_PER_SEC2 = 72;

export function getStormweaveMoteCount(currentMoteCount: number): number {
  return Math.min(MAX_LIFE_MOTES, normalizeMoteCount(currentMoteCount));
}

/** Smooth near-player falloff used by the steering simulation and direct tests. */
export function getStormweaveAttractionAcceleration(distanceWorld: number): number {
  const distance = Math.max(0, distanceWorld);
  const nearT = Math.min(1, distance / STORMWEAVE_RESTING_REGION_WORLD);
  const smoothNearT = nearT * nearT * (3 - 2 * nearT);
  return distance * ATTRACTION_PER_SEC2 * smoothNearT;
}

function deterministicUnit(indexA: number, indexB: number): [number, number] {
  const angle = ((indexA + 1) * 2.399963229728653 + (indexB + 1) * 0.7548776662466927) % (Math.PI * 2);
  return [Math.cos(angle), Math.sin(angle)];
}

export interface StormweaveMoteView {
  readonly xWorld: number;
  readonly yWorld: number;
  readonly velocityXWorld: number;
  readonly velocityYWorld: number;
}

export interface StormweaveTrailSizing {
  readonly coreHeadWidth: number;
  readonly goldHeadWidth: number;
  readonly glowHeadWidth: number;
  readonly headGlowRadius: number;
}

export function getStormweaveTrailTargetIntensity(velocityXWorld: number, velocityYWorld: number): number {
  const ratio = Math.max(0, Math.min(1,
    Math.hypot(velocityXWorld, velocityYWorld) / MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED,
  ));
  return ratio * ratio * (3 - 2 * ratio);
}

export function getStormweaveTrailSizing(intensity: number): StormweaveTrailSizing {
  const t = Math.max(0, Math.min(1, intensity));
  return {
    coreHeadWidth: 0.75 + (2 - 0.75) * t,
    goldHeadWidth: 1.75 + (4.5 - 1.75) * t,
    glowHeadWidth: 3.5 + (9 - 3.5) * t,
    headGlowRadius: 2.5 + (6.2 - 2.5) * t,
  };
}

export class StormweaveLifeMotes {
  private count = 0;
  private elapsedSec = 0;
  private spawnSerial = 0;

  private readonly xWorld = new Float32Array(MAX_LIFE_MOTES);
  private readonly yWorld = new Float32Array(MAX_LIFE_MOTES);
  private readonly velocityXWorld = new Float32Array(MAX_LIFE_MOTES);
  private readonly velocityYWorld = new Float32Array(MAX_LIFE_MOTES);
  private readonly separationX = new Float32Array(MAX_LIFE_MOTES);
  private readonly separationY = new Float32Array(MAX_LIFE_MOTES);
  private readonly preferredOffsetX = new Float32Array(MAX_LIFE_MOTES);
  private readonly preferredOffsetY = new Float32Array(MAX_LIFE_MOTES);
  private readonly phase = new Float32Array(MAX_LIFE_MOTES);
  private readonly waveAmplitudeWorld = new Float32Array(MAX_LIFE_MOTES);
  private readonly waveAngularSpeed = new Float32Array(MAX_LIFE_MOTES);
  private readonly secondaryWavePhase = new Float32Array(MAX_LIFE_MOTES);
  private readonly baseDelaySamples = new Float32Array(MAX_LIFE_MOTES);
  private readonly delayVariationSamples = new Float32Array(MAX_LIFE_MOTES);
  private readonly followResponseScale = new Float32Array(MAX_LIFE_MOTES);
  private readonly pathXWorld = new Float32Array(MAX_PLAYER_PATH_SAMPLES);
  private readonly pathYWorld = new Float32Array(MAX_PLAYER_PATH_SAMPLES);
  private pathCount = 0;
  private pathWriteIndex = 0;

  private readonly trailXWorld = new Float32Array(MAX_LIFE_MOTES * STORMWEAVE_TRAIL_SAMPLES_PER_MOTE);
  private readonly trailYWorld = new Float32Array(MAX_LIFE_MOTES * STORMWEAVE_TRAIL_SAMPLES_PER_MOTE);
  private readonly trailTimeSec = new Float32Array(MAX_LIFE_MOTES * STORMWEAVE_TRAIL_SAMPLES_PER_MOTE);
  private readonly trailCountByMote = new Uint8Array(MAX_LIFE_MOTES);
  private readonly trailWriteByMote = new Uint8Array(MAX_LIFE_MOTES);
  private readonly lastTrailSampleTimeSec = new Float32Array(MAX_LIFE_MOTES);
  private readonly trailReadyTimeSec = new Float32Array(MAX_LIFE_MOTES);
  private trailsHighQuality = false;
  private visualIntensity = 0;
  private previousPlayerXWorld = 0;
  private previousPlayerYWorld = 0;
  private hasPreviousPlayerPosition = false;

  get moteCount(): number { return this.count; }
  get trailSampleCount(): number {
    let total = 0;
    for (let i = 0; i < this.count; i++) total += this.getTrailPointCount(i);
    return total;
  }
  get isTrailEmitting(): boolean { return this.trailsHighQuality && this.count > 0; }
  get trailCapacity(): number { return MAX_LIFE_MOTES * STORMWEAVE_TRAIL_SAMPLES_PER_MOTE; }
  get trailIntensity(): number { return this.visualIntensity; }

  getMote(index: number): StormweaveMoteView | undefined {
    if (index < 0 || index >= this.count) return undefined;
    return {
      xWorld: this.xWorld[index],
      yWorld: this.yWorld[index],
      velocityXWorld: this.velocityXWorld[index],
      velocityYWorld: this.velocityYWorld[index],
    };
  }

  /** Test/debug hook; production synchronization still owns the active count. */
  setMoteState(index: number, xWorld: number, yWorld: number, velocityXWorld = 0, velocityYWorld = 0): void {
    if (index < 0 || index >= this.count) return;
    this.xWorld[index] = xWorld;
    this.yWorld[index] = yWorld;
    this.velocityXWorld[index] = velocityXWorld;
    this.velocityYWorld[index] = velocityYWorld;
  }

  forEachMote(visitor: (xWorld: number, yWorld: number, index: number) => void): void {
    for (let i = 0; i < this.count; i++) {
      visitor(this.xWorld[i], this.yWorld[i], i);
    }
  }

  getTrailPointCount(moteIndex: number): number {
    if (moteIndex < 0 || moteIndex >= this.count || !this.trailsHighQuality) return 0;
    const count = this.trailCountByMote[moteIndex];
    let expired = 0;
    while (expired < count && this.getTrailPointAgeSec(moteIndex, expired) >= STORMWEAVE_TRAIL_LIFETIME_SEC) expired++;
    return count - expired;
  }

  getTrailPointXWorld(moteIndex: number, pointIndex: number): number {
    return this.trailXWorld[this.getTrailStorageIndex(moteIndex, pointIndex)];
  }

  getTrailPointYWorld(moteIndex: number, pointIndex: number): number {
    return this.trailYWorld[this.getTrailStorageIndex(moteIndex, pointIndex)];
  }

  getTrailPointAgeSec(moteIndex: number, pointIndex: number): number {
    return Math.max(0, this.elapsedSec - this.trailTimeSec[this.getTrailStorageIndex(moteIndex, pointIndex)]);
  }

  reset(playerXWorld = 0, playerYWorld = 0, fullContainerCount = 0): void {
    this.count = 0;
    this.elapsedSec = 0;
    this.clearTrails();
    this.visualIntensity = 0;
    this.previousPlayerXWorld = playerXWorld;
    this.previousPlayerYWorld = playerYWorld;
    this.hasPreviousPlayerPosition = true;
    this.pathCount = 0;
    this.pathWriteIndex = 0;
    this.recordPlayerPath(playerXWorld, playerYWorld);
    this.reconcile(fullContainerCount, playerXWorld, playerYWorld);
  }

  reconcile(fullContainerCount: number, playerXWorld: number, playerYWorld: number): void {
    const targetCount = Math.max(0, Math.min(MAX_LIFE_MOTES, Math.floor(fullContainerCount)));
    while (this.count < targetCount) {
      const i = this.count++;
      this.trailCountByMote[i] = 0;
      this.trailWriteByMote[i] = 0;
      this.lastTrailSampleTimeSec[i] = this.elapsedSec;
      this.trailReadyTimeSec[i] = this.elapsedSec + TRAIL_REBASE_DURATION_SEC;
      const serial = this.spawnSerial++;
      const [ux, uy] = deterministicUnit(i, serial);
      const spawnRadius = 22 + ((serial * 11 + i * 7) % 13);
      this.xWorld[i] = playerXWorld + ux * spawnRadius;
      this.yWorld[i] = playerYWorld + uy * spawnRadius;
      this.velocityXWorld[i] = -uy * 9;
      this.velocityYWorld[i] = ux * 9;

      const preferredRadius = 5.5 + ((i * 17 + serial * 3) % 15) * 0.42;
      const [offsetX, offsetY] = deterministicUnit(i, serial + 19);
      this.preferredOffsetX[i] = offsetX * preferredRadius;
      this.preferredOffsetY[i] = offsetY * preferredRadius;
      this.phase[i] = ((i * 37 + serial * 13) % 101) / 101 * Math.PI * 2;
      this.waveAmplitudeWorld[i] = 3.8 + ((i * 11 + serial * 7) % 17) * 0.28;
      this.waveAngularSpeed[i] = 0.72 + ((i * 5 + serial * 11) % 13) * 0.105;
      this.secondaryWavePhase[i] = ((i * 29 + serial * 17) % 97) / 97 * Math.PI * 2;
      this.baseDelaySamples[i] = 4 + ((i * 19 + serial * 23) % 32);
      this.delayVariationSamples[i] = 2 + ((i * 7 + serial * 5) % 8) * 0.6;
      this.followResponseScale[i] = 0.72 + ((i * 13 + serial * 3) % 15) * 0.04;
    }
    while (this.count > targetCount) {
      this.count--;
      this.trailCountByMote[this.count] = 0;
      this.trailWriteByMote[this.count] = 0;
    }
  }

  update(
    dtSec: number,
    playerXWorld: number,
    playerYWorld: number,
    playerVelocityXWorld: number,
    playerVelocityYWorld: number,
    enableHighQualityTrails: boolean,
    shieldGeometry?: ShieldArcGeometry,
  ): void {
    const dt = Math.max(0, Math.min(dtSec, 0.05));
    if (dt <= 0) return;
    this.elapsedSec += dt;
    if (this.hasPreviousPlayerPosition && Math.hypot(
      playerXWorld - this.previousPlayerXWorld,
      playerYWorld - this.previousPlayerYWorld,
    ) > PLAYER_DISCONTINUITY_DISTANCE_WORLD) {
      this.clearTrails();
    }
    this.previousPlayerXWorld = playerXWorld;
    this.previousPlayerYWorld = playerYWorld;
    this.hasPreviousPlayerPosition = true;
    if (this.trailsHighQuality !== enableHighQualityTrails) {
      this.clearTrails();
      this.trailsHighQuality = enableHighQualityTrails;
    }
    const targetIntensity = getStormweaveTrailTargetIntensity(playerVelocityXWorld, playerVelocityYWorld);
    if (targetIntensity > this.visualIntensity) {
      this.visualIntensity = Math.min(targetIntensity, this.visualIntensity + dt / STORMWEAVE_GLOW_ATTACK_SEC);
    } else {
      this.visualIntensity += (targetIntensity - this.visualIntensity) * (1 - Math.exp(-7 * dt));
    }
    this.recordPlayerPath(playerXWorld, playerYWorld);
    this.separationX.fill(0, 0, this.count);
    this.separationY.fill(0, 0, this.count);

    const isShieldActive = shieldGeometry?.isActive === true && shieldGeometry.moteCount === this.count;
    const separationRadiusSq = SEPARATION_RADIUS_WORLD * SEPARATION_RADIUS_WORLD;
    if (!isShieldActive) for (let i = 0; i < this.count; i++) {
      for (let j = i + 1; j < this.count; j++) {
        let dx = this.xWorld[i] - this.xWorld[j];
        let dy = this.yWorld[i] - this.yWorld[j];
        let distanceSq = dx * dx + dy * dy;
        if (distanceSq >= separationRadiusSq) continue;
        if (distanceSq < 0.000001) {
          [dx, dy] = deterministicUnit(i, j);
          distanceSq = 1;
        }
        const distance = Math.sqrt(distanceSq);
        const overlapT = 1 - Math.min(1, distance / SEPARATION_RADIUS_WORLD);
        const accel = overlapT * overlapT * SEPARATION_ACCEL_PER_SEC2;
        const nx = dx / distance;
        const ny = dy / distance;
        this.separationX[i] += nx * accel;
        this.separationY[i] += ny * accel;
        this.separationX[j] -= nx * accel;
        this.separationY[j] -= ny * accel;
      }
    }

    const damping = Math.exp(-VELOCITY_DAMPING_PER_SEC * dt);
    for (let i = 0; i < this.count; i++) {
      const phase = this.phase[i] + this.elapsedSec * this.waveAngularSpeed[i];
      const shieldAngle = isShieldActive ? getShieldMoteAngleRad(shieldGeometry, i) : 0;
      const livingOffset = isShieldActive ? Math.sin(phase) * 0.22 : 0;
      const delaySamples = this.baseDelaySamples[i]
        + Math.sin(phase * 0.31 + this.secondaryWavePhase[i]) * this.delayVariationSamples[i];
      const pathTarget = this.samplePlayerPath(delaySamples);
      const olderPathTarget = this.samplePlayerPath(delaySamples + 2);
      const pathDx = pathTarget[0] - olderPathTarget[0];
      const pathDy = pathTarget[1] - olderPathTarget[1];
      const pathLength = Math.hypot(pathDx, pathDy);
      const perpendicularX = pathLength > 0.0001 ? -pathDy / pathLength : 0;
      const perpendicularY = pathLength > 0.0001 ? pathDx / pathLength : 1;
      const waveOffset = this.waveAmplitudeWorld[i] * (
        Math.sin(phase) + Math.sin(phase * 0.43 + this.secondaryWavePhase[i]) * 0.38
      );
      const targetX = isShieldActive
        ? shieldGeometry.centerXWorld + Math.cos(shieldAngle) * (shieldGeometry.radiusWorld + livingOffset)
        : pathTarget[0] + this.preferredOffsetX[i] * 0.22 + perpendicularX * waveOffset;
      const targetY = isShieldActive
        ? shieldGeometry.centerYWorld + Math.sin(shieldAngle) * (shieldGeometry.radiusWorld + livingOffset)
        : pathTarget[1] + this.preferredOffsetY[i] * 0.22 + perpendicularY * waveOffset;
      const dx = targetX - this.xWorld[i];
      const dy = targetY - this.yWorld[i];
      const distance = Math.hypot(dx, dy);
      const attraction = isShieldActive
        ? distance * 28
        : getStormweaveAttractionAcceleration(distance) * this.followResponseScale[i];
      if (distance > 0.000001) {
        this.velocityXWorld[i] += (dx / distance * attraction + this.separationX[i]) * dt;
        this.velocityYWorld[i] += (dy / distance * attraction + this.separationY[i]) * dt;
      } else {
        this.velocityXWorld[i] += this.separationX[i] * dt;
        this.velocityYWorld[i] += this.separationY[i] * dt;
      }
      this.velocityXWorld[i] *= damping;
      this.velocityYWorld[i] *= damping;
      const speed = Math.hypot(this.velocityXWorld[i], this.velocityYWorld[i]);
      const maxCatchUpSpeed = MAX_CATCH_UP_SPEED_WORLD_PER_SEC * this.followResponseScale[i];
      if (speed > maxCatchUpSpeed) {
        const scale = maxCatchUpSpeed / speed;
        this.velocityXWorld[i] *= scale;
        this.velocityYWorld[i] *= scale;
      }
      this.xWorld[i] += this.velocityXWorld[i] * dt;
      this.yWorld[i] += this.velocityYWorld[i] * dt;
    }

    if (this.trailsHighQuality) for (let i = 0; i < this.count; i++) this.sampleMoteTrail(i);
  }

  clearTrails(): void {
    this.trailCountByMote.fill(0);
    this.trailWriteByMote.fill(0);
    this.lastTrailSampleTimeSec.fill(this.elapsedSec);
    this.trailReadyTimeSec.fill(this.elapsedSec + TRAIL_REBASE_DURATION_SEC);
  }

  private sampleMoteTrail(moteIndex: number): void {
    if (this.elapsedSec < this.trailReadyTimeSec[moteIndex]) {
      this.trailCountByMote[moteIndex] = 0;
      this.trailWriteByMote[moteIndex] = 0;
      this.lastTrailSampleTimeSec[moteIndex] = this.elapsedSec;
      return;
    }
    const count = this.trailCountByMote[moteIndex];
    let shouldSample = count === 0;
    if (!shouldSample) {
      const newest = this.getTrailStorageIndex(moteIndex, count - 1);
      const distance = Math.hypot(this.xWorld[moteIndex] - this.trailXWorld[newest], this.yWorld[moteIndex] - this.trailYWorld[newest]);
      if (distance > TRAIL_SAMPLE_DISCONTINUITY_WORLD) {
        this.trailCountByMote[moteIndex] = 0;
        this.trailWriteByMote[moteIndex] = 0;
        this.lastTrailSampleTimeSec[moteIndex] = this.elapsedSec;
        this.writeMoteTrailSample(moteIndex, 0);
        return;
      }
      shouldSample = distance >= STORMWEAVE_TRAIL_SAMPLE_SPACING_WORLD
        || this.elapsedSec - this.lastTrailSampleTimeSec[moteIndex] >= TRAIL_STATIONARY_SAMPLE_INTERVAL_SEC;
    }
    if (!shouldSample) return;
    this.writeMoteTrailSample(moteIndex, count);
  }

  private writeMoteTrailSample(moteIndex: number, count: number): void {
    const local = this.trailWriteByMote[moteIndex];
    const storage = moteIndex * STORMWEAVE_TRAIL_SAMPLES_PER_MOTE + local;
    this.trailXWorld[storage] = this.xWorld[moteIndex];
    this.trailYWorld[storage] = this.yWorld[moteIndex];
    this.trailTimeSec[storage] = this.elapsedSec;
    this.trailWriteByMote[moteIndex] = (local + 1) % STORMWEAVE_TRAIL_SAMPLES_PER_MOTE;
    this.trailCountByMote[moteIndex] = Math.min(count + 1, STORMWEAVE_TRAIL_SAMPLES_PER_MOTE);
    this.lastTrailSampleTimeSec[moteIndex] = this.elapsedSec;
  }

  private getTrailStorageIndex(moteIndex: number, pointIndex: number): number {
    const count = this.trailCountByMote[moteIndex];
    let expired = 0;
    while (expired < count) {
      const local = (this.trailWriteByMote[moteIndex] - count + expired + STORMWEAVE_TRAIL_SAMPLES_PER_MOTE)
        % STORMWEAVE_TRAIL_SAMPLES_PER_MOTE;
      const storage = moteIndex * STORMWEAVE_TRAIL_SAMPLES_PER_MOTE + local;
      if (this.elapsedSec - this.trailTimeSec[storage] < STORMWEAVE_TRAIL_LIFETIME_SEC) break;
      expired++;
    }
    const local = (this.trailWriteByMote[moteIndex] - count + expired + pointIndex + STORMWEAVE_TRAIL_SAMPLES_PER_MOTE)
      % STORMWEAVE_TRAIL_SAMPLES_PER_MOTE;
    return moteIndex * STORMWEAVE_TRAIL_SAMPLES_PER_MOTE + local;
  }

  private recordPlayerPath(xWorld: number, yWorld: number): void {
    this.pathXWorld[this.pathWriteIndex] = xWorld;
    this.pathYWorld[this.pathWriteIndex] = yWorld;
    this.pathWriteIndex = (this.pathWriteIndex + 1) % MAX_PLAYER_PATH_SAMPLES;
    this.pathCount = Math.min(this.pathCount + 1, MAX_PLAYER_PATH_SAMPLES);
  }

  private samplePlayerPath(samplesAgo: number): [number, number] {
    const clamped = Math.max(0, Math.min(samplesAgo, this.pathCount - 1));
    const whole = Math.floor(clamped);
    const fraction = clamped - whole;
    const newerIndex = (this.pathWriteIndex - 1 - whole + MAX_PLAYER_PATH_SAMPLES) % MAX_PLAYER_PATH_SAMPLES;
    const olderIndex = (newerIndex - 1 + MAX_PLAYER_PATH_SAMPLES) % MAX_PLAYER_PATH_SAMPLES;
    return [
      this.pathXWorld[newerIndex] + (this.pathXWorld[olderIndex] - this.pathXWorld[newerIndex]) * fraction,
      this.pathYWorld[newerIndex] + (this.pathYWorld[olderIndex] - this.pathYWorld[newerIndex]) * fraction,
    ];
  }
}
