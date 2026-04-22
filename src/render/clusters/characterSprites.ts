/**
 * Character sprite system — loading, outline mask generation, and player
 * sprite selection. Extracted from renderer.ts to keep that file focused on
 * the main render pipeline.
 */

import type { ClusterSnapshot } from '../snapshot';
import { loadImg, loadImgWithFallback } from '../imageCache';
export { isSpriteReady } from '../imageCache';

// ── Character sprite sets ───────────────────────────────────────────────────

export interface CharacterSprites {
  standing: HTMLImageElement;
  idle1: HTMLImageElement;
  idle2: HTMLImageElement;
  idleBlink: HTMLImageElement;
  sprinting: HTMLImageElement;
  crouching: HTMLImageElement;
  grappling: HTMLImageElement;
  jumping: HTMLImageElement;
  falling: HTMLImageElement;
  fastFalling: HTMLImageElement;
  swinging: HTMLImageElement;
}

/** 1 virtual pixel outline thickness around player sprites. */
export const PLAYER_OUTLINE_THICKNESS_WORLD = 1;
/** Precomputed outer-edge outline masks keyed by source player sprite image. */
const _playerOutlineMaskCache = new WeakMap<HTMLImageElement, HTMLCanvasElement>();
/** 8-neighbour offsets used to detect silhouette edges (includes diagonals). */
const _outlineNeighborOffsets: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

/**
 * Builds a black outline mask for the sprite's outer silhouette only.
 * Internal transparent holes are excluded by flood-filling only the
 * transparency region connected to the texture border.
 */
export function getOrCreateOuterOutlineMask(sprite: HTMLImageElement): HTMLCanvasElement {
  const cached = _playerOutlineMaskCache.get(sprite);
  if (cached !== undefined) return cached;

  const spriteWidthPx = sprite.naturalWidth;
  const spriteHeightPx = sprite.naturalHeight;
  const paddedWidthPx = spriteWidthPx + 2;
  const paddedHeightPx = spriteHeightPx + 2;
  const pixelCount = paddedWidthPx * paddedHeightPx;

  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = paddedWidthPx;
  alphaCanvas.height = paddedHeightPx;
  const alphaCtx = alphaCanvas.getContext('2d');
  if (alphaCtx === null) {
    _playerOutlineMaskCache.set(sprite, alphaCanvas);
    return alphaCanvas;
  }
  alphaCtx.clearRect(0, 0, paddedWidthPx, paddedHeightPx);
  alphaCtx.drawImage(sprite, 1, 1);
  const alphaData = alphaCtx.getImageData(0, 0, paddedWidthPx, paddedHeightPx).data;

  const isOpaqueFlag = new Uint8Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    isOpaqueFlag[pixelIndex] = alphaData[pixelIndex * 4 + 3] > 0 ? 1 : 0;
  }

  const isOutsideFlag = new Uint8Array(pixelCount);
  const queueX = new Int16Array(pixelCount);
  const queueY = new Int16Array(pixelCount);
  let queueReadIndex = 0;
  let queueWriteIndex = 0;

  const enqueueIfOutside = (xPx: number, yPx: number): void => {
    const idx = yPx * paddedWidthPx + xPx;
    if (isOpaqueFlag[idx] === 1 || isOutsideFlag[idx] === 1) return;
    isOutsideFlag[idx] = 1;
    queueX[queueWriteIndex] = xPx;
    queueY[queueWriteIndex] = yPx;
    queueWriteIndex++;
  };

  for (let xPx = 0; xPx < paddedWidthPx; xPx++) {
    enqueueIfOutside(xPx, 0);
    enqueueIfOutside(xPx, paddedHeightPx - 1);
  }
  for (let yPx = 1; yPx < paddedHeightPx - 1; yPx++) {
    enqueueIfOutside(0, yPx);
    enqueueIfOutside(paddedWidthPx - 1, yPx);
  }

  while (queueReadIndex < queueWriteIndex) {
    const xPx = queueX[queueReadIndex];
    const yPx = queueY[queueReadIndex];
    queueReadIndex++;

    if (xPx > 0) enqueueIfOutside(xPx - 1, yPx);
    if (xPx < paddedWidthPx - 1) enqueueIfOutside(xPx + 1, yPx);
    if (yPx > 0) enqueueIfOutside(xPx, yPx - 1);
    if (yPx < paddedHeightPx - 1) enqueueIfOutside(xPx, yPx + 1);
  }

  const outlineCanvas = document.createElement('canvas');
  outlineCanvas.width = paddedWidthPx;
  outlineCanvas.height = paddedHeightPx;
  const outlineCtx = outlineCanvas.getContext('2d');
  if (outlineCtx === null) {
    _playerOutlineMaskCache.set(sprite, outlineCanvas);
    return outlineCanvas;
  }

  const outlineImage = outlineCtx.createImageData(paddedWidthPx, paddedHeightPx);
  const outlinePixels = outlineImage.data;
  for (let yPx = 0; yPx < paddedHeightPx; yPx++) {
    for (let xPx = 0; xPx < paddedWidthPx; xPx++) {
      const idx = yPx * paddedWidthPx + xPx;
      if (isOutsideFlag[idx] === 0) continue;

      let hasOpaqueNeighbor = false;
      for (let n = 0; n < _outlineNeighborOffsets.length; n++) {
        const nx = xPx + _outlineNeighborOffsets[n][0];
        const ny = yPx + _outlineNeighborOffsets[n][1];
        if (nx < 0 || nx >= paddedWidthPx || ny < 0 || ny >= paddedHeightPx) continue;
        if (isOpaqueFlag[ny * paddedWidthPx + nx] === 1) {
          hasOpaqueNeighbor = true;
          break;
        }
      }
      if (!hasOpaqueNeighbor) continue;

      const dataIndex = idx * 4;
      outlinePixels[dataIndex] = 0;
      outlinePixels[dataIndex + 1] = 0;
      outlinePixels[dataIndex + 2] = 0;
      outlinePixels[dataIndex + 3] = 255;
    }
  }
  outlineCtx.putImageData(outlineImage, 0, 0);
  _playerOutlineMaskCache.set(sprite, outlineCanvas);
  return outlineCanvas;
}

function _loadCharacterSprites(characterId: string): CharacterSprites {
  const base = `SPRITES/PLAYERS/${characterId}/${characterId}`;
  const standingSrc = `${base}_standing.png`;
  return {
    standing:   loadImg(standingSrc),
    idle1:      loadImgWithFallback([`${base}_idle1.png`, standingSrc]),
    idle2:      loadImgWithFallback([`${base}_idle2.png`, standingSrc]),
    idleBlink:  loadImgWithFallback([`${base}_idleBlink.png`, standingSrc]),
    sprinting:  loadImgWithFallback([`${base}_sprinting.png`, standingSrc]),
    crouching:  loadImgWithFallback([`${base}_crouching.png`, standingSrc]),
    grappling:  loadImgWithFallback([`${base}_grappling.png`, standingSrc]),
    jumping:    loadImgWithFallback([`${base}_jumping.png`, standingSrc]),
    falling:    loadImgWithFallback([`${base}_falling.png`, standingSrc]),
    fastFalling: loadImgWithFallback([`${base}_fastfalling.png`, standingSrc]),
    swinging:   loadImgWithFallback([`${base}_swinging.png`, standingSrc]),
  };
}

/** Pre-loaded sprite sets for all playable characters. */
const _characterSprites: Record<string, CharacterSprites> = {
  knight:   _loadCharacterSprites('knight'),
  demonFox: _loadCharacterSprites('demonFox'),
  princess: _loadCharacterSprites('princess'),
  outcast:  _loadCharacterSprites('outcast'),
};

/** Returns the sprite set for the given character, falling back to knight. */
export function getCharacterSprites(characterId: string): CharacterSprites {
  return _characterSprites[characterId] ?? _characterSprites['knight'];
}

// ── Player sprite rendering constants ────────────────────────────────────────

/** Player sprite render width in world units (virtual px at zoom 1). */
export const PLAYER_SPRITE_WIDTH_WORLD = 16;
/** Player sprite render height in world units (virtual px at zoom 1). */
export const PLAYER_SPRITE_HEIGHT_WORLD = 24;
/**
 * X pixel (from sprite's left edge, in world units) used as the flip pivot when
 * mirroring the sprite for the facing-left direction.  Corresponds to the
 * horizontal centre of the gameplay hitbox (x 6–13 → centre at 9.5).
 */
export const PLAYER_SPRITE_PIVOT_X_WORLD = 9.5;
/**
 * Vertical offset from hitbox centre to the sprite's draw pivot so that the
 * sprite's pixel-14 (vertical centre of the y 4–24 hitbox) aligns with the
 * cluster's world position.  Equals -(spriteHalfH - 12) = -(12 - 12) + adjustment.
 * Formula: PLAYER_SPRITE_HALF_HEIGHT(12) - hitboxCentreInSprite(14) = -2.
 */
export const PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD = -2;
/**
 * Minimum speed (world units/sec) the player must be moving while on the
 * grapple to use the swinging sprite instead of the standing sprite.
 */
export const PLAYER_SWING_SPEED_THRESHOLD_WORLD = 60;
/**
 * Downward velocity threshold (world units/sec) above which the fast-falling
 * sprite is shown.  Matches the cloak renderer's fast-fall threshold.
 */
export const PLAYER_FAST_FALL_SPRITE_THRESHOLD_WORLD = 180;
/** Minimum speed (world units/sec) before subtle player afterimages appear. */
export const PLAYER_AFTERIMAGE_MIN_SPEED_WORLD_PER_SEC = 185;
/** Number of faint trailing afterimages to draw at high speed. */
export const PLAYER_AFTERIMAGE_COUNT = 2;
/**
 * Duration in ticks of the hurt visual feedback window.
 * Must match HURT_VISUAL_DURATION_TICKS in sim/playerDamage.ts.
 */
export const HURT_FLASH_DURATION_TICKS = 20;
/** Maximum alpha of the red damage tint overlay (at the start of the hurt window). */
export const HURT_FLASH_MAX_ALPHA = 0.45;

/**
 * Returns the appropriate sprite for the current player state.
 * Priority (highest first):
 *  1. Swinging on grapple with decent velocity → swinging sprite
 *  2. Crouching (grounded + down held) → crouching sprite
 *  3. Airborne & moving upward            → jumping sprite
 *  4. Airborne & fast-falling             → fastFalling sprite
 *  5. Airborne & moving downward          → falling sprite
 *  6. Sprinting                           → sprinting sprite
 *  7. Idle animation states               → idle1 / idle2 / idleBlink
 *  8. Default                             → standing sprite
 *
 * When grappling with low/zero velocity, the standing sprite is shown.
 */
export function getPlayerSprite(
  sprites: CharacterSprites,
  cluster: ClusterSnapshot,
  isGrappling: boolean,
): HTMLImageElement {
  // ── Grapple states ─────────────────────────────────────────────────────
  if (isGrappling) {
    const swingSpeed = Math.sqrt(
      cluster.velocityXWorld * cluster.velocityXWorld +
      cluster.velocityYWorld * cluster.velocityYWorld,
    );
    if (swingSpeed > PLAYER_SWING_SPEED_THRESHOLD_WORLD) {
      return sprites.swinging;
    }
    // Low velocity while grappling → show standing sprite
    return sprites.standing;
  }

  // ── Crouch ────────────────────────────────────────────────────────────
  if (cluster.isCrouchingFlag === 1) return sprites.crouching;

  // ── Airborne states ───────────────────────────────────────────────────
  if (cluster.isGroundedFlag === 0) {
    if (cluster.velocityYWorld < 0) return sprites.jumping;
    if (cluster.velocityYWorld > PLAYER_FAST_FALL_SPRITE_THRESHOLD_WORLD) return sprites.fastFalling;
    return sprites.falling;
  }

  // ── Grounded states ───────────────────────────────────────────────────
  if (cluster.isSprintingFlag === 1) return sprites.sprinting;

  // Idle animation states: 0=standing, 1=idle1, 2=idle2, 3=idleBlink
  switch (cluster.playerIdleAnimState) {
    case 1: return sprites.idle1;
    case 2: return sprites.idle2;
    case 3: return sprites.idleBlink;
    default: return sprites.standing;
  }
}
