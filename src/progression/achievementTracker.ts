/**
 * Stateless achievement-trigger checks. Each `on*` function inspects the
 * relevant game state and unlocks the matching achievement via the active
 * `PlatformAdapter` when the condition is met. Unlocking is idempotent
 * (safe to call repeatedly — Steam ignores repeat unlocks, the fake
 * adapter no-ops on an already-unlocked ID).
 */
import { getPlatformAdapter } from '../platform';

const MOTE_HOARDER_THRESHOLD = 40;

/** Called when a room is cleared. Unlocks FIRST_CLEAR on the player's first clear. */
export function onRoomCleared(): void {
  void getPlatformAdapter().unlockAchievement('FIRST_CLEAR');
}

/** Called when the player equips a weave for the first time. Unlocks FIRST_WEAVE. */
export function onWeaveEquipped(): void {
  void getPlatformAdapter().unlockAchievement('FIRST_WEAVE');
}

/**
 * Called whenever the player's canonical (non-decaying) mote count changes.
 * Unlocks MOTE_HOARDER once the count reaches the threshold.
 */
export function onMoteCountChanged(canonicalMoteCount: number): void {
  if (canonicalMoteCount >= MOTE_HOARDER_THRESHOLD) {
    void getPlatformAdapter().unlockAchievement('MOTE_HOARDER');
  }
}

/** Called when a room is cleared in under 30 seconds. Unlocks SPEED_RUNNER. */
export function onRoomClearedUnderTime(elapsedMs: number): void {
  if (elapsedMs < 30_000) {
    void getPlatformAdapter().unlockAchievement('SPEED_RUNNER');
  }
}

/** Called when a room is cleared without the player taking damage. Unlocks NO_HIT_ROOM. */
export function onRoomClearedNoHit(tookDamage: boolean): void {
  if (!tookDamage) {
    void getPlatformAdapter().unlockAchievement('NO_HIT_ROOM');
  }
}

/** Called when 3+ enemies are frozen by a single Ice Mote cast. Unlocks ICE_FREEZE_CHAIN. */
export function onIceFreezeChain(frozenCount: number): void {
  if (frozenCount >= 3) {
    void getPlatformAdapter().unlockAchievement('ICE_FREEZE_CHAIN');
  }
}

/** Called when Stormweave reaches its max rank. Unlocks STORMWEAVE_MASTER. */
export function onStormweaveMaxRank(): void {
  void getPlatformAdapter().unlockAchievement('STORMWEAVE_MASTER');
}

/** Called when the base campaign is completed. Unlocks DUSTWEAVER_COMPLETE. */
export function onCampaignCompleted(): void {
  void getPlatformAdapter().unlockAchievement('DUSTWEAVER_COMPLETE');
}

/** Called after a successful Workshop publish. Unlocks WORKSHOP_AUTHOR. */
export function onWorkshopPublished(): void {
  void getPlatformAdapter().unlockAchievement('WORKSHOP_AUTHOR');
}

/** Called after subscribing to a Workshop item. Unlocks WORKSHOP_SUBSCRIBER. */
export function onWorkshopSubscribed(): void {
  void getPlatformAdapter().unlockAchievement('WORKSHOP_SUBSCRIBER');
}
