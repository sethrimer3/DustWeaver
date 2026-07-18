/**
 * Room builder — bidirectional conversions between EditorRoomData and RoomDef.
 *
 * This module handles the runtime-representation layer: turning an author's
 * EditorRoomData into a fully hydrated RoomDef (for the sim), and the reverse
 * conversion that lets the editor load back a compiled RoomDef.
 *
 * JSON serialisation/deserialisation lives in roomJson.ts.
 * Boundary walls are NOT stored in the JSON; they are regenerated
 * deterministically here at load time using buildCompleteBoundaryWalls().
 *
 * DESIGN NOTE (BUILD 420+): Boundary walls are complete solid edge rectangles.
 * Transitions are independent trigger strips — they no longer cut holes in
 * boundary walls.  Do not reintroduce wall gaps for transitions here.
 */

import { ParticleKind } from '../sim/particles/kinds';
import type { RoomDef, RoomEnemyDef, RoomWallDef, RoomTransitionDef, RoomBreakableBlockDef, RoomContactDamageBlockDef, RoomWindTransmissionBlockDef, RoomLiquidInteractionBlockDef, RoomCustomBlockWindVentDef } from '../levels/roomDef';
import type { EditorRoomData } from './editorState';
import { stringToParticleKind } from './roomJsonSchema';
import { buildCompleteBoundaryWalls } from '../levels/roomBoundaryWalls';
import { rawIdFromNamespaced } from '../levels/customBlocks';
import { getCustomBlockProperties } from '../render/customBlockSpriteCache';
import {
  resolveWallBehavior,
  isEligibleForBreakablePathway,
  isEligibleForContactDamage,
  isEligibleForWindTransmission,
  isEligibleForLiquidInteraction,
  isEligibleForWindVent,
} from '../levels/customBlockProperties';

// Re-export the reverse direction (RoomDef → EditorRoomData) from its own module
// so existing callers that import from editorRoomBuilder are unaffected.
export { roomDefToEditorRoomData } from './editorRoomImporter';

// ── Conversion: EditorRoomData → RoomDef (for runtime loading) ───────────────

/**
 * Converts editor room data into a full RoomDef suitable for runtime loading.
 * Boundary walls are complete solid edge walls (no transition holes).
 * See `roomBoundaryWalls.ts` for the design rationale.
 */
export function editorRoomDataToRoomDef(data: EditorRoomData): RoomDef {
  const boundaryWalls = buildCompleteBoundaryWalls(data.widthBlocks, data.heightBlocks);

  const interiorWalls: RoomWallDef[] = data.interiorWalls.map(w => ({
    xBlock: w.xBlock,
    yBlock: w.yBlock,
    wBlock: w.wBlock,
    hBlock: w.hBlock,
    isPlatformFlag: w.isPlatformFlag,
    platformEdge: w.platformEdge,
    blockTheme: w.blockTheme,
    rampOrientation: w.rampOrientation,
    stairsOrientation: w.stairsOrientation,
    isPillarHalfWidthFlag: w.isPillarHalfWidthFlag,
  }));

  // Convert custom block placements to walls, resolving each placement's
  // engine-defined collision/friction/breakability preset from the runtime
  // sprite cache (populated at campaign load / block create / block edit —
  // see customBlockSpriteCache.ts). Unregistered blocks fall back to the
  // solid/default/indestructible defaults, matching Phase 1 behavior.
  const customBlockWalls: RoomWallDef[] = [];
  const customBlockBreakables: RoomBreakableBlockDef[] = [];
  const customBlockContactDamage: RoomContactDamageBlockDef[] = [];
  // Phase 2F: one entry per ELIGIBLE placement (never per cell — see
  // RoomWindTransmissionBlockDef's doc comment), covering both fragile and
  // indestructible solid blocks. Used only to build the initial room-load
  // wind-transmission mask (see gameRoomPixelMaterials.ts).
  const customBlockWindTransmission: RoomWindTransmissionBlockDef[] = [];
  // Phase 2G: one entry per ELIGIBLE placement (never per cell — see
  // RoomLiquidInteractionBlockDef's doc comment), covering ANY collision
  // preset (solid, one-way, or non-solid) — liquid interaction has no
  // solid-collision requirement, unlike wind transmission/contact damage.
  const customBlockLiquidInteraction: RoomLiquidInteractionBlockDef[] = [];
  // Phase 2G: cells already claimed by a registered liquid-interaction
  // placement, keyed by `yBlock * someLargeStride + xBlock`. Custom block
  // placements should not normally overlap, but this guards deterministically
  // against malformed/legacy data: a placement whose footprint overlaps an
  // already-claimed cell is simply not registered for liquid interaction
  // (its other properties are unaffected) — see "Overlapping liquid
  // modifiers" in CustomBlockSpriteSystem.md. This keeps the runtime mask's
  // single-byte-per-cell representation always unambiguous: every non-zero
  // mask cell belongs to exactly one placement, so a fragile placement's
  // destruction can always safely clear its own footprint without risking an
  // overlapping neighbor's still-active effect.
  const claimedLiquidCells = new Set<number>();
  const LIQUID_CELL_STRIDE = 1 << 16;
  // Phase 2H: one entry per ELIGIBLE placement (never per cell — see
  // RoomCustomBlockWindVentDef's doc comment), covering ANY collision preset
  // — wind emission has no solid-collision requirement, exactly like liquid
  // interaction. No overlap-rejection is needed here (unlike the liquid
  // mask): each vent is an independent point-source registration, not a
  // shared single-byte-per-cell mask, so two overlapping vent footprints
  // simply both emit independently with no ambiguity to resolve.
  const customBlockWindVents: RoomCustomBlockWindVentDef[] = [];
  // Phase 2B: monotonically increasing group id, unique per room, assigned
  // only to multi-cell (2x2) fragile placements so their cells can be broken
  // atomically as one logical unit (see src/sim/hazards.ts). 1x1 fragile
  // placements are pushed with no groupId — byte-identical to pre-Phase-2B
  // behavior.
  let nextBreakableGroupId = 0;
  // Phase 2D: separate monotonically increasing group id for multi-cell
  // (2x2) DAMAGING placements. Independent of nextBreakableGroupId — a
  // fragile+damaging 2x2 placement gets one id in each id space, since the
  // two arrays (customBlockBreakables / customBlockContactDamage) are never
  // compared against each other.
  let nextContactDamageGroupId = 0;
  for (const p of data.customBlockPlacements ?? []) {
    const rawId = rawIdFromNamespaced(p.blockId);
    const properties = rawId !== null ? getCustomBlockProperties(rawId) : undefined;
    const behavior = resolveWallBehavior(properties ?? {
      collision: 'solid', friction: 'default', breakability: 'indestructible', materialResponse: 'stone', contactDamage: 'none', breakResistance: 'standard', windResponse: 'passThrough', liquidInteraction: 'none', windEmission: 'none',
    });

    // Phase 2G: liquid interaction has NO solid-collision requirement, so it
    // must be registered BEFORE the `generateWall` early-continue below —
    // a non-solid custom block can be a pure liquid-only barrier/drain that
    // the player passes through freely. `registeredLiquidTier` (set only when
    // registration actually succeeds, i.e. no overlap) is reused below when
    // threading the tier onto this placement's breakable-block cells.
    let registeredLiquidTier: 'seal' | 'drain' | undefined;
    if (properties !== undefined && isEligibleForLiquidInteraction(properties)) {
      const tier = properties.liquidInteraction as 'seal' | 'drain'; // narrowed: isEligibleForLiquidInteraction excludes 'none'
      let overlaps = false;
      for (let dy = 0; dy < p.tileHeight && !overlaps; dy++) {
        for (let dx = 0; dx < p.tileWidth; dx++) {
          if (claimedLiquidCells.has((p.yBlock + dy) * LIQUID_CELL_STRIDE + (p.xBlock + dx))) { overlaps = true; break; }
        }
      }
      if (!overlaps) {
        for (let dy = 0; dy < p.tileHeight; dy++) {
          for (let dx = 0; dx < p.tileWidth; dx++) {
            claimedLiquidCells.add((p.yBlock + dy) * LIQUID_CELL_STRIDE + (p.xBlock + dx));
          }
        }
        customBlockLiquidInteraction.push({ xBlock: p.xBlock, yBlock: p.yBlock, wBlock: p.tileWidth, hBlock: p.tileHeight, tier });
        registeredLiquidTier = tier;
      }
    }

    // Phase 2H: wind emission has NO solid-collision requirement either, so
    // it must also be registered BEFORE the `generateWall` early-continue —
    // a non-solid custom block can be a purely visible vent the player walks
    // through. `registeredWindVentIndex` (the vent's position in
    // `customBlockWindVents`, i.e. its room-local runtime index) is reused
    // below when threading it onto this placement's breakable-block cells so
    // `destroyBreakableBlockCell` can deactivate the correct vent.
    let registeredWindVentIndex: number | undefined;
    if (properties !== undefined && isEligibleForWindVent(properties)) {
      const direction = properties.windEmission as 'left' | 'right' | 'up' | 'down'; // narrowed: isEligibleForWindVent excludes 'none'
      registeredWindVentIndex = customBlockWindVents.length;
      customBlockWindVents.push({ xBlock: p.xBlock, yBlock: p.yBlock, wBlock: p.tileWidth, hBlock: p.tileHeight, direction });
    }

    if (!behavior.generateWall) continue; // nonSolid — visual only, no collision wall.

    // Phase 2D: contact damage is orthogonal to breakability — a solid
    // placement may be fragile, indestructible, or both damaging and
    // fragile at once. Register it before branching on the breakable
    // pathway below so both branches (breakable cell / plain wall) get it.
    if (properties !== undefined && isEligibleForContactDamage(properties)) {
      const tier = properties.contactDamage as 'low' | 'high'; // narrowed: isEligibleForContactDamage excludes 'none'
      if (p.tileWidth === 1 && p.tileHeight === 1) {
        customBlockContactDamage.push({ xBlock: p.xBlock, yBlock: p.yBlock, tier });
      } else {
        const groupId = nextContactDamageGroupId++;
        for (let dy = 0; dy < p.tileHeight; dy++) {
          for (let dx = 0; dx < p.tileWidth; dx++) {
            customBlockContactDamage.push({ xBlock: p.xBlock + dx, yBlock: p.yBlock + dy, tier, groupId });
          }
        }
      }
    }

    // Phase 2F: wind transmission is orthogonal to both breakability and
    // contact damage — register it before branching on the breakable
    // pathway below so both branches (breakable cell / plain wall) get it.
    if (properties !== undefined && isEligibleForWindTransmission(properties)) {
      const tier = properties.windResponse as 'dampen' | 'block'; // narrowed: isEligibleForWindTransmission excludes 'passThrough'
      customBlockWindTransmission.push({ xBlock: p.xBlock, yBlock: p.yBlock, wBlock: p.tileWidth, hBlock: p.tileHeight, tier });
    }

    if (properties !== undefined && isEligibleForBreakablePathway(properties, p.tileWidth, p.tileHeight)) {
      // Reuse the existing breakable-block pathway wholesale: it creates its
      // own wall and tracks momentum-based destruction (see gameRoomHazards.ts).
      // For a multi-cell (2x2) placement, register EVERY occupied cell as its
      // own breakable-block entry (exactly like 4 independent 1x1 breakable
      // blocks would be authored) but tag them all with the same groupId so
      // the sim can destroy all 4 atomically when any one is struck.
      // Only pass an explicit blockTheme for 'ice' (slippery). Leaving it
      // undefined for the 'blackRock' (default friction) case preserves the
      // exact pre-Phase-2B wall theme sentinel (WALL_THEME_DEFAULT_INDEX,
      // "use the room's default theme") rather than forcing a concrete
      // blackRock index — a behavior change we don't want to introduce here.
      const breakableBlockTheme = behavior.blockTheme === 'ice' ? 'ice' as const : undefined;
      // Phase 2C: thread the resolved material-response preset onto every
      // cell of the placement so gameRoomHazards.ts can pack it into
      // world.breakableBlockMaterial without re-reading the custom block
      // registry at hazard-load time.
      const materialResponse = properties.materialResponse;
      // Phase 2E: same idea for the resolved break-resistance tier — every
      // cell of the placement carries the SAME tier, resolved once here.
      const breakResistance = properties.breakResistance;
      // Phase 2F: only set when this placement is ALSO wind-eligible — lets
      // destroyBreakableBlockCell (sim/hazards.ts) know to clear this cell's
      // native-pixel wind-mask region when the block breaks. undefined for
      // every fragile block that doesn't modify wind, identical to
      // pre-Phase-2F data.
      const windResponse = isEligibleForWindTransmission(properties) ? properties.windResponse as 'dampen' | 'block' : undefined;
      // Phase 2G: only set when this placement was ALSO registered above for
      // liquid interaction (i.e. it wasn't rejected as an overlap) — lets
      // destroyBreakableBlockCell (sim/hazards.ts) know to clear this cell's
      // native-pixel liquid-mask region when the block breaks.
      const liquidInteraction = registeredLiquidTier;
      // Phase 2H: only set when this placement was ALSO registered above for
      // wind emission — lets destroyBreakableBlockCell (sim/hazards.ts)
      // deactivate the correct room-local vent index when the block breaks.
      const windVentIndex = registeredWindVentIndex;
      if (p.tileWidth === 1 && p.tileHeight === 1) {
        customBlockBreakables.push({
          xBlock: p.xBlock, yBlock: p.yBlock, blockTheme: breakableBlockTheme, materialResponse, breakResistance, windResponse, liquidInteraction, windVentIndex,
        });
      } else {
        const groupId = nextBreakableGroupId++;
        for (let dy = 0; dy < p.tileHeight; dy++) {
          for (let dx = 0; dx < p.tileWidth; dx++) {
            customBlockBreakables.push({
              xBlock: p.xBlock + dx,
              yBlock: p.yBlock + dy,
              groupId,
              blockTheme: breakableBlockTheme,
              materialResponse,
              breakResistance,
              windResponse,
              liquidInteraction,
              windVentIndex,
            });
          }
        }
      }
      continue;
    }

    customBlockWalls.push({
      xBlock: p.xBlock,
      yBlock: p.yBlock,
      wBlock: p.tileWidth,
      hBlock: p.tileHeight,
      isPlatformFlag: behavior.isPlatformFlag,
      platformEdge: behavior.isPlatformFlag === 1 ? behavior.platformEdge : undefined,
      blockTheme: behavior.blockTheme,
    });
  }

  const allWalls: RoomWallDef[] = [...boundaryWalls, ...interiorWalls, ...customBlockWalls];

  const enemies: RoomEnemyDef[] = data.enemies.map(e => {
    const kinds: ParticleKind[] = [];
    for (const name of e.kinds) {
      const k = stringToParticleKind(name);
      if (k !== null) kinds.push(k);
    }
    if (kinds.length === 0) kinds.push(ParticleKind.Physical);
    return {
      xBlock: e.xBlock,
      yBlock: e.yBlock,
      kinds,
      particleCount: e.particleCount,
      isBossFlag: e.isBossFlag,
      isFlyingEyeFlag: e.isFlyingEyeFlag,
      isRollingEnemyFlag: e.isRollingEnemyFlag,
      rollingEnemySpriteIndex: e.rollingEnemySpriteIndex,
      isRockElementalFlag: e.isRockElementalFlag,
      isRadiantTetherFlag: e.isRadiantTetherFlag,
      isRadiantWebFlag: e.isRadiantWebFlag,
      isCrimsonWizardFlag: e.isCrimsonWizardFlag ?? 0,
      isHeraldFlag: e.isHeraldFlag ?? 0,
      isGrappleHunterFlag: e.isGrappleHunterFlag,
      isSlimeFlag: e.isSlimeFlag,
      isLargeSlimeFlag: e.isLargeSlimeFlag,
      isWheelEnemyFlag: e.isWheelEnemyFlag,
      isBeetleFlag: e.isBeetleFlag,
      isBubbleEnemyFlag: e.isBubbleEnemyFlag,
      isIceBubbleFlag: e.isIceBubbleFlag,
      isSquareStampedeFlag: e.isSquareStampedeFlag,
      isGoldenMimicFlag: e.isGoldenMimicFlag ?? 0,
      isGoldenMimicYFlippedFlag: e.isGoldenMimicYFlippedFlag ?? 0,
      isBeeSwarmFlag: e.isBeeSwarmFlag ?? 0,
      isWebSpiderFlag: e.isWebSpiderFlag ?? 0,
      isDustConstellationFlag: e.isDustConstellationFlag ?? 0,
      isDustConstellationLargeFlag: e.isDustConstellationLargeFlag ?? 0,
      isOrbitalDustCoreFlag: e.isOrbitalDustCoreFlag ?? 0,
      isOrbitalDustCoreLargeFlag: e.isOrbitalDustCoreLargeFlag ?? 0,
      isDustLeechFlag:       e.isDustLeechFlag       ?? 0,
      isGridBlockEnemyFlag:  e.isGridBlockEnemyFlag  ?? 0,
      isMomentumTurretFlag: e.isMomentumTurretFlag ?? 0,
      momentumTurretFacingIndex: e.momentumTurretFacingIndex ?? 0,
      gridBlockSizeIndex:    e.gridBlockSizeIndex     ?? 0,
      gridBlockSpeedIndex:   e.gridBlockSpeedIndex    ?? 0,
      isGridSnakeEnemyFlag:  e.isGridSnakeEnemyFlag   ?? 0,
      gridSnakeLength:       e.gridSnakeLength        ?? 4,
    };
  });

  const transitions: RoomTransitionDef[] = data.transitions.map(t => ({
    direction: t.direction,
    targetRoomId: t.targetRoomId,
    xBlock: t.xBlock,
    yBlock: t.yBlock,
    positionBlock: t.positionBlock,
    openingSizeBlocks: t.openingSizeBlocks,
    targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as readonly [number, number],
    fadeColor: t.fadeColor,
    depthBlock: t.depthBlock,
    isSecretDoor: t.isSecretDoor,
    gradientWidthBlocks: t.gradientWidthBlocks,
    longTransition: t.longTransition,
  }));

  return {
    id: data.id,
    name: data.name,
    worldNumber: data.worldNumber,
    mapX: data.mapX,
    mapY: data.mapY,
    blockTheme: data.blockTheme,
    backgroundId: data.backgroundId,
    lightingEffect: data.lightingEffect,
    songId: data.songId !== '_continue' ? data.songId : undefined,
    widthBlocks: data.widthBlocks,
    heightBlocks: data.heightBlocks,
    walls: allWalls,
    breakableBlocks: customBlockBreakables.length > 0 ? customBlockBreakables : undefined,
    contactDamageBlocks: customBlockContactDamage.length > 0 ? customBlockContactDamage : undefined,
    windTransmissionBlocks: customBlockWindTransmission.length > 0 ? customBlockWindTransmission : undefined,
    liquidInteractionBlocks: customBlockLiquidInteraction.length > 0 ? customBlockLiquidInteraction : undefined,
    windVentBlocks: customBlockWindVents.length > 0 ? customBlockWindVents : undefined,
    enemies,
    playerSpawnBlock: [data.playerSpawnBlock[0], data.playerSpawnBlock[1]],
    transitions,
    saveTombs: data.saveTombs.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock })),
    skillTombs: data.skillTombs.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock, weaveId: s.weaveId })),
    challengeFields: (data.challengeFields ?? []).map(element => ({ ...element })),
    challengeGates: (data.challengeGates ?? []).map(element => ({ ...element })),
    challengeTotems: (data.challengeTotems ?? []).map(element => ({ ...element })),
    gates: (data.gates ?? []).map(gate => ({ ...gate })),
    dustContainers: (data.dustContainers ?? []).map(c => ({ xBlock: c.xBlock, yBlock: c.yBlock })),
    dustContainerPieces: (data.dustContainerPieces ?? []).map(c => ({ xBlock: c.xBlock, yBlock: c.yBlock })),
    customBlockPlacements: (data.customBlockPlacements ?? []).length > 0
      ? (data.customBlockPlacements ?? []).map(p =>
          [p.xBlock, p.yBlock, p.blockId, p.tileWidth, p.tileHeight] as [number, number, string, number, number],
        )
      : undefined,
    dustBoostJars: (data.dustBoostJars ?? []).map(j => {
      const kind = stringToParticleKind(j.dustKind);
      return {
        xBlock: j.xBlock,
        yBlock: j.yBlock,
        dustKind: kind !== null ? kind : 0,
        dustCount: j.dustCount,
      };
    }),
    dustSwarms: (data.dustSwarms ?? []).map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
      dustKind: s.dustKind,
      dustCount: s.dustCount,
    })),
    lambdaAnchors: (data.lambdaAnchors ?? []).map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
    })),
    dustPiles: data.dustPiles.map(p => ({ xBlock: p.xBlock, yBlock: p.yBlock, dustCount: p.dustCount, spreadBlocks: p.spreadBlocks ?? 0 })),
    pixelMaterials: (data.pixelMaterials ?? []).map(p => ({ xPixel: p.xPixel, yPixel: p.yPixel, material: p.material })),
    grasshopperAreas: data.grasshopperAreas.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
      wBlock: a.wBlock,
      hBlock: a.hBlock,
      count: a.count,
    })),
    fireflyAreas: data.fireflyAreas.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
      wBlock: a.wBlock,
      hBlock: a.hBlock,
      count: a.count,
    })),
    decorations: (data.decorations ?? []).map(d => ({
      xBlock: d.xBlock,
      yBlock: d.yBlock,
      kind: d.kind,
    })),
    ambientLightDirection: data.ambientLightDirection,
    directionalBias:       data.directionalBias,
    sideExposureStrength:  data.sideExposureStrength,
    minimumWallLight:      data.minimumWallLight,
    falloffPower:          data.falloffPower,
    sunrays:               data.sunrays,
    backgroundLightSpill:  data.backgroundLightSpill,
    solidLightSoftness:    data.solidLightSoftness,
    sunrays:               data.sunrays,
    ambientLightBlockers: (data.ambientLightBlockers ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      isDark: b.isDarkFlag === 1,
    })),
    lightSources: (data.lightSources ?? []).map(l => ({
      xBlock: l.xBlock,
      yBlock: l.yBlock,
      radiusBlocks: l.radiusBlocks,
      colorR: l.colorR,
      colorG: l.colorG,
      colorB: l.colorB,
      brightnessPct: l.brightnessPct,
      dustMoteCount: l.dustMoteCount ?? 0,
      dustMoteSpreadBlocks: l.dustMoteSpreadBlocks ?? 0,
    })),
    sunbeams: (data.sunbeams ?? []).map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
      angleRad: s.angleRad,
      widthBlocks: s.widthBlocks,
      lengthBlocks: s.lengthBlocks,
      colorR: s.colorR,
      colorG: s.colorG,
      colorB: s.colorB,
      intensityPct: s.intensityPct,
    })),
    waterZones: (data.waterZones ?? []).map(z => ({
      xBlock: z.xBlock,
      yBlock: z.yBlock,
      wBlock: z.wBlock,
      hBlock: z.hBlock,
    })),
    lavaZones: (data.lavaZones ?? []).map(z => ({
      xBlock: z.xBlock,
      yBlock: z.yBlock,
      wBlock: z.wBlock,
      hBlock: z.hBlock,
    })),
    crumbleBlocks: (data.crumbleBlocks ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      wBlock: b.wBlock !== 1 ? b.wBlock : undefined,
      hBlock: b.hBlock !== 1 ? b.hBlock : undefined,
      rampOrientation: b.rampOrientation,
      variant: b.variant !== 'normal' ? b.variant : undefined,
      blockTheme: b.blockTheme,
    })),
    spikes: (data.spikes ?? []).map(sp => ({
      xBlock: sp.xBlock,
      yBlock: sp.yBlock,
      direction: sp.direction,
      size: sp.size !== '1x1' ? sp.size : undefined,
      blockTheme: sp.blockTheme,
    })),
    bouncePads: (data.bouncePads ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      wBlock: b.wBlock !== 1 ? b.wBlock : undefined,
      hBlock: b.hBlock !== 1 ? b.hBlock : undefined,
      rampOrientation: b.rampOrientation,
      speedFactorIndex: b.speedFactorIndex !== 0 ? b.speedFactorIndex : undefined,
    })),
    kineticBlocks: (data.kineticBlocks ?? []).map(kb => ({
      xBlock: kb.xBlock,
      yBlock: kb.yBlock,
      wBlock: kb.wBlock !== 1 ? kb.wBlock : undefined,
      hBlock: kb.hBlock !== 1 ? kb.hBlock : undefined,
    })),
    grappleCarryBlocks: (data.grappleCarryBlocks ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
    })),
    zipMoveBlocks: (data.zipMoveBlocks ?? []).map(b => ({
      ...b,
      wBlock: Math.max(3, Number.isFinite(b.wBlock) ? Math.floor(b.wBlock) : 3),
      hBlock: Math.max(3, Number.isFinite(b.hBlock) ? Math.floor(b.hBlock) : 3),
      variant: b.variant === 'away' ? 'away' as const : 'toward' as const,
    })),
    phantasmalTiles: (data.phantasmalTiles ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
    })),
    ropes: (data.ropes ?? []).map(r => ({
      anchorAXBlock: r.anchorAXBlock,
      anchorAYBlock: r.anchorAYBlock,
      anchorBXBlock: r.anchorBXBlock,
      anchorBYBlock: r.anchorBYBlock,
      segmentCount: r.segmentCount,
      isAnchorBFixed: r.isAnchorBFixedFlag === 1,
      destructibility: r.destructibility,
      thicknessIndex: r.thicknessIndex,
    })),
    fallingBlocks: (data.fallingBlocks ?? []).map(fb => ({
      xBlock: fb.xBlock,
      yBlock: fb.yBlock,
      variant: fb.variant,
    })),
    backgroundBlocks: (data.backgroundBlocks ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      wBlock: b.wBlock,
      hBlock: b.hBlock,
      blockTheme: b.blockTheme,
      isLightBlockingFlag: b.isLightBlockingFlag,
    })),
    dialogueTriggers: (data.dialogueTriggers ?? []).map(dt => ({
      xBlock: dt.xBlock,
      yBlock: dt.yBlock,
      wBlock: dt.wBlock,
      hBlock: dt.hBlock,
      conversation: {
        id: dt.conversationId,
        title: dt.conversationTitle || undefined,
        entries: dt.entries.map(e => ({
          text: e.text,
          portraitId: e.portraitId,
          portraitSide: e.portraitSide,
        })),
      },
    })),
    sceneLights: (data.sceneLights ?? []).map(s => {
      const { uid, ...lightDef } = s;
      void uid;
      return lightDef as import('../levels/lightingSchema').LightDef;
    }),
    guideDustPaths: (data.guideDustPaths ?? []).map(p => ({
      points: p.points.map(pt => ({ xBlock: pt.xBlock, yBlock: pt.yBlock, speed: pt.speed ?? 1.0 })),
      loop: p.loop,
      visibleInGame: p.visibleInGame,
      moteCount: p.moteCount,
      moteSpeedFactor: p.moteSpeedFactor,
      opacityPct: p.opacityPct,
    })),
    blockSeamBlending: data.blockSeamBlending,
    voidEdgeStyle: data.voidEdgeStyle,
  };
}
