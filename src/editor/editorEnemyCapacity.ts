import { MAX_SHADOW_ENEMIES } from '../sim/clusters/shadowEnemyConfig';
import { MAX_NEEDLE_URCHINS } from '../sim/clusters/needleUrchinConfig';

interface LimitedEnemyFlags {
  readonly isShadowEnemyFlag?: 0 | 1;
  readonly isNeedleUrchinFlag?: 0 | 1;
}

export function canAddLimitedEnemy(
  room: { readonly enemies: readonly LimitedEnemyFlags[] },
  enemyType: 'shadow' | 'needleUrchin',
): boolean {
  const limit = enemyType === 'shadow' ? MAX_SHADOW_ENEMIES : MAX_NEEDLE_URCHINS;
  let count = 0;
  for (const enemy of room.enemies) {
    const matches = enemyType === 'shadow'
      ? enemy.isShadowEnemyFlag === 1
      : enemy.isNeedleUrchinFlag === 1;
    if (matches) {
      count++;
    }
  }
  return count < limit;
}
