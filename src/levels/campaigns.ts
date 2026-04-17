export interface CampaignMeta {
  id: string;
  folderName: string;
  title: string;
  creator: string;
  description: string;
  initialRoomId: string;
  initialRoomImagePath: string | null;
}

const BASE = import.meta.env.BASE_URL;
export const MAIN_CAMPAIGN_ID = 'DUSTWEAVER_CAMPAIGN';
let activeCampaignId = MAIN_CAMPAIGN_ID;

function normalizeCampaignMeta(folderName: string, rawInfo: string): CampaignMeta {
  const lines = rawInfo.split(/\r?\n/);
  const values = new Map<string, string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const value = trimmed.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  const id = values.get('id') ?? folderName;
  return {
    id,
    folderName,
    title: values.get('title') ?? folderName,
    creator: values.get('creator') ?? 'Unknown',
    description: values.get('description') ?? 'No description provided.',
    initialRoomId: values.get('initial_room_id') ?? 'lobby',
    initialRoomImagePath: values.get('initial_room_image') ?? null,
  };
}

async function loadCampaignInfoFile(folderName: string): Promise<CampaignMeta | null> {
  try {
    const response = await fetch(`${BASE}CAMPAIGNS/${folderName}/campaign_info.txt`);
    if (!response.ok) return null;
    const rawInfo = await response.text();
    return normalizeCampaignMeta(folderName, rawInfo);
  } catch {
    return null;
  }
}

export async function loadCampaignManifest(): Promise<CampaignMeta[]> {
  try {
    const response = await fetch(`${BASE}CAMPAIGNS/manifest.json`);
    if (!response.ok) return [];

    const folderNames = await response.json() as string[];
    const metas = await Promise.all(folderNames.map((folderName) => loadCampaignInfoFile(folderName)));

    const campaigns: CampaignMeta[] = [];
    for (const meta of metas) {
      if (meta !== null) campaigns.push(meta);
    }

    return campaigns;
  } catch {
    return [];
  }
}

export function getActiveCampaignId(): string {
  return activeCampaignId;
}

export function setActiveCampaignId(campaignId: string): void {
  activeCampaignId = campaignId;
}

export async function getCampaignById(campaignId: string): Promise<CampaignMeta | null> {
  const campaigns = await loadCampaignManifest();
  for (const campaign of campaigns) {
    if (campaign.id === campaignId || campaign.folderName === campaignId) {
      return campaign;
    }
  }
  return null;
}

export function getCampaignRoomsBasePath(campaignId: string): string {
  return `${BASE}CAMPAIGNS/${campaignId}/ROOMS`;
}

export function getCampaignWorldMapPath(campaignId: string): string {
  return `${BASE}CAMPAIGNS/${campaignId}/worldMap/world-map.json`;
}

export function toCampaignAssetPath(campaignId: string, campaignRelativePath: string): string {
  const sanitizedPath = campaignRelativePath.replace(/^\/+/, '');
  return `${BASE}CAMPAIGNS/${campaignId}/${sanitizedPath}`;
}
