/**
 * Deterministic runtime simulation for Stormweave's life-mote cloud.
 *
 * The cloud is visual state derived from canonical player health. It is not
 * serialized and never owns or mutates gameplay life.
 */

import { getShieldMoteAngleRad, type ShieldArcGeometry } from './shieldWeave';

export const LIFE_DUST_UNITS_PER_CONTAINER = 4;
export const STORMWEAVE_RESTING_REGION_WORLD = 15;

const MAX_LIFE_MOTES = 32;
const MAX_TRAIL_SAMPLES = 192;
const TRAIL_LIFETIME_SEC = 0.38;
const ATTRACTION_PER_SEC2 = 7.5;
const VELOCITY_DAMPING_PER_SEC = 4.8;
const MAX_CATCH_UP_SPEED_WORLD_PER_SEC = 155;
const SEPARATION_RADIUS_WORLD = 7;
const SEPARATION_ACCEL_PER_SEC2 = 72;

export function getFullLifeContainerCount(healthPoints: number): number {
  if (!Number.isFinite(healthPoints) || healthPoints <= 0) return 0;
  return Math.min(MAX_LIFE_MOTES, Math.floor(healthPoints / LIFE_DUST_UNITS_PER_CONTAINER));
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

export interface StormweaveTrailView {
  readonly xWorld: number;
  readonly yWorld: number;
  readonly lifeFraction: number;
  readonly intensity: number;
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

  private readonly trailXWorld = new Float32Array(MAX_TRAIL_SAMPLES);
  private readonly trailYWorld = new Float32Array(MAX_TRAIL_SAMPLES);
  private readonly trailAgeSec = new Float32Array(MAX_TRAIL_SAMPLES);
  private readonly trailIntensity = new Float32Array(MAX_TRAIL_SAMPLES);
  private trailCount = 0;
  private trailWriteIndex = 0;
  private trailEmitting = false;

  get moteCount(): number { return this.count; }
  get trailSampleCount(): number { return this.trailCount; }
  get isTrailEmitting(): boolean { return this.trailEmitting; }
  get trailCapacity(): number { return MAX_TRAIL_SAMPLES; }

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

  forEachTrail(visitor: (xWorld: number, yWorld: number, lifeFraction: number, intensity: number) => void): void {
    for (let n = 0; n < this.trailCount; n++) {
      const i = (this.trailWriteIndex - 1 - n + MAX_TRAIL_SAMPLES) % MAX_TRAIL_SAMPLES;
      const age = this.trailAgeSec[i];
      if (age >= TRAIL_LIFETIME_SEC) continue;
      visitor(this.trailXWorld[i], this.trailYWorld[i], 1 - age / TRAIL_LIFETIME_SEC, this.trailIntensity[i]);
    }
  }

  reset(playerXWorld = 0, playerYWorld = 0, fullContainerCount = 0): void {
    this.count = 0;
    this.elapsedSec = 0;
    this.trailCount = 0;
    this.trailWriteIndex = 0;
    this.trailEmitting = false;
    this.reconcile(fullContainerCount, playerXWorld, playerYWorld);
  }

  reconcile(fullContainerCount: number, playerXWorld: number, playerYWorld: number): void {
    const targetCount = Math.max(0, Math.min(MAX_LIFE_MOTES, Math.floor(fullContainerCount)));
    while (this.count < targetCount) {
      const i = this.count++;
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
    }
    if (this.count > targetCount) this.count = targetCount;
  }

  update(
    dtSec: number,
    playerXWorld: number,
    playerYWorld: number,
    playerVelocityXWorld: number,
    playerVelocityYWorld: number,
    isAtInvulnerabilitySpeed: boolean,
    shieldGeometry?: ShieldArcGeometry,
  ): void {
    const dt = Math.max(0, Math.min(dtSec, 0.05));
    if (dt <= 0) return;
    this.elapsedSec += dt;
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
      const phase = this.phase[i] + this.elapsedSec * (0.42 + (i % 3) * 0.07);
      const shieldAngle = isShieldActive ? getShieldMoteAngleRad(shieldGeometry, i) : 0;
      const livingOffset = isShieldActive ? Math.sin(phase) * 0.22 : 0;
      const targetX = isShieldActive
        ? shieldGeometry.centerXWorld + Math.cos(shieldAngle) * (shieldGeometry.radiusWorld + livingOffset)
        : playerXWorld + this.preferredOffsetX[i] + Math.cos(phase) * 0.7;
      const targetY = isShieldActive
        ? shieldGeometry.centerYWorld + Math.sin(shieldAngle) * (shieldGeometry.radiusWorld + livingOffset)
        : playerYWorld + this.preferredOffsetY[i] + Math.sin(phase * 0.91) * 0.7;
      const dx = targetX - this.xWorld[i];
      const dy = targetY - this.yWorld[i];
      const distance = Math.hypot(dx, dy);
      const attraction = isShieldActive ? distance * 28 : getStormweaveAttractionAcceleration(distance);
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
      if (speed > MAX_CATCH_UP_SPEED_WORLD_PER_SEC) {
        const scale = MAX_CATCH_UP_SPEED_WORLD_PER_SEC / speed;
        this.velocityXWorld[i] *= scale;
        this.velocityYWorld[i] *= scale;
      }
      this.xWorld[i] += this.velocityXWorld[i] * dt;
      this.yWorld[i] += this.velocityYWorld[i] * dt;
    }

    for (let i = 0; i < this.trailCount; i++) this.trailAgeSec[i] += dt;
    this.trailEmitting = isAtInvulnerabilitySpeed && this.count > 0;
    if (this.trailEmitting) {
      const speedFactor = Math.min(1, Math.hypot(playerVelocityXWorld, playerVelocityYWorld) / 400);
      const intensity = 0.55 + speedFactor * 0.45;
      for (let i = 0; i < this.count; i++) {
        const slot = this.trailWriteIndex;
        this.trailXWorld[slot] = this.xWorld[i];
        this.trailYWorld[slot] = this.yWorld[i];
        this.trailAgeSec[slot] = 0;
        this.trailIntensity[slot] = intensity;
        this.trailWriteIndex = (slot + 1) % MAX_TRAIL_SAMPLES;
        this.trailCount = Math.min(this.trailCount + 1, MAX_TRAIL_SAMPLES);
      }
    }
  }
}
