/**
 * A missing/broken sprite for the *active* character must never fail
 * silently — it should log an explicit diagnostic naming the character and
 * the exact URL that failed, instead of just leaving a permanent green
 * placeholder box with no explanation (see renderer.ts's isSpriteReady
 * fallback). This test runs in its own process (node:test's default file
 * isolation), so the fake Image global below cannot leak into other test
 * files.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Minimal HTMLImageElement stand-in: resolves synchronously on `src` assignment. */
class FakeImage {
  private _src = '';
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  set src(value: string) {
    this._src = value;
    this.complete = true;
    // Simulate exactly one broken/missing file so we can assert the failure path.
    if (value.includes('outcast_swinging')) {
      this.naturalWidth = 0;
      this.naturalHeight = 0;
    } else {
      this.naturalWidth = 16;
      this.naturalHeight = 24;
    }
  }
  get src(): string { return this._src; }
  addEventListener(): void { /* unused: `complete` is always true synchronously above */ }
}
(globalThis as unknown as { Image: typeof FakeImage }).Image = FakeImage;

// require() (not a static import) so module evaluation is deferred until
// after the fake Image global above is installed — a static import would be
// hoisted above this point and run characterSprites.ts's eager module-init
// sprite loading against the real (absent) Image.
const { preloadActiveCharacterSprites } = require('../render/clusters/characterSprites') as
  typeof import('../render/clusters/characterSprites');
const { hasImageFailed } = require('../render/imageCache') as typeof import('../render/imageCache');

test('a broken sprite file for the active character is reported via console.error, not left silent', async () => {
  const originalConsoleError = console.error;
  const loggedMessages: string[] = [];
  console.error = (...args: unknown[]) => { loggedMessages.push(args.map(String).join(' ')); };

  try {
    await preloadActiveCharacterSprites('outcast');
  } finally {
    console.error = originalConsoleError;
  }

  assert.ok(hasImageFailed('SPRITES/PLAYERS/outcast/outcast_swinging.png'));
  const diagnostic = loggedMessages.find((m) => m.includes('characterSprites'));
  assert.ok(diagnostic !== undefined, 'expected a [characterSprites] diagnostic to be logged');
  assert.match(diagnostic!, /"outcast"/);
  assert.match(diagnostic!, /outcast_swinging\.png/);
});

test('a character with no broken files logs no diagnostic', async () => {
  const originalConsoleError = console.error;
  const loggedMessages: string[] = [];
  console.error = (...args: unknown[]) => { loggedMessages.push(args.map(String).join(' ')); };

  try {
    await preloadActiveCharacterSprites('knight');
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(loggedMessages.find((m) => m.includes('characterSprites')), undefined);
});
