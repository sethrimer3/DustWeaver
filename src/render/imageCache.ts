/**
 * Shared sprite image cache for render modules.
 * A single cache instance ensures the same URL always returns the same
 * HTMLImageElement — preventing duplicate network requests and duplicate objects.
 */

/** Module-level image cache keyed by URL — populated once, reused forever. */
const _imgCache = new Map<string, HTMLImageElement>();

/**
 * URLs whose images have been through HTMLImageElement.decode() (or confirmed
 * loaded when decode() is unavailable).  Both the caller-supplied URL and the
 * browser-normalised `img.src` are added so that lookups with either form succeed.
 */
const _decodedUrls = new Set<string>();

/**
 * In-flight decode promises keyed by both the original URL and the browser-
 * normalised `img.src`.  Prevents duplicate decode work when `decodeImg()` is
 * called multiple times for the same image before decode completes.
 */
const _decodeInFlight = new Map<string, Promise<void>>();

/**
 * URLs whose image failed to load (network error, 404, etc). Tracked under
 * both the caller-supplied URL and the browser-normalised `img.src` so a
 * failed load is recognised regardless of which form is queried.
 *
 * A failed URL is treated as decode-"ready" (see isSpriteDecodeReady) so a
 * missing/broken asset can never permanently block a caller (e.g. the zone
 * loading overlay) that is waiting for decode readiness — it just never
 * gets a usable image and falls back to solid-colour rendering instead.
 */
const _failedUrls = new Set<string>();

/** Returns true once the image at `src` has been confirmed to have failed loading. */
export function hasImageFailed(src: string): boolean {
  return _failedUrls.has(src);
}

/** Returns (or creates) a loaded HTMLImageElement for the given URL. */
export function loadImg(src: string): HTMLImageElement {
  const cached = _imgCache.get(src);
  if (cached !== undefined) return cached;
  const img = typeof Image !== 'undefined' ? new Image() : ({ src: '', complete: false, naturalWidth: 0 } as unknown as HTMLImageElement);
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
 * If a decode is in-flight (decode was requested but not yet complete), returns
 * false rather than falling back to isSpriteReady(), so the loading overlay
 * waits for the actual decode result.
 *
 * Falls back to isSpriteReady() only for images that were never preloaded via
 * decodeImg() (e.g. legacy world-number sprites loaded at module init time).
 */
export function isSpriteDecodeReady(img: HTMLImageElement): boolean {
  if (_decodedUrls.has(img.src)) return true;
  if (_failedUrls.has(img.src)) return true;         // failed load — unblock, fallback rendering handles it
  if (_decodeInFlight.has(img.src)) return false;   // decode requested but pending
  return isSpriteReady(img);                         // decode never requested
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
 * - Deduplicates in-flight work: concurrent calls for the same URL share a
 *   single promise, preventing duplicate decode() calls.
 * - Tracks readiness by both the caller-supplied URL and the browser-normalised
 *   `img.src` so that `isSpriteDecodeReady(img)` always finds a match.
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

  // Also check the browser-normalised form (e.g. relative → absolute URL).
  if (_decodedUrls.has(img.src)) return Promise.resolve();

  // Return the existing in-flight promise if one is already pending.
  const existing = _decodeInFlight.get(src) ?? _decodeInFlight.get(img.src);
  if (existing !== undefined) return existing;

  // Helper to mark the image decoded and clear in-flight entries.
  const markDecoded = (): void => {
    _decodedUrls.add(src);
    if (img.src !== src) _decodedUrls.add(img.src);
    _decodeInFlight.delete(src);
    _decodeInFlight.delete(img.src);
  };

  // Helper to clear in-flight entries on terminal failure (no decode mark).
  const markFailed = (): void => {
    _decodeInFlight.delete(src);
    _decodeInFlight.delete(img.src);
    if (!_failedUrls.has(src)) {
      console.warn(`[imageCache] failed to load image: ${src}`);
    }
    _failedUrls.add(src);
    if (img.src !== src) _failedUrls.add(img.src);
  };

  // Run decode() (or confirm loaded) once the image data is available.
  const performDecode = (): Promise<void> => {
    if (_hasDecode(img)) {
      return img.decode().then(
        () => { markDecoded(); },
        () => {
          // decode() rejected — image is still usable if it loaded successfully.
          if (img.complete && img.naturalWidth > 0) markDecoded();
          else markFailed();
        },
      );
    }
    // No decode() API — consider ready once load completed.
    if (img.complete && img.naturalWidth > 0) markDecoded();
    else markFailed();
    return Promise.resolve();
  };

  let promise: Promise<void>;

  if (img.complete) {
    // Already downloaded — decode immediately.
    promise = performDecode();
  } else {
    // Not yet downloaded — wait for the load event, then decode.
    promise = new Promise<void>((resolve) => {
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
        markFailed();
        resolve(); // Failed load — resolve without marking decoded; fallback rendering handles it
      }, { once: true });

      // Guard against race: image may have loaded between the .complete check
      // above and adding the event listeners.
      if (img.complete) onSettle();
    });
  }

  // Register the promise under both URL forms so deduplication works either way.
  _decodeInFlight.set(src, promise);
  if (img.src !== src) _decodeInFlight.set(img.src, promise);

  // Safety net: clear stale in-flight entries once the promise settles.
  //
  // This handles the edge case where markDecoded() or markFailed() ran
  // synchronously (img.complete path with no browser decode() API) — which
  // means those cleanup calls fired *before* the _decodeInFlight.set() above
  // registered the promise, leaving stale entries that would permanently block
  // isSpriteDecodeReady() for any image that failed to load.
  //
  // The identity check ensures a *newer* in-flight promise for the same key
  // (issued by a subsequent decodeImg() call) is not accidentally removed.
  promise.finally(() => {
    if (_decodeInFlight.get(src) === promise) _decodeInFlight.delete(src);
    if (_decodeInFlight.get(img.src) === promise) _decodeInFlight.delete(img.src);
  });

  return promise;
}
