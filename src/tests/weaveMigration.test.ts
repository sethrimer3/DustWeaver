import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  migrateLegacyWeaveUnlocks,
  hasSwordWeave,
  hasShieldWeave,
  hasBowWeave,
  expandLegacyWeaveId,
} from '../progression/weaveMigration';
import { createDefaultProgress } from '../progression/playerProgress';
import {
  CAMPAIGN_STARTING_WEAVE_LIST,
  WEAVE_STORM,
  WEAVE_SHIELD,
  WEAVE_ARROW,
  WEAVE_SHIELD_SWORD,
  WEAVE_SWORD,
} from '../sim/weaves/weaveDefinition';
import { applyCampaignStartingOptions } from '../progression/campaignStartingOptions';

// ---- Independent unlock getters --------------------------------------------

test('hasSwordWeave/hasShieldWeave/hasBowWeave are independent of each other', () => {
  const p = createDefaultProgress();
  assert.equal(hasSwordWeave(p), false);
  assert.equal(hasShieldWeave(p), false);
  assert.equal(hasBowWeave(p), false);

  p.unlockedActiveWeaves.push(WEAVE_SWORD);
  assert.equal(hasSwordWeave(p), true);
  assert.equal(hasShieldWeave(p), false);
  assert.equal(hasBowWeave(p), false);

  p.unlockedActiveWeaves.push(WEAVE_ARROW);
  assert.equal(hasSwordWeave(p), true);
  assert.equal(hasShieldWeave(p), false);
  assert.equal(hasBowWeave(p), true);

  p.unlockedActiveWeaves.push(WEAVE_SHIELD);
  assert.equal(hasSwordWeave(p), true);
  assert.equal(hasShieldWeave(p), true);
  assert.equal(hasBowWeave(p), true);
});

// ---- migrateLegacyWeaveUnlocks ---------------------------------------------

test('legacy shield_sword migrates to grant both sword and shield unlocks', () => {
  const p = createDefaultProgress();
  p.unlockedActiveWeaves = [WEAVE_SHIELD_SWORD];
  migrateLegacyWeaveUnlocks(p);
  assert.equal(hasSwordWeave(p), true);
  assert.equal(hasShieldWeave(p), true);
  // The legacy combo id itself is retained (still read directly by the
  // equip/combat code as the combo weave id) — migration only adds.
  assert.ok(p.unlockedActiveWeaves.includes(WEAVE_SHIELD_SWORD));
});

test('legacy arrow migrates to (already) grant the bow unlock', () => {
  const p = createDefaultProgress();
  p.unlockedActiveWeaves = [WEAVE_ARROW];
  migrateLegacyWeaveUnlocks(p);
  assert.equal(hasBowWeave(p), true);
  assert.equal(hasSwordWeave(p), false);
  assert.equal(hasShieldWeave(p), false);
});

test('legacy shield migrates to (already) grant the shield unlock', () => {
  const p = createDefaultProgress();
  p.unlockedActiveWeaves = [WEAVE_SHIELD];
  migrateLegacyWeaveUnlocks(p);
  assert.equal(hasShieldWeave(p), true);
  assert.equal(hasSwordWeave(p), false);
  assert.equal(hasBowWeave(p), false);
});

test('legacy storm is left untouched (Stormweave has its own independent system)', () => {
  const p = createDefaultProgress();
  p.unlockedActiveWeaves = [WEAVE_STORM];
  migrateLegacyWeaveUnlocks(p);
  assert.deepEqual(p.unlockedActiveWeaves, [WEAVE_STORM]);
});

test('unknown weave ids are sanitized (dropped) without throwing', () => {
  const p = createDefaultProgress();
  p.unlockedActiveWeaves = ['totally-not-a-weave', WEAVE_SHIELD, 'another-bogus-id'];
  assert.doesNotThrow(() => migrateLegacyWeaveUnlocks(p));
  assert.ok(!p.unlockedActiveWeaves.includes('totally-not-a-weave'));
  assert.ok(!p.unlockedActiveWeaves.includes('another-bogus-id'));
  assert.ok(p.unlockedActiveWeaves.includes(WEAVE_SHIELD));
});

test('duplicate weave ids are removed after migration', () => {
  const p = createDefaultProgress();
  p.unlockedActiveWeaves = [WEAVE_SHIELD, WEAVE_SHIELD, WEAVE_ARROW, WEAVE_ARROW];
  migrateLegacyWeaveUnlocks(p);
  const shieldCount = p.unlockedActiveWeaves.filter(id => id === WEAVE_SHIELD).length;
  const arrowCount = p.unlockedActiveWeaves.filter(id => id === WEAVE_ARROW).length;
  assert.equal(shieldCount, 1);
  assert.equal(arrowCount, 1);
});

test('migration is idempotent — running twice matches running once', () => {
  const p = createDefaultProgress();
  p.unlockedActiveWeaves = [WEAVE_SHIELD_SWORD, WEAVE_ARROW, 'garbage'];
  migrateLegacyWeaveUnlocks(p);
  const afterFirst = [...p.unlockedActiveWeaves].sort();
  migrateLegacyWeaveUnlocks(p);
  const afterSecond = [...p.unlockedActiveWeaves].sort();
  assert.deepEqual(afterSecond, afterFirst);
});

test('migration never silently removes an ability the save already has', () => {
  const p = createDefaultProgress();
  p.unlockedActiveWeaves = [WEAVE_STORM, WEAVE_SHIELD, WEAVE_ARROW, WEAVE_SHIELD_SWORD, WEAVE_SWORD];
  migrateLegacyWeaveUnlocks(p);
  for (const id of [WEAVE_STORM, WEAVE_SHIELD, WEAVE_ARROW, WEAVE_SHIELD_SWORD, WEAVE_SWORD]) {
    assert.ok(p.unlockedActiveWeaves.includes(id), `expected ${id} to remain unlocked`);
  }
});

// ---- expandLegacyWeaveId ----------------------------------------------------

test('expandLegacyWeaveId expands shield_sword to combo+sword+shield', () => {
  assert.deepEqual(expandLegacyWeaveId(WEAVE_SHIELD_SWORD), [WEAVE_SHIELD_SWORD, WEAVE_SWORD, WEAVE_SHIELD]);
});

test('expandLegacyWeaveId passes through non-legacy known ids unchanged', () => {
  assert.deepEqual(expandLegacyWeaveId(WEAVE_ARROW), [WEAVE_ARROW]);
  assert.deepEqual(expandLegacyWeaveId(WEAVE_SHIELD), [WEAVE_SHIELD]);
  assert.deepEqual(expandLegacyWeaveId(WEAVE_STORM), [WEAVE_STORM]);
});

test('expandLegacyWeaveId safely ignores unknown ids', () => {
  assert.deepEqual(expandLegacyWeaveId('not-a-real-weave'), []);
});

// ---- Campaign starting-weave config: independent subset support ------------

test('campaign spawn offers Shield, Bow, and Sword as independent starting choices', () => {
  assert.deepEqual(CAMPAIGN_STARTING_WEAVE_LIST, [WEAVE_SHIELD, WEAVE_ARROW, WEAVE_SWORD]);
});

test('campaign startingWeaves grants sword, shield, and bow independently', () => {
  const p = createDefaultProgress();
  applyCampaignStartingOptions(
    p,
    { roomId: 'r', xBlock: 0, yBlock: 0, startingWeaves: [WEAVE_SWORD, WEAVE_SHIELD, WEAVE_ARROW] },
    'fresh',
  );
  assert.equal(hasSwordWeave(p), true);
  assert.equal(hasShieldWeave(p), true);
  assert.equal(hasBowWeave(p), true);
});

test('campaign startingWeaves grants only a subset when only some are listed', () => {
  const p = createDefaultProgress();
  applyCampaignStartingOptions(
    p,
    { roomId: 'r', xBlock: 0, yBlock: 0, startingWeaves: [WEAVE_SHIELD] },
    'fresh',
  );
  assert.equal(hasShieldWeave(p), true);
  assert.equal(hasSwordWeave(p), false);
  assert.equal(hasBowWeave(p), false);
});

test('old single-value legacy campaign specifying shield_sword still loads and grants sword+shield', () => {
  const p = createDefaultProgress();
  applyCampaignStartingOptions(
    p,
    { roomId: 'r', xBlock: 0, yBlock: 0, startingWeaves: [WEAVE_SHIELD_SWORD] },
    'fresh',
  );
  assert.equal(hasSwordWeave(p), true);
  assert.equal(hasShieldWeave(p), true);
  assert.ok(p.unlockedActiveWeaves.includes(WEAVE_SHIELD_SWORD));
});
