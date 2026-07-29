import test from 'node:test';
import assert from 'node:assert/strict';

import { ParticleKind, EQUIPPABLE_KINDS, isEquippableParticleKind } from '../sim/particles/kinds';
import { getMoteTypeConfig, getMoteTypeVisual, hasMoteTypeConfig } from '../sim/motes/moteTypeConfig';
import { particleKindToString, stringToParticleKind } from '../editor/roomJsonSchema';
import { DUST_KIND_OPTIONS } from '../editor/editorDropdownData';
import { DUST_DEFINITIONS } from '../sim/weaves/dustDefinition';
import { createDefaultProgress, sanitizePlayerDustProgress } from '../progression/playerProgress';
import { applyCampaignStartingOptions } from '../progression/campaignStartingOptions';
import { resolveEffectiveSelectedDustKind } from '../sim/weaves/dustWheelOptions';
import { loadSaveSlot, saveSaveSlot, createNewSaveSlot } from '../progression/saveSlots';

// ── 1. Type registration / parsing ───────────────────────────────────────────

test('Fire Dust is registered as an equippable canonical mote type', () => {
  assert.ok(isEquippableParticleKind(ParticleKind.FireDust));
  assert.ok(EQUIPPABLE_KINDS.includes(ParticleKind.FireDust));
  assert.ok(DUST_KIND_OPTIONS.includes('FireDust'));
  assert.ok(DUST_DEFINITIONS.has(ParticleKind.FireDust));
});

test('Fire Dust string id parses to the canonical enum value and back', () => {
  assert.equal(stringToParticleKind('FireDust'), ParticleKind.FireDust);
  assert.equal(stringToParticleKind('firedust'), ParticleKind.FireDust);
  assert.equal(particleKindToString(ParticleKind.FireDust), 'FireDust');
});

test('the internal lava/ember "Fire" kind remains distinct and non-equippable', () => {
  assert.equal(ParticleKind.Fire, 1);
  assert.notEqual(ParticleKind.FireDust, ParticleKind.Fire);
  assert.equal(isEquippableParticleKind(ParticleKind.Fire), false);
  assert.equal(stringToParticleKind('Fire'), ParticleKind.Fire);
});

// ── 2. Serialization round trip ──────────────────────────────────────────────

test('Fire Dust survives a full save/load round trip', () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });

  const slotIndex = 3;
  const fresh = createNewSaveSlot();
  fresh.progress.unlockedDustKinds = [ParticleKind.Golden, ParticleKind.FireDust];
  fresh.progress.selectedDustKind = ParticleKind.FireDust;
  saveSaveSlot(slotIndex, fresh);

  const loaded = loadSaveSlot(slotIndex);
  assert.ok(loaded !== null);
  assert.equal(loaded!.progress.selectedDustKind, ParticleKind.FireDust);
  assert.ok(loaded!.progress.unlockedDustKinds.includes(ParticleKind.FireDust));
});

// ── 3. Safe loading of older saves missing the Fire field ───────────────────

test('an older save with no knowledge of Fire Dust still loads safely (valid default)', () => {
  const progress = createDefaultProgress();
  // Simulate a pre-Fire save: unlocked list has no FireDust entry at all.
  progress.unlockedDustKinds = [ParticleKind.Golden, ParticleKind.Ice];
  progress.selectedDustKind = ParticleKind.Golden;
  sanitizePlayerDustProgress(progress);
  assert.equal(progress.selectedDustKind, ParticleKind.Golden, 'unaffected pre-existing selection stays valid');
  assert.ok(!progress.unlockedDustKinds.includes(ParticleKind.FireDust), 'Fire Dust not silently granted');
});

// ── 4. Visual-profile lookup returns the correct Fire palette ───────────────

test('visual-profile lookup returns the dark-red/red-orange/hot-orange Fire palette', () => {
  assert.ok(hasMoteTypeConfig(ParticleKind.FireDust));
  const cfg = getMoteTypeConfig(ParticleKind.FireDust);
  assert.equal(cfg.name, 'Fire Dust');
  const visual = getMoteTypeVisual(ParticleKind.FireDust);
  // Body reads as red-orange (r >> g > b).
  assert.ok(visual.body.r > visual.body.g && visual.body.g > visual.body.b);
  // Glow reads hotter/brighter than body (higher r and g, moving toward yellow).
  assert.ok(visual.glow.g > visual.body.g);
  assert.ok(visual.glow.r >= visual.body.r);
  // trail/particle intentionally alias body per the shared architecture.
  assert.deepEqual(visual.trail, visual.body);
  assert.deepEqual(visual.particle, visual.body);
});

// ── 5. Room-transition persistence ──────────────────────────────────────────

test('selected Fire Dust survives room-transition-style re-resolution', () => {
  const progress = createDefaultProgress();
  progress.unlockedDustKinds = [ParticleKind.Golden, ParticleKind.FireDust];
  progress.selectedDustKind = ParticleKind.FireDust;
  // This mirrors gameLoadRoomPhases.ts's `resolveEffectiveSelectedDustKind(progress)`
  // call on every room load — mote type is re-derived from PlayerProgress, not
  // stored per-room, so it must resolve identically across "transitions".
  assert.equal(resolveEffectiveSelectedDustKind(progress), ParticleKind.FireDust);
  assert.equal(resolveEffectiveSelectedDustKind(progress), ParticleKind.FireDust, 'stable across repeated room loads');
});

test('campaign starting options unlock Fire Dust via its canonical id', () => {
  const progress = createDefaultProgress();
  applyCampaignStartingOptions(progress, {
    roomId: 'start', xBlock: 0, yBlock: 0,
    startingDustTypes: ['Golden', 'FireDust'],
  }, 'fresh');
  assert.ok(progress.unlockedDustKinds.includes(ParticleKind.FireDust));
});

// ── 6. Fallback behavior for invalid / unknown mote ids ─────────────────────

test('unknown mote id strings fail to parse and are silently ignored', () => {
  assert.equal(stringToParticleKind('Plasma'), null);
  assert.equal(stringToParticleKind(''), null);
});

test('an invalid/unknown selectedDustKind falls back deterministically instead of crashing', () => {
  const progress = createDefaultProgress();
  progress.unlockedDustKinds = [ParticleKind.FireDust];
  progress.selectedDustKind = 9999 as ParticleKind; // invalid/unknown value
  assert.equal(resolveEffectiveSelectedDustKind(progress), ParticleKind.FireDust, 'falls back to first unlocked kind');
});

test('getMoteTypeConfig never throws and falls back to default for an invalid kind number', () => {
  const cfg = getMoteTypeConfig(9999 as ParticleKind);
  assert.equal(cfg.kind, ParticleKind.Golden);
});
