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

// ── Pool accessor ─────────────────────────────────────────────────────────────

/**
 * Returns the probe URL array for a given material name and base-size tier.
 * All block themes now use the folder-based discovery system (folderBlockThemes.ts)
 * so this always returns an empty array.
 */
export function getBaseSpriteProbePool(_material: string, _use2x2Pool: boolean): readonly string[] {
  return [];
}
