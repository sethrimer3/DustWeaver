import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * editorUI.ts can't be imported under Node (it uses Vite's import.meta.env),
 * and this project has no DOM/jsdom test harness — see editorUIPhase5.test.ts's
 * doc comment on this constraint. The behavioral parts of Phase 5 (signature
 * equality/inequality) are covered directly in editorUISignatures.test.ts;
 * these are supplemental source-level guards against specific regressions
 * that can't be expressed as pure-function assertions (DOM API choice,
 * scroll-position save/restore wiring, single-registration of listeners).
 */
function readEditorUISource(): string {
  return readFileSync(path.join(__dirname, '../editor/editorUI.ts'), 'utf8');
}

test('palette clearing uses replaceChildren(), not innerHTML assignment', () => {
  const source = readEditorUISource();
  assert.ok(source.includes('paletteDiv.replaceChildren()'));
  assert.ok(!/paletteDiv\.innerHTML/.test(source), 'expected no innerHTML usage on paletteDiv');
});

test('palette scroll position is saved before and restored after a rebuild', () => {
  const source = readEditorUISource();
  assert.ok(/const savedPaletteScrollTop = paletteDiv\.scrollTop/.test(source));
  assert.ok(/paletteDiv\.scrollTop = savedPaletteScrollTop/.test(source));
});

test('tool/brush/category highlight loops are gated by a cached signature check', () => {
  const source = readEditorUISource();
  assert.ok(/if \(toolSig !== lastToolSig\)/.test(source));
  assert.ok(/if \(brushSig !== lastBrushSig\)/.test(source));
  assert.ok(/if \(categorySig !== lastCategorySig\)/.test(source));
});

test('palette selection highlight loop is gated by a cached signature (or a fresh rebuild)', () => {
  const source = readEditorUISource();
  assert.ok(/if \(paletteSelectionSig !== lastPaletteSelectionSig \|\| needsPaletteRebuild\)/.test(source));
});

test('block modifier sync is gated by a cached signature check', () => {
  const source = readEditorUISource();
  assert.ok(/if \(blockModifierSig !== lastBlockModifierSig\)/.test(source));
});

test('inspector rebuild is gated by identity-signature equality, not called unconditionally', () => {
  const source = readEditorUISource();
  assert.ok(/if \(!inspectorIdentitySigEquals\(inspectorIdentitySig, lastInspectorIdentitySig\)\)/.test(source));
  // Exactly one call site — the gated one (no unconditional fallback call elsewhere).
  const calls = source.match(/updateInspector\(inspectorDiv, state, callbacks\)/g) ?? [];
  assert.equal(calls.length, 1);
});

test('palette structure signature is the single gate for the palette rebuild (no separate legacy checks)', () => {
  const source = readEditorUISource();
  assert.ok(/const needsPaletteRebuild = paletteStructureSig !== lastPaletteStructureSig;/.test(source));
});

test('the layers panel collapse header wires its own click-driven state (Phase 5 accessibility pass), unaffected by update()', () => {
  const source = readFileSync(path.join(__dirname, '../editor/editorUILayersPanel.ts'), 'utf8');
  // sync() must never touch `collapsed` — collapse state persists across
  // update() calls. Bounded to just the sync() function body (up to the next
  // top-level `function` declaration), not the whole rest of the file —
  // setCollapsed()/isCollapsed() legitimately touch `collapsed` and must not
  // make this guard vacuously fail.
  const syncStart = source.indexOf('function sync(');
  const syncEnd = source.indexOf('\n  function ', syncStart + 1);
  const syncBody = source.slice(syncStart, syncEnd);
  assert.ok(!/collapsed\s*=/.test(syncBody), 'expected sync() to never reassign the collapsed flag');
});

test('event listeners inside the palette rebuild block are attached to freshly-created elements, not re-attached to persistent ones', () => {
  const source = readEditorUISource();
  // Every addEventListener call between the rebuild's Custom Blocks section
  // markers is on a `const`-declared local (created fresh this call), never
  // on one of the module-level persistent button arrays (toolBtns, brushBtns,
  // catBtns) — those never get addEventListener calls inside update().
  const updateFnStart = source.indexOf('function update(state: EditorState): void {');
  const updateFnBody = source.slice(updateFnStart);
  assert.ok(!/toolBtns\[.*\]\.addEventListener/.test(updateFnBody));
  assert.ok(!/catBtns\[.*\]\.addEventListener/.test(updateFnBody));
  assert.ok(!/brushBtns\[.*\]\.addEventListener/.test(updateFnBody));
});
