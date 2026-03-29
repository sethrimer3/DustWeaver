/**
 * Skill tomb in-game renderer.
 *
 * Draws the skill_tomb.png sprite and manages golden dust particles:
 *   - When the player is nearby: golden dust pixels swirl around the tomb
 *   - When the player leaves: dust turns dull gold and falls to the ground
 *
 * Also draws the "Press F to interact" prompt when the player is close.
 */

import { BLOCK_SIZE_WORLD } from '../levels/roomDef';

const BASE = import.meta.env.BASE_URL;

/** Distance in world units within which the tomb activates. */
export const SKILL_TOMB_INTERACT_RADIUS_WORLD = 3 * BLOCK_SIZE_WORLD;

/** Number of decorative dust particles per tomb. */
const DUST_PARTICLE_COUNT = 24;

/** Max number of skill tombs supported per room. */
const MAX_TOMBS = 8;

/** Ground level relative to tomb center (world units below). */
const GROUND_OFFSET_WORLD = 15;

/** Horizontal friction applied per second while a dust particle slides on the floor. */
const FLOOR_FRICTION_PER_SEC = 6.0;

/** Physical contact radius of each dust particle for collision resolution (world units). */
const DUST_CONTACT_RADIUS_WORLD = 2.0;

/** Outward launch speed (world units/sec) given to dust particles when swirl deactivates. */
const DUST_FALL_LAUNCH_SPEED_WORLD = 18.0;

/** Rendered size of each dust particle in screen pixels (uniform, 2×2). */
const DUST_PIXEL_SIZE = 2;

interface DustParticle {
  /** Current position relative to tomb center (world units). */
  xWorld: number;
  yWorld: number;
  /** Velocity (world units per second). */
  vxWorld: number;
  vyWorld: number;
  /** Swirl angle (radians). */
  angleRad: number;
  /** Swirl radius (world units). */
  radiusWorld: number;
  /** Particle size in world units. */
  sizeWorld: number;
  /** Current brightness 0..1 (1 = bright gold, 0 = dull). */
  brightness: number;
  /** Is this particle "grounded" (fallen to a heap)? */
  isGroundedFlag: boolean;
}

interface TombState {
  xWorld: number;
  yWorld: number;
  /** Is the player currently nearby? */
  isPlayerNearbyFlag: boolean;
  /** Transition factor 0..1 (1 = fully active/swirling, 0 = fully grounded). */
  activationFactor: number;
  /** Activation factor from the previous update — used to detect swirl→fall transition. */
  prevActivationFactor: number;
  /** Decorative dust particles. */
  dustParticles: DustParticle[];
  /** Accumulator for swirl animation. */
  swirlAngleRad: number;
}

export class SkillTombRenderer {
  private readonly tombSprite: HTMLImageElement;
  private readonly tombStates: TombState[] = [];
  private isSpriteLoaded = false;

  constructor() {
    this.tombSprite = new Image();
    this.tombSprite.src = `${BASE}SPRITES/WORLDS/W-0/skill_tomb.png`;
    this.tombSprite.onload = () => { this.isSpriteLoaded = true; };
  }

  /** Initialise tomb states for a new room. */
  init(tombs: readonly { xBlock: number; yBlock: number }[]): void {
    this.tombStates.length = 0;
    const count = Math.min(tombs.length, MAX_TOMBS);
    for (let i = 0; i < count; i++) {
      const centerXWorld = (tombs[i].xBlock + 0.5) * BLOCK_SIZE_WORLD;
      const centerYWorld = (tombs[i].yBlock + 0.5) * BLOCK_SIZE_WORLD;

      const particles: DustParticle[] = [];
      for (let p = 0; p < DUST_PARTICLE_COUNT; p++) {
        const angle = (p / DUST_PARTICLE_COUNT) * Math.PI * 2;
        const radius = 8 + Math.random() * 12;
        particles.push({
          xWorld: Math.cos(angle) * radius,
          yWorld: Math.sin(angle) * radius,
          vxWorld: 0,
          vyWorld: 0,
          angleRad: angle,
          radiusWorld: radius,
          sizeWorld: 1.0,
          brightness: 0.3,
          isGroundedFlag: true,
        });
      }

      this.tombStates.push({
        xWorld: centerXWorld,
        yWorld: centerYWorld,
        isPlayerNearbyFlag: false,
        activationFactor: 0,
        prevActivationFactor: 0,
        dustParticles: particles,
        swirlAngleRad: 0,
      });
    }
  }

  /** Update tomb dust animations each frame. */
  update(
    playerXWorld: number,
    playerYWorld: number,
    dtSec: number,
  ): void {
    for (let t = 0; t < this.tombStates.length; t++) {
      const tomb = this.tombStates[t];
      const dx = playerXWorld - tomb.xWorld;
      const dy = playerYWorld - tomb.yWorld;
      const distSq = dx * dx + dy * dy;
      const isNearby = distSq < SKILL_TOMB_INTERACT_RADIUS_WORLD * SKILL_TOMB_INTERACT_RADIUS_WORLD;

      tomb.isPlayerNearbyFlag = isNearby;

      // Smoothly transition activation factor
      const targetFactor = isNearby ? 1.0 : 0.0;
      const transitionSpeed = 2.0; // factor units per second
      if (tomb.activationFactor < targetFactor) {
        tomb.activationFactor = Math.min(targetFactor, tomb.activationFactor + transitionSpeed * dtSec);
      } else {
        tomb.activationFactor = Math.max(targetFactor, tomb.activationFactor - transitionSpeed * dtSec);
      }

      tomb.swirlAngleRad += dtSec * 1.5;

      // Detect swirl→fall transition (activation just dropped below threshold)
      const prevActivation = tomb.prevActivationFactor;
      tomb.prevActivationFactor = tomb.activationFactor;
      const justDeactivated = prevActivation > 0.1 && tomb.activationFactor <= 0.1;

      // When swirl deactivates, launch particles outward so they spread and pile up
      if (justDeactivated) {
        for (let p = 0; p < tomb.dustParticles.length; p++) {
          const dp = tomb.dustParticles[p];
          const len = Math.sqrt(dp.xWorld * dp.xWorld + dp.yWorld * dp.yWorld);
          if (len > 0.001) {
            dp.vxWorld = (dp.xWorld / len) * DUST_FALL_LAUNCH_SPEED_WORLD;
            dp.vyWorld = 0;
          }
        }
      }

      // Update dust particles
      for (let p = 0; p < tomb.dustParticles.length; p++) {
        const dp = tomb.dustParticles[p];

        if (tomb.activationFactor > 0.1) {
          // Swirling mode
          dp.isGroundedFlag = false;
          dp.angleRad += dtSec * (1.2 + p * 0.05);
          const targetX = Math.cos(dp.angleRad) * dp.radiusWorld;
          const targetY = Math.sin(dp.angleRad) * dp.radiusWorld * 0.6; // slight vertical squish
          dp.xWorld += (targetX - dp.xWorld) * Math.min(1, 4.0 * dtSec);
          dp.yWorld += (targetY - dp.yWorld) * Math.min(1, 4.0 * dtSec);
          dp.brightness = 0.7 + 0.3 * tomb.activationFactor;
        } else {
          // Falling / grounded mode
          if (!dp.isGroundedFlag) {
            dp.vyWorld += 40 * dtSec; // gravity
            dp.xWorld += dp.vxWorld * dtSec;
            dp.yWorld += dp.vyWorld * dtSec;

            // Ground collision
            if (dp.yWorld > GROUND_OFFSET_WORLD) {
              dp.yWorld = GROUND_OFFSET_WORLD;
              dp.vyWorld *= -0.15; // small bounce
              if (Math.abs(dp.vyWorld) < 2) dp.vyWorld = 0;
              dp.isGroundedFlag = true;
            }
          }

          // Floor friction (applied every tick when grounded or just landed)
          if (dp.isGroundedFlag) {
            dp.yWorld = GROUND_OFFSET_WORLD; // keep pinned to floor
            dp.vxWorld *= Math.max(0, 1 - FLOOR_FRICTION_PER_SEC * dtSec);
            if (Math.abs(dp.vxWorld) < 0.3) dp.vxWorld = 0;
          }

          dp.brightness = Math.max(0.2, dp.brightness - 0.5 * dtSec);
        }
      }

      // Particle-particle collision resolution when not swirling
      if (tomb.activationFactor <= 0.1) {
        const contactDist = DUST_CONTACT_RADIUS_WORLD * 2;
        const contactDistSq = contactDist * contactDist;
        for (let particleIndexA = 0; particleIndexA < tomb.dustParticles.length; particleIndexA++) {
          const particleA = tomb.dustParticles[particleIndexA];
          for (let particleIndexB = particleIndexA + 1; particleIndexB < tomb.dustParticles.length; particleIndexB++) {
            const particleB = tomb.dustParticles[particleIndexB];
            const dx = particleB.xWorld - particleA.xWorld;
            const dy = particleB.yWorld - particleA.yWorld;
            const distSq = dx * dx + dy * dy;
            if (distSq >= contactDistSq || distSq < 0.0001) continue;
            const dist = Math.sqrt(distSq);
            const overlap = contactDist - dist;
            const nx = dx / dist;
            const ny = dy / dist;

            if (particleA.isGroundedFlag && particleB.isGroundedFlag) {
              // Both grounded: push apart horizontally only
              particleA.xWorld -= nx * overlap * 0.5;
              particleB.xWorld += nx * overlap * 0.5;
            } else {
              // At least one is airborne: full 2D push + velocity response
              particleA.xWorld -= nx * overlap * 0.5;
              particleA.yWorld -= ny * overlap * 0.5;
              particleB.xWorld += nx * overlap * 0.5;
              particleB.yWorld += ny * overlap * 0.5;
              const relVn = (particleB.vxWorld - particleA.vxWorld) * nx + (particleB.vyWorld - particleA.vyWorld) * ny;
              if (relVn < 0) {
                const impulse = relVn * 0.3;
                particleA.vxWorld += impulse * nx;
                particleA.vyWorld += impulse * ny;
                particleB.vxWorld -= impulse * nx;
                particleB.vyWorld -= impulse * ny;
              }
            }
          }
        }
      }
    }
  }

  /** Returns the index of the tomb the player can interact with, or -1. */
  getNearbyTombIndex(playerXWorld: number, playerYWorld: number): number {
    for (let t = 0; t < this.tombStates.length; t++) {
      const tomb = this.tombStates[t];
      const dx = playerXWorld - tomb.xWorld;
      const dy = playerYWorld - tomb.yWorld;
      const distSq = dx * dx + dy * dy;
      if (distSq < SKILL_TOMB_INTERACT_RADIUS_WORLD * SKILL_TOMB_INTERACT_RADIUS_WORLD) {
        return t;
      }
    }
    return -1;
  }

  /** Get the position of a tomb by index. */
  getTombPosition(index: number): { xWorld: number; yWorld: number } | null {
    const tomb = this.tombStates[index];
    if (!tomb) return null;
    return { xWorld: tomb.xWorld, yWorld: tomb.yWorld };
  }

  /** Render all tombs and their dust particles. */
  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
  ): void {
    for (let t = 0; t < this.tombStates.length; t++) {
      const tomb = this.tombStates[t];

      const screenX = tomb.xWorld * zoom + offsetXPx;
      const screenY = tomb.yWorld * zoom + offsetYPx;

      // Draw sprite
      if (this.isSpriteLoaded) {
        const spriteW = BLOCK_SIZE_WORLD * zoom;
        const spriteH = BLOCK_SIZE_WORLD * zoom;
        ctx.drawImage(
          this.tombSprite,
          screenX - spriteW / 2,
          screenY - spriteH / 2,
          spriteW,
          spriteH,
        );
      }

      // Draw dust particles
      for (let p = 0; p < tomb.dustParticles.length; p++) {
        const dp = tomb.dustParticles[p];
        const px = (tomb.xWorld + dp.xWorld) * zoom + offsetXPx;
        const py = (tomb.yWorld + dp.yWorld) * zoom + offsetYPx;
        const size = DUST_PIXEL_SIZE;

        // Interpolate between dull gold and bright gold based on brightness
        const r = Math.round(180 + 32 * dp.brightness);
        const g = Math.round(140 + 28 * dp.brightness);
        const b = Math.round(40 + 35 * dp.brightness);
        const alpha = 0.5 + 0.5 * dp.brightness;

        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }

      // Draw interact prompt
      if (tomb.isPlayerNearbyFlag) {
        ctx.save();
        ctx.font = `${14 * (zoom / 2.8)}px 'Cinzel', serif`;
        ctx.fillStyle = `rgba(212,168,75,${0.6 + 0.4 * tomb.activationFactor})`;
        ctx.textAlign = 'center';
        ctx.fillText('Press F to interact', screenX, screenY - BLOCK_SIZE_WORLD * zoom * 0.8);
        ctx.restore();
      }
    }
  }
}
