import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyCampaignStartingOptions } from '../progression/campaignStartingOptions';
import { createDefaultProgress } from '../progression/playerProgress';
import { CampaignSpawnData } from '../levels/campaignSchema';
import { PLAYER_INITIAL_HEALTH } from '../screens/gameSpawn';
import { ParticleKind } from '../sim/particles/kinds';

// ---- Health normalization ---------------------------------------------------

describe('applyCampaignStartingOptions — health', () => {
  it('absent startingHealth leaves progress.startingHealth unchanged', () => {
    const p = createDefaultProgress();
    const before = p.startingHealth;
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0 }, 'merge');
    assert.strictEqual(p.startingHealth, before);
  });

  it('startingHealth (dust motes) is interpreted with no upper cap, unlike the legacy [1,PLAYER_INITIAL_HEALTH] health clamp', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingHealth: PLAYER_INITIAL_HEALTH + 99 }, 'merge');
    assert.strictEqual(p.startingHealth, PLAYER_INITIAL_HEALTH + 99);
  });

  it('negative startingHealth (dust motes) normalizes to 0, not 1', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingHealth: -5 }, 'merge');
    assert.strictEqual(p.startingHealth, 0);
  });

  it('zero starting dust motes is accepted as a legal value', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingHealth: 0 }, 'fresh');
    assert.strictEqual(p.startingHealth, 0);
  });

  it('valid startingHealth within legacy range is preserved exactly', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingHealth: 5 }, 'fresh');
    assert.strictEqual(p.startingHealth, 5);
  });

  it('legacy campaigns authored under the old 1-10 health interpretation still load and apply correctly', () => {
    // Old campaigns wrote startingHealth in [1,10] under the "health" semantics.
    // The wire field name and shape are unchanged, so these values still apply
    // — just interpreted as a starting dust-mote count with no upper clamp.
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingHealth: 10 }, 'merge');
    assert.strictEqual(p.startingHealth, 10);
  });

  it('fractional startingHealth is floored', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingHealth: 7.9 }, 'fresh');
    assert.strictEqual(p.startingHealth, 7);
  });
});

// ---- Dust-container normalization -------------------------------------------

describe('applyCampaignStartingOptions — dustContainerCount', () => {
  it('absent count leaves dustContainerCount unchanged', () => {
    const p = createDefaultProgress();
    p.dustContainerCount = 3;
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0 }, 'merge');
    assert.strictEqual(p.dustContainerCount, 3);
  });

  it('negative count becomes 0', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustContainerCount: -3 }, 'fresh');
    assert.strictEqual(p.dustContainerCount, 0);
  });

  it('fractional count is floored', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustContainerCount: 2.9 }, 'fresh');
    assert.strictEqual(p.dustContainerCount, 2);
  });

  it('valid integer count is preserved in fresh mode', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustContainerCount: 4 }, 'fresh');
    assert.strictEqual(p.dustContainerCount, 4);
  });

  it('merge mode never reduces existing count', () => {
    const p = createDefaultProgress();
    p.dustContainerCount = 5;
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustContainerCount: 2 }, 'merge');
    assert.strictEqual(p.dustContainerCount, 5);
  });

  it('merge mode increases count when spawn value is higher', () => {
    const p = createDefaultProgress();
    p.dustContainerCount = 1;
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustContainerCount: 4 }, 'merge');
    assert.strictEqual(p.dustContainerCount, 4);
  });

  it('fresh mode assigns normalized value exactly regardless of existing count', () => {
    const p = createDefaultProgress();
    p.dustContainerCount = 10;
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustContainerCount: 2 }, 'fresh');
    assert.strictEqual(p.dustContainerCount, 2);
  });

  it('default progress has zero containers — fresh assigns exactly', () => {
    const p = createDefaultProgress();
    assert.strictEqual(p.dustContainerCount, 0);
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustContainerCount: 3 }, 'fresh');
    assert.strictEqual(p.dustContainerCount, 3);
  });
});

// ---- Dust types -------------------------------------------------------------

describe('applyCampaignStartingOptions — dust types', () => {
  it('valid dust type name unlocks the kind', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustTypes: ['Golden'] }, 'fresh');
    assert.ok(p.unlockedDustKinds.includes(ParticleKind.Golden));
  });

  it('unknown dust type name is silently ignored', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustTypes: ['NotADustType'] }, 'fresh');
    assert.strictEqual(p.unlockedDustKinds.length, 0);
  });

  it('duplicate names do not create duplicate entries', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustTypes: ['Golden', 'Golden'] }, 'fresh');
    const count = p.unlockedDustKinds.filter(k => k === ParticleKind.Golden).length;
    assert.strictEqual(count, 1);
  });

  it('existing unlocked kinds remain after applying options', () => {
    const p = createDefaultProgress();
    p.unlockedDustKinds.push(ParticleKind.Golden);
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustTypes: ['Fire'] }, 'fresh');
    assert.ok(p.unlockedDustKinds.includes(ParticleKind.Golden));
  });

  it('absent/empty startingDustTypes does nothing', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustTypes: [] }, 'fresh');
    assert.strictEqual(p.unlockedDustKinds.length, 0);
  });
});

// ---- Weaves ----------------------------------------------------------------

describe('applyCampaignStartingOptions — weaves', () => {
  it('registered weave ID unlocks the weave', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingWeaves: ['storm'] }, 'fresh');
    assert.ok(p.unlockedActiveWeaves.includes('storm'));
  });

  it('unknown weave ID is silently ignored', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingWeaves: ['notAWeave'] }, 'fresh');
    assert.strictEqual(p.unlockedActiveWeaves.length, 0);
  });

  it('duplicate weave IDs do not create duplicate entries', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingWeaves: ['storm', 'storm'] }, 'fresh');
    const count = p.unlockedActiveWeaves.filter(w => w === 'storm').length;
    assert.strictEqual(count, 1);
  });

  it('existing unlocked weaves remain after applying options', () => {
    const p = createDefaultProgress();
    p.unlockedActiveWeaves.push('storm');
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingWeaves: ['shield'] }, 'fresh');
    assert.ok(p.unlockedActiveWeaves.includes('storm'));
  });

  it('absent/empty startingWeaves does nothing', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingWeaves: [] }, 'fresh');
    assert.strictEqual(p.unlockedActiveWeaves.length, 0);
  });
});

// ---- Passives ----------------------------------------------------------------

describe('applyCampaignStartingOptions — passives', () => {
  it('known passive technique ID unlocks the technique', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingPassives: ['cycle'] }, 'fresh');
    assert.ok(p.unlockedPassiveTechniques.includes('cycle'));
  });

  it('unknown passive technique ID is silently ignored', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingPassives: ['notAPassive'] }, 'fresh');
    assert.strictEqual(p.unlockedPassiveTechniques.length, 0);
  });

  it('duplicate passive IDs do not create duplicate entries', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingPassives: ['cycle', 'cycle'] }, 'fresh');
    const count = p.unlockedPassiveTechniques.filter(t => t === 'cycle').length;
    assert.strictEqual(count, 1);
  });

  it('already-unlocked passives remain after applying options', () => {
    const p = createDefaultProgress();
    p.unlockedPassiveTechniques.push('cycle');
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingPassives: ['cycle'] }, 'fresh');
    assert.deepStrictEqual(p.unlockedPassiveTechniques, ['cycle']);
  });

  it('absent/empty startingPassives does nothing', () => {
    const p = createDefaultProgress();
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingPassives: [] }, 'fresh');
    assert.strictEqual(p.unlockedPassiveTechniques.length, 0);
  });
});

// ---- Combined behavior ------------------------------------------------------

describe('applyCampaignStartingOptions — combined', () => {
  it('all four option types applied together', () => {
    const p = createDefaultProgress();
    const spawn: CampaignSpawnData = {
      roomId: 'r', xBlock: 0, yBlock: 0,
      startingHealth: 7,
      startingDustContainerCount: 3,
      startingDustTypes: ['Golden'],
      startingWeaves: ['storm'],
    };
    applyCampaignStartingOptions(p, spawn, 'fresh');
    assert.strictEqual(p.startingHealth, 7);
    assert.strictEqual(p.dustContainerCount, 3);
    assert.ok(p.unlockedDustKinds.includes(ParticleKind.Golden));
    assert.ok(p.unlockedActiveWeaves.includes('storm'));
  });

  it('unrelated progress fields are unchanged', () => {
    const p = createDefaultProgress();
    p.level = 3;
    p.world1UnlockedCount = 5;
    p.characterId = 'demonFox';
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingHealth: 5 }, 'merge');
    assert.strictEqual(p.level, 3);
    assert.strictEqual(p.world1UnlockedCount, 5);
    assert.strictEqual(p.characterId, 'demonFox');
  });

  it('merge mode preserves existing progression on top of configured additions', () => {
    const p = createDefaultProgress();
    p.dustContainerCount = 4;
    p.unlockedDustKinds.push(ParticleKind.Golden);
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustContainerCount: 2, startingDustTypes: ['Fire'] }, 'merge');
    assert.strictEqual(p.dustContainerCount, 4); // not reduced
    assert.ok(p.unlockedDustKinds.includes(ParticleKind.Golden)); // still there
  });

  it('fresh mode begins from createDefaultProgress with only configured additions', () => {
    const p = createDefaultProgress();
    // default progress has 0 containers, no dust, no weaves
    applyCampaignStartingOptions(p, { roomId: 'r', xBlock: 0, yBlock: 0, startingDustContainerCount: 2, startingDustTypes: ['Golden'], startingWeaves: ['storm'] }, 'fresh');
    assert.strictEqual(p.dustContainerCount, 2);
    assert.deepStrictEqual(p.unlockedDustKinds, [ParticleKind.Golden]);
    assert.deepStrictEqual(p.unlockedActiveWeaves, ['storm']);
  });

  it('input spawn object is not mutated', () => {
    const p = createDefaultProgress();
    const spawn: CampaignSpawnData = Object.freeze({
      roomId: 'r', xBlock: 0, yBlock: 0,
      startingHealth: 5,
      startingDustContainerCount: 2,
      startingDustTypes: ['Golden'],
      startingWeaves: ['storm'],
    });
    assert.doesNotThrow(() => applyCampaignStartingOptions(p, spawn, 'fresh'));
  });
});
