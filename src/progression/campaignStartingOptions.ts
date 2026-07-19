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
import { unlockDustType, unlockActiveWeave, unlockPassiveTechnique } from './unlocks';
import { stringToParticleKind } from '../editor/roomJsonSchema';
import { WEAVE_REGISTRY } from '../sim/weaves/weaveDefinition';
import { PASSIVE_TECHNIQUE_DEFINITIONS, PassiveTechniqueId } from './passiveTechniques';
import { normalizeMoteCount } from '../sim/playerMoteLife';

export type CampaignStartingOptionsMode = 'merge' | 'fresh';

export function applyCampaignStartingOptions(
  progress: PlayerProgress,
  spawn: CampaignSpawnData,
  mode: CampaignStartingOptionsMode,
): void {
  // `startingHealth` is the wire field name (kept for backward-compat with
  // existing saved campaigns) but represents the player's starting dust
  // mote count — no upper cap, and 0 is a legal value. Legacy campaigns
  // authored under the old 1-10 "health" interpretation still load fine
  // since the field name and shape are unchanged.
  if (spawn.startingHealth !== undefined) {
    progress.startingHealth = normalizeMoteCount(spawn.startingHealth);
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

  if (Array.isArray(spawn.startingPassives)) {
    for (const passiveId of spawn.startingPassives) {
      if (PASSIVE_TECHNIQUE_DEFINITIONS.has(passiveId as PassiveTechniqueId)) {
        unlockPassiveTechnique(progress, passiveId as PassiveTechniqueId);
      }
    }
  }
}
