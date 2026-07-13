/**
 * Shared helper for applying CampaignSpawnData starting options to PlayerProgress.
 *
 * Two modes:
 *   'merge'  — official campaign path: container count is merged (never reduced)
 *              into an existing brand-new save profile.
 *   'fresh'  — packed custom-campaign path: container count is assigned exactly
 *              to a freshly created default progress object.
 *
 * Mutates `progress` in place. Does NOT mutate `spawn`.
 */

import { PlayerProgress } from './playerProgress';
import { CampaignSpawnData } from '../levels/campaignSchema';
import { unlockDustType, unlockActiveWeave } from './unlocks';
import { stringToParticleKind } from '../editor/roomJsonSchema';
import { WEAVE_REGISTRY } from '../sim/weaves/weaveDefinition';
import { PLAYER_INITIAL_HEALTH } from '../screens/gameSpawn';

export type CampaignStartingOptionsMode = 'merge' | 'fresh';

export function applyCampaignStartingOptions(
  progress: PlayerProgress,
  spawn: CampaignSpawnData,
  mode: CampaignStartingOptionsMode,
): void {
  if (spawn.startingHealth !== undefined) {
    progress.startingHealth = Math.max(1, Math.min(spawn.startingHealth, PLAYER_INITIAL_HEALTH));
  }

  if (spawn.startingDustContainerCount !== undefined) {
    const normalized = Math.max(0, Math.floor(spawn.startingDustContainerCount));
    if (mode === 'merge') {
      progress.dustContainerCount = Math.max(progress.dustContainerCount, normalized);
    } else {
      progress.dustContainerCount = normalized;
    }
  }

  if (Array.isArray(spawn.startingDustTypes)) {
    for (const name of spawn.startingDustTypes) {
      const kind = stringToParticleKind(name);
      if (kind !== null) unlockDustType(progress, kind);
    }
  }

  if (Array.isArray(spawn.startingWeaves)) {
    for (const weaveId of spawn.startingWeaves) {
      if (WEAVE_REGISTRY.has(weaveId)) unlockActiveWeave(progress, weaveId);
    }
  }
}
