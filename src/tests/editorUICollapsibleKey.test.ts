import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument, withFakeDocument } from './helpers/fakeDom';

/**
 * Behavioral coverage for the `key` option added to createCollapsibleSection
 * so it can be registered into an EditorUI's session-state snapshot/restore
 * registry (see editorUI.ts's getSessionUIStateSnapshot/applySessionUIState).
 */

test('createCollapsibleSection: key defaults to null when not passed', async () => {
  const doc = createFakeDocument();
  await withFakeDocument(doc, async () => {
    const { createCollapsibleSection } = await import('../editor/editorUIHelpers');
    const section = createCollapsibleSection('Tools');
    assert.equal(section.key, null);
  });
});

test('createCollapsibleSection: key is exposed verbatim when passed', async () => {
  const doc = createFakeDocument();
  await withFakeDocument(doc, async () => {
    const { createCollapsibleSection } = await import('../editor/editorUIHelpers');
    const section = createCollapsibleSection('Tools', { key: 'tools' });
    assert.equal(section.key, 'tools');
  });
});
