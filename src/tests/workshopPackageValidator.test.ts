import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateWorkshopPackage, type WorkshopPackageFile } from '../workshop/packageValidator';

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    title: 'My Campaign',
    description: 'A fun campaign',
    authorSteamId: '76561198000000000',
    campaignId: 'my_campaign',
    gameVersion: '1.0.0',
    tags: ['adventure'],
    ...overrides,
  };
}

function validCampaign() {
  return {
    v: 1,
    kind: 'DustWeaverCampaign',
    campaign: {
      id: 'my_campaign',
      title: 'My Campaign',
      creator: 'tester',
      description: '',
      initialRoomId: 'room1',
      initialRoomImagePath: null,
    },
    worldMap: { worlds: [], rooms: [] },
    rooms: [
      { v: 2, id: 'room1', name: 'room1', world: 0, size: [10, 10], spawn: [1, 1], solids: {} },
    ],
    editor: { createdWithBuild: '1', lastEditedIso: new Date(0).toISOString() },
  };
}

function file(path: string, sizeBytes = 100): WorkshopPackageFile {
  return { path, sizeBytes };
}

test('valid minimal package passes', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [file('workshop-meta.json')]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('valid full package with campaign passes', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [
    file('workshop-meta.json'),
    file('campaign/room1.json'),
    file('preview.png', 1024),
  ]);
  assert.equal(result.valid, true);
});

test('missing workshop-meta.json fails', () => {
  const result = validateWorkshopPackage(undefined, validCampaign(), []);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('workshop-meta.json')));
});

test('missing required title fails', () => {
  const manifest = validManifest({ title: '' });
  const result = validateWorkshopPackage(manifest, validCampaign(), []);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('title')));
});

test('formatVersion !== 1 fails', () => {
  const manifest = validManifest({ formatVersion: 2 });
  const result = validateWorkshopPackage(manifest, validCampaign(), []);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('formatVersion')));
});

test('path traversal ../../etc/passwd rejected', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [file('../../etc/passwd')]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Unsafe file path')));
});

test('absolute path in package rejected', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [file('/etc/passwd')]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Unsafe file path')));
});

test('package over 50 MB rejected', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [
    file('big.json', 51 * 1024 * 1024),
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('total size')));
});

test('single file over 10 MB rejected', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [
    file('huge.png', 11 * 1024 * 1024),
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('per-file limit')));
});

test('more than 500 files rejected', () => {
  const files = Array.from({ length: 501 }, (_, i) => file(`file${i}.json`));
  const result = validateWorkshopPackage(validManifest(), validCampaign(), files);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('exceeding the limit of 500')));
});

test('disallowed extension .exe rejected', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [file('payload.exe')]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Disallowed file extension')));
});

test('disallowed extension .js rejected', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [file('script.js')]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Disallowed file extension')));
});

test('.json extension allowed', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [file('data.json')]);
  assert.equal(result.errors.some((e) => e.includes('Disallowed file extension')), false);
});

test('.png extension allowed', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [file('preview.png')]);
  assert.equal(result.errors.some((e) => e.includes('Disallowed file extension')), false);
});

test('.ogg extension allowed', () => {
  const result = validateWorkshopPackage(validManifest(), validCampaign(), [file('sound.ogg')]);
  assert.equal(result.errors.some((e) => e.includes('Disallowed file extension')), false);
});

test('errors array is populated with human-readable messages', () => {
  const result = validateWorkshopPackage({}, undefined, [file('bad.exe'), file('../evil.json')]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.every((e) => typeof e === 'string' && e.length > 0));
});
