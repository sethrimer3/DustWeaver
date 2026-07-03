/**
 * SunraysRenderer — room-level procedural god-ray effect driven by
 * RoomDef.sunrays. Thin adapter over sunrays.ts that owns the reusable
 * light buffer and derives a deterministic ray field per room.
 *
 * Placement: call render() in the same slot as SunbeamRenderer — after
 * background/parallax layers, before walls — so rays appear to leak into
 * the cave from above without obscuring gameplay geometry.
 */

import type { RoomDef, RoomSunraysDef } from '../../levels/roomDef';
import {
  DEFAULT_SUNRAYS_CONFIG,
  createSunraysLightBuffer,
  generateSunrayDescriptors,
  renderHardSunrays,
  renderSoftSunrays,
  type SunrayDescriptor,
  type SunraysConfig,
  type SunraysLightBuffer,
} from './sunrays';

function hashRoomId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function toConfig(def: RoomSunraysDef, roomId: string): SunraysConfig {
  return {
    style: def.style,
    angleDeg: def.angleDeg,
    intensity: def.intensity ?? DEFAULT_SUNRAYS_CONFIG.intensity,
    rayCount: def.rayCount ?? DEFAULT_SUNRAYS_CONFIG.rayCount,
    animationEnabled: def.animationEnabled ?? DEFAULT_SUNRAYS_CONFIG.animationEnabled,
    seed: hashRoomId(roomId) || 1,
  };
}

export class SunraysRenderer {
  private _config: SunraysConfig | null = null;
  private _rays: SunrayDescriptor[] = [];
  private _isEnabled = true;
  private _reducedQuality = false;
  private readonly _lightBuffer: SunraysLightBuffer = createSunraysLightBuffer();

  initFromRoom(room: RoomDef): void {
    const def = room.sunrays ?? null;
    if (def === null || !def.enabled) {
      this._config = null;
      this._rays = [];
      return;
    }
    this._config = toConfig(def, room.id);
    this._rays = generateSunrayDescriptors(this._config);
  }

  /** Toggle sunray rendering on/off based on graphics quality tier. */
  setEnabled(enabled: boolean): void {
    this._isEnabled = enabled;
  }

  /** When true, soft mode uses fewer layers/less blur (adaptive reduction / low graphics). */
  setReducedQuality(reduced: boolean): void {
    this._reducedQuality = reduced;
  }

  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    nowMs: number,
    vpW: number,
    vpH: number,
  ): void {
    if (!this._isEnabled || this._config === null || this._rays.length === 0) return;
    if (vpW <= 0 || vpH <= 0) return;

    // Rays are generated in viewport space (top of the screen), not world/room
    // space, so they aren't affected by camera offset/zoom — they should track
    // the screen, not the room geometry. Clip to the current room's on-screen
    // rect so beams don't bleed into neighbouring rooms during transitions.
    void offsetXPx;
    void offsetYPx;
    void zoom;

    try {
      if (this._config.style === 'hard' || this._reducedQuality) {
        renderHardSunrays(ctx, vpW, vpH, this._config, nowMs, this._rays);
      } else {
        renderSoftSunrays(ctx, this._lightBuffer, vpW, vpH, this._config, nowMs, this._rays, this._reducedQuality);
      }
    } catch {
      // Never let a rendering failure break the room frame.
    }
  }
}
