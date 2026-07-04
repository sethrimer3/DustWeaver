const BASE = import.meta.env.BASE_URL;

function assetUrl(path: string): string {
  return `${BASE}${path}`;
}

export const MENU_ANIMATION_ASSETS = {
  normalUrl: assetUrl('ANIMATIONS/goldEmbers/goldEmbers.webp'),
  blurredUrl: assetUrl('ANIMATIONS/goldEmbers_blur/goldEmbers_blur.webp'),
} as const;

export const LOADING_BACKGROUND_ASSETS = {
  caveBlurUrl: assetUrl('SPRITES/BACKGROUNDS/BrownCave_Blur.png'),
  caveBlurDarkUrl: assetUrl('SPRITES/BACKGROUNDS/BrownCave_Blur_Dark.png'),
} as const;
