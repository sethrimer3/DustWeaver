import {
  EditorState,
  EditorUICallbacks,
  CrumbleVariant,
  CRUMBLE_VARIANT_OPTIONS,
  DUST_KIND_OPTIONS,
} from './editorState';
import { WEAVE_LIST, WEAVE_REGISTRY } from '../sim/weaves/weaveDefinition';
import { TEXT_COLOR } from './editorStyles';

export interface EditorSpecialItemPickers {
  skillTombPickerDiv: HTMLDivElement;
  crumblePickerDiv: HTMLDivElement;
  dustJarPickerDiv: HTMLDivElement;
  update: (state: EditorState) => void;
}

export function createEditorSpecialItemPickers(
  getCallbacks: () => EditorUICallbacks | null,
): EditorSpecialItemPickers {
  const skillTombPickerDiv = document.createElement('div');
  skillTombPickerDiv.style.cssText = `
    border: 1px solid rgba(212,168,75,0.5); border-radius: 3px;
    padding: 6px 8px; margin-top: 8px; background: rgba(20,15,0,0.4); display: none;
  `;
  const skillTombPickerTitle = document.createElement('div');
  skillTombPickerTitle.textContent = 'Skill in Tomb';
  skillTombPickerTitle.style.cssText = 'font-size: 11px; color: #d4a84b; margin-bottom: 6px; font-weight: bold;';
  skillTombPickerDiv.appendChild(skillTombPickerTitle);
  const skillTombSelect = document.createElement('select');
  skillTombSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid rgba(212,168,75,0.4);
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const weaveId of WEAVE_LIST) {
    const def = WEAVE_REGISTRY.get(weaveId);
    const o = document.createElement('option');
    o.value = weaveId;
    o.textContent = def?.displayName ?? weaveId;
    skillTombSelect.appendChild(o);
  }
  skillTombSelect.addEventListener('change', () => {
    getCallbacks()?.onSkillTombWeaveChange(skillTombSelect.value);
  });
  skillTombSelect.addEventListener('click', (e) => e.stopPropagation());
  skillTombPickerDiv.appendChild(skillTombSelect);

  const crumblePickerDiv = document.createElement('div');
  crumblePickerDiv.style.cssText = `
    border: 1px solid rgba(200,150,60,0.5); border-radius: 3px;
    padding: 6px 8px; margin-top: 8px; background: rgba(20,12,0,0.4); display: none;
  `;
  const crumblePickerTitle = document.createElement('div');
  crumblePickerTitle.textContent = 'Crumble Weakness';
  crumblePickerTitle.style.cssText = 'font-size: 11px; color: #c8a060; margin-bottom: 6px; font-weight: bold;';
  crumblePickerDiv.appendChild(crumblePickerTitle);
  const crumbleVariantSelect = document.createElement('select');
  crumbleVariantSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid rgba(200,150,60,0.4);
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const opt of CRUMBLE_VARIANT_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    crumbleVariantSelect.appendChild(o);
  }
  crumbleVariantSelect.addEventListener('change', () => {
    getCallbacks()?.onCrumbleVariantChange(crumbleVariantSelect.value as CrumbleVariant);
  });
  crumbleVariantSelect.addEventListener('click', (e) => e.stopPropagation());
  crumblePickerDiv.appendChild(crumbleVariantSelect);

  const dustJarPickerDiv = document.createElement('div');
  dustJarPickerDiv.style.cssText = `
    border: 1px solid rgba(200,100,255,0.5); border-radius: 3px;
    padding: 6px 8px; margin-top: 8px; background: rgba(15,0,20,0.4); display: none;
  `;
  const dustJarPickerTitle = document.createElement('div');
  dustJarPickerTitle.textContent = 'Dust Jar Contents';
  dustJarPickerTitle.style.cssText = 'font-size: 11px; color: #d080ff; margin-bottom: 6px; font-weight: bold;';
  dustJarPickerDiv.appendChild(dustJarPickerTitle);
  const dustJarKindSelect = document.createElement('select');
  dustJarKindSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid rgba(200,100,255,0.4);
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px; margin-bottom: 4px;
  `;
  for (const kind of DUST_KIND_OPTIONS) {
    const o = document.createElement('option');
    o.value = kind;
    o.textContent = kind;
    dustJarKindSelect.appendChild(o);
  }
  dustJarKindSelect.addEventListener('change', () => {
    getCallbacks()?.onDustBoostJarKindChange(dustJarKindSelect.value);
  });
  dustJarKindSelect.addEventListener('click', (e) => e.stopPropagation());
  dustJarPickerDiv.appendChild(dustJarKindSelect);
  const dustJarCountLabel = document.createElement('div');
  dustJarCountLabel.textContent = 'Dust count';
  dustJarCountLabel.style.cssText = 'font-size: 10px; color: rgba(200,200,200,0.6); margin-bottom: 2px;';
  dustJarPickerDiv.appendChild(dustJarCountLabel);
  const dustJarCountInput = document.createElement('input');
  dustJarCountInput.type = 'number';
  dustJarCountInput.min = '1';
  dustJarCountInput.max = '20';
  dustJarCountInput.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid rgba(200,100,255,0.4);
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px; box-sizing: border-box;
  `;
  dustJarCountInput.addEventListener('change', () => {
    const value = parseInt(dustJarCountInput.value);
    if (!isNaN(value) && value >= 1 && value <= 20) getCallbacks()?.onDustBoostJarCountChange(value);
  });
  dustJarCountInput.addEventListener('click', (e) => e.stopPropagation());
  dustJarPickerDiv.appendChild(dustJarCountInput);

  function update(state: EditorState): void {
    const isSkillTombSelected = state.selectedPaletteItem?.id === 'skill_tomb';
    skillTombPickerDiv.style.display = isSkillTombSelected ? '' : 'none';
    if (isSkillTombSelected && document.activeElement !== skillTombSelect) {
      skillTombSelect.value = state.pendingSkillTombWeaveId;
    }

    const isCrumbleSelected = state.selectedPaletteItem?.isCrumbleBlockItem === 1;
    crumblePickerDiv.style.display = isCrumbleSelected ? '' : 'none';
    if (isCrumbleSelected && document.activeElement !== crumbleVariantSelect) {
      crumbleVariantSelect.value = state.pendingCrumbleVariant;
    }

    const isDustBoostJarSelected = state.selectedPaletteItem?.isDustBoostJarItem === 1
      || state.selectedPaletteItem?.id === 'dust_boost_jar';
    dustJarPickerDiv.style.display = isDustBoostJarSelected ? '' : 'none';
    if (isDustBoostJarSelected) {
      if (document.activeElement !== dustJarKindSelect) {
        dustJarKindSelect.value = state.pendingDustBoostJarKind;
      }
      if (document.activeElement !== dustJarCountInput) {
        dustJarCountInput.value = String(state.pendingDustBoostJarCount);
      }
    }
  }

  return {
    skillTombPickerDiv,
    crumblePickerDiv,
    dustJarPickerDiv,
    update,
  };
}
