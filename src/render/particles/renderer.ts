import { WorldSnapshot } from '../snapshot';
import { getParticleStyle } from './styles';

export function renderParticles(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  const { particles } = snapshot;
  const { particleCount, isAliveFlag, positionXWorld, positionYWorld, kindBuffer, ownerEntityId } = particles;

  // Pre-build entityId → isPlayerFlag map to avoid O(n×m) per-particle lookup
  const isPlayerByEntityId = new Map<number, boolean>();
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const c = snapshot.clusters[ci];
    isPlayerByEntityId.set(c.entityId, c.isPlayerFlag === 1);
  }

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    const kind = kindBuffer[i];
    const style = getParticleStyle(kind);

    const screenX = positionXWorld[i] * scalePx + offsetXPx;
    const screenY = positionYWorld[i] * scalePx + offsetYPx;

    const isPlayer = isPlayerByEntityId.get(ownerEntityId[i]) === true;
    const color = isPlayer ? '#00cfff' : '#ff4444';

    ctx.beginPath();
    ctx.arc(screenX, screenY, style.radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}
