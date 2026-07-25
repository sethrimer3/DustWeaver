/**
 * Pointer-ownership policy for the editor's per-frame update.
 *
 * When a continuous gesture (drag-to-move, rectangle-handle resize,
 * transition edge-resize, marquee) owns the pointer, the pointer is by
 * definition already "on" the thing being manipulated — running the normal
 * hover resolution (`selectAtCursor`, a whole-room hit-test scan) every frame
 * is pure waste and can also make the tooltip flicker onto elements the drag
 * happens to sweep over.
 *
 * These are pure predicates so the policy is unit-testable without the DOM /
 * canvas / input plumbing the controller needs.
 */

export interface PointerOwnershipInput {
  /** A gesture transaction is open (drag/resize). */
  hasActiveGesture: boolean;
  /** Drag-to-move is in progress. */
  isDragging: boolean;
  /** Marquee selection box is being drawn. */
  isSelectionBoxActive: boolean;
  /** Transition edge-resize is in progress. */
  isResizingTransition: boolean;
  /** Rect-handle (challenge field/gate/gate/zip block) resize is in progress. */
  isResizingRect: boolean;
  /** Transition link-drag is in progress. */
  isLinkingTransition: boolean;
}

/**
 * True when a continuous interaction owns the pointer for this frame.
 */
export function isPointerOwnedByGesture(input: PointerOwnershipInput): boolean {
  return input.hasActiveGesture
      || input.isDragging
      || input.isSelectionBoxActive
      || input.isResizingTransition
      || input.isResizingRect
      || input.isLinkingTransition;
}

export interface HoverScanInput extends PointerOwnershipInput {
  /** Select tool active (hover tooltips only exist for Select). */
  isSelectTool: boolean;
  /** Pointer is over the canvas, not the editor sidebar. */
  isOverCanvas: boolean;
}

/**
 * True when the frame should run the (whole-room) hover hit-test scan.
 * Hover resumes on the very first frame after the gesture releases, because
 * every ownership flag is cleared in the same update pass as the release.
 */
export function shouldScanHover(input: HoverScanInput): boolean {
  if (!input.isSelectTool) return false;
  if (!input.isOverCanvas) return false;
  return !isPointerOwnedByGesture(input);
}
