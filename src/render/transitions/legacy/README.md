# Legacy Transition Code

This directory documents the location of legacy fancy room-transition files that are
**no longer imported by active gameplay code**.

## Why These Files Exist

The following files were written for cinematic transition features (edge-extension rendering,
camera reveal offsets, next-room preview strips, preview bubbles, and two-room crossing).
All of these features were **disabled** via feature flags and have now been formally retired
from the active import graph.

They are preserved here for historical/reference purposes only.

## Legacy Files

The following files remain in `src/render/transitions/` with `LEGACY:` headers to indicate
they are not part of normal gameplay:

| File | Description |
|------|-------------|
| `transitionCameraReveal.ts` | Smooth camera offset as player approaches room edges |
| `transitionPreviewContext.ts` | Preview context for connected-room facing-edge strip |
| `transitionPreviewTypes.ts` | Shared types for the preview context system |
| `previewBubbleState.ts` | Proximity-based transition portal bubble state |
| `previewBubbleRenderer.ts` | Renders glowing portal bubbles near transitions |
| `edgeExtensionCache.ts` | BFS-based tile cache for wall tiles beyond the room boundary |
| `edgeExtensionRenderer.ts` | Renders procedural edge-extension tiles |
| `nextRoomEdgeRenderer.ts` | Renders connected room's 2-block facing-edge strip |

The following files remain in `src/screens/` with `LEGACY:` headers:

| File | Description |
|------|-------------|
| `twoRoomCrossing.ts` | Two-room smooth camera-crossing state machine |
| `gameSeamlessStaging.ts` | Seamless two-room staged-world state |

## How to Re-enable

Re-enabling any of these systems would require:

1. A deliberate future pass to re-import the relevant files into `gameScreen.ts`
   and `gameRender.ts`.
2. Restoring the feature flags in `transitionConfig.ts`.
3. Re-adding edge-extension cache building in `preparedRoomRuntime.ts`,
   `roomPreparationWorker.ts`, and `gameScreen.ts` Phase F.
4. Adding back the render parameters to `RenderFrameContext` in `gameRender.ts`.

**Do not re-enable these without a deliberate design decision.**
