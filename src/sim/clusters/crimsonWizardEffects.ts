import { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import {
  CW_FIRE_DUST_DAMAGE,
  CW_FIRE_DUST_HIT_RADIUS,
  CW_FIRE_DUST_IFRAMES,
  CW_FIREBALL_SPEED_WORLD,
  CW_METEOR_DAMAGE,
  CW_METEOR_SIZE_WORLD,
  CW_METEOR_SPEED_WORLD,
  CW_PROJECTILE_IFRAMES,
  CW_PROJECTILE_TYPE_FIREBALL,
  CW_PROJECTILE_TYPE_METEOR,
  CW_FIREBALL_DAMAGE,
  CW_FIREBALL_SIZE_WORLD,
  CW_TELEGRAPH_KIND_METEOR,
  CW_TELEGRAPH_KIND_PILLAR,
} from './crimsonWizardConfig';
import { nextFloat } from '../rng';

const FIRE_COLORS = [0, 1, 2, 3, 4] as const;

function randSigned(world: WorldState): number {
  return nextFloat(world.rng) * 2 - 1;
}

function allocFireDust(world: WorldState): number {
  for (let i = 0; i < world.cwFireDustAliveFlag.length; i++) {
    if (world.cwFireDustAliveFlag[i] === 0) return i;
  }
  let oldest = 0;
  let maxAge = -1;
  for (let i = 0; i < world.cwFireDustAgeTicks.length; i++) {
    if (world.cwFireDustAgeTicks[i] > maxAge) {
      maxAge = world.cwFireDustAgeTicks[i];
      oldest = i;
    }
  }
  return oldest;
}

function allocSmoke(world: WorldState): number {
  for (let i = 0; i < world.cwSmokeAliveFlag.length; i++) {
    if (world.cwSmokeAliveFlag[i] === 0) return i;
  }
  return -1;
}

function allocProjectile(world: WorldState): number {
  for (let i = 0; i < world.cwProjectileAliveFlag.length; i++) {
    if (world.cwProjectileAliveFlag[i] === 0) return i;
  }
  return -1;
}

function allocTelegraph(world: WorldState): number {
  for (let i = 0; i < world.cwTelegraphAliveFlag.length; i++) {
    if (world.cwTelegraphAliveFlag[i] === 0) return i;
  }
  return -1;
}

export function spawnCrimsonTelegraph(
  world: WorldState,
  xWorld: number,
  yWorld: number,
  halfSizeWorld: number,
  kind: number,
  ticks: number,
): void {
  const i = allocTelegraph(world);
  if (i < 0) return;
  world.cwTelegraphAliveFlag[i] = 1;
  world.cwTelegraphXWorld[i] = xWorld;
  world.cwTelegraphYWorld[i] = yWorld;
  world.cwTelegraphHalfSizeWorld[i] = halfSizeWorld;
  world.cwTelegraphTicksLeft[i] = ticks;
  world.cwTelegraphMaxTicks[i] = ticks;
  world.cwTelegraphKind[i] = kind;
}

export function spawnCrimsonFireDust(
  world: WorldState,
  xWorld: number,
  yWorld: number,
  velXWorld: number,
  velYWorld: number,
  lifetimeTicks: number,
): void {
  const i = allocFireDust(world);
  world.cwFireDustAliveFlag[i] = 1;
  world.cwFireDustXWorld[i] = xWorld;
  world.cwFireDustYWorld[i] = yWorld;
  world.cwFireDustVelXWorld[i] = velXWorld;
  world.cwFireDustVelYWorld[i] = velYWorld;
  world.cwFireDustAgeTicks[i] = 0;
  world.cwFireDustLifetimeTicks[i] = lifetimeTicks;
  world.cwFireDustColorIndex[i] = FIRE_COLORS[Math.floor(nextFloat(world.rng) * FIRE_COLORS.length)] ?? 0;
}

function spawnSmoke(world: WorldState, xWorld: number, yWorld: number): void {
  const i = allocSmoke(world);
  if (i < 0) return;
  world.cwSmokeAliveFlag[i] = 1;
  world.cwSmokeXWorld[i] = xWorld;
  world.cwSmokeYWorld[i] = yWorld;
  world.cwSmokeVelXWorld[i] = randSigned(world) * 0.12;
  world.cwSmokeVelYWorld[i] = -0.12 - nextFloat(world.rng) * 0.18;
  world.cwSmokeAgeTicks[i] = 0;
  world.cwSmokeLifetimeTicks[i] = 46 + Math.floor(nextFloat(world.rng) * 34);
}

export function spawnCrimsonMeteor(world: WorldState, xWorld: number, yWorld: number, targetXWorld: number, targetYWorld: number): void {
  const i = allocProjectile(world);
  if (i < 0) return;
  const dx = targetXWorld - xWorld;
  const dy = targetYWorld - yWorld;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  world.cwProjectileAliveFlag[i] = 1;
  world.cwProjectileType[i] = CW_PROJECTILE_TYPE_METEOR;
  world.cwProjectileXWorld[i] = xWorld;
  world.cwProjectileYWorld[i] = yWorld;
  world.cwProjectileVelXWorld[i] = (dx / len) * CW_METEOR_SPEED_WORLD;
  world.cwProjectileVelYWorld[i] = (dy / len) * CW_METEOR_SPEED_WORLD;
  world.cwProjectileLifetimeTicks[i] = 120;
  world.cwProjectileHitFlag[i] = 0;
}

export function spawnCrimsonFireball(world: WorldState, xWorld: number, yWorld: number, targetXWorld: number, targetYWorld: number): void {
  const i = allocProjectile(world);
  if (i < 0) return;
  const dx = targetXWorld - xWorld;
  const dy = targetYWorld - yWorld;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  world.cwProjectileAliveFlag[i] = 1;
  world.cwProjectileType[i] = CW_PROJECTILE_TYPE_FIREBALL;
  world.cwProjectileXWorld[i] = xWorld;
  world.cwProjectileYWorld[i] = yWorld;
  world.cwProjectileVelXWorld[i] = (dx / len) * CW_FIREBALL_SPEED_WORLD + randSigned(world) * 0.22;
  world.cwProjectileVelYWorld[i] = (dy / len) * CW_FIREBALL_SPEED_WORLD + randSigned(world) * 0.16;
  world.cwProjectileLifetimeTicks[i] = 96;
  world.cwProjectileHitFlag[i] = 0;
}

function burstFire(world: WorldState, xWorld: number, yWorld: number, count: number): void {
  for (let n = 0; n < count; n++) {
    const a = nextFloat(world.rng) * Math.PI * 2;
    const speed = 0.45 + nextFloat(world.rng) * 1.8;
    spawnCrimsonFireDust(world, xWorld, yWorld, Math.cos(a) * speed, Math.sin(a) * speed - 0.4, 34 + Math.floor(nextFloat(world.rng) * 30));
  }
  for (let n = 0; n < Math.floor(count * 0.45); n++) spawnSmoke(world, xWorld + randSigned(world) * 8, yWorld + randSigned(world) * 8);
}

export function tickCrimsonWizardEffects(world: WorldState): void {
  const player = world.clusters[0];
  for (let i = 0; i < world.cwTelegraphAliveFlag.length; i++) {
    if (world.cwTelegraphAliveFlag[i] === 0) continue;
    if (world.cwTelegraphTicksLeft[i] <= 1) {
      world.cwTelegraphAliveFlag[i] = 0;
    } else {
      world.cwTelegraphTicksLeft[i] -= 1;
    }
  }

  for (let i = 0; i < world.cwFireDustAliveFlag.length; i++) {
    if (world.cwFireDustAliveFlag[i] === 0) continue;
    const age = world.cwFireDustAgeTicks[i] + 1;
    world.cwFireDustAgeTicks[i] = age;
    if (age >= world.cwFireDustLifetimeTicks[i]) {
      world.cwFireDustAliveFlag[i] = 0;
      continue;
    }
    world.cwFireDustVelXWorld[i] = world.cwFireDustVelXWorld[i] * 0.965 + randSigned(world) * 0.045;
    world.cwFireDustVelYWorld[i] = world.cwFireDustVelYWorld[i] * 0.955 - 0.018 + randSigned(world) * 0.035;
    world.cwFireDustXWorld[i] += world.cwFireDustVelXWorld[i];
    world.cwFireDustYWorld[i] += world.cwFireDustVelYWorld[i];
    if ((age & 7) === 0) spawnSmoke(world, world.cwFireDustXWorld[i], world.cwFireDustYWorld[i]);
    if (player !== undefined && player.isAliveFlag === 1 && player.invulnerabilityTicks <= 0) {
      const dx = player.positionXWorld - world.cwFireDustXWorld[i];
      const dy = player.positionYWorld - world.cwFireDustYWorld[i];
      if (dx * dx + dy * dy <= CW_FIRE_DUST_HIT_RADIUS * CW_FIRE_DUST_HIT_RADIUS) {
        applyPlayerDamageWithKnockback(player, CW_FIRE_DUST_DAMAGE, world.cwFireDustXWorld[i], world.cwFireDustYWorld[i]);
        player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, CW_FIRE_DUST_IFRAMES);
      }
    }
  }

  for (let i = 0; i < world.cwSmokeAliveFlag.length; i++) {
    if (world.cwSmokeAliveFlag[i] === 0) continue;
    const age = world.cwSmokeAgeTicks[i] + 1;
    world.cwSmokeAgeTicks[i] = age;
    if (age >= world.cwSmokeLifetimeTicks[i]) {
      world.cwSmokeAliveFlag[i] = 0;
      continue;
    }
    world.cwSmokeVelXWorld[i] = world.cwSmokeVelXWorld[i] * 0.98 + randSigned(world) * 0.018;
    world.cwSmokeVelYWorld[i] = world.cwSmokeVelYWorld[i] * 0.985 - 0.004;
    world.cwSmokeXWorld[i] += world.cwSmokeVelXWorld[i];
    world.cwSmokeYWorld[i] += world.cwSmokeVelYWorld[i];
  }

  for (let i = 0; i < world.cwProjectileAliveFlag.length; i++) {
    if (world.cwProjectileAliveFlag[i] === 0) continue;
    const type = world.cwProjectileType[i];
    world.cwProjectileLifetimeTicks[i] -= 1;
    world.cwProjectileXWorld[i] += world.cwProjectileVelXWorld[i];
    world.cwProjectileYWorld[i] += world.cwProjectileVelYWorld[i];
    const x = world.cwProjectileXWorld[i];
    const y = world.cwProjectileYWorld[i];
    const size = type === CW_PROJECTILE_TYPE_METEOR ? CW_METEOR_SIZE_WORLD : CW_FIREBALL_SIZE_WORLD;
    const damage = type === CW_PROJECTILE_TYPE_METEOR ? CW_METEOR_DAMAGE : CW_FIREBALL_DAMAGE;
    const trailCount = type === CW_PROJECTILE_TYPE_METEOR ? 3 : 2;
    for (let n = 0; n < trailCount; n++) {
      spawnCrimsonFireDust(world, x + randSigned(world) * size * 0.45, y + randSigned(world) * size * 0.45, -world.cwProjectileVelXWorld[i] * 0.12 + randSigned(world) * 0.35, -0.25 + randSigned(world) * 0.2, 28 + Math.floor(nextFloat(world.rng) * 18));
    }
    if (player !== undefined && player.isAliveFlag === 1 && player.invulnerabilityTicks <= 0) {
      const dx = Math.abs(player.positionXWorld - x);
      const dy = Math.abs(player.positionYWorld - y);
      if (dx <= player.halfWidthWorld + size * 0.5 && dy <= player.halfHeightWorld + size * 0.5) {
        applyPlayerDamageWithKnockback(player, damage, x, y);
        player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, CW_PROJECTILE_IFRAMES);
        world.cwProjectileHitFlag[i] = 1;
      }
    }
    const outOfBounds = x < -32 || y < -48 || x > world.worldWidthWorld + 32 || y > world.worldHeightWorld + 32;
    const hitFloor = y >= world.worldHeightWorld - size * 0.5 - 4;
    if (world.cwProjectileLifetimeTicks[i] <= 0 || world.cwProjectileHitFlag[i] === 1 || outOfBounds || hitFloor) {
      burstFire(world, x, y, type === CW_PROJECTILE_TYPE_METEOR ? 34 : 18);
      world.cwProjectileAliveFlag[i] = 0;
    }
  }
}

export { CW_TELEGRAPH_KIND_METEOR, CW_TELEGRAPH_KIND_PILLAR };
