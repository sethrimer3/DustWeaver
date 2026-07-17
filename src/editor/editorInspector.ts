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
  ROPE_THICKNESS_OPTIONS,
  DUST_KIND_OPTIONS,
  SCENE_LIGHT_TYPE_OPTIONS,
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
import { GREEN, PANEL_BORDER, TEXT_COLOR } from './editorStyles';
import { WEAVE_LIST, WEAVE_REGISTRY } from '../sim/weaves/weaveDefinition';
import { buildDialogueTriggerInspector } from './editorDialogueTriggerInspector';

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
      } else if (type === 'spike') {
        addSelect(div, 'blockTheme',
          BLOCK_THEMES.map(t => ({ label: t.label, value: t.id })),
          '(mixed)',
          v => callbacks?.onPropertyChange('spike.blockTheme', v));
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
      addCheckbox(div, 'Counts toward enemy gates', enemy.countsTowardRoomCompletionFlag !== 0,
        v => callbacks?.onPropertyChange('enemy.countsTowardRoomCompletionFlag', v ? 1 : 0));
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
      addField(div, 'xBlock', String(trans.xBlock),
        v => callbacks?.onPropertyChange('transition.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(trans.yBlock),
        v => callbacks?.onPropertyChange('transition.yBlock', parseInt(v)));
      addField(div, 'Width (openingSizeBlocks)', String(trans.openingSizeBlocks),
        v => callbacks?.onPropertyChange('transition.openingSizeBlocks', parseInt(v)));
      addNumberField(div, 'Gradient Width', trans.gradientWidthBlocks ?? 3, 0, 20,
        v => callbacks?.onPropertyChange('transition.gradientWidthBlocks', v));
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

      addCheckbox(div, 'Long Transition', trans.longTransition === true,
        v => callbacks?.onPropertyChange('transition.longTransition', v ? 1 : 0));

      // Link Transition button
      const linkBtn = makeBtn('🔗 Link Transition', () => callbacks?.onLinkTransition());
      linkBtn.style.width = '100%';
      linkBtn.style.marginTop = '8px';
      linkBtn.style.background = 'rgba(0,100,200,0.3)';
      linkBtn.style.borderColor = 'rgba(0,150,255,0.5)';
      div.appendChild(linkBtn);
    }
  } else if (el.type === 'campaignSpawn') {
    const spawnBlock = state.campaignSpawnBlock;
    const opts = state.campaignSpawnStartingOptions;
    if (spawnBlock !== null) {
      addField(div, 'xBlock', String(spawnBlock[0]),
        v => callbacks?.onPropertyChange('campaignSpawn.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(spawnBlock[1]),
        v => callbacks?.onPropertyChange('campaignSpawn.yBlock', parseInt(v)));

      // ── Starting options section ────────────────────────────────────────
      const sectionLabel = document.createElement('div');
      sectionLabel.textContent = 'Starting Options';
      sectionLabel.style.cssText = `font-size: 11px; color: ${GREEN}; margin-top: 8px; margin-bottom: 4px; font-weight: bold;`;
      div.appendChild(sectionLabel);

      addNumberField(div, 'Health', opts?.startingHealth ?? 10, 1, 10,
        v => callbacks?.onPropertyChange('campaignSpawn.startingHealth', v));
      addNumberField(div, 'Containers', opts?.startingDustContainerCount ?? 0, 0, 20,
        v => callbacks?.onPropertyChange('campaignSpawn.startingDustContainerCount', v));

      // Starting Dust Types — checkbox list
      const dustLabel = document.createElement('div');
      dustLabel.textContent = 'Starting Dust Types';
      dustLabel.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.7); margin-top: 6px; margin-bottom: 3px;`;
      div.appendChild(dustLabel);

      const currentDustTypes = new Set<string>(opts?.startingDustTypes ?? []);
      const dustGrid = document.createElement('div');
      dustGrid.style.cssText = `display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 4px;`;
      for (const kindName of DUST_KIND_OPTIONS) {
        const isKindChecked = currentDustTypes.has(kindName);
        const chip = document.createElement('label');
        chip.style.cssText = `
          display: flex; align-items: center; gap: 3px;
          background: rgba(0,0,0,0.3); border: 1px solid ${isKindChecked ? GREEN : PANEL_BORDER};
          border-radius: 3px; padding: 2px 5px; cursor: pointer;
          font-size: 10px; color: ${isKindChecked ? GREEN : TEXT_COLOR};
        `;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isKindChecked;
        cb.style.cssText = `accent-color: ${GREEN}; width: 10px; height: 10px;`;
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
          if (cb.checked) { currentDustTypes.add(kindName); } else { currentDustTypes.delete(kindName); }
          chip.style.borderColor = cb.checked ? GREEN : PANEL_BORDER;
          chip.style.color = cb.checked ? GREEN : TEXT_COLOR;
          callbacks?.onPropertyChange('campaignSpawn.startingDustTypes', JSON.stringify([...currentDustTypes]));
        });
        chip.appendChild(cb);
        chip.appendChild(document.createTextNode(kindName));
        dustGrid.appendChild(chip);
      }
      div.appendChild(dustGrid);

      // Starting Weaves — checkbox list
      const weavesLabel = document.createElement('div');
      weavesLabel.textContent = 'Starting Weaves';
      weavesLabel.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.7); margin-top: 6px; margin-bottom: 3px;`;
      div.appendChild(weavesLabel);

      const currentWeaves = new Set<string>(opts?.startingWeaves ?? []);
      const weavesGrid = document.createElement('div');
      weavesGrid.style.cssText = `display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 4px;`;
      for (const weaveId of WEAVE_LIST) {
        const weaveDef = WEAVE_REGISTRY.get(weaveId);
        const weaveName = weaveDef?.displayName ?? weaveId;
        const isWeaveChecked = currentWeaves.has(weaveId);

        const chip = document.createElement('label');
        chip.style.cssText = `
          display: flex; align-items: center; gap: 3px;
          background: rgba(0,0,0,0.3); border: 1px solid ${isWeaveChecked ? GREEN : PANEL_BORDER};
          border-radius: 3px; padding: 2px 5px; cursor: pointer;
          font-size: 10px; color: ${isWeaveChecked ? GREEN : TEXT_COLOR};
        `;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isWeaveChecked;
        cb.style.cssText = `accent-color: ${GREEN}; width: 10px; height: 10px;`;
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
          if (cb.checked) {
            currentWeaves.add(weaveId);
          } else {
            currentWeaves.delete(weaveId);
          }
          chip.style.borderColor = cb.checked ? GREEN : PANEL_BORDER;
          chip.style.color = cb.checked ? GREEN : TEXT_COLOR;
          callbacks?.onPropertyChange('campaignSpawn.startingWeaves', JSON.stringify([...currentWeaves]));
        });
        chip.appendChild(cb);
        chip.appendChild(document.createTextNode(weaveName));
        weavesGrid.appendChild(chip);
      }
      div.appendChild(weavesGrid);
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
  } else if (el.type === 'dustSwarm') {
    const swarm = (room.dustSwarms ?? []).find(s => s.uid === el.uid);
    if (swarm) {
      addField(div, 'xBlock', String(swarm.xBlock),
        v => callbacks?.onPropertyChange('dustSwarm.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(swarm.yBlock),
        v => callbacks?.onPropertyChange('dustSwarm.yBlock', parseInt(v)));
      addSelect(div, 'dustKind',
        KIND_OPTIONS,
        swarm.dustKind,
        v => callbacks?.onPropertyChange('dustSwarm.dustKind', v));
      addNumberField(div, 'dustCount', swarm.dustCount, 1, 50,
        v => callbacks?.onPropertyChange('dustSwarm.dustCount', v));
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
      addNumberField(div, 'dustMoteCount', light.dustMoteCount, 0, 200, v => {
        light.dustMoteCount = v;
        callbacks?.onPropertyChange('lightSource.dustMoteCount', v);
      });
      addNumberField(div, 'dustMoteSpreadBlocks', light.dustMoteSpreadBlocks, 0, 32, v => {
        light.dustMoteSpreadBlocks = v;
        callbacks?.onPropertyChange('lightSource.dustMoteSpreadBlocks', v);
      });
    }
  } else if (el.type === 'sunbeam') {
    const sb = (room.sunbeams ?? []).find(s => s.uid === el.uid);
    if (sb) {
      addField(div, 'xBlock', String(sb.xBlock),
        v => {
          const num = parseInt(v);
          if (!isNaN(num)) {
            sb.xBlock = num;
            callbacks?.onPropertyChange('sunbeam.xBlock', num);
          }
        });
      addField(div, 'yBlock', String(sb.yBlock),
        v => {
          const num = parseInt(v);
          if (!isNaN(num)) {
            sb.yBlock = num;
            callbacks?.onPropertyChange('sunbeam.yBlock', num);
          }
        });
      addNumberField(div, 'angleRad', sb.angleRad, -Math.PI, Math.PI, v => {
        sb.angleRad = v;
        callbacks?.onPropertyChange('sunbeam.angleRad', v);
      });
      addNumberField(div, 'widthBlocks', sb.widthBlocks, 1, 20, v => {
        sb.widthBlocks = v;
        callbacks?.onPropertyChange('sunbeam.widthBlocks', v);
      });
      addNumberField(div, 'lengthBlocks', sb.lengthBlocks, 1, 80, v => {
        sb.lengthBlocks = v;
        callbacks?.onPropertyChange('sunbeam.lengthBlocks', v);
      });
      addSliderField(div, 'intensityPct', sb.intensityPct, 0, 100, v => {
        sb.intensityPct = v;
        callbacks?.onPropertyChange('sunbeam.intensityPct', v);
      });
      addColorSliders(div, 'color', sb.colorR, sb.colorG, sb.colorB, (r, g, b) => {
        sb.colorR = r;
        sb.colorG = g;
        sb.colorB = b;
        callbacks?.onPropertyChange('sunbeam.color', 0);
      });
    }
  } else if (el.type === 'sceneLight') {
    const sl = (room.sceneLights ?? []).find(s => s.uid === el.uid);
    if (sl) {
      addNumberField(div, 'xWorld', sl.xWorld, 0, 99999, v => {
        sl.xWorld = v;
        callbacks?.onPropertyChange('sceneLight.xWorld', v);
      });
      addNumberField(div, 'yWorld', sl.yWorld, 0, 99999, v => {
        sl.yWorld = v;
        callbacks?.onPropertyChange('sceneLight.yWorld', v);
      });
      addSelect(div, 'kind',
        SCENE_LIGHT_TYPE_OPTIONS.map(t => ({ label: t.label, value: t.id })),
        sl.kind,
        v => {
          sl.kind = v as typeof sl.kind;
          callbacks?.onPropertyChange('sceneLight.kind', v);
        },
      );
      addNumberField(div, 'radiusWorld', sl.radiusWorld, 1, 2048, v => {
        sl.radiusWorld = v;
        callbacks?.onPropertyChange('sceneLight.radiusWorld', v);
      });
      addSliderField(div, 'intensityPct', sl.intensityPct, 0, 100, v => {
        sl.intensityPct = v;
        callbacks?.onPropertyChange('sceneLight.intensityPct', v);
      });
      addColorSliders(div, 'color', sl.colorR, sl.colorG, sl.colorB, (r, g, b) => {
        sl.colorR = r;
        sl.colorG = g;
        sl.colorB = b;
        callbacks?.onPropertyChange('sceneLight.color', 0);
      });
      addSelect(div, 'blendMode',
        [
          { label: 'Add', value: 'add' },
          { label: 'Screen', value: 'screen' },
          { label: 'Multiply', value: 'multiply' },
          { label: 'Normal', value: 'normal' },
        ],
        sl.blendMode,
        v => {
          sl.blendMode = v as typeof sl.blendMode;
          callbacks?.onPropertyChange('sceneLight.blendMode', v);
        },
      );
      addCheckbox(div, 'castsShadows', sl.castsShadowsFlag === 1, v => {
        sl.castsShadowsFlag = v ? 1 : 0;
        callbacks?.onPropertyChange('sceneLight.castsShadowsFlag', sl.castsShadowsFlag);
      });
      if (sl.kind === 'spotlight') {
        addNumberField(div, 'coneAngleRad', sl.coneAngleRad ?? Math.PI / 4, 0.1, Math.PI, v => {
          sl.coneAngleRad = v;
          callbacks?.onPropertyChange('sceneLight.coneAngleRad', v);
        });
        addNumberField(div, 'rotationRad', sl.rotationRad ?? 0, -Math.PI, Math.PI, v => {
          sl.rotationRad = v;
          callbacks?.onPropertyChange('sceneLight.rotationRad', v);
        });
      } else if (sl.kind === 'sunray') {
        addNumberField(div, 'angleRad', sl.angleRad ?? (Math.PI / 2), -Math.PI, Math.PI, v => {
          sl.angleRad = v;
          callbacks?.onPropertyChange('sceneLight.angleRad', v);
        });
        addNumberField(div, 'lengthWorld', sl.lengthWorld ?? sl.radiusWorld, 4, 4096, v => {
          sl.lengthWorld = v;
          callbacks?.onPropertyChange('sceneLight.lengthWorld', v);
        });
        addNumberField(div, 'widthStartWorld', sl.widthStartWorld ?? 2, 0.25, 1024, v => {
          sl.widthStartWorld = v;
          callbacks?.onPropertyChange('sceneLight.widthStartWorld', v);
        });
        addNumberField(div, 'widthEndWorld', sl.widthEndWorld ?? 32, 0.25, 2048, v => {
          sl.widthEndWorld = v;
          callbacks?.onPropertyChange('sceneLight.widthEndWorld', v);
        });
        addSliderField(div, 'opacity%', Math.round((sl.opacity ?? 0.6) * 100), 0, 100, v => {
          sl.opacity = v / 100;
          callbacks?.onPropertyChange('sceneLight.opacity', v);
        });
        addSliderField(div, 'softness%', Math.round((sl.softness ?? 0.85) * 100), 0, 100, v => {
          sl.softness = v / 100;
          callbacks?.onPropertyChange('sceneLight.softness', v);
        });
        addNumberField(div, 'strandCount', sl.strandCount ?? 6, 1, 16, v => {
          sl.strandCount = Math.round(v);
          callbacks?.onPropertyChange('sceneLight.strandCount', v);
        });
        addSliderField(div, 'noiseStrength%', Math.round((sl.noiseStrength ?? 0.15) * 100), 0, 100, v => {
          sl.noiseStrength = v / 100;
          callbacks?.onPropertyChange('sceneLight.noiseStrength', v);
        });
        addSliderField(div, 'flickerStrength%', Math.round((sl.flickerStrength ?? 0.03) * 100), 0, 100, v => {
          sl.flickerStrength = v / 100;
          callbacks?.onPropertyChange('sceneLight.flickerStrength', v);
        });
        addCheckbox(div, 'dustEnabled', (sl.dustEnabledFlag ?? 1) === 1, v => {
          sl.dustEnabledFlag = v ? 1 : 0;
          callbacks?.onPropertyChange('sceneLight.dustEnabledFlag', sl.dustEnabledFlag);
        });
        addNumberField(div, 'dustDensity', sl.dustDensity ?? 1, 0, 5, v => {
          sl.dustDensity = v;
          callbacks?.onPropertyChange('sceneLight.dustDensity', v);
        });
        addNumberField(div, 'dustSpeed', sl.dustSpeed ?? 1, 0.05, 4, v => {
          sl.dustSpeed = v;
          callbacks?.onPropertyChange('sceneLight.dustSpeed', v);
        });
        addNumberField(div, 'dustSizeMinWorld', sl.dustSizeMinWorld ?? 0.35, 0.1, 6, v => {
          sl.dustSizeMinWorld = v;
          callbacks?.onPropertyChange('sceneLight.dustSizeMinWorld', v);
        });
        addNumberField(div, 'dustSizeMaxWorld', sl.dustSizeMaxWorld ?? 1.2, 0.1, 8, v => {
          sl.dustSizeMaxWorld = v;
          callbacks?.onPropertyChange('sceneLight.dustSizeMaxWorld', v);
        });
      }
      addSliderField(div, 'shadowSoftness', (sl.shadowSoftness ?? 0) * 100, 0, 100, v => {
        sl.shadowSoftness = v / 100;
        callbacks?.onPropertyChange('sceneLight.shadowSoftness', v);
      });
      addCheckbox(div, 'isPulsing', sl.isPulsingFlag === 1, v => {
        sl.isPulsingFlag = v ? 1 : 0;
        callbacks?.onPropertyChange('sceneLight.isPulsingFlag', sl.isPulsingFlag);
      });
      if (sl.isPulsingFlag === 1) {
        addNumberField(div, 'pulseSpeedHz', sl.pulseSpeedHz ?? 1, 0.1, 10, v => {
          sl.pulseSpeedHz = v;
          callbacks?.onPropertyChange('sceneLight.pulseSpeedHz', v);
        });
        addSliderField(div, 'pulseAmplitude%', (sl.pulseAmplitude ?? 0.2) * 100, 0, 100, v => {
          sl.pulseAmplitude = v / 100;
          callbacks?.onPropertyChange('sceneLight.pulseAmplitude', v);
        });
      }
    }
  } else if (el.type === 'challengeField' || el.type === 'challengeGate') {
    const prefix = el.type;
    const elements = el.type === 'challengeField' ? room.challengeFields : room.challengeGates;
    const rect = (elements ?? []).find(candidate => candidate.uid === el.uid);
    if (rect) {
      addField(div, 'xBlock', String(rect.xBlock), value => callbacks?.onPropertyChange(`${prefix}.xBlock`, parseInt(value)));
      addField(div, 'yBlock', String(rect.yBlock), value => callbacks?.onPropertyChange(`${prefix}.yBlock`, parseInt(value)));
      addField(div, 'Width (blocks)', String(rect.wBlock), value => callbacks?.onPropertyChange(`${prefix}.wBlock`, parseInt(value)));
      addField(div, 'Height (blocks)', String(rect.hBlock), value => callbacks?.onPropertyChange(`${prefix}.hBlock`, parseInt(value)));
    }
  } else if (el.type === 'gate') {
    const gate = (room.gates ?? []).find(candidate => candidate.uid === el.uid);
    if (gate) {
      addSelect(div, 'type', [
        { label: 'Enemy Gate', value: 'enemy' }, { label: 'Challenge Gate', value: 'challenge' },
        { label: 'Heart Gate', value: 'heart' }, { label: 'Speed Gate', value: 'speed' },
      ], gate.kind, value => callbacks?.onPropertyChange('gate.kind', value));
      addField(div, 'xBlock', String(gate.xBlock), value => callbacks?.onPropertyChange('gate.xBlock', parseInt(value)));
      addField(div, 'yBlock', String(gate.yBlock), value => callbacks?.onPropertyChange('gate.yBlock', parseInt(value)));
      addField(div, 'Width (blocks)', String(gate.wBlock), value => callbacks?.onPropertyChange('gate.wBlock', parseInt(value)));
      addField(div, 'Height (blocks)', String(gate.hBlock), value => callbacks?.onPropertyChange('gate.hBlock', parseInt(value)));
      addSelect(div, 'Open visual mode', [
        { label: 'Dark Recessed', value: 'darkRecessed' }, { label: 'Fade Away', value: 'fadeAway' }, { label: 'Powder', value: 'powder' },
      ], gate.openVisualMode, value => callbacks?.onPropertyChange('gate.openVisualMode', value));
      addSelect(div, 'Open persistence', [
        { label: 'Forever', value: 'forever' }, { label: 'Until Player Saves', value: 'untilPlayerSaves' },
        { label: 'Until Player Leaves Room', value: 'untilPlayerLeavesRoom' },
      ], gate.openPersistence, value => callbacks?.onPropertyChange('gate.openPersistence', value));
      if (gate.kind === 'speed') addNumberField(div, 'Required speed (world units/s)', gate.requiredSpeed ?? 180, 0, 5000, value => callbacks?.onPropertyChange('gate.requiredSpeed', value));
    }
  } else if (el.type === 'challengeTotem') {
    const totem = (room.challengeTotems ?? []).find(candidate => candidate.uid === el.uid);
    if (totem) {
      addField(div, 'xBlock', String(totem.xBlock), value => callbacks?.onPropertyChange('challengeTotem.xBlock', parseInt(value)));
      addField(div, 'yBlock', String(totem.yBlock), value => callbacks?.onPropertyChange('challengeTotem.yBlock', parseInt(value)));
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
  } else if (el.type === 'spike') {
    const sp = (room.spikes ?? []).find(s => s.uid === el.uid);
    if (sp) {
      addField(div, 'xBlock', String(sp.xBlock),
        v => callbacks?.onPropertyChange('spike.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(sp.yBlock),
        v => callbacks?.onPropertyChange('spike.yBlock', parseInt(v)));
      addSelect(div, 'direction',
        [
          { label: 'Up',    value: 'up' },
          { label: 'Right', value: 'right' },
          { label: 'Down',  value: 'down' },
          { label: 'Left',  value: 'left' },
        ],
        sp.direction,
        v => callbacks?.onPropertyChange('spike.direction', v));
      addSelect(div, 'size',
        [
          { label: '1×1', value: '1x1' },
          { label: '2×2', value: '2x2' },
        ],
        sp.size,
        v => callbacks?.onPropertyChange('spike.size', v));
      addSelect(div, 'blockTheme',
        BLOCK_THEMES.map(t => ({ label: t.label, value: t.id })),
        sp.blockTheme ?? room.blockTheme,
        v => callbacks?.onPropertyChange('spike.blockTheme', v));
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
      addSelect(div, 'thickness',
        ROPE_THICKNESS_OPTIONS.map(o => ({ label: o.label, value: String(o.id) })),
        String(rope.thicknessIndex ?? 0),
        v => callbacks?.onPropertyChange('rope.thicknessIndex', parseInt(v)));
      addCheckbox(div, 'anchorBFixed', rope.isAnchorBFixedFlag === 1,
        v => callbacks?.onPropertyChange('rope.isAnchorBFixedFlag', v ? 1 : 0));
    }
  } else if (el.type === 'dialogueTrigger') {
    buildDialogueTriggerInspector(div, el.uid, state, callbacks);
  } else if (el.type === 'guideDustPath') {
    const paths = room.guideDustPaths ?? [];
    const path = paths.find(p => p.uid === el.uid);
    if (path) {
      addField(div, 'control points', String(path.points.length), () => {});
      addCheckbox(div, 'loop', path.loop,
        v => callbacks?.onPropertyChange('guideDustPath.loop', v ? 1 : 0));
      addCheckbox(div, 'visible in game', path.visibleInGame,
        v => callbacks?.onPropertyChange('guideDustPath.visibleInGame', v ? 1 : 0));
      addNumberField(div, 'mote count', path.moteCount, 3, 20,
        v => callbacks?.onPropertyChange('guideDustPath.moteCount', v));
      addSliderField(div, 'speed factor', path.moteSpeedFactor, 0.1, 5.0,
        v => callbacks?.onPropertyChange('guideDustPath.moteSpeedFactor', v));
      addSliderField(div, 'opacity %', path.opacityPct, 0, 100,
        v => callbacks?.onPropertyChange('guideDustPath.opacityPct', v));
      // Per-point speed for the currently selected control point
      const selPtIdx = state.guideDustPathSelectedPointIndex;
      if (selPtIdx !== null && path.points[selPtIdx] !== undefined) {
        addSliderField(div, `pt ${selPtIdx} speed`, path.points[selPtIdx].speed, 0.1, 5.0,
          v => callbacks?.onPropertyChange('guideDustPath.point.speed', v));
      }
    }
  }
}
