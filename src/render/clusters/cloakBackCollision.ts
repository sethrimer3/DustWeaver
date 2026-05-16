/**
 * cloakBackCollision.ts — Back-collision constraint system for the player cloak.
 *
 * Keeps cloak chain points from passing through the player's back surface.
 * Three exported utilities compute the back boundary geometry; the main export
 * `applyBackCollision` runs a three-pass solver (clamp → drape → min-spacing)
 * directly on the chain's typed arrays with no per-frame allocation.
 *
 * Extracted from playerCloak.ts so the PlayerCloak class stays focused on
 * chain integration and rendering orchestration.
 */

import {
  PLAYER_BACK_X,
  PLAYER_BACK_TOP,
  PLAYER_BACK_BOTTOM,
  BACK_COLLISION_STRENGTH,
  BACK_COLLISION_DAMPING,
  BACK_COMPRESSION_AMOUNT,
  BACK_SLIDE_STRENGTH,
  BACK_DRAPE_SPACING,
  BACK_DRAPE_MIN_SPACING,
  BACK_DRAPE_DAMPING,
  BACK_SURFACE_GRAVITY_BIAS,
  BACK_BUNCHING_FIX_BLEND,
  getCloakTuningValue,
} from './cloakConstants';
import type { CloakPlayerState } from './playerCloak';

// ── Player sprite metrics (mirrored from playerCloak.ts to avoid circular dep) ──
const PLAYER_SPRITE_WIDTH_WORLD = 16;
const PLAYER_SPRITE_HEIGHT_WORLD = 24;
const PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD = -1;

/**
 * Compute the world-space X of the player's back boundary line,
 * correctly mirrored for facing direction.
 */
export function computeBackBoundaryWorldX(player: CloakPlayerState): number {
  const spriteLeftWorldX = player.positionXWorld - PLAYER_SPRITE_WIDTH_WORLD * 0.5;
  if (player.isFacingLeftFlag === 1) {
    // Facing left: "back" is on the right side of the sprite.
    return spriteLeftWorldX + (PLAYER_SPRITE_WIDTH_WORLD - PLAYER_BACK_X);
  }
  // Facing right: "back" is on the left side of the sprite.
  return spriteLeftWorldX + PLAYER_BACK_X;
}

/** World-space Y of the top of the back boundary. */
export function computeBackBoundaryTopWorldY(player: CloakPlayerState): number {
  const spriteTopWorldY = player.positionYWorld + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD
    - PLAYER_SPRITE_HEIGHT_WORLD * 0.5;
  return spriteTopWorldY + PLAYER_BACK_TOP;
}

/** World-space Y of the bottom of the back boundary. */
export function computeBackBoundaryBottomWorldY(player: CloakPlayerState): number {
  const spriteTopWorldY = player.positionYWorld + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD
    - PLAYER_SPRITE_HEIGHT_WORLD * 0.5;
  return spriteTopWorldY + PLAYER_BACK_BOTTOM;
}

/**
 * Apply soft back collision to all trailing cloak points (skip root).
 * If a point crosses the back boundary into the body, push it back
 * toward the boundary with damping. After clamping, applies a drape/slide
 * pass that redistributes constrained points downward along the back
 * surface, preventing bunching near the shoulder.
 *
 * Operates directly on the pre-allocated typed arrays — no allocations.
 */
export function applyBackCollision(
  posXWorld: Float32Array,
  posYWorld: Float32Array,
  velXWorld: Float32Array,
  velYWorld: Float32Array,
  pointCount: number,
  player: CloakPlayerState,
  dtSec: number,
): void {
  const backX = computeBackBoundaryWorldX(player);
  const backTopY = computeBackBoundaryTopWorldY(player);
  const backBottomY = computeBackBoundaryBottomWorldY(player);

  const strength = getCloakTuningValue(BACK_COLLISION_STRENGTH, 'backCollisionStrength');
  const damping = getCloakTuningValue(BACK_COLLISION_DAMPING, 'backCollisionDamping');
  const compression = getCloakTuningValue(BACK_COMPRESSION_AMOUNT, 'backCompressionAmount');

  // Drape parameters.
  const slideStrength = getCloakTuningValue(BACK_SLIDE_STRENGTH, 'backSlideStrength');
  const drapeSpacing = getCloakTuningValue(BACK_DRAPE_SPACING, 'backDrapeSpacing');
  const drapeMinSpacing = getCloakTuningValue(BACK_DRAPE_MIN_SPACING, 'backDrapeMinSpacing');
  const drapeDamping = getCloakTuningValue(BACK_DRAPE_DAMPING, 'backDrapeDamping');
  const surfaceGravityBias = getCloakTuningValue(BACK_SURFACE_GRAVITY_BIAS, 'backSurfaceGravityBias');
  const bunchingFixBlend = getCloakTuningValue(BACK_BUNCHING_FIX_BLEND, 'backBunchingFixBlend');

  // Determine if player is moving backward relative to facing.
  const isMovingBackwardFlag = player.isFacingLeftFlag === 1
    ? player.velocityXWorld > 0
    : player.velocityXWorld < 0;

  const isFacingRight = player.isFacingLeftFlag === 0;

  // ── Pass 1: Standard back-collision clamping ─────────────────────
  for (let i = 1; i < pointCount; i++) {
    const py = posYWorld[i];

    // Only apply constraint within the vertical extent of the back.
    if (py < backTopY || py > backBottomY) continue;

    const px = posXWorld[i];

    // Check if point has crossed the back boundary into the body.
    const penetration = isFacingRight ? (px - backX) : (backX - px);

    if (penetration > 0) {
      // Soft push: move point back toward boundary proportional to strength.
      const pushBack = penetration * strength;

      if (isFacingRight) {
        posXWorld[i] -= pushBack;
        velXWorld[i] *= (1 - damping);
      } else {
        posXWorld[i] += pushBack;
        velXWorld[i] *= (1 - damping);
      }

      // Apply extra downward gravity bias so constrained points slide down
      // instead of stacking near the shoulder.
      velYWorld[i] += surfaceGravityBias * dtSec;

      // Damp horizontal velocity harder on the back surface, but preserve
      // vertical (tangential) motion — only apply gentle tangential damping.
      velYWorld[i] *= (1 - drapeDamping * dtSec);
    }

    // Extra compression when moving backward: gently push point toward boundary.
    if (isMovingBackwardFlag) {
      const distFromBack = isFacingRight ? (backX - px) : (px - backX);
      if (distFromBack >= 0 && distFromBack < compression * 2) {
        const compressionPush = compression * dtSec;
        if (isFacingRight) {
          posXWorld[i] += compressionPush;
        } else {
          posXWorld[i] -= compressionPush;
        }
      }
    }
  }

  // ── Pass 2: Drape redistribution along the back surface ──────────
  // Collect indices of points currently on or touching the back boundary,
  // in chain order (ascending index = top-to-bottom along the garment).
  // Then distribute them downward with stable spacing.

  // Re-check which points are now on the back surface after clamping.
  // A point is "on the back" if its X is very close to the back boundary
  // and its Y is within the back range.
  const backToleranceWorld = 1.5; // world units — how close to backX counts as "on surface"

  // Build ordered list of constrained point indices.
  let constrainedPointCount = 0;
  // Reuse a stack-local array approach — pointCount is small (4), safe to iterate.
  // We avoid allocation by using two passes.

  // First, count constrained points and compute drape target Y positions.
  for (let i = 1; i < pointCount; i++) {
    const py = posYWorld[i];
    if (py < backTopY - 1 || py > backBottomY + 1) continue;

    const px = posXWorld[i];
    const distFromBack = isFacingRight ? (backX - px) : (px - backX);
    // Point is on the back surface if it's within tolerance.
    if (distFromBack >= -0.5 && distFromBack <= backToleranceWorld) {
      constrainedPointCount++;
    }
  }

  // Only run redistribution if at least 2 points are constrained (can bunch).
  if (constrainedPointCount >= 2) {
    // Compute ideal drape target Y for each constrained point.
    // Start from the anchor (root) Y and space downward by drapeSpacing.
    const anchorY = posYWorld[0];

    for (let i = 1; i < pointCount; i++) {
      const py = posYWorld[i];
      if (py < backTopY - 1 || py > backBottomY + 1) continue;

      const px = posXWorld[i];
      const distFromBack = isFacingRight ? (backX - px) : (px - backX);
      if (distFromBack >= -0.5 && distFromBack <= backToleranceWorld) {
        // Compute target Y: anchor + (chainIndex * drapeSpacing), clamped to back range.
        const idealY = anchorY + (i * drapeSpacing);
        const targetY = Math.min(Math.max(idealY, backTopY), backBottomY);

        // Blend current Y toward drape target.
        const currentY = posYWorld[i];
        const dy = targetY - currentY;
        posYWorld[i] += dy * slideStrength * bunchingFixBlend;
      }
    }

    // ── Pass 3: Enforce minimum spacing between consecutive constrained points.
    // Walk chain in order and ensure each constrained point is at least
    // drapeMinSpacing below its predecessor.
    let prevConstrainedY = posYWorld[0]; // root anchor

    for (let i = 1; i < pointCount; i++) {
      const py = posYWorld[i];
      if (py < backTopY - 1 || py > backBottomY + 1) continue;

      const px = posXWorld[i];
      const distFromBack = isFacingRight ? (backX - px) : (px - backX);
      if (distFromBack >= -0.5 && distFromBack <= backToleranceWorld) {
        const minY = prevConstrainedY + drapeMinSpacing;
        if (posYWorld[i] < minY) {
          // Blend toward minimum to prevent hard snapping.
          const correction = (minY - posYWorld[i]) * bunchingFixBlend;
          posYWorld[i] += correction;
        }
        prevConstrainedY = posYWorld[i];
      }
    }
  }
}
