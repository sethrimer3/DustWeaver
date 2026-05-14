/**
 * lightingTypes.ts — Re-exports core lighting types and the default-light factory.
 *
 * Renderer modules should import from here (not directly from lightingSchema.ts)
 * to keep import paths stable if the schema moves.
 */

export type { LightDef, SavedSceneLight, LightType, LightBlendMode } from '../../levels/lightingSchema';
export { lightDefToSaved, savedToLightDef } from '../../levels/lightingSchema';

import type { LightDef, LightType } from '../../levels/lightingSchema';
import { BLOCK_SIZE_MEDIUM } from '../../levels/roomDef';

/** Creates a LightDef initialised with sensible defaults for the given light type. */
export function createDefaultLight(kind: LightType, xWorld: number, yWorld: number): LightDef {
  const base: LightDef = {
    xWorld,
    yWorld,
    kind,
    radiusWorld: BLOCK_SIZE_MEDIUM * 8,
    colorR: 255,
    colorG: 220,
    colorB: 150,
    intensityPct: 80,
    blendMode: 'add',
    castsShadowsFlag: 1,
  };
  if (kind === 'spotlight') {
    base.coneAngleRad  = Math.PI / 4;
    base.rotationRad   = Math.PI / 2;  // point downward
    base.shadowSoftness = 0.2;
  } else if (kind === 'floodlight') {
    base.intensityPct  = 60;
    base.radiusWorld   = BLOCK_SIZE_MEDIUM * 14;
    base.shadowSoftness = 0.4;
  } else if (kind === 'backlight') {
    base.blendMode    = 'screen';
    base.intensityPct = 40;
    base.colorR = 100;
    base.colorG = 140;
    base.colorB = 255;
  }
  return base;
}
