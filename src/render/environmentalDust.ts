import { ClusterState } from '../sim/clusters/state';
import { WorldState } from '../sim/world';

const MAX_DUST_PARTICLES = 1000;
const DUST_DENSITY_PER_1000PX = 420;
const SWIRL_ACCEL = 26.0;
const DRAG_PER_SECOND = 3.2;
const RETURN_TO_REST = 16.0;
const DISTURB_RADIUS_WORLD = 92.0;
const LANDING_RADIUS_WORLD = 145.0;
const LANDING_VERTICAL_SPEED_THRESHOLD = 80.0;

interface SurfaceSegment {
  x0: number;
  x1: number;
  y: number;
}

/**
 * Efficient environmental dust layer rendered in front of actors.
 *
 * Dust is simulated entirely with typed arrays so the game can keep ~1000
 * particles active per view without heavy GC pressure.
 */
export class EnvironmentalDustLayer {
  private particleCount = 0;

  private readonly xWorld = new Float32Array(MAX_DUST_PARTICLES);
  private readonly yWorld = new Float32Array(MAX_DUST_PARTICLES);
  private readonly vxWorld = new Float32Array(MAX_DUST_PARTICLES);
  private readonly vyWorld = new Float32Array(MAX_DUST_PARTICLES);
  private readonly restYWorld = new Float32Array(MAX_DUST_PARTICLES);
  private readonly moundHeightPx = new Uint8Array(MAX_DUST_PARTICLES);
  private readonly glow = new Float32Array(MAX_DUST_PARTICLES);

  private readonly prevGroundedFlags: number[] = [];

  private readonly surfaces: SurfaceSegment[] = [];

  initFromWorld(world: WorldState): void {
    this.buildSurfaceSegments(world);

    const targetCount = Math.min(
      MAX_DUST_PARTICLES,
      Math.max(300, Math.floor((world.worldWidthWorld / 1000) * DUST_DENSITY_PER_1000PX)),
    );
    this.particleCount = targetCount;

    for (let i = 0; i < targetCount; i++) {
      this.spawnParticleAtSurface(i);
      this.vxWorld[i] = 0.0;
      this.vyWorld[i] = 0.0;
      this.glow[i] = 0.0;
    }

    this.prevGroundedFlags.length = world.clusters.length;
    for (let ci = 0; ci < world.clusters.length; ci++) {
      this.prevGroundedFlags[ci] = world.clusters[ci].isGroundedFlag;
    }
  }

  update(world: WorldState, dtMs: number): void {
    if (this.particleCount === 0) return;

    const dt = dtMs / 1000.0;
    const time = world.tick * 0.035;

    // Disturbance from cluster movement (player + enemies).
    for (let ci = 0; ci < world.clusters.length; ci++) {
      const cluster = world.clusters[ci];
      if (cluster.isAliveFlag === 0) {
        this.prevGroundedFlags[ci] = cluster.isGroundedFlag;
        continue;
      }

      const speed = Math.hypot(cluster.velocityXWorld, cluster.velocityYWorld);
      if (speed > 5.0) {
        this.applyClusterDisturbance(cluster, speed, DISTURB_RADIUS_WORLD, 1.0, dt, time);
      }

      const wasGrounded = this.prevGroundedFlags[ci] === 1;
      const isGroundedNow = cluster.isGroundedFlag === 1;
      if (!wasGrounded && isGroundedNow && cluster.velocityYWorld > LANDING_VERTICAL_SPEED_THRESHOLD) {
        this.applyClusterDisturbance(
          cluster,
          cluster.velocityYWorld,
          LANDING_RADIUS_WORLD,
          2.2,
          dt,
          time,
        );
      }

      this.prevGroundedFlags[ci] = cluster.isGroundedFlag;
    }

    // Integrate dust with light swirl, drag, spring-to-rest, and wall/floor interaction.
    const dragScale = Math.max(0.0, 1.0 - DRAG_PER_SECOND * dt);
    for (let i = 0; i < this.particleCount; i++) {
      const swirlX = Math.sin((this.yWorld[i] + time * 120.0) * 0.032) * SWIRL_ACCEL;
      const swirlY = Math.cos((this.xWorld[i] - time * 85.0) * 0.028) * SWIRL_ACCEL * 0.15;

      this.vxWorld[i] += swirlX * dt;
      this.vyWorld[i] += swirlY * dt;

      const towardRestY = this.restYWorld[i] - this.yWorld[i];
      this.vyWorld[i] += towardRestY * RETURN_TO_REST * dt;

      this.vxWorld[i] *= dragScale;
      this.vyWorld[i] *= dragScale;

      this.xWorld[i] += this.vxWorld[i] * dt;
      this.yWorld[i] += this.vyWorld[i] * dt;

      this.resolveWorldCollisions(world, i);

      this.glow[i] = Math.max(0.0, this.glow[i] - dt * 1.8);
    }
  }

  render(ctx: CanvasRenderingContext2D, offsetXPx = 0, offsetYPx = 0, scalePx = 1.0): void {
    if (this.particleCount === 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    // Low → high disturbance palette: dark gold to bright gold.
    const palette = ['#6f5617', '#7e631b', '#8e7120', '#a07f25', '#b58f2f', '#cca23e', '#e7b84f', '#ffd978'];
    const bins = palette.length;

    for (let bi = 0; bi < bins; bi++) {
      ctx.fillStyle = palette[bi];
      const minGlow = bi / bins;
      const maxGlow = (bi + 1) / bins;
      for (let i = 0; i < this.particleCount; i++) {
        const g = this.glow[i];
        if (g < minGlow || g >= maxGlow) continue;

        const size = (1 + (this.moundHeightPx[i] > 2 ? 1 : 0)) * scalePx;
        ctx.fillRect(
          this.xWorld[i] * scalePx + offsetXPx,
          this.yWorld[i] * scalePx + offsetYPx,
          size,
          size,
        );
      }
    }

    ctx.restore();
  }

  private buildSurfaceSegments(world: WorldState): void {
    this.surfaces.length = 0;

    // Ground/floor surface.
    this.surfaces.push({
      x0: 0,
      x1: world.worldWidthWorld,
      y: world.worldHeightWorld - 1,
    });

    for (let wi = 0; wi < world.wallCount; wi++) {
      const x0 = world.wallXWorld[wi];
      const x1 = x0 + world.wallWWorld[wi];
      const y = world.wallYWorld[wi];
      this.surfaces.push({ x0, x1, y });
    }
  }

  private spawnParticleAtSurface(index: number): void {
    const surface = this.surfaces[(Math.random() * this.surfaces.length) | 0];
    const x = surface.x0 + Math.random() * (surface.x1 - surface.x0);

    // Mound height bias: 0-2 common, 3 uncommon, 4 rare peak.
    const r = Math.random();
    const mound = r < 0.45 ? 0 : r < 0.76 ? 1 : r < 0.92 ? 2 : r < 0.985 ? 3 : 4;

    this.xWorld[index] = x;
    this.moundHeightPx[index] = mound;
    this.restYWorld[index] = surface.y - mound;
    this.yWorld[index] = this.restYWorld[index];
  }

  private applyClusterDisturbance(
    cluster: ClusterState,
    speed: number,
    radiusWorld: number,
    strengthScale: number,
    dt: number,
    time: number,
  ): void {
    const radiusSq = radiusWorld * radiusWorld;
    const impulse = Math.min(1.0, speed / 320.0) * 900.0 * strengthScale;

    for (let i = 0; i < this.particleCount; i++) {
      const dx = this.xWorld[i] - cluster.positionXWorld;
      const dy = this.yWorld[i] - cluster.positionYWorld;
      const d2 = dx * dx + dy * dy;
      if (d2 > radiusSq || d2 < 0.0001) continue;

      const d = Math.sqrt(d2);
      const invD = 1.0 / d;
      const falloff = (1.0 - d / radiusWorld);

      // Outward push plus tangential swirl driven by actor velocity.
      const nx = dx * invD;
      const ny = dy * invD;
      const tx = -ny;
      const ty = nx;
      const tangential = (cluster.velocityXWorld * tx + cluster.velocityYWorld * ty) * 0.16;
      const wave = Math.sin((time + i * 0.03) * 7.0) * 0.55;

      this.vxWorld[i] += (nx * impulse + tx * tangential * 180.0 * wave) * falloff * dt;
      this.vyWorld[i] += (ny * impulse + ty * tangential * 180.0 * wave) * falloff * dt;

      const speedNow = Math.hypot(this.vxWorld[i], this.vyWorld[i]);
      const brightnessBoost = Math.min(1.0, speedNow / 180.0);
      this.glow[i] = Math.max(this.glow[i], brightnessBoost);
    }
  }

  private resolveWorldCollisions(world: WorldState, particleIndex: number): void {
    // Keep inside world bounds.
    if (this.xWorld[particleIndex] < 0) {
      this.xWorld[particleIndex] = 0;
      this.vxWorld[particleIndex] *= -0.2;
    } else if (this.xWorld[particleIndex] > world.worldWidthWorld - 1) {
      this.xWorld[particleIndex] = world.worldWidthWorld - 1;
      this.vxWorld[particleIndex] *= -0.2;
    }

    if (this.yWorld[particleIndex] > world.worldHeightWorld - 1) {
      this.yWorld[particleIndex] = world.worldHeightWorld - 1;
      this.vyWorld[particleIndex] *= -0.25;
    }

    // Interact with level walls and top surfaces.
    for (let wi = 0; wi < world.wallCount; wi++) {
      const wx = world.wallXWorld[wi];
      const wy = world.wallYWorld[wi];
      const ww = world.wallWWorld[wi];
      const wh = world.wallHWorld[wi];
      const right = wx + ww;
      const bottom = wy + wh;

      const px = this.xWorld[particleIndex];
      const py = this.yWorld[particleIndex];
      if (px < wx || px > right || py < wy || py > bottom) continue;

      const distLeft = Math.abs(px - wx);
      const distRight = Math.abs(right - px);
      const distTop = Math.abs(py - wy);
      const distBottom = Math.abs(bottom - py);

      if (distTop <= distLeft && distTop <= distRight && distTop <= distBottom) {
        this.yWorld[particleIndex] = wy - 0.5;
        this.vyWorld[particleIndex] = Math.min(0, this.vyWorld[particleIndex]);
        const mound = this.moundHeightPx[particleIndex];
        this.restYWorld[particleIndex] = wy - mound;
      } else if (distLeft < distRight) {
        this.xWorld[particleIndex] = wx - 0.5;
        this.vxWorld[particleIndex] *= -0.2;
      } else {
        this.xWorld[particleIndex] = right + 0.5;
        this.vxWorld[particleIndex] *= -0.2;
      }
    }

    // Re-anchor to nearest supporting surface under current x to keep the
    // "resting layer" behavior stable while still allowing disturbances.
    let bestSurfaceY = world.worldHeightWorld - 1;
    const px = this.xWorld[particleIndex];
    for (let wi = 0; wi < world.wallCount; wi++) {
      const wx = world.wallXWorld[wi];
      const ww = world.wallWWorld[wi];
      const wy = world.wallYWorld[wi];
      if (px >= wx && px <= wx + ww && wy <= bestSurfaceY) {
        bestSurfaceY = wy;
      }
    }

    this.restYWorld[particleIndex] = bestSurfaceY - this.moundHeightPx[particleIndex];
    if (this.yWorld[particleIndex] > this.restYWorld[particleIndex]) {
      this.yWorld[particleIndex] = this.restYWorld[particleIndex];
      if (this.vyWorld[particleIndex] > 0) this.vyWorld[particleIndex] = 0;
    }
  }
}
