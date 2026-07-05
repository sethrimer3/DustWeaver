import type { ClusterSnapshot } from '../clusterSnapshotTypes';

export interface SunrayDustMoteConfig {
  readonly moteCountLoading: number;
  readonly moteCountGameplay: number;
  readonly moteBaseSpeed: number;
  readonly moteWanderAmount: number;
  readonly moteMaxAlpha: number;
  readonly playerAirCurrentRadius: number;
  readonly playerAirCurrentStrength: number;
  readonly playerAirCurrentDamping: number;
  readonly playerAirCurrentMinSpeed: number;
  readonly playerAirCurrentMaxSpeed: number;
  readonly playerAirCurrentWakeLength: number;
  readonly playerAirCurrentSwirlStrength: number;
  readonly playerAirCurrentMaxImpulse: number;
  readonly moteBrightnessColor: readonly [number, number, number];
  readonly intensityToAlphaPower: number;
}

export const DEFAULT_SUNRAY_DUST_MOTE_CONFIG: SunrayDustMoteConfig = {
  moteCountLoading: 70,
  moteCountGameplay: 46,
  moteBaseSpeed: 3.2,
  moteWanderAmount: 5.5,
  moteMaxAlpha: 0.5,
  playerAirCurrentRadius: 72,
  playerAirCurrentStrength: 0.022,
  playerAirCurrentDamping: 0.94,
  playerAirCurrentMinSpeed: 14,
  playerAirCurrentMaxSpeed: 620,
  playerAirCurrentWakeLength: 130,
  playerAirCurrentSwirlStrength: 0.05,
  playerAirCurrentMaxImpulse: 34,
  moteBrightnessColor: [255, 236, 188],
  intensityToAlphaPower: 1.35,
};

export type SunrayIntensitySampler = (xPx: number, yPx: number, timeMs: number) => number;

function hashSeed(seed: number): number {
  let x = seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

function seedUnit(seed: number): number {
  return hashSeed(seed) / 4294967295;
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

export class SunrayDustMotes {
  private readonly capacity: number;
  private readonly baseX: Float32Array;
  private readonly baseY: Float32Array;
  private readonly posX: Float32Array;
  private readonly posY: Float32Array;
  private readonly impulseX: Float32Array;
  private readonly impulseY: Float32Array;
  private readonly phaseA: Float32Array;
  private readonly phaseB: Float32Array;
  private readonly speed: Float32Array;
  private seed = 0;
  private lastViewportW = 0;
  private lastViewportH = 0;
  private lastTimeMs = 0;
  private prevPlayerX = 0;
  private prevPlayerY = 0;
  private hasPrevPlayer = false;

  constructor(
    private readonly config: SunrayDustMoteConfig = DEFAULT_SUNRAY_DUST_MOTE_CONFIG,
  ) {
    this.capacity = Math.max(config.moteCountLoading, config.moteCountGameplay);
    this.baseX = new Float32Array(this.capacity);
    this.baseY = new Float32Array(this.capacity);
    this.posX = new Float32Array(this.capacity);
    this.posY = new Float32Array(this.capacity);
    this.impulseX = new Float32Array(this.capacity);
    this.impulseY = new Float32Array(this.capacity);
    this.phaseA = new Float32Array(this.capacity);
    this.phaseB = new Float32Array(this.capacity);
    this.speed = new Float32Array(this.capacity);
  }

  reset(seed: number): void {
    this.seed = seed >>> 0;
    this.lastViewportW = 0;
    this.lastViewportH = 0;
    this.lastTimeMs = 0;
    this.hasPrevPlayer = false;
    this.impulseX.fill(0);
    this.impulseY.fill(0);
  }

  render(
    ctx: CanvasRenderingContext2D,
    viewportW: number,
    viewportH: number,
    timeMs: number,
    intensityAt: SunrayIntensitySampler,
    mode: 'loading' | 'gameplay',
    player: ClusterSnapshot | null = null,
    offsetXPx = 0,
    offsetYPx = 0,
    zoom = 1,
  ): void {
    const count = mode === 'loading' ? this.config.moteCountLoading : this.config.moteCountGameplay;
    if (count <= 0 || count > this.capacity || viewportW <= 0 || viewportH <= 0) return;
    this.ensureLayout(viewportW, viewportH, count);

    const dtSec = this.lastTimeMs > 0
      ? Math.min(0.05, Math.max(0.001, (timeMs - this.lastTimeMs) * 0.001))
      : 1 / 60;
    this.lastTimeMs = timeMs;

    if (mode === 'gameplay') this.applyPlayerAirCurrent(player, offsetXPx, offsetYPx, zoom, count, dtSec);

    const [r, g, b] = this.config.moteBrightnessColor;
    const prevAlpha = ctx.globalAlpha;
    const prevFill = ctx.fillStyle;
    const prevComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgb(${r},${g},${b})`;

    const t = timeMs * 0.001;
    for (let i = 0; i < count; i++) {
      this.impulseX[i] *= this.config.playerAirCurrentDamping;
      this.impulseY[i] *= this.config.playerAirCurrentDamping;

      const slowX = Math.sin(t * (0.11 + this.speed[i] * 0.018) + this.phaseA[i]);
      const slowY = Math.cos(t * (0.08 + this.speed[i] * 0.014) + this.phaseB[i]);
      const driftY = ((t * this.config.moteBaseSpeed * (0.45 + this.speed[i] * 0.28)) % Math.max(1, viewportH + 24));
      const x = this.wrap(this.baseX[i] + slowX * this.config.moteWanderAmount + this.impulseX[i], viewportW);
      const y = this.wrap(this.baseY[i] + driftY + slowY * this.config.moteWanderAmount + this.impulseY[i], viewportH);

      this.posX[i] = x;
      this.posY[i] = y;

      const intensity = clamp01(intensityAt(x, y, timeMs));
      if (intensity <= 0.002) continue;
      const alpha = Math.min(this.config.moteMaxAlpha, Math.pow(intensity, this.config.intensityToAlphaPower) * this.config.moteMaxAlpha);
      if (alpha <= 0.004) continue;

      ctx.globalAlpha = alpha;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }

    ctx.globalCompositeOperation = prevComposite;
    ctx.fillStyle = prevFill;
    ctx.globalAlpha = prevAlpha;
  }

  private ensureLayout(viewportW: number, viewportH: number, count: number): void {
    if (this.lastViewportW === viewportW && this.lastViewportH === viewportH) return;
    this.lastViewportW = viewportW;
    this.lastViewportH = viewportH;
    for (let i = 0; i < count; i++) {
      const s = this.seed + i * 1013;
      this.baseX[i] = seedUnit(s + 11) * viewportW;
      this.baseY[i] = seedUnit(s + 29) * viewportH;
      this.posX[i] = this.baseX[i];
      this.posY[i] = this.baseY[i];
      this.phaseA[i] = seedUnit(s + 47) * Math.PI * 2;
      this.phaseB[i] = seedUnit(s + 83) * Math.PI * 2;
      this.speed[i] = seedUnit(s + 131);
      this.impulseX[i] = 0;
      this.impulseY[i] = 0;
    }
  }

  private applyPlayerAirCurrent(
    player: ClusterSnapshot | null,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    count: number,
    dtSec: number,
  ): void {
    if (player === null || player === undefined || player.isAliveFlag !== 1) {
      this.hasPrevPlayer = false;
      return;
    }

    const px = offsetXPx + player.renderPositionXWorld * zoom;
    const py = offsetYPx + player.renderPositionYWorld * zoom;
    if (!this.hasPrevPlayer) {
      this.prevPlayerX = px;
      this.prevPlayerY = py;
      this.hasPrevPlayer = true;
      return;
    }

    const moveX = px - this.prevPlayerX;
    const moveY = py - this.prevPlayerY;
    this.prevPlayerX = px;
    this.prevPlayerY = py;
    const moveSpeed = Math.hypot(moveX, moveY) / Math.max(0.001, dtSec);
    const cfg = this.config;
    if (moveSpeed < cfg.playerAirCurrentMinSpeed) return;

    // Speed factor: eased 0..1 ramp between min and max configured speeds so slow
    // walking barely disturbs the dust while sprint/grapple speeds stir it strongly.
    const speedRange = Math.max(1, cfg.playerAirCurrentMaxSpeed - cfg.playerAirCurrentMinSpeed);
    const rawSpeedT = clamp01((moveSpeed - cfg.playerAirCurrentMinSpeed) / speedRange);
    const speedFactor = rawSpeedT * rawSpeedT * (3 - 2 * rawSpeedT); // smoothstep easing

    // Normalized movement direction + perpendicular side vector.
    const invMoveLen = 1 / Math.max(0.0001, Math.hypot(moveX, moveY));
    const dirX = moveX * invMoveLen;
    const dirY = moveY * invMoveLen;
    const sideX = -dirY;
    const sideY = dirX;

    const radius = cfg.playerAirCurrentRadius;
    const radiusSq = radius * radius;
    const wakeLength = cfg.playerAirCurrentWakeLength;
    const strength = cfg.playerAirCurrentStrength * speedFactor;
    const swirlStrength = cfg.playerAirCurrentSwirlStrength * speedFactor;

    // Side vortex centers: sit just beside and slightly behind the player so the
    // dust rolls off each side like paired eddies trailing the motion.
    const vortexOffsetSide = radius * 0.55;
    const vortexOffsetBack = radius * 0.35;
    const leftX = px + sideX * vortexOffsetSide - dirX * vortexOffsetBack;
    const leftY = py + sideY * vortexOffsetSide - dirY * vortexOffsetBack;
    const rightX = px - sideX * vortexOffsetSide - dirX * vortexOffsetBack;
    const rightY = py - sideY * vortexOffsetSide - dirY * vortexOffsetBack;

    for (let i = 0; i < count; i++) {
      const x = this.posX[i];
      const y = this.posY[i];

      // Forward displacement: motes near/ahead of the player get pushed aside.
      const fdx = x - px;
      const fdy = y - py;
      const fdSq = fdx * fdx + fdy * fdy;
      if (fdSq < radiusSq) {
        const falloff = 1 - fdSq / radiusSq;
        const softFalloff = falloff * falloff;
        // Push outward along the side axis away from the player's centerline.
        const lateral = fdx * sideX + fdy * sideY;
        const pushSign = lateral >= 0 ? 1 : -1;
        this.impulseX[i] += (dirX * 0.4 + sideX * pushSign * 0.6) * strength * softFalloff;
        this.impulseY[i] += (dirY * 0.4 + sideY * pushSign * 0.6) * strength * softFalloff;
      }

      // Side vortex: tangential swirl impulse around each wake center, spinning
      // opposite directions so dust curls into paired eddies off the player's flanks.
      this.applyVortex(i, x, y, leftX, leftY, radius, swirlStrength, 1);
      this.applyVortex(i, x, y, rightX, rightY, radius, swirlStrength, -1);

      // Trailing wake: motes behind the player get pulled into soft turbulence.
      const bx = x - (px - dirX * wakeLength * 0.5);
      const by = y - (py - dirY * wakeLength * 0.5);
      const behind = -(bx * dirX + by * dirY);
      if (behind > 0 && behind < wakeLength) {
        const bdSq = bx * bx + by * by;
        const wakeRadiusSq = radius * radius * 1.4;
        if (bdSq < wakeRadiusSq) {
          const wakeFalloff = (1 - behind / wakeLength) * (1 - bdSq / wakeRadiusSq);
          const swirl = Math.sin(this.phaseA[i] * 3 + behind * 0.06) * 0.5;
          this.impulseX[i] += (-dirX * 0.3 + sideX * swirl) * strength * wakeFalloff;
          this.impulseY[i] += (-dirY * 0.3 + sideY * swirl) * strength * wakeFalloff;
        }
      }

      this.impulseX[i] = this.clampImpulse(this.impulseX[i]);
      this.impulseY[i] = this.clampImpulse(this.impulseY[i]);
    }
  }

  private applyVortex(
    i: number,
    x: number,
    y: number,
    centerX: number,
    centerY: number,
    radius: number,
    swirlStrength: number,
    spinSign: number,
  ): void {
    const dx = x - centerX;
    const dy = y - centerY;
    const dSq = dx * dx + dy * dy;
    const vortexRadius = radius * 0.85;
    const vortexRadiusSq = vortexRadius * vortexRadius;
    if (dSq >= vortexRadiusSq || dSq < 1) return;
    const falloff = 1 - dSq / vortexRadiusSq;
    const softFalloff = falloff * falloff;
    // Tangential direction: perpendicular to the radius vector, rotated by spinSign.
    const dist = Math.sqrt(dSq);
    const tangentX = (-dy / dist) * spinSign;
    const tangentY = (dx / dist) * spinSign;
    this.impulseX[i] += tangentX * swirlStrength * softFalloff * radius;
    this.impulseY[i] += tangentY * swirlStrength * softFalloff * radius;
  }

  private wrap(value: number, max: number): number {
    if (max <= 0) return 0;
    let v = value % max;
    if (v < 0) v += max;
    return v;
  }

  private clampImpulse(value: number): number {
    const limit = this.config.playerAirCurrentMaxImpulse;
    return Math.max(-limit, Math.min(limit, value));
  }
}
