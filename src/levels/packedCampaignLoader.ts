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
import { validateSavedCampaignTopLevel, isSavedCampaignV1 } from './campaignSchema';

const BASE = import.meta.env.BASE_URL;

// ── Official campaign constants ───────────────────────────────────────────────

/**
 * Stable canonical file path for the official DustWeaver campaign.
 *
 * Runtime loading uses this path directly (no folder scanning). The editor
 * exports directly as `DustweaverCampaign.dwcampaign.json` — no renaming needed.
 *
 * Served URL: `${BASE}CAMPAIGNS/DUSTWEAVER_CAMPAIGN/DustweaverCampaign.dwcampaign.json`
 */
const OFFICIAL_CAMPAIGN_FILE_PATH =
  '/ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/DustweaverCampaign.dwcampaign.json';

const OFFICIAL_CAMPAIGN_ID = 'DUSTWEAVER_CAMPAIGN' as const;

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
    const parseStartMs = import.meta.env.DEV ? performance.now() : 0;
    const data: unknown = await response.json();
    if (import.meta.env.DEV) {
      console.log(`[campaignPerf] campaign JSON parse (${filePath}): ${(performance.now() - parseStartMs).toFixed(2)}ms`);
    }
    const validationStartMs = import.meta.env.DEV ? performance.now() : 0;
    const validationErrors = validateSavedCampaignTopLevel(data);
    if (import.meta.env.DEV) {
      console.log(`[campaignPerf] campaign validation (${filePath}): ${(performance.now() - validationStartMs).toFixed(2)}ms`);
    }
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
    const parseStartMs = import.meta.env.DEV ? performance.now() : 0;
    data = JSON.parse(jsonText) as unknown;
    if (import.meta.env.DEV) {
      console.log(`[campaignPerf] campaign JSON parse (browser import): ${(performance.now() - parseStartMs).toFixed(2)}ms`);
    }
  } catch (e) {
    return { campaign: null, errors: [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const validationStartMs = import.meta.env.DEV ? performance.now() : 0;
  const errors = validateSavedCampaignTopLevel(data);
  if (import.meta.env.DEV) {
    console.log(`[campaignPerf] campaign validation (browser import): ${(performance.now() - validationStartMs).toFixed(2)}ms`);
  }
  if (errors.length > 0) {
    return { campaign: null, errors };
  }
  if (!isSavedCampaignV1(data)) {
    return { campaign: null, errors: ['Unexpected schema shape after validation'] };
  }
  return { campaign: data, errors: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFICIAL CAMPAIGN LOADER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the official DustWeaver campaign from its stable canonical path:
 * `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/DustweaverCampaign.dwcampaign.json`
 *
 * Validates structure and required fields. Returns null (with a console error)
 * if the file is missing, unreachable, or fails validation. Does NOT throw.
 *
 * The campaign id `DUSTWEAVER_CAMPAIGN` intentionally uses uppercase, which is
 * valid in the schema (see `CAMPAIGN_ID_SAFE_RE`).
 */
export async function fetchOfficialPackedCampaign(): Promise<SavedCampaignV1 | null> {
  const servePath = OFFICIAL_CAMPAIGN_FILE_PATH.replace(/^\/ASSETS\//, '');
  const url = `${BASE}${servePath}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        console.warn(
          `[packedCampaignLoader] Official campaign file not found at "${url}". ` +
          'Export the campaign from the editor and place it at ' +
          'ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/DustweaverCampaign.dwcampaign.json'
        );
      } else {
        console.error(
          `[packedCampaignLoader] Failed to fetch official campaign from "${url}": ` +
          `${response.status} ${response.statusText}`
        );
      }
      return null;
    }
    const parseStartMs = import.meta.env.DEV ? performance.now() : 0;
    const data: unknown = await response.json();
    if (import.meta.env.DEV) {
      console.log(`[campaignPerf] campaign JSON parse (official): ${(performance.now() - parseStartMs).toFixed(2)}ms`);
    }
    const validationStartMs = import.meta.env.DEV ? performance.now() : 0;
    const validationErrors = validateSavedCampaignTopLevel(data);
    if (import.meta.env.DEV) {
      console.log(`[campaignPerf] campaign validation (official): ${(performance.now() - validationStartMs).toFixed(2)}ms`);
    }
    if (validationErrors.length > 0) {
      console.error(
        `[packedCampaignLoader] Official campaign file at "${url}" failed validation:`,
        validationErrors,
      );
      return null;
    }
    if (!isSavedCampaignV1(data)) {
      console.error(
        `[packedCampaignLoader] Official campaign file at "${url}" has unexpected schema shape after validation.`
      );
      return null;
    }
    if (data.campaign.id !== OFFICIAL_CAMPAIGN_ID) {
      console.warn(
        `[packedCampaignLoader] Official campaign file has unexpected id ` +
        `"${data.campaign.id}" (expected "${OFFICIAL_CAMPAIGN_ID}"). Loading anyway.`
      );
    }
    return data;
  } catch (e) {
    console.error(`[packedCampaignLoader] Error loading official campaign from "${url}":`, e);
    return null;
  }
}
