import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeSteamAdapter } from '../platform/fakeSteamAdapter';
import { ACHIEVEMENT_IDS } from '../platform/achievementIds';
import { onRoomCleared, onWeaveEquipped, onMoteCountChanged } from '../progression/achievementTracker';
import { getPlatformAdapter, resetPlatformAdapterForTests } from '../platform';
import { createNewSaveSlot, reconcileSaveSlotAchievements } from '../progression/saveSlots';

test('fakeSteamAdapter starts all achievements locked', async () => {
  const adapter = createFakeSteamAdapter();
  const statuses = await adapter.getAllAchievementStatuses();
  assert.equal(statuses.length, ACHIEVEMENT_IDS.length);
  assert.ok(statuses.every((s) => s.unlocked === false));
});

test('unlockAchievement marks the achievement unlocked', async () => {
  const adapter = createFakeSteamAdapter();
  await adapter.unlockAchievement('FIRST_CLEAR');
  const status = await adapter.getAchievementStatus('FIRST_CLEAR');
  assert.equal(status.unlocked, true);
  assert.equal(typeof status.unlockTimestampMs, 'number');
});

test('double-unlock is idempotent', async () => {
  const adapter = createFakeSteamAdapter();
  await adapter.unlockAchievement('FIRST_WEAVE');
  const first = await adapter.getAchievementStatus('FIRST_WEAVE');
  await adapter.unlockAchievement('FIRST_WEAVE');
  const second = await adapter.getAchievementStatus('FIRST_WEAVE');
  assert.equal(first.unlockTimestampMs, second.unlockTimestampMs);
});

test('getAllAchievementStatuses returns all known IDs', async () => {
  const adapter = createFakeSteamAdapter();
  const statuses = await adapter.getAllAchievementStatuses();
  const ids = statuses.map((s) => s.id).sort();
  assert.deepEqual(ids, [...ACHIEVEMENT_IDS].sort());
});

test('onRoomCleared unlocks FIRST_CLEAR', async () => {
  resetPlatformAdapterForTests();
  onRoomCleared();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = await getPlatformAdapter().getAchievementStatus('FIRST_CLEAR');
  assert.equal(status.unlocked, true);
  resetPlatformAdapterForTests();
});

test('onWeaveEquipped unlocks FIRST_WEAVE', async () => {
  resetPlatformAdapterForTests();
  onWeaveEquipped();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = await getPlatformAdapter().getAchievementStatus('FIRST_WEAVE');
  assert.equal(status.unlocked, true);
  resetPlatformAdapterForTests();
});

test('onMoteCountChanged with 40+ motes unlocks MOTE_HOARDER', async () => {
  resetPlatformAdapterForTests();
  onMoteCountChanged(39);
  await new Promise((resolve) => setTimeout(resolve, 0));
  let status = await getPlatformAdapter().getAchievementStatus('MOTE_HOARDER');
  assert.equal(status.unlocked, false);

  onMoteCountChanged(40);
  await new Promise((resolve) => setTimeout(resolve, 0));
  status = await getPlatformAdapter().getAchievementStatus('MOTE_HOARDER');
  assert.equal(status.unlocked, true);
  resetPlatformAdapterForTests();
});

test('save-reconciliation: achievement in save but not Steam syncs to Steam', async () => {
  resetPlatformAdapterForTests();
  const save = createNewSaveSlot();
  save.unlockedAchievements = ['FIRST_CLEAR'];
  await reconcileSaveSlotAchievements(save);
  const status = await getPlatformAdapter().getAchievementStatus('FIRST_CLEAR');
  assert.equal(status.unlocked, true);
  resetPlatformAdapterForTests();
});

test('save-reconciliation: achievement in Steam but not save syncs to save', async () => {
  resetPlatformAdapterForTests();
  await getPlatformAdapter().unlockAchievement('FIRST_WEAVE');
  const save = createNewSaveSlot();
  await reconcileSaveSlotAchievements(save);
  assert.ok(save.unlockedAchievements.includes('FIRST_WEAVE'));
  resetPlatformAdapterForTests();
});

test('save-reconciliation: already in both does not throw or duplicate', async () => {
  resetPlatformAdapterForTests();
  await getPlatformAdapter().unlockAchievement('NO_HIT_ROOM');
  const save = createNewSaveSlot();
  save.unlockedAchievements = ['NO_HIT_ROOM'];
  await reconcileSaveSlotAchievements(save);
  const occurrences = save.unlockedAchievements.filter((id) => id === 'NO_HIT_ROOM').length;
  assert.equal(occurrences, 1);
  resetPlatformAdapterForTests();
});

test('isAvailable() returns true for fake adapter', () => {
  const adapter = createFakeSteamAdapter();
  assert.equal(adapter.isAvailable(), true);
});

test('storeStats() resolves without error', async () => {
  const adapter = createFakeSteamAdapter();
  await assert.doesNotReject(adapter.storeStats());
});

test('getPersonaName() returns null in fake adapter', async () => {
  const adapter = createFakeSteamAdapter();
  const name = await adapter.getPersonaName();
  assert.equal(name, null);
});

test('achievement IDs are all valid non-empty strings with no spaces', () => {
  for (const id of ACHIEVEMENT_IDS) {
    assert.ok(typeof id === 'string' && id.length > 0);
    assert.ok(!id.includes(' '));
  }
});

test('rendererPlatform falls back to fake adapter when window.electronPlatform is undefined', async () => {
  // In the Node test environment there is no `window`, so createRendererPlatformAdapter
  // must produce a working fake adapter rather than throwing.
  const { createRendererPlatformAdapter } = await import('../platform/rendererPlatform');
  const adapter = createRendererPlatformAdapter();
  assert.equal(adapter.isAvailable(), true);
  await adapter.unlockAchievement('SPEED_RUNNER');
  const status = await adapter.getAchievementStatus('SPEED_RUNNER');
  assert.equal(status.unlocked, true);
});
