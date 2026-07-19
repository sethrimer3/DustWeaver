/**
 * dustSelectionWheelRenderer.ts — In-canvas radial dust selection wheel.
 *
 * Pure render module: reads DustSelectionWheelController (screens/
 * gameDustSelectionState.ts) plus the player's world position and draws the
 * wheel on the virtual (480×270) canvas, centered on and following the
 * player sprite. Animation timing (expansion/fade) is entirely owned by the
 * controller — this module just samples it each frame via performance.now(),
 * matching the existing render-only wall-clock convention (see gameRender.ts).
 */

import type { DustSelectionWheelController } from '../../screens/gameDustSelectionState';
import { ParticleShape, getKindShape } from '../../sim/particles/kinds';
import { getDustDefinition } from '../../sim/weaves/dustDefinition';

/** Distance (world units) from the player's visual center to each option icon at full expansion. */
const DUST_WHEEL_RADIUS_WORLD = 24;
/** Icon radius (virtual pixels) for each wheel option at full expansion. */
const DUST_WHEEL_ICON_RADIUS_PX = 3.4;
/** Extra radius multiplier applied to the highlighted option's icon. */
const DUST_WHEEL_HIGHLIGHT_SCALE = 1.35;
/** Ring radius (virtual pixels) drawn around the currently-active option. */
const DUST_WHEEL_ACTIVE_RING_EXTRA_PX = 1.6;

function drawKindShape(
  ctx: CanvasRenderingContext2D,
  shape: ParticleShape,
  cxPx: number,
  cyPx: number,
  radiusPx: number,
): void {
  ctx.beginPath();
  switch (shape) {
    case ParticleShape.Square: {
      const s = radiusPx * 1.15;
      ctx.rect(cxPx - s, cyPx - s, s * 2, s * 2);
      break;
    }
    case ParticleShape.Diamond: {
      ctx.moveTo(cxPx, cyPx - radiusPx);
      ctx.lineTo(cxPx + radiusPx, cyPx);
      ctx.lineTo(cxPx, cyPx + radiusPx);
      ctx.lineTo(cxPx - radiusPx, cyPx);
      ctx.closePath();
      break;
    }
    case ParticleShape.Triangle: {
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i / 3) * Math.PI * 2;
        const px = cxPx + Math.cos(a) * radiusPx;
        const py = cyPx + Math.sin(a) * radiusPx;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case ParticleShape.Hexagon: {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const px = cxPx + Math.cos(a) * radiusPx;
        const py = cyPx + Math.sin(a) * radiusPx;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case ParticleShape.Cross: {
      const arm = radiusPx * 0.45;
      const len = radiusPx * 1.15;
      ctx.rect(cxPx - arm, cyPx - len, arm * 2, len * 2);
      ctx.rect(cxPx - len, cyPx - arm, len * 2, arm * 2);
      break;
    }
    case ParticleShape.Star: {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = (i % 2 === 0) ? radiusPx : radiusPx * 0.45;
        const px = cxPx + Math.cos(a) * r;
        const py = cyPx + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case ParticleShape.Ring: {
      ctx.arc(cxPx, cyPx, radiusPx, 0, Math.PI * 2);
      ctx.moveTo(cxPx + radiusPx * 0.45, cyPx);
      ctx.arc(cxPx, cyPx, radiusPx * 0.45, 0, Math.PI * 2, true);
      break;
    }
    case ParticleShape.Circle:
    default: {
      ctx.arc(cxPx, cyPx, radiusPx, 0, Math.PI * 2);
      break;
    }
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  const inv = t - 1;
  return 1 + c3 * inv * inv * inv + c1 * inv * inv;
}

/**
 * Renders the dust selection wheel centered on the player. No-op when the
 * wheel is fully closed. Intended to be called after the room clip is
 * restored (screen-content overlay, not clipped by room bounds) so it always
 * stays fully visible around the player.
 */
export function renderDustSelectionWheel(
  ctx: CanvasRenderingContext2D,
  dustWheel: DustSelectionWheelController,
  playerXWorld: number,
  playerYWorld: number,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  const nowMs = performance.now();
  const expansion = dustWheel.getExpansion01(nowMs);
  if (expansion <= 0) return;

  const options = dustWheel.getOptions();
  if (options.length === 0) return;

  const activeKind = dustWheel.getActiveKindAtOpen();
  const highlightedKind = dustWheel.getHighlightedKind();

  const playerScreenXPx = playerXWorld * scalePx + offsetXPx;
  const playerScreenYPx = playerYWorld * scalePx + offsetYPx;

  // Outward expansion uses a slight overshoot ease for a lively "pop" feel;
  // fade alpha stays linear with expansion so closing reads as a clean fade.
  const outwardT = easeOutBack(expansion);
  const radiusPx = DUST_WHEEL_RADIUS_WORLD * scalePx * outwardT;
  const alpha = Math.max(0, Math.min(1, expansion));

  const prevAlpha = ctx.globalAlpha;
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;

  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const iconCxPx = playerScreenXPx + Math.cos(option.angleRad) * radiusPx;
    const iconCyPx = playerScreenYPx + Math.sin(option.angleRad) * radiusPx;
    const isHighlighted = option.kind === highlightedKind;
    const isActive = option.kind === activeKind;
    const def = getDustDefinition(option.kind);
    const shape = getKindShape(option.kind);

    const iconRadiusPx = DUST_WHEEL_ICON_RADIUS_PX * scalePx * (isHighlighted ? DUST_WHEEL_HIGHLIGHT_SCALE : 1);

    // Active-dust ring — a thin outline just outside the icon.
    if (isActive) {
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(iconCxPx, iconCyPx, iconRadiusPx + DUST_WHEEL_ACTIVE_RING_EXTRA_PX, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Highlight glow behind the nearest-to-aim option.
    if (isHighlighted) {
      ctx.globalAlpha = alpha * 0.35;
      ctx.fillStyle = def.colorHex;
      ctx.beginPath();
      ctx.arc(iconCxPx, iconCyPx, iconRadiusPx * 1.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // Icon body — canonical color + shape.
    ctx.globalAlpha = alpha;
    ctx.fillStyle = def.colorHex;
    drawKindShape(ctx, shape, iconCxPx, iconCyPx, iconRadiusPx);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.6;
    drawKindShape(ctx, shape, iconCxPx, iconCyPx, iconRadiusPx);
    ctx.stroke();
  }

  // Label for the highlighted option only — keeps the wheel readable instead
  // of cluttering it with five permanently-visible names.
  if (highlightedKind !== null) {
    const highlightedOption = options.find(o => o.kind === highlightedKind);
    if (highlightedOption !== undefined) {
      const def = getDustDefinition(highlightedKind);
      const label = def.nickname !== undefined ? `${def.displayName} (${def.nickname})` : def.displayName;
      const labelXPx = playerScreenXPx + Math.cos(highlightedOption.angleRad) * (radiusPx + 12 * scalePx);
      const labelYPx = playerScreenYPx + Math.sin(highlightedOption.angleRad) * (radiusPx + 12 * scalePx);
      ctx.globalAlpha = alpha;
      ctx.font = '6px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const widthPx = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(labelXPx - widthPx / 2 - 2, labelYPx - 4, widthPx + 4, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, labelXPx, labelYPx);
    }
  }

  ctx.globalAlpha = prevAlpha;
  ctx.imageSmoothingEnabled = prevSmoothing;
}
