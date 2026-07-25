import type { SavedCampaignV1 } from '../levels/campaignSchema';
import type { EditableCampaignSession } from './editableCampaignSession';
import { createSessionFromPackedCampaign } from './editableCampaignSession';

/** Creates the single authoritative editor session owned by an official game. */
export function createOfficialCampaignSession(
  packedCampaign: SavedCampaignV1 | null,
): EditableCampaignSession {
  if (packedCampaign === null) {
    throw new Error(
      'Cannot start the official campaign editor without the complete loaded canonical packed campaign.',
    );
  }
  return createSessionFromPackedCampaign(packedCampaign, 'main');
}
