export type ZipMoveBlockVariant = 'toward' | 'away';
export type ZipMoveBlockSide = 'top' | 'right' | 'bottom' | 'left';
export type ZipMoveBlockState = 'dormant' | 'accelerating' | 'moving';

export const ZIP_MOVE_BLOCK_ACCEL_WORLD_PER_SEC2 = 720;
export const ZIP_MOVE_BLOCK_TOP_SPEED_WORLD_PER_SEC = 180;
export const ZIP_MOVE_BLOCK_ACTIVE_EASE_PER_SEC = 18;

export interface ZipMoveBlockRuntime {
  uid: number;
  variant: ZipMoveBlockVariant;
  xWorld: number;
  yWorld: number;
  wWorld: number;
  hWorld: number;
  velocityXWorld: number;
  velocityYWorld: number;
  state: ZipMoveBlockState;
  activationSide: ZipMoveBlockSide | null;
  activeAmount: number;
  wallIndex: number;
  zipImpactLatched: boolean;
}

export function directionForZipSide(
  variant: ZipMoveBlockVariant,
  side: ZipMoveBlockSide,
): { x: number; y: number } {
  const toward = side === 'top' ? { x: 0, y: -1 }
    : side === 'right' ? { x: 1, y: 0 }
    : side === 'bottom' ? { x: 0, y: 1 }
    : { x: -1, y: 0 };
  return variant === 'toward' ? toward : {
    x: toward.x === 0 ? 0 : -toward.x,
    y: toward.y === 0 ? 0 : -toward.y,
  };
}
