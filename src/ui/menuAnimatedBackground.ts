export interface MenuAnimatedBackgroundOptions {
  normalUrl: string;
  blurredUrl?: string;
  opacity?: number;
  zIndex?: number;
}

export interface MenuAnimatedBackground {
  readonly element: HTMLImageElement;
  showNormal: () => void;
  showBlurred: () => void;
  destroy: () => void;
}

export function createMenuAnimatedBackground(options: MenuAnimatedBackgroundOptions): MenuAnimatedBackground {
  const img = document.createElement('img');
  const fallbackBlur = options.blurredUrl === undefined;
  img.decoding = 'async';
  img.alt = '';
  img.src = options.normalUrl;
  img.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    'object-fit:cover',
    'pointer-events:none',
    `z-index:${options.zIndex ?? 0}`,
    `opacity:${options.opacity ?? 1}`,
  ].join(';');

  function setSource(url: string): void {
    if (img.src !== url) img.src = url;
  }

  return {
    element: img,
    showNormal(): void {
      setSource(options.normalUrl);
      if (fallbackBlur) img.style.filter = '';
    },
    showBlurred(): void {
      if (options.blurredUrl !== undefined) {
        setSource(options.blurredUrl);
        img.style.filter = '';
        return;
      }
      setSource(options.normalUrl);
      img.style.filter = 'blur(6px) brightness(0.75)';
    },
    destroy(): void {
      img.removeAttribute('src');
      if (img.parentElement !== null) img.parentElement.removeChild(img);
    },
  };
}
