/**
 * Callback-wiring guards for the visual-map room-persistence atomicity
 * hardening (build 521). editorVisualMapDialogs.ts, editorVisualMapLinkPrompt.ts,
 * and editorController.ts all import '../levels/rooms', which transitively
 * imports packedCampaignLoader.ts — that module reads
 * `import.meta.env.BASE_URL` at module scope, which is unavailable under the
 * plain `node --test` runner (no Vite), the same constraint documented in
 * connectedRoomPersistence.test.ts. The full DOM+registry functions
 * therefore can't be imported and exercised end-to-end here.
 *
 * The actual atomicity/rollback LOGIC now lives in
 * visualMapRoomPersistenceCoordinator.ts, which is DOM/Vite-free by design
 * and is exercised with real behavioral tests in
 * visualMapRoomPersistenceCoordinator.test.ts — that is the source of truth
 * for validate-before-mutate, rollback-on-failure, and discard-cleanup
 * behavior. What remains here is narrowly scoped to wiring that only a DOM
 * environment can exercise: that the dialogs/prompt call the coordinator via
 * the controller-owned request callbacks (instead of mutating the registry
 * directly), and that the controller wires those callbacks to its
 * coordinator-backed handlers.
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

// ── showAddRoomDialog fires onRoomCreated (unchanged, single-room path) ─────

test('showAddRoomDialog fires onRoomCreated with the newly registered RoomDef', () => {
  const source = readSource('../editor/editorVisualMapDialogs.ts');
  const body = sliceFunction(
    source,
    'export function showAddRoomDialog(',
    'export function showAddWorldDialog(',
  );
  assert.ok(body.includes('ctx.callbacks.onRoomCreated?.(roomDef);'),
    'showAddRoomDialog must notify onRoomCreated so the new room is persisted immediately');
  const registerIdx = body.indexOf('registerRoom(roomDef);');
  const callbackIdx = body.indexOf('ctx.callbacks.onRoomCreated?.(roomDef);');
  assert.ok(registerIdx >= 0 && registerIdx < callbackIdx,
    'the room must be registered before onRoomCreated fires');
});

// ── showCreateLinkedRoomDialog delegates the whole transaction to the coordinator ─

test('showCreateLinkedRoomDialog never mutates ROOM_REGISTRY directly — it delegates to requestCreateLinkedRoom', () => {
  const source = readSource('../editor/editorVisualMapDialogs.ts');
  const startIdx = source.indexOf('export function showCreateLinkedRoomDialog(');
  assert.ok(startIdx >= 0);
  const body = source.slice(startIdx);
  assert.ok(body.includes('ctx.callbacks.requestCreateLinkedRoom?.('),
    'room registration + linking must be delegated to the atomic coordinator transaction via requestCreateLinkedRoom');
  assert.ok(!/\bregisterRoom\(newRoomDef\)/.test(body),
    'the dialog must not register the new room itself — createLinkedRoomTransaction owns that mutation');
  assert.ok(!/\bsetRoomTransitionLink\(/.test(body),
    'the dialog must not link transitions itself — createLinkedRoomTransaction owns that mutation');
  // Failure must be handled without closing the dialog / advancing UI state.
  const resultIdx = body.indexOf('ctx.callbacks.requestCreateLinkedRoom?.(');
  const failureCheckIdx = body.indexOf('if (!result.ok)');
  assert.ok(resultIdx >= 0 && failureCheckIdx > resultIdx,
    'the dialog must branch on the transaction result before treating creation as successful');
});

// ── applyPendingDoorLink delegates the whole transaction to the coordinator ─

test('applyPendingDoorLink never mutates ROOM_REGISTRY directly — it delegates to requestLinkTransition', () => {
  const source = readSource('../editor/editorVisualMapLinkPrompt.ts');
  const body = sliceFunction(
    source,
    'export function applyPendingDoorLink(',
    '\n// ── Prompt lifecycle',
  );
  assert.ok(body.includes('ctx.requestLinkTransition?.('),
    'both sides of the link must be delegated to the atomic coordinator transaction via requestLinkTransition');
  assert.ok(!/\bsetRoomTransitionLink\(/.test(body),
    'applyPendingDoorLink must not link transitions itself — linkTransitionTransaction owns that mutation');
  assert.ok(/if \(result\.ok\) \{/.test(body),
    'success/failure UI must branch on the transaction result');
});

// ── openVisualMap wires both callbacks to the controller's coordinator-backed handlers ─

test('openVisualMap wires requestCreateLinkedRoom/requestLinkTransition to the coordinator-backed controller handlers', () => {
  const source = readSource('../editor/editorController.ts');
  const body = sliceFunction(
    source,
    'async function openVisualMap(',
    '\n  function update(',
  );
  assert.ok(body.includes('requestCreateLinkedRoom: requestCreateLinkedRoomFromVisualMap,'),
    'openVisualMap must wire requestCreateLinkedRoom to requestCreateLinkedRoomFromVisualMap');
  assert.ok(body.includes('requestLinkTransition: requestLinkTransitionFromVisualMap,'),
    'openVisualMap must wire requestLinkTransition to requestLinkTransitionFromVisualMap');
});

test('the controller-owned request handlers route through createLinkedRoomTransaction/linkTransitionTransaction and only sync state on success', () => {
  const source = readSource('../editor/editorController.ts');
  const createdBody = sliceFunction(
    source,
    'function requestCreateLinkedRoomFromVisualMap(',
    'function requestLinkTransitionFromVisualMap(',
  );
  assert.ok(createdBody.includes('createLinkedRoomTransaction({'));
  assert.ok(createdBody.includes('if (!result.ok) {'),
    'failure must be reported without any further state sync');
  assert.ok(createdBody.includes('linkedRoomsCreatedFromCurrentRoom.push('),
    'a room linked from the CURRENT room must be tracked for later discard-cleanup');

  const linkedBody = sliceFunction(
    source,
    'function requestLinkTransitionFromVisualMap(',
    'function discardLinkedRoomTargetsForCurrentSession(',
  );
  assert.ok(linkedBody.includes('linkTransitionTransaction({'));
  assert.ok(linkedBody.includes('if (!result.ok) {'));
});

test('discardCurrentRoomSessionChanges cleans up linked-room targets before discarding the source room', () => {
  const source = readSource('../editor/editorController.ts');
  const startIdx = source.indexOf('function discardCurrentRoomSessionChanges(');
  const cleanupIdx = source.indexOf('discardLinkedRoomTargetsForCurrentSession();', startIdx);
  const storeDiscardIdx = source.indexOf('campaignSession.campaignStore.discardRoomChanges(roomData.id);', startIdx);
  assert.ok(startIdx >= 0 && cleanupIdx > startIdx && storeDiscardIdx > cleanupIdx,
    'target-room cleanup must run before the source room\'s own session is discarded');
});
