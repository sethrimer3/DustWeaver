/**
 * Weave Loadout selection screen.
 *
 * Shows the Weaver's loadout: primary and secondary Weave slots, each with
 * dust binding capacity. The player selects Weaves and assigns dust types
 * to each Weave. The total dust slot cost per weave must not exceed that
 * Weave's dust slot capacity.
 *
 * UI layout:
 *   - Header with title and level info
 *   - Two Weave panels (Primary / Secondary) side by side
 *     - Each shows the equipped Weave and its bound dust
 *     - Slot meter per Weave
 *   - Available dust list below for drag-to-assign
 *   - Bottom action bar with Back and Enter Battle buttons
 */

import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import { PlayerProgress } from '../progression/playerProgress';
import {
  PlayerWeaveLoadout,
  WeaveBinding,
  getBindingSlotCost,
  isBindingValid,
  isLoadoutValid,
  createDefaultWeaveLoadout,
} from '../sim/weaves/playerLoadout';
import { getDustDefinition } from '../sim/weaves/dustDefinition';
import {
  WEAVE_LIST,
  getWeaveDefinition,
} from '../sim/weaves/weaveDefinition';

export interface LoadoutCallbacks {
  onConfirm: (loadout: ParticleKind[], weaveLoadout: PlayerWeaveLoadout) => void;
  onCancel: () => void;
}

// ---- Screen factory ----------------------------------------------------------

export function showLoadoutScreen(
  root: HTMLElement,
  progress: PlayerProgress,
  callbacks: LoadoutCallbacks,
): () => void {
  // Working copy of the weave loadout
  let weaveLoadout: PlayerWeaveLoadout = progress.weaveLoadout
    ? JSON.parse(JSON.stringify(progress.weaveLoadout))
    : createDefaultWeaveLoadout();

  // ---- Root container --------------------------------------------------
  const el = document.createElement('div');
  el.id = 'loadout-screen';
  el.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(5,5,15,0.97);
    color: #eee; font-family: 'Cinzel', serif;
    display: flex; flex-direction: column; align-items: center;
    overflow-y: auto; box-sizing: border-box; padding: 20px 16px 80px;
  `;
  root.appendChild(el);

  // ---- Header ----------------------------------------------------------
  const header = document.createElement('div');
  header.style.cssText = 'text-align:center; margin-bottom:18px; width:100%;';
  header.innerHTML = `
    <h2 style="font-size:1.6rem; color:#00cfff; margin:0 0 4px;">Weaver Loadout</h2>
    <p style="color:#888; font-size:0.8rem; margin:0;">
      Level ${progress.level} &nbsp;|&nbsp; Equip Weaves and bind Dust to each technique.
    </p>
  `;
  el.appendChild(header);

  // ---- Weave panels container ------------------------------------------
  const panelsContainer = document.createElement('div');
  panelsContainer.style.cssText = `
    display: flex; gap: 16px; width: 100%; max-width: 760px;
    flex-wrap: wrap; justify-content: center; margin-bottom: 20px;
  `;
  el.appendChild(panelsContainer);

  // Store render functions for weave panels (avoids `any` cast on DOM elements)
  const panelRenderFns = new WeakMap<HTMLDivElement, () => void>();

  // Helper: create a weave panel
  function createWeavePanel(
    label: string,
    labelColor: string,
    getBinding: () => WeaveBinding,
    setBinding: (b: WeaveBinding) => void,
  ): HTMLDivElement {
    const panel = document.createElement('div');
    panel.style.cssText = `
      flex: 1; min-width: 300px; max-width: 380px;
      background: #0d0d1a; border: 2px solid #333; border-radius: 10px;
      padding: 14px; box-sizing: border-box;
    `;

    function renderPanel(): void {
      const binding = getBinding();
      const weaveDef = getWeaveDefinition(binding.weaveId);
      const usedSlots = getBindingSlotCost(binding);
      const totalSlots = weaveDef.dustSlotCapacity;
      const isValid = isBindingValid(binding);

      panel.innerHTML = '';

      // Label
      const labelEl = document.createElement('div');
      labelEl.style.cssText = `font-size:0.75rem; color:${labelColor}; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;`;
      labelEl.textContent = label;
      panel.appendChild(labelEl);

      // Weave selector
      const weaveRow = document.createElement('div');
      weaveRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:10px;';

      const weaveSelect = document.createElement('select');
      weaveSelect.style.cssText = `
        background: #111; color: #eee; border: 1px solid #555; border-radius: 4px;
        padding: 4px 8px; font-family: 'Cinzel', serif; font-size: 0.85rem;
        cursor: pointer; flex: 1;
      `;
      for (const wId of WEAVE_LIST) {
        const wd = getWeaveDefinition(wId);
        const opt = document.createElement('option');
        opt.value = wId;
        opt.textContent = `${wd.displayName} (${wd.dustSlotCapacity} slots)`;
        if (wId === binding.weaveId) opt.selected = true;
        weaveSelect.appendChild(opt);
      }
      weaveSelect.addEventListener('change', () => {
        const newWeaveId = weaveSelect.value;
        // When changing weave, keep as many bound dust as fit
        const newDef = getWeaveDefinition(newWeaveId);
        const newBound: ParticleKind[] = [];
        let cost = 0;
        for (const kind of binding.boundDust) {
          const dustCost = getDustDefinition(kind).slotCost;
          if (cost + dustCost <= newDef.dustSlotCapacity) {
            newBound.push(kind);
            cost += dustCost;
          }
        }
        setBinding({ weaveId: newWeaveId, boundDust: newBound });
        renderPanel();
        renderDustPool();
        updateStartButton();
      });
      weaveRow.appendChild(weaveSelect);
      panel.appendChild(weaveRow);

      // Weave description
      const descEl = document.createElement('p');
      descEl.style.cssText = 'color:#666; font-size:0.7rem; margin:0 0 10px; line-height:1.3;';
      descEl.textContent = weaveDef.description;
      panel.appendChild(descEl);

      // Slot meter
      const meterEl = document.createElement('div');
      const pct = Math.min(100, (usedSlots / totalSlots) * 100);
      const barColor = !isValid ? '#ff4444' : usedSlots >= totalSlots ? '#00ff88' : '#00cfff';
      meterEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="color:#aaa; font-size:0.75rem;">DUST SLOTS</span>
          <span style="color:${!isValid ? '#ff4444' : '#eee'}; font-size:0.8rem; font-weight:bold;">
            ${usedSlots} / ${totalSlots}
          </span>
        </div>
        <div style="height:6px; background:#222; border-radius:3px; overflow:hidden; margin-bottom:10px;">
          <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:3px; transition:width 0.2s;"></div>
        </div>
      `;
      panel.appendChild(meterEl);

      // Bound dust list
      const boundLabel = document.createElement('div');
      boundLabel.style.cssText = 'color:#888; font-size:0.7rem; margin-bottom:6px;';
      boundLabel.textContent = 'BOUND DUST:';
      panel.appendChild(boundLabel);

      if (binding.boundDust.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'color:#555; font-size:0.72rem; font-style:italic; padding:6px 0;';
        emptyMsg.textContent = 'No dust bound. Click dust below to assign.';
        panel.appendChild(emptyMsg);
      } else {
        const boundGrid = document.createElement('div');
        boundGrid.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px;';
        for (let bi = 0; bi < binding.boundDust.length; bi++) {
          const kind = binding.boundDust[bi];
          const def = getDustDefinition(kind);
          const chip = document.createElement('div');
          chip.style.cssText = `
            display:flex; align-items:center; gap:4px;
            background:#1a1a2e; border:1px solid ${def.colorHex}44; border-radius:4px;
            padding:3px 8px; cursor:pointer; font-size:0.72rem; color:${def.colorHex};
          `;
          chip.innerHTML = `${def.displayName} <span style="color:#888">(${def.slotCost})</span> <span style="color:#ff4444;font-weight:bold;">✕</span>`;
          chip.title = 'Click to unbind';
          const removeIdx = bi;
          chip.addEventListener('click', () => {
            const newBound = binding.boundDust.slice();
            newBound.splice(removeIdx, 1);
            setBinding({ weaveId: binding.weaveId, boundDust: newBound });
            renderPanel();
            renderDustPool();
            updateStartButton();
          });
          boundGrid.appendChild(chip);
        }
        panel.appendChild(boundGrid);
      }
    }

    renderPanel();
    panelRenderFns.set(panel, renderPanel);
    return panel;
  }

  // State accessors
  const primaryPanel = createWeavePanel(
    '⚔ Primary Weave (Left Click)',
    '#00cfff',
    () => weaveLoadout.primary,
    (b) => { weaveLoadout.primary = b; },
  );
  const secondaryPanel = createWeavePanel(
    '🛡 Secondary Weave (Right Click)',
    '#ffaa00',
    () => weaveLoadout.secondary,
    (b) => { weaveLoadout.secondary = b; },
  );
  panelsContainer.appendChild(primaryPanel);
  panelsContainer.appendChild(secondaryPanel);

  // ---- Available dust pool -----------------------------------------------
  const dustPoolHeader = document.createElement('div');
  dustPoolHeader.style.cssText = 'color:#aaa; font-size:0.8rem; margin-bottom:8px; text-align:center; width:100%; max-width:760px;';
  dustPoolHeader.textContent = 'AVAILABLE DUST — Click to bind to a Weave';
  el.appendChild(dustPoolHeader);

  const dustPoolEl = document.createElement('div');
  dustPoolEl.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 8px; width: 100%; max-width: 760px;
  `;
  el.appendChild(dustPoolEl);

  /** Which panel is selected for receiving dust (0=primary, 1=secondary). */
  let targetPanel: 0 | 1 = 0;

  // Panel selection indicators
  const panelSelectRow = document.createElement('div');
  panelSelectRow.style.cssText = 'display:flex; gap:12px; margin-bottom:14px; width:100%; max-width:760px; justify-content:center;';

  function createPanelSelectBtn(labelText: string, panelIdx: 0 | 1, color: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = `
      background: transparent; border: 2px solid ${color}; color: ${color};
      padding: 6px 16px; font-size: 0.78rem; font-family: 'Cinzel', serif;
      cursor: pointer; border-radius: 6px; transition: background 0.15s;
    `;
    btn.textContent = labelText;
    btn.addEventListener('click', () => {
      targetPanel = panelIdx;
      updatePanelSelectBtns();
    });
    return btn;
  }

  const primarySelectBtn = createPanelSelectBtn('Bind to Primary', 0, '#00cfff');
  const secondarySelectBtn = createPanelSelectBtn('Bind to Secondary', 1, '#ffaa00');
  panelSelectRow.appendChild(primarySelectBtn);
  panelSelectRow.appendChild(secondarySelectBtn);
  el.insertBefore(panelSelectRow, dustPoolHeader);

  function updatePanelSelectBtns(): void {
    primarySelectBtn.style.background = targetPanel === 0 ? '#00cfff22' : 'transparent';
    primarySelectBtn.style.fontWeight = targetPanel === 0 ? 'bold' : 'normal';
    secondarySelectBtn.style.background = targetPanel === 1 ? '#ffaa0022' : 'transparent';
    secondarySelectBtn.style.fontWeight = targetPanel === 1 ? 'bold' : 'normal';
  }
  updatePanelSelectBtns();

  function renderDustPool(): void {
    dustPoolEl.innerHTML = '';

    for (let k = 0; k < EQUIPPABLE_KINDS.length; k++) {
      const kind = EQUIPPABLE_KINDS[k];
      const def = getDustDefinition(kind);

      const card = document.createElement('div');
      card.style.cssText = `
        border: 1px solid #333; border-radius: 6px; padding: 8px;
        cursor: pointer; transition: border-color 0.15s, background 0.15s;
        background: #0d0d1a; user-select: none;
        display: flex; flex-direction: column; gap: 3px;
      `;

      // Name + cost
      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
      nameRow.innerHTML = `
        <span style="color:${def.colorHex}; font-size:0.78rem; font-weight:bold;">${def.displayName}</span>
        <span style="
          background:#1a1a2e; border:1px solid #444; border-radius:3px;
          padding:1px 5px; font-size:0.68rem; color:#ccc;
        ">${def.slotCost} slot${def.slotCost !== 1 ? 's' : ''}</span>
      `;
      card.appendChild(nameRow);

      // Description
      const desc = document.createElement('p');
      desc.style.cssText = 'color:#666; font-size:0.65rem; margin:0; line-height:1.2;';
      desc.textContent = def.description;
      card.appendChild(desc);

      // Check if this dust can fit in the target weave
      const binding = targetPanel === 0 ? weaveLoadout.primary : weaveLoadout.secondary;
      const weaveDef = getWeaveDefinition(binding.weaveId);
      const usedSlots = getBindingSlotCost(binding);
      const canFit = usedSlots + def.slotCost <= weaveDef.dustSlotCapacity;

      if (!canFit) {
        card.style.opacity = '0.4';
        card.style.cursor = 'default';
      }

      card.addEventListener('click', () => {
        if (!canFit) return;
        const currentBinding = targetPanel === 0 ? weaveLoadout.primary : weaveLoadout.secondary;
        const newBound = [...currentBinding.boundDust, kind];
        const newBinding: WeaveBinding = { weaveId: currentBinding.weaveId, boundDust: newBound };
        if (!isBindingValid(newBinding)) return;

        if (targetPanel === 0) {
          weaveLoadout.primary = newBinding;
        } else {
          weaveLoadout.secondary = newBinding;
        }

        // Re-render everything
        panelRenderFns.get(primaryPanel)?.();
        panelRenderFns.get(secondaryPanel)?.();
        renderDustPool();
        updateStartButton();
      });

      dustPoolEl.appendChild(card);
    }
  }

  renderDustPool();

  // ---- Bottom action bar -----------------------------------------------
  const actionBar = document.createElement('div');
  actionBar.style.cssText = `
    position: fixed; bottom: 0; left: 0; right: 0;
    display: flex; gap: 12px; justify-content: center; align-items: center;
    padding: 14px 20px;
    background: rgba(5,5,15,0.95); border-top: 1px solid #222;
  `;
  root.appendChild(actionBar);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '← Back';
  cancelBtn.style.cssText = `
    background: transparent; border: 2px solid #555; color: #aaa;
    padding: 10px 22px; font-size: 0.9rem; font-family: 'Cinzel', serif;
    cursor: pointer; border-radius: 6px;
  `;
  cancelBtn.addEventListener('click', () => callbacks.onCancel());
  actionBar.appendChild(cancelBtn);

  const startBtn = document.createElement('button');
  startBtn.id = 'loadout-start-btn';
  startBtn.style.cssText = `
    background: transparent; border: 2px solid #00cfff; color: #00cfff;
    padding: 10px 28px; font-size: 0.95rem; font-family: 'Cinzel', serif;
    cursor: pointer; border-radius: 6px; font-weight: bold;
  `;
  startBtn.addEventListener('click', () => {
    if (!isLoadoutValid(weaveLoadout)) return;
    const hasDust = weaveLoadout.primary.boundDust.length > 0 || weaveLoadout.secondary.boundDust.length > 0;
    if (!hasDust) return;
    // Build legacy flat loadout from all bound dust for backward compat
    const flatLoadout = [...weaveLoadout.primary.boundDust, ...weaveLoadout.secondary.boundDust];
    const uniqueLoadout = Array.from(new Set(flatLoadout));
    callbacks.onConfirm(uniqueLoadout, weaveLoadout);
  });
  actionBar.appendChild(startBtn);

  function updateStartButton(): void {
    const valid = isLoadoutValid(weaveLoadout);
    const hasDust = weaveLoadout.primary.boundDust.length > 0 || weaveLoadout.secondary.boundDust.length > 0;
    const canStart = valid && hasDust;
    const totalDust = weaveLoadout.primary.boundDust.length + weaveLoadout.secondary.boundDust.length;
    startBtn.textContent = canStart
      ? `⚔ Enter Battle (${totalDust} dust bound)`
      : 'Bind at least one Dust type';
    startBtn.disabled = !canStart;
    startBtn.style.opacity = canStart ? '1' : '0.4';
    startBtn.style.cursor = canStart ? 'pointer' : 'default';
  }

  updateStartButton();

  // Cleanup
  return () => {
    if (el.parentElement !== null) el.parentElement.removeChild(el);
    if (actionBar.parentElement !== null) actionBar.parentElement.removeChild(actionBar);
  };
}
