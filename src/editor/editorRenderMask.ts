/**
 * Centralized render-visibility mask for the editor.
 *
 * Render paths that are shared between runtime gameplay and the editor
 * backdrop (particles, tunnel darkness, the debug overlay, …) accept an
 * optional `EditorRenderMask | null`. Passing `null` (or omitting it) means
 * "runtime" — everything is visible, matching pre-Phase-4 behavior exactly.
 * Passing a mask built from the live `EditorState` (via
 * `buildEditorRenderMask`) applies the editor's layer visibility/solo rules.
 *
 * This does not replace `isLayerVisible`/`isAnyLayerSoloed` in editorLayers.ts
 * — editor-only call sites (editorRenderer.ts) may keep calling those
 * directly. The mask exists for call sites that are reached from BOTH
 * runtime and editor code, where threading a full `EditorState` through
 * would leak editor concerns into gameplay render functions.
 */

import type { EditorState } from './editorState';
import { LAYER_IDS, type LayerId, isAnyLayerSoloed, isLayerVisible } from './editorLayers';

export interface EditorRenderMask {
  isLayerVisible: (layerId: LayerId) => boolean;
  isLayerSolo: (layerId: LayerId) => boolean;
  /** The soloed layer, if any layer is in solo mode (first one found in display order). */
  activeSoloLayer: LayerId | null;
}

export function buildEditorRenderMask(state: EditorState): EditorRenderMask {
  const soloed = isAnyLayerSoloed(state);
  let activeSoloLayer: LayerId | null = null;
  if (soloed) {
    for (const id of LAYER_IDS) {
      if (state.layers[id].solo) {
        activeSoloLayer = id;
        break;
      }
    }
  }
  return {
    isLayerVisible: (layerId: LayerId) => isLayerVisible(state, layerId),
    isLayerSolo: (layerId: LayerId) => state.layers[layerId].solo,
    activeSoloLayer,
  };
}

/** `mask === null || mask === undefined` reads as "runtime, everything visible". */
export function isLayerVisibleInMask(mask: EditorRenderMask | null | undefined, layerId: LayerId): boolean {
  if (mask === null || mask === undefined) return true;
  return mask.isLayerVisible(layerId);
}
