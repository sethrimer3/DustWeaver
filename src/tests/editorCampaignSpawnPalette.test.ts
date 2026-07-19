import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_ITEMS } from '../editor/editorPaletteItems';

test('campaign_spawn appears exactly once in PALETTE_ITEMS, in the triggers category', () => {
  const matches = PALETTE_ITEMS.filter(item => item.id === 'campaign_spawn');
  assert.equal(matches.length, 1, 'campaign_spawn should appear exactly once in PALETTE_ITEMS');
  assert.equal(matches[0].category, 'triggers');
  assert.equal(matches[0].label, 'Campaign Spawn');
});

test('campaign_spawn is included in the rendered Trigger palette item set', () => {
  const triggerIds = PALETTE_ITEMS
    .filter(item => item.category === 'triggers')
    .map(item => item.id);
  assert.ok(triggerIds.includes('campaign_spawn'), 'campaign_spawn should be part of the triggers category list');
});

test('PALETTE_ITEMS has no duplicate ids (guards against accidental duplicate entries)', () => {
  const ids = PALETTE_ITEMS.map(item => item.id);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  assert.deepEqual(dupes, []);
});
