import { ClusterState } from '../sim/clusters/state';
import { WorldState } from '../sim/world';

const MAX_DUST_PARTICLES = 1000;
const SWIRL_ACCEL = 26.0;
const DRAG_PER_SECOND = 3.2;
const RETURN_TO_REST = 16.0;
const DISTURB_RADIUS_WORLD = 92.0;
const LANDING_RADIUS_WORLD = 145.0;
const LANDING_VERTICAL_SPEED_THRESHOLD = 80.0;
const DUST_RENDER_SIZE_PX = 4;
const LOBBY_WORLD_NUMBER = 0;


const BASE = import.meta.env.BASE_URL;
const GOLDEN_DUST_SPRITE_SRC = `${BASE}SPRITES/DUST/golden/goldenDust.png`;
const BROWN_DUST_SPRITE_SRC = `${BASE}SPRITES/DUST/brownRock/brownRockDust.png`;

function loadDustSprite(src: string): HTMLImageElement {
  const image = new Image();
  image.src = src;
  return image;
}

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
  private readonly goldenDustSprite = loadDustSprite(GOLDEN_DUST_SPRITE_SRC);
  private readonly brownDustSprite = loadDustSprite(BROWN_DUST_SPRITE_SRC);
  private activeDustSprite: HTMLImageElement | null = null;

  // ── Spatial wall grid for O(walls-in-column) collision queries ─────────────
  // Built once per room load in initFromWorld() and reused every tick.
  // Cell width = WALL_GRID_CELL_WORLD world units.  Each cell stores the
  // indices of all walls whose X range overlaps that column bucket.
  private readonly _wallColumnGrid = new Map<number, number[]>();
  private static readonly WALL_GRID_CELL_WORLD = 32;

  initFromWorld(world: WorldState, worldNumber: number): void {
    this.buildSurfaceSegments(world);
    this._buildWallGrid(world);
    this.activeDustSprite = worldNumber === LOBBY_WORLD_NUMBER ? this.goldenDustSprite : this.brownDustSprite;

    // All dust is now placed explicitly via editor dust piles — skip procedural generation.
    this.particleCount = 0;
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

  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx = 0,
    offsetYPx = 0,
    scalePx = 1.0,
    showHitboxes = false,
  ): void {
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

        const size = DUST_RENDER_SIZE_PX * scalePx;
        const drawX = this.xWorld[i] * scalePx + offsetXPx;
        const drawY = this.yWorld[i] * scalePx + offsetYPx;
        const sprite = this.activeDustSprite;
        if (sprite !== null && sprite.complete && sprite.naturalWidth > 0) {
          ctx.drawImage(sprite, drawX, drawY, size, size);
        } else {
          ctx.fillRect(
            drawX,
            drawY,
            size,
            size,
          );
        }
        if (showHitboxes) {
          ctx.strokeStyle = 'rgba(255, 230, 140, 0.9)';
          ctx.lineWidth = 0.75;
          ctx.strokeRect(drawX, drawY, size, size);
        }
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

  /**
   * Builds a spatial column grid for wall collision queries.
   * Each cell stores wall indices whose X range overlaps that column bucket.
   * Called once per room load; reused every tick.
   */
  private _buildWallGrid(world: WorldState): void {
    this._wallColumnGrid.clear();
    const cs = EnvironmentalDustLayer.WALL_GRID_CELL_WORLD;
    for (let wi = 0; wi < world.wallCount; wi++) {
      const wx = world.wallXWorld[wi];
      const ww = world.wallWWorld[wi];
      const c0 = Math.floor(wx / cs);
      const c1 = Math.floor((wx + ww) / cs);
      for (let c = c0; c <= c1; c++) {
        let cell = this._wallColumnGrid.get(c);
        if (cell === undefined) {
          cell = [];
          this._wallColumnGrid.set(c, cell);
        }
        cell.push(wi);
      }
    }
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

    const px = this.xWorld[particleIndex];
    const py = this.yWorld[particleIndex];
    const cs = EnvironmentalDustLayer.WALL_GRID_CELL_WORLD;
    const cellC = Math.floor(px / cs);

    // Interact with level walls and top surfaces.
    // Use the column grid to limit candidates to walls whose X range includes px.
    const wallCandidates = this._wallColumnGrid.get(cellC);
    if (wallCandidates !== undefined) {
      for (let ci = 0; ci < wallCandidates.length; ci++) {
        const wi = wallCandidates[ci];
        const wx = world.wallXWorld[wi];
        const wy = world.wallYWorld[wi];
        const ww = world.wallWWorld[wi];
        const wh = world.wallHWorld[wi];
        const right = wx + ww;
        const bottom = wy + wh;

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
    }

    // Re-anchor to nearest supporting surface under current x to keep the
    // "resting layer" behavior stable while still allowing disturbances.
    // Query the same column bucket for surface candidates.
    let bestSurfaceY = world.worldHeightWorld - 1;
    const pxNow = this.xWorld[particleIndex];
    const pyWorld = this.yWorld[particleIndex];
    const cellCNow = Math.floor(pxNow / cs);
    const surfaceCandidates = this._wallColumnGrid.get(cellCNow);
    if (surfaceCandidates !== undefined) {
      for (let ci = 0; ci < surfaceCandidates.length; ci++) {
        const wi = surfaceCandidates[ci];
        const wx = world.wallXWorld[wi];
        const ww = world.wallWWorld[wi];
        const wy = world.wallYWorld[wi];
        // Find the nearest surface at or above the particle (largest wy <= pyWorld), not the globally topmost one.
        if (pxNow >= wx && pxNow <= wx + ww && wy <= pyWorld && wy > bestSurfaceY) {
          bestSurfaceY = wy;
        }
      }
    }

    this.restYWorld[particleIndex] = bestSurfaceY - this.moundHeightPx[particleIndex];
    if (this.yWorld[particleIndex] > this.restYWorld[particleIndex]) {
      this.yWorld[particleIndex] = this.restYWorld[particleIndex];
      if (this.vyWorld[particleIndex] > 0) this.vyWorld[particleIndex] = 0;
    }
  }
}
