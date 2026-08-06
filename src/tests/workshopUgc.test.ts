/**
 * Tests for electron/workshopUgc.cjs — the main-process Steam UGC layer.
 *
 * `steamworks.js` is never installed in the test environment, so every test
 * here drives the module with a hand-rolled fake client. That is the point:
 * these lock down the parts that are ours (staging layout, item-update
 * details, create-vs-update, download waiting) independently of the native
 * module, which can only be verified against a live Steam client.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { readInstalledWorkshopPackageFromDisk } from '../workshop/steamWorkshopAdapter';

const require = createRequire(import.meta.url);
const workshopUgc = require('../../electron/workshopUgc.cjs');

const MANIFEST = {
  formatVersion: 1,
  title: 'Dust Trials',
  description: 'A short campaign.',
  authorSteamId: 'weaver',
  campaignId: 'dust_trials',
  gameVersion: '0.0.608',
  tags: ['short', 'puzzle'],
};

const CAMPAIGN = { version: 1, campaign: { id: 'dust_trials', title: 'Dust Trials' } };

/** A minimal stand-in for `steamworks.js`'s client, recording what it is asked to do. */
function fakeClient(overrides = {}) {
  const calls = { created: 0, updates: [], downloads: [] };
  let installed = overrides.installedFolder ?? null;

  const client = {
    workshop: {
      createItem: async () => {
        calls.created += 1;
        return { itemId: 4242n, needsToAcceptAgreement: overrides.needsAgreement ?? false };
      },
      updateItem: async (itemId, details, appId) => {
        calls.updates.push({ itemId, details, appId });
        return { itemId, needsToAcceptAgreement: false };
      },
      subscribe: async () => {},
      unsubscribe: async () => {},
      getSubscribedItems: () => overrides.subscribedIds ?? [],
      download: (itemId) => {
        calls.downloads.push(itemId);
        // Simulate Steam finishing the fetch asynchronously.
        if (overrides.installOnDownload) installed = overrides.installOnDownload;
        return true;
      },
      installInfo: () => (installed ? { folder: installed } : undefined),
      state: () => overrides.state ?? 0,
      getItems: async (ids) =>
        ids.map((id) => ({
          publishedFileId: id,
          title: `Item ${id}`,
          description: 'from steam',
          tags: ['queried'],
          owner: { steamId64: 76561198000000000n },
        })),
    },
  };
  return { client, calls };
}

// ── Staging ────────────────────────────────────────────────────────────────

test('stageCampaignPackage writes the layout readInstalledWorkshopPackageFromDisk expects', () => {
  const staged = workshopUgc.stageCampaignPackage(MANIFEST, CAMPAIGN, undefined);
  try {
    const pkg = readInstalledWorkshopPackageFromDisk(staged.contentPath);
    assert.deepEqual(pkg.manifest, MANIFEST);
    assert.deepEqual(pkg.campaignData, CAMPAIGN);
    assert.ok(pkg.files.some((f) => f.path === 'workshop-meta.json'));
    assert.ok(pkg.files.some((f) => f.path === 'dust_trials.dwcampaign.json'));
  } finally {
    workshopUgc.cleanupStagedPackage(staged.contentPath);
  }
});

test('stageCampaignPackage sanitizes a hostile campaignId into a safe filename', () => {
  const staged = workshopUgc.stageCampaignPackage(
    { ...MANIFEST, campaignId: '../../evil/../pwn' },
    CAMPAIGN,
    undefined,
  );
  try {
    const names = fs.readdirSync(staged.contentPath);
    const campaignFile = names.find((n) => n.endsWith('.dwcampaign.json'));
    assert.ok(campaignFile);
    assert.equal(campaignFile.includes('..'), false);
    assert.equal(campaignFile.includes('/'), false);
    // Everything written must stay inside the staging root.
    assert.equal(names.length, 2);
  } finally {
    workshopUgc.cleanupStagedPackage(staged.contentPath);
  }
});

test('cleanupStagedPackage removes the staging directory', () => {
  const staged = workshopUgc.stageCampaignPackage(MANIFEST, CAMPAIGN, undefined);
  workshopUgc.cleanupStagedPackage(staged.contentPath);
  assert.equal(fs.existsSync(staged.contentPath), false);
});

test('writePreviewImage accepts a small PNG data URL and rejects other input', () => {
  const staged = workshopUgc.stageCampaignPackage(MANIFEST, CAMPAIGN, undefined);
  try {
    const pngBase64 = Buffer.from('fake-png-bytes').toString('base64');
    const written = workshopUgc.writePreviewImage(staged.contentPath, `data:image/png;base64,${pngBase64}`);
    assert.ok(written && fs.existsSync(written));
    assert.equal(path.basename(written), 'preview.png');

    assert.equal(workshopUgc.writePreviewImage(staged.contentPath, undefined), null);
    assert.equal(workshopUgc.writePreviewImage(staged.contentPath, 'https://example.com/x.png'), null);
    assert.equal(workshopUgc.writePreviewImage(staged.contentPath, 'data:text/html;base64,AAAA'), null);
  } finally {
    workshopUgc.cleanupStagedPackage(staged.contentPath);
  }
});

test('writePreviewImage rejects an image over Steam’s 1 MiB preview limit', () => {
  const staged = workshopUgc.stageCampaignPackage(MANIFEST, CAMPAIGN, undefined);
  try {
    const tooBig = Buffer.alloc(1024 * 1024 + 16, 1).toString('base64');
    assert.equal(workshopUgc.writePreviewImage(staged.contentPath, `data:image/png;base64,${tooBig}`), null);
  } finally {
    workshopUgc.cleanupStagedPackage(staged.contentPath);
  }
});

// ── Publish ────────────────────────────────────────────────────────────────

test('publishItem uploads real content, title, description, and tags', async () => {
  const { client, calls } = fakeClient();
  const result = await workshopUgc.publishItem(client, 3210, { manifest: MANIFEST, campaign: CAMPAIGN });

  assert.equal(calls.created, 1);
  assert.equal(calls.updates.length, 1);
  const { details, appId } = calls.updates[0];
  assert.equal(appId, 3210);
  assert.equal(details.title, 'Dust Trials');
  assert.equal(details.description, 'A short campaign.');
  assert.deepEqual(details.tags, ['short', 'puzzle']);
  // The regression this whole change exists for: content must be attached.
  assert.ok(details.contentPath && details.contentPath.length > 0);
  assert.equal(result.item.steamPublishedFileId, '4242');
});

test('publishItem defaults a new item to private visibility', async () => {
  const { client, calls } = fakeClient();
  await workshopUgc.publishItem(client, 1, { manifest: MANIFEST, campaign: CAMPAIGN });
  assert.equal(calls.updates[0].details.visibility, workshopUgc.VISIBILITY.private);
});

test('publishItem honours an explicit visibility', async () => {
  const { client, calls } = fakeClient();
  await workshopUgc.publishItem(client, 1, { manifest: MANIFEST, campaign: CAMPAIGN, visibility: 'public' });
  assert.equal(calls.updates[0].details.visibility, workshopUgc.VISIBILITY.public);
});

test('publishItem updates an existing item instead of creating a duplicate', async () => {
  const { client, calls } = fakeClient();
  const result = await workshopUgc.publishItem(client, 1, {
    manifest: MANIFEST,
    campaign: CAMPAIGN,
    existingPublishedFileId: '999',
    changeNote: 'fixed room 3',
  });

  assert.equal(calls.created, 0, 'must not create a second Workshop item');
  assert.equal(calls.updates[0].itemId, 999n);
  assert.equal(calls.updates[0].details.changeNote, 'fixed room 3');
  assert.equal(result.item.steamPublishedFileId, '999');
});

test('publishItem surfaces needsToAcceptAgreement so the UI can warn the author', async () => {
  const { client } = fakeClient({ needsAgreement: true });
  const result = await workshopUgc.publishItem(client, 1, { manifest: MANIFEST, campaign: CAMPAIGN });
  assert.equal(result.needsToAcceptAgreement, true);
});

test('publishItem removes its staging directory once the upload finishes', async () => {
  const { client, calls } = fakeClient();
  await workshopUgc.publishItem(client, 1, { manifest: MANIFEST, campaign: CAMPAIGN });
  assert.equal(fs.existsSync(calls.updates[0].details.contentPath), false);
});

test('publishItem cleans up staging even when the upload throws', async () => {
  let attemptedPath = null;
  const client = {
    workshop: {
      createItem: async () => ({ itemId: 7n }),
      updateItem: async (_itemId, details) => {
        attemptedPath = details.contentPath;
        throw new Error('steam exploded');
      },
    },
  };
  await assert.rejects(
    workshopUgc.publishItem(client, 1, { manifest: MANIFEST, campaign: CAMPAIGN }),
    /steam exploded/,
  );
  assert.ok(attemptedPath);
  assert.equal(fs.existsSync(attemptedPath), false);
});

test('publishItem fails clearly when the native workshop API is absent', async () => {
  await assert.rejects(
    workshopUgc.publishItem({}, 1, { manifest: MANIFEST, campaign: CAMPAIGN }),
    /Steam Workshop is unavailable/,
  );
});

// ── Listing ────────────────────────────────────────────────────────────────

test('listSubscribedItems fills in titles from the UGC query rather than blank rows', async () => {
  const { client } = fakeClient({ subscribedIds: [11n, 12n], installedFolder: '/steam/ugc/11' });
  const items = await workshopUgc.listSubscribedItems(client);

  assert.equal(items.length, 2);
  assert.equal(items[0].steamPublishedFileId, '11');
  assert.equal(items[0].title, 'Item 11');
  assert.deepEqual(items[0].tags, ['queried']);
  assert.equal(items[0].installed, true);
  assert.equal(items[0].localPath, '/steam/ugc/11');
});

test('listSubscribedItems reports a still-downloading item as not installed', async () => {
  const { client } = fakeClient({
    subscribedIds: [21n],
    state: workshopUgc.ITEM_STATE.subscribed | workshopUgc.ITEM_STATE.downloading,
  });
  const items = await workshopUgc.listSubscribedItems(client);
  assert.equal(items[0].installed, false);
  assert.equal(items[0].downloading, true);
});

test('listSubscribedItems flags an item Steam holds a newer revision of', async () => {
  const { client } = fakeClient({
    subscribedIds: [31n],
    installedFolder: '/steam/ugc/31',
    state: workshopUgc.ITEM_STATE.installed | workshopUgc.ITEM_STATE.needsUpdate,
  });
  const items = await workshopUgc.listSubscribedItems(client);
  assert.equal(items[0].needsUpdate, true);
});

test('listSubscribedItems returns an empty list when Steam is unavailable', async () => {
  assert.deepEqual(await workshopUgc.listSubscribedItems({}), []);
});

// ── Download ───────────────────────────────────────────────────────────────

test('downloadAndWait returns the install path without re-downloading an installed item', async () => {
  const { client, calls } = fakeClient({ subscribedIds: [5n], installedFolder: '/steam/ugc/5' });
  const folder = await workshopUgc.downloadAndWait(client, '5');
  assert.equal(folder, '/steam/ugc/5');
  assert.equal(calls.downloads.length, 0);
});

test('downloadAndWait triggers a download and resolves once the item installs', async () => {
  const { client, calls } = fakeClient({ installOnDownload: '/steam/ugc/6' });
  const folder = await workshopUgc.downloadAndWait(client, '6', 2000, 5);
  assert.deepEqual(calls.downloads, [6n]);
  assert.equal(folder, '/steam/ugc/6');
});

test('downloadAndWait times out with an actionable message instead of hanging', async () => {
  const { client } = fakeClient();
  await assert.rejects(
    workshopUgc.downloadAndWait(client, '7', 30, 5),
    /still downloading/,
  );
});

test('downloadAndWait re-downloads an item that needs an update', async () => {
  const { client, calls } = fakeClient({
    installedFolder: '/steam/ugc/8',
    state: workshopUgc.ITEM_STATE.installed | workshopUgc.ITEM_STATE.needsUpdate,
  });
  await workshopUgc.downloadAndWait(client, '8', 2000, 5);
  assert.deepEqual(calls.downloads, [8n]);
});

// ── API normalization ──────────────────────────────────────────────────────

test('resolveWorkshopApi accepts either the modern or legacy native method names', () => {
  const modern = workshopUgc.resolveWorkshopApi({
    workshop: { download: () => {}, installInfo: () => {}, subscribe: () => {} },
  });
  assert.ok(modern.download && modern.installInfo && modern.subscribe);

  const legacy = workshopUgc.resolveWorkshopApi({
    workshop: { downloadItem: () => {}, getItemInstallInfo: () => {}, subscribeItem: () => {} },
  });
  assert.ok(legacy.download && legacy.installInfo && legacy.subscribe);
});

test('resolveWorkshopApi returns null when there is no workshop surface at all', () => {
  assert.equal(workshopUgc.resolveWorkshopApi(null), null);
  assert.equal(workshopUgc.resolveWorkshopApi({}), null);
});
