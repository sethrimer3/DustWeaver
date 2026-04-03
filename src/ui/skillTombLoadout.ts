/**
 * Loadout tab for the Skill Tomb menu.
 *
 * Builds the weave panels, target selector, and dust grid that let the
 * player bind dust to their primary / secondary weave slots.
 */

import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import {
  PlayerWeaveLoadout, getBindingSlotCost,
  addDustToBinding, removeDustFromBinding,
} from '../sim/weaves/playerLoadout';
import { getDustDefinition } from '../sim/weaves/dustDefinition';
import { WEAVE_LIST, getWeaveDefinition } from '../sim/weaves/weaveDefinition';
import { GOLD } from './skillTombShared';

// ── Display metadata per kind ─────────────────────────────────────────────────

interface KindMeta {
  name: string;
  description: string;
  colorHex: string;
}

const KIND_META: KindMeta[] = [
  { name: 'Physical',  colorHex: '#7799aa', description: 'Dense, grounded particles. Steady and reliable.' },
  { name: 'Fire',      colorHex: '#ff5500', description: 'Flickering flames. Chaotic and short-lived.' },
  { name: 'Ice',       colorHex: '#88ddff', description: 'Crystalline frost. Structured and long-lived.' },
  { name: 'Lightning', colorHex: '#ffff44', description: 'Electric sparks. Explosive and volatile.' },
  { name: 'Poison',    colorHex: '#44ff44', description: 'Toxic cloud. Sticky and diffuse.' },
  { name: 'Arcane',    colorHex: '#cc44ff', description: 'Mystic spiral. Strange turbulence.' },
  { name: 'Wind',      colorHex: '#88ffee', description: 'Rushing gusts. Fast and highly aligned.' },
  { name: 'Holy',      colorHex: '#ffeeaa', description: 'Sacred light. Rising and orderly.' },
  { name: 'Shadow',    colorHex: '#9966ff', description: 'Dark tendrils. Sinking and unstable.' },
  { name: 'Metal',     colorHex: '#aabbcc', description: 'Iron shards. Dense, durable. Reflects damage when blocking.' },
  { name: 'Earth',     colorHex: '#aa8833', description: 'Stone fragments. Grounded and steady.' },
  { name: 'Nature',    colorHex: '#44cc44', description: 'Living vines. Organic and gentle.' },
  { name: 'Crystal',   colorHex: '#aaeeff', description: 'Prismatic shards. Precise and brilliant.' },
  { name: 'Void',      colorHex: '#9933cc', description: 'Dark matter rings. Exotic and powerful.' },
  { name: 'Water',     colorHex: '#2299ee', description: 'Flowing currents. Fluid and persistent.' },
  { name: 'Lava',      colorHex: '#ff2200', description: 'Molten rock. Slow, devastating, burns everything near it.' },
  { name: 'Stone',     colorHex: '#888899', description: 'Rock fragments. Shatters into smaller pieces on impact.' },
];

// ── Shape preview ─────────────────────────────────────────────────────────────

function drawShapePreview(canvas: HTMLCanvasElement, kind: ParticleKind, colorHex: string): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.35;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = colorHex;
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 1.5;

  switch (kind) {
    case ParticleKind.Physical:
    case ParticleKind.Nature:
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case ParticleKind.Lightning:
    case ParticleKind.Wind:
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      break;
    case ParticleKind.Shadow:
    case ParticleKind.Metal:
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      break;
    case ParticleKind.Fire:
    case ParticleKind.Earth:
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r * 0.5);
      ctx.lineTo(cx - r, cy + r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case ParticleKind.Ice:
    case ParticleKind.Crystal: {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
        const vx = cx + Math.cos(a) * r;
        const vy = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case ParticleKind.Holy:
      ctx.fillRect(cx - r, cy - r * 0.4, r * 2, r * 0.8);
      ctx.fillRect(cx - r * 0.4, cy - r, r * 0.8, r * 2);
      break;
    case ParticleKind.Poison:
    case ParticleKind.Arcane: {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 === 0 ? r : r * 0.4;
        const vx = cx + Math.cos(a) * rad;
        const vy = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case ParticleKind.Void:
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      break;
    default:
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

export function buildLoadoutTab(
  contentArea: HTMLElement,
  initialWeaveLoadout: PlayerWeaveLoadout,
  onLoadoutChanged: (updatedWeaveLoadout: PlayerWeaveLoadout) => void,
): void {
  let weaveLoadout = initialWeaveLoadout;
  let selectedTarget: 'primary' | 'secondary' = 'primary';

  function notifyChange(): void {
    onLoadoutChanged(weaveLoadout);
  }

  // ── Weave panels container ──────────────────────────────────────────────
  const panelsRow = document.createElement('div');
  panelsRow.style.cssText = `
    display: flex; gap: 16px; width: 100%; max-width: 720px;
    margin: 0 auto 16px; flex-wrap: wrap; justify-content: center;
  `;
  contentArea.appendChild(panelsRow);

  // ── Build a single weave panel ──────────────────────────────────────────
  function buildWeavePanel(slot: 'primary' | 'secondary'): HTMLDivElement {
    const panel = document.createElement('div');
    panel.style.cssText = `
      flex: 1 1 300px; max-width: 360px; min-width: 260px;
      background: #111; border: 2px solid #333; border-radius: 8px;
      padding: 12px 14px; box-sizing: border-box;
    `;

    const slotLabel = slot === 'primary' ? 'Primary (Left Click)' : 'Secondary (Right Click)';
    const binding = weaveLoadout[slot];
    const weaveDef = getWeaveDefinition(binding.weaveId);
    const usedSlots = getBindingSlotCost(binding);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;';
    header.innerHTML = `
      <span style="color:${GOLD}; font-size:0.9rem; font-family:'Cinzel',serif; font-weight:400;">${slotLabel}</span>
    `;
    panel.appendChild(header);

    // Weave dropdown
    const select = document.createElement('select');
    select.style.cssText = `
      width: 100%; padding: 6px 8px; margin-bottom: 8px;
      background: #1a1a2e; color: #eee; border: 1px solid #444;
      border-radius: 4px; font-family: 'Cinzel', serif; font-weight: 400;
      font-size: 0.85rem; cursor: pointer;
    `;
    for (const wid of WEAVE_LIST) {
      const opt = document.createElement('option');
      opt.value = wid;
      opt.textContent = getWeaveDefinition(wid).displayName;
      if (wid === binding.weaveId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      const newWeaveId = select.value;
      const newDef = getWeaveDefinition(newWeaveId);
      // Keep dust that still fits in the new weave's capacity
      const newBound: ParticleKind[] = [];
      let cost = 0;
      for (const kind of weaveLoadout[slot].boundDust) {
        const dustCost = getDustDefinition(kind).slotCost;
        if (cost + dustCost <= newDef.dustSlotCapacity) {
          newBound.push(kind);
          cost += dustCost;
        }
      }
      weaveLoadout = {
        ...weaveLoadout,
        [slot]: { weaveId: newWeaveId, boundDust: newBound },
      };
      notifyChange();
      rebuildContent();
    });
    panel.appendChild(select);

    // Weave description
    const desc = document.createElement('p');
    desc.style.cssText = 'color:#888; font-size:0.72rem; margin:0 0 8px; line-height:1.3; font-family:\'Cinzel\',serif; font-weight:400;';
    desc.textContent = weaveDef.description;
    panel.appendChild(desc);

    // Slot meter
    const pct = Math.min(100, (usedSlots / weaveDef.dustSlotCapacity) * 100);
    const isOverBudget = usedSlots > weaveDef.dustSlotCapacity;
    const barColor = isOverBudget ? '#ff4444' : usedSlots >= weaveDef.dustSlotCapacity ? '#00ff88' : GOLD;
    const meterHtml = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <span style="color:#aaa; font-size:0.8rem; font-family:'Cinzel',serif; font-weight:400;">DUST SLOTS</span>
        <span style="color:${isOverBudget ? '#ff4444' : '#eee'}; font-size:0.85rem; font-family:'Cinzel',serif; font-weight:400;">
          ${usedSlots} / ${weaveDef.dustSlotCapacity}
        </span>
      </div>
      <div style="height:6px; background:#222; border-radius:3px; overflow:hidden; margin-bottom:8px;">
        <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:3px; transition:width 0.2s, background 0.2s;"></div>
      </div>
    `;
    const meterDiv = document.createElement('div');
    meterDiv.innerHTML = meterHtml;
    panel.appendChild(meterDiv);

    // Bound dust list
    if (binding.boundDust.length > 0) {
      const dustList = document.createElement('div');
      dustList.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
      for (let i = 0; i < binding.boundDust.length; i++) {
        const kind = binding.boundDust[i];
        const dustDef = getDustDefinition(kind);
        const row = document.createElement('div');
        row.style.cssText = `
          display:flex; align-items:center; justify-content:space-between;
          background:#0d0d1a; border:1px solid #333; border-radius:4px;
          padding:4px 8px;
        `;

        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = 20;
        previewCanvas.height = 20;
        previewCanvas.style.cssText = 'flex-shrink:0; margin-right:8px;';
        drawShapePreview(previewCanvas, kind, dustDef.colorHex);

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = `color:${dustDef.colorHex}; font-size:0.8rem; font-family:'Cinzel',serif; font-weight:400; flex:1;`;
        nameSpan.textContent = `${dustDef.displayName} (${dustDef.slotCost})`;

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = `
          background:transparent; border:1px solid #555; color:#ff6666;
          font-size:0.75rem; width:22px; height:22px; cursor:pointer;
          border-radius:3px; line-height:1; font-family:'Cinzel',serif; font-weight:400;
          transition:all 0.15s;
        `;
        removeBtn.addEventListener('mouseenter', () => { removeBtn.style.borderColor = '#ff6666'; });
        removeBtn.addEventListener('mouseleave', () => { removeBtn.style.borderColor = '#555'; });
        removeBtn.addEventListener('click', () => {
          weaveLoadout = {
            ...weaveLoadout,
            [slot]: removeDustFromBinding(weaveLoadout[slot], kind),
          };
          notifyChange();
          rebuildContent();
        });

        row.appendChild(previewCanvas);
        row.appendChild(nameSpan);
        row.appendChild(removeBtn);
        dustList.appendChild(row);
      }
      panel.appendChild(dustList);
    } else {
      const emptyMsg = document.createElement('p');
      emptyMsg.style.cssText = 'color:#555; font-size:0.75rem; font-style:italic; margin:4px 0 0; font-family:\'Cinzel\',serif; font-weight:400;';
      emptyMsg.textContent = 'No dust bound — select dust below.';
      panel.appendChild(emptyMsg);
    }

    return panel;
  }

  // ── Target selector ─────────────────────────────────────────────────────
  const targetRow = document.createElement('div');
  targetRow.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    gap: 8px; margin: 0 auto 12px; width: 100%; max-width: 720px;
  `;
  const targetLabel = document.createElement('span');
  targetLabel.style.cssText = `color:#aaa; font-size:0.85rem; font-family:'Cinzel',serif; font-weight:400;`;
  targetLabel.textContent = 'BIND DUST TO:';
  targetRow.appendChild(targetLabel);

  function createTargetBtn(label: string, target: 'primary' | 'secondary'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      padding: 6px 18px; font-family: 'Cinzel', serif; font-weight: 400;
      font-size: 0.85rem; cursor: pointer; border-radius: 4px;
      transition: all 0.15s;
    `;
    btn.addEventListener('click', () => {
      selectedTarget = target;
      updateTargetButtons();
    });
    return btn;
  }

  const primaryTargetBtn = createTargetBtn('Primary', 'primary');
  const secondaryTargetBtn = createTargetBtn('Secondary', 'secondary');
  targetRow.appendChild(primaryTargetBtn);
  targetRow.appendChild(secondaryTargetBtn);
  contentArea.appendChild(targetRow);

  function updateTargetButtons(): void {
    const isPrimary = selectedTarget === 'primary';
    primaryTargetBtn.style.background = isPrimary ? 'rgba(212,168,75,0.3)' : 'transparent';
    primaryTargetBtn.style.border = isPrimary ? `2px solid ${GOLD}` : '2px solid #444';
    primaryTargetBtn.style.color = isPrimary ? '#fff' : '#aaa';
    secondaryTargetBtn.style.background = !isPrimary ? 'rgba(212,168,75,0.3)' : 'transparent';
    secondaryTargetBtn.style.border = !isPrimary ? `2px solid ${GOLD}` : '2px solid #444';
    secondaryTargetBtn.style.color = !isPrimary ? '#fff' : '#aaa';
  }

  updateTargetButtons();

  // ── Dust grid ───────────────────────────────────────────────────────────
  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px; width: 100%; max-width: 720px; margin: 0 auto;
  `;
  contentArea.appendChild(grid);

  function buildDustGrid(): void {
    grid.innerHTML = '';
    for (let k = 0; k < EQUIPPABLE_KINDS.length; k++) {
      const kind = EQUIPPABLE_KINDS[k];
      const meta = KIND_META[k];
      const dustDef = getDustDefinition(kind);

      const card = document.createElement('div');
      card.style.cssText = `
        border: 2px solid #444; border-radius: 8px;
        padding: 10px; cursor: pointer; transition: border-color 0.15s, background 0.15s;
        background: #0d0d1a; user-select: none;
        display: flex; flex-direction: column; gap: 6px;
      `;

      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = 40;
      previewCanvas.height = 40;
      previewCanvas.style.cssText = 'align-self:center;';
      card.appendChild(previewCanvas);

      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
      nameRow.innerHTML = `
        <span style="color:${meta.colorHex}; font-size:0.85rem; font-family:'Cinzel',serif; font-weight:400;">${dustDef.displayName}</span>
        <span style="background:#1a1a2e; border:1px solid #444; border-radius:4px;
          padding:1px 6px; font-size:0.75rem; color:#ccc; font-family:'Cinzel',serif; font-weight:400;">${dustDef.slotCost} slot${dustDef.slotCost !== 1 ? 's' : ''}</span>
      `;
      card.appendChild(nameRow);

      const desc = document.createElement('p');
      desc.style.cssText = 'color:#888; font-size:0.72rem; margin:0; line-height:1.3; font-family:\'Cinzel\',serif; font-weight:400;';
      desc.textContent = dustDef.description;
      card.appendChild(desc);

      drawShapePreview(previewCanvas, kind, meta.colorHex);

      // Check if dust can fit in the selected target weave
      const binding = weaveLoadout[selectedTarget];
      const weaveDef = getWeaveDefinition(binding.weaveId);
      const remaining = weaveDef.dustSlotCapacity - getBindingSlotCost(binding);
      const canFit = dustDef.slotCost <= remaining;

      if (!canFit) {
        card.style.borderColor = '#333';
        card.style.background = '#0a0a12';
        card.style.opacity = '0.5';
        card.style.cursor = 'not-allowed';
        drawShapePreview(previewCanvas, kind, '#555');
      }

      card.addEventListener('click', () => {
        if (!canFit) return;
        const updated = addDustToBinding(weaveLoadout[selectedTarget], kind);
        if (updated === weaveLoadout[selectedTarget]) return; // did not fit
        weaveLoadout = { ...weaveLoadout, [selectedTarget]: updated };
        notifyChange();
        rebuildContent();
      });

      grid.appendChild(card);
    }
  }

  // ── Rebuild helper ──────────────────────────────────────────────────────
  function rebuildContent(): void {
    panelsRow.innerHTML = '';
    panelsRow.appendChild(buildWeavePanel('primary'));
    panelsRow.appendChild(buildWeavePanel('secondary'));
    buildDustGrid();
    updateTargetButtons();
  }

  // Initial render
  panelsRow.appendChild(buildWeavePanel('primary'));
  panelsRow.appendChild(buildWeavePanel('secondary'));
  buildDustGrid();
}
