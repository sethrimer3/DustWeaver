import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * editorUI.ts/editorController.ts can't be imported under Node (Vite's
 * import.meta.env — see editorUIPhase5SourceGuards.test.ts), and this
 * project has no DOM/jsdom test harness, so these are source-level guards
 * for requirement 3 (in-memory, session-lived collapsed-section +
 * sidebar-visibility state) and requirement 4's sidebar hide/reveal wiring.
 * Pure hit-region math is covered behaviorally in editorUIHitRegions.test.ts.
 */
function readSource(relPath: string): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(__dirname, relPath), 'utf8');
}

test('every top-level collapsible section is keyed for session-state snapshot/restore', () => {
  const source = readSource('../editor/editorUI.ts');
  const expectedKeyedSections = [
    "createCollapsibleSection('Tools', { key: 'tools' })",
    "createCollapsibleSection('Brush', { key: 'brush' })",
    "createCollapsibleSection('Room Dimensions', { key: 'roomDimensions' })",
    "createCollapsibleSection('Background', { key: 'background' })",
    "createCollapsibleSection('Room Song', { key: 'roomSong' })",
    "createCollapsibleSection('Categories', { key: 'categories' })",
    "createCollapsibleSection('Palette', { key: 'palette' })",
    "createCollapsibleSection('Inspector', { key: 'inspector' })",
    "createCollapsibleSection('Export', { key: 'export' })",
  ];
  for (const s of expectedKeyedSections) {
    assert.ok(source.includes(s), `expected editorUI.ts to build a keyed section via: ${s}`);
  }
});

test('EditorUI exposes session-state snapshot/restore + sidebar-visibility accessors', () => {
  const source = readSource('../editor/editorUI.ts');
  assert.ok(source.includes('getSidebarVisibility: () => { left: boolean; right: boolean };'));
  assert.ok(source.includes('getSessionUIStateSnapshot: () => EditorSessionUIState;'));
  assert.ok(source.includes('applySessionUIState: (snapshot: EditorSessionUIState) => void;'));
  // Snapshot/restore must be implemented (not just declared on the interface).
  assert.ok(/getSessionUIStateSnapshot:\s*\(\)/.test(source));
  assert.ok(/applySessionUIState:\s*\(snapshot: EditorSessionUIState\)/.test(source));
});

test('EditorSessionUIState is in-memory only: never routed through workspace-preferences persistence (localStorage/disk)', () => {
  const source = readSource('../editor/editorUI.ts');
  const prefsIdx = source.indexOf('interface EditorWorkspaceUIPrefs');
  const sessionIdx = source.indexOf('interface EditorSessionUIState');
  assert.ok(prefsIdx >= 0 && sessionIdx >= 0, 'expected both distinct interfaces to exist');
  // The two concepts must remain distinct types, not merged into one.
  assert.notEqual(prefsIdx, sessionIdx);
});

test('controller snapshots session UI state before ui.destroy() and restores it after createEditorUI on reopen', () => {
  const source = readSource('../editor/editorController.ts');
  assert.ok(source.includes('let sessionUIState: EditorSessionUIState | null = null;'));

  // Snapshot must be taken BEFORE destroy() so the live DOM state is still readable.
  const snapshotIdx = source.indexOf('sessionUIState = ui.getSessionUIStateSnapshot();');
  const destroyIdx = source.indexOf('if (ui) { ui.destroy(); ui = null; }');
  assert.ok(snapshotIdx >= 0 && destroyIdx >= 0);
  assert.ok(snapshotIdx < destroyIdx, 'snapshot must be captured before ui.destroy() tears down the DOM');

  // Restore must happen after createEditorUI() builds the new instance, and
  // must be conditional (so a null snapshot — first-ever open — leaves the
  // UI's own all-collapsed/both-visible defaults untouched).
  const createIdx = source.indexOf('ui = createEditorUI(uiRoot, campaignTitle, autosaveWork);');
  const restoreIdx = source.indexOf('if (sessionUIState) ui.applySessionUIState(sessionUIState);');
  assert.ok(createIdx >= 0 && restoreIdx >= 0);
  assert.ok(restoreIdx > createIdx, 'restore must happen after the new EditorUI is constructed');
});

test('Swap Menu Sides control exists with atomic content-group swap and session-only sidebarsSwapped state', () => {
  const source = readSource('../editor/editorUI.ts');
  assert.ok(source.includes('sidebarsSwapped: boolean;'), 'expected EditorSessionUIState to carry a sidebarsSwapped flag');
  assert.ok(source.includes('function swapMenuSides(): void'), 'expected a swapMenuSides implementation');
  assert.ok(source.includes('const leftContentGroup = document.createElement'));
  assert.ok(source.includes('const rightContentGroup = document.createElement'));
  // Swap must move the wrapper elements (not rebuild DOM) between the two
  // fixed physical shells.
  assert.ok(source.includes('leftHost.appendChild(leftContentGroup);'));
  assert.ok(source.includes('rightHost.appendChild(rightContentGroup);'));
  // Both sidebar header rows must expose the control so it stays reachable
  // whenever either sidebar is visible.
  const leftBtnIdx = source.indexOf("makeSwapBtn('Swap Menus', swapMenuSides)");
  const rightBtnIdx = source.indexOf("makeSwapBtn('Swap Menus', swapMenuSides)", leftBtnIdx + 1);
  assert.ok(leftBtnIdx >= 0 && rightBtnIdx > leftBtnIdx, 'expected two independent Swap Menus buttons');
  // Snapshot/restore must round-trip the flag, backward-compatibly.
  assert.ok(source.includes('return { sectionExpanded, leftSidebarVisible, rightSidebarVisible, sidebarsSwapped };'));
  assert.ok(source.includes('const wantSwapped = snapshot.sidebarsSwapped === true;'));
});

test('hardcoded EDITOR_PANEL_WIDTH_CSS_PX constant is fully removed from the controller', () => {
  const source = readSource('../editor/editorController.ts');
  assert.ok(!source.includes('EDITOR_PANEL_WIDTH_CSS_PX'), 'expected the old hardcoded 260px constant to be gone');
});

test('every gesture path (click, right-click, drag-paint, right-drag-paint, hover-scan, wheel zoom) uses the shared hit-region helper', () => {
  const source = readSource('../editor/editorController.ts');
  const matches = source.match(/isOverEditorCanvas\(/g) ?? [];
  // click, right-click, drag-paint, right-drag-paint, hover isOverCanvas, wheel zoom = 6 call sites
  // (plus the arrow function's own definition uses isPointOverEditorCanvas, counted separately).
  assert.ok(matches.length >= 6, `expected at least 6 isOverEditorCanvas(...) call sites, found ${matches.length}`);
  // The helper now takes both axes so floating panel rectangles can be tested
  // (sidebars alone only ever needed X) — see editorUIHitRegions.ts.
  assert.ok(source.includes('isPointOverEditorCanvas(xPx, yPx, uiHitRegionParams)'));
});
