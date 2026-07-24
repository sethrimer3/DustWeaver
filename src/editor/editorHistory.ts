/**
 * Transactional editor undo/redo.
 *
 * Common room edits are stored as UID-addressed element patches. Room resize,
 * changes to unsupported room-level structure, and entries whose compact
 * representation would be unsafe use the explicit snapshot fallback. History
 * is editor-session state only and is never included in room/campaign JSON.
 */
import type { EditorRoomData } from './editorState';
import type { CampaignSpawnData } from '../levels/campaignSchema';

export const EDITOR_HISTORY_BYTE_BUDGET = 8 * 1024 * 1024;
export const EDITOR_HISTORY_ENTRY_CAP = 200;
const MAX_SINGLE_ENTRY_BYTES = EDITOR_HISTORY_BYTE_BUDGET;
const ENTRY_OVERHEAD_BYTES = 96;

type JsonRecord = Record<string, unknown>;
type Direction = 'before' | 'after';

export interface CampaignSpawnHistoryState {
  campaignSpawn?: CampaignSpawnData;
  initialRoomId?: string;
}

export interface ElementChange {
  collection: ElementCollectionKey;
  uid: number;
  before?: JsonRecord;
  after?: JsonRecord;
  beforeIndex: number;
  afterIndex: number;
}

export interface RoomFieldChange {
  field: RoomFieldKey;
  before: unknown;
  after: unknown;
}

interface EntryBase {
  label: string;
  timestamp: number;
  estimatedBytes: number;
  revisionBefore: number;
  revisionAfter: number;
  campaignSpawnBefore?: CampaignSpawnHistoryState;
  campaignSpawnAfter?: CampaignSpawnHistoryState;
}

export interface ElementPatchHistoryEntry extends EntryBase {
  type: 'element-patch';
  elements: ElementChange[];
  roomFields: RoomFieldChange[];
}

export interface TileRegionHistoryEntry extends EntryBase {
  type: 'tile-region';
  elements: ElementChange[];
  roomFields: RoomFieldChange[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface SnapshotHistoryEntry extends EntryBase {
  type: 'snapshot';
  reason: 'room-resize' | 'unsupported-complex-mutation' | 'oversized-patch';
  before: EditorRoomData;
  after: EditorRoomData;
  /** Compatibility bridge for Phase 1-6 callers that push immediately before
   * mutation. Materialized once, at the first undo. */
  legacyLiveData?: EditorRoomData;
}

export type EditorHistoryEntry =
  | ElementPatchHistoryEntry
  | TileRegionHistoryEntry
  | SnapshotHistoryEntry;

export interface HistorySnapshot {
  roomData: EditorRoomData;
  campaignSpawn?: CampaignSpawnData;
  initialRoomId?: string;
  campaignSpawnTracked?: boolean;
}

export interface EditorHistory {
  undoStack: EditorHistoryEntry[];
  redoStack: EditorHistoryEntry[];
  estimatedBytes: number;
  currentRevision: number;
  savedRevision: number | null;
  nextRevision: number;
  /** A real mutation occurred but its entry could not be retained. Only a
   * successful save (or explicit room-session reset) may clear this bit. */
  untrackedDirty: boolean;
}

export type HistoryCommitResult = 'committed' | 'noop' | 'rejected-oversized';

export interface PendingSnapshot {
  readonly before: EditorRoomData;
  readonly liveData: EditorRoomData;
  readonly label: string;
  readonly timestamp: number;
  readonly campaignSpawnBefore?: CampaignSpawnHistoryState;
  readonly campaignSpawnTracked: boolean;
}

const COLLECTIONS = [
  'interiorWalls', 'enemies', 'transitions', 'saveTombs', 'skillTombs',
  'challengeFields', 'challengeGates', 'challengeTotems', 'gates',
  'dustContainers', 'dustContainerPieces', 'dustBoostJars', 'dustSwarms',
  'lambdaAnchors', 'fireflyJars', 'springboards', 'breakableBlocks',
  'dustPiles', 'grasshopperAreas', 'fireflyAreas', 'decorations',
  'ambientLightBlockers', 'lightSources', 'waterZones', 'lavaZones',
  'timeStopFields', 'crumbleBlocks', 'spikes', 'bouncePads', 'kineticBlocks',
  'grappleCarryBlocks', 'zipMoveBlocks', 'phantasmalTiles', 'pixelMaterials',
  'ropes', 'sunbeams', 'sceneLights', 'fallingBlocks', 'dialogueTriggers',
  'backgroundBlocks', 'guideDustPaths', 'customBlockPlacements',
] as const satisfies readonly (keyof EditorRoomData)[];
export type ElementCollectionKey = typeof COLLECTIONS[number];

const ROOM_FIELDS = [
  'id', 'name', 'worldNumber', 'mapX', 'mapY', 'blockTheme', 'backgroundId',
  'lightingEffect', 'ambientLightDirection', 'directionalBias',
  'sideExposureStrength', 'minimumWallLight', 'falloffPower',
  'backgroundLightSpill', 'solidLightSoftness', 'blockSeamBlending',
  'voidEdgeStyle', 'songId', 'playerSpawnBlock', 'sunrays',
] as const satisfies readonly (keyof EditorRoomData)[];
export type RoomFieldKey = typeof ROOM_FIELDS[number];

const TILE_COLLECTIONS = new Set<ElementCollectionKey>([
  'ambientLightBlockers', 'pixelMaterials', 'phantasmalTiles',
]);

function clone<T>(value: T): T {
  return structuredClone(value) as T;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function byteCost(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function collection(room: EditorRoomData, key: ElementCollectionKey): JsonRecord[] {
  return ((room[key] ?? []) as unknown as JsonRecord[]);
}

function createElementChanges(before: EditorRoomData, after: EditorRoomData): ElementChange[] {
  const changes: ElementChange[] = [];
  for (const key of COLLECTIONS) {
    const a = collection(before, key);
    const b = collection(after, key);
    const aByUid = new Map(a.map((value, index) => [value.uid as number, { value, index }]));
    const bByUid = new Map(b.map((value, index) => [value.uid as number, { value, index }]));
    const uids = new Set([...aByUid.keys(), ...bByUid.keys()]);
    for (const uid of uids) {
      const av = aByUid.get(uid);
      const bv = bByUid.get(uid);
      if (av && bv && av.index === bv.index && equal(av.value, bv.value)) continue;
      changes.push({
        collection: key,
        uid,
        before: av ? clone(av.value) : undefined,
        after: bv ? clone(bv.value) : undefined,
        beforeIndex: av?.index ?? -1,
        afterIndex: bv?.index ?? -1,
      });
    }
  }
  return changes;
}

function createRoomFieldChanges(before: EditorRoomData, after: EditorRoomData): RoomFieldChange[] {
  const changes: RoomFieldChange[] = [];
  for (const field of ROOM_FIELDS) {
    if (!equal(before[field], after[field])) {
      changes.push({ field, before: clone(before[field]), after: clone(after[field]) });
    }
  }
  return changes;
}

function tileBounds(changes: ElementChange[]): TileRegionHistoryEntry['bounds'] | null {
  const points: { x: number; y: number }[] = [];
  for (const change of changes) {
    if (!TILE_COLLECTIONS.has(change.collection)) return null;
    for (const value of [change.before, change.after]) {
      if (!value) continue;
      const x = Number(value.xBlock ?? value.xPixel);
      const y = Number(value.yBlock ?? value.yPixel);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
    }
  }
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)),
    maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)),
  };
}

function applyEntry(entry: EditorHistoryEntry, current: EditorRoomData, direction: Direction): EditorRoomData {
  if (entry.type === 'snapshot') return clone(entry[direction]);
  const room = clone(current);
  for (const fieldChange of entry.roomFields) {
    (room as unknown as Record<string, unknown>)[fieldChange.field] = clone(fieldChange[direction]);
  }
  const grouped = new Map<ElementCollectionKey, ElementChange[]>();
  for (const change of entry.elements) {
    const list = grouped.get(change.collection) ?? [];
    list.push(change);
    grouped.set(change.collection, list);
  }
  for (const [key, changes] of grouped) {
    const values = collection(room, key);
    const changedUids = new Set(changes.map(c => c.uid));
    const retained = values.filter(value => !changedUids.has(value.uid as number));
    const inserts = changes
      .filter(change => change[direction] !== undefined)
      .sort((a, b) => (direction === 'before' ? a.beforeIndex - b.beforeIndex : a.afterIndex - b.afterIndex));
    for (const change of inserts) {
      const index = direction === 'before' ? change.beforeIndex : change.afterIndex;
      retained.splice(Math.max(0, Math.min(index, retained.length)), 0, clone(change[direction]!));
    }
    (room as unknown as Record<string, unknown>)[key] = retained;
  }
  return room;
}

function campaignState(
  campaignSpawn: CampaignSpawnData | undefined,
  initialRoomId: string | undefined,
  tracked: boolean,
): CampaignSpawnHistoryState | undefined {
  return tracked ? { campaignSpawn: clone(campaignSpawn), initialRoomId } : undefined;
}

function makeEntry(
  history: EditorHistory,
  pending: PendingSnapshot,
  campaignSpawnAfter?: CampaignSpawnData,
  initialRoomIdAfter?: string,
  revisionBefore = history.currentRevision,
  revisionAfter = history.nextRevision,
): EditorHistoryEntry | null {
  const before = pending.before;
  const after = pending.liveData;
  const campaignAfter = campaignState(campaignSpawnAfter, initialRoomIdAfter, pending.campaignSpawnTracked);
  if (equal(before, after) && equal(pending.campaignSpawnBefore, campaignAfter)) return null;
  const base = {
    label: pending.label,
    timestamp: pending.timestamp,
    estimatedBytes: 0,
    revisionBefore,
    revisionAfter,
    campaignSpawnBefore: pending.campaignSpawnBefore,
    campaignSpawnAfter: campaignAfter,
  };
  const resized = before.widthBlocks !== after.widthBlocks || before.heightBlocks !== after.heightBlocks;
  if (resized) {
    const entry: SnapshotHistoryEntry = {
      ...base, type: 'snapshot', reason: 'room-resize', before: clone(before), after: clone(after),
    };
    entry.estimatedBytes = ENTRY_OVERHEAD_BYTES + byteCost(entry);
    return entry;
  }
  const elements = createElementChanges(before, after);
  const roomFields = createRoomFieldChanges(before, after);
  const bounds = roomFields.length === 0 ? tileBounds(elements) : null;
  const entry: ElementPatchHistoryEntry | TileRegionHistoryEntry = bounds
    ? { ...base, type: 'tile-region', elements, roomFields, bounds }
    : { ...base, type: 'element-patch', elements, roomFields };
  entry.estimatedBytes = ENTRY_OVERHEAD_BYTES + byteCost(entry);
  if (entry.estimatedBytes > MAX_SINGLE_ENTRY_BYTES) {
    const fallback: SnapshotHistoryEntry = {
      ...base, type: 'snapshot', reason: 'oversized-patch', before: clone(before), after: clone(after),
      estimatedBytes: 0,
    };
    fallback.estimatedBytes = ENTRY_OVERHEAD_BYTES + byteCost(fallback);
    return fallback;
  }
  return entry;
}

function totalBytes(entries: readonly EditorHistoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.estimatedBytes, 0);
}

function enforceBounds(history: EditorHistory): void {
  history.estimatedBytes = totalBytes(history.undoStack) + totalBytes(history.redoStack);
  while (
    history.undoStack.length > 0 &&
    (history.estimatedBytes > EDITOR_HISTORY_BYTE_BUDGET ||
      history.undoStack.length + history.redoStack.length > EDITOR_HISTORY_ENTRY_CAP)
  ) {
    history.undoStack.shift();
    history.estimatedBytes = totalBytes(history.undoStack) + totalBytes(history.redoStack);
  }
  // A single entry larger than the entire budget is rejected atomically.
  if (history.undoStack.length === 1 && history.undoStack[0].estimatedBytes > EDITOR_HISTORY_BYTE_BUDGET) {
    history.undoStack.length = 0;
    history.estimatedBytes = totalBytes(history.redoStack);
  }
}

export function createEditorHistory(): EditorHistory {
  return {
    undoStack: [], redoStack: [], estimatedBytes: 0, currentRevision: 0,
    savedRevision: 0, nextRevision: 1, untrackedDirty: false,
  };
}

export function capturePendingSnapshot(
  data: EditorRoomData,
  campaignSpawn?: CampaignSpawnData,
  initialRoomId?: string,
  campaignSpawnTracked = false,
  label = 'Edit room',
): PendingSnapshot {
  return {
    before: clone(data),
    liveData: data,
    label,
    timestamp: Date.now(),
    campaignSpawnBefore: campaignState(campaignSpawn, initialRoomId, campaignSpawnTracked),
    campaignSpawnTracked,
  };
}

export function commitPendingSnapshot(
  history: EditorHistory,
  pending: PendingSnapshot,
  campaignSpawnAfter?: CampaignSpawnData,
  initialRoomIdAfter?: string,
): HistoryCommitResult {
  let effectivePending = pending;
  const previous = history.undoStack[history.undoStack.length - 1];
  const coalescing = Boolean(
    previous &&
    pending.label.startsWith('Property:') &&
    previous.label === pending.label &&
    pending.timestamp - previous.timestamp <= 1500
  );
  if (coalescing && previous) {
    effectivePending = {
      ...pending,
      before: applyEntry(previous, pending.before, 'before'),
    };
  }
  const revisionBefore = coalescing && previous ? previous.revisionBefore : history.currentRevision;
  const entry = makeEntry(
    history, effectivePending, campaignSpawnAfter, initialRoomIdAfter,
    revisionBefore, history.nextRevision,
  );
  if (!entry) {
    if (coalescing && previous) {
      history.undoStack.pop();
      history.currentRevision = previous.revisionBefore;
      if (history.savedRevision === previous.revisionAfter) history.savedRevision = null;
      history.estimatedBytes = totalBytes(history.undoStack) + totalBytes(history.redoStack);
    }
    return 'noop';
  }
  if (entry.estimatedBytes > EDITOR_HISTORY_BYTE_BUDGET) {
    history.untrackedDirty = true;
    return 'rejected-oversized';
  }
  // Replacement is fully built and validated before the prior entry moves.
  if (coalescing && previous) {
    history.undoStack.pop();
    history.currentRevision = previous.revisionBefore;
  }
  // Branching makes a saved point in the discarded future unreachable.
  if (history.redoStack.length > 0 && history.savedRevision !== null && history.currentRevision !== history.savedRevision) {
    const savedWasInDiscardedFuture = history.redoStack.some(
      e => e.revisionBefore === history.savedRevision || e.revisionAfter === history.savedRevision,
    );
    if (savedWasInDiscardedFuture) history.savedRevision = null;
  }
  history.undoStack.push(entry);
  history.redoStack.length = 0;
  history.currentRevision = entry.revisionAfter;
  history.nextRevision++;
  enforceBounds(history);
  return 'committed';
}

export function pushSnapshot(
  history: EditorHistory,
  data: EditorRoomData,
  campaignSpawn?: CampaignSpawnData,
  initialRoomId?: string,
  campaignSpawnTracked?: boolean,
): HistoryCommitResult {
  const revisionBefore = history.currentRevision;
  const entry: SnapshotHistoryEntry = {
    type: 'snapshot',
    reason: 'unsupported-complex-mutation',
    label: 'Legacy mutation',
    timestamp: Date.now(),
    estimatedBytes: 0,
    revisionBefore,
    revisionAfter: history.nextRevision,
    before: clone(data),
    after: clone(data),
    legacyLiveData: data,
    campaignSpawnBefore: campaignState(campaignSpawn, initialRoomId, Boolean(campaignSpawnTracked)),
  };
  entry.estimatedBytes = ENTRY_OVERHEAD_BYTES + byteCost({ ...entry, legacyLiveData: undefined });
  if (entry.estimatedBytes > EDITOR_HISTORY_BYTE_BUDGET) {
    history.untrackedDirty = true;
    return 'rejected-oversized';
  }
  history.undoStack.push(entry);
  history.redoStack.length = 0;
  history.currentRevision = entry.revisionAfter;
  history.nextRevision++;
  enforceBounds(history);
  return 'committed';
}

/** Targeted capture for metadata controls: clone only the room fields that
 * can be mutated while retaining stable references to untouched collections. */
export function capturePendingRoomFields(
  data: EditorRoomData,
  fields: readonly (keyof EditorRoomData)[],
  label: string,
): PendingSnapshot {
  const before = { ...data };
  for (const field of fields) {
    (before as unknown as Record<string, unknown>)[field as string] =
      clone(data[field]);
  }
  return {
    before,
    liveData: data,
    label,
    timestamp: Date.now(),
    campaignSpawnTracked: false,
  };
}

export function runLazyMutation(
  history: EditorHistory,
  data: EditorRoomData,
  mutate: () => boolean,
  campaignSpawn?: CampaignSpawnData,
  initialRoomId?: string,
  campaignSpawnTracked?: boolean,
): boolean {
  const pending = capturePendingSnapshot(data, campaignSpawn, initialRoomId, campaignSpawnTracked);
  const changed = mutate();
  if (!changed) return false;
  return commitPendingSnapshot(history, pending) !== 'noop';
}

function result(entry: EditorHistoryEntry, roomData: EditorRoomData, direction: Direction): HistorySnapshot {
  const spawn = direction === 'before' ? entry.campaignSpawnBefore : entry.campaignSpawnAfter;
  return {
    roomData,
    ...(spawn !== undefined ? { campaignSpawnTracked: true } : {}),
    campaignSpawn: clone(spawn?.campaignSpawn),
    initialRoomId: spawn?.initialRoomId,
  };
}

export function undo(
  history: EditorHistory,
  currentData: EditorRoomData,
  _currentCampaignSpawn?: CampaignSpawnData,
  _currentInitialRoomId?: string,
  _currentCampaignSpawnTracked?: boolean,
): HistorySnapshot | null {
  const entry = history.undoStack.pop();
  if (!entry) return null;
  const legacySnapshot = entry as unknown as { roomData?: EditorRoomData };
  if (legacySnapshot.roomData) {
    return { roomData: clone(legacySnapshot.roomData) };
  }
  if (entry.type === 'snapshot' && entry.legacyLiveData) {
    entry.after = clone(currentData);
    entry.legacyLiveData = undefined;
    entry.estimatedBytes = ENTRY_OVERHEAD_BYTES + byteCost(entry);
  }
  history.redoStack.push(entry);
  history.currentRevision = entry.revisionBefore;
  history.estimatedBytes = totalBytes(history.undoStack) + totalBytes(history.redoStack);
  return result(entry, applyEntry(entry, currentData, 'before'), 'before');
}

export function redo(
  history: EditorHistory,
  currentData: EditorRoomData,
  _currentCampaignSpawn?: CampaignSpawnData,
  _currentInitialRoomId?: string,
  _currentCampaignSpawnTracked?: boolean,
): HistorySnapshot | null {
  const entry = history.redoStack.pop();
  if (!entry) return null;
  history.undoStack.push(entry);
  history.currentRevision = entry.revisionAfter;
  history.estimatedBytes = totalBytes(history.undoStack) + totalBytes(history.redoStack);
  return result(entry, applyEntry(entry, currentData, 'after'), 'after');
}

export function markHistorySaved(history: EditorHistory): void {
  history.savedRevision = history.currentRevision;
  history.untrackedDirty = false;
}

export function isHistoryDirty(history: EditorHistory): boolean {
  return history.untrackedDirty || history.savedRevision === null || history.currentRevision !== history.savedRevision;
}

export function getHistoryDiagnostics(history: EditorHistory): {
  undoCount: number; redoCount: number; estimatedBytes: number;
  entries: { stack: 'undo' | 'redo'; type: EditorHistoryEntry['type']; label: string; estimatedBytes: number }[];
} {
  return {
    undoCount: history.undoStack.length,
    redoCount: history.redoStack.length,
    estimatedBytes: history.estimatedBytes,
    entries: [
      ...history.undoStack.map(e => ({ stack: 'undo' as const, type: e.type, label: e.label, estimatedBytes: e.estimatedBytes })),
      ...history.redoStack.map(e => ({ stack: 'redo' as const, type: e.type, label: e.label, estimatedBytes: e.estimatedBytes })),
    ],
  };
}

export function clearHistory(history: EditorHistory): void {
  history.undoStack.length = 0;
  history.redoStack.length = 0;
  history.estimatedBytes = 0;
  history.currentRevision = 0;
  history.savedRevision = 0;
  history.nextRevision = 1;
  history.untrackedDirty = false;
}
