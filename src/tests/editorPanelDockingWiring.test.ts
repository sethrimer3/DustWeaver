import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Source-level guards for the parts of the dockable-panel system that are
 * inherently DOM/pointer wiring and therefore cannot be covered behaviorally
 * without a jsdom harness (this repo has none — see
 * editorUIPhase5SourceGuards.test.ts for the standing constraint).
 *
 * Everything that CAN be tested for real is: layout rules live in
 * editorPanelLayout.test.ts, geometry/clamping in editorFloatingGeometry.test.ts,
 * canvas shielding in editorUIHitRegions.test.ts, and persistence in
 * editorWorkspacePanelLayout.test.ts. Keep this file limited to wiring that
 * those cannot reach.
 */
function readSource(relPath: string): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(__dirname, relPath), 'utf8');
}

test('drag uses Pointer Events with pointer capture, and starts only from the grip', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  assert.ok(source.includes("grip.addEventListener('pointerdown'"), 'drag begins on the grip');
  assert.ok(source.includes('setPointerCapture'), 'the drag owns the pointer');
  assert.ok(source.includes('releasePointerCapture'));
  assert.ok(source.includes("window.addEventListener('pointermove'"));
  assert.ok(source.includes("window.addEventListener('pointerup'"));
  assert.ok(source.includes("window.addEventListener('pointercancel'"), 'cancel is handled too');
  // No HTML5 drag-and-drop / mouse-event fallback should have crept in.
  assert.ok(!source.includes("addEventListener('dragstart'"));
  assert.ok(!source.includes("addEventListener('mousedown'"));
});

test('a below-threshold grip press is treated as a click and never reorders or toggles collapse', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  assert.ok(source.includes('DRAG_THRESHOLD_PX'));
  assert.ok(source.includes('exceededThreshold'));
  // The no-drag branch re-applies the existing layout and deliberately does
  // nothing else (in particular it must not toggle the panel's collapse).
  assert.ok(/if \(!wasDragging\) \{[\s\S]*?applyLayout\(layout\);[\s\S]*?return;/.test(source));
});

test('panel DOM is re-parented, never destroyed or rebuilt, during a move', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  // The panel's own element is adopted once at host construction.
  assert.ok(source.includes('host.appendChild(reg.element);'));
  // Nothing in the docking coordinator may tear down panel content.
  assert.ok(!source.includes('innerHTML'), 'no innerHTML wipes');
  assert.ok(!source.includes('replaceChildren'), 'no wholesale child replacement');
});

test('floating panels sit above the sidebars but below modal dialogs', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  const match = source.match(/const FLOATING_LAYER_Z_INDEX = (\d+);/);
  assert.ok(match !== null, 'expected an explicit floating-layer z-index');
  const z = Number(match![1]);
  assert.ok(z > 900, `floating panels must be above the 900 sidebars, got ${z}`);
  assert.ok(z < 1100, `floating panels must stay below the 1100+ modal layers, got ${z}`);
});

test('the floating layer does not swallow canvas input in its empty areas', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  assert.ok(/floatingLayer\.style\.cssText = `[\s\S]*?pointer-events: none;/.test(source),
    'the layer itself must be pointer-transparent');
  assert.ok(/styleHostAsFloating[\s\S]*?pointer-events: auto;/.test(source),
    'each floating window re-enables pointer events for itself');
});

test('drop affordances exist: insertion placeholder, sidebar highlight, auto-scroll, empty hint', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  assert.ok(source.includes('showPlaceholderAt('), 'insertion indicator');
  assert.ok(source.includes('highlightSidebar('), 'active drop-target highlight');
  assert.ok(source.includes('AUTO_SCROLL_EDGE_PX') && source.includes('tickAutoScroll'),
    'sidebar auto-scroll near the edges while dragging');
  assert.ok(source.includes("hint.textContent = 'Drop panels here';"), 'empty-sidebar drop target');
});

test('dropping on a hidden sidebar docks there and asks for it to be revealed', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  assert.ok(/if \(!callbacks\.isSidebarVisible\(target\.side\)\) callbacks\.onRequestRevealSidebar\(target\.side\);/
    .test(source));
});

test('every floating placement routes through the reachability clamp', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  // Drop-to-float, the Float button, and the resize handler must all clamp.
  const clampCalls = source.match(/clampFloatingPanelPosition\(/g) ?? [];
  assert.ok(clampCalls.length >= 2, `expected drop and Float-button clamping, found ${clampCalls.length}`);
  assert.ok(source.includes('clampAllFloatingPanels('), 'viewport resize re-clamps everything');
  assert.ok(source.includes("window.addEventListener('resize', onResize);"));
});

test('interacting with a floating panel raises it to the front', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  assert.ok(source.includes('bringFloatingPanelToFront(layout, reg.id)'));
});

test('non-drag fallback actions (Dock Left, Dock Right, Float) exist and are labelled', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  assert.ok(source.includes('Dock ${def.title} to the left sidebar'));
  assert.ok(source.includes('Dock ${def.title} to the right sidebar'));
  assert.ok(source.includes('Float the ${def.title} panel'));
  // Accessible names, not icon-only buttons.
  assert.ok(source.includes("btn.setAttribute('aria-label', title);"));
  assert.ok(source.includes("grip.setAttribute('aria-label'"));
});

test('destroy() removes every listener, the floating layer, and any in-flight drag', () => {
  const source = readSource('../editor/editorPanelDocking.ts');
  const destroyIdx = source.indexOf('destroy: () => {');
  assert.ok(destroyIdx >= 0);
  const destroyBody = source.slice(destroyIdx);
  for (const cleanup of [
    "window.removeEventListener('pointermove', onPointerMove);",
    "window.removeEventListener('pointerup', onPointerUp);",
    "window.removeEventListener('pointercancel', onPointerCancel);",
    "window.removeEventListener('resize', onResize);",
    'stopAutoScroll();',
    'hidePlaceholder();',
    'floatingLayer.parentElement.removeChild(floatingLayer);',
  ]) {
    assert.ok(destroyBody.includes(cleanup), `destroy() must perform: ${cleanup}`);
  }
});

// ── editorUI.ts integration ─────────────────────────────────────────────────

test('EditorUI exposes the floating-rect snapshot and drag flag the controller needs', () => {
  const source = readSource('../editor/editorUI.ts');
  assert.ok(source.includes('getFloatingPanelRects: () => EditorUIRect[];'));
  assert.ok(source.includes('isPanelDragActive: () => boolean;'));
  assert.ok(source.includes('setPanelLayoutChangeHandler:'));
  // And the docking controller is torn down with the UI.
  assert.ok(source.includes('docking.destroy();'));
});

test('restoring a saved layout re-clamps it against the current viewport', () => {
  const source = readSource('../editor/editorUI.ts');
  // A layout saved on a bigger monitor must not strand a panel off-screen.
  assert.ok(/applyWorkspaceUIPrefs[\s\S]*?clampAllFloatingPanels\(prefs\.panelLayout/.test(source));
});

test('controller feeds floating rects and the drag flag into every canvas gesture', () => {
  const source = readSource('../editor/editorController.ts');
  assert.ok(source.includes('floatingPanelRects: ui?.getFloatingPanelRects() ?? [],'),
    'rects are snapshotted once per frame into the shared hit-region params');
  assert.ok(source.includes('const isPanelDragActive = ui?.isPanelDragActive() ?? false;'));
  assert.ok(/isOverEditorCanvas = \(xPx: number, yPx: number\): boolean =>\s*\n?\s*!isPanelDragActive && isPointOverEditorCanvas\(xPx, yPx, uiHitRegionParams\);/
    .test(source), 'an active panel drag suppresses every canvas gesture');

  // Every gesture call site passes both axes now.
  const calls = source.match(/isOverEditorCanvas\([^)]*\)/g) ?? [];
  const gestureCalls = calls.filter(c => c.includes('inputState.'));
  assert.ok(gestureCalls.length >= 6, `expected >=6 gesture call sites, found ${gestureCalls.length}`);
  for (const call of gestureCalls) {
    assert.ok(/ScreenXPx, .*ScreenYPx/.test(call), `call site must pass X and Y: ${call}`);
  }
});

test('panel layout changes are persisted through the debounced workspace saver only', () => {
  const source = readSource('../editor/editorController.ts');
  assert.ok(source.includes('ui.setPanelLayoutChangeHandler('));
  assert.ok(/setPanelLayoutChangeHandler\(\(_layout: EditorPanelLayout\) => \{ scheduleWorkspaceSave\(\); \}\);/
    .test(source), 'layout changes go through the existing debounced saver, not ad hoc storage writes');
  assert.ok(source.includes('panelLayout: uiSnapshot?.panelLayout ?? defaultPanelLayout(),'));
  // Never room data: no dirty flag or history entry on a layout change.
  const handlerIdx = source.indexOf('setPanelLayoutChangeHandler(');
  const handlerLine = source.slice(handlerIdx, handlerIdx + 200);
  assert.ok(!handlerLine.includes('markDirty'), 'layout must never mark a room dirty');
  assert.ok(!handlerLine.includes('pushHistory'), 'layout must never create an undo entry');
});

test('Reset Workspace restores panel layout and both sidebar scroll positions', () => {
  const source = readSource('../editor/editorController.ts');
  const resetIdx = source.indexOf('onResetWorkspace: () => {');
  assert.ok(resetIdx >= 0);
  const resetBody = source.slice(resetIdx, resetIdx + 900);
  assert.ok(resetBody.includes('panelLayout: resetWorkspacePanelLayout(),'));
  assert.ok(resetBody.includes('leftSidebarScrollTop: 0,'));
  assert.ok(resetBody.includes('rightSidebarScrollTop: 0,'));
});

test('panel layout never reaches campaign/room serialization', () => {
  // A layout leaking into exported campaign JSON would be a data-model bug.
  for (const rel of ['../editor/roomJson.ts', '../editor/editorRoomBuilder.ts']) {
    const source = readSource(rel);
    assert.ok(!source.includes('panelLayout'), `${rel} must not know about panelLayout`);
  }
});
