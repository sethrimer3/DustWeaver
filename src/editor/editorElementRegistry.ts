/**
 * editorElementRegistry.ts — declarative per-element-type adapter registry.
 *
 * Phase 3: a single typed table (`ELEMENT_ADAPTERS`) describing, for every
 * `SelectedElementType`, how to enumerate its instances, derive a stable uid,
 * point-hit-test it, and rect/marquee-test it. Three systems are migrated to
 * read from this table instead of maintaining their own hand-written
 * per-type traversal:
 *
 *   1. Point candidate collection / priority ordering (editorTools.ts's
 *      `walkHitCandidatesAnyLayer`) — click hit testing.
 *   2. Marquee selection (editorTools.ts's `getAllElementsInRect`).
 *   3. Selection-layer derivation (editorLayers.ts's
 *      `getSelectedElementLayers`) already derives purely from
 *      `getLayerForElementType`, which stays the source of truth for layer
 *      mapping — the registry's `layerId` field is kept in sync with it via
 *      an exhaustiveness test rather than duplicating the mapping.
 *
 * Deliberately NOT migrated (out of scope for Phase 3): property editing,
 * movement, deletion, rendering, persistence/hydration. Those keep their own
 * per-type switches.
 *
 * `ELEMENT_ADAPTERS` is typed as `Record<SelectedElementType, ...>` — every
 * key of the `SelectedElementType` union MUST have an entry, so adding a new
 * element type without adding an adapter here is a compile-time error
 * (missing property on a `Record` with an exhaustive key type).
 */

import type { EditorState } from './editorState';
import type { EditorRoomData, SelectedElementType } from './editorElementTypes';
import { getLayerForElementType, type LayerId } from './editorLayers';
import { hitTestZone, hitTestWall, hitTestPoint, hitTestTransition, hitTestTransitionRect } from './editorHitTest';
import { BLOCK_SIZE_MEDIUM, BLOCK_SIZE_SMALL } from '../levels/roomDef';

// ── Shared geometry types ─────────────────────────────────────────────────

/** An axis-aligned marquee-selection rectangle, in BLOCK coordinates, inclusive on all four sides. */
export interface MarqueeRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Optional extra data surfaced for path-like elements (ropes, guide dust paths). */
export interface GuideMetadata {
  points: readonly { xBlock: number; yBlock: number }[];
  loop: boolean;
}

/**
 * Declarative description of one `SelectedElementType`'s enumerate/identify/
 * hit-test/marquee-test behavior. `T` is the element's own editor room-data
 * shape (e.g. `EditorWall`, `EditorEnemy`, ...).
 */
export interface EditorElementAdapter<T> {
  elementType: SelectedElementType;
  layerId: LayerId;
  /** Lists every instance of this type currently present. No allocation of new uids. */
  enumerate: (state: EditorState, room: EditorRoomData) => readonly T[];
  /** Stable uid for the element — never allocates. */
  uid: (element: T) => number;
  /** Point (single-cell click) hit test, in BLOCK coordinates. */
  hitTest: (element: T, bx: number, by: number, room: EditorRoomData) => boolean;
  /** Rect/marquee intersection test, in BLOCK coordinates. */
  marqueeTest: (element: T, rect: MarqueeRect, room: EditorRoomData) => boolean;
  /** Present only for path-like elements (ropes, guide dust paths). */
  guideMetadata?: (element: T) => GuideMetadata | null;
}

// ── Geometry helpers ───────────────────────────────────────────────────────

function rectIntersectsMarquee(x: number, y: number, w: number, h: number, r: MarqueeRect): boolean {
  return x + w > r.minX && x < r.maxX + 1 && y + h > r.minY && y < r.maxY + 1;
}

function pointInMarquee(x: number, y: number, r: MarqueeRect): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

function boundingRectOfPoints(points: readonly { xBlock: number; yBlock: number }[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.xBlock < minX) minX = p.xBlock;
    if (p.yBlock < minY) minY = p.yBlock;
    if (p.xBlock > maxX) maxX = p.xBlock;
    if (p.yBlock > maxY) maxY = p.yBlock;
  }
  return { minX, minY, maxX, maxY };
}

function rectsOverlap(
  aMinX: number, aMinY: number, aMaxX: number, aMaxY: number,
  r: MarqueeRect,
): boolean {
  return aMaxX >= r.minX && aMinX <= r.maxX + 1 && aMaxY >= r.minY && aMinY <= r.maxY + 1;
}

// ── Generic adapter factories ─────────────────────────────────────────────

interface Uided { uid: number }
interface Pointy extends Uided { xBlock: number; yBlock: number }
interface Zoney extends Uided { xBlock: number; yBlock: number; wBlock: number; hBlock: number }

function pointAdapter<T extends Pointy>(
  elementType: SelectedElementType,
  layerId: LayerId,
  enumerate: (state: EditorState, room: EditorRoomData) => readonly T[],
): EditorElementAdapter<T> {
  return {
    elementType,
    layerId,
    enumerate,
    uid: el => el.uid,
    hitTest: (el, bx, by) => hitTestPoint(el.xBlock, el.yBlock, bx, by),
    marqueeTest: (el, r) => pointInMarquee(el.xBlock, el.yBlock, r),
  };
}

function zoneAdapter<T extends Zoney>(
  elementType: SelectedElementType,
  layerId: LayerId,
  enumerate: (state: EditorState, room: EditorRoomData) => readonly T[],
): EditorElementAdapter<T> {
  return {
    elementType,
    layerId,
    enumerate,
    uid: el => el.uid,
    hitTest: (el, bx, by) => hitTestZone(el, bx, by),
    marqueeTest: (el, r) => rectIntersectsMarquee(el.xBlock, el.yBlock, el.wBlock, el.hBlock, r),
  };
}

// ── Per-type adapters ──────────────────────────────────────────────────────
//
// Imported lazily via a getter function to avoid a circular import with
// editorState.ts (which re-exports element type aliases this module doesn't
// need at the type level, but whose concrete .ts module also pulls in
// editorLayers.ts — importing only `type`s above keeps this side effect-free).

import type {
  EditorWall, EditorEnemy, EditorTransition, EditorSaveTomb, EditorSkillTomb,
  EditorChallengeRect, EditorChallengeTotem, EditorGate, EditorDustContainer,
  EditorDustContainerPiece, EditorDustBoostJar, EditorDustSwarm, EditorLambdaAnchor,
  EditorDustPile, EditorGrasshopperArea, EditorFireflyArea, EditorDecoration,
  EditorAmbientLightBlocker, EditorLightSource, EditorWaterZone, EditorLavaZone,
  EditorTimeStopField, EditorCrumbleBlock, EditorSpike, EditorBouncePad,
  EditorKineticBlock, EditorGrappleCarryBlock, EditorZipMoveBlock, EditorPhantasmalTile,
  EditorPixelMaterial, EditorRope, EditorSunbeam, EditorSceneLight, EditorFallingBlock,
  EditorDialogueTrigger, EditorBackgroundBlock, EditorGuideDustPath, EditorCustomBlockPlacement,
  EditorFireflyJar, EditorSpringboard, EditorBreakableBlock,
} from './editorElementTypes';

const wallAdapter: EditorElementAdapter<EditorWall> = {
  elementType: 'wall',
  layerId: getLayerForElementType('wall'),
  enumerate: (_s, room) => room.interiorWalls,
  uid: w => w.uid,
  hitTest: (w, bx, by) => hitTestWall(w, bx, by),
  marqueeTest: (w, r) => rectIntersectsMarquee(w.xBlock, w.yBlock, w.wBlock, w.hBlock, r),
};

const enemyAdapter: EditorElementAdapter<EditorEnemy> = pointAdapter('enemy', getLayerForElementType('enemy'), (_s, room) => room.enemies);

const transitionAdapter: EditorElementAdapter<EditorTransition> = {
  elementType: 'transition',
  layerId: getLayerForElementType('transition'),
  enumerate: (_s, room) => room.transitions,
  uid: t => t.uid,
  hitTest: (t, bx, by, room) => hitTestTransition(t, bx, by, room),
  marqueeTest: (t, r, room) => hitTestTransitionRect(t, r.minX, r.minY, r.maxX, r.maxY, room),
};

const saveTombAdapter = pointAdapter<EditorSaveTomb>('saveTomb', getLayerForElementType('saveTomb'), (_s, room) => room.saveTombs);
const skillTombAdapter = pointAdapter<EditorSkillTomb>('skillTomb', getLayerForElementType('skillTomb'), (_s, room) => room.skillTombs);
const challengeFieldAdapter = zoneAdapter<EditorChallengeRect>('challengeField', getLayerForElementType('challengeField'), (_s, room) => room.challengeFields ?? []);
const challengeGateAdapter = zoneAdapter<EditorChallengeRect>('challengeGate', getLayerForElementType('challengeGate'), (_s, room) => room.challengeGates ?? []);
const gateAdapter = zoneAdapter<EditorGate>('gate', getLayerForElementType('gate'), (_s, room) => room.gates ?? []);
const challengeTotemAdapter = pointAdapter<EditorChallengeTotem>('challengeTotem', getLayerForElementType('challengeTotem'), (_s, room) => room.challengeTotems ?? []);
const dustContainerAdapter = pointAdapter<EditorDustContainer>('dustContainer', getLayerForElementType('dustContainer'), (_s, room) => room.dustContainers ?? []);
const dustContainerPieceAdapter = pointAdapter<EditorDustContainerPiece>('dustContainerPiece', getLayerForElementType('dustContainerPiece'), (_s, room) => room.dustContainerPieces ?? []);
const dustBoostJarAdapter = pointAdapter<EditorDustBoostJar>('dustBoostJar', getLayerForElementType('dustBoostJar'), (_s, room) => room.dustBoostJars ?? []);
const dustSwarmAdapter = pointAdapter<EditorDustSwarm>('dustSwarm', getLayerForElementType('dustSwarm'), (_s, room) => room.dustSwarms ?? []);
const lambdaAnchorAdapter = pointAdapter<EditorLambdaAnchor>('lambdaAnchor', getLayerForElementType('lambdaAnchor'), (_s, room) => room.lambdaAnchors ?? []);
const dustPileAdapter = pointAdapter<EditorDustPile>('dustPile', getLayerForElementType('dustPile'), (_s, room) => room.dustPiles);
const grasshopperAreaAdapter = zoneAdapter<EditorGrasshopperArea>('grasshopperArea', getLayerForElementType('grasshopperArea'), (_s, room) => room.grasshopperAreas);
const fireflyAreaAdapter = zoneAdapter<EditorFireflyArea>('fireflyArea', getLayerForElementType('fireflyArea'), (_s, room) => room.fireflyAreas ?? []);
const decorationAdapter = pointAdapter<EditorDecoration>('decoration', getLayerForElementType('decoration'), (_s, room) => room.decorations ?? []);

const ambientLightBlockerAdapter: EditorElementAdapter<EditorAmbientLightBlocker> = {
  elementType: 'ambientLightBlocker',
  layerId: getLayerForElementType('ambientLightBlocker'),
  enumerate: (_s, room) => room.ambientLightBlockers ?? [],
  uid: b => b.uid,
  hitTest: (b, bx, by) => b.xBlock === Math.floor(bx) && b.yBlock === Math.floor(by),
  marqueeTest: (b, r) => pointInMarquee(b.xBlock, b.yBlock, r),
};

const lightSourceAdapter = pointAdapter<EditorLightSource>('lightSource', getLayerForElementType('lightSource'), (_s, room) => room.lightSources ?? []);
const waterZoneAdapter = zoneAdapter<EditorWaterZone>('waterZone', getLayerForElementType('waterZone'), (_s, room) => room.waterZones ?? []);
const lavaZoneAdapter = zoneAdapter<EditorLavaZone>('lavaZone', getLayerForElementType('lavaZone'), (_s, room) => room.lavaZones ?? []);
const timeStopFieldAdapter = zoneAdapter<EditorTimeStopField>('timeStopField', getLayerForElementType('timeStopField'), (_s, room) => room.timeStopFields ?? []);

const crumbleBlockAdapter: EditorElementAdapter<EditorCrumbleBlock> = {
  elementType: 'crumbleBlock',
  layerId: getLayerForElementType('crumbleBlock'),
  enumerate: (_s, room) => room.crumbleBlocks ?? [],
  uid: b => b.uid,
  hitTest: (b, bx, by) => hitTestPoint(b.xBlock, b.yBlock, bx, by),
  marqueeTest: (b, r) => rectIntersectsMarquee(b.xBlock, b.yBlock, b.wBlock ?? 1, b.hBlock ?? 1, r),
};

const spikeAdapter: EditorElementAdapter<EditorSpike> = {
  elementType: 'spike',
  layerId: getLayerForElementType('spike'),
  enumerate: (_s, room) => room.spikes ?? [],
  uid: sp => sp.uid,
  hitTest: (sp, bx, by) => {
    const size = sp.size === '2x2' ? 2 : 1;
    return hitTestZone({ xBlock: sp.xBlock, yBlock: sp.yBlock, wBlock: size, hBlock: size }, bx, by);
  },
  marqueeTest: (sp, r) => {
    const size = sp.size === '2x2' ? 2 : 1;
    return rectIntersectsMarquee(sp.xBlock, sp.yBlock, size, size, r);
  },
};

const bouncePadAdapter = zoneAdapter<EditorBouncePad>('bouncePad', getLayerForElementType('bouncePad'), (_s, room) => room.bouncePads ?? []);
const kineticBlockAdapter = zoneAdapter<EditorKineticBlock>('kineticBlock', getLayerForElementType('kineticBlock'), (_s, room) => room.kineticBlocks ?? []);
const grappleCarryBlockAdapter = pointAdapter<EditorGrappleCarryBlock>('grappleCarryBlock', getLayerForElementType('grappleCarryBlock'), (_s, room) => room.grappleCarryBlocks ?? []);
const zipMoveBlockAdapter = zoneAdapter<EditorZipMoveBlock>('zipMoveBlock', getLayerForElementType('zipMoveBlock'), (_s, room) => room.zipMoveBlocks ?? []);
const phantasmalTileAdapter = pointAdapter<EditorPhantasmalTile>('phantasmalTile', getLayerForElementType('phantasmalTile'), (_s, room) => room.phantasmalTiles ?? []);

const pixelMaterialAdapter: EditorElementAdapter<EditorPixelMaterial> = {
  elementType: 'pixelMaterial',
  layerId: getLayerForElementType('pixelMaterial'),
  enumerate: (_s, room) => room.pixelMaterials ?? [],
  uid: p => p.uid,
  // Pixel materials live in native-PIXEL space, not block space — convert the
  // incoming block cell to its covering pixel cell for the test.
  hitTest: (p, bx, by) => {
    const x0 = Math.floor(bx) * BLOCK_SIZE_SMALL;
    const y0 = Math.floor(by) * BLOCK_SIZE_SMALL;
    return p.xPixel >= x0 && p.xPixel < x0 + BLOCK_SIZE_SMALL && p.yPixel >= y0 && p.yPixel < y0 + BLOCK_SIZE_SMALL;
  },
  marqueeTest: (p, r) => {
    const minXPx = r.minX * BLOCK_SIZE_SMALL;
    const minYPx = r.minY * BLOCK_SIZE_SMALL;
    const maxXPx = (r.maxX + 1) * BLOCK_SIZE_SMALL;
    const maxYPx = (r.maxY + 1) * BLOCK_SIZE_SMALL;
    return p.xPixel >= minXPx && p.xPixel < maxXPx && p.yPixel >= minYPx && p.yPixel < maxYPx;
  },
};

const ropeAdapter: EditorElementAdapter<EditorRope> = {
  elementType: 'rope',
  layerId: getLayerForElementType('rope'),
  enumerate: (_s, room) => room.ropes ?? [],
  uid: rp => rp.uid,
  // Ropes are grabbed by their endpoint anchors elsewhere (hitTestRopeAnchor);
  // for the generic point-click table, treat a click as a hit if it lands
  // within tolerance of either anchor.
  hitTest: (rp, bx, by) => {
    const tol = 0.8;
    const da = Math.hypot(rp.anchorAXBlock - bx, rp.anchorAYBlock - by);
    const db = Math.hypot(rp.anchorBXBlock - bx, rp.anchorBYBlock - by);
    return da <= tol || db <= tol;
  },
  // Rope marquee selection: intersect with the bounding rect of both anchor
  // points (a straight 2-point "path"), per the "bounding rect of control
  // points" geometry rule for paths.
  marqueeTest: (rp, r) => {
    const minX = Math.min(rp.anchorAXBlock, rp.anchorBXBlock);
    const maxX = Math.max(rp.anchorAXBlock, rp.anchorBXBlock);
    const minY = Math.min(rp.anchorAYBlock, rp.anchorBYBlock);
    const maxY = Math.max(rp.anchorAYBlock, rp.anchorBYBlock);
    return rectsOverlap(minX, minY, maxX, maxY, r);
  },
  guideMetadata: rp => ({
    points: [
      { xBlock: rp.anchorAXBlock, yBlock: rp.anchorAYBlock },
      { xBlock: rp.anchorBXBlock, yBlock: rp.anchorBYBlock },
    ],
    loop: false,
  }),
};

const sunbeamAdapter = pointAdapter<EditorSunbeam>('sunbeam', getLayerForElementType('sunbeam'), (_s, room) => room.sunbeams ?? []);

const sceneLightAdapter: EditorElementAdapter<EditorSceneLight> = {
  elementType: 'sceneLight',
  layerId: getLayerForElementType('sceneLight'),
  enumerate: (_s, room) => room.sceneLights ?? [],
  uid: sl => sl.uid,
  hitTest: (sl, bx, by) => hitTestPoint(sl.xWorld / BLOCK_SIZE_MEDIUM, sl.yWorld / BLOCK_SIZE_MEDIUM, bx, by),
  marqueeTest: (sl, r) => pointInMarquee(sl.xWorld / BLOCK_SIZE_MEDIUM, sl.yWorld / BLOCK_SIZE_MEDIUM, r),
};

const fallingBlockAdapter = pointAdapter<EditorFallingBlock>('fallingBlock', getLayerForElementType('fallingBlock'), (_s, room) => room.fallingBlocks ?? []);

const dialogueTriggerAdapter = zoneAdapter<EditorDialogueTrigger>('dialogueTrigger', getLayerForElementType('dialogueTrigger'), (_s, room) => room.dialogueTriggers ?? []);
const backgroundBlockAdapter = zoneAdapter<EditorBackgroundBlock>('backgroundBlock', getLayerForElementType('backgroundBlock'), (_s, room) => room.backgroundBlocks ?? []);

const guideDustPathAdapter: EditorElementAdapter<EditorGuideDustPath> = {
  elementType: 'guideDustPath',
  layerId: getLayerForElementType('guideDustPath'),
  enumerate: (_s, room) => room.guideDustPaths ?? [],
  uid: p => p.uid,
  // Click hit-testing for guide dust paths also needs the matched control-
  // point index (see editorTools.ts's `walkHitCandidatesAnyLayer`), which
  // doesn't fit this boolean signature — that lookup stays special-cased in
  // editorTools.ts. This hitTest (hit if the cursor is near ANY point) is
  // still correct and used by the exhaustiveness/registry-parity tests.
  hitTest: (p, bx, by) => p.points.some(pt => Math.hypot(pt.xBlock - bx, pt.yBlock - by) <= 1.5),
  marqueeTest: (p, r) => {
    if (p.points.length === 0) return false;
    const b = boundingRectOfPoints(p.points);
    return rectsOverlap(b.minX, b.minY, b.maxX, b.maxY, r);
  },
  guideMetadata: p => ({ points: p.points, loop: p.loop }),
};

const customBlockAdapter: EditorElementAdapter<EditorCustomBlockPlacement> = {
  elementType: 'customBlock',
  layerId: getLayerForElementType('customBlock'),
  enumerate: (_s, room) => room.customBlockPlacements ?? [],
  uid: p => p.uid,
  hitTest: (p, bx, by) => bx >= p.xBlock && bx < p.xBlock + p.tileWidth && by >= p.yBlock && by < p.yBlock + p.tileHeight,
  marqueeTest: (p, r) => rectIntersectsMarquee(p.xBlock, p.yBlock, p.tileWidth, p.tileHeight, r),
};

const fireflyJarAdapter = pointAdapter<EditorFireflyJar>('fireflyJar', getLayerForElementType('fireflyJar'), (_s, room) => room.fireflyJars ?? []);
const springboardAdapter = pointAdapter<EditorSpringboard>('springboard', getLayerForElementType('springboard'), (_s, room) => room.springboards ?? []);
const breakableBlockAdapter = pointAdapter<EditorBreakableBlock>('breakableBlock', getLayerForElementType('breakableBlock'), (_s, room) => room.breakableBlocks ?? []);

/** Synthetic single-element wrapper used for the two singleton "spawn" element types. */
interface SpawnPoint { xBlock: number; yBlock: number }

const playerSpawnAdapter: EditorElementAdapter<SpawnPoint> = {
  elementType: 'playerSpawn',
  layerId: getLayerForElementType('playerSpawn'),
  enumerate: (_s, room) => [{ xBlock: room.playerSpawnBlock[0], yBlock: room.playerSpawnBlock[1] }],
  uid: () => 0,
  hitTest: (p, bx, by) => hitTestPoint(p.xBlock, p.yBlock, bx, by),
  marqueeTest: (p, r) => pointInMarquee(p.xBlock, p.yBlock, r),
};

const campaignSpawnAdapter: EditorElementAdapter<SpawnPoint> = {
  elementType: 'campaignSpawn',
  layerId: getLayerForElementType('campaignSpawn'),
  enumerate: (state, _room) => state.campaignSpawnBlock === null
    ? []
    : [{ xBlock: state.campaignSpawnBlock[0], yBlock: state.campaignSpawnBlock[1] }],
  uid: () => 0,
  hitTest: (p, bx, by) => hitTestPoint(p.xBlock, p.yBlock, bx, by),
  marqueeTest: (p, r) => pointInMarquee(p.xBlock, p.yBlock, r),
};

// ── The registry ───────────────────────────────────────────────────────────

/**
 * Exhaustive `SelectedElementType → adapter` table. Because this is typed as
 * `Record<SelectedElementType, ...>`, omitting a case for any member of the
 * `SelectedElementType` union (including a newly-added one) is a compile
 * error — this is the "compile-time exhaustiveness" the registry exists to
 * guarantee.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ELEMENT_ADAPTERS: { readonly [K in SelectedElementType]: EditorElementAdapter<any> } = {
  wall: wallAdapter,
  enemy: enemyAdapter,
  transition: transitionAdapter,
  saveTomb: saveTombAdapter,
  skillTomb: skillTombAdapter,
  challengeField: challengeFieldAdapter,
  challengeGate: challengeGateAdapter,
  gate: gateAdapter,
  challengeTotem: challengeTotemAdapter,
  dustContainer: dustContainerAdapter,
  dustContainerPiece: dustContainerPieceAdapter,
  dustBoostJar: dustBoostJarAdapter,
  dustSwarm: dustSwarmAdapter,
  lambdaAnchor: lambdaAnchorAdapter,
  dustPile: dustPileAdapter,
  grasshopperArea: grasshopperAreaAdapter,
  fireflyArea: fireflyAreaAdapter,
  decoration: decorationAdapter,
  playerSpawn: playerSpawnAdapter,
  campaignSpawn: campaignSpawnAdapter,
  ambientLightBlocker: ambientLightBlockerAdapter,
  lightSource: lightSourceAdapter,
  waterZone: waterZoneAdapter,
  lavaZone: lavaZoneAdapter,
  timeStopField: timeStopFieldAdapter,
  crumbleBlock: crumbleBlockAdapter,
  spike: spikeAdapter,
  bouncePad: bouncePadAdapter,
  kineticBlock: kineticBlockAdapter,
  grappleCarryBlock: grappleCarryBlockAdapter,
  zipMoveBlock: zipMoveBlockAdapter,
  phantasmalTile: phantasmalTileAdapter,
  pixelMaterial: pixelMaterialAdapter,
  rope: ropeAdapter,
  sunbeam: sunbeamAdapter,
  sceneLight: sceneLightAdapter,
  fallingBlock: fallingBlockAdapter,
  dialogueTrigger: dialogueTriggerAdapter,
  backgroundBlock: backgroundBlockAdapter,
  guideDustPath: guideDustPathAdapter,
  customBlock: customBlockAdapter,
  fireflyJar: fireflyJarAdapter,
  springboard: springboardAdapter,
  breakableBlock: breakableBlockAdapter,
};

/** All element types, in the order object keys were declared above. */
export const ALL_ELEMENT_TYPES: readonly SelectedElementType[] = Object.keys(ELEMENT_ADAPTERS) as SelectedElementType[];
