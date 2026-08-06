/**
 * publishedItemRegistry.ts — remembers which Steam Workshop item each local
 * campaign was published as.
 *
 * Without this, every publish would call `createItem` again and scatter
 * duplicate entries across the author's Workshop page. Storing the mapping
 * locally lets a second publish of the same campaign become an *update* of the
 * existing item, which is what authors expect from a "Publish" button they
 * press after fixing a room.
 *
 * Steam is the source of truth for the item itself; this is only a convenience
 * cache. If it is lost (new machine, cleared storage), the author can still
 * relink by entering the item ID in the publish dialog.
 */

const STORAGE_KEY = 'dustweaver.workshop.publishedItems.v1';

type RegistryShape = Record<string, string>;

function readRegistry(): RegistryShape {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: RegistryShape = {};
    for (const [campaignId, itemId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof itemId === 'string' && itemId.length > 0) result[campaignId] = itemId;
    }
    return result;
  } catch {
    // Corrupt or unavailable storage just means "no known mapping".
    return {};
  }
}

function writeRegistry(registry: RegistryShape): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // Quota/private-mode failures must not break a successful publish.
  }
}

/** Returns the Workshop item ID this campaign was last published as, if any. */
export function getPublishedItemId(campaignId: string): string | null {
  return readRegistry()[campaignId] ?? null;
}

/** Records that `campaignId` is published as Workshop item `steamPublishedFileId`. */
export function setPublishedItemId(campaignId: string, steamPublishedFileId: string): void {
  const registry = readRegistry();
  registry[campaignId] = steamPublishedFileId;
  writeRegistry(registry);
}

/** Forgets the mapping for `campaignId`, so the next publish creates a new item. */
export function clearPublishedItemId(campaignId: string): void {
  const registry = readRegistry();
  delete registry[campaignId];
  writeRegistry(registry);
}
