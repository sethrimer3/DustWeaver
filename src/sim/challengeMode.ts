export type ChallengeAnchorType = 'field' | 'totem';
export type ChallengeFieldVisualState = 'armed' | 'active' | 'cooldown';

export interface ChallengeRectDef {
  uid: number;
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
}

export interface ChallengePointDef {
  uid: number;
  xBlock: number;
  yBlock: number;
}

export interface ChallengeRuntimeField extends ChallengeRectDef {
  visualState: ChallengeFieldVisualState;
  wasPlayerOverlapping: boolean;
}

export interface ChallengeRuntimeGate extends ChallengeRectDef {
  wallIndex: number;
}

export interface ChallengeModeState {
  roomId: string;
  isActive: boolean;
  anchorType: ChallengeAnchorType | null;
  anchorUid: number;
  anchorXWorld: number;
  anchorYWorld: number;
  activationSequence: number;
  activationAgeTicks: number;
  returnSequence: number;
  reconciledReturnSequence: number;
  fields: ChallengeRuntimeField[];
  gates: ChallengeRuntimeGate[];
  totems: ChallengePointDef[];
}

export interface ChallengePlayerAabb {
  positionXWorld: number;
  positionYWorld: number;
  halfWidthWorld: number;
  halfHeightWorld: number;
}

export function createChallengeModeState(
  roomId = '',
  fields: readonly ChallengeRectDef[] = [],
  gates: readonly ChallengeRectDef[] = [],
  totems: readonly ChallengePointDef[] = [],
): ChallengeModeState {
  return {
    roomId,
    isActive: false,
    anchorType: null,
    anchorUid: -1,
    anchorXWorld: 0,
    anchorYWorld: 0,
    activationSequence: 0,
    activationAgeTicks: 0,
    returnSequence: 0,
    reconciledReturnSequence: 0,
    fields: fields.map(field => ({ ...field, visualState: 'armed', wasPlayerOverlapping: false })),
    gates: gates.map(gate => ({ ...gate, wallIndex: -1 })),
    totems: totems.map(totem => ({ ...totem })),
  };
}

export function clearChallengeMode(state: ChallengeModeState): void {
  state.isActive = false;
  state.anchorType = null;
  state.anchorUid = -1;
  state.anchorXWorld = 0;
  state.anchorYWorld = 0;
  for (const field of state.fields) {
    field.visualState = 'armed';
    field.wasPlayerOverlapping = false;
  }
}

export function activateChallengeField(state: ChallengeModeState, uid: number, blockSizeWorld: number): boolean {
  const field = state.fields.find(candidate => candidate.uid === uid);
  if (!field || field.visualState === 'cooldown') return false;
  for (const candidate of state.fields) {
    if (candidate.visualState === 'active') candidate.visualState = 'armed';
  }
  field.visualState = 'active';
  state.isActive = true;
  state.anchorType = 'field';
  state.anchorUid = uid;
  state.anchorXWorld = (field.xBlock + field.wBlock * 0.5) * blockSizeWorld;
  state.anchorYWorld = (field.yBlock + field.hBlock * 0.5) * blockSizeWorld;
  state.activationSequence++;
  state.activationAgeTicks = 0;
  return true;
}

export function toggleChallengeTotem(state: ChallengeModeState, uid: number, blockSizeWorld: number): boolean {
  const totem = state.totems.find(candidate => candidate.uid === uid);
  if (!totem) return false;
  if (state.isActive && state.anchorType === 'totem' && state.anchorUid === uid) {
    state.isActive = false;
    state.anchorType = null;
    state.anchorUid = -1;
    return false;
  }
  for (const field of state.fields) {
    if (field.visualState === 'active') field.visualState = 'armed';
  }
  state.isActive = true;
  state.anchorType = 'totem';
  state.anchorUid = uid;
  state.anchorXWorld = totem.xBlock * blockSizeWorld;
  state.anchorYWorld = totem.yBlock * blockSizeWorld;
  state.activationSequence++;
  state.activationAgeTicks = 0;
  return true;
}

export function consumeChallengeReturn(state: ChallengeModeState): boolean {
  if (!state.isActive) return false;
  if (state.anchorType === 'field') {
    const field = state.fields.find(candidate => candidate.uid === state.anchorUid);
    if (field) field.visualState = 'cooldown';
  }
  state.isActive = false;
  state.anchorType = null;
  state.anchorUid = -1;
  state.returnSequence++;
  return true;
}

export function aabbOverlapsChallengeRect(player: ChallengePlayerAabb, rect: ChallengeRectDef, blockSizeWorld: number): boolean {
  const left = player.positionXWorld - player.halfWidthWorld;
  const right = player.positionXWorld + player.halfWidthWorld;
  const top = player.positionYWorld - player.halfHeightWorld;
  const bottom = player.positionYWorld + player.halfHeightWorld;
  const rectLeft = rect.xBlock * blockSizeWorld;
  const rectRight = (rect.xBlock + rect.wBlock) * blockSizeWorld;
  const rectTop = rect.yBlock * blockSizeWorld;
  const rectBottom = (rect.yBlock + rect.hBlock) * blockSizeWorld;
  return right > rectLeft && left < rectRight && bottom > rectTop && top < rectBottom;
}

export function aabbSeparationFromChallengeRect(player: ChallengePlayerAabb, rect: ChallengeRectDef, blockSizeWorld: number): number {
  const left = player.positionXWorld - player.halfWidthWorld;
  const right = player.positionXWorld + player.halfWidthWorld;
  const top = player.positionYWorld - player.halfHeightWorld;
  const bottom = player.positionYWorld + player.halfHeightWorld;
  const rectLeft = rect.xBlock * blockSizeWorld;
  const rectRight = (rect.xBlock + rect.wBlock) * blockSizeWorld;
  const rectTop = rect.yBlock * blockSizeWorld;
  const rectBottom = (rect.yBlock + rect.hBlock) * blockSizeWorld;
  const dx = Math.max(rectLeft - right, left - rectRight, 0);
  const dy = Math.max(rectTop - bottom, top - rectBottom, 0);
  return Math.hypot(dx, dy);
}

export function updateChallengeFields(state: ChallengeModeState, player: ChallengePlayerAabb, blockSizeWorld: number): void {
  for (const field of state.fields) {
    const overlaps = aabbOverlapsChallengeRect(player, field, blockSizeWorld);
    if (field.visualState === 'cooldown') {
      if (aabbSeparationFromChallengeRect(player, field, blockSizeWorld) >= 3 * blockSizeWorld) {
        field.visualState = 'armed';
        field.wasPlayerOverlapping = false;
      }
      continue;
    }
    if (field.visualState === 'armed' && overlaps && !field.wasPlayerOverlapping) {
      activateChallengeField(state, field.uid, blockSizeWorld);
    }
    field.wasPlayerOverlapping = overlaps;
  }
}
