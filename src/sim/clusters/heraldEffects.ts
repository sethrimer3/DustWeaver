import { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import {
  MAX_PHANTASMAL_SPIKES,
  PHANTASMAL_BLOCK_BREAK_SPEED,
  PHANTASMAL_BLOCK_DAMAGE,
  PHANTASMAL_BLOCK_FLASH_TICKS,
  PHANTASMAL_BLOCK_FORM_TICKS,
  PHANTASMAL_BLOCK_IFRAMES,
  PHANTASMAL_BLOCK_LIFETIME_TICKS,
  PHANTASMAL_BLOCK_MAX_PLAYER_SPEED,
  PHANTASMAL_BLOCK_MIN_SHOVE_STRENGTH,
  PHANTASMAL_BLOCK_RESIST_BUMP_SPEED,
  PHANTASMAL_BLOCK_SHOVE_STRENGTH,
  PHANTASMAL_BLOCK_SIZE_WORLD,
  PHANTASMAL_BLOCK_SPAWN_RADIUS_WORLD,
  PHANTASMAL_SHOCKWAVE_TICKS,
  PHANTASMAL_SPIKE_ACTIVE_TICKS,
  PHANTASMAL_SPIKE_DAMAGE,
  PHANTASMAL_SPIKE_IFRAMES,
  PHANTASMAL_SPIKE_LENGTH_WORLD,
  PHANTASMAL_SPIKE_PLAYER_SAFETY_RADIUS_WORLD,
  PHANTASMAL_SPIKE_TELEGRAPH_TICKS,
  PHANTASMAL_SPIKE_TOTAL_TICKS,
  PHANTASMAL_SPIKE_WIDTH_WORLD,
  VOID_SPHERE_BOUNDS_MARGIN_WORLD,
  VOID_SPHERE_DAMAGE,
  VOID_SPHERE_DAMAGE_RADIUS_WORLD,
  VOID_SPHERE_IFRAMES,
  VOID_SPHERE_LIFETIME_TICKS,
} from './heraldConfig';
import { ClusterState } from './state';

export type PhantasmalSurfaceDirection = 0 | 1 | 2 | 3;

export interface PhantasmalSurfaceCandidate {
  xWorld: number;
  yWorld: number;
  direction: PhantasmalSurfaceDirection;
}

function allocVoidSphere(world: WorldState): number {
  for (let i = 0; i < world.voidSphereAliveFlag.length; i++) {
    if (world.voidSphereAliveFlag[i] === 0) return i;
  }
  return -1;
}

function allocSpike(world: WorldState): number {
  for (let i = 0; i < world.phantasmalSpikeAliveFlag.length; i++) {
    if (world.phantasmalSpikeAliveFlag[i] === 0) return i;
  }
  return -1;
}

function allocBlock(world: WorldState): number {
  for (let i = 0; i < world.phantasmalBlockAliveFlag.length; i++) {
    if (world.phantasmalBlockAliveFlag[i] === 0) return i;
  }
  return -1;
}

function allocShockwave(world: WorldState): number {
  for (let i = 0; i < world.phantasmalShockwaveAliveFlag.length; i++) {
    if (world.phantasmalShockwaveAliveFlag[i] === 0) return i;
  }
  return -1;
}

function overlapsSolidWall(world: WorldState, cx: number, cy: number, halfW: number, halfH: number): boolean {
  const left = cx - halfW;
  const right = cx + halfW;
  const top = cy - halfH;
  const bottom = cy + halfH;
  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1 || world.wallIsInvisibleFlag[wi] === 1) continue;
    const wl = world.wallXWorld[wi];
    const wt = world.wallYWorld[wi];
    const wr = wl + world.wallWWorld[wi];
    const wb = wt + world.wallHWorld[wi];
    if (right > wl && left < wr && bottom > wt && top < wb) return true;
  }
  return false;
}

function isInsideRoom(world: WorldState, cx: number, cy: number, halfW: number, halfH: number): boolean {
  return cx - halfW >= 0 && cy - halfH >= 0 && cx + halfW <= world.worldWidthWorld && cy + halfH <= world.worldHeightWorld;
}

function isSafeFromPlayer(player: ClusterState | undefined, x: number, y: number, radius: number): boolean {
  if (player === undefined) return true;
  const dx = player.positionXWorld - x;
  const dy = player.positionYWorld - y;
  return dx * dx + dy * dy >= radius * radius;
}

function canPlaceSpike(world: WorldState, x: number, y: number, direction: PhantasmalSurfaceDirection, player?: ClusterState): boolean {
  const halfW = direction <= 1 ? PHANTASMAL_SPIKE_WIDTH_WORLD * 0.5 : PHANTASMAL_SPIKE_LENGTH_WORLD * 0.5;
  const halfH = direction <= 1 ? PHANTASMAL_SPIKE_LENGTH_WORLD * 0.5 : PHANTASMAL_SPIKE_WIDTH_WORLD * 0.5;
  if (!isInsideRoom(world, x, y, halfW, halfH)) return false;
  if (!isSafeFromPlayer(player, x, y, PHANTASMAL_SPIKE_PLAYER_SAFETY_RADIUS_WORLD)) return false;
  return !overlapsSolidWall(world, x, y, halfW * 0.9, halfH * 0.9);
}

export function collectPhantasmalSpikeSurfaceCandidates(world: WorldState, player?: ClusterState): PhantasmalSurfaceCandidate[] {
  const out: PhantasmalSurfaceCandidate[] = [];
  const step = Math.max(8, Math.floor(PHANTASMAL_SPIKE_WIDTH_WORLD));
  for (let wi = 0; wi < world.wallCount && out.length < MAX_PHANTASMAL_SPIKES * 8; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1 || world.wallIsInvisibleFlag[wi] === 1) continue;
    const x = world.wallXWorld[wi];
    const y = world.wallYWorld[wi];
    const w = world.wallWWorld[wi];
    const h = world.wallHWorld[wi];
    const horizontalSamples = Math.max(1, Math.floor(w / step));
    const verticalSamples = Math.max(1, Math.floor(h / step));

    for (let s = 0; s <= horizontalSamples; s++) {
      const sx = x + (w * s) / Math.max(1, horizontalSamples);
      const upY = y - PHANTASMAL_SPIKE_LENGTH_WORLD * 0.5;
      if (canPlaceSpike(world, sx, upY, 0, player)) out.push({ xWorld: sx, yWorld: upY, direction: 0 });
      const downY = y + h + PHANTASMAL_SPIKE_LENGTH_WORLD * 0.5;
      if (canPlaceSpike(world, sx, downY, 1, player)) out.push({ xWorld: sx, yWorld: downY, direction: 1 });
    }

    for (let s = 0; s <= verticalSamples; s++) {
      const sy = y + (h * s) / Math.max(1, verticalSamples);
      const leftX = x - PHANTASMAL_SPIKE_LENGTH_WORLD * 0.5;
      if (canPlaceSpike(world, leftX, sy, 2, player)) out.push({ xWorld: leftX, yWorld: sy, direction: 2 });
      const rightX = x + w + PHANTASMAL_SPIKE_LENGTH_WORLD * 0.5;
      if (canPlaceSpike(world, rightX, sy, 3, player)) out.push({ xWorld: rightX, yWorld: sy, direction: 3 });
    }
  }
  return out;
}

export function spawnVoidSphere(
  world: WorldState,
  xWorld: number,
  yWorld: number,
  targetXWorld: number,
  targetYWorld: number,
  speedWorld: number,
): void {
  const i = allocVoidSphere(world);
  if (i < 0) return;
  const dx = targetXWorld - xWorld;
  const dy = targetYWorld - yWorld;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  world.voidSphereAliveFlag[i] = 1;
  world.voidSphereXWorld[i] = xWorld;
  world.voidSphereYWorld[i] = yWorld;
  world.voidSphereVelXWorld[i] = (dx / len) * speedWorld;
  world.voidSphereVelYWorld[i] = (dy / len) * speedWorld;
  world.voidSphereAgeTicks[i] = 0;
  world.voidSpherePulsePhaseRad[i] = 0;
}

export function spawnPhantasmalSpikes(world: WorldState, count: number, player?: ClusterState): number {
  const candidates = collectPhantasmalSpikeSurfaceCandidates(world, player);
  if (candidates.length === 0) return 0;
  let spawned = 0;
  const stride = Math.max(1, Math.floor(candidates.length / Math.max(1, count)));
  let start = world.tick % candidates.length;
  for (let attempt = 0; attempt < candidates.length && spawned < count; attempt++) {
    const c = candidates[start];
    start = (start + stride) % candidates.length;
    const slot = allocSpike(world);
    if (slot < 0) break;
    world.phantasmalSpikeAliveFlag[slot] = 1;
    world.phantasmalSpikeXWorld[slot] = c.xWorld;
    world.phantasmalSpikeYWorld[slot] = c.yWorld;
    world.phantasmalSpikeDirection[slot] = c.direction;
    world.phantasmalSpikeAgeTicks[slot] = 0;
    spawned += 1;
  }
  return spawned;
}

function canPlaceBlock(world: WorldState, x: number, y: number, player?: ClusterState): boolean {
  const half = PHANTASMAL_BLOCK_SIZE_WORLD * 0.5;
  if (!isInsideRoom(world, x, y, half, half)) return false;
  if (player !== undefined && Math.abs(player.positionXWorld - x) < half + player.halfWidthWorld + 8 && Math.abs(player.positionYWorld - y) < half + player.halfHeightWorld + 8) {
    return false;
  }
  return !overlapsSolidWall(world, x, y, half, half);
}

export function spawnPhantasmalBlocks(world: WorldState, boss: ClusterState, player?: ClusterState, count = 4): number {
  let spawned = 0;
  const attempts = count * 10;
  for (let a = 0; a < attempts && spawned < count; a++) {
    const ringIndex = spawned + a * 0.37 + (boss.heraldNextAttackIndex % 5) * 0.2;
    const angle = ringIndex * Math.PI * 2 / Math.max(1, count);
    const radius = PHANTASMAL_BLOCK_SPAWN_RADIUS_WORLD + ((a % 3) - 1) * 8;
    const x = boss.positionXWorld + Math.cos(angle) * radius;
    const y = boss.positionYWorld + Math.sin(angle) * radius;
    if (!canPlaceBlock(world, x, y, player)) continue;
    const slot = allocBlock(world);
    if (slot < 0) break;
    world.phantasmalBlockAliveFlag[slot] = 1;
    world.phantasmalBlockXWorld[slot] = x;
    world.phantasmalBlockYWorld[slot] = y;
    world.phantasmalBlockAgeTicks[slot] = 0;
    world.phantasmalBlockFlashTicks[slot] = 0;
    spawned += 1;
  }
  return spawned;
}

function spawnShockwave(world: WorldState, x: number, y: number): void {
  const slot = allocShockwave(world);
  if (slot < 0) return;
  world.phantasmalShockwaveAliveFlag[slot] = 1;
  world.phantasmalShockwaveXWorld[slot] = x;
  world.phantasmalShockwaveYWorld[slot] = y;
  world.phantasmalShockwaveAgeTicks[slot] = 0;
}

export function clearPhantasmalGeometry(world: WorldState): void {
  world.phantasmalSpikeAliveFlag.fill(0);
  world.phantasmalBlockAliveFlag.fill(0);
  world.phantasmalShockwaveAliveFlag.fill(0);
}

function playerOverlapsAabb(player: ClusterState, cx: number, cy: number, halfW: number, halfH: number): boolean {
  return Math.abs(player.positionXWorld - cx) <= player.halfWidthWorld + halfW &&
    Math.abs(player.positionYWorld - cy) <= player.halfHeightWorld + halfH;
}

function applyStableShoveFrom(world: WorldState, player: ClusterState, x: number, y: number): void {
  let dx = player.positionXWorld - x;
  let dy = player.positionYWorld - y;
  let len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) {
    dx = player.velocityXWorld;
    dy = player.velocityYWorld;
    len = Math.sqrt(dx * dx + dy * dy);
  }
  if (len < 0.001) {
    dx = 1;
    dy = 0;
    len = 1;
  }
  const impulse = Math.max(PHANTASMAL_BLOCK_MIN_SHOVE_STRENGTH, PHANTASMAL_BLOCK_SHOVE_STRENGTH);
  player.velocityXWorld += (dx / len) * impulse;
  player.velocityYWorld += (dy / len) * impulse;
  const speed = Math.sqrt(player.velocityXWorld * player.velocityXWorld + player.velocityYWorld * player.velocityYWorld);
  if (speed > PHANTASMAL_BLOCK_MAX_PLAYER_SPEED) {
    const scale = PHANTASMAL_BLOCK_MAX_PLAYER_SPEED / speed;
    player.velocityXWorld *= scale;
    player.velocityYWorld *= scale;
  }
  world.zipImpactFxTicksLeft = 10;
  world.zipImpactFxTotalTicks = 10;
  world.zipImpactFxXWorld = x;
  world.zipImpactFxYWorld = y;
}

export function tickVoidSpheres(world: WorldState): void {
  const player = world.clusters[0];
  for (let i = 0; i < world.voidSphereAliveFlag.length; i++) {
    if (world.voidSphereAliveFlag[i] === 0) continue;
    world.voidSphereAgeTicks[i] += 1;
    world.voidSpherePulsePhaseRad[i] += 0.12;
    world.voidSphereXWorld[i] += world.voidSphereVelXWorld[i];
    world.voidSphereYWorld[i] += world.voidSphereVelYWorld[i];

    const x = world.voidSphereXWorld[i];
    const y = world.voidSphereYWorld[i];
    if (player !== undefined && player.isAliveFlag === 1 && player.invulnerabilityTicks <= 0) {
      const dx = player.positionXWorld - x;
      const dy = player.positionYWorld - y;
      if (dx * dx + dy * dy <= VOID_SPHERE_DAMAGE_RADIUS_WORLD * VOID_SPHERE_DAMAGE_RADIUS_WORLD) {
        applyPlayerDamageWithKnockback(player, VOID_SPHERE_DAMAGE, x, y);
        player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, VOID_SPHERE_IFRAMES);
      }
    }

    const outOfBounds =
      x < -VOID_SPHERE_BOUNDS_MARGIN_WORLD ||
      y < -VOID_SPHERE_BOUNDS_MARGIN_WORLD ||
      x > world.worldWidthWorld + VOID_SPHERE_BOUNDS_MARGIN_WORLD ||
      y > world.worldHeightWorld + VOID_SPHERE_BOUNDS_MARGIN_WORLD;
    if (outOfBounds || world.voidSphereAgeTicks[i] >= VOID_SPHERE_LIFETIME_TICKS) {
      world.voidSphereAliveFlag[i] = 0;
    }
  }
}

export function tickPhantasmalGeometry(world: WorldState): void {
  const player = world.clusters[0];
  for (let i = 0; i < world.phantasmalSpikeAliveFlag.length; i++) {
    if (world.phantasmalSpikeAliveFlag[i] === 0) continue;
    const age = ++world.phantasmalSpikeAgeTicks[i];
    if (age >= PHANTASMAL_SPIKE_TOTAL_TICKS) {
      world.phantasmalSpikeAliveFlag[i] = 0;
      continue;
    }
    const activeEnd = PHANTASMAL_SPIKE_TELEGRAPH_TICKS + PHANTASMAL_SPIKE_ACTIVE_TICKS;
    if (age < PHANTASMAL_SPIKE_TELEGRAPH_TICKS || age >= activeEnd || player === undefined || player.isAliveFlag === 0 || player.invulnerabilityTicks > 0) continue;
    const direction = world.phantasmalSpikeDirection[i];
    const halfW = direction <= 1 ? PHANTASMAL_SPIKE_WIDTH_WORLD * 0.45 : PHANTASMAL_SPIKE_LENGTH_WORLD * 0.45;
    const halfH = direction <= 1 ? PHANTASMAL_SPIKE_LENGTH_WORLD * 0.45 : PHANTASMAL_SPIKE_WIDTH_WORLD * 0.45;
    if (playerOverlapsAabb(player, world.phantasmalSpikeXWorld[i], world.phantasmalSpikeYWorld[i], halfW, halfH)) {
      applyPlayerDamageWithKnockback(player, PHANTASMAL_SPIKE_DAMAGE, world.phantasmalSpikeXWorld[i], world.phantasmalSpikeYWorld[i]);
      player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, PHANTASMAL_SPIKE_IFRAMES);
    }
  }

  for (let i = 0; i < world.phantasmalBlockAliveFlag.length; i++) {
    if (world.phantasmalBlockAliveFlag[i] === 0) continue;
    const age = ++world.phantasmalBlockAgeTicks[i];
    if (world.phantasmalBlockFlashTicks[i] > 0) world.phantasmalBlockFlashTicks[i] -= 1;
    if (age >= PHANTASMAL_BLOCK_LIFETIME_TICKS) {
      world.phantasmalBlockAliveFlag[i] = 0;
      continue;
    }
    if (age < PHANTASMAL_BLOCK_FORM_TICKS || player === undefined || player.isAliveFlag === 0) continue;
    const x = world.phantasmalBlockXWorld[i];
    const y = world.phantasmalBlockYWorld[i];
    const half = PHANTASMAL_BLOCK_SIZE_WORLD * 0.5;
    if (!playerOverlapsAabb(player, x, y, half, half)) continue;
    const speed = Math.sqrt(player.velocityXWorld * player.velocityXWorld + player.velocityYWorld * player.velocityYWorld);
    if (speed >= PHANTASMAL_BLOCK_BREAK_SPEED) {
      world.phantasmalBlockAliveFlag[i] = 0;
      spawnShockwave(world, x, y);
      applyStableShoveFrom(world, player, x, y);
    } else {
      world.phantasmalBlockFlashTicks[i] = PHANTASMAL_BLOCK_FLASH_TICKS;
      if (player.invulnerabilityTicks <= 0) {
        applyPlayerDamageWithKnockback(player, PHANTASMAL_BLOCK_DAMAGE, x, y);
        player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, PHANTASMAL_BLOCK_IFRAMES);
      }
      const dx = player.positionXWorld - x;
      const dy = player.positionYWorld - y;
      const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      player.velocityXWorld += (dx / len) * PHANTASMAL_BLOCK_RESIST_BUMP_SPEED;
      player.velocityYWorld += (dy / len) * PHANTASMAL_BLOCK_RESIST_BUMP_SPEED;
    }
  }

  for (let i = 0; i < world.phantasmalShockwaveAliveFlag.length; i++) {
    if (world.phantasmalShockwaveAliveFlag[i] === 0) continue;
    if (++world.phantasmalShockwaveAgeTicks[i] >= PHANTASMAL_SHOCKWAVE_TICKS) {
      world.phantasmalShockwaveAliveFlag[i] = 0;
    }
  }
}
