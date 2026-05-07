/**
 * previewBubbleRenderer.ts — Draws the preview glow bubbles near transitions.
 *
 * Each bubble is a radial gradient circle centred on the transition opening.
 * The gradient simulates light shining through the passage into the current
 * room — bright at the centre, fading to transparent at the edge.
 *
 * This is the first-pass visual:  a glowing cue that a passage exists.
 * Full connected-room tile preview (rendering actual tiles from the next room
 * inside the circle) is deferred; see nextSteps.md.
 *
 * The bubbles are drawn inside the room clip region, on top of the dark
 * tunnel gradients but below HUD elements.  They integrate with the existing
 * lighting system by layering on top of the darkness overlay in DarkRoom mode
 * (drawn as additive-ish glow rather than punching a hole in the mask).
 */

import type { PreviewBubbleState } from './previewBubbleState';
import { PREVIEW_INNER_STOP } from './transitionConfig';

// ── Glow colour ───────────────────────────────────────────────────────────────

/** Inner glow colour components (light cyan/blue — suggests a doorway of light). */
const GLOW_R = 120;
const GLOW_G = 210;
const GLOW_B = 255;

// ── Public render function ────────────────────────────────────────────────────

/**
 * Render preview glow bubbles for all active transitions.
 *
 * Must be called INSIDE the room clip region (after `ctx.save()` + clip) so
 * the glow appears within the room geometry.  Call after dark-tunnel-darkness
 * is drawn but before the HUD layers.
 *
 * @param ctx      Virtual canvas 2D context.
 * @param bubbles  Array of PreviewBubbleState entries.
 * @param count    Number of valid entries in `bubbles`.
 */
export function renderPreviewBubbles(
  ctx: CanvasRenderingContext2D,
  bubbles: PreviewBubbleState[],
  count: number,
): void {
  if (count === 0) return;

  ctx.save();

  for (let i = 0; i < count; i++) {
    const b = bubbles[i];
    if (b.opacity <= 0 || b.radiusPx <= 0) continue;

    // Radial gradient: bright core → transparent edge
    const grad = ctx.createRadialGradient(
      b.centerXPx, b.centerYPx, b.radiusPx * PREVIEW_INNER_STOP,
      b.centerXPx, b.centerYPx, b.radiusPx,
    );
    const innerAlpha = b.opacity;
    const outerAlpha = 0;
    grad.addColorStop(0, `rgba(${GLOW_R},${GLOW_G},${GLOW_B},${innerAlpha.toFixed(3)})`);
    grad.addColorStop(1, `rgba(${GLOW_R},${GLOW_G},${GLOW_B},${outerAlpha})`);

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(b.centerXPx, b.centerYPx, b.radiusPx, 0, Math.PI * 2);
    ctx.fill();
  }

  // Restore composite operation and any other saved state
  ctx.restore();
}
