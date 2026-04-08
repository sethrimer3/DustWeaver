/**
 * Weave Loadout selection screen.
 *
 * Simplified: shows the player's dust list (only Gold Dust for now).
 * Weave selection dropdowns have been removed — Storm and Shield are
 * the only weaves and they are always active.
 */

import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import { PlayerProgress } from '../progression/playerProgress';
import {
  PlayerWeaveLoadout,
  createDefaultWeaveLoadout,
} from '../sim/weaves/playerLoadout';
import { getDustDefinition } from '../sim/weaves/dustDefinition';

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
  const weaveLoadout: PlayerWeaveLoadout = progress.weaveLoadout
    ? JSON.parse(JSON.stringify(progress.weaveLoadout))
    : createDefaultWeaveLoadout();

  function getAvailableDustKinds(): ParticleKind[] {
    if (progress.isDevModeDustUnlocked === true) return [...EQUIPPABLE_KINDS];
    const unlocked = new Set(progress.unlockedDustKinds ?? []);
    return EQUIPPABLE_KINDS.filter(kind => unlocked.has(kind));
  }

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
    <h2 style="font-size:1.6rem; color:#ffd700; margin:0 0 4px;">Weaver Loadout</h2>
    <p style="color:#888; font-size:0.8rem; margin:0;">
      Level ${progress.level} &nbsp;|&nbsp; Your dust collection.
    </p>
  `;
  el.appendChild(header);

  // ---- Dust list -------------------------------------------------------
  const dustListEl = document.createElement('div');
  dustListEl.style.cssText = `
    width: 100%; max-width: 400px; margin-bottom: 20px;
  `;
  el.appendChild(dustListEl);

  const availableKinds = getAvailableDustKinds();
  if (availableKinds.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'color:#777; font-size:0.8rem; text-align:center; padding:20px 0;';
    emptyMsg.textContent = 'No dust unlocked yet.';
    dustListEl.appendChild(emptyMsg);
  } else {
    for (const kind of availableKinds) {
      const def = getDustDefinition(kind);
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex; align-items:center; gap:10px;
        background:#0d0d1a; border:1px solid ${def.colorHex}44; border-radius:6px;
        padding:10px 14px; margin-bottom:8px;
      `;
      row.innerHTML = `
        <div style="width:12px;height:12px;background:${def.colorHex};border-radius:2px;flex-shrink:0;"></div>
        <div style="flex:1;">
          <div style="color:${def.colorHex}; font-size:0.85rem; font-weight:bold;">${def.displayName}</div>
          <div style="color:#888; font-size:0.7rem;">${def.description}</div>
        </div>
      `;
      dustListEl.appendChild(row);
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
    padding: 10px 22px; font-size: 0.9rem; font-family: 'Cinzel', serif;
    cursor: pointer; border-radius: 6px;
  `;
  cancelBtn.addEventListener('click', () => callbacks.onCancel());
  actionBar.appendChild(cancelBtn);

  const startBtn = document.createElement('button');
  startBtn.id = 'loadout-start-btn';
  startBtn.textContent = '⚔ Enter Battle';
  startBtn.style.cssText = `
    background: transparent; border: 2px solid #ffd700; color: #ffd700;
    padding: 10px 28px; font-size: 0.95rem; font-family: 'Cinzel', serif;
    cursor: pointer; border-radius: 6px; font-weight: bold;
  `;
  startBtn.addEventListener('click', () => {
    const uniqueLoadout = availableKinds.slice();
    callbacks.onConfirm(uniqueLoadout, weaveLoadout);
  });
  actionBar.appendChild(startBtn);

  // Cleanup
  return () => {
    if (el.parentElement !== null) el.parentElement.removeChild(el);
    if (actionBar.parentElement !== null) actionBar.parentElement.removeChild(actionBar);
  };
}
