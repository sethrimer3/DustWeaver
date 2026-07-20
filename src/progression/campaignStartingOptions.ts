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
import { expandLegacyWeaveId } from './weaveMigration';
import { normalizeMoteCount } from '../sim/playerMoteLife';
import { isEquippableParticleKind } from '../sim/particles/kinds';
import { getUnlockedDustKindsInCanonicalOrder } from '../sim/weaves/dustWheelOptions';

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
      if (kind !== null && isEquippableParticleKind(kind)) unlockDustType(progress, kind);
    }
  }

  // Deterministic initial selected dust: if nothing has been chosen yet (or
  // the previous selection is no longer valid), pick the first unlocked kind
  // in canonical order — never dependent on unlock/insertion order.
  if (progress.selectedDustKind === null || !isEquippableParticleKind(progress.selectedDustKind)
      || progress.unlockedDustKinds.indexOf(progress.selectedDustKind) === -1) {
    const canonicalUnlocked = getUnlockedDustKindsInCanonicalOrder(progress);
    if (canonicalUnlocked.length > 0) progress.selectedDustKind = canonicalUnlocked[0];
  }

  if (Array.isArray(spawn.startingWeaves)) {
    for (const weaveId of spawn.startingWeaves) {
      if (!WEAVE_REGISTRY.has(weaveId)) continue;
      // Old campaigns may specify a single mutually-exclusive legacy weave
      // value (e.g. 'shield_sword'). Expand it to the full independent
      // unlock set (sword + shield) rather than granting only the combo id,
      // so Sword/Shield/Bow can be unlocked as independent subsets going
      // forward. Non-legacy ids (storm/shield/arrow) expand to themselves.
      for (const expandedId of expandLegacyWeaveId(weaveId)) {
        unlockActiveWeave(progress, expandedId);
      }
    }
  }

  // `startingPassives` may still be present in older campaign files. It is
  // intentionally ignored: Cycle was retired and replaced by Storm Weave.
}
