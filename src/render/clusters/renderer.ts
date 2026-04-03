import { WorldSnapshot, ClusterSnapshot } from '../snapshot';
import { DASH_RECHARGE_ANIM_TICKS } from '../../sim/clusters/dashConstants';
import { renderWallSprites } from '../walls/blockSpriteRenderer';
import { BLOCK_SIZE_MEDIUM } from '../../levels/roomDef';
import { ParticleKind } from '../../sim/particles/kinds';

// ── Sprite loading ──────────────────────────────────────────────────────────

/** Module-level image cache keyed by URL — populated once, reused forever. */
const _imgCache = new Map<string, HTMLImageElement>();

function _loadImg(src: string): HTMLImageElement {
  const cached = _imgCache.get(src);
  if (cached !== undefined) return cached;
  const img = new Image();
  img.src = src;
  _imgCache.set(src, img);
  return img;
}

function _isSpriteReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

function _loadImgWithFallback(srcList: readonly string[]): HTMLImageElement {
  const img = _loadImg(srcList[0]);
  if (srcList.length <= 1) return img;

  let candidateIndex = 1;
  img.addEventListener('error', () => {
    if (candidateIndex >= srcList.length) return;
    img.src = srcList[candidateIndex++];
  });
  return img;
}

// ── Character sprite sets ───────────────────────────────────────────────────

interface CharacterSprites {
  standing: HTMLImageElement;
  idle1: HTMLImageElement;
  idle2: HTMLImageElement;
  idleBlink: HTMLImageElement;
  sprinting: HTMLImageElement;
  crouching: HTMLImageElement;
  grappling: HTMLImageElement;
}

function _loadCharacterSprites(characterId: string): CharacterSprites {
  const base = `SPRITES/PLAYERS/${characterId}/${characterId}`;
  const standingSrc = `${base}_standing.png`;
  return {
    standing:  _loadImg(standingSrc),
    idle1:     _loadImgWithFallback([`${base}_idle1.png`, standingSrc]),
    idle2:     _loadImgWithFallback([`${base}_idle2.png`, standingSrc]),
    idleBlink: _loadImgWithFallback([`${base}_idleBlink.png`, standingSrc]),
    sprinting: _loadImgWithFallback([`${base}_sprinting.png`, standingSrc]),
    crouching: _loadImgWithFallback([`${base}_crouching.png`, standingSrc]),
    grappling: _loadImgWithFallback([`${base}_grappling.png`, standingSrc]),
  };
}

/** Pre-loaded sprite sets for both characters. */
const _characterSprites: Record<string, CharacterSprites> = {
  knight:   _loadCharacterSprites('knight'),
  demonFox: _loadCharacterSprites('demonFox'),
  princess: _loadCharacterSprites('princess'),
};

/**
 * Returns the appropriate sprite for the current player state.
 */
function _getPlayerSprite(sprites: CharacterSprites, cluster: ClusterSnapshot, isGrappling: boolean): HTMLImageElement {
  if (isGrappling) return sprites.grappling;
  if (cluster.isCrouchingFlag === 1) return sprites.crouching;
  if (cluster.isSprintingFlag === 1) return sprites.sprinting;
  // Idle animation states: 0=standing, 1=idle1, 2=idle2, 3=idleBlink
  switch (cluster.playerIdleAnimState) {
    case 1: return sprites.idle1;
    case 2: return sprites.idle2;
    case 3: return sprites.idleBlink;
    default: return sprites.standing;
  }
}

/** Rolling enemy sprites indexed by spriteIndex (1–6). Index 0 is unused. */
const _enemySprites: HTMLImageElement[] = [
  _loadImg('SPRITES/player/player.png'), // placeholder at index 0 (unused)
  _loadImg('SPRITES/enemies/universal/enemy (1).png'),
  _loadImg('SPRITES/enemies/universal/enemy (2).png'),
  _loadImg('SPRITES/enemies/universal/enemy (3).png'),
  _loadImg('SPRITES/enemies/universal/enemy (4).png'),
  _loadImg('SPRITES/enemies/universal/enemy (5).png'),
  _loadImg('SPRITES/enemies/universal/enemy (6).png'),
];

// ── Rock Elemental sprites ────────────────────────────────────────────────

const _reHeadDeactivated = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_head_deactivated.png');
const _reArm1Deactivated = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_1_deactivated.png');
const _reArm2Deactivated = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_2_deactivated.png');
const _reHeadActivated   = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_head_activated.png');
const _reArm1Activated   = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_1_activated.png');
const _reArm2Activated   = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_2_activated.png');

// ── Flying Eye rendering constants ─────────────────────────────────────────

/** Sizes of each concentric diamond (as a fraction of the outermost half-diagonal). */
const FLYING_EYE_RING_SCALES = [1.0, 0.72, 0.50, 0.31];
/** Offset of each diamond's centre in the facing direction (fraction of outerR). */
const FLYING_EYE_RING_OFFSETS = [0.0, 0.07, 0.14, 0.19];
/** Stroke widths (screen pixels) for each ring, outer to inner. */
const FLYING_EYE_RING_WIDTHS = [3.5, 2.5, 2.0, 1.5];
/** Player sprite render width in world units (virtual px at zoom 1). */
const PLAYER_SPRITE_WIDTH_WORLD = 16;
/** Player sprite render height in world units (virtual px at zoom 1). */
const PLAYER_SPRITE_HEIGHT_WORLD = 24;

const _grappleDustSprite = _loadImg('SPRITES/DUST/grapplingHook/grapplingHookDust.png');
const _grappleDustEndSprite = _loadImg('SPRITES/DUST/grapplingHook/grapplingHookDust_end.png');
const GRAPPLE_DUST_SEGMENT_PX = 4;
const GRAPPLE_DUST_SIZE_PX = 4;
const GRAPPLE_DUST_END_SIZE_PX = 4;

/** Returns the primary display colour for a flying eye by element kind. */
function getFlyingEyeColor(elementKind: number): string {
  switch (elementKind as ParticleKind) {
    case ParticleKind.Fire:  return '#ff5522';
    case ParticleKind.Ice:   return '#44ccff';
    case ParticleKind.Wind:  return '#88ffaa';
    default:                 return '#ccccff';
  }
}

/**
 * Draws four concentric diamond outlines centred at (screenX, screenY).
 * The inner diamonds are offset in the facing direction so the eye appears
 * to "look" in that direction.
 */
function renderFlyingEye(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  outerHalfDiagonalPx: number,
  facingAngleRad: number,
  elementKind: number,
  healthRatio: number,
): void {
  const color = getFlyingEyeColor(elementKind);
  const facingDirX = Math.cos(facingAngleRad);
  const facingDirY = Math.sin(facingAngleRad);

  ctx.strokeStyle = color;
  ctx.fillStyle = 'transparent';
  ctx.globalAlpha = 0.85 + healthRatio * 0.15;

  for (let d = 0; d < FLYING_EYE_RING_SCALES.length; d++) {
    const r   = outerHalfDiagonalPx * FLYING_EYE_RING_SCALES[d];
    const off = outerHalfDiagonalPx * FLYING_EYE_RING_OFFSETS[d];
    const cx  = screenX + facingDirX * off;
    const cy  = screenY + facingDirY * off;

    ctx.lineWidth = FLYING_EYE_RING_WIDTHS[d];
    ctx.beginPath();
    ctx.moveTo(cx + r, cy);       // right point
    ctx.lineTo(cx,     cy + r);   // bottom point
    ctx.lineTo(cx - r, cy);       // left point
    ctx.lineTo(cx,     cy - r);   // top point
    ctx.closePath();
    ctx.stroke();
  }

  ctx.globalAlpha = 1.0;
}

/**
 * Renders walls (level geometry) from the snapshot on the 2D canvas using
 * context-sensitive (auto-tiling) block sprites.  Falls back to solid-colour
 * rectangles per tile while sprites are still loading.
 * Walls are drawn before cluster indicators so clusters appear on top.
 *
 * When isDebugMode is true, a red outline is drawn around every wall AABB so
 * that hitbox boundaries are visible during development.
 */
export function renderWalls(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number, isDebugMode = false): void {
  renderWallSprites(ctx, snapshot, offsetXPx, offsetYPx, scalePx, BLOCK_SIZE_MEDIUM);

  if (isDebugMode) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (let wi = 0; wi < snapshot.walls.count; wi++) {
      const screenX = snapshot.walls.xWorld[wi] * scalePx + offsetXPx;
      const screenY = snapshot.walls.yWorld[wi] * scalePx + offsetYPx;
      const screenW = snapshot.walls.wWorld[wi] * scalePx;
      const screenH = snapshot.walls.hWorld[wi] * scalePx;
      ctx.strokeRect(screenX, screenY, screenW, screenH);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}

export function renderClusters(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  showHitboxes = false,
): void {
  ctx.save();

  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;

    const screenX = cluster.positionXWorld * scalePx + offsetXPx;
    const screenY = cluster.positionYWorld * scalePx + offsetYPx;

    const isPlayer = cluster.isPlayerFlag === 1;

    // ── Box dimensions ─────────────────────────────────────────────────────
    const boxHalfW = cluster.halfWidthWorld * scalePx;
    const boxHalfH = cluster.halfHeightWorld * scalePx;
    const boxLeft  = screenX - boxHalfW;
    const boxTop   = screenY - boxHalfH;
    const boxW     = boxHalfW * 2;
    const boxH     = boxHalfH * 2;

    // ── Influence ring (faint, dashed) ─────────────────────────────────────
    const influenceRadiusPx = cluster.influenceRadiusWorld * scalePx;
    ctx.beginPath();
    ctx.arc(screenX, screenY, influenceRadiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = isPlayer
      ? 'rgba(0,255,153,0.10)'
      : 'rgba(255,102,0,0.08)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Dash recharge golden ring animation ───────────────────────────────
    if (isPlayer && cluster.dashRechargeAnimTicks > 0) {
      const animProgress = 1.0 - cluster.dashRechargeAnimTicks / DASH_RECHARGE_ANIM_TICKS;
      const startDistancePx = 60;
      const endDistancePx   = boxHalfW;
      const ringRadiusPx    = startDistancePx + (endDistancePx - startDistancePx) * animProgress;
      const alpha = animProgress < 0.6
        ? animProgress / 0.6
        : 1.0 - (animProgress - 0.6) / 0.4;
      ctx.beginPath();
      ctx.arc(screenX, screenY, ringRadiusPx, 0, Math.PI * 2);
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = '#ffd23c';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // ── Dash cooldown arc (only when recharging) ──────────────────────────
    if (cluster.dashCooldownTicks > 0 && isPlayer) {
      const progress = 1.0 - cluster.dashCooldownTicks / cluster.maxDashCooldownTicks;
      ctx.beginPath();
      ctx.arc(screenX, screenY, boxHalfW + 4, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,180,30,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (cluster.isFlyingEyeFlag === 1) {
      // ── Flying Eye: draw 4 concentric diamond outlines ──────────────────
      const healthRatio = cluster.healthPoints / cluster.maxHealthPoints;
      const outerHalfDiagonalScreen = boxHalfW * 2.5;
      renderFlyingEye(
        ctx, screenX, screenY,
        outerHalfDiagonalScreen,
        cluster.flyingEyeFacingAngleRad,
        cluster.flyingEyeElementKind,
        healthRatio,
      );
    } else if (isPlayer) {
      // ── Player: character sprite (no rotation; flip when facing left) ────
      const charSprites = _characterSprites[snapshot.characterId] ?? _characterSprites['knight'];
      const isGrappling = snapshot.isGrappleActiveFlag === 1;
      const sprite = _getPlayerSprite(charSprites, cluster, isGrappling);
      const spriteHalfW = (PLAYER_SPRITE_WIDTH_WORLD * scalePx) * 0.5;
      const spriteHalfH = (PLAYER_SPRITE_HEIGHT_WORLD * scalePx) * 0.5;
      const spriteW = spriteHalfW * 2;
      const spriteH = spriteHalfH * 2;
      if (_isSpriteReady(sprite)) {
        ctx.save();
        ctx.translate(screenX, screenY);
        if (cluster.isFacingLeftFlag === 1) {
          ctx.scale(-1, 1);
        }
        ctx.drawImage(sprite, -spriteHalfW, -spriteHalfH, spriteW, spriteH);
        ctx.restore();
      } else {
        // Fallback while sprite loads: coloured box
        ctx.fillStyle = '#00ff99';
        ctx.globalAlpha = 0.75;
        ctx.fillRect(screenX - spriteHalfW, screenY - spriteHalfH, spriteW, spriteH);
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#00ff99';
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX - spriteHalfW, screenY - spriteHalfH, spriteW, spriteH);
      }
    } else if (cluster.isRollingEnemyFlag === 1) {
      // ── Rolling enemy: sprite rotated by accumulated roll angle ──────────
      const idx    = cluster.rollingEnemySpriteIndex;
      const sprite = idx >= 1 && idx <= 6 ? _enemySprites[idx] : _enemySprites[1];
      const rollAngle = cluster.rollingEnemyRollAngleRad;
      if (_isSpriteReady(sprite)) {
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(rollAngle);
        ctx.drawImage(sprite, -boxHalfW, -boxHalfH, boxW, boxH);
        ctx.restore();
      } else {
        // Fallback while sprite loads: orange box
        ctx.fillStyle = '#ff6600';
        ctx.globalAlpha = 0.75;
        ctx.fillRect(boxLeft, boxTop, boxW, boxH);
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#ff6600';
        ctx.lineWidth = 2;
        ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
      }
    } else if (cluster.isRockElementalFlag === 1) {
      // ── Rock Elemental: composite sprite (head + 2 arms) ────────────────
      const reState = cluster.rockElementalState;
      const isActiveRE = reState >= 2; // active states use activated sprites
      const activationT = cluster.rockElementalActivationProgress;
      
      const headSprite = isActiveRE ? _reHeadActivated : _reHeadDeactivated;
      const arm1Sprite = isActiveRE ? _reArm1Activated : _reArm1Deactivated;
      const arm2Sprite = isActiveRE ? _reArm2Activated : _reArm2Deactivated;
      
      // Piece sizes
      const headSize = boxW * 1.2;
      const armSize = boxW * 0.9;
      
      if (reState === 0) {
        // Inactive: rock pieces scattered on ground
        if (_isSpriteReady(headSprite)) {
          ctx.drawImage(headSprite, screenX - headSize * 0.5, screenY - headSize * 0.3, headSize, headSize);
        }
        if (_isSpriteReady(arm1Sprite)) {
          ctx.drawImage(arm1Sprite, screenX - armSize * 1.4, screenY, armSize, armSize);
        }
        if (_isSpriteReady(arm2Sprite)) {
          ctx.drawImage(arm2Sprite, screenX + armSize * 0.5, screenY + armSize * 0.1, armSize, armSize);
        }
      } else {
        // Activating or active: lerp pieces into floating formation
        const t = reState === 1 ? activationT : 1.0;
        
        // Head: rises from ground to center-above
        const headRestY = screenY - headSize * 0.3;
        const headFloatY = screenY - headSize * 1.0;
        const headY = headRestY + (headFloatY - headRestY) * t;
        
        // Arm 1: slides left
        const arm1RestX = screenX - armSize * 1.4;
        const arm1RestY = screenY;
        const arm1FloatX = screenX - armSize * 1.1;
        const arm1FloatY = screenY - armSize * 0.4;
        const arm1X = arm1RestX + (arm1FloatX - arm1RestX) * t;
        const arm1Y = arm1RestY + (arm1FloatY - arm1RestY) * t;
        
        // Arm 2: slides right
        const arm2RestX = screenX + armSize * 0.5;
        const arm2RestY = screenY + armSize * 0.1;
        const arm2FloatX = screenX + armSize * 0.3;
        const arm2FloatY = screenY - armSize * 0.4;
        const arm2X = arm2RestX + (arm2FloatX - arm2RestX) * t;
        const arm2Y = arm2RestY + (arm2FloatY - arm2RestY) * t;
        
        // Gentle hover bob when fully active
        const bobOffset = reState >= 2 ? Math.sin(cluster.rockElementalOrbitAngleRad * 0.5) * 2.0 * scalePx : 0;
        
        if (_isSpriteReady(headSprite)) {
          ctx.drawImage(headSprite, screenX - headSize * 0.5, headY + bobOffset, headSize, headSize);
        }
        if (_isSpriteReady(arm1Sprite)) {
          ctx.drawImage(arm1Sprite, arm1X, arm1Y + bobOffset, armSize, armSize);
        }
        if (_isSpriteReady(arm2Sprite)) {
          ctx.drawImage(arm2Sprite, arm2X, arm2Y + bobOffset, armSize, armSize);
        }
      }

    } else if (cluster.isRadiantTetherFlag === 1) {
      // Radiant Tether boss body is rendered by radiantTetherRenderer.ts
      // Skip default cluster rendering; health bar drawn below.

    } else if (cluster.isGrappleHunterFlag === 1) {
      // ── Grapple Hunter: dark purple box with hook accent ────────────────
      ctx.fillStyle = '#8833cc';
      ctx.globalAlpha = 0.8;
      ctx.fillRect(boxLeft, boxTop, boxW, boxH);
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = '#aa55ee';
      ctx.lineWidth = 2;
      ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
      // Inner highlight
      ctx.fillStyle = 'rgba(200,150,255,0.3)';
      ctx.fillRect(boxLeft + 2, boxTop + 2, boxW - 4, 3);

      // Draw grapple chain during attack/reel states
      if (cluster.grappleHunterState === 2 || cluster.grappleHunterState === 3) {
        const tipScreenX = cluster.grappleHunterTipXWorld * scalePx + offsetXPx;
        const tipScreenY = cluster.grappleHunterTipYWorld * scalePx + offsetYPx;
        // Gold chain line
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(tipScreenX, tipScreenY);
        ctx.strokeStyle = 'rgba(255, 180, 50, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Tip dot
        ctx.beginPath();
        ctx.arc(tipScreenX, tipScreenY, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcc00';
        ctx.fill();
      }

    } else {
      // ── Regular cluster box body ─────────────────────────────────────────
      const bodyColor = '#ff6600';

      // Filled box
      ctx.fillStyle = bodyColor;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(boxLeft, boxTop, boxW, boxH);
      ctx.globalAlpha = 1.0;

      // Box border
      ctx.strokeStyle = bodyColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(boxLeft, boxTop, boxW, boxH);

      // Inner highlight on top edge
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(boxLeft + 2, boxTop + 2, boxW - 4, 3);

      if (showHitboxes) {
        ctx.strokeStyle = 'rgba(255, 120, 40, 0.95)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
        ctx.setLineDash([]);
      }
    }

    // ── Health bar (above the body) ───────────────────────────────────────
    // Player health bar is drawn in the HUD (top-left), not over the character.
    if (isPlayer) continue;

    const healthRatio = cluster.healthPoints / cluster.maxHealthPoints;
    // For flying eyes the health bar is anchored above the outer diamond ring;
    // for regular clusters it sits above the box.
    const barWidthPx  = cluster.isFlyingEyeFlag === 1
      ? boxHalfW * 5.0
      : boxW;
    const barHeightPx = 4;
    const barXPx      = cluster.isFlyingEyeFlag === 1
      ? screenX - barWidthPx * 0.5
      : boxLeft;
    const barYPx      = cluster.isFlyingEyeFlag === 1
      ? screenY - boxHalfW * 2.5 - barHeightPx - 6
      : boxTop - barHeightPx - 4;

    ctx.fillStyle = '#333';
    ctx.fillRect(barXPx, barYPx, barWidthPx, barHeightPx);
    let barColor: string;
    if (cluster.isFlyingEyeFlag === 1) {
      barColor = getFlyingEyeColor(cluster.flyingEyeElementKind);
    } else if (cluster.isRockElementalFlag === 1) {
      barColor = '#8b6914'; // brown/amber for rock elemental
    } else if (cluster.isRadiantTetherFlag === 1) {
      barColor = '#fffde0'; // radiant white-gold for light boss
    } else if (cluster.isGrappleHunterFlag === 1) {
      barColor = '#aa55ee'; // purple for grapple hunter
    } else if (isPlayer) {
      barColor = '#00ff99';
    } else {
      barColor = '#ff6600';
    }
    ctx.fillStyle = barColor;
    ctx.fillRect(barXPx, barYPx, barWidthPx * healthRatio, barHeightPx);
  }

  ctx.restore();
}

export function renderGrapple(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  const hasActiveOrMiss = snapshot.isGrappleActiveFlag === 1 || snapshot.isGrappleMissActiveFlag === 1;
  if (!hasActiveOrMiss && snapshot.grappleAttachFxTicks <= 0) return;

  let playerCluster: (typeof snapshot.clusters)[0] | undefined;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    if (snapshot.clusters[ci].isPlayerFlag === 1 && snapshot.clusters[ci].isAliveFlag === 1) {
      playerCluster = snapshot.clusters[ci];
      break;
    }
  }
  if (playerCluster === undefined && snapshot.grappleAttachFxTicks <= 0) return;

  // Grapple visually originates from right-middle (or left-middle when facing left) of the sprite
  let px = 0;
  let py = 0;
  if (playerCluster !== undefined) {
    const halfW = playerCluster.halfWidthWorld * scalePx;
    const offsetDir = playerCluster.isFacingLeftFlag === 1 ? -1 : 1;
    px = playerCluster.positionXWorld * scalePx + offsetXPx + offsetDir * halfW;
    py = playerCluster.positionYWorld * scalePx + offsetYPx;
  }
  let ax = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
  let ay = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;
  if (snapshot.isGrappleMissActiveFlag === 1 && snapshot.grappleParticleStartIndex >= 0) {
    const tipIndex = snapshot.grappleParticleStartIndex + 9;
    const isTipAlive = tipIndex < snapshot.particles.particleCount && snapshot.particles.isAliveFlag[tipIndex] === 1;
    if (isTipAlive) {
      ax = snapshot.particles.positionXWorld[tipIndex] * scalePx + offsetXPx;
      ay = snapshot.particles.positionYWorld[tipIndex] * scalePx + offsetYPx;
    }
  }

  ctx.save();

  if (hasActiveOrMiss && playerCluster !== undefined) {
    // Faint guide glow only — the "rope" itself is represented by gold particles.
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ax, ay);
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.08)';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([1, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (hasActiveOrMiss && playerCluster !== undefined) {
    const dx = ax - px;
    const dy = ay - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const segmentCount = Math.max(1, Math.floor(dist / GRAPPLE_DUST_SEGMENT_PX));
    const dustSizePx = GRAPPLE_DUST_SIZE_PX * Math.max(1, scalePx * 0.5);

    if (_isSpriteReady(_grappleDustSprite)) {
      for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex++) {
        const t = segmentCount > 0 ? segmentIndex / segmentCount : 0;
        const sx = px + dx * t;
        const sy = py + dy * t;
        ctx.drawImage(_grappleDustSprite, sx - dustSizePx * 0.5, sy - dustSizePx * 0.5, dustSizePx, dustSizePx);
      }
    } else {
      for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex++) {
        const t = segmentCount > 0 ? segmentIndex / segmentCount : 0;
        const sx = px + dx * t;
        const sy = py + dy * t;
        ctx.fillStyle = 'rgba(255, 215, 0, 0.75)';
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
    }
  }

  const endSizePx = GRAPPLE_DUST_END_SIZE_PX * Math.max(1, scalePx * 0.5);
  if (_isSpriteReady(_grappleDustEndSprite)) {
    ctx.drawImage(_grappleDustEndSprite, ax - endSizePx * 0.5, ay - endSizePx * 0.5, endSizePx, endSizePx);
    if (hasActiveOrMiss && playerCluster !== undefined) {
      ctx.drawImage(_grappleDustEndSprite, px - endSizePx * 0.5, py - endSizePx * 0.5, endSizePx, endSizePx);
    }
  } else {
    ctx.beginPath();
    ctx.arc(ax, ay, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 215, 0, 0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 200, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (snapshot.grappleAttachFxTicks > 0) {
    const fxProgress = 1.0 - snapshot.grappleAttachFxTicks / 14.0;
    const fxRadius = 6 + fxProgress * 24;
    const fxAlpha = 0.4 * (1.0 - fxProgress);
    ctx.beginPath();
    ctx.arc(
      snapshot.grappleAttachFxXWorld * scalePx + offsetXPx,
      snapshot.grappleAttachFxYWorld * scalePx + offsetYPx,
      fxRadius,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = `rgba(255, 236, 170, ${fxAlpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ── Top-surface grapple special effect: rotating golden starburst at anchor ─
  if (snapshot.isGrappleTopSurfaceFlag === 1 && snapshot.isGrappleActiveFlag === 1) {
    /** Tick-to-radians scale for starburst rotation speed. */
    const STARBURST_TIME_SCALE = 0.12;
    /** Number of radiating rays in the starburst. */
    const STARBURST_RAY_COUNT = 8;
    /** Inner radius (px) where rays begin — keeps the center clear. */
    const STARBURST_INNER_RADIUS_PX = 2;
    /** Base outer radius (px) of the starburst rays. */
    const STARBURST_OUTER_BASE_PX = 8;
    /** Frequency of the pulsing outer-radius oscillation. */
    const STARBURST_PULSE_FREQUENCY = 3.0;
    /** Amplitude (px) of the pulsing oscillation on the outer radius. */
    const STARBURST_PULSE_AMPLITUDE_PX = 3;
    /** Radius (px) of the bright center glow circle. */
    const STARBURST_CENTER_GLOW_RADIUS_PX = 3;

    const starAx = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
    const starAy = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;
    const time = snapshot.tick * STARBURST_TIME_SCALE;
    const pulseOuter = STARBURST_OUTER_BASE_PX +
      Math.sin(time * STARBURST_PULSE_FREQUENCY) * STARBURST_PULSE_AMPLITUDE_PX;

    // Radiating golden rays
    for (let r = 0; r < STARBURST_RAY_COUNT; r++) {
      const angle = time + (r / STARBURST_RAY_COUNT) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(starAx + cosA * STARBURST_INNER_RADIUS_PX, starAy + sinA * STARBURST_INNER_RADIUS_PX);
      ctx.lineTo(starAx + cosA * pulseOuter, starAy + sinA * pulseOuter);
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Bright center glow
    ctx.beginPath();
    ctx.arc(starAx, starAy, STARBURST_CENTER_GLOW_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 220, 0.95)';
    ctx.fill();

    // Outer pulsing ring (brighter when stuck / decelerating)
    const ringAlpha = snapshot.isGrappleStuckFlag === 1 ? 0.7 : 0.4;
    ctx.beginPath();
    ctx.arc(starAx, starAy, pulseOuter + 2, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 236, 170, ${ringAlpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}
