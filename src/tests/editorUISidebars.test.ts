import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * editorUI.ts can't be imported under Node (it uses Vite's import.meta.env),
 * and this project has no DOM/jsdom test harness — see
 * editorUIPhase5SourceGuards.test.ts's doc comment on this constraint. These
 * are source-level guards for the two-sidebar redesign: two independent
 * 260px sidebars, the Zone Map (M) / Itemized Map (N) button row wired to
 * the existing onOpenVisualMap/onOpenWorldMap callbacks, and removal of the
 * old detached top-right map bar. Panel-level collapsible behavior itself is
 * covered behaviorally in editorUICollapsible.test.ts.
 */
function readEditorUISource(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(__dirname, '../editor/editorUI.ts'), 'utf8');
}

test('two independent 260px sidebars exist: left (#editor-ui) and right (#editor-ui-right)', () => {
  const source = readEditorUISource();
  assert.ok(/container\.id = 'editor-ui';/.test(source));
  assert.ok(/rightSidebar\.id = 'editor-ui-right';/.test(source));
  // Left sidebar pinned to the left edge, right sidebar pinned to the right edge,
  // each 260px wide.
  assert.ok(/position: absolute; top: 0; left: 0; width: 260px; height: 100%;/.test(source));
  assert.ok(/position: absolute; top: 0; right: 0; width: 260px; height: 100%;/.test(source));
  assert.ok(source.includes('root.appendChild(container);'));
  assert.ok(source.includes('root.appendChild(rightSidebar);'));
});

test('Zone Map (M) / Itemized Map (N) button row sits directly below "Save and Export Campaign"', () => {
  const source = readEditorUISource();
  const exportAllIdx = source.indexOf("leftContentGroup.appendChild(exportAllBtn);");
  const mapRowIdx = source.indexOf('leftContentGroup.appendChild(mapButtonRow);');
  assert.ok(exportAllIdx >= 0 && mapRowIdx >= 0);
  assert.ok(mapRowIdx > exportAllIdx, 'map button row must be appended after the Save and Export Campaign button');

  assert.ok(source.includes("makeBtn('🗺 Zone Map (M)', () => callbacks?.onOpenVisualMap())"));
  assert.ok(source.includes("makeBtn('📋 Itemized Map (N)', () => callbacks?.onOpenWorldMap())"));
});

test('the old detached top-right "Zone Map" bar is gone', () => {
  const source = readEditorUISource();
  assert.ok(!source.includes('topRightBar'), 'expected no remaining topRightBar element/wiring');
  assert.ok(!/worldMapBtn/.test(source), 'expected the old detached worldMapBtn to be removed');
});

test('onOpenWorldMap callback exists on EditorUICallbacks and is wired in the controller', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const stateSource = readFileSync(path.join(__dirname, '../editor/editorState.ts'), 'utf8');
  assert.ok(/onOpenWorldMap: \(\) => void;/.test(stateSource));

  const controllerSource = readFileSync(path.join(__dirname, '../editor/editorController.ts'), 'utf8');
  assert.ok(/onOpenWorldMap: \(\) => \{ void openWorldMap\(\); \},/.test(controllerSource));
});

test('every sidebar panel is still built and populated with its expected content', () => {
  const source = readEditorUISource();
  // Panel *content* wiring is unchanged by the docking system — only where
  // the finished wrapper gets mounted moved. Which sidebar owns each panel is
  // now data in editorPanelRegistry.ts, asserted behaviorally in
  // editorPanelLayout.test.ts rather than by grepping appendChild calls.
  const contentMarkers = [
    'toolsSection.body.appendChild(toolBar);',
    'brushSection.body.appendChild(brushRow);',
    'categoriesSection.body.appendChild(catBar);',
    'paletteSection.body.appendChild(paletteDiv);',
    'roomDimSection.body.appendChild(roomDimDiv);',
    'bgSection.body.appendChild(bgDiv);',
    'songSection.body.appendChild(songDiv);',
    'inspectorSection.body.appendChild(inspectorDiv);',
    'exportSection.body.appendChild(exportBtn);',
  ];
  for (const m of contentMarkers) {
    assert.ok(source.includes(m), `expected editorUI.ts to populate: ${m}`);
  }
});

test('panels are mounted by the docking registry, not by hardcoded sidebar appends', () => {
  const source = readEditorUISource();
  // The old hardcoded placement calls must be gone — otherwise a panel would
  // be pinned to one sidebar and silently fight the restored layout.
  for (const stale of [
    'rightContentGroup.appendChild(toolsSection.wrapper)',
    'rightContentGroup.appendChild(brushSection.wrapper)',
    'rightContentGroup.appendChild(categoriesSection.wrapper)',
    'rightContentGroup.appendChild(paletteSection.wrapper)',
    'leftContentGroup.appendChild(roomDimSection.wrapper)',
    'leftContentGroup.appendChild(bgSection.wrapper)',
    'leftContentGroup.appendChild(songSection.wrapper)',
    'leftContentGroup.appendChild(layersPanel.div)',
    'leftContentGroup.appendChild(inspectorSection.wrapper)',
    'leftContentGroup.appendChild(exportSection.wrapper)',
  ]) {
    assert.ok(!source.includes(stale), `expected hardcoded placement to be gone: ${stale}`);
  }

  // Each dockable panel is registered with the docking controller instead.
  assert.ok(source.includes('createEditorPanelDocking('));
  for (const registration of [
    "{ id: 'tools', element: toolsSection.wrapper }",
    "{ id: 'brush', element: brushSection.wrapper }",
    "{ id: 'categories', element: categoriesSection.wrapper }",
    "{ id: 'palette', element: paletteSection.wrapper }",
    "{ id: 'roomDimensions', element: roomDimSection.wrapper }",
    "{ id: 'background', element: bgSection.wrapper }",
    "{ id: 'roomSong', element: songSection.wrapper }",
    "{ id: 'layers', element: layersPanel.div }",
    "{ id: 'inspector', element: inspectorSection.wrapper }",
    "{ id: 'export', element: exportSection.wrapper }",
  ]) {
    assert.ok(source.includes(registration), `expected panel registration: ${registration}`);
  }
});

test('fixed editor chrome stays pinned and is never registered as a dockable panel', () => {
  const source = readEditorUISource();
  // Title, save/confirm bar, campaign export, map row, density indicator and
  // dev checks must keep appending straight into the left content group —
  // they are workspace chrome, not movable menus.
  for (const fixed of [
    'leftContentGroup.appendChild(title);',
    'leftContentGroup.appendChild(confirmCancelBar);',
    'leftContentGroup.appendChild(exportAllBtn);',
    'leftContentGroup.appendChild(mapButtonRow);',
    'leftContentGroup.appendChild(densityIndicator);',
    'leftContentGroup.appendChild(devToolsDiv);',
  ]) {
    assert.ok(source.includes(fixed), `expected fixed chrome to stay put: ${fixed}`);
  }
  // The hide arrows and reveal tabs remain attached to the physical shells.
  assert.ok(source.includes('container.appendChild(leftHideArrow);'));
  assert.ok(source.includes('rightSidebar.appendChild(rightHideArrow);'));
  assert.ok(source.includes('root.appendChild(leftRevealTab);'));
  assert.ok(source.includes('root.appendChild(rightRevealTab);'));
});

test('every top-level panel is built with createCollapsibleSection (no ad-hoc duplicated collapse logic)', () => {
  const source = readEditorUISource();
  const expectedSections = [
    "createCollapsibleSection('Tools'",
    "createCollapsibleSection('Brush'",
    "createCollapsibleSection('Room Dimensions'",
    "createCollapsibleSection('Background'",
    "createCollapsibleSection('Room Song'",
    "createCollapsibleSection('Categories'",
    "createCollapsibleSection('Palette'",
    "createCollapsibleSection('Inspector'",
    "createCollapsibleSection('Export'",
  ];
  for (const s of expectedSections) {
    assert.ok(source.includes(s), `expected editorUI.ts to build a section via: ${s}`);
  }
});
