/**
 * Decorative background particle system for menus and world map.
 *
 * Implements Eulerian-style curl-noise fluid dynamics:
 *   - Particles move along a smoothly changing curl-noise velocity field.
 *   - The field evolves over time (animated phase), giving organic fluid motion.
 *   - Particles wrap around canvas edges.
 *   - Rendered with additive blending as glowing soft circles.
 *
 * This system is purely decorative — it runs its own RAF loop independently
 * from the simulation and does not use the sim/ modules.
 */

/** Number of decorative particles in the background. */
const PARTICLE_COUNT = 220;

/** Particle visual radius in pixels. */
const RADIUS_PX = 3.8;

/** How quickly the noise field evolves over time (lower = slower, smoother). */
const TIME_SPEED = 0.00012;

/** Speed scale for the curl velocity field. */
const CURL_SPEED = 62.0;
/** Velocity damping to smooth particle motion (higher = smoother / less twitchy). */
const VELOCITY_DAMPING = 0.90;
/** How strongly particles follow the sampled curl field each frame. */
const FLOW_FOLLOW = 26.0;
/** Inter-particle repulsion radius in pixels. */
const PARTICLE_REPEL_RADIUS_PX = 24.0;
/** Inter-particle repulsion strength (small, only to avoid clumping). */
const PARTICLE_REPEL_STRENGTH = 38.0;
/** Edge repulsion influence distance from each screen boundary. */
const EDGE_REPEL_RANGE_PX = 110.0;
/** Edge repulsion force scale (grows rapidly near boundaries). */
const EDGE_REPEL_STRENGTH = 42000.0;

/** Mouse drag disturbance radius in pixels. */
const MOUSE_DISTURB_RADIUS_PX = 130.0;

/** Mouse drag disturbance force scale. */
const MOUSE_DRAG_FORCE = 2.8;

/** Disturbance decay per frame. */
const DISTURBANCE_DECAY = 0.94;

/** Colour palette index names for themes. */
export type DecorativeTheme = 'menu' | 'worldmap';

interface DecorativeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  alpha: number;
  baseAlpha: number;
  disturbance: number;
  hueShift: number;
  brightness: number;
}

// ─── Noise helpers (no external dependencies) ──────────────────────────────

/** Simple 2D hash returning a value in [−1, 1]. Used only for decorative noise (not sim RNG). */
function noiseHash2(x: number, y: number): number {
  // Integer hash chain (bit-mixing)
  let n = Math.imul(Math.imul(x | 0, 1664525) + 1013904223 | 0, (y | 0) ^ 0x9e3779b9 | 0);
  n = Math.imul(n ^ (n >>> 13), 1664525) + 1013904223 | 0;
  n = n ^ (n >>> 15);
  return (n & 0x7fffffff) / 0x3fffffff - 1.0;
}

/**
 * Smooth bilinear value noise in [−1, 1].
 * Scaled by `scale` so we sample at a useful frequency.
 */
function valueNoise(x: number, y: number, scale: number): number {
  const sx = x * scale;
  const sy = y * scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = sx - ix;
  const fy = sy - iy;
  // Smooth-step
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const v00 = noiseHash2(ix,     iy    );
  const v10 = noiseHash2(ix + 1, iy    );
  const v01 = noiseHash2(ix,     iy + 1);
  const v11 = noiseHash2(ix + 1, iy + 1);
  return v00 * (1 - ux) * (1 - uy)
       + v10 *      ux  * (1 - uy)
       + v01 * (1 - ux) *      uy
       + v11 *      ux  *      uy;
}

/**
 * 2D curl of a scalar noise potential field.
 * Returns [curlX, curlY] — a divergence-free velocity field.
 */
const EPS = 1.5;
function curlNoise(
  x: number, y: number, t: number,
  scale: number,
  outVel: Float32Array,
): void {
  // Shift x/y by t to animate the field over time (cheap time-animation trick)
  const tx = x + t * 40.0;
  const ty = y + t * 30.0;

  const n_yp = valueNoise(tx,       ty + EPS, scale);
  const n_ym = valueNoise(tx,       ty - EPS, scale);
  const n_xp = valueNoise(tx + EPS, ty,       scale);
  const n_xm = valueNoise(tx - EPS, ty,       scale);

  outVel[0] =  (n_yp - n_ym) / (2 * EPS);
  outVel[1] = -(n_xp - n_xm) / (2 * EPS);
}

// ─── Pre-allocated scratch ───────────────────────────────────────────────────

const _vel = new Float32Array(2);
const _drag = new Float32Array(2);

// ─── Public class ────────────────────────────────────────────────────────────

export class DecorativeParticleBackground {
  /** The canvas element to mount in the DOM (positioned absolute, full-screen). */
  readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly particles: DecorativeParticle[];
  private readonly theme: DecorativeTheme;
  private timeMs = 0;
  private lastTimestampMs = 0;
  private rafHandle = 0;
  private isRunning = false;
  private mouseX = 0;
  private mouseY = 0;
  private mousePrevX = 0;
  private mousePrevY = 0;
  private hasMouse = false;

  constructor(theme: DecorativeTheme = 'menu') {
    this.theme = theme;

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none;
    `;
    this.ctx = this.canvas.getContext('2d')!;

    this.particles = [];
    // Initialize at (0,0); resize() must be called after construction to scatter them.
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        prevX: 0,
        prevY: 0,
        alpha: 0.25 + Math.random() * 0.12,
        baseAlpha: 0.27 + Math.random() * 0.08,
        disturbance: 0,
        hueShift: Math.random(),
        brightness: 0.75 + Math.random() * 0.6,
      });
    }
  }

  /** Resize the canvas to match the container. Call after mounting. */
  resize(w: number, h: number): void {
    this.canvas.width  = w;
    this.canvas.height = h;
    // Scatter particles uniformly on resize
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].x = Math.random() * w;
      this.particles[i].y = Math.random() * h;
      this.particles[i].prevX = this.particles[i].x;
      this.particles[i].prevY = this.particles[i].y;
      this.particles[i].vx = 0;
      this.particles[i].vy = 0;
    }
  }

  /** Start the animation loop. */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTimestampMs = 0;
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseleave', this.onMouseLeave);
    this.rafHandle = requestAnimationFrame((t) => this.frame(t));
  }

  /** Stop the animation loop and clean up. */
  stop(): void {
    this.isRunning = false;
    if (this.rafHandle !== 0) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseleave', this.onMouseLeave);
  }

  private readonly onMouseMove = (ev: MouseEvent): void => {
    if (!this.hasMouse) {
      this.mouseX = ev.clientX;
      this.mouseY = ev.clientY;
      this.mousePrevX = ev.clientX;
      this.mousePrevY = ev.clientY;
      this.hasMouse = true;
      return;
    }
    this.mousePrevX = this.mouseX;
    this.mousePrevY = this.mouseY;
    this.mouseX = ev.clientX;
    this.mouseY = ev.clientY;
  };

  private readonly onMouseLeave = (): void => {
    this.hasMouse = false;
  };

  private frame(timestampMs: number): void {
    if (!this.isRunning) return;

    const dtMs = this.lastTimestampMs === 0
      ? 16.666
      : Math.min(timestampMs - this.lastTimestampMs, 50); // cap at 50ms
    this.lastTimestampMs = timestampMs;
    this.timeMs += dtMs;

    const t = this.timeMs * TIME_SPEED;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dtSec = dtMs / 1000.0;

    // Scale based on canvas dimensions so particles move at a consistent visual speed
    const noiseScale = 0.0026;

    // Clear with semi-transparent fill for motion trails
    this.ctx.globalAlpha = 1.0;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = this.theme === 'menu' ? 'rgba(18,12,6,0.20)' : 'rgba(16,10,6,0.18)';
    this.ctx.fillRect(0, 0, w, h);

    // Draw particles
    this.ctx.globalCompositeOperation = 'lighter';

    if (this.hasMouse) {
      _drag[0] = this.mouseX - this.mousePrevX;
      _drag[1] = this.mouseY - this.mousePrevY;
    } else {
      _drag[0] = 0;
      _drag[1] = 0;
    }

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.prevX = p.x;
      p.prevY = p.y;

      // Curl-noise velocity
      curlNoise(p.x, p.y, t, noiseScale, _vel);
      p.vx += _vel[0] * FLOW_FOLLOW * dtSec;
      p.vy += _vel[1] * FLOW_FOLLOW * dtSec;

      // Slight local repulsion only when decorative particles are close.
      for (let j = 0; j < this.particles.length; j++) {
        if (j === i) continue;
        const q = this.particles[j];
        const qx = p.x - q.x;
        const qy = p.y - q.y;
        const dist2 = qx * qx + qy * qy;
        const r = PARTICLE_REPEL_RADIUS_PX;
        if (dist2 >= r * r || dist2 < 1e-4) continue;
        const dist = Math.sqrt(dist2);
        const falloff = 1.0 - dist / r;
        const invDist = 1.0 / dist;
        p.vx += qx * invDist * falloff * PARTICLE_REPEL_STRENGTH * dtSec;
        p.vy += qy * invDist * falloff * PARTICLE_REPEL_STRENGTH * dtSec;
      }

      // Repel from screen edges with increasing strength near boundaries.
      const leftD = p.x;
      if (leftD < EDGE_REPEL_RANGE_PX) {
        p.vx += (EDGE_REPEL_STRENGTH / ((leftD + 8) * (leftD + 8))) * dtSec;
      }
      const rightD = w - p.x;
      if (rightD < EDGE_REPEL_RANGE_PX) {
        p.vx -= (EDGE_REPEL_STRENGTH / ((rightD + 8) * (rightD + 8))) * dtSec;
      }
      const topD = p.y;
      if (topD < EDGE_REPEL_RANGE_PX) {
        p.vy += (EDGE_REPEL_STRENGTH / ((topD + 8) * (topD + 8))) * dtSec;
      }
      const bottomD = h - p.y;
      if (bottomD < EDGE_REPEL_RANGE_PX) {
        p.vy -= (EDGE_REPEL_STRENGTH / ((bottomD + 8) * (bottomD + 8))) * dtSec;
      }

      if (this.hasMouse) {
        const dx = p.x - this.mouseX;
        const dy = p.y - this.mouseY;
        const d2 = dx * dx + dy * dy;
        const r2 = MOUSE_DISTURB_RADIUS_PX * MOUSE_DISTURB_RADIUS_PX;
        if (d2 < r2) {
          const falloff = 1.0 - d2 / r2;
          p.vx += _drag[0] * falloff * MOUSE_DRAG_FORCE;
          p.vy += _drag[1] * falloff * MOUSE_DRAG_FORCE;
          p.disturbance = Math.min(1, p.disturbance + falloff * 0.22);
        }
      }

      p.vx *= VELOCITY_DAMPING;
      p.vy *= VELOCITY_DAMPING;
      p.x += (p.vx + _vel[0] * CURL_SPEED) * dtSec;
      p.y += (p.vy + _vel[1] * CURL_SPEED) * dtSec;

      // Wrap around edges
      if (p.x < 0)  p.x += w;
      if (p.x > w)  p.x -= w;
      if (p.y < 0)  p.y += h;
      if (p.y > h)  p.y -= h;

      p.disturbance *= DISTURBANCE_DECAY;
      const targetAlpha = p.baseAlpha + p.disturbance * 0.55;
      p.alpha += (targetAlpha - p.alpha) * 0.075;

      const speed = Math.sqrt(_vel[0] * _vel[0] + _vel[1] * _vel[1]);
      const brightnessMod = (0.55 + speed * 1.6 + p.disturbance * 0.85) * p.brightness;
      const alpha = Math.min(1.0, p.alpha * brightnessMod);

      const radiusPx = RADIUS_PX + p.disturbance * 1.1;
      const gradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radiusPx * 2.7);

      const warm = this.theme === 'menu' ? 1.0 : 0.92;
      const goldR = Math.round((214 + p.hueShift * 34) * warm);
      const goldG = Math.round((146 + p.hueShift * 46) * warm);
      const goldB = Math.round((64 + p.hueShift * 30) * warm);
      const emberR = Math.round((122 + p.hueShift * 24) * warm);
      const emberG = Math.round((72 + p.hueShift * 24) * warm);
      const emberB = Math.round((34 + p.hueShift * 14) * warm);

      gradient.addColorStop(0, `rgba(${goldR},${goldG},${goldB},${alpha})`);
      gradient.addColorStop(0.42, `rgba(${emberR},${emberG},${emberB},${alpha * 0.75})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');

      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, radiusPx * 2.7, 0, Math.PI * 2);
      this.ctx.fill();

      // Draw a tiny trail segment to reinforce liquid-flow motion
      this.ctx.strokeStyle = `rgba(${goldR},${goldG},${goldB},${alpha * 0.35})`;
      this.ctx.lineWidth = 1.0 + p.disturbance * 0.9;
      this.ctx.beginPath();
      this.ctx.moveTo(p.prevX, p.prevY);
      this.ctx.lineTo(p.x, p.y);
      this.ctx.stroke();
    }

    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1.0;

    this.rafHandle = requestAnimationFrame((t2) => this.frame(t2));
  }
}
