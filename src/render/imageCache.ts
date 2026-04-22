/**
 * Shared sprite image cache for render modules.
 * A single cache instance ensures the same URL always returns the same
 * HTMLImageElement — preventing duplicate network requests and duplicate objects.
 */

/** Module-level image cache keyed by URL — populated once, reused forever. */
const _imgCache = new Map<string, HTMLImageElement>();

/** Returns (or creates) a loaded HTMLImageElement for the given URL. */
export function loadImg(src: string): HTMLImageElement {
  const cached = _imgCache.get(src);
  if (cached !== undefined) return cached;
  const img = new Image();
  img.src = src;
  _imgCache.set(src, img);
  return img;
}

/** Returns true once the image has finished loading with a valid size. */
export function isSpriteReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

/**
 * Loads an image from the first URL in srcList; on load error, tries
 * subsequent URLs in order until the list is exhausted.
 */
export function loadImgWithFallback(srcList: readonly string[]): HTMLImageElement {
  const img = loadImg(srcList[0]);
  if (srcList.length <= 1) return img;

  let candidateIndex = 1;
  img.addEventListener('error', () => {
    if (candidateIndex >= srcList.length) return;
    img.src = srcList[candidateIndex++];
  });
  return img;
}
