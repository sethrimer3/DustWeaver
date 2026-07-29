/**
 * workshopCampaignLoader.ts — maps an installed Steam Workshop item into the
 * existing `CampaignSource` abstraction so it can be played through exactly
 * the same flow as a local custom campaign (`onPlayCustomCampaign` in
 * `mainMenuCustomCampaigns.ts` / `game.ts`'s `customCampaignPlay` navigation).
 *
 * This intentionally does not introduce a second gameplay-loading path: the
 * returned `CampaignSource.loadPackedCampaign` is the same field the packed
 * and browser-imported campaign sources already use in
 * `../levels/campaignSource.ts`.
 */
import type { CampaignSource } from '../levels/campaignSource';
import { isSavedCampaignV1, validateSavedCampaignTopLevel } from '../levels/campaignSchema';
import { validateWorkshopPackage } from './packageValidator';
import { getWorkshopAdapter } from './index';
import type { WorkshopItem } from './types';

export type WorkshopCampaignLoadFailureReason =
  | 'not-installed'
  | 'missing-path'
  | 'read-failed'
  | 'invalid-package';

export type WorkshopCampaignLoadResult =
  | { ok: true; source: CampaignSource }
  | { ok: false; reason: WorkshopCampaignLoadFailureReason; message: string };

/**
 * Validates and converts an installed Workshop item into a playable
 * `CampaignSource`. Never throws — every failure mode (not yet downloaded,
 * missing install path, unreadable package, malformed/incompatible content,
 * or the item having been removed between listing and this call) is
 * reported as a typed failure result so the caller can show a localized
 * error and keep the menu usable.
 */
export async function loadCampaignSourceForWorkshopItem(item: WorkshopItem): Promise<WorkshopCampaignLoadResult> {
  if (!item.installed) {
    return {
      ok: false,
      reason: 'not-installed',
      message: `"${item.title}" is still downloading and is not installed yet.`,
    };
  }
  if (!item.localPath) {
    return {
      ok: false,
      reason: 'missing-path',
      message: `"${item.title}" has no installation path available.`,
    };
  }

  const adapter = getWorkshopAdapter();
  let raw;
  try {
    raw = await adapter.readInstalledPackage(item.localPath);
  } catch (e) {
    return {
      ok: false,
      reason: 'read-failed',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const validation = validateWorkshopPackage(raw.manifest, raw.campaignData, raw.files);
  if (!validation.valid) {
    return { ok: false, reason: 'invalid-package', message: validation.errors.join('; ') };
  }

  const topLevelErrors = validateSavedCampaignTopLevel(raw.campaignData);
  if (topLevelErrors.length > 0 || !isSavedCampaignV1(raw.campaignData)) {
    return {
      ok: false,
      reason: 'invalid-package',
      message: topLevelErrors.length > 0 ? topLevelErrors.join('; ') : 'Campaign data has an unexpected shape.',
    };
  }

  const campaign = raw.campaignData;

  const source: CampaignSource = {
    id: campaign.campaign.id,
    title: campaign.campaign.title,
    creator: campaign.campaign.creator,
    description: campaign.campaign.description,
    sourceKind: 'workshop-campaign',
    initialRoomId: campaign.campaign.initialRoomId,
    initialRoomImagePath: campaign.campaign.initialRoomImagePath,
    loadPackedCampaign: async () => campaign,
  };

  return { ok: true, source };
}
