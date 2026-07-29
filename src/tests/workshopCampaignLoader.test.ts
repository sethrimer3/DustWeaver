import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadCampaignSourceForWorkshopItem } from '../workshop/workshopCampaignLoader';
import { registerFakeInstalledPackage, clearFakeInstalledPackages } from '../workshop/fakeWorkshopAdapter';
import { resetWorkshopAdapterForTests } from '../workshop';
import { readInstalledWorkshopPackageFromDisk } from '../workshop/steamWorkshopAdapter';
import type { WorkshopItem } from '../workshop/types';

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

function validCampaign(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function item(overrides: Partial<WorkshopItem> = {}): WorkshopItem {
  return {
    steamPublishedFileId: 'wsitem-1',
    title: 'Test Workshop Campaign',
    description: 'desc',
    authorName: 'author',
    tags: [],
    subscribed: true,
    installed: true,
    localPath: '/fake/path/wsitem-1',
    ...overrides,
  };
}

test.beforeEach(() => {
  resetWorkshopAdapterForTests();
  clearFakeInstalledPackages();
});

// ── Core happy path ─────────────────────────────────────────────────────────

test('installed valid item produces a playable CampaignSource', async () => {
  const localPath = '/fake/path/valid-item';
  registerFakeInstalledPackage(localPath, {
    manifest: validManifest(),
    campaignData: validCampaign(),
    files: [{ path: 'workshop-meta.json', sizeBytes: 100 }, { path: 'my_campaign.dwcampaign.json', sizeBytes: 200 }],
  });
  const result = await loadCampaignSourceForWorkshopItem(item({ localPath }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.source.id, 'my_campaign');
    assert.equal(result.source.title, 'My Campaign');
    assert.equal(result.source.sourceKind, 'workshop-campaign');
    assert.equal(typeof result.source.loadPackedCampaign, 'function');
  }
});

test('Play callback flow: loadPackedCampaign returns the exact installed campaign data', async () => {
  const localPath = '/fake/path/play-flow';
  const campaign = validCampaign({ campaign: { id: 'flow_campaign', title: 'Flow', creator: 'x', description: '', initialRoomId: 'room1', initialRoomImagePath: null } });
  registerFakeInstalledPackage(localPath, {
    manifest: validManifest({ campaignId: 'flow_campaign' }),
    campaignData: campaign,
    files: [{ path: 'workshop-meta.json', sizeBytes: 100 }, { path: 'flow_campaign.dwcampaign.json', sizeBytes: 200 }],
  });
  const result = await loadCampaignSourceForWorkshopItem(item({ localPath }));
  assert.equal(result.ok, true);
  if (result.ok) {
    const loaded = await result.source.loadPackedCampaign!();
    assert.deepEqual(loaded, campaign);
  }
});

// ── Failure states ──────────────────────────────────────────────────────────

test('still-downloading (not installed) item is rejected with a clear reason', async () => {
  const result = await loadCampaignSourceForWorkshopItem(item({ installed: false, localPath: undefined }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'not-installed');
});

test('installed item with no localPath is rejected', async () => {
  const result = await loadCampaignSourceForWorkshopItem(item({ installed: true, localPath: undefined }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'missing-path');
});

test('missing installation directory (unregistered fake package) surfaces read-failed', async () => {
  const result = await loadCampaignSourceForWorkshopItem(item({ localPath: '/fake/path/does-not-exist' }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'read-failed');
});

test('malformed package (unsupported formatVersion) is rejected before launch', async () => {
  const localPath = '/fake/path/bad-format-version';
  registerFakeInstalledPackage(localPath, {
    manifest: validManifest({ formatVersion: 2 }),
    campaignData: validCampaign(),
    files: [{ path: 'workshop-meta.json', sizeBytes: 100 }],
  });
  const result = await loadCampaignSourceForWorkshopItem(item({ localPath }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'invalid-package');
    assert.ok(result.message.includes('formatVersion'));
  }
});

test('malformed campaign data (missing required fields) is rejected before launch', async () => {
  const localPath = '/fake/path/bad-campaign';
  registerFakeInstalledPackage(localPath, {
    manifest: validManifest(),
    campaignData: { v: 1, kind: 'DustWeaverCampaign' },
    files: [{ path: 'workshop-meta.json', sizeBytes: 100 }],
  });
  const result = await loadCampaignSourceForWorkshopItem(item({ localPath }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'invalid-package');
});

test('disallowed file type in package listing is rejected before launch', async () => {
  const localPath = '/fake/path/bad-extension';
  registerFakeInstalledPackage(localPath, {
    manifest: validManifest(),
    campaignData: validCampaign(),
    files: [{ path: 'workshop-meta.json', sizeBytes: 100 }, { path: 'payload.exe', sizeBytes: 100 }],
  });
  const result = await loadCampaignSourceForWorkshopItem(item({ localPath }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'invalid-package');
    assert.ok(result.message.includes('Disallowed file extension'));
  }
});

test('path traversal in package listing is rejected before launch', async () => {
  const localPath = '/fake/path/traversal';
  registerFakeInstalledPackage(localPath, {
    manifest: validManifest(),
    campaignData: validCampaign(),
    files: [{ path: 'workshop-meta.json', sizeBytes: 100 }, { path: '../../etc/passwd', sizeBytes: 100 }],
  });
  const result = await loadCampaignSourceForWorkshopItem(item({ localPath }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'invalid-package');
    assert.ok(result.message.includes('Unsafe file path'));
  }
});

// ── Fake/web adapter behavior ────────────────────────────────────────────────

test('fake adapter never crashes and reports a graceful message for unregistered items', async () => {
  const result = await loadCampaignSourceForWorkshopItem(item({ localPath: '/fake/path/never-registered' }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'read-failed');
    assert.ok(result.message.length > 0);
  }
});

// ── Real-disk path traversal / missing directory (steamWorkshopAdapter) ─────

test('readInstalledWorkshopPackageFromDisk rejects a missing directory', () => {
  assert.throws(() => readInstalledWorkshopPackageFromDisk(path.join(os.tmpdir(), 'dw-workshop-does-not-exist-xyz')));
});

test('readInstalledWorkshopPackageFromDisk reads a valid on-disk package', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-workshop-'));
  try {
    fs.writeFileSync(path.join(dir, 'workshop-meta.json'), JSON.stringify(validManifest()));
    fs.writeFileSync(path.join(dir, 'my_campaign.dwcampaign.json'), JSON.stringify(validCampaign()));
    const pkg = readInstalledWorkshopPackageFromDisk(dir);
    assert.equal((pkg.manifest as { title: string }).title, 'My Campaign');
    assert.ok(pkg.files.some((f) => f.path === 'workshop-meta.json'));
    assert.ok(pkg.files.some((f) => f.path === 'my_campaign.dwcampaign.json'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readInstalledWorkshopPackageFromDisk rejects a directory missing workshop-meta.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-workshop-'));
  try {
    fs.writeFileSync(path.join(dir, 'my_campaign.dwcampaign.json'), JSON.stringify(validCampaign()));
    assert.throws(() => readInstalledWorkshopPackageFromDisk(dir), /workshop-meta\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readInstalledWorkshopPackageFromDisk rejects a directory missing the campaign file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-workshop-'));
  try {
    fs.writeFileSync(path.join(dir, 'workshop-meta.json'), JSON.stringify(validManifest()));
    assert.throws(() => readInstalledWorkshopPackageFromDisk(dir), /dwcampaign\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
