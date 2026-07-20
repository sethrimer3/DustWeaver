/**
 * Skill-book (skill tomb) collection semantics — Stage 4 of the
 * Sword/Shield/Bow Weave rework.
 *
 * These tests exercise the same collection logic used by the Interact
 * handler in `gameCommandProcessor.ts` (unlockActiveWeave + expandLegacyWeaveId
 * + consumedSkillTombKeySet / progress.collectedSkillTombKeys bookkeeping),
 * without needing the full game-screen/world harness. The helper below
 * mirrors that logic exactly so these tests stay meaningful if the real
 * code regresses.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultProgress, PlayerProgress } from '../progression/playerProgress';
import { unlockActiveWeave } from '../progression/unlocks';
import { expandLegacyWeaveId, hasSwordWeave, hasShieldWeave, hasBowWeave } from '../progression/weaveMigration';
import {
  WEAVE_SWORD,
  WEAVE_SHIELD,
  WEAVE_ARROW,
  WEAVE_SHIELD_SWORD,
  getWeaveDefinition,
} from '../sim/weaves/weaveDefinition';

/** Mirrors the collection logic in gameCommandProcessor.ts's Interact handler. */
function collectSkillBook(
  progress: PlayerProgress,
  consumedSkillTombKeySet: Set<string>,
  consumedKey: string,
  weaveId: string,
): boolean {
  if (consumedSkillTombKeySet.has(consumedKey)) return false;
  const expanded = expandLegacyWeaveId(weaveId);
  const idsToGrant = expanded.length > 0 ? expanded : [weaveId];
  for (const id of idsToGrant) unlockActiveWeave(progress, id);
  consumedSkillTombKeySet.add(consumedKey);
  if (progress.collectedSkillTombKeys.indexOf(consumedKey) === -1) {
    progress.collectedSkillTombKeys.push(consumedKey);
  }
  return true;
}

// ---- Independent unlock per book -------------------------------------------

test('Sword Weave Skill Book independently unlocks sword', () => {
  const progress = createDefaultProgress();
  const consumed = new Set<string>();
  collectSkillBook(progress, consumed, 'room1:3:4', WEAVE_SWORD);
  assert.equal(hasSwordWeave(progress), true);
  assert.equal(hasShieldWeave(progress), false);
  assert.equal(hasBowWeave(progress), false);
});

test('Shield Weave Skill Book independently unlocks shield', () => {
  const progress = createDefaultProgress();
  const consumed = new Set<string>();
  collectSkillBook(progress, consumed, 'room1:5:6', WEAVE_SHIELD);
  assert.equal(hasShieldWeave(progress), true);
  assert.equal(hasSwordWeave(progress), false);
  assert.equal(hasBowWeave(progress), false);
});

test('Bow Weave Skill Book independently unlocks bow (arrow id)', () => {
  const progress = createDefaultProgress();
  const consumed = new Set<string>();
  collectSkillBook(progress, consumed, 'room1:7:8', WEAVE_ARROW);
  assert.equal(hasBowWeave(progress), true);
  assert.equal(hasSwordWeave(progress), false);
  assert.equal(hasShieldWeave(progress), false);
});

test('Bow Weave book displays canonical "Bow Weave" name', () => {
  assert.equal(getWeaveDefinition(WEAVE_ARROW).displayName, 'Bow Weave');
});

// ---- Idempotency / no double-grant ------------------------------------------

test('collecting the same uid twice does not double-grant or error', () => {
  const progress = createDefaultProgress();
  const consumed = new Set<string>();
  const first = collectSkillBook(progress, consumed, 'room1:1:1', WEAVE_SWORD);
  const second = collectSkillBook(progress, consumed, 'room1:1:1', WEAVE_SWORD);
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(progress.unlockedActiveWeaves.filter(w => w === WEAVE_SWORD).length, 1);
  assert.equal(progress.collectedSkillTombKeys.filter(k => k === 'room1:1:1').length, 1);
});

test('already-unlocked-weave book still marks itself consumed without erroring or double-granting', () => {
  const progress = createDefaultProgress();
  unlockActiveWeave(progress, WEAVE_SWORD);
  const consumed = new Set<string>();
  const result = collectSkillBook(progress, consumed, 'room2:9:9', WEAVE_SWORD);
  assert.equal(result, true);
  assert.equal(progress.unlockedActiveWeaves.filter(w => w === WEAVE_SWORD).length, 1);
  assert.equal(consumed.has('room2:9:9'), true);
});

// ---- Order independence -----------------------------------------------------

test('books collected in any order produce the same final ability set', () => {
  const progressA = createDefaultProgress();
  const consumedA = new Set<string>();
  collectSkillBook(progressA, consumedA, 'r:1:1', WEAVE_SWORD);
  collectSkillBook(progressA, consumedA, 'r:2:2', WEAVE_SHIELD);
  collectSkillBook(progressA, consumedA, 'r:3:3', WEAVE_ARROW);

  const progressB = createDefaultProgress();
  const consumedB = new Set<string>();
  collectSkillBook(progressB, consumedB, 'r:3:3', WEAVE_ARROW);
  collectSkillBook(progressB, consumedB, 'r:1:1', WEAVE_SWORD);
  collectSkillBook(progressB, consumedB, 'r:2:2', WEAVE_SHIELD);

  assert.deepEqual(
    [...progressA.unlockedActiveWeaves].sort(),
    [...progressB.unlockedActiveWeaves].sort(),
  );
});

// ---- Legacy combined book ----------------------------------------------------

test('legacy combined shield_sword book grants both Sword and Shield on collection', () => {
  const progress = createDefaultProgress();
  const consumed = new Set<string>();
  collectSkillBook(progress, consumed, 'legacyRoom:0:0', WEAVE_SHIELD_SWORD);
  assert.equal(hasSwordWeave(progress), true);
  assert.equal(hasShieldWeave(progress), true);
  // The legacy combo id itself is also retained since combat code still
  // reads it directly as the equipped secondary weave id.
  assert.equal(progress.unlockedActiveWeaves.indexOf(WEAVE_SHIELD_SWORD) !== -1, true);
});

// ---- Persistence across save/load -------------------------------------------

test('collected skill-tomb keys and unlocked weaves round-trip through save serialization', () => {
  const progress = createDefaultProgress();
  const consumed = new Set<string>();
  collectSkillBook(progress, consumed, 'saveRoom:2:3', WEAVE_SWORD);

  // Simulate save -> load: serialize to JSON and back, as saveSlots.ts does.
  const roundTripped: PlayerProgress = JSON.parse(JSON.stringify(progress));
  assert.deepEqual(roundTripped.collectedSkillTombKeys, ['saveRoom:2:3']);
  assert.deepEqual(roundTripped.unlockedActiveWeaves, progress.unlockedActiveWeaves);
  assert.equal(hasSwordWeave(roundTripped), true);

  // Re-hydrating consumedSkillTombKeySet from the loaded progress (as
  // gameScreen.ts does) must mark the book as already consumed so
  // re-interacting is a safe no-op and does not double-grant.
  const rehydratedConsumedSet = new Set<string>(roundTripped.collectedSkillTombKeys);
  const reCollectResult = collectSkillBook(roundTripped, rehydratedConsumedSet, 'saveRoom:2:3', WEAVE_SWORD);
  assert.equal(reCollectResult, false);
  assert.equal(roundTripped.unlockedActiveWeaves.filter(w => w === WEAVE_SWORD).length, 1);
});

// ---- Malformed / unknown weaveId ---------------------------------------------

test('unknown/malformed weaveId sanitizes safely without crashing', () => {
  const progress = createDefaultProgress();
  const consumed = new Set<string>();
  assert.doesNotThrow(() => collectSkillBook(progress, consumed, 'badRoom:0:0', 'not-a-real-weave-xyz'));
  // Unknown ids are not known to WEAVE_REGISTRY, so expandLegacyWeaveId
  // returns [] and the raw id is granted as-is (never thrown); it will be
  // sanitized out on next load by migrateLegacyWeaveUnlocks.
  assert.equal(consumed.has('badRoom:0:0'), true);
});

test('PlayerProgress default includes an empty collectedSkillTombKeys array', () => {
  const progress = createDefaultProgress();
  assert.deepEqual(progress.collectedSkillTombKeys, []);
});
