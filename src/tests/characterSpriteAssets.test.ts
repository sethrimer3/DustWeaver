/**
 * Regression coverage for the Outcast green-placeholder-box bug: the manifest
 * in characterSpriteManifest.ts must exactly match real sprite files on disk
 * — both in ASSETS/ (source) and, when available, dist/ (a built copy) —
 * with exact filename casing. A silent mismatch here means a character
 * renders as the `isSpriteReady`-fallback green box with no explanation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PLAYABLE_CHARACTER_IDS,
  getRequiredCharacterSpriteUrls,
} from '../render/clusters/characterSpriteManifest';

/** Splits a manifest URL like 'SPRITES/PLAYERS/outcast/outcast_standing.png' into its dir/filename parts, relative to a root. */
function toAbsolute(root: string, url: string): { dir: string; filename: string; full: string } {
  const parts = url.split('/');
  const filename = parts.pop()!;
  const dir = resolve(root, ...parts);
  return { dir, filename, full: resolve(root, ...parts, filename) };
}

test('every registered playable character has its required standing and crouching source files', () => {
  const assetsRoot = resolve(process.cwd(), 'ASSETS');
  for (const characterId of PLAYABLE_CHARACTER_IDS) {
    const urls = getRequiredCharacterSpriteUrls(characterId);
    assert.ok(urls.length >= 2, `${characterId} must declare at least standing + crouching`);
    for (const url of urls) {
      const { full } = toAbsolute(assetsRoot, url);
      assert.ok(existsSync(full), `${characterId}: expected source file at ${full} (declared as "${url}")`);
    }
  }
});

test('every declared animation frame file matches the real filename exactly, including case', () => {
  const assetsRoot = resolve(process.cwd(), 'ASSETS');
  for (const characterId of PLAYABLE_CHARACTER_IDS) {
    const urls = getRequiredCharacterSpriteUrls(characterId);
    for (const url of urls) {
      const { dir, filename } = toAbsolute(assetsRoot, url);
      const actualNames = new Set(readdirSync(dir));
      assert.ok(
        actualNames.has(filename),
        `${characterId}: "${filename}" (from manifest URL "${url}") must match the on-disk filename exactly (case-sensitive) in ${dir}`,
      );
    }
  }
});

test('outcast standing sprite is declared at SPRITES/PLAYERS/outcast/outcast_standing.png', () => {
  const urls = getRequiredCharacterSpriteUrls('outcast');
  assert.ok(urls.includes('SPRITES/PLAYERS/outcast/outcast_standing.png'));
});

test('a production build (dist/) contains every declared Outcast sprite file', () => {
  const distRoot = resolve(process.cwd(), 'dist');
  if (!existsSync(distRoot)) {
    // No build artifact present in this checkout (e.g. before `npm run build`
    // has ever run) — nothing to validate. The ASSETS/-based tests above
    // still exercise the real filesystem.
    return;
  }
  const urls = getRequiredCharacterSpriteUrls('outcast');
  for (const url of urls) {
    const { full } = toAbsolute(distRoot, url);
    assert.ok(existsSync(full), `dist/ is missing declared Outcast sprite: ${full} (declared as "${url}")`);
  }
});

test('existing Knight, Demon Fox, and Princess sprite paths remain valid', () => {
  const assetsRoot = resolve(process.cwd(), 'ASSETS');
  for (const characterId of ['knight', 'demonFox', 'princess'] as const) {
    for (const url of getRequiredCharacterSpriteUrls(characterId)) {
      const { full } = toAbsolute(assetsRoot, url);
      assert.ok(existsSync(full), `${characterId}: expected source file at ${full} (declared as "${url}")`);
    }
  }
});
