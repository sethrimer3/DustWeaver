/**
 * Phase 3.1, Fix 3: registry invariants.
 *
 * Guards against silent drift between `CLICK_PRIORITY_ORDER` (editorTools.ts)
 * and the exhaustive adapter registry (editorElementRegistry.ts):
 *  - No duplicate entries in `CLICK_PRIORITY_ORDER`.
 *  - Every click-selectable type appears exactly once.
 *  - Every type intentionally omitted from click priority is explicitly
 *    listed in `CLICK_PRIORITY_OMITTED` (and documented there).
 *  - Together, `CLICK_PRIORITY_ORDER` and `CLICK_PRIORITY_OMITTED` cover
 *    every `SelectedElementType` exactly once — no forgotten type.
 *  - Every type with a registered adapter is marquee-selectable (a defined,
 *    non-no-op `marqueeTest`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SelectedElementType } from '../editor/editorElementTypes';
import { ALL_ELEMENT_TYPES, ELEMENT_ADAPTERS, CLICK_PRIORITY_OMITTED } from '../editor/editorElementRegistry';
import { CLICK_PRIORITY_ORDER } from '../editor/editorTools';

test('CLICK_PRIORITY_ORDER has no duplicate entries', () => {
  const seen = new Set<SelectedElementType>();
  for (const type of CLICK_PRIORITY_ORDER) {
    assert.ok(!seen.has(type), `duplicate entry in CLICK_PRIORITY_ORDER: ${type}`);
    seen.add(type);
  }
});

test('CLICK_PRIORITY_OMITTED has no duplicate entries and no overlap with CLICK_PRIORITY_ORDER', () => {
  const seen = new Set<SelectedElementType>();
  for (const type of CLICK_PRIORITY_OMITTED) {
    assert.ok(!seen.has(type), `duplicate entry in CLICK_PRIORITY_OMITTED: ${type}`);
    seen.add(type);
  }
  const orderSet = new Set(CLICK_PRIORITY_ORDER);
  for (const type of CLICK_PRIORITY_OMITTED) {
    assert.ok(!orderSet.has(type), `${type} is in both CLICK_PRIORITY_ORDER and CLICK_PRIORITY_OMITTED`);
  }
});

test('CLICK_PRIORITY_ORDER + CLICK_PRIORITY_OMITTED together cover every SelectedElementType exactly once', () => {
  const combined = [...CLICK_PRIORITY_ORDER, ...CLICK_PRIORITY_OMITTED];
  const combinedSet = new Set(combined);
  assert.equal(combined.length, combinedSet.size, 'combined lists must not contain duplicates across each other');
  assert.equal(combinedSet.size, ALL_ELEMENT_TYPES.length, 'combined lists must cover every SelectedElementType');
  for (const type of ALL_ELEMENT_TYPES) {
    assert.ok(combinedSet.has(type), `${type} is missing from both CLICK_PRIORITY_ORDER and CLICK_PRIORITY_OMITTED`);
  }
});

test('every SelectedElementType with an adapter is marquee-selectable', () => {
  // A trivially-false marqueeTest (never selects anything regardless of
  // input) would be a silent no-op; probe with a huge rect that should catch
  // any element at a "reasonable" position, plus the adapter's own enumerate
  // results where available, to at least confirm the function is present and
  // callable, not a stub.
  const hugeRect = { minX: -100000, minY: -100000, maxX: 100000, maxY: 100000 };
  for (const type of ALL_ELEMENT_TYPES) {
    const adapter = ELEMENT_ADAPTERS[type];
    assert.equal(typeof adapter.marqueeTest, 'function', `${type} has no marqueeTest`);
    // Construct a minimal, adapter-appropriate synthetic element at (0,0) to
    // confirm the test isn't a hardcoded `() => false` no-op. We probe using
    // whatever shape the adapter's own hitTest/marqueeTest actually reads —
    // since every adapter's enumerated element exposes at least xBlock/yBlock
    // (or a rope/guideDustPath's anchor/points fields), a synthetic point-like
    // element covers all current shapes.
    const synthetic: Record<string, unknown> = {
      uid: 1, xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1,
      anchorAXBlock: 0, anchorAYBlock: 0, anchorBXBlock: 0, anchorBYBlock: 0,
      points: [{ xBlock: 0, yBlock: 0 }, { xBlock: 0, yBlock: 0 }], loop: false,
      xWorld: 0, yWorld: 0, xPixel: 0, yPixel: 0, size: '1x1',
      tileWidth: 1, tileHeight: 1,
      direction: 'right', openingSizeBlocks: 1, gradientWidthBlocks: 3,
    };
    const result = adapter.marqueeTest(synthetic, hugeRect, {} as never);
    assert.equal(result, true, `${type}'s marqueeTest looks like a no-op (always false) for an element at the origin inside a huge marquee`);
  }
});
