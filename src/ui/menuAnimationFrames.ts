const BASE = import.meta.env.BASE_URL;

const EXPECTED_FRAME_COUNT = 300;
const PRELOAD_CONCURRENCY = 8;

export const MENU_ANIMATION_FPS = 30;

export interface MenuAnimationFrames {
  readonly normal: readonly HTMLImageElement[];
  readonly blurred: readonly HTMLImageElement[];
}

export type MenuAnimationLoadPhase = 'loading' | 'warming';

export interface MenuAnimationLoadProgress {
  readonly phase: MenuAnimationLoadPhase;
  readonly completed: number;
  readonly total: number;
}

let cachedFrames: MenuAnimationFrames | null = null;
let preloadPromise: Promise<MenuAnimationFrames> | null = null;

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

  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => reject(new Error(`Failed to load menu frame: ${url}`)), { once: true });
    });
  }
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new Error(`Menu frame loaded without drawable dimensions: ${url}`);
  }
  await image.decode();
  return image;
}

async function loadWithConcurrency(
  urls: readonly string[],
  onLoaded: () => void,
): Promise<HTMLImageElement[]> {
  const images = new Array<HTMLImageElement>(urls.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < urls.length) {
      const index = nextIndex++;
      images[index] = await loadDecodedImage(urls[index]);
      onLoaded();
    }
  }

  const workerCount = Math.min(PRELOAD_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return images;
}

async function warmFrames(
  frames: readonly HTMLImageElement[],
  onWarmed: () => void,
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const context = canvas.getContext('2d', { alpha: false });
  if (context === null) throw new Error('Unable to create menu-animation warm-up canvas.');

  for (let index = 0; index < frames.length; index++) {
    context.drawImage(frames[index], 0, 0, canvas.width, canvas.height);
    onWarmed();
    if ((index + 1) % 8 === 0) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
}

export function preloadMenuAnimationFrames(
  onProgress?: (progress: MenuAnimationLoadProgress) => void,
): Promise<MenuAnimationFrames> {
  if (cachedFrames !== null) return Promise.resolve(cachedFrames);
  if (preloadPromise !== null) return preloadPromise;

  preloadPromise = (async () => {
    const normalUrls = frameUrls('goldEmbers', 'goldEmbers');
    const blurredUrls = frameUrls('goldEmbers_blur', 'goldEmbers_blur');
    const total = normalUrls.length + blurredUrls.length;
    let loaded = 0;
    const reportLoaded = (): void => {
      loaded++;
      onProgress?.({ phase: 'loading', completed: loaded, total });
    };
    onProgress?.({ phase: 'loading', completed: 0, total });

    const [normal, blurred] = await Promise.all([
      loadWithConcurrency(normalUrls, reportLoaded),
      loadWithConcurrency(blurredUrls, reportLoaded),
    ]);

    let warmed = 0;
    const reportWarmed = (): void => {
      warmed++;
      onProgress?.({ phase: 'warming', completed: warmed, total });
    };
    onProgress?.({ phase: 'warming', completed: 0, total });
    await warmFrames(normal, reportWarmed);
    await warmFrames(blurred, reportWarmed);

    cachedFrames = { normal, blurred };
    return cachedFrames;
  })().catch(error => {
    preloadPromise = null;
    throw error;
  });

  return preloadPromise;
}

export function getPreloadedMenuAnimationFrames(): MenuAnimationFrames {
  if (cachedFrames === null) {
    throw new Error('Menu animation frames were requested before startup preloading completed.');
  }
  return cachedFrames;
}
