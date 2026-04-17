/**
 * Block sprite catalog.
 *
 * Enumerates available sprite variations by probing a fixed set of sequential
 * URLs at the known naming convention.  Failed probes (404s) are silently
 * ignored — only successfully loaded images are included in variation pools.
 *
 * This means new sprite variations can be added to the asset folders without
 * touching this file, provided the filenames follow the convention:
 *   <prefix> (N).png   where N = 1, 2, 3, …
 *
 * Template URLs are fixed (one file per shape) and do not need probing.
 */

// ── Probe helpers ─────────────────────────────────────────────────────────────

/** Maximum number of sequential file indices to probe per folder. */
const _MAX_PROBE_COUNT = 50;

/**
 * Builds a list of probe URLs for a folder following the "(N)" naming convention.
 * Every URL is attempted; only those that successfully load contribute to pools.
 */
function _buildProbeUrls(dirPath: string, filePrefix: string): readonly string[] {
  const urls: string[] = [];
  for (let i = 1; i <= _MAX_PROBE_COUNT; i++) {
    urls.push(`${dirPath}/${filePrefix} (${i}).png`);
  }
  return urls;
}

// ── Base sprite probe pools ───────────────────────────────────────────────────

/**
 * Probe URLs for the blackRock 1×1 base sprites.
 * Shapes that use this pool: 1×1 block, 1×1 platform, 1×1 ramp.
 */
export const BLACKROCK_1X1_PROBE_URLS: readonly string[] = _buildProbeUrls(
  'SPRITES/BLOCKS/blackRock/block 1x1',
  'blackRock_block_1x1',
);

/**
 * Probe URLs for the blackRock 2×2 base sprites.
 * Shapes that use this pool: 2×2 block, 2×2 platform, 2×2 ramp, 1×2 ramp.
 */
export const BLACKROCK_2X2_PROBE_URLS: readonly string[] = _buildProbeUrls(
  'SPRITES/BLOCKS/blackRock/block 2x2',
  'blackRock_block_2x2',
);

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
 *
 * @param material   Block material name, e.g. `'blackRock'`.
 * @param use2x2Pool True when the shape uses the 2×2 base pool.
 *                   False for shapes that use the 1×1 base pool.
 * @returns          An array of probe URLs, or an empty array for unsupported materials.
 */
export function getBaseSpriteProbePool(material: string, use2x2Pool: boolean): readonly string[] {
  if (material === 'blackRock') {
    return use2x2Pool ? BLACKROCK_2X2_PROBE_URLS : BLACKROCK_1X1_PROBE_URLS;
  }
  return [];
}
