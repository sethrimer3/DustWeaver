/**
 * Loadout tab for the Skill Tomb menu.
 *
 * Simplified: shows the player's available dust list and shape preview.
 * Weave selection dropdowns have been removed — Storm and Shield are
 * the only weaves.
 */

import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import {
  PlayerWeaveLoadout,
} from '../sim/weaves/playerLoadout';
import { getDustDefinition } from '../sim/weaves/dustDefinition';
import { GOLD } from './skillTombShared';

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
      // Square gold dust mote
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
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
  _initialWeaveLoadout: PlayerWeaveLoadout,
  _onLoadoutChanged: (updatedWeaveLoadout: PlayerWeaveLoadout) => void,
): void {
  // Header
  const header = document.createElement('div');
  header.style.cssText = `text-align:center; margin: 0 auto 16px; width:100%; max-width:720px;`;
  header.innerHTML = `
    <span style="color:${GOLD}; font-size:0.95rem; font-family:'Cinzel',serif; font-weight:400;">
      Dust Collection
    </span>
    <p style="color:#888; font-size:0.75rem; margin:6px 0 0; font-family:'Cinzel',serif; font-weight:400;">
      Your available dust types.
    </p>
  `;
  contentArea.appendChild(header);

  // ── Dust grid ───────────────────────────────────────────────────────────
  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px; width: 100%; max-width: 720px; margin: 0 auto;
  `;
  contentArea.appendChild(grid);

  for (let k = 0; k < EQUIPPABLE_KINDS.length; k++) {
    const kind = EQUIPPABLE_KINDS[k];
    const dustDef = getDustDefinition(kind);

    const card = document.createElement('div');
    card.style.cssText = `
      border: 2px solid ${dustDef.colorHex}44; border-radius: 8px;
      padding: 10px; background: #0d0d1a; user-select: none;
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
      <span style="color:${dustDef.colorHex}; font-size:0.85rem; font-family:'Cinzel',serif; font-weight:400;">${dustDef.displayName}</span>
      <span style="background:#1a1a2e; border:1px solid #444; border-radius:4px;
        padding:1px 6px; font-size:0.75rem; color:#ccc; font-family:'Cinzel',serif; font-weight:400;">${dustDef.slotCost} slot${dustDef.slotCost !== 1 ? 's' : ''}</span>
    `;
    card.appendChild(nameRow);

    const desc = document.createElement('p');
    desc.style.cssText = 'color:#888; font-size:0.72rem; margin:0; line-height:1.3; font-family:\'Cinzel\',serif; font-weight:400;';
    desc.textContent = dustDef.description;
    card.appendChild(desc);

    drawShapePreview(previewCanvas, kind, dustDef.colorHex);

    grid.appendChild(card);
  }

  if (EQUIPPABLE_KINDS.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.style.cssText = 'color:#555; font-size:0.75rem; font-style:italic; text-align:center; font-family:\'Cinzel\',serif; font-weight:400;';
    emptyMsg.textContent = 'No dust types available.';
    grid.appendChild(emptyMsg);
  }
}
