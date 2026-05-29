const BASE = import.meta.env.BASE_URL;

function assetUrl(path: string): string {
  return `${BASE}${path}`;
}

export const MENU_ANIMATION_ASSETS = {
  normalUrl: assetUrl('ANIMATIONS/goldEmbers/goldEmbers.webp'),
  blurredUrl: assetUrl('ANIMATIONS/goldEmbers_blur/goldEmbers_blur.webp'),
} as const;

export const LOADING_ANIMATION_ASSETS = {
  backgroundUrl: assetUrl('ANIMATIONS/loadingScreenBackground/loadingScreenBackground.webp'),
  circleUrl: assetUrl('ANIMATIONS/loadingAnimation/loadingAnimation.webp'),
} as const;
