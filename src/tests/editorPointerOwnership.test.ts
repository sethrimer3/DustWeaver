/**
 * Item B regression guards: while a continuous gesture owns the pointer, the
 * per-frame update must not run the whole-room hover hit-test, and must
 * resume it immediately on release.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPointerOwnedByGesture, shouldScanHover,
  type PointerOwnershipInput, type HoverScanInput,
} from '../editor/editorPointerOwnership';

const IDLE: PointerOwnershipInput = {
  hasActiveGesture: false,
  isDragging: false,
  isSelectionBoxActive: false,
  isResizingTransition: false,
  isResizingRect: false,
  isLinkingTransition: false,
};

const OWNERSHIP_FLAGS: (keyof PointerOwnershipInput)[] = [
  'hasActiveGesture', 'isDragging', 'isSelectionBoxActive',
  'isResizingTransition', 'isResizingRect', 'isLinkingTransition',
];

test('idle pointer is not owned by any gesture', () => {
  assert.equal(isPointerOwnedByGesture(IDLE), false);
});

test('every gesture flag on its own claims pointer ownership', () => {
  for (const flag of OWNERSHIP_FLAGS) {
    assert.equal(
      isPointerOwnedByGesture({ ...IDLE, [flag]: true }), true,
      `${flag} must claim the pointer`,
    );
  }
});

function hoverInput(over: Partial<HoverScanInput>): HoverScanInput {
  return { ...IDLE, isSelectTool: true, isOverCanvas: true, ...over };
}

test('hover scan runs on an idle Select-tool frame over the canvas', () => {
  assert.equal(shouldScanHover(hoverInput({})), true);
});

test('hover scan is suppressed by each gesture flag', () => {
  for (const flag of OWNERSHIP_FLAGS) {
    assert.equal(
      shouldScanHover(hoverInput({ [flag]: true })), false,
      `${flag} must suppress hover scanning`,
    );
  }
});

test('hover scan stays off for non-Select tools and over the sidebar', () => {
  assert.equal(shouldScanHover(hoverInput({ isSelectTool: false })), false);
  assert.equal(shouldScanHover(hoverInput({ isOverCanvas: false })), false);
});

// ── Frame-sequence simulation: mirrors the controller's update() shape.
// The hover-scan function must not be invoked for any frame of the drag,
// and must be invoked again on the first frame after release. ────────────

test('drag sequence: hover-scan function is not invoked during the gesture and resumes on release', () => {
  let scans = 0;
  const scan = () => { scans++; };

  const frame = (o: Partial<HoverScanInput>) => {
    if (shouldScanHover(hoverInput(o))) scan();
  };

  frame({});                                                   // idle before press
  assert.equal(scans, 1);

  // 100 frames of drag-to-move with an open gesture transaction.
  for (let i = 0; i < 100; i++) frame({ isDragging: true, hasActiveGesture: true });
  assert.equal(scans, 1, 'zero hover scans across the whole drag');

  // Release clears both flags in the same update pass.
  frame({});
  assert.equal(scans, 2, 'hover resumes on the very first frame after release');
});

test('marquee sequence: zero hover scans while the selection box is being drawn', () => {
  let scans = 0;
  for (let i = 0; i < 60; i++) {
    if (shouldScanHover(hoverInput({ isSelectionBoxActive: true }))) scans++;
  }
  assert.equal(scans, 0);
});
