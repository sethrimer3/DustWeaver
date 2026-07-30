import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
  setItem(key: string, value: string) { store.set(key, value); },
  removeItem(key: string) { store.delete(key); },
} as unknown as Storage;

import { createNewSaveSlot, saveSaveSlot, loadSaveSlot } from '../progression/saveSlots';
import { createWorldState } from '../sim/world';
import { createReusableSnapshot, updateSnapshotInPlace, refreshSnapshotWorldArrayRefs } from '../render/snapshot';
import { getCharacterSprites } from '../render/clusters/characterSprites';
import { makeLoadRoomPhases } from '../screens/gameLoadRoomPhases';

export function traceCharacter(stage: string, extra: any = {}) {
  const logObj = {
    stage,
    activeSlotIndex: extra.activeSlotIndex ?? -1,
    savedCharacterId: extra.savedCharacterId ?? 'unknown',
    progressCharacterId: extra.progressCharacterId ?? 'unknown',
    worldCharacterId: extra.worldCharacterId ?? 'unknown',
    snapshotCharacterId: extra.snapshotCharacterId ?? 'unknown',
    requestedCharacterId: extra.requestedCharacterId ?? 'unknown',
    resolvedSpriteSetId: extra.resolvedSpriteSetId ?? 'unknown',
    selectedAnimationState: extra.selectedAnimationState ?? 'unknown',
    selectedSpriteUrl: extra.selectedSpriteUrl ?? 'unknown',
    spriteComplete: extra.spriteComplete ?? false,
    spriteNaturalWidth: extra.spriteNaturalWidth ?? 0,
    spriteNaturalHeight: extra.spriteNaturalHeight ?? 0,
  };
  console.log(`[character-trace] ${JSON.stringify(logObj)}`);
}

test('character diagnostic trace', () => {
  console.log('--- STARTING TRACE ---');
  
  // 1. Create a new official save
  const data = createNewSaveSlot(false);
  traceCharacter('save creation before first write', { progressCharacterId: data.progress.characterId });

  // 2. Save it
  saveSaveSlot(1, data);
  traceCharacter('immediately after saveSaveSlot', { progressCharacterId: data.progress.characterId });

  // 3. Load it
  const loaded = loadSaveSlot(1);
  traceCharacter('immediately after loadSaveSlot', { progressCharacterId: loaded!.progress.characterId });

  // 4. Initial WorldState creation
  const world = createWorldState(16.6, 42);
  traceCharacter('initial WorldState creation', { worldCharacterId: world.characterId });

  // 5. Initial snapshot creation
  const snap = createReusableSnapshot(world);
  traceCharacter('snapshot creation/update', { snapshotCharacterId: snap.characterId });

  // Mock a RoomDef
  const room = {
    id: 'lobby', widthBlocks: 20, heightBlocks: 20, backgroundColor: '#000',
    layers: [], triggers: [], initialCameras: [], music: null
  } as any;

  const ctx = {
    progress: loaded!.progress,
    world,
    snap,
    // Add other needed mocks for makeLoadRoomPhases if necessary, but we only care about characterId
  };

  // We manually apply the progress fields since we can't easily mock everything needed for makeLoadRoomPhases without UI Root etc
  world.characterId = loaded!.progress.characterId;
  traceCharacter('progress-to-world application', { worldCharacterId: world.characterId });

  // 6. Update snapshot
  updateSnapshotInPlace(snap, world);
  traceCharacter('snapshot creation/update (after updateSnapshotInPlace)', { snapshotCharacterId: snap.characterId });

  refreshSnapshotWorldArrayRefs(snap, world);
  traceCharacter('snapshot creation/update (after refreshSnapshotWorldArrayRefs)', { snapshotCharacterId: snap.characterId });

  // 7. Resolve sprites
  const sprites = getCharacterSprites(snap.characterId);
  const resolvedSpriteUrl = sprites.standing?.src || 'mock-src';
  traceCharacter('sprite resolution', { 
    snapshotCharacterId: snap.characterId,
    resolvedSpriteSetId: snap.characterId,
    selectedSpriteUrl: resolvedSpriteUrl
  });

  assert.equal(snap.characterId, loaded!.progress.characterId, 'Snapshot characterId should match the progress/world characterId');
  assert.equal(snap.characterId, 'outcast', 'The snapshot should have outcast characterId');

  console.log('--- END TRACE ---');
});
