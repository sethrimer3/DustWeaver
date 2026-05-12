/**
 * Campaign source abstraction.
 *
 * The Custom Campaigns UI and editor consume `CampaignSource` objects rather
 * than knowing whether a campaign comes from a folder, a packed JSON file,
 * browser storage, or (in a future Steam build) a user-writable folder.
 *
 * Currently implemented source kinds:
 *   - bundled-folder-campaign:   ASSETS/CAMPAIGNS/<ID>/ + manifest.json
 *   - bundled-packed-campaign:   ASSETS/CAMPAIGNS/CUSTOM/<id>.dwcampaign.json
 *   - imported-browser-campaign: user-imported via file picker, stored in localStorage
 *
 * Placeholder (not implemented):
 *   - external-folder-campaign:  future Steam/native CustomCampaigns/ folder
 */

import type { CampaignMeta } from './campaigns';
import { loadCampaignManifest, MAIN_CAMPAIGN_ID, toCampaignAssetPath, setActiveCampaignId } from './campaigns';
import type { SavedCampaignV1 } from './campaignSchema';
import { loadPackedCampaignManifest, fetchPackedCampaignFromPath, listPackedCampaignPaths, parsePackedCampaignFromJson } from './packedCampaignLoader';
import { loadRoomJsonFiles } from './roomJsonLoader';
import type { RoomDef } from './roomDef';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CampaignSourceKind =
  | 'bundled-folder-campaign'
  | 'bundled-packed-campaign'
  | 'imported-browser-campaign'
  /** Placeholder for future Steam/native filesystem scanning. Not yet implemented. */
  | 'external-folder-campaign';

/**
 * Unified campaign descriptor used by the Custom Campaigns UI and game loader.
 * The UI does not need to know which kind of source a campaign comes from.
 */
export interface CampaignSource {
  id: string;
  title: string;
  creator: string;
  description: string;
  sourceKind: CampaignSourceKind;
  initialRoomId: string;
  initialRoomImagePath?: string | null;
  /** Present for packed (single-file) campaigns. */
  loadPackedCampaign?: () => Promise<SavedCampaignV1>;
  /** Present for folder-based campaigns. */
  loadFolderCampaign?: () => Promise<Map<string, RoomDef>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILDER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function campaignMetaToCampaignSource(meta: CampaignMeta): CampaignSource {
  return {
    id: meta.id,
    title: meta.title,
    creator: meta.creator,
    description: meta.description,
    sourceKind: 'bundled-folder-campaign',
    initialRoomId: meta.initialRoomId,
    initialRoomImagePath: meta.initialRoomImagePath !== null
      ? toCampaignAssetPath(meta.folderName, meta.initialRoomImagePath)
      : null,
    loadFolderCampaign: async () => {
      setActiveCampaignId(meta.id);
      return loadRoomJsonFiles();
    },
  };
}

function packedCampaignV1ToCampaignSource(
  campaign: SavedCampaignV1,
  filePath: string,
): CampaignSource {
  return {
    id: campaign.campaign.id,
    title: campaign.campaign.title,
    creator: campaign.campaign.creator,
    description: campaign.campaign.description,
    sourceKind: 'bundled-packed-campaign',
    initialRoomId: campaign.campaign.initialRoomId,
    initialRoomImagePath: campaign.campaign.initialRoomImagePath,
    loadPackedCampaign: () => fetchPackedCampaignFromPath(filePath).then(c => {
      if (c === null) throw new Error(`Failed to load packed campaign from ${filePath}`);
      return c;
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER-IMPORTED CAMPAIGNS (localStorage)
// ─────────────────────────────────────────────────────────────────────────────

const BROWSER_IMPORT_KEY_PREFIX = 'dw_imported_campaign_';

/** Saves a validated campaign to localStorage. */
export function saveBrowserImportedCampaign(campaign: SavedCampaignV1): void {
  const key = `${BROWSER_IMPORT_KEY_PREFIX}${campaign.campaign.id}`;
  try {
    localStorage.setItem(key, JSON.stringify(campaign));
  } catch (e) {
    console.error('[campaignSource] Failed to save imported campaign to localStorage:', e);
  }
}

/** Deletes an imported campaign from localStorage. */
export function deleteBrowserImportedCampaign(campaignId: string): void {
  const key = `${BROWSER_IMPORT_KEY_PREFIX}${campaignId}`;
  localStorage.removeItem(key);
}

/** Lists all browser-imported campaigns from localStorage. */
export function listBrowserImportedCampaigns(): SavedCampaignV1[] {
  const result: SavedCampaignV1[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(BROWSER_IMPORT_KEY_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const { campaign, errors } = parsePackedCampaignFromJson(raw);
      if (campaign !== null) {
        result.push(campaign);
      } else {
        console.warn(`[campaignSource] Skipping invalid imported campaign at "${key}":`, errors);
      }
    }
  } catch {
    // localStorage may be unavailable in some contexts.
  }
  return result;
}

function browserImportedCampaignToSource(campaign: SavedCampaignV1): CampaignSource {
  return {
    id: campaign.campaign.id,
    title: campaign.campaign.title,
    creator: campaign.campaign.creator,
    description: campaign.campaign.description,
    sourceKind: 'imported-browser-campaign',
    initialRoomId: campaign.campaign.initialRoomId,
    initialRoomImagePath: campaign.campaign.initialRoomImagePath,
    loadPackedCampaign: async () => campaign,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATE LISTING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all available custom campaign sources from all implemented source kinds.
 * Main campaign is excluded. Deduplication by id keeps the first occurrence.
 */
export async function listAllCampaignSources(): Promise<CampaignSource[]> {
  const sources: CampaignSource[] = [];
  const seenIds = new Set<string>();

  const add = (source: CampaignSource): void => {
    if (seenIds.has(source.id)) return;
    seenIds.add(source.id);
    sources.push(source);
  };

  // 1. Folder-based campaigns (CAMPAIGNS/manifest.json).
  try {
    const folderCampaigns = await loadCampaignManifest();
    for (const meta of folderCampaigns) {
      if (meta.folderName === MAIN_CAMPAIGN_ID || meta.id === MAIN_CAMPAIGN_ID) continue;
      add(campaignMetaToCampaignSource(meta));
    }
  } catch (e) {
    console.error('[campaignSource] Failed to load folder campaign manifest:', e);
  }

  // 2. Bundled packed campaigns (ASSETS/CAMPAIGNS/CUSTOM/*.dwcampaign.json).
  try {
    const summaries = listPackedCampaignPaths();
    await Promise.all(summaries.map(async ({ filePath }) => {
      const campaign = await fetchPackedCampaignFromPath(filePath);
      if (campaign !== null) {
        add(packedCampaignV1ToCampaignSource(campaign, filePath));
      }
    }));
  } catch (e) {
    console.error('[campaignSource] Failed to load packed campaigns:', e);
  }

  // 3. Browser-imported campaigns.
  try {
    for (const campaign of listBrowserImportedCampaigns()) {
      add(browserImportedCampaignToSource(campaign));
    }
  } catch (e) {
    console.error('[campaignSource] Failed to list browser-imported campaigns:', e);
  }

  // 4. external-folder-campaign: TODO — future Steam/native build.

  return sources;
}

// Re-export for convenience
export { loadPackedCampaignManifest };
