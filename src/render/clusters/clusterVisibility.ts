/**
 * Pure Enemies-layer gating logic for renderClusters, split into its own
 * module (no sprite/Image-loading imports) so it can be unit-tested in
 * Node without a DOM — renderer.ts transitively imports blockSpriteRenderer,
 * which touches `Image` at module load and cannot be required outside a browser.
 */

import type { EditorRenderMask } from '../../editor/editorRenderMask';
import { isLayerVisibleInMask } from '../../editor/editorRenderMask';

/**
 * Whether a cluster should be drawn under the given mask. The player is
 * always-visible editor infrastructure (the live preview subject, not an
 * authored/placeable element); every other cluster is an enemy AI entity
 * gated by the Enemies layer.
 */
export function isClusterVisibleInMask(isPlayerFlag: 0 | 1, mask: EditorRenderMask | null | undefined): boolean {
  if (isPlayerFlag === 1) return true;
  return isLayerVisibleInMask(mask, 'enemies');
}
