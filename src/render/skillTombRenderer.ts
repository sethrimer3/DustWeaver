/**
 * Save tomb in-game renderer.
 *
 * Draws the saveTomb.png sprite and manages golden dust particles:
 *   - When the player is nearby: golden dust pixels swirl around the tomb
 *   - When the player leaves: dust turns dull gold and falls onto nearby blocks
 *   - Particles that cannot find a floor within range fade out and respawn
 *
 * Also draws the "Press F to interact" prompt when the player is close.
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { RoomWallDef } from '../levels/roomDef';

const BASE = import.meta.env.BASE_URL;

/** Distance in world units within which the tomb activates. */
export const SKILL_TOMB_INTERACT_RADIUS_WORLD = 3 * BLOCK_SIZE_MEDIUM;

/** Number of decorative dust particles per tomb. */
const DUST_PARTICLE_COUNT = 24;

/** Max number of save tombs supported per room. */
const MAX_TOMBS = 8;

/** Horizontal friction applied per second while a dust particle slides on the floor. */
const FLOOR_FRICTION_PER_SEC = 6.0;

/** Physical contact radius of each dust particle for collision resolution (world units). */
const DUST_CONTACT_RADIUS_WORLD = 2.0;

/** Outward launch speed (world units/sec) given to dust particles when swirl deactivates. */
const DUST_FALL_LAUNCH_SPEED_WORLD = 18.0;

/** Rendered size of each dust particle in screen pixels (uniform, 4×4). */
const DUST_PIXEL_SIZE = 4;
/** Save tomb sprite width in world units (2 small blocks wide). */
const TOMB_SPRITE_WIDTH_WORLD = 2 * BLOCK_SIZE_MEDIUM;
/** Save tomb sprite height in world units (3 small blocks tall). */
const TOMB_SPRITE_HEIGHT_WORLD = 3 * BLOCK_SIZE_MEDIUM;

/**
 * How far below the tomb center (relative Y) a particle may fall before being
 * faded out and respawned at the swirl orbit.
 */
const MAX_FALL_OFFSET_REL_WORLD = 80;

/** Speed at which alpha fades when a particle cannot find a floor (per second). */
const FADE_SPEED_PER_SEC = 1.5;

/**
 * Maximum vertical distance (world units) between a grounded particle and the
 * nearest floor below it before the particle is considered to be off an edge
 * and is ungrounded.  Walls are defined in integer block units so 1.0 is more
 * than enough tolerance for floating-point drift.
 */
const FLOOR_REVALIDATION_THRESHOLD_WORLD = 1.0;

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
  /**
   * Alpha fade scale: 1 = fully visible, 0 = faded out / respawning.
   * Fades to 0 when the particle cannot find a floor within MAX_FALL_OFFSET_REL_WORLD.
   * Fades back to 1 once the tomb re-activates and swirl begins.
   */
  alphaFade: number;
  /** Y-coordinate of the floor this particle landed on (relative to tomb center, world units). */
  groundYRelWorld: number;
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
  /** Precomputed solid wall rectangles in world units (excluding one-way platforms). */
  private wallRects: Array<{ leftWorld: number; rightWorld: number; topWorld: number; bottomWorld: number }> = [];

  constructor() {
    this.tombSprite = new Image();
    this.tombSprite.src = `${BASE}SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/saveTomb.png`;
    this.tombSprite.onload = () => { this.isSpriteLoaded = true; };
  }

  /** Initialise tomb states for a new room. */
  init(tombs: readonly { xBlock: number; yBlock: number }[], walls: readonly RoomWallDef[]): void {
    this.tombStates.length = 0;

    // Precompute solid wall top surfaces for floor detection.
    // Both wall and tomb coordinates use BLOCK_SIZE_MEDIUM (= BLOCK_SIZE_SMALL = 8) as
    // the block-to-world-unit scale, so they inhabit the same coordinate space.
    this.wallRects = walls
      .filter(w => !w.isPlatformFlag)
      .map(w => ({
        leftWorld:   w.xBlock * BLOCK_SIZE_MEDIUM,
        rightWorld:  (w.xBlock + w.wBlock) * BLOCK_SIZE_MEDIUM,
        topWorld:    w.yBlock * BLOCK_SIZE_MEDIUM,
        bottomWorld: (w.yBlock + w.hBlock) * BLOCK_SIZE_MEDIUM,
      }));

    const count = Math.min(tombs.length, MAX_TOMBS);
    for (let i = 0; i < count; i++) {
      const centerXWorld = (tombs[i].xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      const centerYWorld = (tombs[i].yBlock + 0.5) * BLOCK_SIZE_MEDIUM;

      const particles: DustParticle[] = [];
      for (let p = 0; p < DUST_PARTICLE_COUNT; p++) {
        const angle = (p / DUST_PARTICLE_COUNT) * Math.PI * 2;
        const radius = 8 + Math.random() * 12;
        const initY = Math.sin(angle) * radius;
        particles.push({
          xWorld: Math.cos(angle) * radius,
          yWorld: initY,
          vxWorld: 0,
          vyWorld: 0,
          angleRad: angle,
          radiusWorld: radius,
          sizeWorld: 1.0,
          brightness: 0.3,
          isGroundedFlag: true,
          alphaFade: 1.0,
          groundYRelWorld: initY,
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
          dp.isGroundedFlag = false;
        }
      }

      // Update dust particles
      for (let p = 0; p < tomb.dustParticles.length; p++) {
        const dp = tomb.dustParticles[p];

        if (tomb.activationFactor > 0.1) {
          // Swirling mode — fade alphaFade back to 1 so respawned particles reappear
          dp.alphaFade = Math.min(1.0, dp.alphaFade + 2.0 * dtSec);
          dp.isGroundedFlag = false;
          dp.angleRad += dtSec * (1.2 + p * 0.05);
          const targetX = Math.cos(dp.angleRad) * dp.radiusWorld;
          const targetY = Math.sin(dp.angleRad) * dp.radiusWorld * 0.6; // slight vertical squish
          dp.xWorld += (targetX - dp.xWorld) * Math.min(1, 4.0 * dtSec);
          dp.yWorld += (targetY - dp.yWorld) * Math.min(1, 4.0 * dtSec);
          dp.brightness = 0.7 + 0.3 * tomb.activationFactor;
        } else {
          // Falling / grounded mode
          if (!dp.isGroundedFlag && dp.alphaFade > 0) {
            dp.vyWorld += 40 * dtSec; // gravity
            dp.xWorld += dp.vxWorld * dtSec;
            dp.yWorld += dp.vyWorld * dtSec;

            // Dynamic floor detection using actual room walls
            const absX = tomb.xWorld + dp.xWorld;
            const absY = tomb.yWorld + dp.yWorld;
            const floorTopWorld = this.findFloorTopWorld(absX, absY);

            if (floorTopWorld !== null) {
              // Landed on a wall surface
              dp.yWorld = floorTopWorld - tomb.yWorld;
              dp.groundYRelWorld = dp.yWorld;
              dp.vyWorld *= -0.15; // small bounce
              if (Math.abs(dp.vyWorld) < 2) dp.vyWorld = 0;
              dp.isGroundedFlag = true;
            } else if (dp.yWorld > MAX_FALL_OFFSET_REL_WORLD) {
              // Fell too far with no floor in reach — fade out then respawn
              dp.alphaFade -= FADE_SPEED_PER_SEC * dtSec;
              if (dp.alphaFade <= 0) {
                this.respawnParticle(dp, p);
              }
            }
          }

          // Floor friction (applied every tick when grounded)
          if (dp.isGroundedFlag) {
            dp.yWorld = dp.groundYRelWorld; // keep pinned to found floor
            dp.vxWorld *= Math.max(0, 1 - FLOOR_FRICTION_PER_SEC * dtSec);
            if (Math.abs(dp.vxWorld) < 0.3) dp.vxWorld = 0;

            // Re-validate floor under current X: particle may have been pushed
            // sideways off an edge by particle-particle collision.  If there is
            // no floor within 1 world unit of the grounded Y, unground it so it
            // falls to the correct surface below.
            const absXCheck = tomb.xWorld + dp.xWorld;
            const absYCheck = tomb.yWorld + dp.groundYRelWorld;
            const floorYWorld = this.findFloorTopWorld(absXCheck, absYCheck);
            if (floorYWorld === null || floorYWorld > absYCheck + FLOOR_REVALIDATION_THRESHOLD_WORLD) {
              dp.isGroundedFlag = false;
              dp.vyWorld = 0;
            }
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

        // After particle-particle resolution, push any particle that crossed into
        // a wall back out.  This prevents both lateral penetration and seam-slip.
        for (let p = 0; p < tomb.dustParticles.length; p++) {
          this.resolveParticleWallPenetration(tomb.dustParticles[p], tomb.xWorld, tomb.yWorld);
        }
      }
    }
  }

  /**
   * Find the nearest wall top surface that is at or below `absY` and horizontally
   * overlaps `absX`.  Returns the wall-top world Y coordinate, or `null` if none found.
   *
   * In world space Y increases downward, so "below the particle" means
   * `wall.topWorld >= absY` (larger Y = visually lower on screen).  Among all
   * qualifying walls the one with the smallest topWorld is the closest floor.
   *
   * A small horizontal seam tolerance (DUST_CONTACT_RADIUS_WORLD) is applied to
   * the X bounds so particles near block seams still detect the floor.
   */
  private findFloorTopWorld(absX: number, absY: number): number | null {
    let closestY = Infinity;
    const seam = DUST_CONTACT_RADIUS_WORLD;
    for (let i = 0; i < this.wallRects.length; i++) {
      const wall = this.wallRects[i];
      // wall.topWorld >= absY: wall top is at or below the particle (Y-down coordinate system)
      if (
        absX >= wall.leftWorld - seam && absX <= wall.rightWorld + seam &&
        wall.topWorld >= absY
      ) {
        if (wall.topWorld < closestY) {
          closestY = wall.topWorld;
        }
      }
    }
    return closestY === Infinity ? null : closestY;
  }

  /**
   * Resolve a particle out of any solid wall it has penetrated.
   * Tests the particle (treated as a point) against all wall AABBs and,
   * if inside, pushes it out via the smallest-penetration axis.
   * Velocity is zeroed on the collision axis and reflected slightly for a bounce.
   *
   * @param dp        The dust particle (relative coordinates).
   * @param tombX     Absolute X of the tomb center (world units).
   * @param tombY     Absolute Y of the tomb center (world units).
   */
  private resolveParticleWallPenetration(dp: DustParticle, tombX: number, tombY: number): void {
    const absX = tombX + dp.xWorld;
    const absY = tombY + dp.yWorld;

    for (let i = 0; i < this.wallRects.length; i++) {
      const wall = this.wallRects[i];
      // Check if particle center is inside the wall AABB
      if (
        absX > wall.leftWorld && absX < wall.rightWorld &&
        absY > wall.topWorld  && absY < wall.bottomWorld
      ) {
        // Penetration depths on each face
        const penLeft   = absX - wall.leftWorld;
        const penRight  = wall.rightWorld  - absX;
        const penTop    = absY - wall.topWorld;
        const penBottom = wall.bottomWorld - absY;

        // Resolve on the shallowest penetration axis
        const minPen = Math.min(penLeft, penRight, penTop, penBottom);
        if (minPen === penLeft) {
          dp.xWorld -= penLeft;
          if (dp.vxWorld > 0) dp.vxWorld *= -0.1;
        } else if (minPen === penRight) {
          dp.xWorld += penRight;
          if (dp.vxWorld < 0) dp.vxWorld *= -0.1;
        } else if (minPen === penTop) {
          // Landed on wall top surface — snap to floor
          dp.yWorld -= penTop;
          dp.groundYRelWorld = dp.yWorld;
          dp.vyWorld *= -0.15;
          if (Math.abs(dp.vyWorld) < 2) dp.vyWorld = 0;
          dp.isGroundedFlag = true;
        } else {
          dp.yWorld += penBottom;
          if (dp.vyWorld < 0) dp.vyWorld *= -0.1;
        }
      }
    }
  }

  /**
   * Respawn a faded particle at its original swirl-orbit position, ready to
   * re-join the swirl when the player next approaches.
   */
  private respawnParticle(dp: DustParticle, particleIndex: number): void {
    const angle = (particleIndex / DUST_PARTICLE_COUNT) * Math.PI * 2;
    const radius = dp.radiusWorld;
    dp.xWorld = Math.cos(angle) * radius;
    dp.yWorld = Math.sin(angle) * radius;
    dp.vxWorld = 0;
    dp.vyWorld = 0;
    dp.isGroundedFlag = true;
    dp.alphaFade = 0.0; // keep invisible until swirl re-activates
    dp.groundYRelWorld = dp.yWorld;
    dp.brightness = 0.3;
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

      // Draw sprite (saveTomb.png)
      const spriteW = TOMB_SPRITE_WIDTH_WORLD * zoom;
      const spriteH = TOMB_SPRITE_HEIGHT_WORLD * zoom;
      if (this.isSpriteLoaded) {
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
        if (dp.alphaFade <= 0) continue; // skip faded-out particles
        const px = (tomb.xWorld + dp.xWorld) * zoom + offsetXPx;
        const py = (tomb.yWorld + dp.yWorld) * zoom + offsetYPx;
        const size = DUST_PIXEL_SIZE;

        // Match the player's Physical golden dust particle colour (#ffd700).
        // At full brightness: rgb(255,215,0); at dim: slightly darker amber.
        const r = Math.round(180 + 75 * dp.brightness);
        const g = Math.round(130 + 85 * dp.brightness);
        const b = Math.round(10 * (1 - dp.brightness));
        const alpha = (0.5 + 0.5 * dp.brightness) * dp.alphaFade;

        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }

      // Draw interact prompt
      if (tomb.isPlayerNearbyFlag) {
        ctx.save();
        ctx.font = `${14 * (zoom / 2.8)}px 'Cinzel', serif`;
        ctx.fillStyle = `rgba(212,168,75,${0.6 + 0.4 * tomb.activationFactor})`;
        ctx.textAlign = 'center';
        ctx.fillText('Press F to interact', screenX, screenY - BLOCK_SIZE_MEDIUM * zoom * 0.8);
        ctx.restore();
      }
    }
  }
}
