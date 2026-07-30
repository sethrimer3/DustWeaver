/**
 * The Electron custom-protocol handler (`dustweaver://app/...`) maps request
 * URLs to files under dist/ via resolveDistFilePath() in
 * electron/distFilePathResolver.cjs (a pure, Electron-free module extracted
 * from main.cjs specifically so it's unit-testable). Confirms the Outcast
 * sprite URL resolves into dist/ correctly, and that path escape is blocked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join, sep } from 'node:path';

const require = createRequire(import.meta.url);
const { resolveDistFilePath, getContentTypeForPath } = require('../../electron/distFilePathResolver.cjs') as {
  resolveDistFilePath: (url: string, baseDir: string) => string | null;
  getContentTypeForPath: (filePath: string) => string;
};

const electronDir = resolve(process.cwd(), 'electron');
const distDir = resolve(process.cwd(), 'dist');

test('the Outcast standing sprite URL resolves into dist/ without escaping it', () => {
  const resolved = resolveDistFilePath('dustweaver://app/SPRITES/PLAYERS/outcast/outcast_standing.png', electronDir);
  assert.equal(resolved, join(distDir, 'SPRITES', 'PLAYERS', 'outcast', 'outcast_standing.png'));
  assert.ok(resolved!.startsWith(distDir + sep));
});

test('getContentTypeForPath reports image/png for a .png request', () => {
  assert.equal(getContentTypeForPath('outcast_standing.png'), 'image/png');
});

test('path-traversal attempts never resolve to a path outside dist/', () => {
  // The WHATWG URL parser itself collapses ".." path segments — including
  // percent-encoded forms like "%2e%2e" — before this function ever sees
  // the pathname, so a request can't reach the join()/normalize() step with
  // real ".." segments intact. Assert the outcome that actually matters:
  // whatever `resolveDistFilePath` returns, it is either null or a path
  // still rooted under dist/ — the guard (or the URL parser upstream of it)
  // never lets a request escape.
  for (const payload of ['../../../etc/passwd', '%2e%2e/%2e%2e/%2e%2e/etc/passwd', '..%2f..%2f..%2fetc%2fpasswd']) {
    const resolved = resolveDistFilePath(`dustweaver://app/${payload}`, electronDir);
    assert.ok(
      resolved === null || resolved.startsWith(distDir + sep),
      `payload "${payload}" escaped dist/: ${resolved}`,
    );
  }
});

test('the root URL resolves to index.html', () => {
  const resolved = resolveDistFilePath('dustweaver://app/', electronDir);
  assert.equal(resolved, join(distDir, 'index.html'));
});
