/**
 * Skill tomb in-game effect renderer.
 *
 * Draws the skillTomb.png sprite and animates small golden pixels that rise
 * upward from the ground around the tomb:
 *   - Particles fade in as they spawn and fade out before despawning
 *   - Various shades of gold for visual variety
 *   - Particles are split into "behind" and "front" layers so some appear
 *     to pass behind the sprite, adding visual depth
 */

import { BLOCK_SIZE_MEDIUM, BLOCK_SIZE_SMALL } from '../levels/roomDef';

const BASE = import.meta.env.BASE_URL;

/** Skill tomb sprite width in world units (2 small blocks wide). */
const SKILL_TOMB_WIDTH_WORLD = 2 * BLOCK_SIZE_SMALL;
/** Skill tomb sprite height in world units (2 small blocks tall). */
const SKILL_TOMB_HEIGHT_WORLD = 2 * BLOCK_SIZE_SMALL;

/** Distance (world units) within which the "F" prompt appears. */
export const SKILL_TOMB_INTERACT_RADIUS_WORLD = 2.2 * BLOCK_SIZE_MEDIUM;

/** Number of rising golden particles per skill tomb. */
const PARTICLES_PER_TOMB = 22;

/** Fraction of particles drawn behind the sprite (0..1). */
const BEHIND_FRACTION = 0.4;

/** Max number of skill tombs supported per room. */
const MAX_TOMBS = 8;

/** Half-width of the horizontal spawn area around the tomb center (world units). */
const SPAWN_HALF_WIDTH_WORLD = SKILL_TOMB_WIDTH_WORLD * 0.9;

/** Speed at which particles rise (world units / second). Negative = upward. */
const RISE_SPEED_MIN_WORLD = 10;
const RISE_SPEED_MAX_WORLD = 22;

/** Lateral drift speed range (world units / second). */
const DRIFT_SPEED_MAX_WORLD = 2.5;

/** Particle lifetime range in seconds. */
const LIFETIME_MIN_SEC = 1.4;
const LIFETIME_MAX_SEC = 3.2;

interface SkillTombParticle {
  /** Position relative to tomb center (world units). */
  xRelWorld: number;
  yRelWorld: number;
  /** Upward velocity (world units / sec, negative = up). */
  vyWorld: number;
  /** Lateral drift (world units / sec). */
  vxWorld: number;
  /** Current age in seconds. */
  ageSec: number;
  /** Total lifetime in seconds. */
  lifetimeSec: number;
  /** Peak alpha value (0..1). */
  maxAlpha: number;
  /** Rendered pixel size (virtual pixels). */
  sizePx: number;
  /** Gold color variant 0..1 for shade variation (0 = deep amber, 1 = bright gold). */
  goldVariant: number;
  /** When true this particle is drawn before (behind) the sprite. */
  isBehindFlag: boolean;
}

interface SkillTombState {
  xWorld: number;
  yWorld: number;
  /** Original block X position — used as a stable consumed-tomb key. */
  xBlock: number;
  /** Original block Y position — used as a stable consumed-tomb key. */
  yBlock: number;
  /** Weave ID granted when this tomb is consumed. */
  weaveId: string;
  particles: SkillTombParticle[];
  /** True when the player is within interact radius. */
  isPlayerNearbyFlag: boolean;
}

/** Spawn a single particle at a random position/velocity below the tomb center. */
function spawnParticle(particleIndex: number): SkillTombParticle {
  const isBehind = particleIndex < Math.round(PARTICLES_PER_TOMB * BEHIND_FRACTION);
  // Spawn at the bottom edge of the tomb or slightly below (ground level)
  const spawnY = SKILL_TOMB_HEIGHT_WORLD * 0.5 + Math.random() * 4;
  const spawnX = (Math.random() * 2 - 1) * SPAWN_HALF_WIDTH_WORLD;
  const vy = -(RISE_SPEED_MIN_WORLD + Math.random() * (RISE_SPEED_MAX_WORLD - RISE_SPEED_MIN_WORLD));
  const vx = (Math.random() * 2 - 1) * DRIFT_SPEED_MAX_WORLD;
  const lifetime = LIFETIME_MIN_SEC + Math.random() * (LIFETIME_MAX_SEC - LIFETIME_MIN_SEC);
  // Stagger initial ages so particles don't all appear at once on spawn
  const initialAge = Math.random() * lifetime;
  return {
    xRelWorld: spawnX,
    yRelWorld: spawnY,
    vyWorld: vy,
    vxWorld: vx,
    ageSec: initialAge,
    lifetimeSec: lifetime,
    maxAlpha: 0.55 + Math.random() * 0.35,
    sizePx: Math.random() < 0.35 ? 2 : 1,
    goldVariant: Math.random(),
    isBehindFlag: isBehind,
  };
}

/** Reset a particle to a fresh spawn (called when it completes its lifetime). */
function resetParticle(p: SkillTombParticle): void {
  p.xRelWorld = (Math.random() * 2 - 1) * SPAWN_HALF_WIDTH_WORLD;
  p.yRelWorld = SKILL_TOMB_HEIGHT_WORLD * 0.5 + Math.random() * 4;
  p.vyWorld = -(RISE_SPEED_MIN_WORLD + Math.random() * (RISE_SPEED_MAX_WORLD - RISE_SPEED_MIN_WORLD));
  p.vxWorld = (Math.random() * 2 - 1) * DRIFT_SPEED_MAX_WORLD;
  p.ageSec = 0;
  p.lifetimeSec = LIFETIME_MIN_SEC + Math.random() * (LIFETIME_MAX_SEC - LIFETIME_MIN_SEC);
  p.maxAlpha = 0.55 + Math.random() * 0.35;
  p.sizePx = Math.random() < 0.35 ? 2 : 1;
  p.goldVariant = Math.random();
}

export class SkillTombEffectRenderer {
  private readonly tombSprite: HTMLImageElement;
  private isSpriteLoaded = false;
  private readonly tombStates: SkillTombState[] = [];

  constructor() {
    this.tombSprite = new Image();
    this.tombSprite.src = `${BASE}SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/skillTomb.png`;
    this.tombSprite.onload = () => { this.isSpriteLoaded = true; };
  }

  /** Initialise effect states for a new room. */
  init(tombs: readonly { xBlock: number; yBlock: number; weaveId: string }[] | undefined): void {
    this.tombStates.length = 0;
    if (!tombs) return;
    const count = Math.min(tombs.length, MAX_TOMBS);
    for (let i = 0; i < count; i++) {
      const xWorld = (tombs[i].xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      const yWorld = (tombs[i].yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      const particles: SkillTombParticle[] = [];
      for (let p = 0; p < PARTICLES_PER_TOMB; p++) {
        particles.push(spawnParticle(p));
      }
      this.tombStates.push({
        xWorld, yWorld,
        xBlock: tombs[i].xBlock,
        yBlock: tombs[i].yBlock,
        weaveId: tombs[i].weaveId,
        particles,
        isPlayerNearbyFlag: false,
      });
    }
  }

  /** Advance all particle animations and update player proximity. */
  update(playerXWorld: number, playerYWorld: number, dtSec: number): void {
    for (let t = 0; t < this.tombStates.length; t++) {
      const tomb = this.tombStates[t];
      const dx = playerXWorld - tomb.xWorld;
      const dy = playerYWorld - tomb.yWorld;
      tomb.isPlayerNearbyFlag =
        dx * dx + dy * dy <
        SKILL_TOMB_INTERACT_RADIUS_WORLD * SKILL_TOMB_INTERACT_RADIUS_WORLD;
      for (let p = 0; p < tomb.particles.length; p++) {
        const pk = tomb.particles[p];
        pk.ageSec += dtSec;
        if (pk.ageSec >= pk.lifetimeSec) {
          resetParticle(pk);
          continue;
        }
        pk.xRelWorld += pk.vxWorld * dtSec;
        pk.yRelWorld += pk.vyWorld * dtSec;
      }
    }
  }

  /** Returns the index of the skill tomb the player is within interact range of, or -1. */
  getNearbyTombIndex(playerXWorld: number, playerYWorld: number): number {
    for (let t = 0; t < this.tombStates.length; t++) {
      const tomb = this.tombStates[t];
      const dx = playerXWorld - tomb.xWorld;
      const dy = playerYWorld - tomb.yWorld;
      if (
        dx * dx + dy * dy <
        SKILL_TOMB_INTERACT_RADIUS_WORLD * SKILL_TOMB_INTERACT_RADIUS_WORLD
      ) {
        return t;
      }
    }
    return -1;
  }

  /** Returns the weave ID of the tomb at the given index, or '' if out of range. */
  getTombWeaveId(index: number): string {
    return this.tombStates[index]?.weaveId ?? '';
  }

  /**
   * Returns a stable key for the tomb at the given index, in the form
   * `"${xBlock}:${yBlock}"`.  Used to track consumed tombs across room re-entries.
   */
  getTombPositionKey(index: number): string {
    const tomb = this.tombStates[index];
    if (!tomb) return '';
    return `${tomb.xBlock}:${tomb.yBlock}`;
  }

  /** Remove the tomb at the given index (marks it as consumed and hides its visuals). */
  removeTomb(index: number): void {
    if (index >= 0 && index < this.tombStates.length) {
      this.tombStates.splice(index, 1);
    }
  }

  /**
   * Draw particles that should appear behind the skill tomb sprite.
   * Call this before renderSprite().
   */
  renderBehind(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
  ): void {
    this.renderLayer(ctx, offsetXPx, offsetYPx, zoom, true);
  }

  /**
   * Draw the skill tomb sprite.
   * Call after renderBehind() and before renderFront().
   */
  renderSprite(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
  ): void {
    if (!this.isSpriteLoaded) return;
    const spriteW = SKILL_TOMB_WIDTH_WORLD * zoom;
    const spriteH = SKILL_TOMB_HEIGHT_WORLD * zoom;
    for (let t = 0; t < this.tombStates.length; t++) {
      const tomb = this.tombStates[t];
      const screenX = tomb.xWorld * zoom + offsetXPx;
      const screenY = tomb.yWorld * zoom + offsetYPx;
      ctx.drawImage(
        this.tombSprite,
        screenX - spriteW / 2,
        screenY - spriteH / 2,
        spriteW,
        spriteH,
      );
    }
  }

  /**
   * Draw particles that should appear in front of the skill tomb sprite.
   * Also draws the "F" interact prompt when the player is nearby.
   * Call after renderSprite().
   */
  renderFront(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
  ): void {
    this.renderLayer(ctx, offsetXPx, offsetYPx, zoom, false);
    this.renderPrompts(ctx, offsetXPx, offsetYPx, zoom);
  }

  /** Draw the "F" interact prompt above each nearby skill tomb. */
  private renderPrompts(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
  ): void {
    for (let t = 0; t < this.tombStates.length; t++) {
      const tomb = this.tombStates[t];
      if (!tomb.isPlayerNearbyFlag) continue;

      const screenX = tomb.xWorld * zoom + offsetXPx;
      const screenY = tomb.yWorld * zoom + offsetYPx;
      const labelY = screenY - SKILL_TOMB_HEIGHT_WORLD * zoom * 0.85;
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
      ctx.fillStyle = 'rgba(20,10,35,0.7)';
      ctx.beginPath();
      ctx.roundRect(screenX - boxW / 2, labelY - boxH / 2, boxW, boxH, boxH / 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(180,130,255,0.9)';
      ctx.lineWidth = Math.max(1, zoom * 0.5);
      ctx.stroke();

      // Letter
      ctx.fillStyle = 'rgba(200,170,255,1)';
      ctx.fillText('F', screenX, labelY);
      ctx.restore();
    }
  }

  private renderLayer(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    isBehindLayer: boolean,
  ): void {
    for (let t = 0; t < this.tombStates.length; t++) {
      const tomb = this.tombStates[t];
      for (let p = 0; p < tomb.particles.length; p++) {
        const pk = tomb.particles[p];
        if (pk.isBehindFlag !== isBehindLayer) continue;

        // Bell-curve alpha: fade in during first 20%, hold, fade out during last 25%
        const progress = pk.ageSec / pk.lifetimeSec;
        let alpha: number;
        if (progress < 0.2) {
          alpha = pk.maxAlpha * (progress / 0.2);
        } else if (progress > 0.75) {
          alpha = pk.maxAlpha * (1 - (progress - 0.75) / 0.25);
        } else {
          alpha = pk.maxAlpha;
        }
        if (alpha <= 0.01) continue;

        // Gold colour interpolation: 0 = deep amber, 1 = bright yellow-gold
        const v = pk.goldVariant;
        const r = Math.round(155 + v * 95);  // 155–250
        const g = Math.round(95 + v * 105);  // 95–200
        const b = Math.round(0 + v * 45);    // 0–45

        const screenX = (tomb.xWorld + pk.xRelWorld) * zoom + offsetXPx;
        const screenY = (tomb.yWorld + pk.yRelWorld) * zoom + offsetYPx;
        const sizePx = pk.sizePx;

        ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
        ctx.fillRect(screenX - sizePx / 2, screenY - sizePx / 2, sizePx, sizePx);
      }
    }
  }
}
