import { WorldSnapshot } from '../snapshot';
import { DASH_RECHARGE_ANIM_TICKS } from '../../sim/clusters/dashConstants';
import { renderWallSprites } from '../walls/blockSpriteRenderer';
import { BLOCK_SIZE_MEDIUM, PLAYER_HALF_WIDTH_WORLD } from '../../levels/roomDef';
import type { PlayerCloak } from './playerCloak';
import type { PhantomCloakExtension } from './phantomCloak';
import { loadImg, isSpriteReady } from '../imageCache';
import {
  getCharacterSprites,
  getOrCreateOuterOutlineMask,
  getPlayerSprite,
  PLAYER_OUTLINE_THICKNESS_WORLD,
  PLAYER_SPRITE_WIDTH_WORLD,
  PLAYER_SPRITE_HEIGHT_WORLD,
  PLAYER_SPRITE_PIVOT_X_WORLD,
  PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD,
  PLAYER_FAST_FALL_SPRITE_THRESHOLD_WORLD,
  PLAYER_AFTERIMAGE_MIN_SPEED_WORLD_PER_SEC,
  PLAYER_AFTERIMAGE_COUNT,
  HURT_FLASH_DURATION_TICKS,
  HURT_FLASH_MAX_ALPHA,
} from './characterSprites';
import {
  getFlyingEyeColor,
  renderFlyingEye,
  renderGoldenMimic,
  renderRollingEnemy,
  renderRockElemental,
  renderSlimeBody,
  renderLargeSlimeDustOrbit,
  renderWheelEnemy,
  renderBeetleCrawling,
  renderBeetleFlying,
  renderSquareStampede,
  renderWaterBubbleBody,
  renderIceBubbleBody,
  renderBeeSwarm,
} from './enemyRenderers';

// ── Grapple dust sprites ─────────────────────────────────────────────────────

const _grappleDustSprite = loadImg('SPRITES/DUST/grapplingHook/grapplingHookDust.png');
const _grappleDustEndSprite = loadImg('SPRITES/DUST/grapplingHook/grapplingHookDust_end.png');
const GRAPPLE_DUST_SEGMENT_PX = 4;
const GRAPPLE_DUST_SIZE_PX = 4;
const GRAPPLE_DUST_END_SIZE_PX = 4;

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
      const isInvisibleBoundary = snapshot.walls.isInvisibleFlag[wi] === 1;
      const isThinHorizontal = screenH <= BLOCK_SIZE_MEDIUM * scalePx;
      const isThinVertical = screenW <= BLOCK_SIZE_MEDIUM * scalePx;
      if (isInvisibleBoundary && (isThinHorizontal || isThinVertical)) {
        // Draw a single centerline for thin invisible boundary walls so room
        // borders show as one dotted line instead of a double-edge rectangle.
        ctx.beginPath();
        if (isThinHorizontal) {
          const centerY = screenY + screenH * 0.5;
          ctx.moveTo(screenX, centerY);
          ctx.lineTo(screenX + screenW, centerY);
        } else {
          const centerX = screenX + screenW * 0.5;
          ctx.moveTo(centerX, screenY);
          ctx.lineTo(centerX, screenY + screenH);
        }
        ctx.stroke();
      } else {
        ctx.strokeRect(screenX, screenY, screenW, screenH);
      }
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
  playerCloak?: PlayerCloak,
  phantomCloak?: PhantomCloakExtension,
  isDebugCloak = false,
): void {
  ctx.save();
  // Pixel-art safety: simulation/camera may be subpixel, but sprite draws
  // should land on integer screen pixels to avoid texture interpolation blur.
  ctx.imageSmoothingEnabled = false;

  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;

    const screenX = Math.round(cluster.renderPositionXWorld * scalePx + offsetXPx);
    const screenY = Math.round(cluster.renderPositionYWorld * scalePx + offsetYPx);

    const isPlayer = cluster.isPlayerFlag === 1;

    // ── Box dimensions ─────────────────────────────────────────────────────
    const boxHalfW = cluster.halfWidthWorld * scalePx;
    const boxHalfH = cluster.halfHeightWorld * scalePx;
    const boxLeft  = screenX - boxHalfW;
    const boxTop   = screenY - boxHalfH;
    const boxW     = boxHalfW * 2;
    const boxH     = boxHalfH * 2;

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
      const charSprites = getCharacterSprites(snapshot.characterId);
      const isGrappling = snapshot.isGrappleActiveFlag === 1;
      // Proximity-bounce stub sprite: while the bounce timer is active, override
      // the sprite with the jumping sprite and apply a surface-aligned rotation.
      const isBouncing = snapshot.grappleProximityBounceTicksLeft > 0;
      const sprite = isBouncing
        ? charSprites.jumping
        : getPlayerSprite(charSprites, cluster, isGrappling);
      const bounceRotationAngleRad = isBouncing
        ? snapshot.grappleProximityBounceRotationAngleRad
        : 0;
      // spritePivotX is the x-offset from the flip-pivot (hitbox centre, screenX) to
      // the sprite's left edge.  Pixel 9.5 from the sprite left aligns with screenX,
      // so the sprite left is 9.5px to the left of screenX.
      const spritePivotX = PLAYER_SPRITE_PIVOT_X_WORLD * scalePx;
      const spriteHalfH = (PLAYER_SPRITE_HEIGHT_WORLD * scalePx) * 0.5;
      const spriteW = PLAYER_SPRITE_WIDTH_WORLD * scalePx;
      const spriteH = spriteHalfH * 2;
      const spriteCenterY = screenY + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD * scalePx;
      // Build player state for cloak rendering (shared by back + front).
      const cloakPlayerState = playerCloak !== undefined ? {
        positionXWorld: cluster.positionXWorld,
        positionYWorld: cluster.positionYWorld,
        velocityXWorld: cluster.velocityXWorld,
        velocityYWorld: cluster.velocityYWorld,
        isFacingLeftFlag: cluster.isFacingLeftFlag,
        isGroundedFlag: cluster.isGroundedFlag,
        isSprintingFlag: cluster.isSprintingFlag,
        isCrouchingFlag: cluster.isCrouchingFlag,
        isWallSlidingFlag: cluster.isWallSlidingFlag,
        halfWidthWorld: cluster.halfWidthWorld,
        halfHeightWorld: cluster.halfHeightWorld,
      } : undefined;

      if (isSpriteReady(sprite)) {
        // ── Invulnerability flicker: skip every other 3 ticks while invulnerable ──
        const isInvulnerable = cluster.invulnerabilityTicks > 0;
        // Flicker: visible for 3 ticks, invisible for 3 ticks — use ticks countdown.
        const flickerHide = isInvulnerable && (Math.floor(cluster.invulnerabilityTicks / 3) % 2 === 0);
        if (flickerHide) {
          // Skip rendering this cluster for this flicker frame — still render cloak/phantom
          if (phantomCloak !== undefined) {
            phantomCloak.render(ctx, offsetXPx, offsetYPx, scalePx);
          }
          if (playerCloak !== undefined && cloakPlayerState !== undefined) {
            playerCloak.renderFront(ctx, offsetXPx, offsetYPx, scalePx, cloakPlayerState);
          }
          if (phantomCloak !== undefined) {
            phantomCloak.renderParticles(ctx, offsetXPx, offsetYPx, scalePx);
          }
          continue; // skip rest of player rendering
        }

        // ── Layer 0: Phantom cloak extension (behind main cloak) ──────────
        if (phantomCloak !== undefined) {
          phantomCloak.render(ctx, offsetXPx, offsetYPx, scalePx);
        }

        // ── Layer 1: Back cloak (behind body) ──────────────────────────
        if (playerCloak !== undefined) {
          playerCloak.renderBack(ctx, offsetXPx, offsetYPx, scalePx);
        }

        // ── Layer 2: Player body sprite ────────────────────────────────
        const outlineThicknessPx = PLAYER_OUTLINE_THICKNESS_WORLD * scalePx;
        const outlineMask = getOrCreateOuterOutlineMask(sprite);
        const speedXWorldPerSec = cluster.velocityXWorld;
        const speedYWorldPerSec = cluster.velocityYWorld;
        const speedWorldPerSec = Math.sqrt(
          speedXWorldPerSec * speedXWorldPerSec + speedYWorldPerSec * speedYWorldPerSec,
        );
        if (speedWorldPerSec > PLAYER_AFTERIMAGE_MIN_SPEED_WORLD_PER_SEC) {
          const normX = speedXWorldPerSec / speedWorldPerSec;
          const normY = speedYWorldPerSec / speedWorldPerSec;
          for (let afterimageIndex = 0; afterimageIndex < PLAYER_AFTERIMAGE_COUNT; afterimageIndex++) {
            const t = (afterimageIndex + 1) / PLAYER_AFTERIMAGE_COUNT;
            const spacingPx = 3.0 * t;
            const drawCenterX = screenX - normX * spacingPx;
            const drawCenterY = spriteCenterY - normY * spacingPx;
            const alpha = 0.085 * (1.0 - t * 0.35);
            ctx.save();
            ctx.translate(Math.round(drawCenterX) - 0.5, Math.round(drawCenterY));
            if (cluster.isFacingLeftFlag === 1) {
              ctx.scale(-1, 1);
            }
            ctx.globalAlpha = alpha;
            ctx.drawImage(
              outlineMask,
              -(spritePivotX + outlineThicknessPx),
              -spriteHalfH - outlineThicknessPx,
              spriteW + outlineThicknessPx * 2,
              spriteH + outlineThicknessPx * 2,
            );
            ctx.drawImage(sprite, -spritePivotX, -spriteHalfH, spriteW, spriteH);
            ctx.restore();
          }
        }
        ctx.save();
        // Shift by -0.5 so that sprite edges (at ±9.5 / ±6.5 from pivot) land on
        // integer virtual pixels in both facing directions, preventing the edge-pixel
        // duplication artifact that appears under ctx.scale(-1, 1).
        ctx.translate(screenX - 0.5, spriteCenterY);
        if (cluster.isFacingLeftFlag === 1) {
          ctx.scale(-1, 1);
        }
        // Proximity-bounce stub: rotate the jumping sprite to face the surface.
        if (bounceRotationAngleRad !== 0) {
          ctx.rotate(bounceRotationAngleRad);
        }
        // Draw black outer silhouette first, then the original sprite on top.
        ctx.drawImage(
          outlineMask,
          -(spritePivotX + outlineThicknessPx),
          -spriteHalfH - outlineThicknessPx,
          spriteW + outlineThicknessPx * 2,
          spriteH + outlineThicknessPx * 2,
        );
        ctx.drawImage(sprite, -spritePivotX, -spriteHalfH, spriteW, spriteH);
        ctx.restore();

        // ── Hurt flash overlay: red tint while hurtTicks > 0 ─────────────
        if (cluster.hurtTicks > 0) {
          const flashAlpha = (cluster.hurtTicks / HURT_FLASH_DURATION_TICKS) * HURT_FLASH_MAX_ALPHA;
          ctx.save();
          ctx.globalAlpha = flashAlpha;
          ctx.fillStyle = '#ff2222';
          ctx.fillRect(screenX - spritePivotX, spriteCenterY - spriteHalfH, spriteW, spriteH);
          ctx.restore();
        }

        // ── Debug hitbox for player (only when showHitboxes is on) ────────
        if (showHitboxes) {
          // The sprite's top-left in screen space (constant regardless of facing).
          const spriteTopY = spriteCenterY - spriteHalfH; // = screenY - 14*scalePx
          // Determine state-adjusted hitbox in sprite pixel coordinates.
          // All measured from sprite top-left; y increases downward.
          const isAirborne = cluster.isGroundedFlag === 0;
          const isJumping  = isAirborne && cluster.velocityYWorld < 0;
          // Jumping (y 2–22): the debug rectangle is 2 px higher than the sim
          // hitbox (y 4–24 / PLAYER_HALF_HEIGHT_WORLD = 10).  The sim collision
          // box is intentionally left unchanged for jumping — only the debug
          // indicator shifts to reflect the intended visual hitbox placement.
          let hbTopPx   = isJumping ? 2 : 4;   // sprite y-pixel of hitbox top
          const hbBotPx = isJumping ? 22 : 24;  // sprite y-pixel of hitbox bottom
          // Derive x edges from the pivot constant so they stay in sync.
          const hbHalfWPx = PLAYER_HALF_WIDTH_WORLD; // 3.5
          const hbLeftPx  = PLAYER_SPRITE_PIVOT_X_WORLD - hbHalfWPx; // 9.5 - 3.5 = 6
          const hbRightPx = PLAYER_SPRITE_PIVOT_X_WORLD + hbHalfWPx; // 9.5 + 3.5 = 13
          // Crouching: sim already adjusted positionY and halfHeightWorld.
          // Use the documented sprite y 8–24 for the crouching indicator.
          if (cluster.isCrouchingFlag === 1) {
            hbTopPx = 8; // y 8–24, matching CROUCH_HALF_HEIGHT_WORLD = 8
          }
          const hbScreenLeft = screenX - spritePivotX + hbLeftPx  * scalePx;
          const hbScreenTop  = spriteTopY              + hbTopPx   * scalePx;
          const hbScreenW    = (hbRightPx - hbLeftPx) * scalePx;
          const hbScreenH    = (hbBotPx   - hbTopPx)  * scalePx;
          // Fast-fall: use actual sim half-width (already narrowed in sim).
          const isFastFalling = isAirborne && cluster.velocityYWorld > PLAYER_FAST_FALL_SPRITE_THRESHOLD_WORLD;
          const fastFallHbW    = cluster.halfWidthWorld * 2 * scalePx;
          const fastFallHbLeft = screenX - cluster.halfWidthWorld * scalePx;
          ctx.save();
          ctx.strokeStyle = 'rgba(0, 255, 100, 0.9)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          if (isFastFalling) {
            ctx.strokeRect(fastFallHbLeft, hbScreenTop, fastFallHbW, hbScreenH);
          } else {
            ctx.strokeRect(hbScreenLeft, hbScreenTop, hbScreenW, hbScreenH);
          }
          ctx.setLineDash([]);
          ctx.restore();
        }

        // ── Layer 3: Front cloak (in front of body) ────────────────────
        if (playerCloak !== undefined && cloakPlayerState !== undefined) {
          playerCloak.renderFront(ctx, offsetXPx, offsetYPx, scalePx, cloakPlayerState);
        }

        // ── Layer 4: Phantom dissipation particles (above all cloaks) ─────
        if (phantomCloak !== undefined) {
          phantomCloak.renderParticles(ctx, offsetXPx, offsetYPx, scalePx);
        }

        // ── Debug overlay (both cloak polygons + control points) ───────
        if (playerCloak !== undefined && isDebugCloak && cloakPlayerState !== undefined) {
          playerCloak.renderDebug(ctx, offsetXPx, offsetYPx, scalePx, cloakPlayerState);
        }
        if (phantomCloak !== undefined && isDebugCloak) {
          phantomCloak.renderDebug(ctx, offsetXPx, offsetYPx, scalePx);
        }
      } else {
        // Fallback while sprite loads: coloured box
        const spritePivotXFb = PLAYER_SPRITE_PIVOT_X_WORLD * scalePx;
        const spriteHFb = PLAYER_SPRITE_HEIGHT_WORLD * scalePx;
        ctx.fillStyle = '#00ff99';
        ctx.globalAlpha = 0.75;
        ctx.fillRect(screenX - spritePivotXFb, spriteCenterY - spriteHFb * 0.5, PLAYER_SPRITE_WIDTH_WORLD * scalePx, spriteHFb);
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#00ff99';
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX - spritePivotXFb, spriteCenterY - spriteHFb * 0.5, PLAYER_SPRITE_WIDTH_WORLD * scalePx, spriteHFb);
      }
    } else if (cluster.isRollingEnemyFlag === 1) {
      // ── Rolling enemy: sprite rotated by accumulated roll angle ──────────
      renderRollingEnemy(ctx, screenX, screenY, cluster, scalePx);
    } else if (cluster.isRockElementalFlag === 1) {
      // ── Rock Elemental: composite sprite (head + 2 arms) ────────────────
      renderRockElemental(ctx, screenX, screenY, cluster, scalePx);

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

    } else if (cluster.isSlimeFlag === 1) {
      // ── Slime: green blob circle ──────────────────────────────────────────
      const healthRatio = cluster.maxHealthPoints > 0 ? cluster.healthPoints / cluster.maxHealthPoints : 1;
      renderSlimeBody(ctx, screenX, screenY, boxHalfW, false, healthRatio);
    } else if (cluster.isLargeSlimeFlag === 1) {
      // ── Large Dust Slime: larger green blob with orbiting dust ────────────
      const healthRatio = cluster.maxHealthPoints > 0 ? cluster.healthPoints / cluster.maxHealthPoints : 1;
      renderSlimeBody(ctx, screenX, screenY, boxHalfW, true, healthRatio);
      renderLargeSlimeDustOrbit(ctx, screenX, screenY, cluster.largeSlimeDustOrbitAngleRad, boxHalfW);
    } else if (cluster.isWheelEnemyFlag === 1) {
      // ── Wheel Enemy: rolling circle with spokes ───────────────────────────
      renderWheelEnemy(ctx, screenX, screenY, boxHalfW, cluster.wheelRollAngleRad);
    } else if (cluster.isBeetleFlag === 1) {
      // ── Golden Beetle: stub graphics — oval body with wing hints ─────────
      if (cluster.beetleIsFlightModeFlag === 1) {
        renderBeetleFlying(ctx, screenX, screenY, boxHalfW, cluster.beetleAiState);
      } else {
        renderBeetleCrawling(
          ctx, screenX, screenY, boxHalfW,
          cluster.beetleSurfaceNormalXWorld,
          cluster.beetleSurfaceNormalYWorld,
          cluster.beetleAiState,
        );
      }
    } else if (cluster.isBubbleEnemyFlag === 1) {
      // ── Bubble enemy: translucent circle body ─────────────────────────────
      if (cluster.bubbleState === 0) {
        const healthRatio = cluster.maxHealthPoints > 0
          ? cluster.healthPoints / cluster.maxHealthPoints : 1.0;
        if (cluster.isIceBubbleFlag === 1) {
          renderIceBubbleBody(ctx, screenX, screenY, boxHalfW, healthRatio);
        } else {
          renderWaterBubbleBody(ctx, screenX, screenY, boxHalfW, healthRatio);
        }
      }
      // In popped state (bubbleState === 1), no cluster body is drawn — only particles.
    } else if (cluster.isSquareStampedeFlag === 1) {
      // ── Square Stampede: ghost trail + current square ─────────────────────
      renderSquareStampede(ctx, screenX, screenY, cluster, snapshot, scalePx, offsetXPx, offsetYPx);
    } else if (cluster.isGoldenMimicFlag === 1) {
      // ── Golden Mimic: golden silhouette of the player sprite ──────────────
      renderGoldenMimic(ctx, screenX, screenY, cluster, snapshot.tick, scalePx, snapshot.characterId);
    } else if (cluster.isBeeSwarmFlag === 1) {
      // ── Bee Swarm: individual bees rendered as 4×2 pixel sprites ─────────
      renderBeeSwarm(ctx, cluster, snapshot, scalePx, offsetXPx, offsetYPx);
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
    // Popped bubble clusters have no visible body — skip health bar too
    if (cluster.isBubbleEnemyFlag === 1 && cluster.bubbleState === 1) continue;

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
    } else if (cluster.isSlimeFlag === 1) {
      barColor = '#44cc44';
    } else if (cluster.isLargeSlimeFlag === 1) {
      barColor = '#228822';
    } else if (cluster.isWheelEnemyFlag === 1) {
      barColor = '#cc8844';
    } else if (cluster.isBeetleFlag === 1) {
      barColor = '#ffd700'; // golden yellow for beetle
    } else if (cluster.isBubbleEnemyFlag === 1) {
      barColor = cluster.isIceBubbleFlag === 1 ? '#aaddff' : '#3388ff';
    } else if (cluster.isSquareStampedeFlag === 1) {
      barColor = '#dd44ff'; // vivid magenta-purple for square stampede
    } else if (cluster.isGoldenMimicFlag === 1) {
      barColor = '#ffd700'; // bright gold for golden mimic
    } else if (cluster.isBeeSwarmFlag === 1) {
      barColor = '#ffcc00'; // amber-gold for bee swarm
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

export function renderGrapple(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number, isDebugMode = false): void {
  const hasActiveGrapple = snapshot.isGrappleActiveFlag === 1;
  if (!hasActiveGrapple && snapshot.grappleAttachFxTicks <= 0) return;

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
  const ax = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
  const ay = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;

  ctx.save();

  if (hasActiveGrapple && playerCluster !== undefined) {
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

  if (hasActiveGrapple && playerCluster !== undefined) {
    const dx = ax - px;
    const dy = ay - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const segmentCount = Math.max(1, Math.floor(dist / GRAPPLE_DUST_SEGMENT_PX));
    const dustSizePx = GRAPPLE_DUST_SIZE_PX * Math.max(1, scalePx * 0.5);

    if (isSpriteReady(_grappleDustSprite)) {
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

  if (hasActiveGrapple && playerCluster !== undefined) {
    const endSizePx = GRAPPLE_DUST_END_SIZE_PX * Math.max(1, scalePx * 0.5);
    if (isSpriteReady(_grappleDustEndSprite)) {
      ctx.drawImage(_grappleDustEndSprite, ax - endSizePx * 0.5, ay - endSizePx * 0.5, endSizePx, endSizePx);
      ctx.drawImage(_grappleDustEndSprite, px - endSizePx * 0.5, py - endSizePx * 0.5, endSizePx, endSizePx);
    } else {
      ctx.beginPath();
      ctx.arc(ax, ay, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 215, 0, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 200, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
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
  if (snapshot.isGrappleZipActiveFlag === 1 && snapshot.isGrappleActiveFlag === 1) {
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

  // ── Debug grapple collision visualization ───────────────────────────────────
  // Draws the last sweep segment, raw hit point, surface normal, and snapped
  // anchor when debug mode is on.  Shows how CCD placed the anchor relative
  // to the wall surface so seam or epsilon issues are immediately visible.
  if (isDebugMode && snapshot.isGrappleDebugActiveFlag === 1) {
    const sfx = snapshot.grappleDebugSweepFromXWorld * scalePx + offsetXPx;
    const sfy = snapshot.grappleDebugSweepFromYWorld * scalePx + offsetYPx;
    const stx = snapshot.grappleDebugSweepToXWorld * scalePx + offsetXPx;
    const sty = snapshot.grappleDebugSweepToYWorld * scalePx + offsetYPx;
    const rhx = snapshot.grappleDebugRawHitXWorld * scalePx + offsetXPx;
    const rhy = snapshot.grappleDebugRawHitYWorld * scalePx + offsetYPx;
    const snx = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
    const sny = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;
    const nx  = snapshot.grappleAnchorNormalXWorld;
    const ny  = snapshot.grappleAnchorNormalYWorld;

    // Sweep segment (cyan dashed line)
    ctx.beginPath();
    ctx.moveTo(sfx, sfy);
    ctx.lineTo(stx, sty);
    ctx.strokeStyle = 'rgba(0, 220, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Raw hit point (yellow cross)
    ctx.strokeStyle = 'rgba(255, 230, 0, 0.9)';
    ctx.lineWidth = 1.5;
    const cs = 4;
    ctx.beginPath(); ctx.moveTo(rhx - cs, rhy); ctx.lineTo(rhx + cs, rhy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rhx, rhy - cs); ctx.lineTo(rhx, rhy + cs); ctx.stroke();

    // Surface normal arrow (magenta) from snapped anchor outward
    const normalLenPx = 12;
    ctx.beginPath();
    ctx.moveTo(snx, sny);
    ctx.lineTo(snx + nx * normalLenPx, sny + ny * normalLenPx);
    ctx.strokeStyle = 'rgba(255, 80, 230, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Snapped anchor point (green circle)
    ctx.beginPath();
    ctx.arc(snx, sny, 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(80, 255, 120, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label: "AABB" to indicate merged-rectangle broad-phase was used
    ctx.fillStyle = 'rgba(0, 220, 255, 0.85)';
    ctx.font = '8px monospace';
    ctx.fillText('AABB', rhx + 5, rhy - 4);
  }

  ctx.restore();
}
