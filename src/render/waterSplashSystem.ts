/**
 * Bounded cosmetic water-surface ripple simulation.
 *
 * State is render-only and never feeds back into WorldState. Ripples attach to
 * one exposed top-edge run so they cannot cross gaps between disconnected water
 * bodies or continue through unrelated geometry.
 */

import {
  PLAYER_WATER_STATE_SURFACE,
  type PlayerWaterState,
} from '../sim/clusters/playerWaterPhysics';
import type { LiquidBody } from './liquidBodyCache';

export const WATER_RIPPLE_LIFETIME_SEC = 1.35;
export const WATER_RIPPLE_PROPAGATION_SPEED_WORLD_PER_SEC = 72;
export const WATER_RIPPLE_BASE_AMPLITUDE_WORLD = 0.65;
export const WATER_RIPPLE_VELOCITY_TO_AMPLITUDE = 0.012;
export const WATER_RIPPLE_MAX_AMPLITUDE_WORLD = 3.5;
export const WATER_RIPPLE_MIN_DISTURBANCE_SPEED_WORLD = 20;
export const WATER_RIPPLE_MAX_DIRECTION_BIAS = 0.45;
export const WATER_RIPPLE_DIRECTION_BIAS_PER_SPEED = 0.004;
export const WATER_RIPPLE_MIN_SURFACE_TRAVEL_WORLD = 8;
export const WATER_RIPPLE_MIN_INTERVAL_SEC = 0.22;
export const MAX_WATER_RIPPLES = 16;

const RIPPLE_SPATIAL_FREQUENCY = 0.42;
const RIPPLE_TRAIN_LENGTH_WORLD = 22;
const SURFACE_ROW_MATCH_TOLERANCE_WORLD = 0.5;
const SURFACE_RUN_CONTACT_TOLERANCE_WORLD = 8;

export interface WaterSurfaceDisturbance {
  active: 0 | 1;
  xWorld: number;
  surfaceYWorld: number;
  surfaceMinXWorld: number;
  surfaceMaxXWorld: number;
  leftAmplitudeWorld: number;
  rightAmplitudeWorld: number;
  ageSec: number;
  lifetimeSec: number;
  radiusWorld: number;
}

export interface WaterRippleSnapshot {
  xWorld: number;
  surfaceYWorld: number;
  surfaceMinXWorld: number;
  surfaceMaxXWorld: number;
  leftAmplitudeWorld: number;
  rightAmplitudeWorld: number;
  ageSec: number;
  lifetimeSec: number;
  radiusWorld: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createInactiveRipple(): WaterSurfaceDisturbance {
  return {
    active: 0,
    xWorld: 0,
    surfaceYWorld: 0,
    surfaceMinXWorld: 0,
    surfaceMaxXWorld: 0,
    leftAmplitudeWorld: 0,
    rightAmplitudeWorld: 0,
    ageSec: 0,
    lifetimeSec: WATER_RIPPLE_LIFETIME_SEC,
    radiusWorld: 0,
  };
}

export class WaterRippleSystem {
  private readonly ripples: WaterSurfaceDisturbance[];
  private activeCountValue = 0;
  private lastUpdatedTick = -1;
  private lastEventSequence = 0;
  private lastSpawnTick = -1_000_000;
  private surfaceTravelAccumulatorWorld = 0;

  constructor(capacity = MAX_WATER_RIPPLES) {
    this.ripples = Array.from({ length: capacity }, createInactiveRipple);
  }

  get activeCount(): number {
    return this.activeCountValue;
  }

  clear(): void {
    for (let i = 0; i < this.ripples.length; i++) this.ripples[i].active = 0;
    this.activeCountValue = 0;
    this.surfaceTravelAccumulatorWorld = 0;
  }

  reset(): void {
    this.clear();
    this.lastUpdatedTick = -1;
    this.lastEventSequence = 0;
    this.lastSpawnTick = -1_000_000;
  }

  private findSurfaceRun(
    bodies: readonly LiquidBody[],
    xWorld: number,
    surfaceYWorld: number,
  ): { minXWorld: number; maxXWorld: number; yWorld: number } | undefined {
    let bestRun: { minXWorld: number; maxXWorld: number; yWorld: number } | undefined;
    let bestDistance = Infinity;
    for (let bi = 0; bi < bodies.length; bi++) {
      const body = bodies[bi];
      if (body.kind !== 'water') continue;
      for (let ri = 0; ri < body.topEdgeRuns.length; ri++) {
        const run = body.topEdgeRuns[ri];
        if (Math.abs(run.yWorld - surfaceYWorld) > SURFACE_ROW_MATCH_TOLERANCE_WORLD) continue;
        const runMaxXWorld = run.xWorld + run.wWorld;
        const distance = xWorld < run.xWorld
          ? run.xWorld - xWorld
          : xWorld > runMaxXWorld
            ? xWorld - runMaxXWorld
            : 0;
        if (distance <= SURFACE_RUN_CONTACT_TOLERANCE_WORLD && distance < bestDistance) {
          bestDistance = distance;
          bestRun = { minXWorld: run.xWorld, maxXWorld: runMaxXWorld, yWorld: run.yWorld };
        }
      }
    }
    return bestRun;
  }

  spawn(
    bodies: readonly LiquidBody[],
    xWorld: number,
    surfaceYWorld: number,
    velocityXWorld: number,
    velocityYWorld: number,
  ): boolean {
    const disturbanceSpeed = Math.hypot(velocityYWorld, velocityXWorld * 0.55);
    if (disturbanceSpeed < WATER_RIPPLE_MIN_DISTURBANCE_SPEED_WORLD) return false;
    const run = this.findSurfaceRun(bodies, xWorld, surfaceYWorld);
    if (run === undefined) return false;

    let slot: WaterSurfaceDisturbance | undefined;
    let oldestAgeRatio = -1;
    for (let i = 0; i < this.ripples.length; i++) {
      const ripple = this.ripples[i];
      if (ripple.active === 0) {
        slot = ripple;
        break;
      }
      const ageRatio = ripple.ageSec / ripple.lifetimeSec;
      if (ageRatio > oldestAgeRatio) {
        oldestAgeRatio = ageRatio;
        slot = ripple;
      }
    }
    if (slot === undefined) return false;
    if (slot.active === 0) this.activeCountValue += 1;

    const amplitude = clamp(
      WATER_RIPPLE_BASE_AMPLITUDE_WORLD
        + (disturbanceSpeed - WATER_RIPPLE_MIN_DISTURBANCE_SPEED_WORLD)
          * WATER_RIPPLE_VELOCITY_TO_AMPLITUDE,
      WATER_RIPPLE_BASE_AMPLITUDE_WORLD,
      WATER_RIPPLE_MAX_AMPLITUDE_WORLD,
    );
    const directionBias = clamp(
      velocityXWorld * WATER_RIPPLE_DIRECTION_BIAS_PER_SPEED,
      -WATER_RIPPLE_MAX_DIRECTION_BIAS,
      WATER_RIPPLE_MAX_DIRECTION_BIAS,
    );

    slot.active = 1;
    slot.xWorld = clamp(xWorld, run.minXWorld, run.maxXWorld);
    slot.surfaceYWorld = run.yWorld;
    slot.surfaceMinXWorld = run.minXWorld;
    slot.surfaceMaxXWorld = run.maxXWorld;
    slot.leftAmplitudeWorld = amplitude * (1 - directionBias);
    slot.rightAmplitudeWorld = amplitude * (1 + directionBias);
    slot.ageSec = 0;
    slot.lifetimeSec = WATER_RIPPLE_LIFETIME_SEC;
    slot.radiusWorld = 0;
    return true;
  }

  advance(dtSec: number): void {
    if (dtSec <= 0) return;
    for (let i = 0; i < this.ripples.length; i++) {
      const ripple = this.ripples[i];
      if (ripple.active === 0) continue;
      ripple.ageSec += dtSec;
      ripple.radiusWorld += WATER_RIPPLE_PROPAGATION_SPEED_WORLD_PER_SEC * dtSec;
      if (ripple.ageSec >= ripple.lifetimeSec) {
        ripple.active = 0;
        this.activeCountValue -= 1;
      }
    }
  }

  updateFromPlayer(
    bodies: readonly LiquidBody[],
    tick: number,
    dtSec: number,
    effectsEnabled: boolean,
    eventSequence: number,
    eventKind: 0 | 1 | 2,
    eventXWorld: number,
    eventSurfaceYWorld: number,
    eventVelocityXWorld: number,
    eventVelocityYWorld: number,
    waterState: PlayerWaterState,
    playerXWorld: number,
    surfaceYWorld: number,
    playerVelocityXWorld: number,
    playerVelocityYWorld: number,
  ): void {
    if (!effectsEnabled) {
      this.clear();
      this.lastUpdatedTick = tick;
      this.lastEventSequence = eventSequence;
      return;
    }
    if (tick === this.lastUpdatedTick) return;

    const elapsedTicks = this.lastUpdatedTick < 0 ? 1 : Math.max(1, tick - this.lastUpdatedTick);
    const elapsedSec = Math.min(0.25, elapsedTicks * dtSec);
    this.lastUpdatedTick = tick;
    this.advance(elapsedSec);

    if (eventSequence !== this.lastEventSequence) {
      this.lastEventSequence = eventSequence;
      if (eventKind !== 0 && this.spawn(
        bodies,
        eventXWorld,
        eventSurfaceYWorld,
        eventVelocityXWorld,
        eventVelocityYWorld,
      )) {
        this.lastSpawnTick = tick;
        this.surfaceTravelAccumulatorWorld = 0;
      }
    }

    if (waterState !== PLAYER_WATER_STATE_SURFACE) {
      this.surfaceTravelAccumulatorWorld = 0;
      return;
    }

    const surfaceMotionSpeed = Math.abs(playerVelocityXWorld)
      + Math.abs(playerVelocityYWorld) * 0.35;
    if (surfaceMotionSpeed < WATER_RIPPLE_MIN_DISTURBANCE_SPEED_WORLD) return;
    this.surfaceTravelAccumulatorWorld += surfaceMotionSpeed * elapsedSec;
    const secondsSinceSpawn = (tick - this.lastSpawnTick) * dtSec;
    if (
      this.surfaceTravelAccumulatorWorld >= WATER_RIPPLE_MIN_SURFACE_TRAVEL_WORLD
      && secondsSinceSpawn >= WATER_RIPPLE_MIN_INTERVAL_SEC
      && this.spawn(
        bodies,
        playerXWorld,
        surfaceYWorld,
        playerVelocityXWorld,
        playerVelocityYWorld,
      )
    ) {
      this.lastSpawnTick = tick;
      this.surfaceTravelAccumulatorWorld = 0;
    }
  }

  getOffsetAt(surfaceXWorld: number, surfaceYWorld: number): number {
    let totalOffset = 0;
    for (let i = 0; i < this.ripples.length; i++) {
      const ripple = this.ripples[i];
      if (ripple.active === 0) continue;
      if (Math.abs(surfaceYWorld - ripple.surfaceYWorld) > SURFACE_ROW_MATCH_TOLERANCE_WORLD) continue;
      if (surfaceXWorld < ripple.surfaceMinXWorld || surfaceXWorld > ripple.surfaceMaxXWorld) continue;

      const signedDistance = surfaceXWorld - ripple.xWorld;
      const distance = Math.abs(signedDistance);
      if (distance > ripple.radiusWorld) continue;
      const distanceBehindFront = ripple.radiusWorld - distance;
      const trainEnvelope = Math.exp(-distanceBehindFront / RIPPLE_TRAIN_LENGTH_WORLD);
      const ageFade = Math.max(0, 1 - ripple.ageSec / ripple.lifetimeSec);
      const amplitude = signedDistance < 0
        ? ripple.leftAmplitudeWorld
        : ripple.rightAmplitudeWorld;
      const wave = Math.cos(distanceBehindFront * RIPPLE_SPATIAL_FREQUENCY);
      totalOffset += amplitude * ageFade * ageFade * trainEnvelope * wave;
    }
    return totalOffset;
  }

  drawHighlights(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
  ): void {
    for (let i = 0; i < this.ripples.length; i++) {
      const ripple = this.ripples[i];
      if (ripple.active === 0) continue;
      const ageFade = Math.max(0, 1 - ripple.ageSec / ripple.lifetimeSec);
      if (ageFade <= 0.02) continue;
      const yPx = Math.round(ripple.surfaceYWorld * zoom + offsetYPx);

      const leftXWorld = Math.max(ripple.surfaceMinXWorld, ripple.xWorld - ripple.radiusWorld);
      const rightXWorld = Math.min(ripple.surfaceMaxXWorld, ripple.xWorld + ripple.radiusWorld);
      const leftLengthPx = Math.max(1, Math.round(ripple.leftAmplitudeWorld * zoom * 1.5));
      const rightLengthPx = Math.max(1, Math.round(ripple.rightAmplitudeWorld * zoom * 1.5));
      const surfaceMinXPx = Math.round(ripple.surfaceMinXWorld * zoom + offsetXPx);
      const surfaceMaxXPx = Math.round(ripple.surfaceMaxXWorld * zoom + offsetXPx);
      const leftFrontXPx = Math.round(leftXWorld * zoom + offsetXPx);
      const rightFrontXPx = Math.round(rightXWorld * zoom + offsetXPx);
      const leftStartXPx = Math.max(surfaceMinXPx, leftFrontXPx - leftLengthPx);
      const rightEndXPx = Math.min(surfaceMaxXPx, rightFrontXPx + rightLengthPx);
      ctx.fillStyle = `rgba(205,238,255,${(ageFade * 0.48).toFixed(2)})`;
      ctx.fillRect(
        leftStartXPx,
        yPx,
        Math.max(1, leftFrontXPx - leftStartXPx),
        1,
      );
      ctx.fillRect(
        rightFrontXPx,
        yPx,
        Math.max(1, rightEndXPx - rightFrontXPx),
        1,
      );
    }
  }

  getSnapshotsForTests(): WaterRippleSnapshot[] {
    const snapshots: WaterRippleSnapshot[] = [];
    for (let i = 0; i < this.ripples.length; i++) {
      const ripple = this.ripples[i];
      if (ripple.active === 0) continue;
      snapshots.push({
        xWorld: ripple.xWorld,
        surfaceYWorld: ripple.surfaceYWorld,
        surfaceMinXWorld: ripple.surfaceMinXWorld,
        surfaceMaxXWorld: ripple.surfaceMaxXWorld,
        leftAmplitudeWorld: ripple.leftAmplitudeWorld,
        rightAmplitudeWorld: ripple.rightAmplitudeWorld,
        ageSec: ripple.ageSec,
        lifetimeSec: ripple.lifetimeSec,
        radiusWorld: ripple.radiusWorld,
      });
    }
    return snapshots;
  }
}

const sharedWaterRippleSystem = new WaterRippleSystem();

export function updateWaterSurfaceRipples(
  bodies: readonly LiquidBody[],
  tick: number,
  dtSec: number,
  effectsEnabled: boolean,
  eventSequence: number,
  eventKind: 0 | 1 | 2,
  eventXWorld: number,
  eventSurfaceYWorld: number,
  eventVelocityXWorld: number,
  eventVelocityYWorld: number,
  waterState: PlayerWaterState,
  playerXWorld: number,
  surfaceYWorld: number,
  playerVelocityXWorld: number,
  playerVelocityYWorld: number,
): void {
  sharedWaterRippleSystem.updateFromPlayer(
    bodies,
    tick,
    dtSec,
    effectsEnabled,
    eventSequence,
    eventKind,
    eventXWorld,
    eventSurfaceYWorld,
    eventVelocityXWorld,
    eventVelocityYWorld,
    waterState,
    playerXWorld,
    surfaceYWorld,
    playerVelocityXWorld,
    playerVelocityYWorld,
  );
}

export function getDisturbanceOffsetAt(surfaceXWorld: number, surfaceYWorld: number): number {
  return sharedWaterRippleSystem.getOffsetAt(surfaceXWorld, surfaceYWorld);
}

export function drawWaterRippleHighlights(
  ctx: CanvasRenderingContext2D,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  sharedWaterRippleSystem.drawHighlights(ctx, offsetXPx, offsetYPx, zoom);
}

export function resetWaterSurfaceRipples(): void {
  sharedWaterRippleSystem.reset();
}
