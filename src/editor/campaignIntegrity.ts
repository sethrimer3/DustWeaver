import type { SavedCampaignV1 } from '../levels/campaignSchema';

function collectDuplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter(id => !right.has(id)).sort();
}

export function assertCampaignIntegrity(
  campaign: SavedCampaignV1,
  expectedRoomIds?: ReadonlySet<string>,
  expectedLabel = 'registry',
): void {
  const roomIds = campaign.rooms.map(room => room.id);
  const mapIds = campaign.worldMap.rooms.map(room => room.id);
  const duplicateRoomIds = collectDuplicateIds(roomIds);
  const duplicateMapIds = collectDuplicateIds(mapIds);
  if (duplicateRoomIds.length > 0) {
    throw new Error(`Duplicate campaign room ID(s): ${duplicateRoomIds.join(', ')}`);
  }
  if (duplicateMapIds.length > 0) {
    throw new Error(`Duplicate world-map room ID(s): ${duplicateMapIds.join(', ')}`);
  }

  const roomSet = new Set(roomIds);
  const mapSet = new Set(mapIds);
  const missingPayloads = difference(mapSet, roomSet);
  const missingMapEntries = difference(roomSet, mapSet);
  if (missingPayloads.length > 0 || missingMapEntries.length > 0) {
    const details = [
      missingPayloads.length > 0 ? `world-map IDs without payloads: ${missingPayloads.join(', ')}` : '',
      missingMapEntries.length > 0 ? `payload IDs without world-map entries: ${missingMapEntries.join(', ')}` : '',
    ].filter(Boolean);
    throw new Error(`Campaign room/world-map integrity mismatch (${details.join('; ')})`);
  }

  if (expectedRoomIds !== undefined) {
    const missingFromCampaign = difference(expectedRoomIds, roomSet);
    const missingFromExpected = difference(roomSet, expectedRoomIds);
    if (missingFromCampaign.length > 0 || missingFromExpected.length > 0) {
      const details = [
        missingFromCampaign.length > 0
          ? `${expectedLabel} IDs without campaign payloads: ${missingFromCampaign.join(', ')}`
          : '',
        missingFromExpected.length > 0
          ? `campaign payload IDs absent from ${expectedLabel}: ${missingFromExpected.join(', ')}`
          : '',
      ].filter(Boolean);
      throw new Error(`Campaign/${expectedLabel} integrity mismatch (${details.join('; ')})`);
    }
  }
}
