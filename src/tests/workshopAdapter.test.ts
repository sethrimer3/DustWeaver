import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeWorkshopAdapter } from '../workshop/fakeWorkshopAdapter';
import { onWorkshopPublished, onWorkshopSubscribed } from '../progression/achievementTracker';
import { getPlatformAdapter, resetPlatformAdapterForTests } from '../platform';
import type { WorkshopPackageManifest } from '../workshop/types';

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

test('publish an item via fake adapter', async () => {
  const adapter = createFakeWorkshopAdapter();
  const item = await adapter.publish(manifest(), '/campaigns/test');
  assert.ok(item.steamPublishedFileId.length > 0);
  assert.equal(item.title, 'Test Campaign');
});

test('published item appears in getSubscribedItems', async () => {
  const adapter = createFakeWorkshopAdapter();
  const item = await adapter.publish(manifest(), '/campaigns/test');
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
  const item = await adapter.publish(manifest(), '/campaigns/installed');
  const installed = await adapter.getInstalledItems();
  const found = installed.find((i) => i.steamPublishedFileId === item.steamPublishedFileId);
  assert.ok(found);
  assert.equal(found?.localPath, '/campaigns/installed');
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
  await assert.doesNotReject(adapter.publish(manifest(), '/campaigns/isolated'));
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
  await adapterA.publish(manifest(), '/campaigns/a');
  const adapterB = createFakeWorkshopAdapter();
  const itemsB = await adapterB.getSubscribedItems();
  assert.equal(itemsB.length, 0);
});
