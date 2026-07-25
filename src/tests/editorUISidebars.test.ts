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
  const exportAllIdx = source.indexOf("container.appendChild(exportAllBtn);");
  const mapRowIdx = source.indexOf('container.appendChild(mapButtonRow);');
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

test('right sidebar holds tools/brush/categories/palette; left sidebar holds room settings/layers/inspector/export', () => {
  const source = readEditorUISource();

  const rightMarkers = [
    "toolsSection.body.appendChild(toolBar);",
    "brushSection.body.appendChild(brushRow);",
    "categoriesSection.body.appendChild(catBar);",
    "paletteSection.body.appendChild(paletteDiv);",
  ];
  for (const m of rightMarkers) {
    assert.ok(source.includes(m), `expected right sidebar to contain: ${m}`);
    assert.ok(source.includes(`rightSidebar.appendChild(${m.split('.')[0]}.wrapper);`)
      || source.includes(`rightSidebar.appendChild(${m.split('.')[0]}.wrapper)`),
      `expected the section wrapper for "${m}" to be appended to rightSidebar`);
  }

  const leftMarkers = [
    'roomDimSection.body.appendChild(roomDimDiv);',
    'bgSection.body.appendChild(bgDiv);',
    'songSection.body.appendChild(songDiv);',
    'container.appendChild(layersPanel.div);',
    'inspectorSection.body.appendChild(inspectorDiv);',
    'exportSection.body.appendChild(exportBtn);',
  ];
  for (const m of leftMarkers) {
    assert.ok(source.includes(m), `expected left sidebar to contain: ${m}`);
  }
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
