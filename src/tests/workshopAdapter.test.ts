import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeWorkshopAdapter } from '../workshop/fakeWorkshopAdapter';
import { onWorkshopPublished, onWorkshopSubscribed } from '../progression/achievementTracker';
import { getPlatformAdapter, resetPlatformAdapterForTests } from '../platform';
import type { WorkshopPackageManifest, WorkshopPublishInput } from '../workshop/types';

function manifest(overrides: Partial<WorkshopPackageManifest> = {}): WorkshopPackageManifest {
  return {
    formatVersion: 1,
    title: 'Test Campaign',
    description: 'desc',
    authorSteamId: '76561198000000000',
    campaignId: 'test_campaign',
    gameVersion: '1.0.0',
    tags: [],
    ...overrides,
  };
}

/**
 * Minimal publish input. The `campaign` payload is opaque to the adapter
 * (validation happens in packageValidator/the publish dialog), so a marker
 * object keyed by `label` is enough to prove it round-trips intact.
 */
function publishInput(label: string): WorkshopPublishInput {
  return {
    manifest: manifest(),
    campaign: { marker: label },
  };
}

test('publish an item via fake adapter', async () => {
  const adapter = createFakeWorkshopAdapter();
  const { item } = await adapter.publish(publishInput('/campaigns/test'));
  assert.ok(item.steamPublishedFileId.length > 0);
  assert.equal(item.title, 'Test Campaign');
});

test('published item appears in getSubscribedItems', async () => {
  const adapter = createFakeWorkshopAdapter();
  const { item } = await adapter.publish(publishInput('/campaigns/test'));
  const items = await adapter.getSubscribedItems();
  assert.ok(items.some((i) => i.steamPublishedFileId === item.steamPublishedFileId));
});

test('subscribing to an item adds it to subscribed list', async () => {
  const adapter = createFakeWorkshopAdapter();
  await adapter.subscribe('external-item-1');
  const items = await adapter.getSubscribedItems();
  assert.ok(items.some((i) => i.steamPublishedFileId === 'external-item-1' && i.subscribed));
});

test('unsubscribing removes it from subscribed list', async () => {
  const adapter = createFakeWorkshopAdapter();
  await adapter.subscribe('external-item-2');
  await adapter.unsubscribe('external-item-2');
  const items = await adapter.getSubscribedItems();
  assert.equal(items.some((i) => i.steamPublishedFileId === 'external-item-2'), false);
});

test('getInstalledItems returns items with localPath', async () => {
  const adapter = createFakeWorkshopAdapter();
  const { item } = await adapter.publish(publishInput('/campaigns/installed'));
  const installed = await adapter.getInstalledItems();
  const found = installed.find((i) => i.steamPublishedFileId === item.steamPublishedFileId);
  assert.ok(found);
  assert.ok(found?.localPath && found.localPath.length > 0);
});

test('re-publishing with an existing item ID updates in place instead of duplicating', async () => {
  const adapter = createFakeWorkshopAdapter();
  const first = await adapter.publish(publishInput('/campaigns/update'));
  const second = await adapter.publish({
    ...publishInput('/campaigns/update'),
    manifest: manifest({ title: 'Renamed Campaign' }),
    existingPublishedFileId: first.item.steamPublishedFileId,
  });

  assert.equal(second.item.steamPublishedFileId, first.item.steamPublishedFileId);
  const items = await adapter.getSubscribedItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Renamed Campaign');
});

test('a published campaign round-trips back through readInstalledPackage', async () => {
  const adapter = createFakeWorkshopAdapter();
  const input = publishInput('/campaigns/roundtrip');
  const { item } = await adapter.publish(input);

  const localPath = await adapter.download(item.steamPublishedFileId);
  const pkg = await adapter.readInstalledPackage(localPath);

  assert.deepEqual(pkg.manifest, input.manifest);
  assert.deepEqual(pkg.campaignData, input.campaign);
  assert.ok(pkg.files.some((f) => f.path === 'workshop-meta.json'));
  assert.ok(pkg.files.some((f) => f.path.endsWith('.dwcampaign.json')));
});

test('download resolves for a subscribed item', async () => {
  const adapter = createFakeWorkshopAdapter();
  await adapter.subscribe('external-item-3');
  const localPath = await adapter.download('external-item-3');
  assert.ok(localPath.length > 0);
});

test('publishing triggers no real Steam call in fake mode', async () => {
  const adapter = createFakeWorkshopAdapter();
  // No steamworks.js is loaded anywhere in this test process; a successful
  // publish call with no thrown native-module error demonstrates isolation.
  await assert.doesNotReject(adapter.publish(publishInput('/campaigns/isolated')));
  assert.equal(adapter.isAvailable(), true);
});

test('WORKSHOP_AUTHOR achievement is unlocked after successful publish', async () => {
  resetPlatformAdapterForTests();
  onWorkshopPublished();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = await getPlatformAdapter().getAchievementStatus('WORKSHOP_AUTHOR');
  assert.equal(status.unlocked, true);
  resetPlatformAdapterForTests();
});

test('WORKSHOP_SUBSCRIBER achievement is unlocked after subscribe', async () => {
  resetPlatformAdapterForTests();
  onWorkshopSubscribed();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = await getPlatformAdapter().getAchievementStatus('WORKSHOP_SUBSCRIBER');
  assert.equal(status.unlocked, true);
  resetPlatformAdapterForTests();
});

test('fake adapter stores items in memory, independent instances start empty', async () => {
  const adapterA = createFakeWorkshopAdapter();
  await adapterA.publish(publishInput('/campaigns/a'));
  const adapterB = createFakeWorkshopAdapter();
  const itemsB = await adapterB.getSubscribedItems();
  assert.equal(itemsB.length, 0);
});
