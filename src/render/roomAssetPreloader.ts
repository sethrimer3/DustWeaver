/**
 * roomAssetPreloader.ts — Proactive sprite preloading for block themes.
 *
 * Calling preloadRoomThemeSprites() immediately after a room is entered (or
 * at campaign start) fires loadImg() for every sprite URL associated with that
 * room's block themes.  Because loadImg() is already a singleton cache, there
 * is no cost to calling it on a URL that was already requested — it simply
 * returns the cached element.
 *
 * preloadAdjacentRoomAssets() extends this to all rooms directly connected to
 * `room` through door transitions.  It is called after every loadRoom() so
 * that the next room's sprites are in flight while the player is still walking
 * through the current room.
 *
 * areRoomSpritesReady() checks whether all folder-based sprites for a room
 * have finished loading.  It is used by the loading overlay in gameScreen.ts
 * to decide when it is safe to show the game world.
 *
 * Note: only folder-based themes (e.g. 'grayStone', 'blackRock') are tracked
 * here.  Legacy world-number sprites (world 0–9 block/edge/corner/end sets)
 * begin loading at module-init time in blockSpriteSets.ts and are typically
 * ready within a few hundred milliseconds — they do not need explicit
 * preloading via this module.
 */

import { loadImg, isSpriteReady } from './imageCache';
import { FOLDER_BLOCK_THEMES, isFolderBasedTheme } from './walls/folderBlockThemes';
import type { RoomDef } from '../levels/roomDef';
import { ROOM_REGISTRY } from '../levels/rooms';

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Returns the sprite16Urls array for `themeId`, or null when the theme is not
 * found in the folder-based catalogue.
 */
function _getSpriteUrls(themeId: string): readonly string[] | null {
  for (const td of FOLDER_BLOCK_THEMES) {
    if (td.id === themeId) return td.sprite16Urls;
  }
  return null;
}

/**
 * Collects the set of unique folder-based block theme IDs used in `room`.
 * Includes both the room-level default theme and per-wall overrides.
 */
function _collectFolderThemeIds(room: RoomDef): Set<string> {
  const ids = new Set<string>();
  if (room.blockTheme && isFolderBasedTheme(room.blockTheme)) {
    ids.add(room.blockTheme);
  }
  for (const wall of room.walls) {
    if (wall.blockTheme && isFolderBasedTheme(wall.blockTheme)) {
      ids.add(wall.blockTheme);
    }
  }
  return ids;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Triggers asynchronous loading of all block-sprite images for `room`.
 *
 * Safe to call multiple times — loadImg() is idempotent (returns the cached
 * element on repeat calls).  The actual network requests are de-duplicated by
 * the imageCache module.
 *
 * Should be called:
 *  - Once during campaign start for the spawn room.
 *  - Once per room entry (before or after loadRoom()).
 */
export function preloadRoomThemeSprites(room: RoomDef): void {
  const themeIds = _collectFolderThemeIds(room);
  for (const themeId of themeIds) {
    const urls = _getSpriteUrls(themeId);
    if (urls === null) continue;
    for (let i = 0; i < urls.length; i++) {
      loadImg(urls[i]); // fire-and-forget; already cached if loaded before
    }
  }
}

/**
 * Triggers sprite loading for every room directly connected to `room` by a
 * door transition.
 *
 * Call this after each room load so the next room's sprites are in flight
 * while the player is still playing the current room.  For a typical
 * campaign room (2–5 connections, 5–15 sprites each) this fires ≤75 loadImg()
 * calls — all idempotent and near-zero cost for already-cached images.
 */
export function preloadAdjacentRoomAssets(room: RoomDef): void {
  for (let ti = 0; ti < room.transitions.length; ti++) {
    const adjacent = ROOM_REGISTRY.get(room.transitions[ti].targetRoomId);
    if (adjacent !== undefined) {
      preloadRoomThemeSprites(adjacent);
    }
  }
}

/**
 * Triggers sprite loading for all rooms within `radius` hops of `room`.
 *
 * Performs a BFS through `RoomDef.transitions` so that image assets for
 * rooms 1–2 hops away are in the browser's image cache before the player
 * reaches them.  All `loadImg()` calls are idempotent and near-zero cost for
 * URLs already in the cache.
 *
 * BUILD 357: Replaces the direct-adjacent-only `preloadAdjacentRoomAssets`
 * for multi-room preloading in the preload scheduler.
 */
export function preloadNearbyRoomAssets(room: RoomDef, radius: number): void {
  const visited = new Set<string>([room.id]);
  const queue: Array<[RoomDef, number]> = [[room, 0]];

  while (queue.length > 0) {
    const [current, depth] = queue.shift()!;
    if (depth >= radius) continue;
    for (let ti = 0; ti < current.transitions.length; ti++) {
      const targetId = current.transitions[ti].targetRoomId;
      if (visited.has(targetId)) continue;
      visited.add(targetId);
      const neighbor = ROOM_REGISTRY.get(targetId);
      if (neighbor !== undefined) {
        preloadRoomThemeSprites(neighbor);
        queue.push([neighbor, depth + 1]);
      }
    }
  }
}

/**
 * Returns true when every folder-based block-theme sprite required by `room`
 * has fully loaded (img.complete && img.naturalWidth > 0).
 *
 * Used by the loading overlay in gameScreen.ts to decide when it is safe to
 * dismiss the "Loading…" screen.
 *
 * Returns true immediately for rooms that use only legacy / world-number
 * sprites (no folder-based themes), because legacy sprites begin loading at
 * module-init time and this function has no way to check them.
 */
export function areRoomSpritesReady(room: RoomDef): boolean {
  const themeIds = _collectFolderThemeIds(room);
  for (const themeId of themeIds) {
    const urls = _getSpriteUrls(themeId);
    if (urls === null) continue;
    for (let i = 0; i < urls.length; i++) {
      const img = loadImg(urls[i]);
      if (!isSpriteReady(img)) return false;
    }
  }
  return true;
}
