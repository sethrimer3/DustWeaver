export interface RenderSizeOption {
  id: string;
  label: string;
  widthPx: number;
  heightPx: number;
}

const RENDER_SIZE_STORAGE_KEY = 'dustweaver-render-size-id';
const DEFAULT_RENDER_SIZE_ID = '1080p';

const RENDER_SIZE_OPTIONS: RenderSizeOption[] = [
  { id: '720p', label: '1280 × 720 (720p)', widthPx: 1280, heightPx: 720 },
  { id: '900p', label: '1600 × 900 (900p)', widthPx: 1600, heightPx: 900 },
  { id: '1080p', label: '1920 × 1080 (1080p)', widthPx: 1920, heightPx: 1080 },
  { id: '1440p', label: '2560 × 1440 (1440p)', widthPx: 2560, heightPx: 1440 },
  { id: '4k', label: '3840 × 2160 (4K)', widthPx: 3840, heightPx: 2160 },
];

export function getRenderSizeOptions(): readonly RenderSizeOption[] {
  return RENDER_SIZE_OPTIONS;
}

function getOptionById(renderSizeId: string): RenderSizeOption | null {
  for (let i = 0; i < RENDER_SIZE_OPTIONS.length; i++) {
    if (RENDER_SIZE_OPTIONS[i].id === renderSizeId) {
      return RENDER_SIZE_OPTIONS[i];
    }
  }
  return null;
}

function detectScreenSizeOptionId(): string {
  const screenWidthPx = window.screen?.width ?? 0;
  const screenHeightPx = window.screen?.height ?? 0;

  if (screenWidthPx <= 0 || screenHeightPx <= 0) {
    return DEFAULT_RENDER_SIZE_ID;
  }

  const longEdgePx = Math.max(screenWidthPx, screenHeightPx);
  const shortEdgePx = Math.min(screenWidthPx, screenHeightPx);

  let bestOptionId = DEFAULT_RENDER_SIZE_ID;
  let bestOptionAreaPx = 0;

  for (let i = 0; i < RENDER_SIZE_OPTIONS.length; i++) {
    const option = RENDER_SIZE_OPTIONS[i];
    const optionLongEdgePx = Math.max(option.widthPx, option.heightPx);
    const optionShortEdgePx = Math.min(option.widthPx, option.heightPx);

    if (optionLongEdgePx <= longEdgePx && optionShortEdgePx <= shortEdgePx) {
      const optionAreaPx = option.widthPx * option.heightPx;
      if (optionAreaPx > bestOptionAreaPx) {
        bestOptionAreaPx = optionAreaPx;
        bestOptionId = option.id;
      }
    }
  }

  return bestOptionId;
}

export function getSelectedRenderSize(): RenderSizeOption {
  const storedId = localStorage.getItem(RENDER_SIZE_STORAGE_KEY);
  if (storedId !== null) {
    const storedOption = getOptionById(storedId);
    if (storedOption !== null) {
      return storedOption;
    }
  }

  const detectedOption = getOptionById(detectScreenSizeOptionId());
  return detectedOption ?? RENDER_SIZE_OPTIONS[2];
}

export function setSelectedRenderSize(renderSizeId: string): RenderSizeOption {
  const option = getOptionById(renderSizeId) ?? getOptionById(DEFAULT_RENDER_SIZE_ID) ?? RENDER_SIZE_OPTIONS[0];
  localStorage.setItem(RENDER_SIZE_STORAGE_KEY, option.id);
  return option;
}
