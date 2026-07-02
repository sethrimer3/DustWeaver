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

import { loadImg, decodeImg, isSpriteDecodeReady } from './imageCache';
import { FOLDER_BLOCK_THEMES, isFolderBasedTheme } from './walls/folderBlockThemes';
import { decodeSpriteAtlasForTheme, preloadSpriteAtlasForTheme } from './atlases/spriteAtlasLoader';
import type { RoomDef } from '../levels/roomDef';
import { ROOM_REGISTRY } from '../levels/rooms';
import { preloadRoomBackgroundDecoded, isRoomBackgroundDecodeReady as _isBgDecodeReady } from './backgroundRenderer';

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
 * Includes the room-level default theme, per-wall overrides, and per-cell
 * background block overrides (which can introduce folder themes not present
 * in any wall definition).
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
  if (room.backgroundBlocks) {
    for (const b of room.backgroundBlocks) {
      if (b.blockTheme && isFolderBasedTheme(b.blockTheme)) {
        ids.add(b.blockTheme);
      }
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
    preloadSpriteAtlasForTheme(themeId);
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
 * has fully loaded and been decoded (or confirmed loaded when decode() is
 * unavailable).
 *
 * Uses isSpriteDecodeReady() rather than isSpriteReady() so the check reflects
 * decode-aware readiness when decodeRoomThemeSprites() has been called for the
 * room.  For rooms whose sprites were loaded only via preloadRoomThemeSprites()
 * (no explicit decode call), isSpriteDecodeReady() falls back to the plain
 * isSpriteReady() check — behavior is unchanged from the old implementation.
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
      if (!isSpriteDecodeReady(img)) return false;
    }
  }
  return true;
}

/**
 * Triggers HTMLImageElement.decode() for all folder-based block-theme sprites
 * required by `room`, ensuring they are fully rasterized and draw-ready before
 * the player enters.
 *
 * Call this when approaching a room (or at campaign start for the spawn room)
 * so that wall tiles render without pop-in on first entry.  All decode() calls
 * are asynchronous — this function never blocks the gameplay frame.
 *
 * Returns a Promise that resolves when all sprites have been decoded (or
 * confirmed loaded when decode() is unavailable).  The Promise never rejects;
 * failed images fall back gracefully to solid-colour tiles.
 *
 * Safe to call multiple times — decodeImg() is idempotent for already-decoded URLs.
 */
export async function decodeRoomThemeSprites(room: RoomDef): Promise<void> {
  const themeIds = _collectFolderThemeIds(room);
  let promises: Promise<void>[] | null = null;
  for (const themeId of themeIds) {
    const urls = _getSpriteUrls(themeId);
    if (urls === null) continue;
    if (promises === null) promises = [];
    promises.push(decodeSpriteAtlasForTheme(themeId));
    for (let i = 0; i < urls.length; i++) {
      if (promises === null) promises = [];
      promises.push(decodeImg(urls[i]));
    }
  }
  if (promises !== null) {
    await Promise.all(promises);
  }
}

/**
 * Triggers HTMLImageElement.decode() for the static background image of
 * `room`, so the GPU has rasterized the texture before the first drawImage
 * call.  Uses the same URL-selection logic as `renderWorldBackground()` so
 * the correct image is decoded for rooms that use `worldNumber` instead of
 * an explicit `backgroundId`.  Fire-and-forget — procedural backgrounds (no
 * static image) are no-ops.
 *
 * Safe to call multiple times; preloadRoomBackgroundDecoded() is idempotent.
 */
export function decodeRoomBackground(room: RoomDef): void {
  preloadRoomBackgroundDecoded(room.worldNumber ?? 0, room.backgroundId);
}

/**
 * Returns `true` once the background image for `room` has been fully decoded
 * and is ready to render without a blocking GPU upload step.
 *
 * Procedural backgrounds (no static image) and the Thero world (99) always
 * return `true` immediately.
 *
 * Use this alongside `areRoomSpritesReady()` in the loading-overlay tick to
 * ensure the player is not unblocked before both block sprites and the
 * background image are decode-ready.
 */
export function isRoomBackgroundDecodeReady(room: RoomDef): boolean {
  return _isBgDecodeReady(room.worldNumber ?? 0, room.backgroundId);
}
