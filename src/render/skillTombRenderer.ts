/**
 * Save tomb in-game renderer.
 *
 * Draws the saveTomb.png sprite and manages golden dust particles.
 * Particle types, physics constants, and simulation logic are in
 * skillTombDustParticles.ts; this module owns the canvas rendering only.
 *
 * Also draws the "F" key prompt when the player is close.
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { RoomWallDef } from '../levels/roomDef';
import {
  SKILL_TOMB_INTERACT_RADIUS_WORLD,
  DUST_PARTICLE_COUNT,
  updateTombDust,
  type DustParticle,
  type TombState,
  type TombWallRect,
} from './skillTombDustParticles';

// Re-export so existing callers (gameScreen.ts) continue to import from here.
export { SKILL_TOMB_INTERACT_RADIUS_WORLD } from './skillTombDustParticles';

const BASE = import.meta.env.BASE_URL;

/** Max number of save tombs supported per room. */
const MAX_TOMBS = 8;

/** Rendered size of each dust particle in virtual pixels (uniform, 2×2). */
const DUST_PIXEL_SIZE = 2;

/** Gold color variants [R, G, B] for per-particle color variation. */
const GOLD_VARIANTS: [number, number, number][] = [
  [255, 215,   0], // 0: base gold
  [255, 238, 130], // 1: pale highlight
  [255, 180,  40], // 2: amber
  [255, 245, 180], // 3: white-hot gold accent
];

/** Alpha multiplier for the thin trail line drawn behind each dust particle. */
const DUST_TRAIL_ALPHA_FACTOR = 0.35;

/** Alpha multiplier for the soft glow square drawn around each dust particle core. */
const DUST_GLOW_ALPHA_FACTOR = 0.18;

/** Save tomb sprite width in world units (2 medium blocks wide). */
const TOMB_SPRITE_WIDTH_WORLD = 2 * BLOCK_SIZE_MEDIUM;
/** Save tomb sprite height in world units (3 medium blocks tall). */
const TOMB_SPRITE_HEIGHT_WORLD = 3 * BLOCK_SIZE_MEDIUM;

export class SkillTombRenderer {
  private readonly tombSprite: HTMLImageElement;
  private readonly tombStates: TombState[] = [];
  private isSpriteLoaded = false;
  /** Precomputed solid wall rectangles in world units (excluding one-way platforms). */
  private wallRects: TombWallRect[] = [];

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
        // Deterministic per-particle variation fields (based on index)
        const fallSpeedScale = 0.7 + (p / Math.max(1, DUST_PARTICLE_COUNT - 1)) * 0.6;
        const driftPhase = p * (Math.PI * 2 / DUST_PARTICLE_COUNT) * 3;
        const driftSpeed = 0.7 + (p % 5) * 0.15;
        const driftAmplitudeWorld = 2.5 + (p % 3) * 1.5;
        const colorVariant = p % 4;
        const swirlAngleSpeedScale = 0.85 + (p % 7) * 0.05;
        const swirlSquishScale = 0.50 + (p % 5) * 0.04;
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
          fallSpeedScale,
          driftPhase,
          driftSpeed,
          driftAmplitudeWorld,
          colorVariant,
          trailPrevXWorld: Math.cos(angle) * radius,
          trailPrevYWorld: initY,
          swirlAngleSpeedScale,
          swirlSquishScale,
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
    updateTombDust(this.tombStates, this.wallRects, playerXWorld, playerYWorld, dtSec);
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
    vpW = 480,
    vpH = 270,
  ): void {
    for (let t = 0; t < this.tombStates.length; t++) {
      const tomb = this.tombStates[t];

      const screenX = tomb.xWorld * zoom + offsetXPx;
      const screenY = tomb.yWorld * zoom + offsetYPx;

      // Cull tombs well outside the viewport — add margin for dust particles
      // orbiting beyond the sprite bounds.
      const halfW = TOMB_SPRITE_WIDTH_WORLD * zoom * 0.5;
      const halfH = TOMB_SPRITE_HEIGHT_WORLD * zoom * 0.5;
      const margin = BLOCK_SIZE_MEDIUM * zoom * 2;
      if (screenX + halfW + margin < 0 || screenX - halfW - margin > vpW) continue;
      if (screenY + halfH + margin < 0 || screenY - halfH - margin > vpH) continue;

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

      // Draw dust particles — additive blending produces the neon-gold light glow
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let p = 0; p < tomb.dustParticles.length; p++) {
        const dp = tomb.dustParticles[p];
        if (dp.alphaFade <= 0) continue; // skip faded-out particles
        const px = (tomb.xWorld + dp.xWorld) * zoom + offsetXPx;
        const py = (tomb.yWorld + dp.yWorld) * zoom + offsetYPx;
        const prevPx = (tomb.xWorld + dp.trailPrevXWorld) * zoom + offsetXPx;
        const prevPy = (tomb.yWorld + dp.trailPrevYWorld) * zoom + offsetYPx;

        const variant = GOLD_VARIANTS[dp.colorVariant];
        const cr = variant[0];
        const cg = variant[1];
        const cb = variant[2];
        const coreAlpha = (0.5 + 0.5 * dp.brightness) * dp.alphaFade;

        // Thin gold trail from previous to current position
        const trailDx = px - prevPx;
        const trailDy = py - prevPy;
        if (trailDx * trailDx + trailDy * trailDy > 0.25) {
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${coreAlpha * DUST_TRAIL_ALPHA_FACTOR})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(prevPx, prevPy);
          ctx.lineTo(px, py);
          ctx.stroke();
        }

        // Soft glow: low-alpha square slightly larger than the core
        const glowSize = DUST_PIXEL_SIZE + 2;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${coreAlpha * DUST_GLOW_ALPHA_FACTOR})`;
        ctx.fillRect(px - glowSize / 2, py - glowSize / 2, glowSize, glowSize);

        // Crisp 2×2 pixel core square
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${coreAlpha})`;
        ctx.fillRect(px - DUST_PIXEL_SIZE / 2, py - DUST_PIXEL_SIZE / 2, DUST_PIXEL_SIZE, DUST_PIXEL_SIZE);
      }
      ctx.restore();

      // Draw interact prompt ("F" key indicator)
      if (tomb.isPlayerNearbyFlag) {
        const alpha = 0.6 + 0.4 * tomb.activationFactor;
        const labelY = screenY - BLOCK_SIZE_MEDIUM * zoom * 2.0;
        const labelSize = Math.max(6, Math.round(11 * zoom));
        ctx.save();
        ctx.font = `bold ${labelSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Background pill
        const metrics = ctx.measureText('F');
        const padX = labelSize * 0.45;
        const padY = labelSize * 0.25;
        const boxW = metrics.width + padX * 2;
        const boxH = labelSize + padY * 2;
        ctx.fillStyle = `rgba(20,14,6,${alpha * 0.7})`;
        ctx.beginPath();
        ctx.roundRect(screenX - boxW / 2, labelY - boxH / 2, boxW, boxH, boxH / 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(212,168,75,${alpha})`;
        ctx.lineWidth = Math.max(1, zoom * 0.5);
        ctx.stroke();
        // Letter
        ctx.fillStyle = `rgba(212,168,75,${alpha})`;
        ctx.fillText('F', screenX, labelY);
        ctx.restore();
      }
    }
  }
}
