/**
 * Shared sprite image cache for render modules.
 * A single cache instance ensures the same URL always returns the same
 * HTMLImageElement — preventing duplicate network requests and duplicate objects.
 */

/** Module-level image cache keyed by URL — populated once, reused forever. */
const _imgCache = new Map<string, HTMLImageElement>();

/**
 * URLs whose images have been through HTMLImageElement.decode() (or confirmed
 * loaded when decode() is unavailable).  Used by isSpriteDecodeReady() to
 * report whether an image is fully rasterized and draw-ready without relying
 * solely on img.complete.
 */
const _decodedUrls = new Set<string>();

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
 * Returns true when the image is fully decoded and guaranteed draw-ready.
 *
 * When decodeImg() has been called for this URL the result reflects decoded
 * state, which is more accurate than isSpriteReady() — it avoids the brief
 * GPU-rasterize stall that can cause tile pop-in even after img.complete
 * is true on some browsers.
 *
 * Falls back to isSpriteReady() for images that were not preloaded via
 * decodeImg() (e.g. legacy world-number sprites loaded at module init time).
 */
export function isSpriteDecodeReady(img: HTMLImageElement): boolean {
  return _decodedUrls.has(img.src) || isSpriteReady(img);
}

/** Type guard: true when img supports the decode() API. */
function _hasDecode(img: HTMLImageElement): boolean {
  return typeof (img as HTMLImageElement & { decode?: unknown }).decode === 'function';
}

/**
 * Loads the image at `src` and triggers HTMLImageElement.decode() if available,
 * ensuring the image is fully rasterized before the caller draws with it.
 *
 * - Idempotent: resolves immediately if already in the decoded set.
 * - Preserves existing fallback rendering: failed images resolve without throwing
 *   so the caller is never blocked by unreachable assets.
 * - Safe in environments without decode() (Safari older versions, Node test
 *   environments): falls back to waiting for the load event instead.
 * - Never creates a duplicate HTMLImageElement — calls loadImg() internally.
 *
 * Returns a Promise that resolves (never rejects) when the image is ready.
 */
export function decodeImg(src: string): Promise<void> {
  if (_decodedUrls.has(src)) return Promise.resolve();

  const img = loadImg(src);

  // Run decode() (or confirm loaded) once the image data is available.
  const performDecode = (): Promise<void> => {
    if (_hasDecode(img)) {
      return img.decode().then(
        () => { _decodedUrls.add(src); },
        () => {
          // decode() rejected — image is still usable if it loaded successfully.
          const imgAny = img as HTMLImageElement;
          if (imgAny.complete && imgAny.naturalWidth > 0) _decodedUrls.add(src);
        },
      );
    }
    // No decode() API — consider ready once load completed.
    if (img.complete && img.naturalWidth > 0) _decodedUrls.add(src);
    return Promise.resolve();
  };

  if (img.complete) {
    // Already downloaded — decode immediately.
    return performDecode();
  }

  // Not yet downloaded — wait for the load event, then decode.
  return new Promise<void>((resolve) => {
    let settled = false;

    const onSettle = () => {
      if (settled) return;
      settled = true;
      void performDecode().then(resolve);
    };

    img.addEventListener('load', onSettle, { once: true });
    img.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      resolve(); // Failed load — resolve without marking decoded; fallback rendering handles it
    }, { once: true });

    // Guard against race: image may have loaded between the .complete check
    // above and adding the event listeners.
    if (img.complete) onSettle();
  });
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
