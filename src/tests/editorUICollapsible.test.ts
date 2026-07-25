import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument, withFakeDocument, fireEvent, type FakeElement } from './helpers/fakeDom';

/**
 * Behavioral coverage for the shared, reusable collapsible-section component
 * (editorUIHelpers.ts's createCollapsibleSection) that every top-level panel
 * in the redesigned editor sidebars is built on — a real <button> header with
 * a chevron, aria-expanded on the button, and aria-controls pointing at the
 * body element's id. Exercised against real DOM instances via the project's
 * fake DOM (see helpers/fakeDom.ts), not source regex.
 */

async function withSection<T>(fn: (ctx: {
  section: import('../editor/editorUIHelpers').CollapsibleSection;
  doc: import('./helpers/fakeDom').FakeDocument;
}) => T): Promise<T> {
  const doc = createFakeDocument();
  return withFakeDocument(doc, () => {
    return import('../editor/editorUIHelpers').then(({ createCollapsibleSection }) => {
      const section = createCollapsibleSection('Tools');
      return fn({ section, doc });
    });
  });
}

test('createCollapsibleSection: starts collapsed by default (presentational default)', async () => {
  await withSection(({ section }) => {
    assert.equal(section.isExpanded(), false);
    assert.equal(section.header.getAttribute('aria-expanded'), 'false');
    assert.equal((section.body as unknown as FakeElement).style.display, 'none');
    assert.equal(section.chevron.textContent, '▸');
  });
});

test('createCollapsibleSection: defaultExpanded:true starts expanded', async () => {
  const doc = createFakeDocument();
  await withFakeDocument(doc, async () => {
    const { createCollapsibleSection } = await import('../editor/editorUIHelpers');
    const section = createCollapsibleSection('Layers', { defaultExpanded: true });
    assert.equal(section.isExpanded(), true);
    assert.equal(section.header.getAttribute('aria-expanded'), 'true');
    assert.equal((section.body as unknown as FakeElement).style.display, 'block');
    assert.equal(section.chevron.textContent, '▾');
  });
});

test('createCollapsibleSection: clicking the header toggles aria-expanded, chevron, and body visibility', async () => {
  await withSection(({ section }) => {
    fireEvent(section.header as unknown as FakeElement, 'click');
    assert.equal(section.isExpanded(), true);
    assert.equal(section.header.getAttribute('aria-expanded'), 'true');
    assert.equal(section.chevron.textContent, '▾');
    assert.equal((section.body as unknown as FakeElement).style.display, 'block');

    fireEvent(section.header as unknown as FakeElement, 'click');
    assert.equal(section.isExpanded(), false);
    assert.equal(section.header.getAttribute('aria-expanded'), 'false');
    assert.equal(section.chevron.textContent, '▸');
    assert.equal((section.body as unknown as FakeElement).style.display, 'none');
  });
});

test('createCollapsibleSection: setExpanded() drives the same presentation as a click, without a click', async () => {
  await withSection(({ section }) => {
    section.setExpanded(true);
    assert.equal(section.header.getAttribute('aria-expanded'), 'true');
    assert.equal(section.chevron.textContent, '▾');
    section.setExpanded(false);
    assert.equal(section.header.getAttribute('aria-expanded'), 'false');
    assert.equal(section.chevron.textContent, '▸');
  });
});

test('createCollapsibleSection: aria-controls on the header matches the body element\'s id', async () => {
  await withSection(({ section }) => {
    const controlsId = section.header.getAttribute('aria-controls');
    assert.ok(controlsId && controlsId.length > 0);
    assert.equal(controlsId, section.body.id);
  });
});

test('createCollapsibleSection: header is a real <button>', async () => {
  await withSection(({ section }) => {
    assert.equal((section.header as unknown as FakeElement).tagName, 'button');
  });
});

test('createCollapsibleSection: two sections get distinct body ids (no aria-controls collision)', async () => {
  const doc = createFakeDocument();
  await withFakeDocument(doc, async () => {
    const { createCollapsibleSection } = await import('../editor/editorUIHelpers');
    const a = createCollapsibleSection('A');
    const b = createCollapsibleSection('B');
    assert.notEqual(a.body.id, b.body.id);
  });
});

// ── Layers panel now built on the shared component ──────────────────────────

test('editorUILayersPanel: uses the shared collapsible component and defaults to collapsed', async () => {
  const doc = createFakeDocument();
  await withFakeDocument(doc, async () => {
    const { createEditorLayersPanel } = await import('../editor/editorUILayersPanel');
    const panel = createEditorLayersPanel(() => null);
    assert.equal(panel.isCollapsed(), true);
    // setCollapsed still exposed for Phase 6 workspace-preference restoration.
    panel.setCollapsed(false);
    assert.equal(panel.isCollapsed(), false);
    panel.setCollapsed(true);
    assert.equal(panel.isCollapsed(), true);
  });
});
