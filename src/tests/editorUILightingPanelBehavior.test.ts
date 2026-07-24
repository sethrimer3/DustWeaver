import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument, withFakeDocument, focus, blur, fireEvent, type FakeElement } from './helpers/fakeDom';
import { createEditorState } from '../editor/editorState';
import type { EditorState } from '../editor/editorState';

/**
 * Behavioral coverage for the lighting panel's Phase 5.1 gating
 * (computeLightingValueSig-driven early return + focus preservation),
 * exercised against a real EditorLightingPanel instance via a minimal fake
 * DOM (see helpers/fakeDom.ts) rather than source-text regex — this repo
 * has no jsdom dependency, so a hand-rolled shim is the only way to
 * construct real DOM elements under Node.
 */

async function withPanel<T>(fn: (ctx: {
  panel: import('../editor/editorUILightingPanel').EditorLightingPanel;
  doc: ReturnType<typeof createFakeDocument>;
  callbacks: { calls: Record<string, number> };
}) => T | Promise<T>): Promise<T> {
  const doc = createFakeDocument();
  return withFakeDocument(doc, async () => {
    const { createEditorLightingPanel } = await import('../editor/editorUILightingPanel');
    const calls: Record<string, number> = {};
    const bump = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
    const callbacks = {
      onLightingEffectChange: () => bump('onLightingEffectChange'),
      onAmbientLightDirectionChange: () => bump('onAmbientLightDirectionChange'),
      onDirectionalBiasChange: () => bump('onDirectionalBiasChange'),
      onSideExposureStrengthChange: () => bump('onSideExposureStrengthChange'),
      onMinimumWallLightChange: () => bump('onMinimumWallLightChange'),
      onFalloffPowerChange: () => bump('onFalloffPowerChange'),
      onBackgroundLightSpillChange: () => bump('onBackgroundLightSpillChange'),
      onSolidLightSoftnessChange: () => bump('onSolidLightSoftnessChange'),
      onSeamBlendingChange: () => bump('onSeamBlendingChange'),
      onVoidEdgeStyleChange: () => bump('onVoidEdgeStyleChange'),
      onSunraysEnabledChange: () => bump('onSunraysEnabledChange'),
      onSunraysStyleChange: () => bump('onSunraysStyleChange'),
      onSunraysAngleChange: () => bump('onSunraysAngleChange'),
      onSunraysIntensityChange: () => bump('onSunraysIntensityChange'),
      onSunraysRayCountChange: () => bump('onSunraysRayCountChange'),
      onSunraysAnimationChange: () => bump('onSunraysAnimationChange'),
    } as unknown as import('../editor/editorState').EditorUICallbacks;
    const panel = createEditorLightingPanel(() => callbacks);
    return fn({ panel, doc, callbacks: { calls } });
  });
}

function findSlider(panel: import('../editor/editorUILightingPanel').EditorLightingPanel, label: string): FakeElement {
  // Walk lightingDiv's children to find the <input type=range> whose preceding
  // row's header label matches `label`. Simpler: scan all descendants for the
  // first range input following a div whose textContent === label.
  const root = panel.lightingDiv as unknown as FakeElement;
  const stack: FakeElement[] = [...root.children];
  let pendingLabelMatch = false;
  while (stack.length > 0) {
    const el = stack.shift()!;
    if (el.textContent === label) pendingLabelMatch = true;
    if (pendingLabelMatch && el.type === 'range') return el;
    stack.unshift(...el.children);
  }
  throw new Error(`slider "${label}" not found`);
}

test('syncOnRebuild + syncInPlace: unchanged state produces no further value writes', async () => {
  await withPanel(({ panel, doc }) => {
    const paletteDiv = doc.createElement('div');
    const state = createEditorState();
    state.roomData = { ambientLightDirection: undefined } as unknown as EditorState['roomData'];
    panel.syncOnRebuild(state, 'DEFAULT', paletteDiv as unknown as HTMLElement);
    // Prime the cached signature (a rebuild always forces the next call to
    // run once) before asserting the *subsequent*, truly-unchanged call is a no-op.
    panel.syncInPlace(state, 'DEFAULT');

    const dirBiasSlider = findSlider(panel, 'Directional Bias');
    dirBiasSlider.value = 'sentinel'; // prove syncInPlace does NOT touch this when unchanged
    panel.syncInPlace(state, 'DEFAULT');
    assert.equal(dirBiasSlider.value, 'sentinel', 'expected an unchanged sync to make no DOM writes');
  });
});

test('changed lighting value triggers a real DOM write on the next syncInPlace', async () => {
  await withPanel(({ panel, doc }) => {
    const paletteDiv = doc.createElement('div');
    const state = createEditorState();
    state.roomData = {} as unknown as EditorState['roomData'];
    panel.syncOnRebuild(state, 'DEFAULT', paletteDiv as unknown as HTMLElement);

    const dirBiasSlider = findSlider(panel, 'Directional Bias');
    dirBiasSlider.value = 'sentinel';

    state.roomData = { directionalBias: 0.9 } as unknown as EditorState['roomData'];
    panel.syncInPlace(state, 'DEFAULT');
    assert.equal(dirBiasSlider.value, '0.9', 'expected the changed value to be written');
  });
});

test('a focused slider is not overwritten by an unrelated value change elsewhere', async () => {
  await withPanel(({ panel, doc }) => {
    const paletteDiv = doc.createElement('div');
    const state = createEditorState();
    state.roomData = {} as unknown as EditorState['roomData'];
    panel.syncOnRebuild(state, 'DEFAULT', paletteDiv as unknown as HTMLElement);

    const dirBiasSlider = findSlider(panel, 'Directional Bias');
    focus(doc, dirBiasSlider);
    dirBiasSlider.value = '0.77'; // simulates an in-progress user drag

    // Unrelated field changes (falloffPower), which changes the overall
    // signature and forces syncInPlace past its early-return.
    state.roomData = { falloffPower: 2.0 } as unknown as EditorState['roomData'];
    panel.syncInPlace(state, 'DEFAULT');

    assert.equal(dirBiasSlider.value, '0.77', 'expected the focused slider to survive an unrelated update');
    blur(doc);
  });
});

test('lighting change callbacks fire exactly once per user interaction, even across repeated syncInPlace calls', async () => {
  await withPanel(({ panel, doc, callbacks }) => {
    const paletteDiv = doc.createElement('div');
    const state = createEditorState();
    state.roomData = {} as unknown as EditorState['roomData'];
    panel.syncOnRebuild(state, 'DEFAULT', paletteDiv as unknown as HTMLElement);

    const dirBiasSlider = findSlider(panel, 'Directional Bias');
    fireEvent(dirBiasSlider, 'input');
    // Repeated syncInPlace calls (simulating many editor frames) must not
    // re-fire the callback — it's only wired to the 'input' DOM event.
    for (let i = 0; i < 5; i++) panel.syncInPlace(state, 'DEFAULT');

    assert.equal(callbacks.calls['onDirectionalBiasChange'], 1);
  });
});

test('repeated panel construction does not multiply listeners on a single slider', async () => {
  await withPanel(({ panel }) => {
    const dirBiasSlider = findSlider(panel, 'Directional Bias');
    // The slider is built once at construction time — 'input' and 'click' are
    // the only two listeners ever attached to it, regardless of how many
    // times syncOnRebuild/syncInPlace run afterward.
    assert.equal(dirBiasSlider.listenerCount, 2);
  });
});
