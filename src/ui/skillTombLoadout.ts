/**
 * Loadout tab for the Skill Tomb menu.
 *
 * Full layout:
 *   - Stats bar (HP + Dust Containers) — top
 *   - Three-column main area: WEAVES | MOTE TYPES | INVENTORY
 *
 * Returns a cleanup function that cancels all requestAnimationFrame loops.
 */

import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import {
  PlayerWeaveLoadout,
} from '../sim/weaves/playerLoadout';
import { getDustDefinition } from '../sim/weaves/dustDefinition';
import {
  WEAVE_LIST,
  WEAVE_STORM,
  getWeaveDefinition,
  WeaveId,
} from '../sim/weaves/weaveDefinition';
import { PlayerProgress } from '../progression/playerProgress';
import { GOLD } from './skillTombShared';

// ── Constants ─────────────────────────────────────────────────────────────────

const CARD_BG = '#0d0d1a';
const BOX_BORDER = '1px solid rgba(212,168,75,0.25)';
const COL_BORDER = '1px solid rgba(212,168,75,0.2)';
const PASSIVE_GOLD = 'rgba(212,168,75,0.65)';

// ── Passive weave detection ────────────────────────────────────────────────────

/**
 * Returns true if the weave is considered passive (always active, not manually activated).
 * Storm Weave qualifies by definition (dustSlotCapacity=0, durationTicks=0, cooldownTicks=0).
 * The grapple weave (id='grapple') is also treated as passive for future-proofing.
 */
function isPassiveWeave(weaveId: WeaveId): boolean {
  if (weaveId === 'grapple') return true;
  const def = getWeaveDefinition(weaveId);
  return def.dustSlotCapacity === 0 && def.durationTicks === 0 && def.cooldownTicks === 0;
}

// ── Column box helper ─────────────────────────────────────────────────────────

function createColBox(title: string): { box: HTMLElement; body: HTMLElement } {
  const box = document.createElement('div');
  box.style.cssText = `
    border: ${COL_BORDER}; border-radius: 8px; padding: 12px;
    background: rgba(0,0,0,0.25); display: flex; flex-direction: column; gap: 8px;
    min-width: 0;
  `;
  const label = document.createElement('div');
  label.style.cssText = `
    font-size: 0.8rem; letter-spacing: 0.1em; color: ${GOLD};
    font-family: 'Cinzel', serif; font-weight: 400;
    text-transform: uppercase; text-align: center; margin-bottom: 2px;
  `;
  label.textContent = title;
  box.appendChild(label);
  const body = document.createElement('div');
  body.style.cssText = 'display: flex; flex-direction: column; gap: 8px; flex: 1;';
  box.appendChild(body);
  return { box, body };
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function buildStatsBar(
  playerHp: number,
  playerMaxHp: number,
  dustContainerCount: number,
  dustContainerPieces: number,
): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText = `
    display: flex; gap: 12px; margin-bottom: 14px;
    flex-wrap: wrap;
  `;

  // ── HP Box ──────────────────────────────────────────────────────────────
  const hpBox = document.createElement('div');
  hpBox.style.cssText = `
    border: ${BOX_BORDER}; border-radius: 8px; padding: 10px 14px;
    background: ${CARD_BG}; min-width: 140px; flex: 1;
  `;

  const hpTitle = document.createElement('div');
  hpTitle.style.cssText = `color: ${GOLD}; font-size: 0.8rem; letter-spacing: 0.1em;
    font-family: 'Cinzel', serif; font-weight: 400; text-transform: uppercase;
    margin-bottom: 6px; text-align: center;`;
  hpTitle.textContent = 'HP';
  hpBox.appendChild(hpTitle);

  const hpValue = document.createElement('div');
  hpValue.style.cssText = `color: #eee; font-size: 1rem; font-family: 'Cinzel', serif;
    font-weight: 400; text-align: center; margin-bottom: 6px;`;
  hpValue.textContent = `${playerHp} / ${playerMaxHp}`;
  hpBox.appendChild(hpValue);

  const hpTrack = document.createElement('div');
  hpTrack.style.cssText = `background: #1a1a2e; border-radius: 4px; height: 8px;
    overflow: hidden; border: 1px solid rgba(212,168,75,0.2);`;
  const hpFill = document.createElement('div');
  const hpPct = playerMaxHp > 0 ? Math.max(0, Math.min(1, playerHp / playerMaxHp)) : 0;
  hpFill.style.cssText = `height: 100%; background: #5cb85c;
    width: ${(hpPct * 100).toFixed(1)}%; border-radius: 4px; transition: width 0.2s;`;
  hpTrack.appendChild(hpFill);
  hpBox.appendChild(hpTrack);

  bar.appendChild(hpBox);

  // ── Dust Containers Box ─────────────────────────────────────────────────
  const dcBox = document.createElement('div');
  dcBox.style.cssText = `
    border: ${BOX_BORDER}; border-radius: 8px; padding: 10px 14px;
    background: ${CARD_BG}; flex: 2; min-width: 180px;
  `;

  const dcTitle = document.createElement('div');
  dcTitle.style.cssText = `color: ${GOLD}; font-size: 0.8rem; letter-spacing: 0.1em;
    font-family: 'Cinzel', serif; font-weight: 400; text-transform: uppercase;
    margin-bottom: 6px; text-align: center;`;
  dcTitle.textContent = 'Dust Containers';
  dcBox.appendChild(dcTitle);

  // Container icons row
  const containerRow = document.createElement('div');
  containerRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-bottom: 6px;';

  for (let i = 0; i < dustContainerCount; i++) {
    const icon = document.createElement('span');
    icon.textContent = '◆';
    icon.style.cssText = `color: ${GOLD}; font-size: 1.1rem; line-height: 1;`;
    icon.title = `Container ${i + 1}`;
    containerRow.appendChild(icon);
  }

  if (dustContainerCount === 0 && dustContainerPieces === 0) {
    const none = document.createElement('span');
    none.style.cssText = 'color: #555; font-size: 0.75rem; font-family: \'Cinzel\', serif; font-style: italic;';
    none.textContent = 'None';
    containerRow.appendChild(none);
  }

  dcBox.appendChild(containerRow);

  // Pieces sub-row (0–3 pieces)
  const piecesRow = document.createElement('div');
  piecesRow.style.cssText = 'display: flex; gap: 3px; align-items: center;';

  const piecesLabel = document.createElement('span');
  piecesLabel.style.cssText = 'color: #888; font-size: 0.72rem; font-family: \'Cinzel\', serif; margin-right: 4px;';
  piecesLabel.textContent = 'Pieces:';
  piecesRow.appendChild(piecesLabel);

  for (let i = 0; i < 4; i++) {
    const piece = document.createElement('span');
    piece.textContent = '◇';
    piece.style.cssText = `color: ${i < dustContainerPieces ? GOLD : '#333'};
      font-size: 0.85rem; line-height: 1;`;
    piece.title = i < dustContainerPieces ? 'Piece collected' : 'Piece needed';
    piecesRow.appendChild(piece);
  }

  const piecesCount = document.createElement('span');
  piecesCount.style.cssText = 'color: #888; font-size: 0.7rem; font-family: \'Cinzel\', serif; margin-left: 4px;';
  piecesCount.textContent = `(${dustContainerPieces}/4 — ${4 - dustContainerPieces} until next)`;
  piecesRow.appendChild(piecesCount);

  dcBox.appendChild(piecesRow);

  bar.appendChild(dcBox);
  return bar;
}

// ── Weave card animation ─────────────────────────────────────────────────────

function startStormAnimation(canvas: HTMLCanvasElement): () => void {
  const ctxOrNull = canvas.getContext('2d');
  if (ctxOrNull === null) return () => { /* no-op */ };
  const ctx = ctxOrNull;

  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const COUNT = 8;

  // Pre-define particle data — fixed arrays, no allocation per frame
  const radii    = new Float32Array(COUNT);
  const angles   = new Float32Array(COUNT);
  const speeds   = new Float32Array(COUNT);
  const sizes    = new Float32Array(COUNT);
  const noiseOff = new Float32Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    radii[i]    = 8 + (i % 3) * 6 + Math.sin(i * 1.3) * 3;
    angles[i]   = (i / COUNT) * Math.PI * 2;
    speeds[i]   = 0.025 + (i % 4) * 0.008;
    sizes[i]    = 2 + (i % 2);
    noiseOff[i] = i * 0.7;
  }

  let rafId = 0;
  let tMs = 0;
  let lastTs = 0;

  function frame(ts: number): void {
    const dtMs = lastTs === 0 ? 0 : ts - lastTs;
    lastTs = ts;
    tMs += dtMs;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < COUNT; i++) {
      angles[i] += speeds[i] * (dtMs / 16.67);
      const noise = Math.sin(tMs * 0.001 + noiseOff[i]) * 2;
      const px = cx + Math.cos(angles[i]) * (radii[i] + noise);
      const py = cy + Math.sin(angles[i]) * (radii[i] + noise);
      const s = sizes[i];
      ctx.fillStyle = GOLD;
      ctx.globalAlpha = 0.75 + Math.sin(tMs * 0.002 + noiseOff[i]) * 0.25;
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(rafId); };
}

function startShieldAnimation(canvas: HTMLCanvasElement): () => void {
  const ctxOrNull = canvas.getContext('2d');
  if (ctxOrNull === null) return () => { /* no-op */ };
  const ctx = ctxOrNull;

  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const COUNT = 9;
  const ARC_HALF = Math.PI * 0.45; // ~81° each side of center
  const BASE_RADIUS = Math.min(w, h) * 0.36;

  // Particle angles spread evenly across the crescent arc (right-facing)
  const baseAngles = new Float32Array(COUNT);
  const pulseOff   = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    baseAngles[i] = -ARC_HALF + (i / (COUNT - 1)) * ARC_HALF * 2;
    pulseOff[i]   = i * 0.55;
  }

  let rafId = 0;
  let tMs = 0;
  let lastTs = 0;

  function frame(ts: number): void {
    const dtMs = lastTs === 0 ? 0 : ts - lastTs;
    lastTs = ts;
    tMs += dtMs;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < COUNT; i++) {
      const pulse = Math.sin(tMs * 0.0015 + pulseOff[i]) * 3;
      const r = BASE_RADIUS + pulse;
      const ang = baseAngles[i]; // centered facing right (0 = right)
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r;
      const alpha = 0.55 + Math.sin(tMs * 0.002 + pulseOff[i]) * 0.35;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#80c8ff';
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(rafId); };
}

function startGenericAnimation(canvas: HTMLCanvasElement): () => void {
  const ctxOrNull = canvas.getContext('2d');
  if (ctxOrNull === null) return () => { /* no-op */ };
  const ctx = ctxOrNull;

  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const COUNT = 6;
  const angles = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) angles[i] = (i / COUNT) * Math.PI * 2;

  let rafId = 0;
  let lastTs = 0;

  function frame(ts: number): void {
    const dtMs = lastTs === 0 ? 0 : ts - lastTs;
    lastTs = ts;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < COUNT; i++) {
      angles[i] += 0.02 * (dtMs / 16.67);
      const px = cx + Math.cos(angles[i]) * 14;
      const py = cy + Math.sin(angles[i]) * 14;
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(rafId); };
}

// ── Weave column ─────────────────────────────────────────────────────────────

function buildWeavesColumn(
  weaveLoadout: PlayerWeaveLoadout,
  progress: PlayerProgress,
  cleanups: Array<() => void>,
): HTMLElement {
  const { box, body } = createColBox('Weaves');

  for (let wi = 0; wi < WEAVE_LIST.length; wi++) {
    const weaveId = WEAVE_LIST[wi];
    const def = getWeaveDefinition(weaveId);
    const isPassive = isPassiveWeave(weaveId);

    // Is this weave equipped in primary or secondary?
    const isEquipped =
      weaveLoadout.primary.weaveId === weaveId ||
      weaveLoadout.secondary.weaveId === weaveId;

    // ── Card ──────────────────────────────────────────────────────────────
    const card = document.createElement('div');
    card.style.cssText = `
      border: 1px solid rgba(212,168,75,0.2); border-radius: 6px;
      padding: 8px; background: ${CARD_BG}; display: flex; flex-direction: column;
      align-items: center; gap: 6px;
    `;

    // Name
    const nameEl = document.createElement('div');
    nameEl.style.cssText = `color: ${GOLD}; font-size: 0.82rem; font-family: 'Cinzel', serif;
      font-weight: 400; text-align: center;`;
    nameEl.textContent = def.displayName;
    card.appendChild(nameEl);

    // Animated preview canvas
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = 72;
    previewCanvas.height = 72;
    previewCanvas.style.cssText = 'border-radius: 4px; background: #070710;';
    card.appendChild(previewCanvas);

    // Start animation
    if (weaveId === WEAVE_STORM) {
      cleanups.push(startStormAnimation(previewCanvas));
    } else if (weaveId === 'shield') {
      cleanups.push(startShieldAnimation(previewCanvas));
    } else {
      cleanups.push(startGenericAnimation(previewCanvas));
    }

    // Status badge
    const badge = document.createElement('div');

    function updateBadge(): void {
      const curDisabled = progress.disabledPassiveWeaves.includes(weaveId);
      if (!isPassive && isEquipped) {
        badge.textContent = 'EQUIPPED';
        badge.style.cssText = `
          font-size: 0.7rem; font-family: 'Cinzel', serif; font-weight: 400;
          border: 1px solid ${GOLD}; color: ${GOLD}; border-radius: 4px;
          padding: 2px 8px; cursor: default;
        `;
      } else if (isPassive && !curDisabled) {
        badge.textContent = 'PASSIVE';
        badge.style.cssText = `
          font-size: 0.7rem; font-family: 'Cinzel', serif; font-weight: 400;
          border: 1px solid ${PASSIVE_GOLD}; color: ${PASSIVE_GOLD}; border-radius: 4px;
          padding: 2px 8px; cursor: pointer; user-select: none;
        `;
      } else if (isPassive && curDisabled) {
        badge.textContent = 'DISABLED';
        badge.style.cssText = `
          font-size: 0.7rem; font-family: 'Cinzel', serif; font-weight: 400;
          border: 1px solid #555; color: #cc4444; border-radius: 4px;
          padding: 2px 8px; cursor: pointer; user-select: none;
        `;
      } else {
        badge.textContent = '—';
        badge.style.cssText = `
          font-size: 0.7rem; font-family: 'Cinzel', serif; font-weight: 400;
          color: #555; padding: 2px 8px;
        `;
      }
    }

    updateBadge();

    if (isPassive) {
      badge.addEventListener('click', () => {
        const idx = progress.disabledPassiveWeaves.indexOf(weaveId);
        if (idx === -1) {
          progress.disabledPassiveWeaves.push(weaveId);
        } else {
          progress.disabledPassiveWeaves.splice(idx, 1);
        }
        updateBadge();
      });
    }

    card.appendChild(badge);
    body.appendChild(card);
  }

  return box;
}

// ── Mote types column ─────────────────────────────────────────────────────────

function buildMoteTypesColumn(progress: PlayerProgress): HTMLElement {
  const { box, body } = createColBox('Mote Types');

  const kinds: readonly ParticleKind[] =
    progress.isDevModeDustUnlocked ? EQUIPPABLE_KINDS : progress.unlockedDustKinds;

  if (kinds.length === 0) {
    const msg = document.createElement('p');
    msg.style.cssText = `color: #555; font-size: 0.75rem; font-style: italic;
      text-align: center; font-family: 'Cinzel', serif; font-weight: 400; margin: 8px 0;`;
    msg.textContent = 'No dust types available.';
    body.appendChild(msg);
    return box;
  }

  const grid = document.createElement('div');
  grid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;';
  body.appendChild(grid);

  for (let k = 0; k < kinds.length; k++) {
    const kind = kinds[k];
    const dustDef = getDustDefinition(kind);

    const tile = document.createElement('div');
    tile.style.cssText = `
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 6px; border-radius: 6px; background: ${CARD_BG};
      border: 2px solid ${dustDef.colorHex}44; width: 70px;
    `;

    const colorSquare = document.createElement('div');
    colorSquare.style.cssText = `
      width: 36px; height: 36px; border-radius: 4px;
      background: ${dustDef.colorHex}; flex-shrink: 0;
    `;
    tile.appendChild(colorSquare);

    const nameLbl = document.createElement('div');
    nameLbl.style.cssText = `color: ${dustDef.colorHex}; font-size: 0.65rem;
      font-family: 'Cinzel', serif; font-weight: 400; text-align: center; word-break: break-word;`;
    nameLbl.textContent = dustDef.displayName;
    tile.appendChild(nameLbl);

    const slotBadge = document.createElement('div');
    slotBadge.style.cssText = `background: #1a1a2e; border: 1px solid #444; border-radius: 3px;
      padding: 1px 5px; font-size: 0.65rem; color: #ccc; font-family: 'Cinzel', serif;`;
    slotBadge.textContent = `${dustDef.slotCost} slot${dustDef.slotCost !== 1 ? 's' : ''}`;
    tile.appendChild(slotBadge);

    grid.appendChild(tile);
  }

  return box;
}

// ── Inventory column (stub) ─────────────────────────────────────────────────

function buildInventoryColumn(): HTMLElement {
  const { box, body } = createColBox('Inventory');

  const inner = document.createElement('div');
  inner.style.cssText = `
    border: 2px dashed #333; border-radius: 6px; padding: 16px;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 8px; flex: 1; min-height: 80px;
  `;

  const stubSlot = document.createElement('div');
  stubSlot.style.cssText = `
    width: 44px; height: 44px; background: #1a1a2e;
    border: 1px solid #333; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    color: #555; font-size: 1.2rem; font-family: 'Cinzel', serif;
  `;
  stubSlot.textContent = '?';
  inner.appendChild(stubSlot);

  const comingSoon = document.createElement('p');
  comingSoon.style.cssText = `color: #555; font-size: 0.72rem; font-style: italic;
    text-align: center; font-family: 'Cinzel', serif; font-weight: 400; margin: 0;`;
  comingSoon.textContent = 'Coming soon';
  inner.appendChild(comingSoon);

  body.appendChild(inner);
  return box;
}

// ── Public entry point ────────────────────────────────────────────────────────

export function buildLoadoutTab(
  contentArea: HTMLElement,
  weaveLoadout: PlayerWeaveLoadout,
  _onLoadoutChanged: (updatedWeaveLoadout: PlayerWeaveLoadout) => void,
  progress: PlayerProgress,
  playerHp: number,
  playerMaxHp: number,
): () => void {
  const cleanups: Array<() => void> = [];

  // ── Stats bar ─────────────────────────────────────────────────────────────
  const statsBar = buildStatsBar(
    playerHp,
    playerMaxHp,
    progress.dustContainerCount,
    progress.dustContainerPieces,
  );
  contentArea.appendChild(statsBar);

  // ── Three-column grid ─────────────────────────────────────────────────────
  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;
  `;

  // Responsive: narrow screens stack columns
  const styleTag = document.createElement('style');
  styleTag.textContent = `
    @media (max-width: 600px) {
      .loadout-grid { grid-template-columns: 1fr !important; }
    }
  `;
  contentArea.appendChild(styleTag);
  grid.classList.add('loadout-grid');

  grid.appendChild(buildWeavesColumn(weaveLoadout, progress, cleanups));
  grid.appendChild(buildMoteTypesColumn(progress));
  grid.appendChild(buildInventoryColumn());

  contentArea.appendChild(grid);

  return () => {
    for (let i = 0; i < cleanups.length; i++) cleanups[i]();
  };
}

