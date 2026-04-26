/**
 * Skill Tomb menu — opened when the player interacts with a skill tomb.
 *
 * Two tabs:
 *   1. Loadout — particle kind selection (same content as the old loadout screen)
 *   2. World Map — room-based map showing explored rooms with zoom/pan
 *
 * Has an "X" button in the top-right corner and ESC closes the menu
 * without opening the pause menu.
 *
 * All text: Cinzel, Regular 400.
 */

import { ParticleKind } from '../sim/particles/kinds';
import { PlayerProgress } from '../progression/playerProgress';
import { PlayerWeaveLoadout, getAllBoundDust } from '../sim/weaves/playerLoadout';
import { GOLD, GOLD_DIM } from './skillTombShared';
import { buildLoadoutTab } from './skillTombLoadout';
import { buildMapTab } from './skillTombWorldMap';

export interface SkillTombMenuCallbacks {
  onClose: (updatedLoadout: ParticleKind[], updatedWeaveLoadout: PlayerWeaveLoadout) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PANEL_BG = 'rgba(10,8,6,0.95)';

// ── Shared overlay / close-button helpers ─────────────────────────────────────

function createOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: ${PANEL_BG};
    z-index: 1500;
    display: flex; flex-direction: column;
    font-family: 'Cinzel', serif; font-weight: 400; color: #eee;
  `;
  return overlay;
}

function createCloseButton(onClick: () => void): HTMLButtonElement {
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    background: transparent; border: 1px solid ${GOLD_DIM};
    color: ${GOLD}; font-size: 1.3rem; width: 36px; height: 36px;
    cursor: pointer; border-radius: 4px; font-family: 'Cinzel', serif;
    font-weight: 400; line-height: 1;
    transition: all 0.15s;
  `;
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(212,168,75,0.15)';
    closeBtn.style.borderColor = GOLD;
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'transparent';
    closeBtn.style.borderColor = GOLD_DIM;
  });
  closeBtn.addEventListener('click', onClick);
  return closeBtn;
}

// ── Map-only modal (accessible via M key from anywhere) ───────────────────────

export interface MapOnlyModalCallbacks {
  onClose: () => void;
}

/**
 * Shows a read-only world map modal.  The player can pan and zoom the map but
 * cannot edit their loadout.  Used when the player presses M outside a save tomb.
 */
export function showMapOnlyModal(
  root: HTMLElement,
  progress: PlayerProgress,
  currentRoomId: string,
  playerXWorld: number,
  playerYWorld: number,
  callbacks: MapOnlyModalCallbacks,
): () => void {
  let mapCleanup: (() => void) | null = null;

  const overlay = createOverlay();

  // ── Top bar ──────────────────────────────────────────────────────────────
  const topBar = document.createElement('div');
  topBar.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 20px; border-bottom: 1px solid rgba(212,168,75,0.25);
    flex-shrink: 0;
  `;

  const title = document.createElement('span');
  title.textContent = 'World Map';
  title.style.cssText = `
    font-size: 1.1rem; color: ${GOLD}; letter-spacing: 0.05em;
  `;
  topBar.appendChild(title);

  const closeBtn = createCloseButton(() => { destroy(); callbacks.onClose(); });
  topBar.appendChild(closeBtn);
  overlay.appendChild(topBar);

  // ── Content area ─────────────────────────────────────────────────────────
  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    flex: 1; overflow-y: auto; overflow-x: hidden;
    padding: 16px 20px;
  `;
  overlay.appendChild(contentArea);

  // ── ESC key handler ──────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      e.stopPropagation();
      destroy();
      callbacks.onClose();
    }
  }
  window.addEventListener('keydown', onKey, true);

  // ── Mount and render ─────────────────────────────────────────────────────
  root.appendChild(overlay);
  mapCleanup = buildMapTab(contentArea, currentRoomId, progress.exploredRoomIds, playerXWorld, playerYWorld);

  // ── Cleanup ─────────────────────────────────────────────────────────────
  function destroy(): void {
    window.removeEventListener('keydown', onKey, true);
    if (mapCleanup) mapCleanup();
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }

  return destroy;
}

// ── Public entry point ────────────────────────────────────────────────────────

export function showSkillTombMenu(
  root: HTMLElement,
  progress: PlayerProgress,
  currentRoomId: string,
  playerXWorld: number,
  playerYWorld: number,
  callbacks: SkillTombMenuCallbacks,
): () => void {
  let weaveLoadout: PlayerWeaveLoadout = {
    primary: { weaveId: progress.weaveLoadout.primary.weaveId, boundDust: progress.weaveLoadout.primary.boundDust.slice() },
    secondary: { weaveId: progress.weaveLoadout.secondary.weaveId, boundDust: progress.weaveLoadout.secondary.boundDust.slice() },
  };
  let activeTab: 'loadout' | 'map' = 'loadout';
  let mapCleanup: (() => void) | null = null;

  // ── Overlay ──────────────────────────────────────────────────────────────
  const overlay = createOverlay();

  // ── Top bar ──────────────────────────────────────────────────────────────
  const topBar = document.createElement('div');
  topBar.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 20px; border-bottom: 1px solid rgba(212,168,75,0.25);
    flex-shrink: 0;
  `;

  // Tab buttons
  const tabRow = document.createElement('div');
  tabRow.style.cssText = 'display: flex; gap: 0;';

  function createTabBtn(label: string, tabId: 'loadout' | 'map'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.tabId = tabId;
    btn.style.cssText = `
      padding: 8px 24px; font-family: 'Cinzel', serif; font-weight: 400;
      font-size: 1rem; cursor: pointer; border: none;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
    `;
    btn.addEventListener('click', () => {
      activeTab = tabId;
      updateTabs();
    });
    return btn;
  }

  const loadoutTabBtn = createTabBtn('Loadout', 'loadout');
  const mapTabBtn = createTabBtn('World Map', 'map');
  tabRow.appendChild(loadoutTabBtn);
  tabRow.appendChild(mapTabBtn);
  topBar.appendChild(tabRow);

  // X close button
  const closeBtn = createCloseButton(() => {
    destroy();
    const loadout = getAllBoundDust(weaveLoadout);
    callbacks.onClose(loadout.slice(), weaveLoadout);
  });
  topBar.appendChild(closeBtn);
  overlay.appendChild(topBar);

  // ── Content area ─────────────────────────────────────────────────────────
  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    flex: 1; overflow-y: auto; overflow-x: hidden;
    padding: 16px 20px;
  `;
  overlay.appendChild(contentArea);

  // ── Tab update ───────────────────────────────────────────────────────────
  function updateTabs(): void {
    // Update tab button styles
    const isLoadout = activeTab === 'loadout';
    loadoutTabBtn.style.color = isLoadout ? '#fff' : GOLD;
    loadoutTabBtn.style.background = isLoadout ? 'rgba(212,168,75,0.2)' : 'transparent';
    loadoutTabBtn.style.borderBottomColor = isLoadout ? GOLD : 'transparent';
    mapTabBtn.style.color = !isLoadout ? '#fff' : GOLD;
    mapTabBtn.style.background = !isLoadout ? 'rgba(212,168,75,0.2)' : 'transparent';
    mapTabBtn.style.borderBottomColor = !isLoadout ? GOLD : 'transparent';

    // Clean up previous map listeners before clearing content
    if (mapCleanup) {
      mapCleanup();
      mapCleanup = null;
    }

    contentArea.innerHTML = '';
    if (activeTab === 'loadout') {
      // The callback keeps our local weaveLoadout in sync; the final
      // value is read when the menu closes via onClose / ESC.
      buildLoadoutTab(contentArea, weaveLoadout, (updated) => { weaveLoadout = updated; });
    } else {
      mapCleanup = buildMapTab(contentArea, currentRoomId, progress.exploredRoomIds, playerXWorld, playerYWorld);
    }
  }

  // ── ESC key handler (close without opening pause menu) ──────────────────
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      destroy();
      const loadout = getAllBoundDust(weaveLoadout);
      callbacks.onClose(loadout.slice(), weaveLoadout);
    }
  }
  window.addEventListener('keydown', onKey, true);

  // ── Mount and initial render ────────────────────────────────────────────
  root.appendChild(overlay);
  updateTabs();

  // ── Cleanup ─────────────────────────────────────────────────────────────
  function destroy(): void {
    window.removeEventListener('keydown', onKey, true);
    if (mapCleanup) mapCleanup();
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }

  return destroy;
}
