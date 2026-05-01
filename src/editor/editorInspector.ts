/**
 * editorInspector.ts — Inspector panel for the world editor.
 *
 * Renders property fields for the currently selected element(s).
 * Extracted from editorUI.ts to keep each file focused on a single
 * concern: editorUI.ts owns the toolbar/palette/shell, this module
 * owns the per-element property inspector.
 */

import {
  EditorState,
  EditorUICallbacks,
  BLOCK_THEMES,
  FADE_COLOR_OPTIONS,
  CRUMBLE_VARIANT_OPTIONS,
  ROPE_DESTRUCTIBILITY_OPTIONS,
  DUST_KIND_OPTIONS,
} from './editorState';
import {
  addField,
  addSelect,
  addCheckbox,
  addNumberField,
  addSliderField,
  addColorSliders,
} from './editorFormWidgets';
import { makeBtn } from './editorUIHelpers';
import { GREEN } from './editorStyles';
import { WEAVE_LIST, WEAVE_REGISTRY } from '../sim/weaves/weaveDefinition';

const KIND_OPTIONS: { label: string; value: string }[] = DUST_KIND_OPTIONS.map(k => ({ label: k, value: k }));

// ── Inspector ─────────────────────────────────────────────────────────────────

export function updateInspector(
  div: HTMLDivElement,
  state: EditorState,
  callbacks: EditorUICallbacks | null,
): void {
  div.innerHTML = '';
  if (state.selectedElements.length === 0 || state.roomData === null) {
    div.innerHTML = `<div style="color: rgba(200,255,200,0.4); font-size: 11px;">Select an element to inspect</div>`;
    return;
  }

  const room = state.roomData;

  // Multi-selection: show count
  if (state.selectedElements.length > 1) {
    const heading = document.createElement('div');
    heading.textContent = `Inspector: ${state.selectedElements.length} elements`;
    heading.style.cssText = `color: ${GREEN}; font-size: 13px; margin-bottom: 8px; font-weight: bold;`;
    div.appendChild(heading);

    // Show shared properties for multi-selection
    const types = new Set(state.selectedElements.map(e => e.type));
    if (types.size === 1) {
      const type = state.selectedElements[0].type;
      const typeLabel = document.createElement('div');
      typeLabel.textContent = `All: ${type}`;
      typeLabel.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.5); margin-bottom: 4px;`;
      div.appendChild(typeLabel);

      if (type === 'wall') {
        addSelect(div, 'blockTheme',
          BLOCK_THEMES.map(t => ({ label: t.label, value: t.id })),
          '(mixed)',
          v => callbacks?.onPropertyChange('wall.blockTheme', v));
      } else if (type === 'transition') {
        addSelect(div, 'fadeColor',
          FADE_COLOR_OPTIONS,
          '(mixed)',
          v => callbacks?.onPropertyChange('transition.fadeColor', v));
      }
    } else {
      const typeInfo = document.createElement('div');
      typeInfo.textContent = `Mixed types: ${[...types].join(', ')}`;
      typeInfo.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.5); margin-bottom: 4px;`;
      div.appendChild(typeInfo);
    }
    return;
  }

  // Single selection
  const el = state.selectedElements[0];

  const heading = document.createElement('div');
  heading.textContent = `Inspector: ${el.type}`;
  heading.style.cssText = `color: ${GREEN}; font-size: 13px; margin-bottom: 8px; font-weight: bold;`;
  div.appendChild(heading);

  if (el.type === 'wall') {
    const wall = room.interiorWalls.find(w => w.uid === el.uid);
    if (wall) {
      addField(div, 'xBlock', String(wall.xBlock), v => callbacks?.onPropertyChange('wall.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(wall.yBlock), v => callbacks?.onPropertyChange('wall.yBlock', parseInt(v)));
      addField(div, 'wBlock', String(wall.wBlock), v => callbacks?.onPropertyChange('wall.wBlock', parseInt(v)));
      addField(div, 'hBlock', String(wall.hBlock), v => callbacks?.onPropertyChange('wall.hBlock', parseInt(v)));
      addSelect(div, 'blockTheme',
        BLOCK_THEMES.map(t => ({ label: t.label, value: t.id })),
        wall.blockTheme ?? room.blockTheme,
        v => callbacks?.onPropertyChange('wall.blockTheme', v));
      const typeLabel = wall.isPlatformFlag === 1 ? 'Platform (one-way)' : 'Solid Block';
      const typeDiv = document.createElement('div');
      typeDiv.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.5); margin-top: 4px;`;
      typeDiv.textContent = `Type: ${typeLabel}`;
      div.appendChild(typeDiv);
    }
  } else if (el.type === 'enemy') {
    const enemy = room.enemies.find(e => e.uid === el.uid);
    if (enemy) {
      addField(div, 'xBlock', String(enemy.xBlock), v => callbacks?.onPropertyChange('enemy.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(enemy.yBlock), v => callbacks?.onPropertyChange('enemy.yBlock', parseInt(v)));
      addField(div, 'kinds', enemy.kinds.join(', '), v => callbacks?.onPropertyChange('enemy.kinds', v));
      addField(div, 'particleCount', String(enemy.particleCount), v => callbacks?.onPropertyChange('enemy.particleCount', parseInt(v)));
      addSelect(div, 'type', [
        { label: 'Rolling', value: 'rolling' },
        { label: 'Flying Eye', value: 'flyingEye' },
      ], enemy.isRollingEnemyFlag === 1 ? 'rolling' : 'flyingEye',
      v => callbacks?.onPropertyChange('enemy.type', v));
      if (enemy.isRollingEnemyFlag === 1) {
        addField(div, 'spriteIndex', String(enemy.rollingEnemySpriteIndex),
          v => callbacks?.onPropertyChange('enemy.rollingEnemySpriteIndex', parseInt(v)));
      }
      addCheckbox(div, 'isBoss', enemy.isBossFlag === 1,
        v => callbacks?.onPropertyChange('enemy.isBossFlag', v ? 1 : 0));
    }
  } else if (el.type === 'transition') {
    const trans = room.transitions.find(t => t.uid === el.uid);
    if (trans) {
      // Show door number
      const doorIndex = room.transitions.indexOf(trans);
      const doorLabel = document.createElement('div');
      doorLabel.textContent = `Door #${doorIndex + 1}`;
      doorLabel.style.cssText = `font-size: 12px; color: #88bbff; margin-bottom: 6px; font-weight: bold;`;
      div.appendChild(doorLabel);

      addSelect(div, 'direction',
        ['left', 'right', 'up', 'down'].map(d => ({ label: d, value: d })),
        trans.direction, v => callbacks?.onPropertyChange('transition.direction', v));
      addField(div, 'positionBlock', String(trans.positionBlock),
        v => callbacks?.onPropertyChange('transition.positionBlock', parseInt(v)));
      addField(div, 'openingSizeBlocks', String(trans.openingSizeBlocks),
        v => callbacks?.onPropertyChange('transition.openingSizeBlocks', parseInt(v)));
      addField(div, 'depthBlock (blank=edge)', trans.depthBlock !== undefined ? String(trans.depthBlock) : '',
        v => callbacks?.onPropertyChange('transition.depthBlock', v.trim() === '' ? '' : parseInt(v)));
      addField(div, 'targetRoomId', trans.targetRoomId,
        v => callbacks?.onPropertyChange('transition.targetRoomId', v));
      addField(div, 'targetSpawnX', String(trans.targetSpawnBlock[0]),
        v => callbacks?.onPropertyChange('transition.targetSpawnBlockX', parseInt(v)));
      addField(div, 'targetSpawnY', String(trans.targetSpawnBlock[1]),
        v => callbacks?.onPropertyChange('transition.targetSpawnBlockY', parseInt(v)));

      // Fade color dropdown
      addSelect(div, 'fadeColor',
        FADE_COLOR_OPTIONS,
        trans.fadeColor ?? '#000000',
        v => callbacks?.onPropertyChange('transition.fadeColor', v));

      addCheckbox(div, 'isSecretDoor', trans.isSecretDoor === true,
        v => callbacks?.onPropertyChange('transition.isSecretDoor', v ? 1 : 0));
      addNumberField(div, 'gradientWidthBlocks', trans.gradientWidthBlocks ?? 3, 1, 20,
        v => callbacks?.onPropertyChange('transition.gradientWidthBlocks', v));

      // Link Transition button
      const linkBtn = makeBtn('🔗 Link Transition', () => callbacks?.onLinkTransition());
      linkBtn.style.width = '100%';
      linkBtn.style.marginTop = '8px';
      linkBtn.style.background = 'rgba(0,100,200,0.3)';
      linkBtn.style.borderColor = 'rgba(0,150,255,0.5)';
      div.appendChild(linkBtn);
    }
  } else if (el.type === 'playerSpawn') {
    addField(div, 'xBlock', String(room.playerSpawnBlock[0]),
      v => callbacks?.onPropertyChange('playerSpawn.xBlock', parseInt(v)));
    addField(div, 'yBlock', String(room.playerSpawnBlock[1]),
      v => callbacks?.onPropertyChange('playerSpawn.yBlock', parseInt(v)));
  } else if (el.type === 'saveTomb') {
    const tomb = room.saveTombs.find(s => s.uid === el.uid);
    if (tomb) {
      addField(div, 'xBlock', String(tomb.xBlock),
        v => callbacks?.onPropertyChange('saveTomb.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(tomb.yBlock),
        v => callbacks?.onPropertyChange('saveTomb.yBlock', parseInt(v)));
    }
  } else if (el.type === 'skillTomb') {
    const tomb = room.skillTombs.find(s => s.uid === el.uid);
    if (tomb) {
      addField(div, 'xBlock', String(tomb.xBlock),
        v => callbacks?.onPropertyChange('skillTomb.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(tomb.yBlock),
        v => callbacks?.onPropertyChange('skillTomb.yBlock', parseInt(v)));
      addSelect(div, 'weaveId',
        WEAVE_LIST.map(id => ({
          label: WEAVE_REGISTRY.get(id)?.displayName ?? id,
          value: id,
        })),
        tomb.weaveId,
        v => callbacks?.onPropertyChange('skillTomb.weaveId', v));
    }
  } else if (el.type === 'dustContainer') {
    const container = (room.dustContainers ?? []).find(c => c.uid === el.uid);
    if (container) {
      addField(div, 'xBlock', String(container.xBlock),
        v => callbacks?.onPropertyChange('dustContainer.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(container.yBlock),
        v => callbacks?.onPropertyChange('dustContainer.yBlock', parseInt(v)));
    }
  } else if (el.type === 'dustContainerPiece') {
    const piece = (room.dustContainerPieces ?? []).find(c => c.uid === el.uid);
    if (piece) {
      addField(div, 'xBlock', String(piece.xBlock),
        v => callbacks?.onPropertyChange('dustContainerPiece.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(piece.yBlock),
        v => callbacks?.onPropertyChange('dustContainerPiece.yBlock', parseInt(v)));
    }
  } else if (el.type === 'dustBoostJar') {
    const jar = (room.dustBoostJars ?? []).find(j => j.uid === el.uid);
    if (jar) {
      addField(div, 'xBlock', String(jar.xBlock),
        v => callbacks?.onPropertyChange('dustBoostJar.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(jar.yBlock),
        v => callbacks?.onPropertyChange('dustBoostJar.yBlock', parseInt(v)));
      addSelect(div, 'dustKind',
        KIND_OPTIONS,
        jar.dustKind,
        v => callbacks?.onPropertyChange('dustBoostJar.dustKind', v));
      addNumberField(div, 'dustCount', jar.dustCount, 1, 20,
        v => callbacks?.onPropertyChange('dustBoostJar.dustCount', v));
    }
  } else if (el.type === 'dustPile') {
    const pile = room.dustPiles.find(p => p.uid === el.uid);
    if (pile) {
      addField(div, 'xBlock', String(pile.xBlock),
        v => callbacks?.onPropertyChange('dustPile.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(pile.yBlock),
        v => callbacks?.onPropertyChange('dustPile.yBlock', parseInt(v)));
      addField(div, 'dustCount', String(pile.dustCount),
        v => callbacks?.onPropertyChange('dustPile.dustCount', parseInt(v)));
      addField(div, 'spreadBlocks', String(pile.spreadBlocks ?? 0),
        v => callbacks?.onPropertyChange('dustPile.spreadBlocks', parseInt(v)));
    }
  } else if (el.type === 'grasshopperArea') {
    const area = room.grasshopperAreas.find(a => a.uid === el.uid);
    if (area) {
      addField(div, 'xBlock', String(area.xBlock),
        v => callbacks?.onPropertyChange('grasshopperArea.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(area.yBlock),
        v => callbacks?.onPropertyChange('grasshopperArea.yBlock', parseInt(v)));
      addField(div, 'wBlock', String(area.wBlock),
        v => callbacks?.onPropertyChange('grasshopperArea.wBlock', parseInt(v)));
      addField(div, 'hBlock', String(area.hBlock),
        v => callbacks?.onPropertyChange('grasshopperArea.hBlock', parseInt(v)));
      addField(div, 'count', String(area.count),
        v => callbacks?.onPropertyChange('grasshopperArea.count', parseInt(v)));
    }
  } else if (el.type === 'fireflyArea') {
    const area = (room.fireflyAreas ?? []).find(a => a.uid === el.uid);
    if (area) {
      addField(div, 'xBlock', String(area.xBlock),
        v => callbacks?.onPropertyChange('fireflyArea.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(area.yBlock),
        v => callbacks?.onPropertyChange('fireflyArea.yBlock', parseInt(v)));
      addField(div, 'wBlock', String(area.wBlock),
        v => callbacks?.onPropertyChange('fireflyArea.wBlock', parseInt(v)));
      addField(div, 'hBlock', String(area.hBlock),
        v => callbacks?.onPropertyChange('fireflyArea.hBlock', parseInt(v)));
      addField(div, 'count', String(area.count),
        v => callbacks?.onPropertyChange('fireflyArea.count', parseInt(v)));
    }
  } else if (el.type === 'decoration') {
    const deco = (room.decorations ?? []).find(d => d.uid === el.uid);
    if (deco) {
      addField(div, 'kind', deco.kind, () => {/* read-only */});
      addField(div, 'xBlock', String(deco.xBlock),
        v => callbacks?.onPropertyChange('decoration.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(deco.yBlock),
        v => callbacks?.onPropertyChange('decoration.yBlock', parseInt(v)));
    }
  } else if (el.type === 'ambientLightBlocker') {
    const blocker = (room.ambientLightBlockers ?? []).find(b => b.uid === el.uid);
    if (blocker) {
      const readout = document.createElement('div');
      readout.textContent = 'Ambient Light Blocker';
      readout.style.cssText = `font-size: 12px; color: rgba(180,120,255,0.9); margin-bottom: 6px; font-weight: bold;`;
      div.appendChild(readout);
      const posInfo = document.createElement('div');
      posInfo.textContent = `X: ${blocker.xBlock}, Y: ${blocker.yBlock}`;
      posInfo.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.7); margin-bottom: 4px;`;
      div.appendChild(posInfo);
      const note = document.createElement('div');
      note.textContent = 'Blocks ambient-light propagation through this cell (no collision effect).';
      note.style.cssText = `font-size: 10px; color: rgba(200,255,200,0.5); margin-top: 6px; font-style: italic;`;
      div.appendChild(note);
    }
  } else if (el.type === 'lightSource') {
    const light = (room.lightSources ?? []).find(l => l.uid === el.uid);
    if (light) {
      addField(div, 'xBlock', String(light.xBlock),
        v => {
          const num = parseInt(v);
          if (!isNaN(num)) {
            light.xBlock = num;
            callbacks?.onPropertyChange('lightSource.xBlock', num);
          }
        });
      addField(div, 'yBlock', String(light.yBlock),
        v => {
          const num = parseInt(v);
          if (!isNaN(num)) {
            light.yBlock = num;
            callbacks?.onPropertyChange('lightSource.yBlock', num);
          }
        });
      addNumberField(div, 'radiusBlocks', light.radiusBlocks, 1, 64, v => {
        light.radiusBlocks = v;
        callbacks?.onPropertyChange('lightSource.radiusBlocks', v);
      });
      addSliderField(div, 'brightnessPct', light.brightnessPct, 0, 100, v => {
        light.brightnessPct = v;
        callbacks?.onPropertyChange('lightSource.brightnessPct', v);
      });
      addColorSliders(div, 'color', light.colorR, light.colorG, light.colorB, (r, g, b) => {
        light.colorR = r;
        light.colorG = g;
        light.colorB = b;
        callbacks?.onPropertyChange('lightSource.color', 0);
      });
    }
  } else if (el.type === 'waterZone') {
    const zone = (room.waterZones ?? []).find(z => z.uid === el.uid);
    if (zone) {
      addField(div, 'xBlock', String(zone.xBlock),
        v => callbacks?.onPropertyChange('waterZone.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(zone.yBlock),
        v => callbacks?.onPropertyChange('waterZone.yBlock', parseInt(v)));
      addField(div, 'wBlock', String(zone.wBlock),
        v => callbacks?.onPropertyChange('waterZone.wBlock', parseInt(v)));
      addField(div, 'hBlock', String(zone.hBlock),
        v => callbacks?.onPropertyChange('waterZone.hBlock', parseInt(v)));
    }
  } else if (el.type === 'lavaZone') {
    const zone = (room.lavaZones ?? []).find(z => z.uid === el.uid);
    if (zone) {
      addField(div, 'xBlock', String(zone.xBlock),
        v => callbacks?.onPropertyChange('lavaZone.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(zone.yBlock),
        v => callbacks?.onPropertyChange('lavaZone.yBlock', parseInt(v)));
      addField(div, 'wBlock', String(zone.wBlock),
        v => callbacks?.onPropertyChange('lavaZone.wBlock', parseInt(v)));
      addField(div, 'hBlock', String(zone.hBlock),
        v => callbacks?.onPropertyChange('lavaZone.hBlock', parseInt(v)));
    }
  } else if (el.type === 'crumbleBlock') {
    const block = (room.crumbleBlocks ?? []).find(b => b.uid === el.uid);
    if (block) {
      addField(div, 'xBlock', String(block.xBlock),
        v => callbacks?.onPropertyChange('crumbleBlock.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(block.yBlock),
        v => callbacks?.onPropertyChange('crumbleBlock.yBlock', parseInt(v)));
      addSelect(div, 'variant',
        CRUMBLE_VARIANT_OPTIONS.map(o => ({ label: o.label, value: o.id })),
        block.variant ?? 'normal',
        v => callbacks?.onPropertyChange('crumbleBlock.variant', v));
    }
  } else if (el.type === 'bouncePad') {
    const bp = (room.bouncePads ?? []).find(b => b.uid === el.uid);
    if (bp) {
      addField(div, 'xBlock', String(bp.xBlock),
        v => callbacks?.onPropertyChange('bouncePad.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(bp.yBlock),
        v => callbacks?.onPropertyChange('bouncePad.yBlock', parseInt(v)));
      addSelect(div, 'speedFactor',
        [
          { label: '50 % (dim core)',    value: '0' },
          { label: '100 % (bright core)', value: '1' },
        ],
        String(bp.speedFactorIndex ?? 0),
        v => callbacks?.onPropertyChange('bouncePad.speedFactorIndex', parseInt(v)));
    }
  } else if (el.type === 'rope') {
    const ropes = room.ropes ?? [];
    const rope = ropes.find(r => r.uid === el.uid);
    if (rope) {
      addField(div, 'anchorA',
        `(${rope.anchorAXBlock}, ${rope.anchorAYBlock}) blocks`,
        () => {});
      addField(div, 'anchorB',
        `(${rope.anchorBXBlock}, ${rope.anchorBYBlock}) blocks`,
        () => {});
      addNumberField(div, 'segmentCount', rope.segmentCount, 2, 32,
        v => callbacks?.onPropertyChange('rope.segmentCount', v));
      addSelect(div, 'destructibility',
        ROPE_DESTRUCTIBILITY_OPTIONS.map(o => ({ label: o.label, value: o.id })),
        rope.destructibility,
        v => callbacks?.onPropertyChange('rope.destructibility', v));
      addCheckbox(div, 'anchorBFixed', rope.isAnchorBFixedFlag === 1,
        v => callbacks?.onPropertyChange('rope.isAnchorBFixedFlag', v ? 1 : 0));
    }
  }
}
