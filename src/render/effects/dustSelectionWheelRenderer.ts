/**
 * dustSelectionWheelRenderer.ts — Device-canvas radial dust selection wheel.
 *
 * Pure render module: reads DustSelectionWheelController (screens/
 * gameDustSelectionState.ts) plus the player's world position and draws the
 * wheel directly onto the device (real-resolution) canvas, centered on and
 * following the player sprite. Animation timing (expansion/fade) is entirely
 * owned by the controller — this module just samples it each frame via
 * performance.now(), matching the existing render-only wall-clock convention
 * (see gameRender.ts).
 *
 * Unlike most of the game's rendering — which draws pixel art onto the small
 * fixed-height virtual canvas that is then nearest-neighbor upscaled to the
 * device canvas — this module is drawn after that upscale, directly in
 * device pixel space (the same convention used by drawOffensiveDustOutlineOverlay
 * and renderDeviceOverlay in gameRenderHelpers.ts / gameRenderDeviceOverlay.ts).
 * That keeps the icon artwork and labels crisp/HD at full display resolution
 * instead of inheriting the game's blocky native pixel-art look.
 */

import type { DustSelectionWheelController } from '../../screens/gameDustSelectionState';
import { ParticleShape, getKindShape } from '../../sim/particles/kinds';
import { getDustDefinition } from '../../sim/weaves/dustDefinition';
import { loadImg, isSpriteReady } from '../imageCache';

/** Distance (world units) from the player's visual center to each option icon at full expansion. */
const DUST_WHEEL_RADIUS_WORLD = 24;
/** Icon radius (virtual pixels, pre device-scale) for each wheel option at full expansion. */
const DUST_WHEEL_ICON_RADIUS_PX = 3.4;
/**
 * Icon sprites (SPRITES/DUST/DustTypes/*.png) are 30×33 native pixel-art —
 * far smaller than the on-screen size they're drawn at here. Drawing them
 * at device resolution with imageSmoothingEnabled (rather than on the small
 * virtual canvas) means the upscale reads as a crisp/HD icon instead of
 * blocky native-resolution pixels.
 */
const DUST_WHEEL_SPRITE_SCALE = 2.4;
/** Extra radius multiplier applied to the highlighted option's icon. */
const DUST_WHEEL_HIGHLIGHT_SCALE = 1.35;
/** Ring radius (virtual pixels, pre device-scale) drawn around the currently-active option. */
const DUST_WHEEL_ACTIVE_RING_EXTRA_PX = 1.6;
/** Base label font size in virtual pixels, pre device-scale (scaled up like everything else here). */
const DUST_WHEEL_LABEL_FONT_PX = 6;
/** Gap (virtual pixels, pre device-scale) between the bottom of an icon and the top of its label. */
const DUST_WHEEL_LABEL_GAP_PX = 3;

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
 * Renders the dust selection wheel centered on the player, directly onto the
 * device canvas. No-op when the wheel is fully closed.
 *
 * `offsetXPx`/`offsetYPx`/`scalePx` are the existing virtual-canvas camera
 * transform (world → virtual pixels); `deviceScaleX`/`deviceScaleY` convert
 * virtual pixels to device pixels (`canvas.width / virtualWidthPx` and
 * `canvas.height / virtualHeightPx`), matching the ratio already used for
 * other device-space overlays in gameRender.ts.
 */
export function renderDustSelectionWheel(
  deviceCtx: CanvasRenderingContext2D,
  dustWheel: DustSelectionWheelController,
  playerXWorld: number,
  playerYWorld: number,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  deviceScaleX: number,
  deviceScaleY: number,
): void {
  const nowMs = performance.now();
  const expansion = dustWheel.getExpansion01(nowMs);
  if (expansion <= 0) return;

  const options = dustWheel.getOptions();
  if (options.length === 0) return;

  const activeKind = dustWheel.getActiveKindAtOpen();
  const highlightedKind = dustWheel.getHighlightedKind();

  const playerScreenXPx = (playerXWorld * scalePx + offsetXPx) * deviceScaleX;
  const playerScreenYPx = (playerYWorld * scalePx + offsetYPx) * deviceScaleY;

  // Outward expansion uses a slight overshoot ease for a lively "pop" feel;
  // fade alpha stays linear with expansion so closing reads as a clean fade.
  const outwardT = easeOutBack(expansion);
  const radiusXPx = DUST_WHEEL_RADIUS_WORLD * scalePx * outwardT * deviceScaleX;
  const radiusYPx = DUST_WHEEL_RADIUS_WORLD * scalePx * outwardT * deviceScaleY;
  const alpha = Math.max(0, Math.min(1, expansion));

  // Uniform (non-directional) sizes — icon/font/ring — use the x scale, which
  // matches deviceScaleY in practice since the virtual canvas preserves the
  // device canvas's aspect ratio.
  const uniformDeviceScale = deviceScaleX;

  const prevAlpha = deviceCtx.globalAlpha;
  const prevSmoothing = deviceCtx.imageSmoothingEnabled;
  deviceCtx.imageSmoothingEnabled = true;

  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const iconCxPx = playerScreenXPx + Math.cos(option.angleRad) * radiusXPx;
    const iconCyPx = playerScreenYPx + Math.sin(option.angleRad) * radiusYPx;
    const isHighlighted = option.kind === highlightedKind;
    const isActive = option.kind === activeKind;
    const def = getDustDefinition(option.kind);
    const shape = getKindShape(option.kind);

    const iconRadiusPx = DUST_WHEEL_ICON_RADIUS_PX * scalePx * uniformDeviceScale * (isHighlighted ? DUST_WHEEL_HIGHLIGHT_SCALE : 1);

    // Active-dust ring — a thin outline just outside the icon.
    if (isActive) {
      deviceCtx.globalAlpha = alpha * 0.9;
      deviceCtx.strokeStyle = '#ffffff';
      deviceCtx.lineWidth = uniformDeviceScale;
      deviceCtx.beginPath();
      deviceCtx.arc(iconCxPx, iconCyPx, iconRadiusPx + DUST_WHEEL_ACTIVE_RING_EXTRA_PX * uniformDeviceScale, 0, Math.PI * 2);
      deviceCtx.stroke();
    }

    // Highlight glow behind the nearest-to-aim option.
    if (isHighlighted) {
      deviceCtx.globalAlpha = alpha * 0.35;
      deviceCtx.fillStyle = def.colorHex;
      deviceCtx.beginPath();
      deviceCtx.arc(iconCxPx, iconCyPx, iconRadiusPx * 1.9, 0, Math.PI * 2);
      deviceCtx.fill();
    }

    // Icon body — sprite artwork when available (drawn smoothed/upscaled at
    // full device resolution for an HD look), falling back to the canonical
    // color + shape otherwise.
    deviceCtx.globalAlpha = alpha;
    const spriteImg = def.spriteUrl !== undefined && def.spriteUrl.length > 0 ? loadImg(def.spriteUrl) : undefined;
    let iconBottomPx = iconCyPx + iconRadiusPx;
    if (spriteImg !== undefined && isSpriteReady(spriteImg)) {
      const drawWidthPx = iconRadiusPx * 2 * DUST_WHEEL_SPRITE_SCALE;
      const drawHeightPx = drawWidthPx * (spriteImg.naturalHeight / spriteImg.naturalWidth);
      deviceCtx.drawImage(spriteImg, iconCxPx - drawWidthPx / 2, iconCyPx - drawHeightPx / 2, drawWidthPx, drawHeightPx);
      iconBottomPx = iconCyPx + drawHeightPx / 2;
    } else {
      deviceCtx.fillStyle = def.colorHex;
      drawKindShape(deviceCtx, shape, iconCxPx, iconCyPx, iconRadiusPx);
      deviceCtx.fill();
      deviceCtx.strokeStyle = 'rgba(0,0,0,0.55)';
      deviceCtx.lineWidth = 0.6 * uniformDeviceScale;
      drawKindShape(deviceCtx, shape, iconCxPx, iconCyPx, iconRadiusPx);
      deviceCtx.stroke();
    }

    // Name label — short single-word title, centered directly below the icon.
    deviceCtx.globalAlpha = alpha * (isHighlighted ? 1 : 0.75);
    const fontPx = DUST_WHEEL_LABEL_FONT_PX * uniformDeviceScale * (isHighlighted ? DUST_WHEEL_HIGHLIGHT_SCALE : 1);
    deviceCtx.font = `${fontPx}px monospace`;
    deviceCtx.textAlign = 'center';
    deviceCtx.textBaseline = 'top';
    const labelXPx = iconCxPx;
    const labelYPx = iconBottomPx + DUST_WHEEL_LABEL_GAP_PX * uniformDeviceScale;
    const labelWidthPx = deviceCtx.measureText(def.shortName).width;
    const paddingPx = 2 * uniformDeviceScale;
    deviceCtx.fillStyle = 'rgba(0,0,0,0.55)';
    deviceCtx.fillRect(labelXPx - labelWidthPx / 2 - paddingPx, labelYPx - paddingPx, labelWidthPx + paddingPx * 2, fontPx + paddingPx * 2);
    deviceCtx.fillStyle = '#ffffff';
    deviceCtx.fillText(def.shortName, labelXPx, labelYPx);
  }

  deviceCtx.globalAlpha = prevAlpha;
  deviceCtx.imageSmoothingEnabled = prevSmoothing;
}
