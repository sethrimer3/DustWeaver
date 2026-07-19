/** Pure geometry and deterministic gameplay state for the directional Shield Weave. */

export const SHIELD_EXTRA_DIAMETER_WORLD = 8;
export const SHIELD_MIN_ARC_LENGTH_WORLD = 10;
export const SHIELD_ARC_LENGTH_PER_EXTRA_MOTE_WORLD = 3;
export const SHIELD_COLLISION_HALF_THICKNESS_WORLD = 2;
const SHIELD_DIRECTION_RESPONSE_PER_SEC = 22;
const SHIELD_IMPACT_TICKS = 12;
const FULL_CIRCLE_EPSILON = 1e-6;

export interface ShieldArcGeometry {
  isActive: boolean;
  centerXWorld: number;
  centerYWorld: number;
  radiusWorld: number;
  directionAngleRad: number;
  arcLengthWorld: number;
  angularSpanRad: number;
  isFullCircle: boolean;
  moteCount: number;
}

export interface ShieldWeaveState extends ShieldArcGeometry {
  isHeldRequested: boolean;
  lastValidDirectionAngleRad: number;
  impactXWorld: number;
  impactYWorld: number;
  impactTicksLeft: number;
}

export function createShieldWeaveState(): ShieldWeaveState {
  return {
    isActive: false,
    isHeldRequested: false,
    centerXWorld: 0,
    centerYWorld: 0,
    radiusWorld: 0,
    directionAngleRad: 0,
    lastValidDirectionAngleRad: 0,
    arcLengthWorld: 0,
    angularSpanRad: 0,
    isFullCircle: false,
    moteCount: 0,
    impactXWorld: 0,
    impactYWorld: 0,
    impactTicksLeft: 0,
  };
}

export function getShieldRadiusWorld(playerCollisionHeightWorld: number): number {
  return (Math.max(0, playerCollisionHeightWorld) + SHIELD_EXTRA_DIAMETER_WORLD) * 0.5;
}

export function getRequestedShieldArcLengthWorld(moteCount: number): number {
  const count = Math.max(0, Math.floor(moteCount));
  return count <= 0 ? 0 : SHIELD_MIN_ARC_LENGTH_WORLD + SHIELD_ARC_LENGTH_PER_EXTRA_MOTE_WORLD * (count - 1);
}

export function getEffectiveShieldArcLengthWorld(moteCount: number, radiusWorld: number): number {
  return Math.min(getRequestedShieldArcLengthWorld(moteCount), Math.PI * 2 * Math.max(0, radiusWorld));
}

export function getShieldAngularSpanRad(moteCount: number, radiusWorld: number): number {
  if (radiusWorld <= 0) return 0;
  return getEffectiveShieldArcLengthWorld(moteCount, radiusWorld) / radiusWorld;
}

export function getShieldMoteAngleRad(geometry: ShieldArcGeometry, moteIndex: number): number {
  const count = geometry.moteCount;
  if (count <= 1) return geometry.directionAngleRad;
  if (geometry.isFullCircle) {
    return geometry.directionAngleRad + (moteIndex / count) * Math.PI * 2;
  }
  return geometry.directionAngleRad - geometry.angularSpanRad * 0.5
    + (moteIndex / (count - 1)) * geometry.angularSpanRad;
}

function wrapAngleRad(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function resolveShieldDirectionAngleRad(
  cursorXWorld: number,
  cursorYWorld: number,
  centerXWorld: number,
  centerYWorld: number,
  lastValidAngleRad: number,
): number {
  const dx = cursorXWorld - centerXWorld;
  const dy = cursorYWorld - centerYWorld;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx * dx + dy * dy < 0.000001) {
    return Number.isFinite(lastValidAngleRad) ? lastValidAngleRad : 0;
  }
  return Math.atan2(dy, dx);
}

export function deactivateShieldWeave(state: ShieldWeaveState): void {
  state.isActive = false;
  state.isHeldRequested = false;
  state.arcLengthWorld = 0;
  state.angularSpanRad = 0;
  state.isFullCircle = false;
  state.moteCount = 0;
  state.impactTicksLeft = 0;
}

export function resetShieldWeaveState(state: ShieldWeaveState): void {
  const fallbackAngle = Number.isFinite(state.lastValidDirectionAngleRad) ? state.lastValidDirectionAngleRad : 0;
  Object.assign(state, createShieldWeaveState());
  state.directionAngleRad = fallbackAngle;
  state.lastValidDirectionAngleRad = fallbackAngle;
}

export function updateShieldWeaveState(
  state: ShieldWeaveState,
  dtSec: number,
  availableMoteCount: number,
  playerXWorld: number,
  playerYWorld: number,
  playerCollisionHeightWorld: number,
  aimDirXWorld: number,
  aimDirYWorld: number,
): void {
  if (state.impactTicksLeft > 0) state.impactTicksLeft--;
  const moteCount = Math.max(0, Math.floor(availableMoteCount));
  if (!state.isHeldRequested || moteCount <= 0) {
    state.isActive = false;
    state.arcLengthWorld = 0;
    state.angularSpanRad = 0;
    state.isFullCircle = false;
    state.moteCount = 0;
    return;
  }

  const targetAngle = resolveShieldDirectionAngleRad(
    playerXWorld + aimDirXWorld,
    playerYWorld + aimDirYWorld,
    playerXWorld,
    playerYWorld,
    state.lastValidDirectionAngleRad,
  );
  const wasActive = state.isActive;
  state.lastValidDirectionAngleRad = targetAngle;
  if (!wasActive) {
    state.directionAngleRad = targetAngle;
  } else {
    const response = 1 - Math.exp(-SHIELD_DIRECTION_RESPONSE_PER_SEC * Math.max(0, Math.min(dtSec, 0.05)));
    state.directionAngleRad = wrapAngleRad(
      state.directionAngleRad + wrapAngleRad(targetAngle - state.directionAngleRad) * response,
    );
  }

  state.isActive = true;
  state.centerXWorld = playerXWorld;
  state.centerYWorld = playerYWorld;
  state.radiusWorld = getShieldRadiusWorld(playerCollisionHeightWorld);
  state.moteCount = moteCount;
  state.arcLengthWorld = getEffectiveShieldArcLengthWorld(moteCount, state.radiusWorld);
  state.angularSpanRad = state.radiusWorld > 0 ? state.arcLengthWorld / state.radiusWorld : 0;
  state.isFullCircle = state.angularSpanRad >= Math.PI * 2 - FULL_CIRCLE_EPSILON;
}

function angleIsOnShield(geometry: ShieldArcGeometry, angleRad: number): boolean {
  if (geometry.isFullCircle) return true;
  return Math.abs(wrapAngleRad(angleRad - geometry.directionAngleRad)) <= geometry.angularSpanRad * 0.5 + 1e-6;
}

export function isPointBlockedByShield(
  geometry: ShieldArcGeometry,
  xWorld: number,
  yWorld: number,
  extraRadiusWorld = 0,
): boolean {
  if (!geometry.isActive) return false;
  const dx = xWorld - geometry.centerXWorld;
  const dy = yWorld - geometry.centerYWorld;
  const distance = Math.hypot(dx, dy);
  const tolerance = SHIELD_COLLISION_HALF_THICKNESS_WORLD + Math.max(0, extraRadiusWorld);
  if (Math.abs(distance - geometry.radiusWorld) > tolerance) return false;
  return angleIsOnShield(geometry, Math.atan2(dy, dx));
}

function pointSegmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const denom = abx * abx + aby * aby;
  const t = denom > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / denom)) : 0;
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return dx * dx + dy * dy;
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function pointIsOnSegmentBounds(px: number, py: number, qx: number, qy: number, rx: number, ry: number): boolean {
  const epsilon = 1e-9;
  return qx >= Math.min(px, rx) - epsilon && qx <= Math.max(px, rx) + epsilon
    && qy >= Math.min(py, ry) - epsilon && qy <= Math.max(py, ry) + epsilon;
}

function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o1 = orientation(ax, ay, bx, by, cx, cy);
  const o2 = orientation(ax, ay, bx, by, dx, dy);
  const o3 = orientation(cx, cy, dx, dy, ax, ay);
  const o4 = orientation(cx, cy, dx, dy, bx, by);
  const epsilon = 1e-9;
  if (Math.abs(o1) <= epsilon && pointIsOnSegmentBounds(ax, ay, cx, cy, bx, by)) return true;
  if (Math.abs(o2) <= epsilon && pointIsOnSegmentBounds(ax, ay, dx, dy, bx, by)) return true;
  if (Math.abs(o3) <= epsilon && pointIsOnSegmentBounds(cx, cy, ax, ay, dx, dy)) return true;
  if (Math.abs(o4) <= epsilon && pointIsOnSegmentBounds(cx, cy, bx, by, dx, dy)) return true;
  return ((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0));
}

function segmentSegmentDistanceSq(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    pointSegmentDistanceSq(ax, ay, cx, cy, dx, dy),
    pointSegmentDistanceSq(bx, by, cx, cy, dx, dy),
    pointSegmentDistanceSq(cx, cy, ax, ay, bx, by),
    pointSegmentDistanceSq(dx, dy, ax, ay, bx, by),
  );
}

export function doesSegmentIntersectShield(
  geometry: ShieldArcGeometry,
  x0World: number,
  y0World: number,
  x1World: number,
  y1World: number,
  projectileRadiusWorld = 0,
): boolean {
  if (!geometry.isActive || geometry.radiusWorld <= 0 || geometry.angularSpanRad <= 0) return false;
  const startDistance = Math.hypot(x0World - geometry.centerXWorld, y0World - geometry.centerYWorld);
  const tolerance = SHIELD_COLLISION_HALF_THICKNESS_WORLD + Math.max(0, projectileRadiusWorld);
  if (startDistance < geometry.radiusWorld - tolerance) return false;

  const segmentCount = Math.max(1, Math.ceil(geometry.arcLengthWorld / 1.5));
  const startAngle = geometry.isFullCircle
    ? geometry.directionAngleRad
    : geometry.directionAngleRad - geometry.angularSpanRad * 0.5;
  const step = geometry.angularSpanRad / segmentCount;
  let arcX0 = geometry.centerXWorld + Math.cos(startAngle) * geometry.radiusWorld;
  let arcY0 = geometry.centerYWorld + Math.sin(startAngle) * geometry.radiusWorld;
  const toleranceSq = tolerance * tolerance;
  for (let i = 1; i <= segmentCount; i++) {
    const angle = startAngle + step * i;
    const arcX1 = geometry.centerXWorld + Math.cos(angle) * geometry.radiusWorld;
    const arcY1 = geometry.centerYWorld + Math.sin(angle) * geometry.radiusWorld;
    if (segmentSegmentDistanceSq(x0World, y0World, x1World, y1World, arcX0, arcY0, arcX1, arcY1) <= toleranceSq) return true;
    arcX0 = arcX1;
    arcY0 = arcY1;
  }
  return false;
}

export function doesAabbIntersectShield(
  geometry: ShieldArcGeometry,
  minXWorld: number,
  minYWorld: number,
  maxXWorld: number,
  maxYWorld: number,
): boolean {
  if (!geometry.isActive) return false;
  const sampleCount = Math.max(1, Math.ceil(geometry.arcLengthWorld));
  const startAngle = geometry.isFullCircle ? geometry.directionAngleRad : geometry.directionAngleRad - geometry.angularSpanRad * 0.5;
  for (let i = 0; i <= sampleCount; i++) {
    if (geometry.isFullCircle && i === sampleCount) break;
    const angle = startAngle + geometry.angularSpanRad * (i / sampleCount);
    const x = geometry.centerXWorld + Math.cos(angle) * geometry.radiusWorld;
    const y = geometry.centerYWorld + Math.sin(angle) * geometry.radiusWorld;
    if (x >= minXWorld - SHIELD_COLLISION_HALF_THICKNESS_WORLD && x <= maxXWorld + SHIELD_COLLISION_HALF_THICKNESS_WORLD
      && y >= minYWorld - SHIELD_COLLISION_HALF_THICKNESS_WORLD && y <= maxYWorld + SHIELD_COLLISION_HALF_THICKNESS_WORLD) return true;
  }
  return false;
}

export function recordShieldImpact(state: ShieldWeaveState, xWorld: number, yWorld: number): void {
  const angle = Math.atan2(yWorld - state.centerYWorld, xWorld - state.centerXWorld);
  state.impactXWorld = state.centerXWorld + Math.cos(angle) * state.radiusWorld;
  state.impactYWorld = state.centerYWorld + Math.sin(angle) * state.radiusWorld;
  state.impactTicksLeft = SHIELD_IMPACT_TICKS;
}

export function tryBlockHostileProjectile(
  state: ShieldWeaveState,
  x0World: number,
  y0World: number,
  x1World: number,
  y1World: number,
  projectileRadiusWorld = 0,
): boolean {
  if (!doesSegmentIntersectShield(state, x0World, y0World, x1World, y1World, projectileRadiusWorld)) return false;
  recordShieldImpact(state, x1World, y1World);
  return true;
}
