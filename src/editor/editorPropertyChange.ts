/**
 * Element-property-change helpers for the editor.
 *
 * Extracted from editorController.ts so that the per-element property dispatch
 * lives in a focused, self-contained module.
 *
 * Exports:
 *   - `applyPropertyToElement` – applies one property change to a single element.
 *   - `handlePropertyChange`   – pushes an undo snapshot and applies a property
 *                                change to all currently-selected elements.
 */

import type {
  EditorRoomData,
  EditorWall,
  EditorEnemy,
  EditorTransition,
  EditorSaveTomb,
  EditorSkillTomb,
  EditorDustPile,
  EditorGrasshopperArea,
  EditorFireflyArea,
  EditorDecoration,
  EditorLightSource,
  EditorSunbeam,
  EditorWaterZone,
  EditorLavaZone,
  EditorCrumbleBlock,
  EditorBouncePad,
  EditorDustContainer,
  EditorDustContainerPiece,
  EditorDustBoostJar,
  EditorRope,
  SelectedElement,
  BlockTheme,
  RopeDestructibility,
} from './editorState';
import type { EditorHistory } from './editorHistory';
import { pushSnapshot } from './editorHistory';

/**
 * Applies a single named property change to one selected element.
 *
 * @param roomData   The room data to mutate (caller must hold a valid reference).
 * @param el         The selected element descriptor identifying which element to update.
 * @param prop       Dot-separated property name, e.g. `"wall.xBlock"`.
 * @param value      New value — numeric for coordinate/size fields, string for enums/IDs.
 */
export function applyPropertyToElement(
  roomData: EditorRoomData,
  el: SelectedElement,
  prop: string,
  value: string | number,
): void {
  const room = roomData;
  const numVal = typeof value === 'number' ? value : parseInt(value as string, 10);

  if (el.type === 'wall') {
    const wall = room.interiorWalls.find((w: EditorWall) => w.uid === el.uid);
    if (wall) {
      if (prop === 'wall.xBlock' && !isNaN(numVal)) wall.xBlock = numVal;
      if (prop === 'wall.yBlock' && !isNaN(numVal)) wall.yBlock = numVal;
      if (prop === 'wall.wBlock' && !isNaN(numVal)) wall.wBlock = Math.max(1, numVal);
      if (prop === 'wall.hBlock' && !isNaN(numVal)) wall.hBlock = Math.max(1, numVal);
      if (prop === 'wall.blockTheme' && typeof value === 'string') {
        wall.blockTheme = value as BlockTheme;
      }
    }
  } else if (el.type === 'enemy') {
    const enemy = room.enemies.find((e: EditorEnemy) => e.uid === el.uid);
    if (enemy) {
      if (prop === 'enemy.xBlock' && !isNaN(numVal)) enemy.xBlock = numVal;
      if (prop === 'enemy.yBlock' && !isNaN(numVal)) enemy.yBlock = numVal;
      if (prop === 'enemy.kinds' && typeof value === 'string') {
        enemy.kinds = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
      }
      if (prop === 'enemy.particleCount' && !isNaN(numVal)) enemy.particleCount = Math.max(1, numVal);
      if (prop === 'enemy.type') {
        if (value === 'rolling') {
          enemy.isRollingEnemyFlag = 1;
          enemy.isFlyingEyeFlag = 0;
        } else {
          enemy.isRollingEnemyFlag = 0;
          enemy.isFlyingEyeFlag = 1;
        }
      }
      if (prop === 'enemy.rollingEnemySpriteIndex' && !isNaN(numVal)) {
        enemy.rollingEnemySpriteIndex = Math.max(1, Math.min(6, numVal));
      }
      if (prop === 'enemy.isBossFlag') {
        enemy.isBossFlag = numVal ? 1 : 0;
      }
    }
  } else if (el.type === 'transition') {
    const trans = room.transitions.find((t: EditorTransition) => t.uid === el.uid);
    if (trans) {
      if (prop === 'transition.direction' && typeof value === 'string') {
        trans.direction = value as 'left' | 'right' | 'up' | 'down';
      }
      if (prop === 'transition.positionBlock' && !isNaN(numVal)) trans.positionBlock = numVal;
      if (prop === 'transition.openingSizeBlocks' && !isNaN(numVal)) trans.openingSizeBlocks = Math.max(1, numVal);
      if (prop === 'transition.targetRoomId' && typeof value === 'string') trans.targetRoomId = value;
      if (prop === 'transition.targetSpawnBlockX' && !isNaN(numVal)) trans.targetSpawnBlock[0] = numVal;
      if (prop === 'transition.targetSpawnBlockY' && !isNaN(numVal)) trans.targetSpawnBlock[1] = numVal;
      if (prop === 'transition.fadeColor' && typeof value === 'string') trans.fadeColor = value;
      if (prop === 'transition.depthBlock') {
        if (value === '' || value === '-' || (typeof value === 'number' && isNaN(value))) {
          trans.depthBlock = undefined; // clear = edge transition
        } else if (!isNaN(numVal)) {
          trans.depthBlock = Math.max(0, numVal);
        }
      }
      if (prop === 'transition.isSecretDoor') {
        trans.isSecretDoor = numVal === 1;
      }
      if (prop === 'transition.gradientWidthBlocks' && !isNaN(numVal)) {
        trans.gradientWidthBlocks = Math.max(1, numVal);
      }
    }
  } else if (el.type === 'waterZone') {
    const zone = (room.waterZones ?? []).find((z: EditorWaterZone) => z.uid === el.uid);
    if (zone) {
      if (prop === 'waterZone.xBlock' && !isNaN(numVal)) zone.xBlock = numVal;
      if (prop === 'waterZone.yBlock' && !isNaN(numVal)) zone.yBlock = numVal;
      if (prop === 'waterZone.wBlock' && !isNaN(numVal)) zone.wBlock = Math.max(1, numVal);
      if (prop === 'waterZone.hBlock' && !isNaN(numVal)) zone.hBlock = Math.max(1, numVal);
    }
  } else if (el.type === 'lavaZone') {
    const zone = (room.lavaZones ?? []).find((z: EditorLavaZone) => z.uid === el.uid);
    if (zone) {
      if (prop === 'lavaZone.xBlock' && !isNaN(numVal)) zone.xBlock = numVal;
      if (prop === 'lavaZone.yBlock' && !isNaN(numVal)) zone.yBlock = numVal;
      if (prop === 'lavaZone.wBlock' && !isNaN(numVal)) zone.wBlock = Math.max(1, numVal);
      if (prop === 'lavaZone.hBlock' && !isNaN(numVal)) zone.hBlock = Math.max(1, numVal);
    }
  } else if (el.type === 'crumbleBlock') {
    const block = (room.crumbleBlocks ?? []).find((b: EditorCrumbleBlock) => b.uid === el.uid);
    if (block) {
      if (prop === 'crumbleBlock.xBlock' && !isNaN(numVal)) block.xBlock = numVal;
      if (prop === 'crumbleBlock.yBlock' && !isNaN(numVal)) block.yBlock = numVal;
      if (prop === 'crumbleBlock.variant' && typeof value === 'string') {
        block.variant = value as EditorCrumbleBlock['variant'];
      }
    }
  } else if (el.type === 'bouncePad') {
    const bp = (room.bouncePads ?? []).find((b: EditorBouncePad) => b.uid === el.uid);
    if (bp) {
      if (prop === 'bouncePad.xBlock' && !isNaN(numVal)) bp.xBlock = numVal;
      if (prop === 'bouncePad.yBlock' && !isNaN(numVal)) bp.yBlock = numVal;
      if (prop === 'bouncePad.speedFactorIndex' && !isNaN(numVal)) {
        bp.speedFactorIndex = (numVal as 0 | 1);
      }
    }
  } else if (el.type === 'dustContainer') {
    const container = (room.dustContainers ?? []).find((c: EditorDustContainer) => c.uid === el.uid);
    if (container) {
      if (prop === 'dustContainer.xBlock' && !isNaN(numVal)) container.xBlock = numVal;
      if (prop === 'dustContainer.yBlock' && !isNaN(numVal)) container.yBlock = numVal;
    }
  } else if (el.type === 'dustContainerPiece') {
    const piece = (room.dustContainerPieces ?? []).find((c: EditorDustContainerPiece) => c.uid === el.uid);
    if (piece) {
      if (prop === 'dustContainerPiece.xBlock' && !isNaN(numVal)) piece.xBlock = numVal;
      if (prop === 'dustContainerPiece.yBlock' && !isNaN(numVal)) piece.yBlock = numVal;
    }
  } else if (el.type === 'dustBoostJar') {
    const jar = (room.dustBoostJars ?? []).find((j: EditorDustBoostJar) => j.uid === el.uid);
    if (jar) {
      if (prop === 'dustBoostJar.xBlock' && !isNaN(numVal)) jar.xBlock = numVal;
      if (prop === 'dustBoostJar.yBlock' && !isNaN(numVal)) jar.yBlock = numVal;
      if (prop === 'dustBoostJar.dustKind' && typeof value === 'string') jar.dustKind = value;
      if (prop === 'dustBoostJar.dustCount' && !isNaN(numVal)) jar.dustCount = Math.max(1, Math.min(20, numVal));
    }
  } else if (el.type === 'playerSpawn') {
    if (prop === 'playerSpawn.xBlock' && !isNaN(numVal)) room.playerSpawnBlock[0] = numVal;
    if (prop === 'playerSpawn.yBlock' && !isNaN(numVal)) room.playerSpawnBlock[1] = numVal;
  } else if (el.type === 'saveTomb') {
    const tomb = room.saveTombs.find((s: EditorSaveTomb) => s.uid === el.uid);
    if (tomb) {
      if (prop === 'saveTomb.xBlock' && !isNaN(numVal)) tomb.xBlock = numVal;
      if (prop === 'saveTomb.yBlock' && !isNaN(numVal)) tomb.yBlock = numVal;
    }
  } else if (el.type === 'skillTomb') {
    const tomb = room.skillTombs.find((s: EditorSkillTomb) => s.uid === el.uid);
    if (tomb) {
      if (prop === 'skillTomb.xBlock' && !isNaN(numVal)) tomb.xBlock = numVal;
      if (prop === 'skillTomb.yBlock' && !isNaN(numVal)) tomb.yBlock = numVal;
      if (prop === 'skillTomb.weaveId' && typeof value === 'string') tomb.weaveId = value;
    }
  } else if (el.type === 'dustPile') {
    const pile = room.dustPiles.find((p: EditorDustPile) => p.uid === el.uid);
    if (pile) {
      if (prop === 'dustPile.xBlock' && !isNaN(numVal)) pile.xBlock = numVal;
      if (prop === 'dustPile.yBlock' && !isNaN(numVal)) pile.yBlock = numVal;
      if (prop === 'dustPile.dustCount' && !isNaN(numVal)) pile.dustCount = Math.max(1, numVal);
      if (prop === 'dustPile.spreadBlocks' && !isNaN(numVal)) pile.spreadBlocks = Math.max(0, numVal);
    }
  } else if (el.type === 'grasshopperArea') {
    const area = room.grasshopperAreas.find((a: EditorGrasshopperArea) => a.uid === el.uid);
    if (area) {
      if (prop === 'grasshopperArea.xBlock' && !isNaN(numVal)) area.xBlock = numVal;
      if (prop === 'grasshopperArea.yBlock' && !isNaN(numVal)) area.yBlock = numVal;
      if (prop === 'grasshopperArea.wBlock' && !isNaN(numVal)) area.wBlock = Math.max(1, numVal);
      if (prop === 'grasshopperArea.hBlock' && !isNaN(numVal)) area.hBlock = Math.max(1, numVal);
      if (prop === 'grasshopperArea.count' && !isNaN(numVal)) area.count = Math.max(1, numVal);
    }
  } else if (el.type === 'fireflyArea') {
    const area = (room.fireflyAreas ?? []).find((a: EditorFireflyArea) => a.uid === el.uid);
    if (area) {
      if (prop === 'fireflyArea.xBlock' && !isNaN(numVal)) area.xBlock = numVal;
      if (prop === 'fireflyArea.yBlock' && !isNaN(numVal)) area.yBlock = numVal;
      if (prop === 'fireflyArea.wBlock' && !isNaN(numVal)) area.wBlock = Math.max(1, numVal);
      if (prop === 'fireflyArea.hBlock' && !isNaN(numVal)) area.hBlock = Math.max(1, numVal);
      if (prop === 'fireflyArea.count' && !isNaN(numVal)) area.count = Math.max(1, numVal);
    }
  } else if (el.type === 'decoration') {
    const deco = (room.decorations ?? []).find((d: EditorDecoration) => d.uid === el.uid);
    if (deco) {
      if (prop === 'decoration.xBlock' && !isNaN(numVal)) deco.xBlock = numVal;
      if (prop === 'decoration.yBlock' && !isNaN(numVal)) deco.yBlock = numVal;
    }
  } else if (el.type === 'lightSource') {
    const light = (room.lightSources ?? []).find((l: EditorLightSource) => l.uid === el.uid);
    if (light) {
      if (prop === 'lightSource.xBlock' && !isNaN(numVal)) light.xBlock = numVal;
      if (prop === 'lightSource.yBlock' && !isNaN(numVal)) light.yBlock = numVal;
      if (prop === 'lightSource.radiusBlocks' && !isNaN(numVal)) light.radiusBlocks = Math.max(1, Math.min(64, numVal));
      if (prop === 'lightSource.brightnessPct' && !isNaN(numVal)) light.brightnessPct = Math.max(0, Math.min(100, numVal));
      if (prop === 'lightSource.dustMoteCount' && !isNaN(numVal)) light.dustMoteCount = Math.max(0, Math.min(200, numVal));
      if (prop === 'lightSource.dustMoteSpreadBlocks' && !isNaN(numVal)) light.dustMoteSpreadBlocks = Math.max(0, Math.min(32, numVal));
      if (prop === 'lightSource.color') {
        // Color change already applied in UI handler; just mark dirty
      }
    }
  } else if (el.type === 'sunbeam') {
    const sb = (room.sunbeams ?? []).find((s: EditorSunbeam) => s.uid === el.uid);
    if (sb) {
      if (prop === 'sunbeam.xBlock' && !isNaN(numVal)) sb.xBlock = numVal;
      if (prop === 'sunbeam.yBlock' && !isNaN(numVal)) sb.yBlock = numVal;
      if (prop === 'sunbeam.angleRad' && !isNaN(numVal)) sb.angleRad = numVal;
      if (prop === 'sunbeam.widthBlocks' && !isNaN(numVal)) sb.widthBlocks = Math.max(1, Math.min(20, numVal));
      if (prop === 'sunbeam.lengthBlocks' && !isNaN(numVal)) sb.lengthBlocks = Math.max(1, Math.min(80, numVal));
      if (prop === 'sunbeam.intensityPct' && !isNaN(numVal)) sb.intensityPct = Math.max(0, Math.min(100, numVal));
      if (prop === 'sunbeam.color') {
        // Color change already applied in UI handler; just mark dirty
      }
    }
  } else if (el.type === 'rope') {
    const rope = (room.ropes ?? []).find((r: EditorRope) => r.uid === el.uid);
    if (rope) {
      if (prop === 'rope.segmentCount' && !isNaN(numVal)) rope.segmentCount = Math.max(2, Math.min(32, numVal));
      if (prop === 'rope.destructibility' && typeof value === 'string') {
        rope.destructibility = value as RopeDestructibility;
      }
      if (prop === 'rope.thicknessIndex' && !isNaN(numVal)) {
        rope.thicknessIndex = (Math.max(0, Math.min(2, numVal))) as 0 | 1 | 2;
      }
      if (prop === 'rope.isAnchorBFixedFlag' && !isNaN(numVal)) {
        rope.isAnchorBFixedFlag = (numVal ? 1 : 0) as 0 | 1;
      }
    }
  }
}

/**
 * Pushes an undo snapshot and applies a property change to all currently-selected
 * elements that are present in `roomData`.
 *
 * @param roomData          The room data to mutate.
 * @param selectedElements  The currently-selected elements.
 * @param history           The editor undo/redo history.
 * @param prop              Dot-separated property name.
 * @param value             New value.
 */
export function handlePropertyChange(
  roomData: EditorRoomData,
  selectedElements: SelectedElement[],
  history: EditorHistory,
  prop: string,
  value: string | number,
): void {
  if (selectedElements.length === 0) return;

  pushSnapshot(history, roomData);

  // Apply property to all selected elements of matching type
  for (const el of selectedElements) {
    applyPropertyToElement(roomData, el, prop, value);
  }
}
