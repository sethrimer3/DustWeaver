import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument, withFakeDocument, fireEvent, type FakeElement } from './helpers/fakeDom';
import { LAYER_PRESETS } from '../editor/editorWorkspacePreferences';

/**
 * Behavioral coverage for the Phase 6 preset/reset controls added to the
 * layers panel — exercised against a real EditorLayersPanel instance via the
 * fake DOM (see helpers/fakeDom.ts), not source regex, per Phase 6.1's
 * "do not rely only on regex/source guards" instruction.
 */

async function withPanel<T>(fn: (ctx: {
  panel: import('../editor/editorUILayersPanel').EditorLayersPanel;
  calls: { presets: string[]; resets: number };
}) => T): Promise<T> {
  const doc = createFakeDocument();
  return withFakeDocument(doc, () => {
    return import('../editor/editorUILayersPanel').then(({ createEditorLayersPanel }) => {
      const calls = { presets: [] as string[], resets: 0 };
      const callbacks = {
        onLayerStateChange: () => {},
        onApplyLayerPreset: (id: string) => { calls.presets.push(id); },
        onResetWorkspace: () => { calls.resets++; },
      } as unknown as import('../editor/editorState').EditorUICallbacks;
      const panel = createEditorLayersPanel(() => callbacks);
      return fn({ panel, calls });
    });
  });
}

function findButtonsByRole(root: FakeElement, role: string): FakeElement[] {
  const out: FakeElement[] = [];
  const stack: FakeElement[] = [root];
  while (stack.length > 0) {
    const el = stack.shift()!;
    if (el.getAttribute('role') === role) out.push(el);
    stack.push(...el.children);
  }
  return out;
}

function findByTextContent(root: FakeElement, text: string): FakeElement {
  const stack: FakeElement[] = [root];
  while (stack.length > 0) {
    const el = stack.shift()!;
    if (el.textContent === text) return el;
    stack.push(...el.children);
  }
  throw new Error(`element with textContent "${text}" not found`);
}

test('a "Layer visibility presets" group exists with one accessibly-labeled button per preset', async () => {
  await withPanel(({ panel }) => {
    const groups = findButtonsByRole(panel.div as unknown as FakeElement, 'group');
    const presetGroup = groups.find(g => g.getAttribute('aria-label') === 'Layer visibility presets');
    assert.ok(presetGroup, 'expected a group with aria-label "Layer visibility presets"');

    for (const preset of LAYER_PRESETS) {
      const btn = findByTextContent(panel.div as unknown as FakeElement, preset.label);
      assert.equal(btn.tagName, 'button');
      assert.equal(btn.getAttribute('aria-label'), `Apply "${preset.label}" layer visibility preset`);
    }
  });
});

test('clicking a preset button fires onApplyLayerPreset with that preset\'s id exactly once', async () => {
  await withPanel(({ panel, calls }) => {
    const btn = findByTextContent(panel.div as unknown as FakeElement, 'Geometry');
    fireEvent(btn, 'click');
    assert.deepEqual(calls.presets, ['geometry']);
    fireEvent(btn, 'click');
    assert.deepEqual(calls.presets, ['geometry', 'geometry']);
  });
});

test('the Reset Workspace button has an accessible name and fires onResetWorkspace exactly once per click', async () => {
  await withPanel(({ panel, calls }) => {
    const btn = findByTextContent(panel.div as unknown as FakeElement, '↺ Reset Workspace');
    assert.equal(btn.getAttribute('aria-label'), 'Reset editor workspace to defaults');
    fireEvent(btn, 'click');
    assert.equal(calls.resets, 1);
  });
});

test('setCollapsed()/isCollapsed() reflect the panel\'s collapse state without a click, and hide the preset row', async () => {
  await withPanel(({ panel }) => {
    // The shared collapsible component (editorUIHelpers.ts's
    // createCollapsibleSection) defaults every top-level panel to collapsed —
    // a presentational default only; session-persisted collapse state is
    // restored afterward via setCollapsed() by the caller (see
    // editorController.ts's applyWorkspaceUIPrefs wiring).
    assert.equal(panel.isCollapsed(), true);
    // Sync the explicit child-display presentation with the default-collapsed
    // construction state (setCollapsed(true) is idempotent here).
    panel.setCollapsed(true);

    const presetGroup = findButtonsByRole(panel.div as unknown as FakeElement, 'group')
      .find(g => g.getAttribute('aria-label') === 'Layer visibility presets')!;
    assert.equal(presetGroup.style.display, 'none');

    panel.setCollapsed(false);
    assert.equal(panel.isCollapsed(), false);
    assert.equal(presetGroup.style.display, 'block');

    panel.setCollapsed(true);
    assert.equal(panel.isCollapsed(), true);
    assert.equal(presetGroup.style.display, 'none');
  });
});
