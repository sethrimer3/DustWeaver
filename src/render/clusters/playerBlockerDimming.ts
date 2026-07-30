import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import type { ClusterSnapshot } from '../clusterSnapshotTypes';

export const PLAYER_BLOCKER_DIM_AMOUNT = 0.4;
export const PLAYER_BLOCKER_DIM_FADE_MS = 200;

const COVERAGE_EPSILON_WORLD = 1e-6;

/**
 * Returns true only when ambient-light blocker cells cover the player's whole
 * axis-aligned gameplay hitbox. Touching a blocker at an edge is not coverage.
 */
export function isPlayerHitboxFullyCoveredByBlockers(
  player: Pick<
    ClusterSnapshot,
    'renderPositionXWorld' | 'renderPositionYWorld' | 'halfWidthWorld' | 'halfHeightWorld'
  >,
  blockerKeys: ReadonlySet<string>,
  blockSizeWorld = BLOCK_SIZE_SMALL,
): boolean {
  if (blockerKeys.size === 0 || blockSizeWorld <= 0) return false;

  const left = player.renderPositionXWorld - player.halfWidthWorld;
  const right = player.renderPositionXWorld + player.halfWidthWorld;
  const top = player.renderPositionYWorld - player.halfHeightWorld;
  const bottom = player.renderPositionYWorld + player.halfHeightWorld;
  if (right <= left || bottom <= top) return false;

  const minCol = Math.floor(left / blockSizeWorld);
  const maxCol = Math.floor((right - COVERAGE_EPSILON_WORLD) / blockSizeWorld);
  const minRow = Math.floor(top / blockSizeWorld);
  const maxRow = Math.floor((bottom - COVERAGE_EPSILON_WORLD) / blockSizeWorld);

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!blockerKeys.has(`${col},${row}`)) return false;
    }
  }
  return true;
}

/** Render-only ease controller. A value of 1 means the full 40% dim is active. */
export class PlayerBlockerDimmingController {
  private initialized = false;
  private transitionStartMs = 0;
  private startAmount = 0;
  private targetAmount = 0;

  update(isFullyCovered: boolean, nowMs: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.transitionStartMs = nowMs;
      this.targetAmount = isFullyCovered ? 1 : 0;
      return 0;
    }

    const currentAmount = this.valueAt(nowMs);
    const nextTarget = isFullyCovered ? 1 : 0;
    if (nextTarget !== this.targetAmount) {
      this.startAmount = currentAmount;
      this.targetAmount = nextTarget;
      this.transitionStartMs = nowMs;
    }
    return currentAmount;
  }

  private valueAt(nowMs: number): number {
    const elapsedMs = Math.max(0, nowMs - this.transitionStartMs);
    const progress = Math.min(1, elapsedMs / PLAYER_BLOCKER_DIM_FADE_MS);
    const easedProgress = progress * progress * (3 - 2 * progress);
    return this.startAmount + (this.targetAmount - this.startAmount) * easedProgress;
  }
}

export function playerBrightnessFromBlockerDimAmount(dimAmount: number): number {
  const clampedAmount = Math.max(0, Math.min(1, dimAmount));
  return 1 - PLAYER_BLOCKER_DIM_AMOUNT * clampedAmount;
}
