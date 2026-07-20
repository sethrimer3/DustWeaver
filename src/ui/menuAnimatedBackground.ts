export interface MenuAnimatedBackgroundOptions {
  normalFrames: readonly HTMLImageElement[];
  blurredFrames?: readonly HTMLImageElement[];
  fps?: number;
  opacity?: number;
  zIndex?: number;
}

export interface MenuAnimatedBackground {
  readonly element: HTMLCanvasElement;
  showNormal: () => void;
  showBlurred: () => void;
  destroy: () => void;
}

export function createMenuAnimatedBackground(options: MenuAnimatedBackgroundOptions): MenuAnimatedBackground {
  if (options.normalFrames.length === 0) throw new Error('Menu animation requires at least one frame.');
  if (options.blurredFrames !== undefined && options.blurredFrames.length !== options.normalFrames.length) {
    throw new Error('Normal and blurred menu animations must contain the same number of frames.');
  }

  const canvas = document.createElement('canvas');
  const maybeContext = canvas.getContext('2d', { alpha: false });
  if (maybeContext === null) throw new Error('Unable to create menu animation canvas.');
  const context = maybeContext;
  const fallbackBlur = options.blurredFrames === undefined;
  let activeFrames = options.normalFrames;
  let animationFrameId = 0;
  let destroyed = false;
  const startedAt = performance.now();
  const frameDurationMs = 1000 / (options.fps ?? 30);

  canvas.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    'object-fit:cover',
    'pointer-events:none',
    `z-index:${options.zIndex ?? 0}`,
    `opacity:${options.opacity ?? 1}`,
  ].join(';');

  function resizeBackingStore(): void {
    const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  function drawCover(frame: HTMLImageElement): void {
    const sourceWidth = frame.naturalWidth;
    const sourceHeight = frame.naturalHeight;
    const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    context.drawImage(frame, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }

  function render(now: number): void {
    if (destroyed) return;
    resizeBackingStore();
    const frameIndex = Math.floor((now - startedAt) / frameDurationMs) % activeFrames.length;
    drawCover(activeFrames[frameIndex]);
    animationFrameId = requestAnimationFrame(render);
  }

  animationFrameId = requestAnimationFrame(render);

  return {
    element: canvas,
    showNormal(): void {
      activeFrames = options.normalFrames;
      if (fallbackBlur) canvas.style.filter = '';
    },
    showBlurred(): void {
      if (options.blurredFrames !== undefined) {
        activeFrames = options.blurredFrames;
        canvas.style.filter = '';
        return;
      }
      activeFrames = options.normalFrames;
      canvas.style.filter = 'blur(6px) brightness(0.75)';
    },
    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(animationFrameId);
      if (canvas.parentElement !== null) canvas.parentElement.removeChild(canvas);
    },
  };
}
