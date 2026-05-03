/**
 * AtmosphericLightDust — pre-allocated typed-array mote system.
 *
 * Motes spawn near light sources that have dustMoteCount > 0 and drift slowly
 * upward with gentle horizontal wander, fading in and out over their lifetime.
 *
 * Usage:
 *   initFromRoom(room)              — populate spawn zones from a RoomDef
 *   setMaxMotes(n)                  — apply a quality-tier mote cap
 *   update(dtMs)                    — advance mote positions each game tick
 *   render(ctx, ox, oy, zoom, vpW, vpH) — draw visible motes onto a 2D canvas
 */

import type { RoomDef } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';

const MAX_MOTES = 512;

/** World units per millisecond — upward drift speed for motes. */
const DRIFT_SPEED_WORLD_PER_MS = 0.008;
/** Maximum horizontal wander speed (world units/ms). */
const WANDER_SPEED_WORLD_PER_MS = 0.004;

interface SpawnZone {
  xWorld: number;
  yWorld: number;
  spreadWorld: number;
  colorR: number;
  colorG: number;
  colorB: number;
}

export class AtmosphericLightDust {
  private readonly moteX = new Float32Array(MAX_MOTES);
  private readonly moteY = new Float32Array(MAX_MOTES);
  private readonly moteVx = new Float32Array(MAX_MOTES);
  private readonly moteVy = new Float32Array(MAX_MOTES);
  private readonly moteAge = new Float32Array(MAX_MOTES);
  private readonly moteLifetime = new Float32Array(MAX_MOTES);
  private readonly moteR = new Uint8Array(MAX_MOTES);
  private readonly moteG = new Uint8Array(MAX_MOTES);
  private readonly moteB = new Uint8Array(MAX_MOTES);

  private moteCount = 0;
  private spawnZones: SpawnZone[] = [];
  private spawnZoneIndex = 0;
  /** Effective mote cap for the current quality tier.  Defaults to MAX_MOTES. */
  private _maxMotes = MAX_MOTES;

  /** Update the maximum live mote count.  New motes won't spawn above this cap;
   *  existing motes above it fade out naturally over their lifetime. */
  setMaxMotes(n: number): void {
    this._maxMotes = Math.max(0, Math.min(n, MAX_MOTES));
  }

  initFromRoom(room: RoomDef): void {
    this.spawnZones = [];
    this.moteCount = 0;

    for (const ls of room.lightSources ?? []) {
      if ((ls.dustMoteCount ?? 0) <= 0) continue;
      const spreadWorld = ((ls.dustMoteSpreadBlocks ?? 0) > 0
        ? ls.dustMoteSpreadBlocks!
        : ls.radiusBlocks) * BLOCK_SIZE_SMALL;
      this.spawnZones.push({
        xWorld: ls.xBlock * BLOCK_SIZE_SMALL,
        yWorld: ls.yBlock * BLOCK_SIZE_SMALL,
        spreadWorld,
        colorR: ls.colorR,
        colorG: ls.colorG,
        colorB: ls.colorB,
      });

      // Pre-seed up to dustMoteCount motes for this zone, capped by _maxMotes.
      const count = ls.dustMoteCount ?? 0;
      for (let n = 0; n < count && this.moteCount < this._maxMotes; n++) {
        this._spawnMote(this.spawnZones[this.spawnZones.length - 1], true);
      }
    }
  }

  update(dtMs: number): void {
    if (this.moteCount === 0 && this.spawnZones.length === 0) return;

    for (let i = 0; i < this.moteCount; i++) {
      this.moteAge[i] += dtMs;
      if (this.moteAge[i] >= this.moteLifetime[i]) {
        // Recycle this mote slot — overwrite with the last live mote.
        const last = this.moteCount - 1;
        if (i !== last) {
          this.moteX[i]        = this.moteX[last];
          this.moteY[i]        = this.moteY[last];
          this.moteVx[i]       = this.moteVx[last];
          this.moteVy[i]       = this.moteVy[last];
          this.moteAge[i]      = this.moteAge[last];
          this.moteLifetime[i] = this.moteLifetime[last];
          this.moteR[i]        = this.moteR[last];
          this.moteG[i]        = this.moteG[last];
          this.moteB[i]        = this.moteB[last];
        }
        this.moteCount--;
        i--;
        continue;
      }

      this.moteX[i] += this.moteVx[i] * dtMs;
      this.moteY[i] += this.moteVy[i] * dtMs;
      // Wander: gradually nudge horizontal velocity toward zero with small noise.
      this.moteVx[i] += (Math.random() - 0.5) * WANDER_SPEED_WORLD_PER_MS * 2;
      this.moteVx[i] *= 0.99;
    }

    // Spawn replacement motes so the pool stays filled, respecting the quality cap.
    if (this.spawnZones.length > 0 && this.moteCount < this._maxMotes) {
      const zone = this.spawnZones[this.spawnZoneIndex % this.spawnZones.length];
      this._spawnMote(zone, false);
      this.spawnZoneIndex++;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    vpW: number,
    vpH: number,
  ): void {
    if (this.moteCount === 0) return;

    const prevComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'screen';

    // Motes are 2×2 px; add 2 px margin so partially-visible motes are drawn.
    const cullMarginPx = 2;

    for (let i = 0; i < this.moteCount; i++) {
      const px = this.moteX[i] * zoom + offsetXPx;
      const py = this.moteY[i] * zoom + offsetYPx;

      // Skip motes outside the visible viewport.
      if (px + cullMarginPx < 0 || px > vpW || py + cullMarginPx < 0 || py > vpH) continue;

      const t = this.moteAge[i] / this.moteLifetime[i];
      // Fade in over first 20%, fade out over last 30%.
      let alpha: number;
      if (t < 0.2) {
        alpha = t / 0.2;
      } else if (t > 0.7) {
        alpha = (1 - t) / 0.3;
      } else {
        alpha = 1;
      }
      alpha *= 0.5; // Max opacity 50% so motes are subtle.

      const r = this.moteR[i];
      const g = this.moteG[i];
      const b = this.moteB[i];

      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
      ctx.fillRect(Math.round(px), Math.round(py), 2, 2);
    }

    ctx.globalCompositeOperation = prevComposite;
  }

  private _spawnMote(zone: SpawnZone, randomizeAge: boolean): void {
    if (this.moteCount >= this._maxMotes) return;
    const i = this.moteCount++;
    const spread = zone.spreadWorld;
    this.moteX[i] = zone.xWorld + (Math.random() - 0.5) * spread * 2;
    this.moteY[i] = zone.yWorld + (Math.random() - 0.5) * spread * 2;
    this.moteVx[i] = (Math.random() - 0.5) * WANDER_SPEED_WORLD_PER_MS * 2;
    this.moteVy[i] = -DRIFT_SPEED_WORLD_PER_MS * (0.5 + Math.random() * 0.5);
    const lifetimeMs = 3000 + Math.random() * 4000;
    this.moteLifetime[i] = lifetimeMs;
    this.moteAge[i] = randomizeAge ? Math.random() * lifetimeMs : 0;
    this.moteR[i] = zone.colorR;
    this.moteG[i] = zone.colorG;
    this.moteB[i] = zone.colorB;
  }
}

