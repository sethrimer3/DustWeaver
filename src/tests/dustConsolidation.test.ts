import test from 'node:test';
import assert from 'node:assert/strict';
import { DUST_KIND_OPTIONS } from '../editor/editorDropdownData';
import { particleKindToString, stringToParticleKind } from '../editor/roomJsonSchema';
import { createDefaultProgress, sanitizePlayerDustProgress } from '../progression/playerProgress';
import { applyCampaignStartingOptions } from '../progression/campaignStartingOptions';
import { DUST_DEFINITIONS } from '../sim/weaves/dustDefinition';
import { createDefaultWeaveLoadout, sanitizePlayerWeaveLoadoutForProgress } from '../sim/weaves/playerLoadout';
import { EQUIPPABLE_KINDS, ParticleKind } from '../sim/particles/kinds';
import { isAvailablePlayerLightDust } from '../screens/gameLightDustIllumination';
import { loadSaveSlot, saveSaveSlot } from '../progression/saveSlots';

test('player dust roster contains exactly the six approved kinds in display order', () => {
  assert.deepEqual(EQUIPPABLE_KINDS, [
    ParticleKind.Golden,
    ParticleKind.Ice,
    ParticleKind.Nature,
    ParticleKind.Void,
    ParticleKind.Light,
    ParticleKind.FireDust,
  ]);
  assert.deepEqual(DUST_KIND_OPTIONS, ['Golden', 'Ice', 'Nature', 'Void', 'Light', 'FireDust']);
  assert.equal(DUST_DEFINITIONS.size, 6);
  assert.equal(DUST_DEFINITIONS.get(ParticleKind.Light)?.nickname, 'Luminant Dust');
  assert.equal(DUST_DEFINITIONS.get(ParticleKind.FireDust)?.nickname, 'Ember Dust');
});

test('Golden retains legacy numeric zero and legacy Physical strings migrate', () => {
  assert.equal(ParticleKind.Golden, 0);
  assert.equal(stringToParticleKind('Physical'), ParticleKind.Golden);
  assert.equal(stringToParticleKind('physical'), ParticleKind.Golden);
  assert.equal(stringToParticleKind('Physical Dust'), ParticleKind.Golden);
  assert.equal(particleKindToString(ParticleKind.Golden), 'Golden');
});

test('removed dust is stripped while approved unlocks and Light bindings survive', () => {
  const progress = createDefaultProgress();
  progress.unlockedDustKinds = [ParticleKind.Fire, ParticleKind.Ice, ParticleKind.Nature, ParticleKind.Void, ParticleKind.Light];
  progress.loadout = [ParticleKind.Fire, ParticleKind.Light];
  progress.weaveLoadout.primary.boundDust = [ParticleKind.Lightning, ParticleKind.Light];
  sanitizePlayerDustProgress(progress);
  assert.deepEqual(progress.unlockedDustKinds, [ParticleKind.Ice, ParticleKind.Nature, ParticleKind.Void, ParticleKind.Light]);
  assert.deepEqual(progress.loadout, [ParticleKind.Light]);
  assert.deepEqual(progress.weaveLoadout.primary.boundDust, [ParticleKind.Light]);
});

test('save restore keeps Light Dust and strips legacy removed player dust', () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  const progress = createDefaultProgress();
  progress.unlockedDustKinds = [ParticleKind.Fire, ParticleKind.Light];
  progress.weaveLoadout.primary.boundDust = [ParticleKind.Fire, ParticleKind.Light];
  saveSaveSlot(0, {
    progress, playTimeMs: 0, lastPlayedIso: new Date(0).toISOString(),
    runTimerMs: 0, checkpointRunTimerMs: 0, assistMode: false,
  });
  const restored = loadSaveSlot(0);
  assert.deepEqual(restored?.progress.unlockedDustKinds, [ParticleKind.Light]);
  assert.deepEqual(restored?.progress.weaveLoadout.primary.boundDust, [ParticleKind.Light]);
});

test('campaign starting dust accepts legacy Golden and the five approved kinds only', () => {
  const progress = createDefaultProgress();
  applyCampaignStartingOptions(progress, {
    roomId: 'start', xBlock: 0, yBlock: 0,
    startingDustTypes: ['Physical', 'Ice', 'Nature', 'Void', 'Light', 'Fire'],
  }, 'fresh');
  assert.deepEqual(progress.unlockedDustKinds, [...EQUIPPABLE_KINDS]);
});

test('gameplay loadout sanitizer removes removed and unequipped Light Dust', () => {
  const progress = createDefaultProgress();
  progress.unlockedDustKinds = [ParticleKind.Light];
  const loadout = createDefaultWeaveLoadout();
  loadout.primary.boundDust = [ParticleKind.Fire, ParticleKind.Light];
  assert.deepEqual(
    sanitizePlayerWeaveLoadoutForProgress(loadout, progress).primary.boundDust,
    [ParticleKind.Light],
  );
  progress.unlockedDustKinds = [];
  assert.deepEqual(sanitizePlayerWeaveLoadoutForProgress(loadout, progress).primary.boundDust, []);
});

test('Light Dust illumination requires a live, player-owned mote', () => {
  const particles = {
    isAliveFlag: new Uint8Array([1]),
    kindBuffer: new Uint8Array([ParticleKind.Light]),
    ownerEntityId: new Int32Array([42]),
  };
  assert.equal(isAvailablePlayerLightDust(particles, 0, 42), true);
  assert.equal(isAvailablePlayerLightDust(particles, 0, 7), false, 'boss/enemy ownership must not illuminate');
  particles.isAliveFlag[0] = 0;
  assert.equal(isAvailablePlayerLightDust(particles, 0, 42), false, 'destroyed/regenerating motes must not illuminate');
});
