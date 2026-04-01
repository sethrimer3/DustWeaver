/**
 * GravityGridEffect
 *
 * Ported from Thero_Idle_TD GravityGridEffect.js.
 * A faint grid warped by 2 gravity-well balls and 1 white-hole ball.
 * Grid shifts from white→gold at up to 30% alpha. Balls drift and collide,
 * triggering particle explosions.
 *
 * Scaled down for the 480×270 virtual canvas: grid spacing reduced from
 * 10px to 6px, ball radii halved, speeds proportionally reduced.
 */

import { TheroBackgroundEffect } from './theroBackgroundEffect';

// ─── Grid tuning ──────────────────────────────────────────────────────────────

const GRID_SPACING_PX   = 6;
const GRID_LINE_WIDTH   = 0.7;
const GRID_BASE_ALPHA   = 0;
const GRID_WARP_MAX_ALPHA = 0.30;
const GRID_WARP_CEILING_PX = 12;

const BASE_R = 255; const BASE_G = 255; const BASE_B = 255;
const WARP_R = 255; const WARP_G = 215; const WARP_B = 100;

const WARP_PALETTE_SIZE = 16;

// ─── Ball tuning ──────────────────────────────────────────────────────────────

const SMALL_BALL_RADIUS_PX = 6;
const LARGE_BALL_RADIUS_PX = 13;
const BALL_GLOW_ALPHA      = 0.20;
const BALL_SPRITE_SCALE    = 1.6;

// ─── Physics tuning ──────────────────────────────────────────────────────────

const MIN_SPEED_PX_S       = 20;
const MAX_SPEED_PX_S       = 90;
const SPAWN_SPEED_MIN_PX_S = 18;
const SPAWN_SPEED_MAX_PX_S = 40;
const GRAVITY_CONST        = 3000;
const GRID_WARP_CONST      = 8000;
const WARP_SOFTENING       = 400;
const WARP_CUTOFF_PX       = 120;
const WARP_CUTOFF_SQ       = WARP_CUTOFF_PX * WARP_CUTOFF_PX;

// ─── Collision & respawn ──────────────────────────────────────────────────────

const COLLISION_TOLERANCE_PX = 4;
const RESPAWN_MIN_SEC        = 5;
const RESPAWN_MAX_SEC        = 10;

// ─── Explosion particles ──────────────────────────────────────────────────────

const PARTICLE_COUNT_PER_EXPLOSION = 12;
const PARTICLE_SPEED_MIN_PX_S      = 25;
const PARTICLE_SPEED_MAX_PX_S      = 60;
const PARTICLE_LIFE_SEC            = 1.5;
const PARTICLE_ALPHA               = 0.60;

// ─── Ball masses ──────────────────────────────────────────────────────────────

const SMALL_BALL_MASS = 1.5;
const LARGE_BALL_MASS = 3.0;

const TWO_PI = Math.PI * 2;

// ─── Pre-computed warp colour palette ─────────────────────────────────────────

const _warpPalette: string[]  = [];
const _warpPaletteAlpha: number[] = [];
for (let i = 0; i < WARP_PALETTE_SIZE; i++) {
  const t = i / (WARP_PALETTE_SIZE - 1);
  const a = GRID_BASE_ALPHA + (GRID_WARP_MAX_ALPHA - GRID_BASE_ALPHA) * t;
  const r = Math.round(BASE_R + (WARP_R - BASE_R) * t);
  const g = Math.round(BASE_G + (WARP_G - BASE_G) * t);
  const b = Math.round(BASE_B + (WARP_B - BASE_B) * t);
  _warpPaletteAlpha.push(a);
  _warpPalette.push(`rgba(${r},${g},${b},${a.toFixed(3)})`);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type BallType = 'gravity' | 'whitehole';

interface Ball {
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  mass: number;
  type: BallType;
  isAliveFlag: 0 | 1;
  respawnTimer: number;
}

interface ExplosionParticle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  maxLife: number;
}

// ─── Sprite helpers ───────────────────────────────────────────────────────────

function createGlowSprite(radiusPx: number, r: number, g: number, b: number): HTMLCanvasElement {
  const extent = Math.ceil(radiusPx * BALL_SPRITE_SCALE);
  const size   = extent * 2;
  const oc     = document.createElement('canvas');
  oc.width     = size;
  oc.height    = size;
  const c      = oc.getContext('2d')!;
  const cx = extent;
  const cy = extent;

  const grad = c.createRadialGradient(cx, cy, 0, cx, cy, extent);
  grad.addColorStop(0,    'rgba(255,255,255,1)');
  grad.addColorStop(0.15, `rgba(${r},${g},${b},0.9)`);
  grad.addColorStop(0.40, `rgba(${r},${g},${b},0.4)`);
  grad.addColorStop(0.70, `rgba(${r},${g},${b},0.15)`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);

  c.fillStyle = grad;
  c.beginPath();
  c.arc(cx, cy, extent, 0, TWO_PI);
  c.fill();
  return oc;
}

function spawnBallFromEdge(type: BallType, widthPx: number, heightPx: number): Ball {
  const radius = type === 'gravity' ? SMALL_BALL_RADIUS_PX : LARGE_BALL_RADIUS_PX;
  const speed  = SPAWN_SPEED_MIN_PX_S + Math.random() * (SPAWN_SPEED_MAX_PX_S - SPAWN_SPEED_MIN_PX_S);
  const spread = Math.random() * (Math.PI / 3) - (Math.PI / 6);
  const edge   = Math.floor(Math.random() * 4);

  let x: number, y: number, vx: number, vy: number;
  switch (edge) {
    case 0: x = Math.random() * widthPx;  y = -radius;         vx =  Math.sin(spread) * speed; vy =  Math.abs(Math.cos(spread)) * speed; break;
    case 1: x = widthPx + radius;         y = Math.random() * heightPx; vx = -Math.abs(Math.cos(spread)) * speed; vy = Math.sin(spread) * speed; break;
    case 2: x = Math.random() * widthPx;  y = heightPx + radius; vx = Math.sin(spread) * speed; vy = -Math.abs(Math.cos(spread)) * speed; break;
    default: x = -radius; y = Math.random() * heightPx; vx = Math.abs(Math.cos(spread)) * speed; vy = Math.sin(spread) * speed; break;
  }

  return {
    x, y, vx, vy,
    radius,
    mass:         type === 'gravity' ? SMALL_BALL_MASS : LARGE_BALL_MASS,
    type,
    isAliveFlag:  1,
    respawnTimer: 0,
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createGravityGridEffect(): TheroBackgroundEffect {
  let balls:     Ball[]              = [];
  let particles: ExplosionParticle[] = [];
  let lastTs: number | null          = null;
  let viewW = 0;
  let viewH = 0;
  let gridCols = 0;
  let gridRows = 0;

  let smallSprite:    HTMLCanvasElement | null = null;
  let largeSprite:    HTMLCanvasElement | null = null;
  let particleSprite: HTMLCanvasElement | null = null;

  let frameSources: { x: number; y: number; mass: number; radius: number; type: BallType; ball: Ball | null }[] = [];

  let gridBuf: Float64Array | null = null;
  let gridBufSize = 0;

  function ensureSprites(): void {
    if (smallSprite) return;
    smallSprite    = createGlowSprite(SMALL_BALL_RADIUS_PX, 200, 220, 255);
    largeSprite    = createGlowSprite(LARGE_BALL_RADIUS_PX, 255, 235, 200);
    particleSprite = createGlowSprite(3, 255, 245, 220);
  }

  function init(widthPx: number, heightPx: number): void {
    balls     = [
      spawnBallFromEdge('gravity',   widthPx, heightPx),
      spawnBallFromEdge('gravity',   widthPx, heightPx),
      spawnBallFromEdge('whitehole', widthPx, heightPx),
    ];
    particles    = [];
    frameSources = [];
  }

  function clampSpeed(ball: Ball): void {
    const spd = Math.hypot(ball.vx, ball.vy);
    if (spd < MIN_SPEED_PX_S) {
      if (spd < 0.001) {
        const a = Math.random() * TWO_PI;
        ball.vx = Math.cos(a) * MIN_SPEED_PX_S;
        ball.vy = Math.sin(a) * MIN_SPEED_PX_S;
      } else {
        const s = MIN_SPEED_PX_S / spd;
        ball.vx *= s; ball.vy *= s;
      }
    } else if (spd > MAX_SPEED_PX_S) {
      const s = MAX_SPEED_PX_S / spd;
      ball.vx *= s; ball.vy *= s;
    }
  }

  function explodeBall(ball: Ball): void {
    ball.isAliveFlag  = 0;
    ball.respawnTimer = RESPAWN_MIN_SEC + Math.random() * (RESPAWN_MAX_SEC - RESPAWN_MIN_SEC);
    for (let i = 0; i < PARTICLE_COUNT_PER_EXPLOSION; i++) {
      const angleRad = (i / PARTICLE_COUNT_PER_EXPLOSION) * TWO_PI + Math.random() * 0.5;
      const speed    = PARTICLE_SPEED_MIN_PX_S + Math.random() * (PARTICLE_SPEED_MAX_PX_S - PARTICLE_SPEED_MIN_PX_S);
      particles.push({
        x: ball.x, y: ball.y,
        vx: Math.cos(angleRad) * speed,
        vy: Math.sin(angleRad) * speed,
        life: PARTICLE_LIFE_SEC,
        maxLife: PARTICLE_LIFE_SEC,
      });
    }
  }

  function update(nowMs: number, widthPx: number, heightPx: number): void {
    const isSizeChanged = !balls.length || Math.abs(widthPx - viewW) > 50 || Math.abs(heightPx - viewH) > 50;
    viewW = widthPx;
    viewH = heightPx;
    if (isSizeChanged) init(widthPx, heightPx);
    ensureSprites();

    gridCols = Math.floor(widthPx  / GRID_SPACING_PX) + 2;
    gridRows = Math.floor(heightPx / GRID_SPACING_PX) + 2;

    const dtSec = lastTs === null ? 0.016 : Math.min((nowMs - lastTs) / 1000, 0.1);
    lastTs = nowMs;

    // Build source list from alive balls
    frameSources = [];
    for (const b of balls) {
      if (b.isAliveFlag) frameSources.push({ x: b.x, y: b.y, mass: b.mass, radius: b.radius, type: b.type, ball: b });
    }

    // Apply gravity between balls
    for (const ball of balls) {
      if (!ball.isAliveFlag) continue;
      let ax = 0; let ay = 0;
      for (const src of frameSources) {
        if (src.ball === ball) continue;
        const dx = src.x - ball.x;
        const dy = src.y - ball.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < 1) continue;
        const dist = Math.sqrt(dSq);
        const f    = GRAVITY_CONST * src.mass / (dSq + WARP_SOFTENING);
        const sign = src.type === 'gravity' ? 1 : -1;
        ax += sign * (dx / dist) * f;
        ay += sign * (dy / dist) * f;
      }
      ball.vx += ax * dtSec;
      ball.vy += ay * dtSec;
      clampSpeed(ball);
      ball.x += ball.vx * dtSec;
      ball.y += ball.vy * dtSec;

      const margin = ball.radius * 3;
      if (ball.x < -margin)         { ball.x = -margin;         ball.vx =  Math.abs(ball.vx); }
      if (ball.x > widthPx + margin) { ball.x = widthPx + margin; ball.vx = -Math.abs(ball.vx); }
      if (ball.y < -margin)         { ball.y = -margin;          ball.vy =  Math.abs(ball.vy); }
      if (ball.y > heightPx + margin){ ball.y = heightPx + margin; ball.vy = -Math.abs(ball.vy); }
    }

    // Ball–ball collisions
    for (let i = 0; i < balls.length; i++) {
      if (!balls[i].isAliveFlag) continue;
      for (let j = i + 1; j < balls.length; j++) {
        if (!balls[j].isAliveFlag) continue;
        const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
        if (d < balls[i].radius + balls[j].radius + COLLISION_TOLERANCE_PX) {
          explodeBall(balls[i]);
          explodeBall(balls[j]);
        }
      }
    }

    // Respawn timers
    for (const ball of balls) {
      if (ball.isAliveFlag) continue;
      ball.respawnTimer -= dtSec;
      if (ball.respawnTimer <= 0) {
        const fresh      = spawnBallFromEdge(ball.type, widthPx, heightPx);
        ball.x           = fresh.x; ball.y = fresh.y;
        ball.vx          = fresh.vx; ball.vy = fresh.vy;
        ball.isAliveFlag = 1;
        ball.respawnTimer = 0;
      }
    }

    // Update explosion particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dtSec;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x  += p.vx * dtSec;
      p.y  += p.vy * dtSec;
      p.vx *= 0.97;
      p.vy *= 0.97;
    }
  }

  function drawGrid(ctx: CanvasRenderingContext2D): void {
    const cols    = gridCols;
    const rows    = gridRows;
    const sources = frameSources;

    const needed = cols * rows * 3;
    if (!gridBuf || gridBufSize < needed) {
      gridBuf     = new Float64Array(needed);
      gridBufSize = needed;
    }
    const pts = gridBuf;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rx = c * GRID_SPACING_PX;
        const ry = r * GRID_SPACING_PX;
        let dx = 0; let dy = 0;

        for (const src of sources) {
          const sx  = src.x - rx;
          const sy  = src.y - ry;
          const dSq = sx * sx + sy * sy;
          if (dSq > WARP_CUTOFF_SQ) continue;
          const d = Math.sqrt(dSq);
          if (d < 0.01) continue;
          const mag  = GRID_WARP_CONST * src.mass / (dSq + WARP_SOFTENING);
          const sign = src.type === 'gravity' ? 1 : -1;
          dx += sign * (sx / d) * mag;
          dy += sign * (sy / d) * mag;
        }

        const idx     = (r * cols + c) * 3;
        pts[idx]      = rx + dx;
        pts[idx + 1]  = ry + dy;
        pts[idx + 2]  = Math.min(1, Math.hypot(dx, dy) / GRID_WARP_CEILING_PX);
      }
    }

    const batches: number[][] = Array.from({ length: WARP_PALETTE_SIZE }, () => []);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const i1 = (r * cols + c) * 3;
        const i2 = (r * cols + c + 1) * 3;
        const w  = (pts[i1 + 2] + pts[i2 + 2]) * 0.5;
        const pi = Math.min(WARP_PALETTE_SIZE - 1, Math.floor(w * WARP_PALETTE_SIZE));
        batches[pi].push(pts[i1], pts[i1 + 1], pts[i2], pts[i2 + 1]);
      }
    }

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows - 1; r++) {
        const i1 = (r * cols + c) * 3;
        const i2 = ((r + 1) * cols + c) * 3;
        const w  = (pts[i1 + 2] + pts[i2 + 2]) * 0.5;
        const pi = Math.min(WARP_PALETTE_SIZE - 1, Math.floor(w * WARP_PALETTE_SIZE));
        batches[pi].push(pts[i1], pts[i1 + 1], pts[i2], pts[i2 + 1]);
      }
    }

    ctx.lineWidth = GRID_LINE_WIDTH;
    ctx.lineCap   = 'round';
    for (let i = 0; i < WARP_PALETTE_SIZE; i++) {
      if (_warpPaletteAlpha[i] <= 0) continue;
      const segs = batches[i];
      if (!segs.length) continue;
      ctx.strokeStyle = _warpPalette[i];
      ctx.beginPath();
      for (let j = 0; j < segs.length; j += 4) {
        ctx.moveTo(segs[j], segs[j + 1]);
        ctx.lineTo(segs[j + 2], segs[j + 3]);
      }
      ctx.stroke();
    }
  }

  function draw(ctx: CanvasRenderingContext2D): void {
    if (!viewW || !viewH) return;
    ctx.save();

    // Grid
    drawGrid(ctx);

    // Balls
    for (const ball of balls) {
      if (!ball.isAliveFlag) continue;
      const sprite = ball.type === 'gravity' ? smallSprite : largeSprite;
      if (!sprite) continue;
      ctx.save();
      ctx.globalAlpha = BALL_GLOW_ALPHA;
      ctx.drawImage(sprite, ball.x - sprite.width * 0.5, ball.y - sprite.height * 0.5);
      ctx.restore();
    }

    // Explosion particles
    if (particles.length && particleSprite) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hw = particleSprite.width  * 0.5;
      const hh = particleSprite.height * 0.5;
      for (const p of particles) {
        const fade = p.life / p.maxLife;
        ctx.globalAlpha = PARTICLE_ALPHA * fade;
        ctx.drawImage(particleSprite, p.x - hw, p.y - hh);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  function reset(): void {
    balls        = [];
    particles    = [];
    lastTs       = null;
    viewW        = 0;
    viewH        = 0;
    frameSources = [];
  }

  return { update, draw, reset };
}
