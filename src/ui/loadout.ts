/**
 * Loadout selection screen.
 *
 * Shows all available particle kinds as selectable cards. The player toggles
 * kinds on/off; the total slot cost of selected kinds must not exceed the
 * player's dust slot budget. A visual slot meter shows used vs available slots.
 *
 * The screen calls onConfirm(loadout) when the player starts the battle, or
 * onCancel() when the player returns to the World Map.
 */

import { ParticleKind, EQUIPPABLE_PARTICLE_KIND_COUNT } from '../sim/particles/kinds';
import { getSlotCost, totalSlotCost } from '../sim/particles/slotCost';
import { PlayerProgress } from '../progression/playerProgress';

export interface LoadoutCallbacks {
  onConfirm: (loadout: ParticleKind[]) => void;
  onCancel: () => void;
}

// ---- Display metadata per kind ------------------------------------------

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
  { name: 'Metal',     colorHex: '#aabbcc', description: 'Iron shards. Dense, durable, heavy.' },
  { name: 'Earth',     colorHex: '#aa8833', description: 'Stone fragments. Grounded and steady.' },
  { name: 'Nature',    colorHex: '#44cc44', description: 'Living vines. Organic and gentle.' },
  { name: 'Crystal',   colorHex: '#aaeeff', description: 'Prismatic shards. Precise and brilliant.' },
  { name: 'Void',      colorHex: '#9933cc', description: 'Dark matter rings. Exotic and powerful.' },
];

if (KIND_META.length !== EQUIPPABLE_PARTICLE_KIND_COUNT) {
  throw new Error(
    `KIND_META length (${KIND_META.length}) must equal EQUIPPABLE_PARTICLE_KIND_COUNT (${EQUIPPABLE_PARTICLE_KIND_COUNT})`,
  );
}

// ---- Small Canvas-based shape preview -----------------------------------

/**
 * Draws a tiny shape preview on a small <canvas> element for the given kind.
 * This mirrors the shape logic in render/particles/renderer.ts.
 */
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
      // Diamond
      ctx.beginPath();
      ctx.moveTo(cx,     cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx,     cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      break;

    case ParticleKind.Shadow:
    case ParticleKind.Metal:
      // Square
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      break;

    case ParticleKind.Fire:
    case ParticleKind.Earth:
      // Triangle (up)
      ctx.beginPath();
      ctx.moveTo(cx,      cy - r);
      ctx.lineTo(cx + r,  cy + r * 0.5);
      ctx.lineTo(cx - r,  cy + r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;

    case ParticleKind.Ice:
    case ParticleKind.Crystal: {
      // Hexagon
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
      // Cross
      ctx.fillRect(cx - r,       cy - r * 0.4, r * 2, r * 0.8);
      ctx.fillRect(cx - r * 0.4, cy - r,       r * 0.8, r * 2);
      break;

    case ParticleKind.Poison:
    case ParticleKind.Arcane: {
      // 5-pointed star
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
      // Ring
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

// ---- Screen factory ------------------------------------------------------

export function showLoadoutScreen(
  root: HTMLElement,
  progress: PlayerProgress,
  callbacks: LoadoutCallbacks,
): () => void {
  // Working copy of the loadout that we mutate as the player toggles kinds.
  let loadout: ParticleKind[] = progress.loadout.slice();
  const { dustSlots } = progress;

  // ---- Root container --------------------------------------------------
  const el = document.createElement('div');
  el.id = 'loadout-screen';
  el.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(5,5,15,0.97);
    color: #eee; font-family: monospace;
    display: flex; flex-direction: column; align-items: center;
    overflow-y: auto; box-sizing: border-box; padding: 20px 16px 80px;
  `;
  root.appendChild(el);

  // ---- Header ----------------------------------------------------------
  const header = document.createElement('div');
  header.style.cssText = 'text-align:center; margin-bottom:18px; width:100%;';
  header.innerHTML = `
    <h2 style="font-size:1.6rem; color:#00cfff; margin:0 0 4px;">Dust Loadout</h2>
    <p style="color:#888; font-size:0.8rem; margin:0;">
      Level ${progress.level} &nbsp;|&nbsp; Choose which dust particles to bring into battle.
    </p>
  `;
  el.appendChild(header);

  // ---- Slot meter ------------------------------------------------------
  const meterContainer = document.createElement('div');
  meterContainer.style.cssText = `
    width: 100%; max-width: 640px;
    background: #111; border: 1px solid #333; border-radius: 6px;
    padding: 10px 14px; margin-bottom: 20px; box-sizing: border-box;
  `;
  el.appendChild(meterContainer);

  function renderMeter(): void {
    const used = totalSlotCost(loadout);
    const pct = Math.min(100, (used / dustSlots) * 100);
    const overBudget = used > dustSlots;
    const barColor = overBudget ? '#ff4444' : used >= dustSlots ? '#00ff88' : '#00cfff';
    meterContainer.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <span style="color:#aaa; font-size:0.85rem;">DUST SLOTS</span>
        <span style="color:${overBudget ? '#ff4444' : '#eee'}; font-size:0.9rem; font-weight:bold;">
          ${used} / ${dustSlots}
        </span>
      </div>
      <div style="height:8px; background:#222; border-radius:4px; overflow:hidden;">
        <div style="
          height:100%; width:${pct}%;
          background:${barColor};
          border-radius:4px;
          transition:width 0.2s, background 0.2s;
        "></div>
      </div>
      ${overBudget
        ? '<p style="color:#ff4444; font-size:0.75rem; margin:6px 0 0;">Over slot limit — remove a particle type.</p>'
        : ''}
    `;
  }

  // ---- Particle cards --------------------------------------------------
  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px; width: 100%; max-width: 720px;
  `;
  el.appendChild(grid);

  const cardEls: HTMLDivElement[] = [];

  for (let k = 0; k < EQUIPPABLE_PARTICLE_KIND_COUNT; k++) {
    const kind = k as ParticleKind;
    const meta = KIND_META[k];
    const cost = getSlotCost(kind);

    const card = document.createElement('div');
    card.style.cssText = `
      border: 2px solid #333; border-radius: 8px;
      padding: 10px; cursor: pointer; transition: border-color 0.15s, background 0.15s;
      background: #0d0d1a; user-select: none;
      display: flex; flex-direction: column; gap: 6px;
    `;

    // Shape preview canvas
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = 40;
    previewCanvas.height = 40;
    previewCanvas.style.cssText = 'align-self:center;';
    card.appendChild(previewCanvas);

    // Name + cost
    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
    nameRow.innerHTML = `
      <span style="color:${meta.colorHex}; font-size:0.85rem; font-weight:bold;">${meta.name}</span>
      <span style="
        background:#1a1a2e; border:1px solid #444; border-radius:4px;
        padding:1px 6px; font-size:0.75rem; color:#ccc;
      ">${cost} slot${cost !== 1 ? 's' : ''}</span>
    `;
    card.appendChild(nameRow);

    // Description
    const desc = document.createElement('p');
    desc.style.cssText = 'color:#888; font-size:0.72rem; margin:0; line-height:1.3;';
    desc.textContent = meta.description;
    card.appendChild(desc);

    // Draw the shape preview
    drawShapePreview(previewCanvas, kind, meta.colorHex);

    // Toggle handler
    card.addEventListener('click', () => {
      const isSelected = loadout.includes(kind);
      if (isSelected) {
        loadout = loadout.filter(k2 => k2 !== kind);
      } else {
        const newCost = totalSlotCost(loadout) + cost;
        if (newCost > dustSlots) return; // would exceed budget
        loadout = [...loadout, kind];
      }
      updateCardState(kind, card, previewCanvas, meta);
      renderMeter();
      updateStartButton();
    });

    grid.appendChild(card);
    cardEls.push(card);

    updateCardState(kind, card, previewCanvas, meta);
  }

  function updateCardState(
    kind: ParticleKind,
    card: HTMLDivElement,
    previewCanvas: HTMLCanvasElement,
    meta: KindMeta,
  ): void {
    const isSelected = loadout.includes(kind);
    const cost = getSlotCost(kind);
    const wouldFit = totalSlotCost(loadout) + cost <= dustSlots;

    if (isSelected) {
      card.style.borderColor = meta.colorHex;
      card.style.background = '#111128';
      drawShapePreview(previewCanvas, kind, meta.colorHex);
    } else if (!wouldFit) {
      card.style.borderColor = '#333';
      card.style.background = '#0a0a12';
      drawShapePreview(previewCanvas, kind, '#555');
    } else {
      card.style.borderColor = '#444';
      card.style.background = '#0d0d1a';
      drawShapePreview(previewCanvas, kind, meta.colorHex);
    }
  }

  function refreshAllCards(): void {
    for (let k = 0; k < EQUIPPABLE_PARTICLE_KIND_COUNT; k++) {
      const kind = k as ParticleKind;
      updateCardState(kind, cardEls[k], cardEls[k].querySelector('canvas')!, KIND_META[k]);
    }
  }

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
    padding: 10px 22px; font-size: 0.9rem; font-family: monospace;
    cursor: pointer; border-radius: 6px;
  `;
  cancelBtn.addEventListener('click', () => callbacks.onCancel());
  actionBar.appendChild(cancelBtn);

  const startBtn = document.createElement('button');
  startBtn.id = 'loadout-start-btn';
  startBtn.style.cssText = `
    background: transparent; border: 2px solid #00cfff; color: #00cfff;
    padding: 10px 28px; font-size: 0.95rem; font-family: monospace;
    cursor: pointer; border-radius: 6px; font-weight: bold;
  `;
  startBtn.addEventListener('click', () => {
    if (loadout.length === 0) return;
    const used = totalSlotCost(loadout);
    if (used > dustSlots) return;
    callbacks.onConfirm(loadout.slice());
  });
  actionBar.appendChild(startBtn);

  function updateStartButton(): void {
    const canStart = loadout.length > 0 && totalSlotCost(loadout) <= dustSlots;
    startBtn.textContent = canStart ? `⚔ Enter Battle (${loadout.length} type${loadout.length !== 1 ? 's' : ''})` : 'Select at least one type';
    startBtn.disabled = !canStart;
    startBtn.style.opacity = canStart ? '1' : '0.4';
    startBtn.style.cursor = canStart ? 'pointer' : 'default';
  }

  // Initial renders
  renderMeter();
  refreshAllCards();
  updateStartButton();

  // Cleanup
  return () => {
    if (el.parentElement !== null) el.parentElement.removeChild(el);
    if (actionBar.parentElement !== null) actionBar.parentElement.removeChild(actionBar);
  };
}
