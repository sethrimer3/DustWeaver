import type { VoidSphereScreenCircle } from '../clusters/heraldRenderer';
import { VOID_SPHERE_DISTORTION_STRENGTH_PX } from '../../sim/clusters/heraldConfig';

/**
 * Screen-space "gravitational lensing" distortion around each active Void
 * Sphere. This is a first-pass, non-physical approximation implemented with
 * plain Canvas2D pixel operations (no WebGL/shader pipeline in this project):
 *
 *   1. Grab a small bounding box of already-rendered pixels around the sphere.
 *   2. For each coarse output block, walk backwards from the *sphere edge*
 *      (radius = distortionRadiusPx * SPHERE_EDGE_RATIO) — pulling the sample
 *      point outward/rotated by an amount that peaks at the edge and fades
 *      toward both the core and the outer halo. That "pull" bends nearby
 *      scenery around the sphere the way light bends near a black hole.
 *   3. Write the sampled colour back as a small flat block (cheap stand-in
 *      for bilinear filtering) to keep the per-frame cost bounded.
 *
 * Deliberately NOT per-pixel: sampling is done in SAMPLE_STEP_PX blocks and
 * bounded to a small rectangle per sphere, so cost scales with
 * (MAX_VOID_SPHERES × box area / step²) rather than full-screen resolution.
 */

/** Output block size in px — coarser than 1px keeps this affordable on CPU canvas ops. */
const SAMPLE_STEP_PX = 2;
/** Where along the box radius the sphere's visual edge sits (peak distortion point). */
const SPHERE_EDGE_RATIO = 0.42;
/** Width of the falloff bell around the edge ratio, in units of box radius. */
const FALLOFF_WIDTH = 0.4;
/** Extra radians of swirl applied at peak pull strength. */
const SWIRL_RADIANS = 0.55;

export function applyVoidLensDistortion(
  ctx: CanvasRenderingContext2D,
  circles: readonly VoidSphereScreenCircle[],
  canvasWidthPx: number,
  canvasHeightPx: number,
): void {
  for (const circle of circles) {
    const R = circle.distortionRadiusPx;
    if (R <= 1) continue;

    const boxX = Math.max(0, Math.floor(circle.xPx - R));
    const boxY = Math.max(0, Math.floor(circle.yPx - R));
    const boxRight = Math.min(canvasWidthPx, Math.ceil(circle.xPx + R));
    const boxBottom = Math.min(canvasHeightPx, Math.ceil(circle.yPx + R));
    const boxW = boxRight - boxX;
    const boxH = boxBottom - boxY;
    if (boxW <= 0 || boxH <= 0) continue;

    let src: ImageData;
    try {
      src = ctx.getImageData(boxX, boxY, boxW, boxH);
    } catch {
      continue; // Defensive: never let a canvas security/state error crash the frame.
    }
    const dst = ctx.createImageData(boxW, boxH);
    const srcData = src.data;
    const dstData = dst.data;
    const edgeRadiusPx = R * SPHERE_EDGE_RATIO;

    for (let by = 0; by < boxH; by += SAMPLE_STEP_PX) {
      for (let bx = 0; bx < boxW; bx += SAMPLE_STEP_PX) {
        const px = boxX + bx + SAMPLE_STEP_PX * 0.5;
        const py = boxY + by + SAMPLE_STEP_PX * 0.5;
        const dx = px - circle.xPx;
        const dy = py - circle.yPx;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Bell-curve falloff peaking at the sphere's visual edge, fading
        // toward both the core (hidden behind the sphere sprite anyway) and
        // the outer rim of the distortion halo.
        const t = (dist - edgeRadiusPx) / (R * FALLOFF_WIDTH);
        const pull = Math.exp(-(t * t));

        const angle = Math.atan2(dy, dx) + pull * SWIRL_RADIANS;
        const sampleDist = dist + pull * VOID_SPHERE_DISTORTION_STRENGTH_PX;
        const sampleXWorld = circle.xPx + Math.cos(angle) * sampleDist;
        const sampleYWorld = circle.yPx + Math.sin(angle) * sampleDist;

        let sampleLocalX = Math.round(sampleXWorld - boxX);
        let sampleLocalY = Math.round(sampleYWorld - boxY);
        sampleLocalX = Math.max(0, Math.min(boxW - 1, sampleLocalX));
        sampleLocalY = Math.max(0, Math.min(boxH - 1, sampleLocalY));

        const srcIdx = (sampleLocalY * boxW + sampleLocalX) * 4;
        const r = srcData[srcIdx];
        const g = srcData[srcIdx + 1];
        const b = srcData[srcIdx + 2];
        const a = srcData[srcIdx + 3];

        const blockW = Math.min(SAMPLE_STEP_PX, boxW - bx);
        const blockH = Math.min(SAMPLE_STEP_PX, boxH - by);
        for (let oy = 0; oy < blockH; oy++) {
          let dstIdx = ((by + oy) * boxW + bx) * 4;
          for (let ox = 0; ox < blockW; ox++) {
            dstData[dstIdx] = r;
            dstData[dstIdx + 1] = g;
            dstData[dstIdx + 2] = b;
            dstData[dstIdx + 3] = a;
            dstIdx += 4;
          }
        }
      }
    }

    ctx.putImageData(dst, boxX, boxY);
  }
}
