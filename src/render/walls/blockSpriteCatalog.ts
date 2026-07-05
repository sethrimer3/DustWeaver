/**
 * Block sprite catalog.
 *
 * Template URLs for block shape masks used by the procedural sprite system.
 * Block theme sprites are discovered automatically at build time via
 * folderBlockThemes.ts (import.meta.glob) — no probe URLs are needed.
 */

// ── Template URLs ─────────────────────────────────────────────────────────────

const _TEMPLATE_BASE_PATH = 'SPRITES/BLOCKS/block_templates';

/**
 * Fixed URLs for the white-pixel template masks.
 * Each template defines the visible shape for a block category.
 */
export const TEMPLATE_URLS = {
  '1x1 block':    `${_TEMPLATE_BASE_PATH}/1x1 block/1x1 block_template.png`,
  '1x1 platform': `${_TEMPLATE_BASE_PATH}/1x1 platform/1x1 platform_template.png`,
  '1x1 ramp':     `${_TEMPLATE_BASE_PATH}/1x1 ramp/1x1 ramp_template.png`,
  '1x2 ramp':     `${_TEMPLATE_BASE_PATH}/1x2 ramp/1x2 ramp_template.png`,
  '2x2 block':    `${_TEMPLATE_BASE_PATH}/2x2 block/2x2 block_template.png`,
  '2x2 platform': `${_TEMPLATE_BASE_PATH}/2x2 platform/2x2 platform_template.png`,
  '2x2 ramp':     `${_TEMPLATE_BASE_PATH}/2x2 ramp/2x2 ramp_template.png`,
} as const;

/** Union of all supported shape names. */
export type BlockShapeName = keyof typeof TEMPLATE_URLS;

/**
 * Variation template masks for spike hazards, one folder per size tier.
 * Unlike `TEMPLATE_URLS` (one mask per shape), spikes have several interchangeable
 * variation masks per size so that repeated spikes in a room don't look identical.
 * All variations face upward by default — `getProceduralSprite`'s `rotStep`/`flipY`
 * params reorient them to match a spike's placed direction.
 */
export const SPIKE_TEMPLATE_VARIATIONS = {
  '1x1 spike': [1, 2, 3, 4, 5].map(
    n => `${_TEMPLATE_BASE_PATH}/1x1 spike/1x1 spike_template_variation${n}.png`,
  ),
  '2x2 spike': [1, 2, 3, 4, 5].map(
    n => `${_TEMPLATE_BASE_PATH}/2x2 spike/2x2 spike_template_variation${n}.png`,
  ),
} as const;

/** Union of supported spike shape sizes. */
export type SpikeShapeName = keyof typeof SPIKE_TEMPLATE_VARIATIONS;

// ── Pool accessor ─────────────────────────────────────────────────────────────

/**
 * Returns the probe URL array for a given material name and base-size tier.
 * All block themes now use the folder-based discovery system (folderBlockThemes.ts)
 * so this always returns an empty array.
 */
export function getBaseSpriteProbePool(_material: string, _use2x2Pool: boolean): readonly string[] {
  return [];
}
