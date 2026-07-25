/**
 * Callback-wiring guards for the visual-map room-persistence fix (build 519 /
 * 520). editorVisualMapDialogs.ts and editorVisualMapLinkPrompt.ts both
 * import '../levels/rooms', which transitively imports
 * packedCampaignLoader.ts — that module reads `import.meta.env.BASE_URL` at
 * module scope, which is unavailable under the plain `node --test` runner
 * (no Vite), the same constraint documented in
 * connectedRoomPersistence.test.ts and editorPersistenceCadence.test.ts. The
 * full DOM+registry functions therefore can't be imported and exercised
 * end-to-end here.
 *
 * These are source-level guards — the same established pattern used
 * throughout this suite (see editorUIPhase5SourceGuards.test.ts,
 * editorPersistenceCadence.test.ts) for asserting the shape of DOM-touching
 * production code that can't otherwise run under Node. Each test locates the
 * exact function body in the real source file and asserts it contains the
 * callback invocation(s) required by the persistence contract, so a future
 * edit that silently drops a callback call breaks the build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSource(relPath: string): string {
  return readFileSync(path.join(__dirname, relPath), 'utf8');
}

function sliceFunction(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `expected to find "${startMarker}"`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `expected to find "${endMarker}" after "${startMarker}"`);
  return source.slice(start, end);
}

// ── showAddRoomDialog fires onRoomCreated ────────────────────────────────────

test('showAddRoomDialog fires onRoomCreated with the newly registered RoomDef', () => {
  const source = readSource('../editor/editorVisualMapDialogs.ts');
  const body = sliceFunction(
    source,
    'export function showAddRoomDialog(',
    'export function showAddWorldDialog(',
  );
  assert.ok(body.includes('ctx.callbacks.onRoomCreated?.(roomDef);'),
    'showAddRoomDialog must notify onRoomCreated so the new room is persisted immediately');
  // Must fire after the room is fully registered/placed, not before.
  const registerIdx = body.indexOf('registerRoom(roomDef);');
  const callbackIdx = body.indexOf('ctx.callbacks.onRoomCreated?.(roomDef);');
  assert.ok(registerIdx >= 0 && registerIdx < callbackIdx,
    'the room must be registered before onRoomCreated fires');
});

// ── showCreateLinkedRoomDialog fires onRoomCreated AND onRoomTransitionLinked ─

test('showCreateLinkedRoomDialog fires onRoomCreated for the new room AND onRoomTransitionLinked for the pre-existing source room', () => {
  const source = readSource('../editor/editorVisualMapDialogs.ts');
  const startIdx = source.indexOf('export function showCreateLinkedRoomDialog(');
  assert.ok(startIdx >= 0);
  // Last function in the file — slice to the end.
  const body = source.slice(startIdx);
  assert.ok(body.includes('ctx.callbacks.onRoomCreated?.(newRoomDef);'),
    'the newly created (and already reciprocally linked) room must be persisted via onRoomCreated');
  assert.ok(body.includes('ctx.callbacks.onRoomTransitionLinked?.(sourceRoomId, sourceTransIndex, id, targetSpawn);'),
    'the pre-existing source room, not covered by onRoomCreated, must be synchronized via onRoomTransitionLinked');
  // onRoomCreated must fire before onRoomTransitionLinked so the target room
  // exists in persisted storage by the time anything reads it back.
  const createdIdx = body.indexOf('ctx.callbacks.onRoomCreated?.(newRoomDef);');
  const linkedIdx = body.indexOf('ctx.callbacks.onRoomTransitionLinked?.(sourceRoomId');
  assert.ok(createdIdx >= 0 && createdIdx < linkedIdx,
    'onRoomCreated must fire before onRoomTransitionLinked');
  // Both transitions must already be linked in ROOM_REGISTRY (via
  // setRoomTransitionLink) before either callback fires, so onRoomCreated
  // captures the fully-linked target room in one shot.
  const setLinkIdx = body.indexOf('setRoomTransitionLink(sourceRoomId, sourceTransIndex, id, targetSpawn);');
  assert.ok(setLinkIdx >= 0 && setLinkIdx < createdIdx,
    'both transitions must be linked before onRoomCreated fires');
});

// ── applyPendingDoorLink fires onRoomTransitionLinked for BOTH sides ─────────

test('applyPendingDoorLink fires onRoomTransitionLinked once per side of the link, only after both directions succeed', () => {
  const source = readSource('../editor/editorVisualMapLinkPrompt.ts');
  const body = sliceFunction(
    source,
    'export function applyPendingDoorLink(',
    '\n// ── Prompt lifecycle',
  );
  const calls = body.match(/ctx\.onRoomTransitionLinked\?\.\(/g) ?? [];
  assert.equal(calls.length, 2, 'both the source and target side must be synchronized');
  assert.ok(body.includes('ctx.onRoomTransitionLinked?.(link.sourceRoomId, link.sourceTransIndex, link.targetRoomId, targetSpawn);'));
  assert.ok(body.includes('ctx.onRoomTransitionLinked?.(link.targetRoomId, link.targetTransIndex, link.sourceRoomId, sourceSpawn);'));
  // Must be gated on both setRoomTransitionLink calls succeeding — a
  // half-applied link (one side fails validation post-hoc) must not fire
  // either callback and must not leave mismatched state.
  assert.ok(/if \(didLinkSource && didLinkTarget\) \{/.test(body),
    'callbacks must only fire once both directions of the link succeeded');
});

test('applyPendingDoorLink does not mutate registry state before confirming both rooms/transitions exist', () => {
  const source = readSource('../editor/editorVisualMapLinkPrompt.ts');
  const body = sliceFunction(
    source,
    'export function applyPendingDoorLink(',
    '\n// ── Prompt lifecycle',
  );
  // Existence check for both rooms and both transitions must happen before
  // any setRoomTransitionLink call.
  const guardIdx = body.indexOf('if (!sourceRoom || !targetRoom || !sourceTransition || !targetTransition) return;');
  const firstMutationIdx = body.indexOf('setRoomTransitionLink(');
  assert.ok(guardIdx >= 0 && firstMutationIdx > guardIdx,
    'prerequisites for both sides must be validated before either side is mutated');
});

// ── openVisualMap wires both callbacks to the correct controller handlers ───

test('openVisualMap wires onRoomCreated/onRoomTransitionLinked to handleRoomCreatedFromVisualMap/handleRoomTransitionLinkedFromVisualMap', () => {
  const source = readSource('../editor/editorController.ts');
  const body = sliceFunction(
    source,
    'async function openVisualMap(',
    '\n  function update(',
  );
  assert.ok(body.includes('onRoomCreated: handleRoomCreatedFromVisualMap,'),
    'openVisualMap must wire onRoomCreated to handleRoomCreatedFromVisualMap');
  assert.ok(body.includes('onRoomTransitionLinked: handleRoomTransitionLinkedFromVisualMap,'),
    'openVisualMap must wire onRoomTransitionLinked to handleRoomTransitionLinkedFromVisualMap');
});

test('handleRoomCreatedFromVisualMap and handleRoomTransitionLinkedFromVisualMap route through the store-aware persistence boundary', () => {
  const source = readSource('../editor/editorController.ts');
  const createdBody = sliceFunction(
    source,
    'function handleRoomCreatedFromVisualMap(',
    'Synchronizes an existing room',
  );
  assert.ok(createdBody.includes('persistCreatedCampaignRoom('));

  const linkedBody = sliceFunction(
    source,
    'function handleRoomTransitionLinkedFromVisualMap(',
    'Logs a precise developer error',
  );
  assert.ok(linkedBody.includes('persistSavedCampaignRoom('),
    'the non-current-room branch must persist through the store-aware boundary');
  // The legacy no-CampaignStore fallback must never silently return without
  // attempting the ROOM_REGISTRY fallback.
  assert.ok(linkedBody.includes('ROOM_REGISTRY.get(roomId)'),
    'a room missing from pendingRoomEdits with no campaign store must fall back to the authoritative ROOM_REGISTRY, not silently drop the mutation');
  assert.ok(linkedBody.includes('reportVisualMapLinkFailure('),
    'missing room/transition prerequisites must be reported, not silently ignored');
});
