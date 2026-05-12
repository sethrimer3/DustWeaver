/**
 * Packed campaign discovery and loading.
 *
 * Any `.dwcampaign.json` files committed to ASSETS/CAMPAIGNS/CUSTOM/ are
 * automatically discovered at build time via import.meta.glob and made
 * available here without any manual manifest step.
 *
 * This module is the GitHub Pages / bundled-packed-campaign implementation.
 * For a future Steam/native build the same interface would be satisfied by a
 * filesystem-scanning implementation — see campaignSource.ts for the
 * abstraction that keeps the UI source-agnostic.
 */

import type { CampaignMeta } from './campaigns';
import type { SavedCampaignV1 } from './campaignSchema';
import { validateSavedCampaign, isSavedCampaignV1 } from './campaignSchema';

const BASE = import.meta.env.BASE_URL;

// ── Build-time glob: discovers committed .dwcampaign.json files ──────────────

/**
 * Vite discovers these file paths at build time. Each key is a project-relative
 * path like `/ASSETS/CAMPAIGNS/CUSTOM/my_campaign.dwcampaign.json`; the value
 * is a lazy loader that resolves the file's URL when called.
 */
const DISCOVERED_PACKED_CAMPAIGN_LOADERS = import.meta.glob<string>(
  '/ASSETS/CAMPAIGNS/CUSTOM/*.dwcampaign.json',
  { query: '?url', import: 'default' },
);

/** All project-relative paths discovered at build time. */
const DISCOVERED_PACKED_CAMPAIGN_PATHS = Object.keys(DISCOVERED_PACKED_CAMPAIGN_LOADERS);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Extracts a campaign id from a file path like `/ASSETS/CAMPAIGNS/CUSTOM/my_campaign.dwcampaign.json`. */
function campaignIdFromPath(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  const filename = normalised.split('/').pop() ?? '';
  return filename.replace(/\.dwcampaign\.json$/, '');
}

/** Summary info from a packed campaign file, suitable for listing. */
export interface PackedCampaignSummary {
  id: string;
  filePath: string;
}

/** Lists all .dwcampaign.json file paths discovered at build time. */
export function listPackedCampaignPaths(): PackedCampaignSummary[] {
  return DISCOVERED_PACKED_CAMPAIGN_PATHS.map(filePath => ({
    id: campaignIdFromPath(filePath),
    filePath,
  }));
}

/**
 * Fetches and parses a packed campaign file by its project-relative path.
 * Returns null and logs an error if the file cannot be fetched or is invalid.
 */
export async function fetchPackedCampaignFromPath(filePath: string): Promise<SavedCampaignV1 | null> {
  try {
    // Convert project-relative path to a URL the browser can fetch.
    // /ASSETS/CAMPAIGNS/CUSTOM/foo.dwcampaign.json
    // → <BASE>CAMPAIGNS/CUSTOM/foo.dwcampaign.json
    const servePath = filePath.replace(/^\/ASSETS\//, '');
    const url = `${BASE}${servePath}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[packedCampaignLoader] Failed to fetch "${url}": ${response.status} ${response.statusText}`);
      return null;
    }
    const data: unknown = await response.json();
    const validationErrors = validateSavedCampaign(data);
    if (validationErrors.length > 0) {
      console.error(`[packedCampaignLoader] Campaign at "${url}" failed validation:`, validationErrors);
      return null;
    }
    return data as SavedCampaignV1;
  } catch (e) {
    console.error(`[packedCampaignLoader] Error loading packed campaign from "${filePath}":`, e);
    return null;
  }
}

/**
 * Returns a CampaignMeta[] for all valid packed campaigns discovered at build
 * time. Files that fail to load or validate are silently skipped.
 */
export async function loadPackedCampaignManifest(): Promise<CampaignMeta[]> {
  const summaries = listPackedCampaignPaths();
  const metas: CampaignMeta[] = [];

  await Promise.all(summaries.map(async ({ id, filePath }) => {
    const campaign = await fetchPackedCampaignFromPath(filePath);
    if (campaign === null) return;
    metas.push({
      id: campaign.campaign.id,
      folderName: `CUSTOM/${id}`, // synthetic folder name distinguishing it from folder campaigns
      title: campaign.campaign.title,
      creator: campaign.campaign.creator,
      description: campaign.campaign.description,
      initialRoomId: campaign.campaign.initialRoomId,
      initialRoomImagePath: campaign.campaign.initialRoomImagePath,
    });
  }));

  return metas;
}

/**
 * Loads a specific packed campaign by campaign id. Searches all discovered
 * paths for the matching id. Returns null if not found or invalid.
 */
export async function loadPackedCampaignById(campaignId: string): Promise<SavedCampaignV1 | null> {
  for (const { id, filePath } of listPackedCampaignPaths()) {
    if (id === campaignId) {
      return fetchPackedCampaignFromPath(filePath);
    }
  }
  // Also try matching by campaign metadata id (may differ from file name).
  for (const { filePath } of listPackedCampaignPaths()) {
    const campaign = await fetchPackedCampaignFromPath(filePath);
    if (campaign !== null && campaign.campaign.id === campaignId) {
      return campaign;
    }
  }
  return null;
}

/**
 * Loads a packed campaign from a raw JSON string (e.g. a browser-imported
 * file). Returns null and a list of validation errors if invalid.
 */
export function parsePackedCampaignFromJson(
  jsonText: string,
): { campaign: SavedCampaignV1; errors: string[] } | { campaign: null; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(jsonText) as unknown;
  } catch (e) {
    return { campaign: null, errors: [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const errors = validateSavedCampaign(data);
  if (errors.length > 0) {
    return { campaign: null, errors };
  }
  if (!isSavedCampaignV1(data)) {
    return { campaign: null, errors: ['Unexpected schema shape after validation'] };
  }
  return { campaign: data, errors: [] };
}
