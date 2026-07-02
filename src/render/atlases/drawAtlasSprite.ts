import type { SpriteAtlasLookupResult } from './spriteAtlasTypes';

export function drawAtlasSprite(
  ctx: CanvasRenderingContext2D,
  atlasSprite: SpriteAtlasLookupResult,
  dx: number,
  dy: number,
  dw: number = atlasSprite.sprite.w,
  dh: number = atlasSprite.sprite.h,
): void {
  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    atlasSprite.atlas.image,
    atlasSprite.sprite.x,
    atlasSprite.sprite.y,
    atlasSprite.sprite.w,
    atlasSprite.sprite.h,
    dx,
    dy,
    dw,
    dh,
  );
  ctx.imageSmoothingEnabled = previousSmoothing;
}
