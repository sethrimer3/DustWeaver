import { MENU_ANIMATION_ASSETS } from './animatedAssetPaths';

const BASE = import.meta.env?.BASE_URL ?? '/';
const EXPECTED_FRAME_COUNT = 300;
const PRELOAD_CONCURRENCY = 8;

export const MENU_ANIMATION_FPS = 30;

export interface MenuAnimationFrames {
  readonly normal: readonly HTMLImageElement[];
  readonly blurred: readonly HTMLImageElement[];
}

export type MenuAnimationSource =
  | { readonly kind: 'frames'; readonly normal: readonly HTMLImageElement[]; readonly blurred: readonly HTMLImageElement[] }
  | { readonly kind: 'animated-webp'; readonly normalUrl: string; readonly blurredUrl?: string }
  | { readonly kind: 'static' };

export type MenuAnimationLoadPhase = 'loading' | 'warming';

export interface MenuAnimationLoadProgress {
  readonly phase: MenuAnimationLoadPhase;
  readonly completed: number;
  readonly total: number;
}

let cachedSource: MenuAnimationSource | null = null;
let preloadPromise: Promise<MenuAnimationSource> | null = null;

function frameUrls(folder: string, filenamePrefix: string): string[] {
  return Array.from({ length: EXPECTED_FRAME_COUNT }, (_, index) => (
    `${BASE}ANIMATIONS/${folder}/individualFrames/${filenamePrefix}_${String(index).padStart(5, '0')}.webp`
  ));
}

async function loadDecodedImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.alt = '';
  image.decoding = 'async';
  image.loading = 'eager';
  image.src = url;

  try {
    if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => reject(new Error('Image load event reported an error.')), { once: true });
      });
    }
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new Error('Image loaded without drawable dimensions.');
    }
    await image.decode();
    return image;
  } catch (error) {
    console.error(`[menu-animation] Failed to load or decode ${url}`, error);
    image.remove();
    image.src = '';
    throw { url, error };
  }
}

/**
 * Verifies a URL is loadable without forcing a full synchronous raster decode.
 * Used for the animated-webp fallback: unlike the per-frame canvas path, an
 * <img> can display/animate a WebP progressively, so calling decode() here
 * would just compete for decode memory right when the frame preload above may
 * have already exhausted it (observed as spurious EncodingErrors).
 */
async function probeImageLoadable(url: string): Promise<void> {
  const image = new Image();
  image.alt = '';
  image.src = url;
  try {
    if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => reject(new Error('Image load event reported an error.')), { once: true });
      });
    }
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new Error('Image loaded without drawable dimensions.');
    }
  } catch (error) {
    console.error(`[menu-animation] Failed to load ${url}`, error);
    throw { url, error };
  } finally {
    image.remove();
    image.src = '';
  }
}

function releaseImages(images: readonly (HTMLImageElement | undefined)[]): void {
  for (const image of images) {
    if (image === undefined) continue;
    image.remove();
    image.src = '';
  }
}

async function loadWithConcurrency(
  urls: readonly string[],
  onLoaded: () => void,
): Promise<HTMLImageElement[]> {
  const images = new Array<HTMLImageElement | undefined>(urls.length);
  let nextIndex = 0;
  let failure: unknown;

  async function worker(): Promise<void> {
    while (failure === undefined && nextIndex < urls.length) {
      const index = nextIndex++;
      try {
        images[index] = await loadDecodedImage(urls[index]);
        onLoaded();
      } catch (error) {
        failure = error;
      }
    }
  }

  const workerCount = Math.min(PRELOAD_CONCURRENCY, urls.length);
  await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
  if (failure !== undefined) {
    releaseImages(images);
    throw failure;
  }
  return images as HTMLImageElement[];
}

async function warmFrames(
  frames: readonly HTMLImageElement[],
  onWarmed: () => void,
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  try {
    const context = canvas.getContext('2d', { alpha: false });
    if (context === null) throw new Error('Unable to create menu-animation warm-up canvas.');
    for (let index = 0; index < frames.length; index++) {
      try {
        context.drawImage(frames[index], 0, 0, canvas.width, canvas.height);
      } catch (error) {
        const url = frames[index].currentSrc || frames[index].src;
        console.error(`[menu-animation] Failed to warm frame ${url}`, error);
        throw { url, error };
      }
      onWarmed();
      if ((index + 1) % 8 === 0) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    canvas.remove();
  }
}

async function loadFrameSource(
  onProgress?: (progress: MenuAnimationLoadProgress) => void,
): Promise<MenuAnimationSource> {
  const normalUrls = frameUrls('goldEmbers', 'goldEmbers');
  const blurredUrls = frameUrls('goldEmbers_blur', 'goldEmbers_blur');
  const allUrls = [...normalUrls, ...blurredUrls];
  let loaded = 0;
  onProgress?.({ phase: 'loading', completed: 0, total: allUrls.length });
  const images = await loadWithConcurrency(allUrls, () => {
    onProgress?.({ phase: 'loading', completed: ++loaded, total: allUrls.length });
  });

  try {
    let warmed = 0;
    onProgress?.({ phase: 'warming', completed: 0, total: images.length });
    await warmFrames(images, () => {
      onProgress?.({ phase: 'warming', completed: ++warmed, total: images.length });
    });
    return {
      kind: 'frames',
      normal: images.slice(0, EXPECTED_FRAME_COUNT),
      blurred: images.slice(EXPECTED_FRAME_COUNT),
    };
  } catch (error) {
    releaseImages(images);
    throw error;
  }
}

async function loadAnimatedWebpSource(): Promise<MenuAnimationSource> {
  try {
    await probeImageLoadable(MENU_ANIMATION_ASSETS.normalUrl);
  } catch (failure) {
    console.error('[menu-animation] Normal animated WebP fallback failed.', failure);
    return { kind: 'static' };
  }

  try {
    await probeImageLoadable(MENU_ANIMATION_ASSETS.blurredUrl);
    return {
      kind: 'animated-webp',
      normalUrl: MENU_ANIMATION_ASSETS.normalUrl,
      blurredUrl: MENU_ANIMATION_ASSETS.blurredUrl,
    };
  } catch (failure) {
    console.warn('[menu-animation] Blurred animated WebP fallback failed; using CSS blur.', failure);
    return { kind: 'animated-webp', normalUrl: MENU_ANIMATION_ASSETS.normalUrl };
  }
}

export function preloadMenuAnimationFrames(
  onProgress?: (progress: MenuAnimationLoadProgress) => void,
): Promise<MenuAnimationSource> {
  if (cachedSource !== null) return Promise.resolve(cachedSource);
  if (preloadPromise !== null) return preloadPromise;

  preloadPromise = (async () => {
    try {
      cachedSource = await loadFrameSource(onProgress);
    } catch (failure) {
      console.warn('[menu-animation] Frame sequence failed; trying complete animated WebPs.', failure);
      cachedSource = await loadAnimatedWebpSource();
    }
    return cachedSource;
  })().catch(error => {
    console.error('[menu-animation] Unexpected animation preparation failure; using static background.', error);
    cachedSource = { kind: 'static' };
    return cachedSource;
  });
  return preloadPromise;
}

export function getPreloadedMenuAnimationSource(): MenuAnimationSource {
  return cachedSource ?? { kind: 'static' };
}

/** Compatibility helper for callers that specifically support decoded frames. */
export function getPreloadedMenuAnimationFrames(): MenuAnimationFrames | null {
  const source = getPreloadedMenuAnimationSource();
  return source.kind === 'frames' ? { normal: source.normal, blurred: source.blurred } : null;
}

export function resetMenuAnimationPreloadForTests(): void {
  if (cachedSource?.kind === 'frames') releaseImages([...cachedSource.normal, ...cachedSource.blurred]);
  cachedSource = null;
  preloadPromise = null;
}
