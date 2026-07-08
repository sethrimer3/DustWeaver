/**
 * gameRoomHazards.ts — Room hazard loader.
 *
 * Converts editor-placed hazard definitions (spikes, springboards, water/lava
 * zones, breakable blocks, crumble blocks, bounce pads, dust boost jars,
 * firefly jars, dust piles, and firefly areas) into runtime WorldState buffers.
 *
 * Extracted from gameRoom.ts to keep each loading concern in its own module.
 */

import type { WorldState } from '../sim/world';
import {
  MAX_WALLS,
  MAX_DUST_PILES,
  MAX_FIREFLIES,
  MAX_BOUNCE_PADS,
  MAX_KINETIC_BLOCKS,
  MAX_GRAPPLE_CARRY_BLOCKS,
  MAX_PHANTASMAL_TILES,
} from '../sim/world';
import { nextFloat, nextFloatTriangle } from '../sim/rng';
import { markLiquidBodiesDirty } from '../render/liquidBodyCache';
import {
  type RoomDef,
  type CrumbleVariant,
  BLOCK_SIZE_MEDIUM,
  blockThemeToIndex,
  WALL_THEME_DEFAULT_INDEX,
} from '../levels/roomDef';
import {
  SPIKE_DIR_UP,
  SPIKE_DIR_DOWN,
  SPIKE_DIR_LEFT,
  SPIKE_DIR_RIGHT,
} from '../sim/hazards';
import { resolveWallSoundHardnessIndex } from './gameRoomWalls';

const FIREFLY_AREA_SPAWN_SPEED_WORLD = 30.0;

/**
 * Maps a `CrumbleVariant` string to a packed integer stored in `crumbleBlockVariant[]`.
 * 0=normal, 1=fire, 2=water, 3=void, 4=ice, 5=lightning, 6=poison, 7=shadow, 8=nature.
 */
const CRUMBLE_VARIANT_INDEX: Readonly<Record<CrumbleVariant, number>> = {
  normal:    0,
  fire:      1,
  water:     2,
  void:      3,
  ice:       4,
  lightning: 5,
  poison:    6,
  shadow:    7,
  nature:    8,
};

/**
 * Loads environmental hazards from a RoomDef into the WorldState hazard buffers.
 * Called once at room load time, after walls are loaded so breakable blocks can
 * be added as walls and cross-referenced.
 */
export function loadRoomHazards(world: WorldState, room: RoomDef): void {
  // ── Reset all hazard state ────────────────────────────────────────────────
  world.spikeCount = 0;
  world.spikeInvulnTicks = 0;
  world.springboardCount = 0;
  world.waterZoneCount = 0;
  world.lavaZoneCount = 0;
  world.lavaInvulnTicks = 0;
  world.breakableBlockCount = 0;
  world.crumbleBlockCount = 0;
  world.bouncePadCount = 0;
  world.kineticBlockCount = 0;
  world.grappleCarryBlockCount = 0;
  world.phantasmalTileCount = 0;
  world.dustBoostJarCount = 0;
  world.fireflyJarCount = 0;
  world.fireflyCount = 0;
  world.isPlayerInWaterFlag = 0;
  world.dustPileCount = 0;

  // ── Spikes ────────────────────────────────────────────────────────────────
  const spikeDefs = room.spikes ?? [];
  for (let i = 0; i < spikeDefs.length && world.spikeCount < world.spikeXWorld.length; i++) {
    const s = spikeDefs[i];
    const si = world.spikeCount++;
    const sizeBlocks = s.size === '2x2' ? 2 : 1;
    world.spikeSizeBlocks[si] = sizeBlocks;
    // xBlock/yBlock are the footprint's top-left corner regardless of size.
    world.spikeXWorld[si] = (s.xBlock + sizeBlocks * 0.5) * BLOCK_SIZE_MEDIUM;
    world.spikeYWorld[si] = (s.yBlock + sizeBlocks * 0.5) * BLOCK_SIZE_MEDIUM;
    switch (s.direction) {
      case 'up':    world.spikeDirection[si] = SPIKE_DIR_UP; break;
      case 'down':  world.spikeDirection[si] = SPIKE_DIR_DOWN; break;
      case 'left':  world.spikeDirection[si] = SPIKE_DIR_LEFT; break;
      case 'right': world.spikeDirection[si] = SPIKE_DIR_RIGHT; break;
    }
    world.spikeBlockThemeIndex[si] = s.blockTheme !== undefined
      ? blockThemeToIndex(s.blockTheme)
      : WALL_THEME_DEFAULT_INDEX;
  }

  // ── Springboards ──────────────────────────────────────────────────────────
  const springDefs = room.springboards ?? [];
  for (let i = 0; i < springDefs.length && world.springboardCount < world.springboardXWorld.length; i++) {
    const s = springDefs[i];
    const si = world.springboardCount++;
    world.springboardXWorld[si] = (s.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.springboardYWorld[si] = (s.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.springboardAnimTicks[si] = 0;
  }

  // ── Water zones ───────────────────────────────────────────────────────────
  const waterDefs = room.waterZones ?? [];
  for (let i = 0; i < waterDefs.length && world.waterZoneCount < world.waterZoneXWorld.length; i++) {
    const w = waterDefs[i];
    const wi = world.waterZoneCount++;
    world.waterZoneXWorld[wi] = w.xBlock * BLOCK_SIZE_MEDIUM;
    world.waterZoneYWorld[wi] = w.yBlock * BLOCK_SIZE_MEDIUM;
    world.waterZoneWWorld[wi] = w.wBlock * BLOCK_SIZE_MEDIUM;
    world.waterZoneHWorld[wi] = w.hBlock * BLOCK_SIZE_MEDIUM;
  }

  // ── Lava zones ────────────────────────────────────────────────────────────
  const lavaDefs = room.lavaZones ?? [];
  for (let i = 0; i < lavaDefs.length && world.lavaZoneCount < world.lavaZoneXWorld.length; i++) {
    const l = lavaDefs[i];
    const li = world.lavaZoneCount++;
    world.lavaZoneXWorld[li] = l.xBlock * BLOCK_SIZE_MEDIUM;
    world.lavaZoneYWorld[li] = l.yBlock * BLOCK_SIZE_MEDIUM;
    world.lavaZoneWWorld[li] = l.wBlock * BLOCK_SIZE_MEDIUM;
    world.lavaZoneHWorld[li] = l.hBlock * BLOCK_SIZE_MEDIUM;
  }

  // Invalidate the liquid body render cache whenever zones are (re)loaded.
  markLiquidBodiesDirty();

  // ── Breakable blocks ──────────────────────────────────────────────────────
  // Each breakable block is added as a wall AND tracked in the breakable arrays.
  const breakDefs = room.breakableBlocks ?? [];
  for (let i = 0; i < breakDefs.length && world.breakableBlockCount < world.breakableBlockXWorld.length; i++) {
    const b = breakDefs[i];
    const bx = (b.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (b.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;

    // Add as a wall
    let wallIdx = -1;
    if (world.wallCount < MAX_WALLS) {
      wallIdx = world.wallCount++;
      world.wallXWorld[wallIdx] = b.xBlock * BLOCK_SIZE_MEDIUM;
      world.wallYWorld[wallIdx] = b.yBlock * BLOCK_SIZE_MEDIUM;
      world.wallWWorld[wallIdx] = BLOCK_SIZE_MEDIUM;
      world.wallHWorld[wallIdx] = BLOCK_SIZE_MEDIUM;
      world.wallThemeIndex[wallIdx] = WALL_THEME_DEFAULT_INDEX;
      world.wallSoundHardnessIndex[wallIdx] = resolveWallSoundHardnessIndex(room, undefined);
      world.wallIsInvisibleFlag[wallIdx] = 0;
      world.wallIsPlatformFlag[wallIdx] = 0;
      world.wallPlatformEdge[wallIdx] = 0;
      world.wallRampOrientationIndex[wallIdx] = 255;
      world.wallIsPillarHalfWidthFlag[wallIdx] = 0;
      world.wallIsBouncePadFlag[wallIdx] = 0;
      world.wallBouncePadSpeedFactorIndex[wallIdx] = 0;
    }

    const bi = world.breakableBlockCount++;
    world.breakableBlockXWorld[bi] = bx;
    world.breakableBlockYWorld[bi] = by;
    world.isBreakableBlockActiveFlag[bi] = 1;
    world.breakableBlockWallIndex[bi] = wallIdx;
  }

  // ── Crumble blocks ────────────────────────────────────────────────────────
  // Each crumble block is added as a wall AND tracked in the crumble arrays.
  const crumbleDefs = room.crumbleBlocks ?? [];
  for (let i = 0; i < crumbleDefs.length && world.crumbleBlockCount < world.crumbleBlockXWorld.length; i++) {
    const b = crumbleDefs[i];
    const wBlocks = b.wBlock ?? 1;
    const hBlocks = b.hBlock ?? 1;
    const bx = (b.xBlock + wBlocks * 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (b.yBlock + hBlocks * 0.5) * BLOCK_SIZE_MEDIUM;

    let wallIdx = -1;
    if (world.wallCount < MAX_WALLS) {
      wallIdx = world.wallCount++;
      world.wallXWorld[wallIdx] = b.xBlock * BLOCK_SIZE_MEDIUM;
      world.wallYWorld[wallIdx] = b.yBlock * BLOCK_SIZE_MEDIUM;
      world.wallWWorld[wallIdx] = wBlocks * BLOCK_SIZE_MEDIUM;
      world.wallHWorld[wallIdx] = hBlocks * BLOCK_SIZE_MEDIUM;
      world.wallThemeIndex[wallIdx] = b.blockTheme !== undefined
        ? blockThemeToIndex(b.blockTheme)
        : WALL_THEME_DEFAULT_INDEX;
      world.wallSoundHardnessIndex[wallIdx] = resolveWallSoundHardnessIndex(room, b.blockTheme);
      world.wallIsInvisibleFlag[wallIdx] = 0;
      world.wallIsPlatformFlag[wallIdx] = 0;
      world.wallRampOrientationIndex[wallIdx] = 255;
      world.wallIsPillarHalfWidthFlag[wallIdx] = 0;
    }

    const ci = world.crumbleBlockCount++;
    world.crumbleBlockXWorld[ci] = bx;
    world.crumbleBlockYWorld[ci] = by;
    world.isCrumbleBlockActiveFlag[ci] = 1;
    world.crumbleBlockHitsRemaining[ci] = 2;
    world.crumbleBlockHitCooldownTicks[ci] = 0;
    world.crumbleBlockWallIndex[ci] = wallIdx;
    world.crumbleBlockVariant[ci] = CRUMBLE_VARIANT_INDEX[b.variant ?? 'normal'];
  }

  // ── Bounce pads ──────────────────────────────────────────────────────────
  // Each bounce pad is added as a wall AND tracked in the bouncePad* arrays
  // for the renderer. The wall gets wallIsBouncePadFlag=1 so the collision
  // resolver reflects velocity instead of stopping the player.
  const bouncePadDefs = room.bouncePads ?? [];
  for (let i = 0; i < bouncePadDefs.length && world.bouncePadCount < MAX_BOUNCE_PADS; i++) {
    const b = bouncePadDefs[i];
    const wBlocks = b.wBlock ?? 1;
    const hBlocks = b.hBlock ?? 1;
    const sfIndex = b.speedFactorIndex ?? 0;
    const rampOri = b.rampOrientation !== undefined ? b.rampOrientation : 255;

    let wallIdx = -1;
    if (world.wallCount < MAX_WALLS) {
      wallIdx = world.wallCount++;
      world.wallXWorld[wallIdx] = b.xBlock * BLOCK_SIZE_MEDIUM;
      world.wallYWorld[wallIdx] = b.yBlock * BLOCK_SIZE_MEDIUM;
      world.wallWWorld[wallIdx] = wBlocks * BLOCK_SIZE_MEDIUM;
      world.wallHWorld[wallIdx] = hBlocks * BLOCK_SIZE_MEDIUM;
      world.wallThemeIndex[wallIdx] = WALL_THEME_DEFAULT_INDEX;
      world.wallSoundHardnessIndex[wallIdx] = resolveWallSoundHardnessIndex(room, undefined);
      world.wallIsInvisibleFlag[wallIdx] = 0;
      world.wallIsPlatformFlag[wallIdx] = 0;
      world.wallPlatformEdge[wallIdx] = 0;
      world.wallRampOrientationIndex[wallIdx] = rampOri;
      world.wallIsPillarHalfWidthFlag[wallIdx] = 0;
      world.wallIsBouncePadFlag[wallIdx] = 1;
      world.wallBouncePadSpeedFactorIndex[wallIdx] = sfIndex;
      world.wallIsKineticBlockFlag[wallIdx] = 0;
      world.wallKineticBlockIndex[wallIdx] = -1;
    }

    const pi = world.bouncePadCount++;
    world.bouncePadXWorld[pi] = b.xBlock * BLOCK_SIZE_MEDIUM;
    world.bouncePadYWorld[pi] = b.yBlock * BLOCK_SIZE_MEDIUM;
    world.bouncePadWWorld[pi] = wBlocks * BLOCK_SIZE_MEDIUM;
    world.bouncePadHWorld[pi] = hBlocks * BLOCK_SIZE_MEDIUM;
    world.bouncePadSpeedFactorIndex[pi] = sfIndex;
    world.bouncePadRampOrientationIndex[pi] = rampOri;
    void wallIdx;
  }

  // ── Kinetic blocks ────────────────────────────────────────────────────────
  const kineticBlockDefs = room.kineticBlocks ?? [];
  for (let i = 0; i < kineticBlockDefs.length && world.kineticBlockCount < MAX_KINETIC_BLOCKS; i++) {
    const kb = kineticBlockDefs[i];
    const wBlocks = kb.wBlock ?? 1;
    const hBlocks = kb.hBlock ?? 1;

    let wallIdx = -1;
    if (world.wallCount < MAX_WALLS) {
      wallIdx = world.wallCount++;
      world.wallXWorld[wallIdx] = kb.xBlock * BLOCK_SIZE_MEDIUM;
      world.wallYWorld[wallIdx] = kb.yBlock * BLOCK_SIZE_MEDIUM;
      world.wallWWorld[wallIdx] = wBlocks * BLOCK_SIZE_MEDIUM;
      world.wallHWorld[wallIdx] = hBlocks * BLOCK_SIZE_MEDIUM;
      world.wallThemeIndex[wallIdx] = WALL_THEME_DEFAULT_INDEX;
      world.wallSoundHardnessIndex[wallIdx] = resolveWallSoundHardnessIndex(room, undefined);
      world.wallIsInvisibleFlag[wallIdx] = 1;  // Mark invisible: kinetic block visuals are drawn separately in renderHazards
      world.wallIsPlatformFlag[wallIdx] = 0;
      world.wallPlatformEdge[wallIdx] = 0;
      world.wallRampOrientationIndex[wallIdx] = 255;
      world.wallIsPillarHalfWidthFlag[wallIdx] = 0;
      world.wallIsBouncePadFlag[wallIdx] = 0;
      world.wallBouncePadSpeedFactorIndex[wallIdx] = 0;
      world.wallIsIceFlag[wallIdx] = 0;
      world.wallIsUltraIceFlag[wallIdx] = 0;
      world.wallIsKineticBlockFlag[wallIdx] = 1;
      world.wallKineticBlockIndex[wallIdx] = world.kineticBlockCount;
    }

    const ki = world.kineticBlockCount++;
    world.kineticBlockXWorld[ki] = kb.xBlock * BLOCK_SIZE_MEDIUM;
    world.kineticBlockYWorld[ki] = kb.yBlock * BLOCK_SIZE_MEDIUM;
    world.kineticBlockWWorld[ki] = wBlocks * BLOCK_SIZE_MEDIUM;
    world.kineticBlockHWorld[ki] = hBlocks * BLOCK_SIZE_MEDIUM;
    world.kineticBlockAnimPhase[ki] = 0;
    void wallIdx;
  }
  const carryDefs = room.grappleCarryBlocks ?? [];
  for (let i = 0; i < carryDefs.length && world.grappleCarryBlockCount < MAX_GRAPPLE_CARRY_BLOCKS; i++) {
    const b = carryDefs[i];
    const bi = world.grappleCarryBlockCount++;
    world.grappleCarryBlockXWorld[bi] = (b.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.grappleCarryBlockYWorld[bi] = (b.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.grappleCarryBlockVelXWorld[bi] = 0;
    world.grappleCarryBlockVelYWorld[bi] = 0;
    world.grappleCarryBlockGroundedFlag[bi] = 0;
    world.grappleCarryBlockContactFlags[bi] = 0;
  }
  const phantasmalDefs = room.phantasmalTiles ?? [];
  for (let i = 0; i < phantasmalDefs.length && world.phantasmalTileCount < MAX_PHANTASMAL_TILES; i++) {
    const b = phantasmalDefs[i];
    const pi = world.phantasmalTileCount++;
    world.phantasmalTileXWorld[pi] = b.xBlock * BLOCK_SIZE_MEDIUM;
    world.phantasmalTileYWorld[pi] = b.yBlock * BLOCK_SIZE_MEDIUM;
  }
  const dustJarDefs = room.dustBoostJars ?? [];
  for (let i = 0; i < dustJarDefs.length && world.dustBoostJarCount < world.dustBoostJarXWorld.length; i++) {
    const j = dustJarDefs[i];
    const ji = world.dustBoostJarCount++;
    world.dustBoostJarXWorld[ji] = (j.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.dustBoostJarYWorld[ji] = (j.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.isDustBoostJarActiveFlag[ji] = 1;
    world.dustBoostJarKind[ji] = j.dustKind;
    world.dustBoostJarDustCount[ji] = j.dustCount;
  }

  // ── Firefly jars ──────────────────────────────────────────────────────────
  const fireflyJarDefs = room.fireflyJars ?? [];
  for (let i = 0; i < fireflyJarDefs.length && world.fireflyJarCount < world.fireflyJarXWorld.length; i++) {
    const j = fireflyJarDefs[i];
    const ji = world.fireflyJarCount++;
    world.fireflyJarXWorld[ji] = (j.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.fireflyJarYWorld[ji] = (j.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.isFireflyJarActiveFlag[ji] = 1;
  }

  // ── Dust piles ──────────────────────────────────────────────────────────
  const dustPileDefs = room.dustPiles ?? [];
  for (let i = 0; i < dustPileDefs.length && world.dustPileCount < MAX_DUST_PILES; i++) {
    const p = dustPileDefs[i];
    const pi = world.dustPileCount++;
    // spreadBlocks is the full width of the spread zone; half of it is used as
    // the triangle distribution amplitude, so positions land within ±(spreadBlocks/2) blocks.
    const spreadHalfWidthWorld = (p.spreadBlocks ?? 0) * 0.5 * BLOCK_SIZE_MEDIUM;
    world.dustPileXWorld[pi] = (p.xBlock + 0.5) * BLOCK_SIZE_MEDIUM
      + nextFloatTriangle(world.rng) * spreadHalfWidthWorld;
    world.dustPileYWorld[pi] = (p.yBlock + 1.0) * BLOCK_SIZE_MEDIUM
      + nextFloatTriangle(world.rng) * spreadHalfWidthWorld;
    world.dustPileDustCount[pi] = p.dustCount;
    world.isDustPileActiveFlag[pi] = 1;
  }

  // ── Firefly areas ────────────────────────────────────────────────────────
  const fireflyAreaDefs = room.fireflyAreas ?? [];
  for (const area of fireflyAreaDefs) {
    const halfWidthWorld  = area.wBlock * BLOCK_SIZE_MEDIUM * 0.5;
    const halfHeightWorld = area.hBlock * BLOCK_SIZE_MEDIUM * 0.5;
    const centerXWorld = area.xBlock * BLOCK_SIZE_MEDIUM + halfWidthWorld;
    const centerYWorld = area.yBlock * BLOCK_SIZE_MEDIUM + halfHeightWorld;
    for (let f = 0; f < area.count && world.fireflyCount < MAX_FIREFLIES; f++) {
      const fi = world.fireflyCount++;
      world.fireflyXWorld[fi] = centerXWorld
        + nextFloatTriangle(world.rng) * halfWidthWorld;
      world.fireflyYWorld[fi] = centerYWorld
        + nextFloatTriangle(world.rng) * halfHeightWorld;
      const angleRad = nextFloat(world.rng) * Math.PI * 2;
      world.fireflyVelXWorld[fi] = Math.cos(angleRad) * FIREFLY_AREA_SPAWN_SPEED_WORLD;
      world.fireflyVelYWorld[fi] = Math.sin(angleRad) * FIREFLY_AREA_SPAWN_SPEED_WORLD;
    }
  }
}
