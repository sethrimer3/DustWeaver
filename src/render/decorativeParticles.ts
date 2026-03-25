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
const PARTICLE_COUNT = 180;

/** Particle visual radius in pixels. */
const RADIUS_PX = 3.5;

/** How quickly the noise field evolves over time (lower = slower, smoother). */
const TIME_SPEED = 0.00012;

/** Speed scale for the curl velocity field. */
const CURL_SPEED = 55.0;

/** Colour palette index names for themes. */
export type DecorativeTheme = 'menu' | 'worldmap';

interface DecorativeParticle {
  x: number;
  y: number;
  alpha: number;
  baseAlpha: number;
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
        alpha: Math.random(),
        baseAlpha: 0.18 + Math.random() * 0.42,
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
    }
  }

  /** Start the animation loop. */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTimestampMs = 0;
    this.rafHandle = requestAnimationFrame((t) => this.frame(t));
  }

  /** Stop the animation loop and clean up. */
  stop(): void {
    this.isRunning = false;
    if (this.rafHandle !== 0) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
  }

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
    this.ctx.fillStyle = this.theme === 'menu' ? 'rgba(6,8,18,0.22)' : 'rgba(4,10,22,0.20)';
    this.ctx.fillRect(0, 0, w, h);

    // Draw particles
    this.ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // Curl-noise velocity
      curlNoise(p.x, p.y, t, noiseScale, _vel);
      p.x += _vel[0] * CURL_SPEED * dtSec;
      p.y += _vel[1] * CURL_SPEED * dtSec;

      // Wrap around edges
      if (p.x < 0)  p.x += w;
      if (p.x > w)  p.x -= w;
      if (p.y < 0)  p.y += h;
      if (p.y > h)  p.y -= h;

      // Fade alpha slowly toward baseAlpha
      p.alpha += (p.baseAlpha - p.alpha) * 0.02;

      const speed = Math.sqrt(_vel[0] * _vel[0] + _vel[1] * _vel[1]);
      const brightnessMod = 0.6 + speed * 1.8;
      const alpha = Math.min(1.0, p.alpha * brightnessMod);

      const gradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, RADIUS_PX * 2.5);

      if (this.theme === 'menu') {
        gradient.addColorStop(0, `rgba(100,200,255,${alpha})`);
        gradient.addColorStop(0.4, `rgba(40,120,220,${alpha * 0.6})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        // worldmap — slightly warmer teal
        gradient.addColorStop(0, `rgba(80,220,200,${alpha})`);
        gradient.addColorStop(0.4, `rgba(20,140,180,${alpha * 0.6})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
      }

      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, RADIUS_PX * 2.5, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1.0;

    this.rafHandle = requestAnimationFrame((t2) => this.frame(t2));
  }
}
