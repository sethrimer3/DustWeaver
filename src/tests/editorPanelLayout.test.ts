import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPanelLayout, normalizePanelLayout, clonePanelLayout,
  dockPanel, floatPanel, moveFloatingPanel, bringFloatingPanelToFront,
  getPanelLocation, getSidebarPanelIds, getFloatingPanelIdsByZ,
  isPanelLayoutComplete,
  type EditorPanelLayout,
} from '../editor/editorPanelLayout';
import {
  EDITOR_PANEL_IDS, EDITOR_PANEL_DEFS, defaultPanelIdsForSide,
  isEditorPanelId, getEditorPanelDef,
} from '../editor/editorPanelRegistry';

/**
 * Behavioral coverage for the dockable-panel layout model. The editor UI has
 * no jsdom harness (see editorUIPhase5SourceGuards.test.ts), so the layout
 * *rules* live in this pure module precisely so they can be tested for real
 * rather than through source-string guards.
 */

// ── Registry / default layout ───────────────────────────────────────────────

test('default layout places Layers immediately below Inspector', () => {
  const layout = defaultPanelLayout();
  assert.deepEqual(layout.right, ['tools', 'brush', 'categories', 'palette']);
  assert.deepEqual(layout.left, [
    'roomDimensions', 'background', 'roomSong', 'inspector', 'layers', 'export',
  ]);
  assert.deepEqual(layout.floating, {});
  assert.equal(isPanelLayoutComplete(layout), true);
});

test('every registered panel appears in exactly one location in the default layout', () => {
  const layout = defaultPanelLayout();
  for (const id of EDITOR_PANEL_IDS) {
    const locations = [
      layout.left.includes(id),
      layout.right.includes(id),
      layout.floating[id] !== undefined,
    ].filter(Boolean);
    assert.equal(locations.length, 1, `${id} should be in exactly one location`);
  }
});

test('defaultPanelIdsForSide agrees with the registry definitions', () => {
  for (const side of ['left', 'right'] as const) {
    const ids = defaultPanelIdsForSide(side);
    for (const id of ids) {
      assert.equal(getEditorPanelDef(id).defaultSide, side);
    }
    const orders = ids.map(id => getEditorPanelDef(id).defaultOrder);
    assert.deepEqual(orders, orders.slice().sort((a, b) => a - b), 'must be sorted by defaultOrder');
  }
  assert.equal(
    defaultPanelIdsForSide('left').length + defaultPanelIdsForSide('right').length,
    EDITOR_PANEL_IDS.length,
  );
});

test('panel ids are unique and every def is reachable via isEditorPanelId', () => {
  assert.equal(new Set(EDITOR_PANEL_IDS).size, EDITOR_PANEL_IDS.length);
  for (const def of EDITOR_PANEL_DEFS) {
    assert.equal(isEditorPanelId(def.id), true);
    assert.ok(def.title.length > 0);
  }
  assert.equal(isEditorPanelId('definitely_not_a_panel'), false);
  assert.equal(isEditorPanelId(42), false);
  assert.equal(isEditorPanelId(null), false);
});

// ── Reordering within one sidebar ───────────────────────────────────────────

test('reordering within one sidebar moves only the dragged panel', () => {
  const layout = defaultPanelLayout();
  // Move 'export' (last on the left) to the top of the left sidebar.
  const next = dockPanel(layout, 'export', 'left', 0);
  assert.deepEqual(next.left, [
    'export', 'roomDimensions', 'background', 'roomSong', 'inspector', 'layers',
  ]);
  assert.deepEqual(next.right, layout.right, 'the other sidebar is untouched');
  assert.equal(isPanelLayoutComplete(next), true);
});

test('reorder index is interpreted against the list after removal', () => {
  const layout = defaultPanelLayout();
  // 'roomDimensions' is at index 0; docking it at index 2 should place it
  // after the two panels that remain ahead of it once it is lifted out.
  const next = dockPanel(layout, 'roomDimensions', 'left', 2);
  assert.deepEqual(next.left, [
    'background', 'roomSong', 'roomDimensions', 'inspector', 'layers', 'export',
  ]);
});

test('out-of-range reorder indices clamp instead of throwing or duplicating', () => {
  const layout = defaultPanelLayout();
  const high = dockPanel(layout, 'roomDimensions', 'left', 999);
  assert.equal(high.left[high.left.length - 1], 'roomDimensions');
  assert.equal(isPanelLayoutComplete(high), true);

  const low = dockPanel(layout, 'export', 'left', -5);
  assert.equal(low.left[0], 'export');
  assert.equal(isPanelLayoutComplete(low), true);
});

// ── Moving between sidebars ─────────────────────────────────────────────────

test('moving a panel to the other sidebar at a specific index', () => {
  const layout = defaultPanelLayout();
  const next = dockPanel(layout, 'palette', 'left', 1);
  assert.equal(next.right.includes('palette'), false, 'removed from its old sidebar');
  assert.deepEqual(next.left, [
    'roomDimensions', 'palette', 'background', 'roomSong', 'inspector', 'layers', 'export',
  ]);
  assert.deepEqual(next.right, ['tools', 'brush', 'categories']);
  assert.equal(isPanelLayoutComplete(next), true);
});

test('a sidebar can be emptied entirely by moving every panel across', () => {
  let layout = defaultPanelLayout();
  for (const id of defaultPanelIdsForSide('right')) {
    layout = dockPanel(layout, id, 'left', layout.left.length);
  }
  assert.deepEqual(layout.right, []);
  assert.equal(layout.left.length, EDITOR_PANEL_IDS.length);
  assert.equal(isPanelLayoutComplete(layout), true);
});

// ── Floating and redocking ──────────────────────────────────────────────────

test('floating a docked panel removes it from its sidebar and records position', () => {
  const layout = defaultPanelLayout();
  const next = floatPanel(layout, 'inspector', 120, 240);
  assert.equal(next.left.includes('inspector'), false);
  assert.deepEqual(next.floating.inspector, { xPx: 120, yPx: 240, z: 1 });
  assert.equal(isPanelLayoutComplete(next), true);

  const loc = getPanelLocation(next, 'inspector');
  assert.equal(loc?.kind, 'floating');
});

test('redocking a floating panel puts it back at the chosen index and clears floating state', () => {
  const floated = floatPanel(defaultPanelLayout(), 'palette', 300, 300);
  assert.notEqual(floated.floating.palette, undefined);

  const redocked = dockPanel(floated, 'palette', 'left', 0);
  assert.equal(redocked.floating.palette, undefined, 'no longer floating');
  assert.equal(redocked.left[0], 'palette');
  assert.equal(redocked.right.includes('palette'), false);
  assert.equal(isPanelLayoutComplete(redocked), true);
});

test('floating multiple panels assigns increasing z and bring-to-front reorders them', () => {
  let layout = defaultPanelLayout();
  layout = floatPanel(layout, 'tools', 10, 10);
  layout = floatPanel(layout, 'palette', 20, 20);
  layout = floatPanel(layout, 'inspector', 30, 30);
  assert.deepEqual(getFloatingPanelIdsByZ(layout), ['tools', 'palette', 'inspector']);

  layout = bringFloatingPanelToFront(layout, 'tools');
  assert.deepEqual(getFloatingPanelIdsByZ(layout), ['palette', 'inspector', 'tools']);
  // z stays densified at 1..N.
  assert.deepEqual(
    getFloatingPanelIdsByZ(layout).map(id => layout.floating[id]!.z),
    [1, 2, 3],
  );
});

test('bringFloatingPanelToFront is a no-op for docked or already-front panels', () => {
  let layout = defaultPanelLayout();
  assert.equal(bringFloatingPanelToFront(layout, 'tools'), layout, 'docked panel: same object');

  layout = floatPanel(layout, 'tools', 10, 10);
  layout = floatPanel(layout, 'palette', 20, 20);
  assert.equal(bringFloatingPanelToFront(layout, 'palette'), layout, 'already front: same object');
});

test('moveFloatingPanel repositions without changing stacking, and ignores docked panels', () => {
  let layout = floatPanel(defaultPanelLayout(), 'tools', 10, 10);
  layout = floatPanel(layout, 'palette', 20, 20);
  const before = layout.floating.tools!.z;

  layout = moveFloatingPanel(layout, 'tools', 77, 88);
  assert.deepEqual(layout.floating.tools, { xPx: 77, yPx: 88, z: before });

  const unchanged = moveFloatingPanel(layout, 'inspector', 5, 5);
  assert.equal(unchanged, layout, 'docked panel: same object returned');
});

test('non-finite coordinates never enter the layout', () => {
  const floated = floatPanel(defaultPanelLayout(), 'tools', NaN, Infinity);
  assert.equal(floated.floating.tools!.xPx, 0);
  assert.equal(floated.floating.tools!.yPx, 0);

  const moved = moveFloatingPanel(floated, 'tools', NaN, 50);
  assert.equal(moved.floating.tools!.xPx, 0, 'NaN keeps the previous value');
  assert.equal(moved.floating.tools!.yPx, 50);
});

// ── Sanitization / normalization ────────────────────────────────────────────

test('normalize drops unknown and retired panel ids', () => {
  const layout = normalizePanelLayout({
    left: ['inspector', 'a_retired_panel', 'export'],
    right: ['tools', 12345],
    floating: {},
  });
  assert.equal(layout.left.includes('inspector'), true);
  assert.equal((layout.left as string[]).includes('a_retired_panel'), false);
  assert.equal(isPanelLayoutComplete(layout), true);
});

test('normalize removes duplicates within and across locations', () => {
  const layout = normalizePanelLayout({
    left: ['tools', 'tools', 'inspector'],
    right: ['tools', 'palette'],
    floating: { tools: { xPx: 1, yPx: 2, z: 1 } },
  });
  const appearances = [
    layout.left.filter(id => id === 'tools').length,
    layout.right.filter(id => id === 'tools').length,
    layout.floating.tools !== undefined ? 1 : 0,
  ];
  assert.equal(appearances.reduce((a, b) => a + b, 0), 1, 'tools appears exactly once');
  // First claim wins: it was listed on the left first.
  assert.equal(layout.left.includes('tools'), true);
  assert.equal(isPanelLayoutComplete(layout), true);
});

test('normalize restores panels missing from a stored layout to their default location', () => {
  // A layout saved before 'export' and 'layers' existed.
  const layout = normalizePanelLayout({
    left: ['roomDimensions', 'background', 'roomSong', 'inspector'],
    right: ['tools', 'brush', 'categories', 'palette'],
    floating: {},
  });
  assert.equal(isPanelLayoutComplete(layout), true);
  assert.equal(layout.left.includes('layers'), true);
  assert.equal(layout.left.includes('export'), true);
  // They land in default-order position relative to their default-side peers,
  // not blindly appended: inspector (order 3) before layers (order 4).
  assert.ok(layout.left.indexOf('inspector') < layout.left.indexOf('layers'));
  assert.ok(layout.left.indexOf('layers') < layout.left.indexOf('export'));
});

test('normalize handles wholly corrupt / missing input without throwing', () => {
  for (const raw of [null, undefined, 42, 'nonsense', [], { left: 'not-an-array' }, { floating: 7 }]) {
    const layout = normalizePanelLayout(raw);
    assert.equal(isPanelLayoutComplete(layout), true, `corrupt input ${JSON.stringify(raw)}`);
  }
  // Completely empty object reproduces the defaults exactly.
  assert.deepEqual(normalizePanelLayout({}), defaultPanelLayout());
});

test('normalize rejects floating entries with malformed coordinates, redocking them', () => {
  const layout = normalizePanelLayout({
    left: [], right: [],
    floating: {
      tools: { xPx: 'left', yPx: 10, z: 1 },
      palette: { xPx: NaN, yPx: 10, z: 1 },
      inspector: { xPx: 10, yPx: 20, z: 3 },
      brush: null,
    },
  });
  assert.equal(layout.floating.tools, undefined, 'string coordinate rejected');
  assert.equal(layout.floating.palette, undefined, 'NaN coordinate rejected');
  assert.equal(layout.floating.brush, undefined, 'null entry rejected');
  assert.notEqual(layout.floating.inspector, undefined, 'valid entry kept');
  // Rejected ones fall back to their registered default sidebar.
  assert.equal(layout.right.includes('tools'), true);
  assert.equal(layout.right.includes('palette'), true);
  assert.equal(layout.right.includes('brush'), true);
  assert.equal(isPanelLayoutComplete(layout), true);
});

test('normalize repairs malformed z values and re-densifies stacking to 1..N', () => {
  const layout = normalizePanelLayout({
    left: [], right: [],
    floating: {
      tools: { xPx: 0, yPx: 0, z: 900 },
      palette: { xPx: 0, yPx: 0, z: 'high' },
      inspector: { xPx: 0, yPx: 0, z: 5 },
    },
  });
  const ordered = getFloatingPanelIdsByZ(layout);
  assert.deepEqual(ordered.map(id => layout.floating[id]!.z), [1, 2, 3]);
  // 'palette' had an unusable z (treated as 0) so it sorts to the back;
  // inspector (5) then tools (900) follow.
  assert.deepEqual(ordered, ['palette', 'inspector', 'tools']);
});

test('normalize output always satisfies the exactly-one-location invariant', () => {
  const adversarial = [
    { left: EDITOR_PANEL_IDS, right: EDITOR_PANEL_IDS, floating: {} },
    { left: [], right: [], floating: Object.fromEntries(EDITOR_PANEL_IDS.map(id => [id, { xPx: 0, yPx: 0, z: 1 }])) },
    { left: ['export'], right: ['export'], floating: { export: { xPx: 0, yPx: 0, z: 1 } } },
  ];
  for (const raw of adversarial) {
    assert.equal(isPanelLayoutComplete(normalizePanelLayout(raw)), true);
  }
});

// ── Cloning / immutability ──────────────────────────────────────────────────

test('layout operations never mutate their input', () => {
  const original = floatPanel(defaultPanelLayout(), 'tools', 5, 5);
  const snapshot = JSON.stringify(original);

  dockPanel(original, 'export', 'right', 0);
  floatPanel(original, 'inspector', 1, 1);
  moveFloatingPanel(original, 'tools', 99, 99);
  bringFloatingPanelToFront(original, 'tools');

  assert.equal(JSON.stringify(original), snapshot, 'input layout unchanged');
});

test('clonePanelLayout produces an independent deep copy', () => {
  const original = floatPanel(defaultPanelLayout(), 'tools', 5, 5);
  const copy = clonePanelLayout(original);
  copy.left.push('palette');
  copy.floating.tools!.xPx = 999;
  assert.equal(original.left.includes('palette'), false);
  assert.equal(original.floating.tools!.xPx, 5);
});

test('getSidebarPanelIds and getPanelLocation report consistent placement', () => {
  const layout: EditorPanelLayout = dockPanel(defaultPanelLayout(), 'palette', 'left', 2);
  assert.deepEqual(getSidebarPanelIds(layout, 'left'), layout.left);
  assert.deepEqual(getSidebarPanelIds(layout, 'right'), layout.right);

  const loc = getPanelLocation(layout, 'palette');
  assert.deepEqual(loc, { kind: 'docked', side: 'left', index: 2 });
});
