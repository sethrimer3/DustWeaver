import { WorldSnapshot } from '../snapshot';
import { getParticleStyle } from './styles';

export function renderParticles(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  const { particles } = snapshot;
  const { particleCount, isAliveFlag, positionXWorld, positionYWorld, kindBuffer, ownerEntityId } = particles;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    const kind = kindBuffer[i];
    const style = getParticleStyle(kind);

    const screenX = positionXWorld[i] * scalePx + offsetXPx;
    const screenY = positionYWorld[i] * scalePx + offsetYPx;

    const ownerId = ownerEntityId[i];
    let isPlayer = false;
    for (let ci = 0; ci < snapshot.clusters.length; ci++) {
      if (snapshot.clusters[ci].entityId === ownerId) {
        isPlayer = snapshot.clusters[ci].isPlayerFlag === 1;
        break;
      }
    }
    const color = isPlayer ? '#00cfff' : '#ff4444';

    ctx.beginPath();
    ctx.arc(screenX, screenY, style.radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}
