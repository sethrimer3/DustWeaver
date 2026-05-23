import type { WorldSnapshot } from '../snapshot';
import { getSnakeSegments } from '../../sim/clusters/snakeAi';

const BIG_BASE_RADIUS_WORLD = 4.2;
const NEEDLE_BASE_RADIUS_WORLD = 2.1;
const BIG_BASE_COLOR = '#3a4a1a';
const BIG_HIGHLIGHT_COLOR = '#5a6a2a';
const NEEDLE_BASE_COLOR = '#1a3a3a';
const NEEDLE_HIGHLIGHT_COLOR = '#2a5a4a';
const EYE_COLOR = '#dbe7c8';
const PUPIL_COLOR = '#0d1610';

function normalize2(x: number, y: number): { x: number; y: number } {
  const len = Math.sqrt(x * x + y * y);
  if (len <= 0.0001) return { x: 1, y: 0 };
  return { x: x / len, y: y / len };
}

export function renderSnakes(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  _isDebugMode: boolean,
): void {
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;
    if (cluster.isWallSnakeFlag !== 1 && cluster.isNeedleSnakeFlag !== 1) continue;

    const segments = getSnakeSegments(cluster.entityId);
    if (segments === undefined || segments.count <= 0) continue;

    const isBigSnake = cluster.isWallSnakeFlag === 1;
    const baseRadiusWorld = isBigSnake ? BIG_BASE_RADIUS_WORLD : NEEDLE_BASE_RADIUS_WORLD;
    const baseColor = isBigSnake ? BIG_BASE_COLOR : NEEDLE_BASE_COLOR;
    const highlightColor = isBigSnake ? BIG_HIGHLIGHT_COLOR : NEEDLE_HIGHLIGHT_COLOR;
    const renderOffsetXWorld = cluster.renderPositionXWorld - cluster.positionXWorld;
    const renderOffsetYWorld = cluster.renderPositionYWorld - cluster.positionYWorld;

    for (let i = segments.count - 1; i >= 0; i--) {
      const prevIndex = i > 0 ? i - 1 : i;
      const nextIndex = i + 1 < segments.count ? i + 1 : i;
      const tangent = normalize2(
        segments.xs[prevIndex] - segments.xs[nextIndex],
        segments.ys[prevIndex] - segments.ys[nextIndex],
      );
      const perpX = -tangent.y;
      const perpY = tangent.x;
      const taper = 1.0 - (i / segments.count) * 0.6;
      const waveAmplitudeWorld = (isBigSnake ? 1.3 : 0.9) * (1.0 - i / (segments.count + 2));
      const waveOffsetWorld = Math.sin(cluster.snakeSlitherPhaseRad - i * 0.72) * waveAmplitudeWorld;
      const drawXWorld = segments.xs[i] + renderOffsetXWorld + perpX * waveOffsetWorld;
      const drawYWorld = segments.ys[i] + renderOffsetYWorld + perpY * waveOffsetWorld;
      const screenX = Math.round(drawXWorld * zoom + offsetXPx);
      const screenY = Math.round(drawYWorld * zoom + offsetYPx);
      const radiusPx = Math.max(1.0, baseRadiusWorld * taper * zoom);

      ctx.beginPath();
      ctx.arc(screenX, screenY, radiusPx, 0, Math.PI * 2);
      ctx.fillStyle = i % 3 === 0 ? highlightColor : baseColor;
      ctx.fill();

      if (radiusPx > 2.0) {
        ctx.beginPath();
        ctx.arc(screenX - radiusPx * 0.2, screenY - radiusPx * 0.25, Math.max(1.0, radiusPx * 0.28), 0, Math.PI * 2);
        ctx.fillStyle = highlightColor;
        ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    }

    const headBaseXWorld = segments.xs[0] + renderOffsetXWorld;
    const headBaseYWorld = segments.ys[0] + renderOffsetYWorld;
    const headDir = normalize2(cluster.snakeHeadDirXWorld, cluster.snakeHeadDirYWorld);
    const headPerpX = -headDir.y;
    const headPerpY = headDir.x;
    const headWaveWorld = Math.sin(cluster.snakeSlitherPhaseRad) * (isBigSnake ? 1.4 : 0.9);
    const headXWorld = headBaseXWorld + headPerpX * headWaveWorld;
    const headYWorld = headBaseYWorld + headPerpY * headWaveWorld;
    const headXPx = Math.round(headXWorld * zoom + offsetXPx);
    const headYPx = Math.round(headYWorld * zoom + offsetYPx);
    const headAngleRad = Math.atan2(headDir.y, headDir.x);
    const headRadiusPx = Math.max(1.0, baseRadiusWorld * (isBigSnake ? 1.35 : 1.25) * zoom);

    ctx.save();
    ctx.translate(headXPx, headYPx);
    ctx.rotate(headAngleRad);
    ctx.scale(isBigSnake ? 1.28 : 1.5, 1.0);
    ctx.beginPath();
    ctx.arc(0, 0, headRadiusPx, 0, Math.PI * 2);
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-headRadiusPx * 0.2, -headRadiusPx * 0.28, headRadiusPx * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = highlightColor;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.restore();

    const eyeOffsetForwardPx = headRadiusPx * 0.42;
    const eyeOffsetSidePx = headRadiusPx * 0.34;
    const eyeRadiusPx = Math.max(1.0, headRadiusPx * 0.18);
    const pupilRadiusPx = Math.max(0.8, eyeRadiusPx * 0.55);
    const eyeCenterAX = headXPx + headDir.x * eyeOffsetForwardPx + headPerpX * eyeOffsetSidePx;
    const eyeCenterAY = headYPx + headDir.y * eyeOffsetForwardPx + headPerpY * eyeOffsetSidePx;
    const eyeCenterBX = headXPx + headDir.x * eyeOffsetForwardPx - headPerpX * eyeOffsetSidePx;
    const eyeCenterBY = headYPx + headDir.y * eyeOffsetForwardPx - headPerpY * eyeOffsetSidePx;

    ctx.beginPath();
    ctx.arc(eyeCenterAX, eyeCenterAY, eyeRadiusPx, 0, Math.PI * 2);
    ctx.arc(eyeCenterBX, eyeCenterBY, eyeRadiusPx, 0, Math.PI * 2);
    ctx.fillStyle = EYE_COLOR;
    ctx.fill();

    const pupilOffsetPx = eyeRadiusPx * 0.18;
    ctx.beginPath();
    ctx.arc(eyeCenterAX + headDir.x * pupilOffsetPx, eyeCenterAY + headDir.y * pupilOffsetPx, pupilRadiusPx, 0, Math.PI * 2);
    ctx.arc(eyeCenterBX + headDir.x * pupilOffsetPx, eyeCenterBY + headDir.y * pupilOffsetPx, pupilRadiusPx, 0, Math.PI * 2);
    ctx.fillStyle = PUPIL_COLOR;
    ctx.fill();
  }
}
