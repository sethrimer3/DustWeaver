import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AVAILABLE_SONGS, MUSIC_ASSET_PATHS, resolveMusicAssetUrl } from '../audio/musicManager';

test('configured music paths exactly match public MUSIC assets', () => {
  const musicDir = resolve(process.cwd(), 'ASSETS', 'MUSIC');
  const exactNames = new Set(readdirSync(musicDir));
  for (const songId of AVAILABLE_SONGS) {
    const runtimePath = MUSIC_ASSET_PATHS[songId];
    assert.match(runtimePath, /^MUSIC\/[^/]+\.mp3$/);
    assert.doesNotMatch(runtimePath, /^(?:music\/|ASSETS\/MUSIC\/)/);
    const filename = runtimePath.slice('MUSIC/'.length);
    assert.ok(exactNames.has(filename), `${runtimePath} must match asset casing exactly`);
    assert.ok(existsSync(resolve(musicDir, filename)));
  }
});

test('title menu uses the canonical shared URL', () => {
  assert.equal(resolveMusicAssetUrl('/DustWeaver/', 'titleMenu'), '/DustWeaver/MUSIC/titleMenu.mp3');
});
