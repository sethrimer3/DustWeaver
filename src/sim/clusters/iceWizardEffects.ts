import { BLOCK_SIZE_MEDIUM } from '../../levels/roomDef';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { WorldState } from '../world';
import {
  ICE_SPIKE_ACTIVE_TICKS,
  ICE_SPIKE_DAMAGE,
  ICE_SPIKE_FADE_TICKS,
  ICE_SPIKE_HEIGHT_WORLD,
  ICE_SPIKE_IFRAMES,
  ICE_SPIKE_RISE_TICKS,
  ICE_SPIKE_SPACING_WORLD,
  ICE_SPIKE_TELEGRAPH_TICKS,
  ICE_SPIKE_TOTAL_TICKS,
  ICE_SPIKE_WAVE_MAX_RANGE_TILES,
  ICE_SPIKE_WAVE_PROPAGATION_DELAY_TICKS,
  ICE_SPIKE_WIDTH_WORLD,
} from './iceWizardConfig';

export interface IceSpikeFloorCandidate {
  xWorld: number;
  floorYWorld: number;
}

function allocIceSpike(world: WorldState): number {
  for (let i = 0; i < world.iceSpikeAliveFlag.length; i++) {
    if (world.iceSpikeAliveFlag[i] === 0) return i;
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

function findFloorTopAtX(world: WorldState, xWorld: number, nearYWorld: number): number | null {
  let bestY = Number.POSITIVE_INFINITY;
  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsInvisibleFlag[wi] === 1) continue;
    const wx = world.wallXWorld[wi];
    const wy = world.wallYWorld[wi];
    const ww = world.wallWWorld[wi];
    const wh = world.wallHWorld[wi];
    if (ww <= 0 || wh <= 0) continue;
    if (xWorld < wx || xWorld >= wx + ww) continue;
    if (wy + 0.01 < nearYWorld) continue;
    if (wy < bestY) bestY = wy;
  }
  return Number.isFinite(bestY) ? bestY : null;
}

export function findIceWizardSlamFloorY(world: WorldState, leftXWorld: number, rightXWorld: number, fromYWorld: number): number | null {
  const samples = [
    leftXWorld + BLOCK_SIZE_MEDIUM * 0.5,
    (leftXWorld + rightXWorld) * 0.5,
    rightXWorld - BLOCK_SIZE_MEDIUM * 0.5,
  ];
  let floorY: number | null = null;
  for (const sx of samples) {
    const sampleFloor = findFloorTopAtX(world, sx, fromYWorld);
    if (sampleFloor === null) return null;
    floorY = floorY === null ? sampleFloor : Math.max(floorY, sampleFloor);
  }
  return floorY;
}

function isValidSpikeTile(world: WorldState, xWorld: number, floorYWorld: number): boolean {
  if (xWorld < 0 || xWorld > world.worldWidthWorld) return false;
  if (floorYWorld < 0 || floorYWorld > world.worldHeightWorld) return false;
  const solidBelow = findFloorTopAtX(world, xWorld, floorYWorld - 0.5);
  if (solidBelow === null || Math.abs(solidBelow - floorYWorld) > 0.5) return false;
  const spikeCenterY = floorYWorld - ICE_SPIKE_HEIGHT_WORLD * 0.5;
  return !overlapsSolidWall(
    world,
    xWorld,
    spikeCenterY,
    ICE_SPIKE_WIDTH_WORLD * 0.45,
    ICE_SPIKE_HEIGHT_WORLD * 0.45,
  );
}

export function collectIceSpikeWaveTiles(world: WorldState, originXWorld: number, floorYWorld: number): IceSpikeFloorCandidate[] {
  const out: IceSpikeFloorCandidate[] = [];
  const maxSteps = ICE_SPIKE_WAVE_MAX_RANGE_TILES;
  for (const dir of [-1, 1]) {
    for (let step = 1; step <= maxSteps; step++) {
      const x = originXWorld + dir * step * ICE_SPIKE_SPACING_WORLD;
      if (!isValidSpikeTile(world, x, floorYWorld)) break;
      out.push({ xWorld: x, floorYWorld });
    }
  }
  return out;
}

export function spawnIceSpikeWave(world: WorldState, originXWorld: number, floorYWorld: number): number {
  const candidates = collectIceSpikeWaveTiles(world, originXWorld, floorYWorld);
  candidates.sort((a, b) => Math.abs(a.xWorld - originXWorld) - Math.abs(b.xWorld - originXWorld));
  let spawned = 0;
  for (const c of candidates) {
    const slot = allocIceSpike(world);
    if (slot < 0) break;
    const distanceSteps = Math.max(1, Math.round(Math.abs(c.xWorld - originXWorld) / ICE_SPIKE_SPACING_WORLD));
    world.iceSpikeAliveFlag[slot] = 1;
    world.iceSpikeXWorld[slot] = c.xWorld;
    world.iceSpikeBaseYWorld[slot] = c.floorYWorld;
    world.iceSpikeAgeTicks[slot] = 0;
    world.iceSpikeDelayTicks[slot] = distanceSteps * ICE_SPIKE_WAVE_PROPAGATION_DELAY_TICKS;
    world.iceSpikeHitPlayerFlag[slot] = 0;
    spawned += 1;
  }
  return spawned;
}

export function clearIceSpikes(world: WorldState): void {
  world.iceSpikeAliveFlag.fill(0);
}

function playerOverlapsSpike(world: WorldState, i: number): boolean {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return false;
  const x = world.iceSpikeXWorld[i];
  const y = world.iceSpikeBaseYWorld[i] - ICE_SPIKE_HEIGHT_WORLD * 0.5;
  return Math.abs(player.positionXWorld - x) <= player.halfWidthWorld + ICE_SPIKE_WIDTH_WORLD * 0.45 &&
    Math.abs(player.positionYWorld - y) <= player.halfHeightWorld + ICE_SPIKE_HEIGHT_WORLD * 0.42;
}

export function tickIceSpikes(world: WorldState): void {
  const player = world.clusters[0];
  for (let i = 0; i < world.iceSpikeAliveFlag.length; i++) {
    if (world.iceSpikeAliveFlag[i] === 0) continue;
    if (world.iceSpikeDelayTicks[i] > 0) {
      world.iceSpikeDelayTicks[i] -= 1;
      continue;
    }
    const age = ++world.iceSpikeAgeTicks[i];
    if (age >= ICE_SPIKE_TOTAL_TICKS) {
      world.iceSpikeAliveFlag[i] = 0;
      continue;
    }

    const activeStart = ICE_SPIKE_TELEGRAPH_TICKS + ICE_SPIKE_RISE_TICKS;
    const activeEnd = activeStart + ICE_SPIKE_ACTIVE_TICKS;
    if (
      age < activeStart ||
      age >= activeEnd ||
      player === undefined ||
      player.isAliveFlag === 0 ||
      player.invulnerabilityTicks > 0 ||
      world.iceSpikeHitPlayerFlag[i] === 1
    ) {
      continue;
    }

    if (playerOverlapsSpike(world, i)) {
      applyPlayerDamageWithKnockback(player, ICE_SPIKE_DAMAGE, world.iceSpikeXWorld[i], world.iceSpikeBaseYWorld[i]);
      player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, ICE_SPIKE_IFRAMES);
      world.iceSpikeHitPlayerFlag[i] = 1;
    }
  }
}

export function getIceSpikePhase(ageTicks: number): 'telegraph' | 'rise' | 'active' | 'fade' {
  if (ageTicks < ICE_SPIKE_TELEGRAPH_TICKS) return 'telegraph';
  if (ageTicks < ICE_SPIKE_TELEGRAPH_TICKS + ICE_SPIKE_RISE_TICKS) return 'rise';
  if (ageTicks < ICE_SPIKE_TELEGRAPH_TICKS + ICE_SPIKE_RISE_TICKS + ICE_SPIKE_ACTIVE_TICKS) return 'active';
  return 'fade';
}

export { ICE_SPIKE_FADE_TICKS };
