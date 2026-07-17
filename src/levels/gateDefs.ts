export type GateKind = 'enemy' | 'challenge' | 'heart' | 'speed';
export type GateOpenVisualMode = 'darkRecessed' | 'fadeAway' | 'powder';
export type GateOpenPersistence = 'forever' | 'untilPlayerSaves' | 'untilPlayerLeavesRoom';

export const DEFAULT_GATE_REQUIRED_SPEED_WORLD = 180;
export const MIN_GATE_REQUIRED_SPEED_WORLD = 0;
export const MAX_GATE_REQUIRED_SPEED_WORLD = 5000;

export interface RoomGateDef {
  uid: number;
  kind: GateKind;
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  openVisualMode: GateOpenVisualMode;
  openPersistence: GateOpenPersistence;
  requiredSpeed?: number;
}

export interface GateNormalizationContext {
  widthBlocks: number;
  heightBlocks: number;
  usedUids?: Set<number>;
  allocateUid?: () => number;
}

const GATE_KINDS: readonly GateKind[] = ['enemy', 'challenge', 'heart', 'speed'];
const VISUAL_MODES: readonly GateOpenVisualMode[] = ['darkRecessed', 'fadeAway', 'powder'];
const PERSISTENCE_MODES: readonly GateOpenPersistence[] = ['forever', 'untilPlayerSaves', 'untilPlayerLeavesRoom'];

function enumOrDefault<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
}

export function normalizeRequiredSpeed(value: unknown): number {
  const finite = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_GATE_REQUIRED_SPEED_WORLD;
  return Math.max(MIN_GATE_REQUIRED_SPEED_WORLD, Math.min(MAX_GATE_REQUIRED_SPEED_WORLD, finite));
}

export function normalizeRoomGateDef(value: Partial<RoomGateDef>, context: GateNormalizationContext): RoomGateDef {
  const widthBlocks = Math.max(1, finiteInteger(context.widthBlocks, 1));
  const heightBlocks = Math.max(1, finiteInteger(context.heightBlocks, 1));
  const xBlock = Math.max(0, Math.min(widthBlocks - 1, finiteInteger(value.xBlock, 0)));
  const yBlock = Math.max(0, Math.min(heightBlocks - 1, finiteInteger(value.yBlock, 0)));
  let uid = finiteInteger(value.uid, -1);
  if (uid < 0 || context.usedUids?.has(uid)) uid = context.allocateUid?.() ?? 0;
  context.usedUids?.add(uid);
  const kind = enumOrDefault(value.kind, GATE_KINDS, 'challenge');
  const gate: RoomGateDef = {
    uid,
    kind,
    xBlock,
    yBlock,
    wBlock: Math.max(1, Math.min(widthBlocks - xBlock, finiteInteger(value.wBlock, 1))),
    hBlock: Math.max(1, Math.min(heightBlocks - yBlock, finiteInteger(value.hBlock, 1))),
    openVisualMode: enumOrDefault(value.openVisualMode, VISUAL_MODES, 'fadeAway'),
    openPersistence: enumOrDefault(value.openPersistence, PERSISTENCE_MODES, 'untilPlayerLeavesRoom'),
  };
  if (kind === 'speed') gate.requiredSpeed = normalizeRequiredSpeed(value.requiredSpeed);
  return gate;
}

export function legacyChallengeGateToRoomGate(value: { uid: number; xBlock: number; yBlock: number; wBlock: number; hBlock: number }): RoomGateDef {
  return {
    ...value,
    kind: 'challenge',
    openVisualMode: 'fadeAway',
    openPersistence: 'untilPlayerLeavesRoom',
  };
}

export function gatePersistenceKey(campaignId: string, roomId: string, uid: number): string {
  return `${campaignId}:${roomId}:gate:${uid}`;
}
