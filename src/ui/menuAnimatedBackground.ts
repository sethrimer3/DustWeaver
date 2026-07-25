import type { MenuAnimationSource } from './menuAnimationFrames';

export interface MenuAnimatedBackgroundOptions {
  source: MenuAnimationSource;
  fps?: number;
  opacity?: number;
  zIndex?: number;
}

export interface MenuAnimatedBackground {
  readonly element: HTMLElement;
  showNormal: () => void;
  showBlurred: () => void;
  destroy: () => void;
}

const FALLBACK_FILTER = 'blur(6px) brightness(0.75)';

function sharedStyle(opacity: number, zIndex: number): string {
  return [
    'position:absolute', 'inset:0', 'width:100%', 'height:100%',
    'object-fit:cover', 'pointer-events:none', `z-index:${zIndex}`, `opacity:${opacity}`,
  ].join(';');
}

export function createMenuAnimatedBackground(options: MenuAnimatedBackgroundOptions): MenuAnimatedBackground {
  const { source } = options;
  const opacity = options.opacity ?? 1;
  const zIndex = options.zIndex ?? 0;

  if (source.kind === 'static') {
    const element = document.createElement('div');
    element.style.cssText = `${sharedStyle(opacity, zIndex)};background:#050403`;
    return { element, showNormal() {}, showBlurred() {}, destroy: () => element.remove() };
  }

  if (source.kind === 'animated-webp') {
    const container = document.createElement('div');
    container.style.cssText = `${sharedStyle(opacity, zIndex)};overflow:hidden;background:#050403`;
    const normal = document.createElement('img');
    normal.alt = '';
    normal.src = source.normalUrl;
    normal.style.cssText = sharedStyle(1, 0);
    container.appendChild(normal);
    const blurredUrl = source.blurredUrl;
    let blurred: HTMLImageElement | null = null;
    if (blurredUrl !== undefined) {
      blurred = document.createElement('img');
      blurred.alt = '';
      blurred.src = blurredUrl;
      blurred.style.cssText = `${sharedStyle(1, 0)};display:none`;
      container.appendChild(blurred);
    }
    return {
      element: container,
      showNormal(): void {
        normal.style.display = '';
        normal.style.filter = '';
        if (blurred !== null) blurred.style.display = 'none';
      },
      showBlurred(): void {
        if (blurred !== null) {
          normal.style.display = 'none';
          blurred.style.display = '';
        } else {
          normal.style.filter = FALLBACK_FILTER;
        }
      },
      destroy(): void {
        normal.src = '';
        if (blurred !== null) blurred.src = '';
        container.remove();
      },
    };
  }

  if (source.normal.length === 0) throw new Error('Menu animation requires at least one frame.');
  if (source.blurred.length !== source.normal.length) {
    throw new Error('Normal and blurred menu animations must contain the same number of frames.');
  }
  const canvas = document.createElement('canvas');
  const maybeContext = canvas.getContext('2d', { alpha: false });
  if (maybeContext === null) throw new Error('Unable to create menu animation canvas.');
  const context = maybeContext;
  let activeFrames = source.normal;
  let animationFrameId = 0;
  let destroyed = false;
  let startedAt: number | null = null;
  const frameDurationMs = 1000 / (options.fps ?? 30);
  canvas.style.cssText = sharedStyle(opacity, zIndex);

  function render(now: number): void {
    if (destroyed) return;
    startedAt ??= now;
    const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const frame = activeFrames[Math.floor((now - startedAt) / frameDurationMs) % activeFrames.length];
    const scale = Math.max(canvas.width / frame.naturalWidth, canvas.height / frame.naturalHeight);
    const drawWidth = frame.naturalWidth * scale;
    const drawHeight = frame.naturalHeight * scale;
    context.drawImage(frame, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
    animationFrameId = requestAnimationFrame(render);
  }
  animationFrameId = requestAnimationFrame(render);

  return {
    element: canvas,
    showNormal: () => { activeFrames = source.normal; },
    showBlurred: () => { activeFrames = source.blurred; },
    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(animationFrameId);
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    },
  };
}
