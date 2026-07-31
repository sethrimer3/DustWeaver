/**
 * verdantAfterimageTrail.ts — Render-only afterimage trail shown behind the
 * player while moving with Verdant Dust equipped.
 *
 * Each entry is a compact snapshot of the player's actual displayed sprite
 * (the same resolved `HTMLImageElement` `getPlayerSprite` returns — already
 * encodes pose/animation frame/state, so no separate "source frame" index is
 * needed) plus facing and world position at time of sampling — never a
 * rectangle/silhouette approximation.
 *
 * Sampling is distance-based (a new entry is captured only once the player
 * has moved at least `SAMPLE_DISTANCE_WORLD` since the last sample), not
 * once per render frame, so density stays stable across frame rates. Newest
 * entries render vivid green and opaque; older entries fade toward darker
 * green and more transparent. Bounded to `MAX_VERDANT_AFTERIMAGES` (~15)
 * live entries via a ring-style array (oldest evicted on overflow).
 *
 * Never touches WorldState, saves, collision, damage, or simulation.
 */

export const MAX_VERDANT_AFTERIMAGES = 15;

/** Minimum world-unit distance between successive samples (distance-based, not per-frame). */
const SAMPLE_DISTANCE_WORLD = 3.0;

/** Total lifetime (seconds) an entry stays visible before fully fading out. */
const LIFETIME_SEC = 0.45;

const NEWEST_ALPHA = 0.55;
const OLDEST_ALPHA = 0.0;

export interface VerdantAfterimageSnapshot {
  /** The exact resolved displayed sprite image at sampling time. */
  sprite: HTMLImageElement;
  xWorld: number;
  yWorld: number;
  isFacingLeft: boolean;
}

interface VerdantAfterimageEntry extends VerdantAfterimageSnapshot {
  ageSec: number;
}

export class VerdantAfterimageTrail {
  private readonly entries: VerdantAfterimageEntry[] = [];
  private lastSampleXWorld = 0;
  private lastSampleYWorld = 0;
  private hasLastSample = false;

  /**
   * Advances entry ages and, if `active` (Verdant equipped + player moving),
   * captures a new snapshot once the player has moved far enough since the
   * last sample. Pass `active = false` to stop producing new afterimages
   * (e.g. Verdant unequipped or player stationary) while existing entries
   * keep fading out normally.
   */
  update(dtSec: number, active: boolean, snapshot: VerdantAfterimageSnapshot): void {
    // Age + cull expired entries.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      this.entries[i].ageSec += dtSec;
      if (this.entries[i].ageSec >= LIFETIME_SEC) {
        this.entries.splice(i, 1);
      }
    }

    if (!active) {
      this.hasLastSample = false;
      return;
    }

    if (!this.hasLastSample) {
      this.lastSampleXWorld = snapshot.xWorld;
      this.lastSampleYWorld = snapshot.yWorld;
      this.hasLastSample = true;
      return;
    }

    const dx = snapshot.xWorld - this.lastSampleXWorld;
    const dy = snapshot.yWorld - this.lastSampleYWorld;
    const dist = Math.hypot(dx, dy);
    if (dist < SAMPLE_DISTANCE_WORLD) return;

    this.entries.push({
      sprite: snapshot.sprite,
      xWorld: snapshot.xWorld,
      yWorld: snapshot.yWorld,
      isFacingLeft: snapshot.isFacingLeft,
      ageSec: 0,
    });
    if (this.entries.length > MAX_VERDANT_AFTERIMAGES) {
      // Oldest is always at index 0 (entries are appended newest-last).
      this.entries.shift();
    }
    this.lastSampleXWorld = snapshot.xWorld;
    this.lastSampleYWorld = snapshot.yWorld;
  }

  /**
   * Renders oldest-to-newest so newer (more opaque/vivid) entries draw over
   * older ones. Must be called BEFORE the real player sprite so the trail
   * sits behind it.
   */
  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
    spritePivotXWorld: number,
    spriteWidthWorld: number,
    spriteHeightWorld: number,
  ): void {
    if (this.entries.length === 0) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const t = Math.min(1, e.ageSec / LIFETIME_SEC); // 0 = newest, 1 = about to expire
      const alpha = NEWEST_ALPHA + (OLDEST_ALPHA - NEWEST_ALPHA) * t;
      if (alpha <= 0.002) continue;
      // Newest = vivid green (high brightness/saturation); older = darker
      // green (reduced brightness), achieved with a canvas filter tint over
      // the real sprite pixels rather than a silhouette approximation.
      const brightness = 1.0 - 0.55 * t;
      const screenX = Math.round(e.xWorld * scalePx + offsetXPx);
      const screenY = Math.round(e.yWorld * scalePx + offsetYPx);
      const spritePivotX = spritePivotXWorld * scalePx;
      const spriteW = spriteWidthWorld * scalePx;
      const spriteH = spriteHeightWorld * scalePx;
      ctx.save();
      ctx.translate(screenX, screenY);
      if (e.isFacingLeft) ctx.scale(-1, 1);
      ctx.globalAlpha = alpha;
      ctx.filter = `sepia(1) saturate(600%) hue-rotate(72deg) brightness(${brightness})`;
      ctx.drawImage(e.sprite, -spritePivotX, -spriteH * 0.5, spriteW, spriteH);
      ctx.restore();
    }
    ctx.restore();
  }

  /** Clears all entries and sampling state — call on room load/activation, respawn, and dust changes. */
  reset(): void {
    this.entries.length = 0;
    this.hasLastSample = false;
  }

  /** Current live entry count — exposed for tests. */
  get entryCount(): number {
    return this.entries.length;
  }

  /** Read-only snapshot access for tests (oldest-to-newest order). */
  getEntriesForTest(): ReadonlyArray<{ ageSec: number; xWorld: number; yWorld: number; isFacingLeft: boolean }> {
    return this.entries;
  }
}
