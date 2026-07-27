import type { ClusterSnapshot } from '../snapshot';
import type { WorldSnapshot } from '../snapshotTypes';
import {
  CW_FIREBALL_SIZE_WORLD,
  CW_FIRE_DUST_SIZE_WORLD,
  CW_PROJECTILE_TYPE_METEOR,
  CW_SMOKE_SIZE_WORLD,
  CW_METEOR_SIZE_WORLD,
  CW_TELEGRAPH_KIND_METEOR,
  CW_TELEGRAPH_KIND_PILLAR,
} from '../../sim/clusters/crimsonWizardConfig';
import {
  CW_SPRITE_ATTACK,
  CW_SPRITE_ATTACK_ABOVE,
  getCrimsonWizardSpriteFrame,
} from '../../sim/clusters/crimsonWizardAnimation';
import { loadImg, isSpriteReady } from '../imageCache';
import {
  CW_FIRE_CIRCLE_FRAME_COUNT,
  getCrimsonWizardFireCircleFrame,
} from '../../sim/clusters/crimsonWizardFireCircleAnimation';

const FIRE_COLORS = ['#ffb02e', '#ff6a1a', '#ff3b12', '#b11226', '#6f1018'];

const CW_SPRITE_DIR = 'SPRITES/ENEMIES/BOSSES/CrimsonWizard';
const CW_FIRE_CIRCLE_ATLAS_URL = 'ANIMATIONS/FireCircle/spritesheet.png';
const _cwIdleSprite = loadImg(`${CW_SPRITE_DIR}/CrimsonWizard_Idle.png`);
const _cwFireCircleAtlas = loadImg(CW_FIRE_CIRCLE_ATLAS_URL);
const _cwAttackSprites: readonly HTMLImageElement[] = [1, 2, 3, 4, 5, 6].map((n) =>
  loadImg(`${CW_SPRITE_DIR}/CrimsonWizard_Attacking_Frame_${n}.png`),
);
const _cwAttackAboveSprites: readonly HTMLImageElement[] = [1, 2, 3].map((n) =>
  loadImg(`${CW_SPRITE_DIR}/CrimsonWizard_Attacking_Above_Frame_${n}.png`),
);

function selectCrimsonWizardSprite(cluster: ClusterSnapshot): HTMLImageElement | null {
  const frame = getCrimsonWizardSpriteFrame(cluster.crimsonWizardState, cluster.crimsonWizardStateTicks);
  if (frame.kind === CW_SPRITE_ATTACK) return _cwAttackSprites[frame.frameIndex - 1] ?? null;
  if (frame.kind === CW_SPRITE_ATTACK_ABOVE) return _cwAttackAboveSprites[frame.frameIndex - 1] ?? null;
  return _cwIdleSprite;
}

export function renderCrimsonWizardFireCircle(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cluster: ClusterSnapshot,
  scalePx: number,
): void {
  const animation = getCrimsonWizardFireCircleFrame(cluster.crimsonWizardFireCircleTicks);
  if (animation === null || animation.opacity <= 0 || !isSpriteReady(_cwFireCircleAtlas)) return;

  const frameWidthPx = _cwFireCircleAtlas.naturalWidth / CW_FIRE_CIRCLE_FRAME_COUNT;
  const frameHeightPx = _cwFireCircleAtlas.naturalHeight;
  if (!Number.isInteger(frameWidthPx) || frameWidthPx !== frameHeightPx) return;

  // The wizard occupies a 32x32-world-unit square. The circle is exactly 200%
  // of that rendered size and remains centered behind the wizard.
  const sizePx = cluster.halfWidthWorld * 4 * scalePx;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = animation.opacity;
  ctx.drawImage(
    _cwFireCircleAtlas,
    animation.frameIndex * frameWidthPx,
    0,
    frameWidthPx,
    frameHeightPx,
    Math.round(screenX - sizePx * 0.5),
    Math.round(screenY - sizePx * 0.5),
    Math.round(sizePx),
    Math.round(sizePx),
  );
  ctx.restore();
}

export function renderCrimsonWizardBody(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cluster: ClusterSnapshot,
  scalePx: number,
): void {
  const halfW = cluster.halfWidthWorld * scalePx;
  const halfH = cluster.halfHeightWorld * scalePx;
  const sprite = selectCrimsonWizardSprite(cluster);

  if (sprite !== null && isSpriteReady(sprite)) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(screenX), Math.round(screenY));
    ctx.scale(cluster.crimsonWizardFacingX < 0 ? -1 : 1, 1);
    ctx.drawImage(sprite, -halfW, -halfH, halfW * 2, halfH * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = '#9d1025';
    ctx.fillRect(Math.round(screenX - halfW), Math.round(screenY - halfH), Math.round(halfW * 2), Math.round(halfH * 2));
    ctx.strokeStyle = '#ff5a2a';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(screenX - halfW) + 0.5, Math.round(screenY - halfH) + 0.5, Math.round(halfW * 2), Math.round(halfH * 2));
  }

  if (cluster.crimsonWizardTelegraphTicks > 0) {
    ctx.globalAlpha = 0.35 + (cluster.crimsonWizardTelegraphTicks % 4) * 0.08;
    ctx.fillStyle = '#ffcc33';
    ctx.fillRect(Math.round(screenX - halfW), Math.round(screenY + halfH + 2), Math.round(halfW * 2), 2);
    ctx.globalAlpha = 1;
  }
}

export function renderCrimsonWizardEffects(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < snapshot.cwTelegraphAliveFlag.length; i++) {
    if (snapshot.cwTelegraphAliveFlag[i] === 0) continue;
    const maxTicks = Math.max(1, snapshot.cwTelegraphMaxTicks[i]);
    const t = snapshot.cwTelegraphTicksLeft[i] / maxTicks;
    const half = Math.max(1, Math.round(snapshot.cwTelegraphHalfSizeWorld[i] * scalePx));
    const x = Math.round(snapshot.cwTelegraphXWorld[i] * scalePx + offsetXPx - half);
    const y = Math.round(snapshot.cwTelegraphYWorld[i] * scalePx + offsetYPx - half);
    const size = half * 2;
    const kind = snapshot.cwTelegraphKind[i];
    ctx.globalAlpha = 0.28 + (1 - t) * 0.32;
    ctx.fillStyle = kind === CW_TELEGRAPH_KIND_METEOR ? '#6f1018' : kind === CW_TELEGRAPH_KIND_PILLAR ? '#d64216' : '#ffcc33';
    ctx.fillRect(x, y, size, size);
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#ffd04a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size, size);
  }
  ctx.globalAlpha = 1;

  const smokeSize = Math.max(1, Math.round(CW_SMOKE_SIZE_WORLD * scalePx));
  for (let i = 0; i < snapshot.cwSmokeAliveFlag.length; i++) {
    if (snapshot.cwSmokeAliveFlag[i] === 0) continue;
    const age = snapshot.cwSmokeAgeTicks[i];
    const life = Math.max(1, snapshot.cwSmokeLifetimeTicks[i]);
    const t = age / life;
    const shade = Math.max(44, Math.floor(188 - t * 130));
    ctx.globalAlpha = Math.max(0, 0.62 * (1 - t));
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(Math.round(snapshot.cwSmokeXWorld[i] * scalePx + offsetXPx), Math.round(snapshot.cwSmokeYWorld[i] * scalePx + offsetYPx), smokeSize, smokeSize);
  }
  ctx.globalAlpha = 1;

  const dustSize = Math.max(1, Math.round(CW_FIRE_DUST_SIZE_WORLD * scalePx));
  for (let i = 0; i < snapshot.cwFireDustAliveFlag.length; i++) {
    if (snapshot.cwFireDustAliveFlag[i] === 0) continue;
    const age = snapshot.cwFireDustAgeTicks[i];
    const life = Math.max(1, snapshot.cwFireDustLifetimeTicks[i]);
    const flicker = ((age + i) & 3) === 0 ? 1 : 0;
    ctx.globalAlpha = Math.max(0.15, 1 - age / life);
    ctx.fillStyle = FIRE_COLORS[(snapshot.cwFireDustColorIndex[i] + flicker) % FIRE_COLORS.length] ?? FIRE_COLORS[0];
    ctx.fillRect(Math.round(snapshot.cwFireDustXWorld[i] * scalePx + offsetXPx), Math.round(snapshot.cwFireDustYWorld[i] * scalePx + offsetYPx), dustSize, dustSize);
  }
  ctx.globalAlpha = 1;

  for (let i = 0; i < snapshot.cwProjectileAliveFlag.length; i++) {
    if (snapshot.cwProjectileAliveFlag[i] === 0) continue;
    const type = snapshot.cwProjectileType[i];
    const sizeWorld = type === CW_PROJECTILE_TYPE_METEOR ? CW_METEOR_SIZE_WORLD : CW_FIREBALL_SIZE_WORLD;
    const sizePx = Math.max(1, Math.round(sizeWorld * scalePx));
    const x = Math.round(snapshot.cwProjectileXWorld[i] * scalePx + offsetXPx - sizePx * 0.5);
    const y = Math.round(snapshot.cwProjectileYWorld[i] * scalePx + offsetYPx - sizePx * 0.5);
    ctx.fillStyle = type === CW_PROJECTILE_TYPE_METEOR ? '#5b1010' : '#ff521c';
    ctx.fillRect(x, y, sizePx, sizePx);
    ctx.strokeStyle = type === CW_PROJECTILE_TYPE_METEOR ? '#ff9d22' : '#ffd04a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, sizePx, sizePx);
  }

  ctx.restore();
}
