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
 * `editorRenderer.ts` and `gameScreenEditorBackdrop.ts` each derive exactly
 * one `EditorRenderMask` per frame (via `buildEditorRenderMask`) and pass it
 * down to every render call that needs it — no other call site should call
 * `isLayerVisible`/`isAnyLayerSoloed` (editorLayers.ts) directly.
 *
 * ── `editorMetadata` vs `debug`: two distinct, non-overlapping layers ──────
 *
 * `editorMetadata` ("Editor Metadata" in the layers panel) owns:
 *   - Room/campaign structural guides and informational indicators that are
 *     authored-content-adjacent but not themselves placed gameplay elements
 *     (e.g. the ambient-light-direction indicator in
 *     editorPlacementPreviewDrawer.ts's drawEditorUIOverlays).
 *   - NOT guide dust paths / dialogue triggers / spawn markers — those are
 *     genuine placed elements with their own dedicated, more granular layers
 *     (`paths`, `triggers`, `roomStructure` respectively, via
 *     `ELEMENT_TYPE_LAYER` in editorLayers.ts) predating this mask. Routing
 *     them through `editorMetadata` instead would collapse an existing,
 *     independently-toggleable distinction into one bucket — not a Phase 4 goal.
 *
 * `debug` ("Debug" in the layers panel) owns:
 *   - Diagnostic/profiler overlays: the high-resolution debug overlay
 *     (renderHighResolutionDebugOverlay) — hiding this layer suppresses it
 *     even when the *global* runtime debug-mode flag (isDebugMode) is on;
 *     both must be true for it to draw.
 *   - Hitbox/collision visualization: the wall-AABB debug outline
 *     (renderWalls' isDebugMode param) and cluster hitbox outlines
 *     (renderClusters' showHitboxes param), as driven from the editor
 *     backdrop specifically.
 *
 * ── Always-visible editor infrastructure (never gated by ANY layer) ────────
 * Selection outlines, the cursor highlight, the placement preview ghost,
 * resize/drag handles, the marquee/selection-box, and blocked-placement
 * feedback are core editing affordances, not authored content — hiding
 * `editorMetadata` or `debug` (or any other layer) must never hide them. See
 * drawEditorUIOverlays / drawPlacementPreview in editorPlacementPreviewDrawer.ts,
 * which are called unconditionally by editorRenderer.ts regardless of mask state.
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
