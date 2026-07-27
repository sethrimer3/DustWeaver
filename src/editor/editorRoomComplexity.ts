/**
 * editorRoomComplexity.ts — adapts the live in-editor `EditorRoomData` shape
 * into the shared `RoomComplexityCategoryCounts` used by the authoritative
 * analyzer in `src/levels/roomComplexity.ts`.
 *
 * This is the ONLY place that reads `EditorRoomData` fields for complexity
 * purposes; the scoring/threshold/severity logic itself lives entirely in
 * roomComplexity.ts and is shared with the RoomDef-based (gameplay/campaign)
 * analysis, so editor and campaign warnings can never drift apart.
 */

import type { EditorRoomData } from './editorElementTypes';
import {
  computeRoomComplexityReport,
  type RoomComplexityCategoryCounts,
  type RoomComplexityReport,
} from '../levels/roomComplexity';

function sumZoneCells(zones: readonly { wBlock: number; hBlock: number }[] | undefined): number {
  if (!zones) return 0;
  let total = 0;
  for (const zone of zones) total += zone.wBlock * zone.hBlock;
  return total;
}

export function countEditorRoomDataCategories(room: EditorRoomData): RoomComplexityCategoryCounts {
  return {
    tiles: room.interiorWalls.length + (room.backgroundBlocks?.length ?? 0),
    objects:
      room.decorations.length +
      room.dustContainers.length +
      room.dustContainerPieces.length +
      room.dustBoostJars.length +
      room.dustPiles.length +
      room.lambdaAnchors.length +
      (room.ropes?.length ?? 0) +
      room.saveTombs.length +
      room.skillTombs.length +
      (room.bouncePads?.length ?? 0) +
      (room.kineticBlocks?.length ?? 0) +
      (room.grappleCarryBlocks?.length ?? 0) +
      (room.phantasmalTiles?.length ?? 0) +
      (room.crumbleBlocks?.length ?? 0) +
      (room.fallingBlocks?.length ?? 0) +
      room.dustSwarms.length +
      (room.guideDustPaths?.length ?? 0) +
      room.grasshopperAreas.length +
      room.fireflyAreas.length +
      (room.fireflyJars?.length ?? 0) +
      (room.springboards?.length ?? 0) +
      (room.breakableBlocks?.length ?? 0),
    enemies: room.enemies.length,
    enemyParticles: room.enemies.reduce((sum, e) => sum + e.particleCount, 0),
    dustCells: room.pixelMaterials?.length ?? 0,
    liquidCells: sumZoneCells(room.waterZones) + sumZoneCells(room.lavaZones),
    emitterParticles:
      room.dustSwarms.reduce((sum, s) => sum + s.dustCount, 0) +
      room.dustPiles.reduce((sum, p) => sum + p.dustCount, 0) +
      (room.guideDustPaths ?? []).reduce((sum, p) => sum + p.moteCount, 0),
    hazards: (room.spikes?.length ?? 0) + (room.waterZones?.length ?? 0) + (room.lavaZones?.length ?? 0),
    triggers: (room.dialogueTriggers?.length ?? 0) + room.transitions.length,
    lights:
      room.ambientLightBlockers.length +
      room.lightSources.length +
      (room.sunbeams?.length ?? 0) +
      (room.sceneLights?.length ?? 0),
  };
}

export function analyzeEditorRoomComplexity(room: EditorRoomData): RoomComplexityReport {
  return computeRoomComplexityReport(countEditorRoomDataCategories(room));
}
