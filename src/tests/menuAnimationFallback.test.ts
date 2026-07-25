import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  getPreloadedMenuAnimationSource,
  preloadMenuAnimationFrames,
  resetMenuAnimationPreloadForTests,
} from '../ui/menuAnimationFrames';
import { createMenuAnimatedBackground } from '../ui/menuAnimatedBackground';

type FailureRule = (url: string) => unknown | undefined;

let failureRule: FailureRule = () => undefined;
let createdImages: MockImage[] = [];
let diagnostics: unknown[][] = [];
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

class MockElement {
  style: Record<string, string> & { cssText: string } = { cssText: '' };
  parentElement: MockElement | null = null;
  children: MockElement[] = [];

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: MockElement): void {
    this.children = this.children.filter(candidate => candidate !== child);
    child.parentElement = null;
  }

  remove(): void {
    this.parentElement?.removeChild(this);
  }
}

class MockImage extends MockElement {
  alt = '';
  decoding = '';
  loading = '';
  complete = true;
  naturalWidth = 1920;
  naturalHeight = 1080;
  src = '';

  constructor() {
    super();
    createdImages.push(this);
  }

  addEventListener(): void {}

  async decode(): Promise<void> {
    const failure = failureRule(this.src);
    if (failure !== undefined) throw failure;
  }
}

class MockCanvas extends MockElement {
  width = 0;
  height = 0;
  clientWidth = 1920;
  clientHeight = 1080;

  getContext(): { drawImage(): void; clearRect(): void } {
    return { drawImage() {}, clearRect() {} };
  }
}

Object.assign(globalThis, {
  Image: MockImage,
  HTMLImageElement: MockImage,
  devicePixelRatio: 1,
  requestAnimationFrame: (callback: FrameRequestCallback): number => {
    if (callback.name !== 'render') callback(0);
    return 1;
  },
  cancelAnimationFrame: () => {},
  document: {
    createElement(tag: string): MockElement {
      if (tag === 'canvas') return new MockCanvas();
      if (tag === 'img') return new MockImage();
      return new MockElement();
    },
  },
});

function setFailure(rule: FailureRule): void {
  failureRule = rule;
  createdImages = [];
  diagnostics = [];
  console.error = (...args: unknown[]) => { diagnostics.push(args); };
  console.warn = (...args: unknown[]) => { diagnostics.push(args); };
}

afterEach(() => {
  resetMenuAnimationPreloadForTests();
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

test('uses the decoded frame sequences when every frame succeeds', async () => {
  setFailure(() => undefined);
  const source = await preloadMenuAnimationFrames();
  assert.equal(source.kind, 'frames');
  if (source.kind === 'frames') {
    assert.equal(source.normal.length, 300);
    assert.equal(source.blurred.length, 300);
  }
  assert.equal(getPreloadedMenuAnimationSource(), source);
});

test('a frame decode failure selects both complete animated WebPs and logs the URL', async () => {
  const failedUrl = '/ANIMATIONS/goldEmbers/individualFrames/goldEmbers_00007.webp';
  const decodeError = new DOMException('The source image cannot be decoded.');
  setFailure(url => url === failedUrl ? decodeError : undefined);

  const source = await preloadMenuAnimationFrames();

  assert.deepEqual(source, {
    kind: 'animated-webp',
    normalUrl: '/ANIMATIONS/goldEmbers/goldEmbers.webp',
    blurredUrl: '/ANIMATIONS/goldEmbers_blur/goldEmbers_blur.webp',
  });
  assert.ok(diagnostics.some(args => String(args[0]).includes(failedUrl) && args[1] === decodeError));
});

test('a blurred animated WebP failure reuses normal animation with CSS blur', async () => {
  setFailure(url => url.endsWith('/goldEmbers_blur.webp') ? new Error('blur decode failed') : (
    url.includes('/individualFrames/') ? new Error('frame decode failed') : undefined
  ));
  const source = await preloadMenuAnimationFrames();
  assert.deepEqual(source, {
    kind: 'animated-webp',
    normalUrl: '/ANIMATIONS/goldEmbers/goldEmbers.webp',
  });

  const background = createMenuAnimatedBackground({ source });
  background.showBlurred();
  const normalImage = (background.element as unknown as MockElement).children[0] as MockImage;
  assert.equal(normalImage.style.filter, 'blur(6px) brightness(0.75)');
  background.destroy();
});

test('total animation failure resolves to static so startup can continue', async () => {
  setFailure(() => new Error('nothing decodes'));
  const source = await preloadMenuAnimationFrames();
  assert.deepEqual(source, { kind: 'static' });
});

test('fallback releases every partially decoded frame', async () => {
  const failedUrl = '/ANIMATIONS/goldEmbers/individualFrames/goldEmbers_00012.webp';
  setFailure(url => url === failedUrl ? new Error('decode failed') : undefined);
  const source = await preloadMenuAnimationFrames();
  assert.equal(source.kind, 'animated-webp');

  const frameImages = createdImages.filter(image => image.src.includes('/individualFrames/') || image.src === '');
  assert.ok(frameImages.length > 1);
  assert.ok(frameImages.every(image => image.src === ''), 'all partially loaded frame images should be released');
});
