/**
 * Minimal fake DOM — just enough surface area (createElement, appendChild,
 * style.cssText, addEventListener, activeElement, and the handful of
 * element properties editorUILightingPanel.ts/editorUI.ts touch) to
 * construct and exercise real editor-UI panel modules under plain Node,
 * which has no DOM and this project has no jsdom dependency.
 *
 * Not a general-purpose DOM shim — extend only as far as a specific panel
 * module's actual usage requires (checked via grep before adding a stub).
 */

type Listener = (event: FakeEvent) => void;

export interface FakeEvent {
  stopPropagation(): void;
  preventDefault(): void;
}

function makeFakeEvent(): FakeEvent {
  return { stopPropagation() {}, preventDefault() {} };
}

export class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  listeners = new Map<string, Listener[]>();
  style: { cssText: string; [k: string]: unknown } = { cssText: '' };
  textContent = '';
  title = '';
  type = '';
  value = '';
  checked = false;
  min = '';
  max = '';
  step = '';
  id = '';

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child: FakeElement, _ref: FakeElement | null): FakeElement {
    child.parent = this;
    this.children.unshift(child);
    return child;
  }

  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(c => c !== this);
      this.parent = null;
    }
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(type, list.filter(l => l !== fn));
  }

  querySelector<T = FakeElement>(): T | null {
    return null;
  }

  querySelectorAll<T = FakeElement>(): T[] {
    return [];
  }

  setAttribute(name: string, value: string): void {
    (this as unknown as Record<string, string>)[name] = value;
  }

  getAttribute(name: string): string | null {
    return (this as unknown as Record<string, string | undefined>)[name] ?? null;
  }

  get listenerCount(): number {
    let total = 0;
    for (const list of this.listeners.values()) total += list.length;
    return total;
  }
}

export interface FakeDocument {
  activeElement: FakeElement | null;
  createElement(tag: string): FakeElement;
  head: FakeElement;
  getElementById(id: string): FakeElement | null;
}

export function createFakeDocument(): FakeDocument {
  const created: FakeElement[] = [];
  const head = new FakeElement('head');
  const doc: FakeDocument = {
    activeElement: null,
    createElement(tag: string): FakeElement {
      const el = new FakeElement(tag);
      created.push(el);
      return el;
    },
    head,
    getElementById(id: string): FakeElement | null {
      return created.find(el => el.id === id) ?? null;
    },
  };
  return doc;
}

/** Fires `type` on `el`, invoking every registered listener with a fake event. */
export function fireEvent(el: FakeElement, type: string): void {
  const event = makeFakeEvent();
  for (const fn of el.listeners.get(type) ?? []) fn(event);
}

/** Simulates focusing an element (sets document.activeElement). */
export function focus(doc: FakeDocument, el: FakeElement): void {
  doc.activeElement = el;
}

export function blur(doc: FakeDocument): void {
  doc.activeElement = null;
}

/** Installs `doc` as the global `document` for the duration of `fn`, then restores whatever was there before. */
export async function withFakeDocument<T>(doc: FakeDocument, fn: () => T | Promise<T>): Promise<T> {
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = doc;
  try {
    return await fn();
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
}
