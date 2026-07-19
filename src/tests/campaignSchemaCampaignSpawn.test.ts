import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSavedCampaign,
  validateSavedCampaignTopLevel,
  getCampaignStartRoomId,
  SAVED_CAMPAIGN_KIND,
} from '../levels/campaignSchema';

function makeRoom(id: string, w = 10, h = 10) {
  return {
    v: 2,
    id,
    name: id,
    world: 0,
    size: [w, h],
    spawn: [1, 1],
    solids: {},
  };
}

function makeCampaign(campaignSpawn?: unknown) {
  return {
    v: 1,
    kind: SAVED_CAMPAIGN_KIND,
    campaign: {
      id: 'test_campaign',
      title: 'Test Campaign',
      creator: 'tester',
      description: '',
      initialRoomId: 'room1',
      initialRoomImagePath: null,
      ...(campaignSpawn !== undefined ? { campaignSpawn } : {}),
    },
    worldMap: { worlds: [], rooms: [] },
    rooms: [makeRoom('room1', 10, 10), makeRoom('room2', 5, 5)],
    editor: { createdWithBuild: '1', lastEditedIso: new Date().toISOString() },
  };
}

test('campaigns without a Campaign Spawn use the original initialRoomId fallback', () => {
  const campaign = makeCampaign();
  const errors = validateSavedCampaign(campaign);
  assert.ok(!errors.some(e => e.includes('campaignSpawn')), `unexpected campaignSpawn errors: ${errors.join('; ')}`);
  assert.equal(getCampaignStartRoomId(campaign as never), 'room1');
});

test('valid campaignSpawn passes validation', () => {
  const campaign = makeCampaign({ roomId: 'room2', xBlock: 2, yBlock: 2, startingHealth: 0, startingDustContainerCount: 3, startingDustTypes: ['Physical'], startingWeaves: ['storm'], startingPassives: ['cycle'] });
  const errors = validateSavedCampaign(campaign);
  assert.ok(!errors.some(e => e.includes('campaignSpawn')), `unexpected campaignSpawn errors: ${errors.join('; ')}`);
  assert.equal(getCampaignStartRoomId(campaign as never), 'room2');
});

test('campaignSpawn missing roomId fails', () => {
  const campaign = makeCampaign({ xBlock: 0, yBlock: 0 });
  const errors = validateSavedCampaign(campaign);
  assert.ok(errors.some(e => e.includes('campaignSpawn.roomId')));
});

test('campaignSpawn referencing a nonexistent room fails', () => {
  const campaign = makeCampaign({ roomId: 'nope', xBlock: 0, yBlock: 0 });
  const errors = validateSavedCampaign(campaign);
  assert.ok(errors.some(e => e.includes('does not exist in rooms')));
});

test('campaignSpawn coords outside room bounds fail', () => {
  const campaign = makeCampaign({ roomId: 'room2', xBlock: 99, yBlock: 99 });
  const errors = validateSavedCampaign(campaign);
  assert.ok(errors.some(e => e.includes('xBlock') && e.includes('out of room bounds')));
  assert.ok(errors.some(e => e.includes('yBlock') && e.includes('out of room bounds')));
});

test('campaignSpawn with unknown dust type fails', () => {
  const campaign = makeCampaign({ roomId: 'room1', xBlock: 0, yBlock: 0, startingDustTypes: ['NotADustType'] });
  const errors = validateSavedCampaign(campaign);
  assert.ok(errors.some(e => e.includes('startingDustTypes') && e.includes('unknown id')));
});

test('campaignSpawn with unknown weave ID fails', () => {
  const campaign = makeCampaign({ roomId: 'room1', xBlock: 0, yBlock: 0, startingWeaves: ['notAWeave'] });
  const errors = validateSavedCampaign(campaign);
  assert.ok(errors.some(e => e.includes('startingWeaves') && e.includes('unknown id')));
});

test('campaignSpawn with unknown passive ID fails', () => {
  const campaign = makeCampaign({ roomId: 'room1', xBlock: 0, yBlock: 0, startingPassives: ['notAPassive'] });
  const errors = validateSavedCampaign(campaign);
  assert.ok(errors.some(e => e.includes('startingPassives') && e.includes('unknown id')));
});

test('campaignSpawn with duplicate IDs in an array fails', () => {
  const campaign = makeCampaign({ roomId: 'room1', xBlock: 0, yBlock: 0, startingWeaves: ['storm', 'storm'] });
  const errors = validateSavedCampaign(campaign);
  assert.ok(errors.some(e => e.includes('duplicate')));
});

test('campaignSpawn with negative startingDustContainerCount fails', () => {
  const campaign = makeCampaign({ roomId: 'room1', xBlock: 0, yBlock: 0, startingDustContainerCount: -1 });
  const errors = validateSavedCampaign(campaign);
  assert.ok(errors.some(e => e.includes('startingDustContainerCount')));
});

test('validateSavedCampaignTopLevel catches a campaignSpawn.roomId referencing an unknown room', () => {
  const campaign = makeCampaign({ roomId: 'nope', xBlock: 0, yBlock: 0 });
  const errors = validateSavedCampaignTopLevel(campaign);
  assert.ok(errors.some(e => e.includes('campaignSpawn.roomId') && e.includes('does not exist')));
});

test('validateSavedCampaignTopLevel passes a valid campaignSpawn.roomId', () => {
  const campaign = makeCampaign({ roomId: 'room1', xBlock: 0, yBlock: 0 });
  const errors = validateSavedCampaignTopLevel(campaign);
  assert.ok(!errors.some(e => e.includes('campaignSpawn')));
});
