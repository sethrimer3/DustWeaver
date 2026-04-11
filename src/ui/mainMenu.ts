/**
 * Main menu UI module.
 *
 * Flow:
 *   1. Non-blurred background animation plays on loop; music starts (once).
 *   2. Title "DustWeaver" fades in.
 *   3. Any key / click → switch to blurred animation at the same frame,
 *      show menu options (Play, Settings, Exit).
 *   4. Play → 3 save-slot selection screen.
 */

import {
  SAVE_SLOT_COUNT,
  loadSaveSlot,
  createNewSaveSlot,
  saveSaveSlot,
  deleteSaveSlot,
  formatPlayTimeMs,
  formatLastPlayed,
  SaveSlotData,
} from '../progression/saveSlots';
import { BUILD_NUMBER } from '../build-info';
import {
  getRenderSizeOptions,
  getSelectedRenderSize,
  setSelectedRenderSize,
  isOffensiveDustOutlineEnabled,
  setOffensiveDustOutlineEnabled,
  getMusicVolume,
  setMusicVolume,
  getSfxVolume,
  setSfxVolume,
  getGraphicsQuality,
  setGraphicsQuality,
  GraphicsQuality,
  getReachableEdgeGlowOpacity,
  setReachableEdgeGlowOpacity,
  getInfluenceCircleOpacity,
  setInfluenceCircleOpacity,
} from './renderSettings';
import {
  KB_ACTIONS,
  CTRL_ACTIONS,
  KEYBOARD_ACTION_META,
  CONTROLLER_ACTION_META,
  DEFAULT_CONTROLLER_BINDINGS,
  getKeyboardBindings,
  setKeyBinding,
  resetKeyboardBindings,
  findKeyConflict,
  displayKey,
  KeyboardAction,
} from '../input/keybindings';

// ─── Constants ───────────────────────────────────────────────────────────────

const FRAME_COUNT = 300;
const ANIMATION_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / ANIMATION_FPS;

/** Vite base URL so public assets resolve correctly. */
const BASE = import.meta.env.BASE_URL;

// ─── Callbacks ───────────────────────────────────────────────────────────────

export interface MainMenuCallbacks {
  onPlay: (slotIndex: number, saveData: SaveSlotData) => void;
}

// ─── Frame-Sequence Animation Player ─────────────────────────────────────────

/**
 * Preloads all frames for both normal and blurred animation sequences.
 */
function preloadFrames(): { normal: HTMLImageElement[]; blurred: HTMLImageElement[] } {
  const normal: HTMLImageElement[] = new Array(FRAME_COUNT);
  const blurred: HTMLImageElement[] = new Array(FRAME_COUNT);

  for (let i = 0; i < FRAME_COUNT; i++) {
    const idx = String(i).padStart(5, '0');

    const imgN = new Image();
    imgN.src = `${BASE}ANIMATIONS/goldEmbers/goldEmbers_${idx}.webp`;
    normal[i] = imgN;

    const imgB = new Image();
    imgB.src = `${BASE}ANIMATIONS/goldEmbers_blur/goldEmbers_blur_${idx}.webp`;
    blurred[i] = imgB;
  }

  return { normal, blurred };
}

// ─── Public entry point ──────────────────────────────────────────────────────

export function showMainMenu(root: HTMLElement, callbacks: MainMenuCallbacks): () => void {
  // ── State ────────────────────────────────────────────────────────────────
  let isBlurred = false;
  let frameIndex = 0;
  let lastFrameTimeMs = 0;
  let rafHandle = 0;
  let isRunning = false;
  let isDestroyed = false;

  // ── Preload frames ───────────────────────────────────────────────────────
  const { normal, blurred } = preloadFrames();

  // ── Background canvas ────────────────────────────────────────────────────
  const bgCanvas = document.createElement('canvas');
  bgCanvas.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 0;
  `;
  const bgCtx = bgCanvas.getContext('2d')!;

  function resizeBgCanvas(): void {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  }
  resizeBgCanvas();

  // ── Music ────────────────────────────────────────────────────────────────
  const music = new Audio(`${BASE}MUSIC/titleMenu.mp3`);
  music.loop = false;
  music.volume = 0.5;

  /** Try to play music; browsers may block autoplay until interaction. */
  function tryPlayMusic(): void {
    if (music.paused && !isDestroyed) {
      music.play().catch(() => { /* autoplay blocked — will retry on interaction */ });
    }
  }

  // ── UI container ─────────────────────────────────────────────────────────
  const container = document.createElement('div');
  container.id = 'main-menu';
  container.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #fff; font-family: 'Cinzel', serif; z-index: 1;
  `;

  // ── Title element (fades in) ─────────────────────────────────────────────
  const titleEl = document.createElement('div');
  titleEl.style.cssText = `
    text-align: center; opacity: 0;
    transition: opacity 2s ease-in;
  `;
  titleEl.innerHTML = `
    <h1 style="
      font-size: 4.5rem; color: #d4a84b;
      text-shadow: 0 0 40px rgba(212,168,75,0.5), 0 0 80px rgba(212,168,75,0.25);
      margin-bottom: 0.3rem; letter-spacing: 0.08em; font-weight: 400;
      text-transform: uppercase;
    ">DustWeaver</h1>
    <p style="
      color: rgba(212,168,75,0.55); font-size: 0.95rem; letter-spacing: 0.18em;
      text-transform: uppercase; margin-top: 0; font-weight: 400;
    ">Press any key</p>
  `;
  container.appendChild(titleEl);

  // ── Menu options container (hidden initially) ────────────────────────────
  const menuEl = document.createElement('div');
  menuEl.style.cssText = `
    display: none; flex-direction: column; align-items: center;
    gap: 1.2rem; opacity: 0; transition: opacity 0.6s ease-in;
  `;
  container.appendChild(menuEl);

  // ── Save-slot container (hidden initially) ───────────────────────────────
  const saveSlotsEl = document.createElement('div');
  saveSlotsEl.style.cssText = `
    display: none; flex-direction: column; align-items: center;
    gap: 1rem; opacity: 0; transition: opacity 0.5s ease-in;
  `;
  container.appendChild(saveSlotsEl);

  const settingsEl = document.createElement('div');
  settingsEl.style.cssText = `
    display: none; flex-direction: column; align-items: center;
    gap: 0.8rem; opacity: 0; transition: opacity 0.5s ease-in;
  `;
  container.appendChild(settingsEl);

  const buildBadgeEl = document.createElement('div');
  buildBadgeEl.textContent = `Build ${BUILD_NUMBER}`;
  buildBadgeEl.style.cssText = `
    position: absolute; top: 1rem; left: 1rem;
    background: rgba(0,0,0,0.45); border: 1px solid rgba(212,168,75,0.35);
    color: rgba(212,168,75,0.9); padding: 0.45rem 0.7rem; font-size: 0.8rem;
    letter-spacing: 0.08em; border-radius: 2px; text-transform: uppercase;
    text-shadow: 0 0 8px rgba(212,168,75,0.25); pointer-events: none;
  `;
  container.appendChild(buildBadgeEl);

  // ── Build menu buttons ───────────────────────────────────────────────────
  function createMenuButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      background: transparent; border: 1px solid rgba(212,168,75,0.4);
      color: #d4a84b; padding: 0.9rem 4rem; font-size: 1.2rem;
      font-family: 'Cinzel', serif; font-weight: 400; cursor: pointer; transition: all 0.25s;
      border-radius: 2px; letter-spacing: 0.14em; text-transform: uppercase;
      min-width: 280px;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(212,168,75,0.12)';
      btn.style.borderColor = 'rgba(212,168,75,0.8)';
      btn.style.textShadow = '0 0 12px rgba(212,168,75,0.5)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
      btn.style.borderColor = 'rgba(212,168,75,0.4)';
      btn.style.textShadow = 'none';
    });
    btn.addEventListener('click', onClick);
    return btn;
  }

  const btnPlay = createMenuButton('Play', showSaveSlots);
  const btnSettings = createMenuButton('Settings', showSettings);
  const btnExit = createMenuButton('Exit', () => {
    window.close();
  });

  menuEl.appendChild(btnPlay);
  menuEl.appendChild(btnSettings);
  menuEl.appendChild(btnExit);

  // ── Transition: title → menu ─────────────────────────────────────────────
  let hasShownMenu = false;

  function transitionToMenu(): void {
    if (hasShownMenu) return;
    hasShownMenu = true;

    // Enter fullscreen when the player dismisses the "Press any key" gate.
    // This is invoked from keydown/click handlers, so it satisfies browser
    // user-gesture requirements. Ignore failures (unsupported/blocked).
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {});
    }

    // Switch to blurred background at the same frame
    isBlurred = true;

    // Try playing music on interaction
    tryPlayMusic();

    // Hide title, show menu
    titleEl.style.opacity = '0';
    titleEl.style.transition = 'opacity 0.5s ease-out';
    setTimeout(() => {
      titleEl.style.display = 'none';
      menuEl.style.display = 'flex';
      requestAnimationFrame(() => {
        menuEl.style.opacity = '1';
      });
    }, 500);
  }

  function onAnyKey(e: KeyboardEvent): void {
    if (hasShownMenu) return;
    e.preventDefault();
    transitionToMenu();
  }

  function onAnyClick(): void {
    if (hasShownMenu) return;
    transitionToMenu();
  }

  // ── Save slots screen ────────────────────────────────────────────────────
  function showSaveSlots(): void {
    menuEl.style.opacity = '0';
    setTimeout(() => {
      menuEl.style.display = 'none';
      buildSaveSlotUI();
      saveSlotsEl.style.display = 'flex';
      requestAnimationFrame(() => {
        saveSlotsEl.style.opacity = '1';
      });
    }, 300);
  }

  function showMenuFromSlots(): void {
    saveSlotsEl.style.opacity = '0';
    setTimeout(() => {
      saveSlotsEl.style.display = 'none';
      menuEl.style.display = 'flex';
      requestAnimationFrame(() => {
        menuEl.style.opacity = '1';
      });
    }, 300);
  }

  function showSettings(): void {
    menuEl.style.opacity = '0';
    setTimeout(() => {
      menuEl.style.display = 'none';
      buildSettingsUI();
      settingsEl.style.display = 'flex';
      requestAnimationFrame(() => {
        settingsEl.style.opacity = '1';
      });
    }, 300);
  }

  function showMenuFromSettings(): void {
    settingsEl.style.opacity = '0';
    setTimeout(() => {
      settingsEl.style.display = 'none';
      menuEl.style.display = 'flex';
      requestAnimationFrame(() => {
        menuEl.style.opacity = '1';
      });
    }, 300);
  }

  function buildSaveSlotUI(): void {
    saveSlotsEl.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Select Save Slot';
    heading.style.cssText = `
      color: #d4a84b; font-size: 1.8rem; margin-bottom: 0.6rem;
      text-shadow: 0 0 20px rgba(212,168,75,0.3);
      letter-spacing: 0.06em; font-weight: 400;
    `;
    saveSlotsEl.appendChild(heading);

    function showDeleteConfirmation(slotIndex: number): void {
      const confirmOverlayEl = document.createElement('div');
      confirmOverlayEl.style.cssText = `
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.7); z-index: 4;
      `;

      const panelEl = document.createElement('div');
      panelEl.style.cssText = `
        min-width: 340px; background: rgba(0,0,0,0.85); border: 1px solid rgba(212,168,75,0.55);
        border-radius: 3px; padding: 1.1rem 1.2rem 1rem; text-align: center;
      `;

      const promptEl = document.createElement('div');
      promptEl.textContent = 'DELETE Save File?';
      promptEl.style.cssText = `
        color: #d4a84b; font-size: 1rem; letter-spacing: 0.08em; margin-bottom: 0.9rem;
        text-transform: uppercase;
      `;
      panelEl.appendChild(promptEl);

      const actionsEl = document.createElement('div');
      actionsEl.style.cssText = 'display: flex; gap: 0.7rem; justify-content: center;';
      panelEl.appendChild(actionsEl);

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = `
        background: transparent; border: 1px solid rgba(212,168,75,0.35);
        color: rgba(212,168,75,0.7); padding: 0.45rem 1rem; font-size: 0.85rem;
        font-family: 'Cinzel', serif; cursor: pointer; letter-spacing: 0.06em;
      `;
      cancelBtn.addEventListener('click', () => {
        if (confirmOverlayEl.parentElement !== null) {
          confirmOverlayEl.parentElement.removeChild(confirmOverlayEl);
        }
      });
      actionsEl.appendChild(cancelBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'DELETE';
      deleteBtn.style.cssText = `
        background: rgba(115,0,0,0.35); border: 1px solid rgba(225,88,88,0.65);
        color: #ffb3b3; padding: 0.45rem 1rem; font-size: 0.85rem;
        font-family: 'Cinzel', serif; cursor: pointer; letter-spacing: 0.06em;
      `;
      actionsEl.appendChild(deleteBtn);

      let hasConfirmedDeletion = false;
      deleteBtn.addEventListener('click', () => {
        if (!hasConfirmedDeletion) {
          hasConfirmedDeletion = true;
          promptEl.textContent = 'Are you sure?';
          deleteBtn.textContent = 'DELETE!';
          return;
        }
        deleteSaveSlot(slotIndex);
        buildSaveSlotUI();
      });

      panelEl.addEventListener('click', (e) => e.stopPropagation());
      confirmOverlayEl.addEventListener('click', () => {
        if (confirmOverlayEl.parentElement !== null) {
          confirmOverlayEl.parentElement.removeChild(confirmOverlayEl);
        }
      });

      confirmOverlayEl.appendChild(panelEl);
      saveSlotsEl.appendChild(confirmOverlayEl);
    }

    for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
      const slotData = loadSaveSlot(i);
      const hasData = slotData !== null;

      const slotRowEl = document.createElement('div');
      slotRowEl.style.cssText = `
        display: flex; align-items: stretch; gap: 0.45rem; width: 100%;
        justify-content: center;
      `;

      const slotBtn = document.createElement('button');
      slotBtn.style.cssText = `
        background: rgba(0,0,0,0.5); border: 1px solid rgba(212,168,75,0.3);
        color: #d4a84b; padding: 1.2rem 2rem;
        font-family: 'Cinzel', serif; font-weight: 400; cursor: pointer; transition: all 0.25s;
        border-radius: 3px; min-width: 300px; text-align: center;
      `;

      if (hasData) {
        slotBtn.innerHTML = `
          <div style="font-size: 1.1rem; letter-spacing: 0.1em; margin-bottom: 0.4rem; font-weight: 400;">
            Save Slot ${i + 1}
          </div>
          <div style="font-size: 0.8rem; color: rgba(212,168,75,0.65); letter-spacing: 0.05em;">
            Play Time: ${formatPlayTimeMs(slotData.playTimeMs)}
          </div>
          <div style="font-size: 0.8rem; color: rgba(212,168,75,0.5); letter-spacing: 0.05em; margin-top: 0.15rem;">
            Last Played: ${formatLastPlayed(slotData.lastPlayedIso)}
          </div>
        `;
      } else {
        slotBtn.innerHTML = `
          <div style="font-size: 1.1rem; letter-spacing: 0.1em; margin-bottom: 0.4rem; font-weight: 400;">
            Save Slot ${i + 1}
          </div>
          <div style="font-size: 0.8rem; color: rgba(212,168,75,0.4); letter-spacing: 0.05em;">
            — Empty —
          </div>
        `;
      }

      slotBtn.addEventListener('mouseenter', () => {
        slotBtn.style.background = 'rgba(212,168,75,0.1)';
        slotBtn.style.borderColor = 'rgba(212,168,75,0.7)';
      });
      slotBtn.addEventListener('mouseleave', () => {
        slotBtn.style.background = 'rgba(0,0,0,0.5)';
        slotBtn.style.borderColor = 'rgba(212,168,75,0.3)';
      });

      const slotIndex = i;
      slotBtn.addEventListener('click', () => {
        let data = slotData;
        if (data === null) {
          data = createNewSaveSlot();
          saveSaveSlot(slotIndex, data);
        }
        callbacks.onPlay(slotIndex, data);
      });

      slotRowEl.appendChild(slotBtn);

      const deleteSlotBtn = document.createElement('button');
      deleteSlotBtn.textContent = 'x';
      deleteSlotBtn.title = `Delete Save Slot ${slotIndex + 1}`;
      deleteSlotBtn.style.cssText = `
        width: 44px; min-width: 44px; border-radius: 3px; border: 1px solid rgba(225,88,88,0.6);
        background: rgba(90,0,0,0.42); color: #ffb3b3; cursor: pointer;
        font-family: 'Cinzel', serif; font-size: 1rem; text-transform: uppercase;
      `;
      deleteSlotBtn.addEventListener('mouseenter', () => {
        deleteSlotBtn.style.background = 'rgba(130,0,0,0.5)';
        deleteSlotBtn.style.borderColor = 'rgba(255,130,130,0.85)';
      });
      deleteSlotBtn.addEventListener('mouseleave', () => {
        deleteSlotBtn.style.background = 'rgba(90,0,0,0.42)';
        deleteSlotBtn.style.borderColor = 'rgba(225,88,88,0.6)';
      });
      deleteSlotBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showDeleteConfirmation(slotIndex);
      });

      slotRowEl.appendChild(deleteSlotBtn);
      saveSlotsEl.appendChild(slotRowEl);
    }

    // Back button
    const backBtn = document.createElement('button');
    backBtn.textContent = 'Back';
    backBtn.style.cssText = `
      background: transparent; border: 1px solid rgba(212,168,75,0.25);
      color: rgba(212,168,75,0.6); padding: 0.6rem 2.5rem; font-size: 0.9rem;
      font-family: 'Cinzel', serif; cursor: pointer; transition: all 0.25s;
      border-radius: 2px; letter-spacing: 0.1em; margin-top: 0.5rem;
    `;
    backBtn.addEventListener('mouseenter', () => {
      backBtn.style.borderColor = 'rgba(212,168,75,0.6)';
      backBtn.style.color = '#d4a84b';
    });
    backBtn.addEventListener('mouseleave', () => {
      backBtn.style.borderColor = 'rgba(212,168,75,0.25)';
      backBtn.style.color = 'rgba(212,168,75,0.6)';
    });
    backBtn.addEventListener('click', showMenuFromSlots);
    saveSlotsEl.appendChild(backBtn);
  }

  function buildSettingsUI(): void {
    settingsEl.innerHTML = '';

    // ── Settings panel container ──────────────────────────────────────────
    const panel = document.createElement('div');
    panel.style.cssText = `
      background: rgba(12,10,8,0.92);
      border: 1px solid rgba(212,168,75,0.3);
      border-radius: 8px;
      padding: 0 0 24px 0;
      min-width: 520px;
      max-width: 620px;
      width: 100%;
      text-align: left;
      overflow: hidden;
    `;

    // ── Panel heading ──────────────────────────────────────────────────────
    const panelHeading = document.createElement('div');
    panelHeading.style.cssText = `
      padding: 20px 28px 0 28px;
      font-family: 'Cinzel', serif;
      color: #d4a84b;
      font-size: 1.4rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      text-shadow: 0 0 16px rgba(212,168,75,0.3);
      margin-bottom: 4px;
    `;
    panelHeading.textContent = 'Settings';
    panel.appendChild(panelHeading);

    // ── Tab bar ────────────────────────────────────────────────────────────
    type SettingsTab = 'audio' | 'visual' | 'gameplay' | 'keybindings';
    let activeSettingsTab: SettingsTab = 'audio';

    const tabBar = document.createElement('div');
    tabBar.style.cssText = `
      display: flex;
      margin: 16px 0 0 0;
      border-bottom: 1px solid rgba(212,168,75,0.2);
      padding: 0 28px;
      gap: 0;
    `;

    const TAB_LABELS: { id: SettingsTab; label: string }[] = [
      { id: 'audio',       label: 'Audio'       },
      { id: 'visual',      label: 'Visual'       },
      { id: 'gameplay',    label: 'Gameplay'     },
      { id: 'keybindings', label: 'Keybindings'  },
    ];

    const tabButtons: Partial<Record<SettingsTab, HTMLButtonElement>> = {};

    function updateTabStyles(): void {
      for (let i = 0; i < TAB_LABELS.length; i++) {
        const { id } = TAB_LABELS[i];
        const btn = tabButtons[id];
        if (btn === undefined) continue;
        const isActive = id === activeSettingsTab;
        btn.style.color = isActive ? '#fff' : 'rgba(212,168,75,0.65)';
        btn.style.borderBottom = isActive
          ? '2px solid #d4a84b'
          : '2px solid transparent';
        btn.style.background = isActive
          ? 'rgba(212,168,75,0.08)'
          : 'transparent';
      }
    }

    for (let i = 0; i < TAB_LABELS.length; i++) {
      const { id, label } = TAB_LABELS[i];
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `
        flex: 1;
        padding: 10px 4px;
        font-family: 'Cinzel', serif;
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        border: none;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
        border-radius: 0;
        text-transform: uppercase;
      `;
      const tabId = id;
      btn.addEventListener('click', () => {
        activeSettingsTab = tabId;
        updateTabStyles();
        buildTabContent();
      });
      tabButtons[id] = btn;
      tabBar.appendChild(btn);
    }
    panel.appendChild(tabBar);
    updateTabStyles();

    // ── Tab content area ───────────────────────────────────────────────────
    const tabContent = document.createElement('div');
    tabContent.style.cssText = `
      padding: 20px 28px 4px 28px;
      min-height: 220px;
      max-height: 55vh;
      overflow-y: auto;
    `;
    panel.appendChild(tabContent);

    // ── Shared helpers ─────────────────────────────────────────────────────

    function makeLabel(text: string): HTMLDivElement {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = `
        font-family: 'Cinzel', serif;
        color: rgba(212,168,75,0.55);
        font-size: 0.75rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-bottom: 6px;
        margin-top: 18px;
      `;
      return el;
    }

    function makeSettingsSlider(
      label: string,
      initialValue: number,
      onChangeFn: (v: number) => void,
    ): HTMLDivElement {
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex; align-items: center; gap: 12px;
        font-family: 'Cinzel', serif; color: #d4a84b;
        font-size: 0.9rem; margin-bottom: 12px;
      `;
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = `min-width: 160px; font-size: 0.88rem; letter-spacing: 0.04em;`;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(Math.round(initialValue * 100));
      slider.style.cssText = `flex: 1; accent-color: #d4a84b; cursor: pointer;`;

      const valLbl = document.createElement('span');
      valLbl.textContent = `${Math.round(initialValue * 100)}%`;
      valLbl.style.cssText = `min-width: 40px; text-align: right; font-size: 0.85rem;`;

      slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10);
        valLbl.textContent = `${v}%`;
        onChangeFn(v / 100);
      });

      row.appendChild(lbl);
      row.appendChild(slider);
      row.appendChild(valLbl);
      return row;
    }

    function makeStyledDropdown(
      options: { value: string; label: string }[],
      currentValue: string,
      onChangeFn: (value: string) => void,
    ): HTMLDivElement {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `position: relative; display: inline-block; width: 100%;`;

      const select = document.createElement('select');
      select.style.cssText = `
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        padding: 10px 40px 10px 14px;
        font-family: 'Cinzel', serif;
        font-size: 0.9rem;
        color: #d4a84b;
        background: rgba(20,18,12,0.9);
        border: 1px solid rgba(212,168,75,0.35);
        border-radius: 4px;
        cursor: pointer;
        outline: none;
        letter-spacing: 0.04em;
        transition: border-color 0.15s;
      `;
      select.addEventListener('focus', () => {
        select.style.borderColor = 'rgba(212,168,75,0.8)';
      });
      select.addEventListener('blur', () => {
        select.style.borderColor = 'rgba(212,168,75,0.35)';
      });

      for (let i = 0; i < options.length; i++) {
        const opt = document.createElement('option');
        opt.value = options[i].value;
        opt.textContent = options[i].label;
        opt.style.background = 'rgba(20,18,12,0.98)';
        opt.style.color = '#d4a84b';
        if (options[i].value === currentValue) opt.selected = true;
        select.appendChild(opt);
      }

      select.addEventListener('change', () => {
        onChangeFn(select.value);
      });

      // Chevron arrow
      const arrow = document.createElement('div');
      arrow.textContent = '▾';
      arrow.style.cssText = `
        position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
        color: rgba(212,168,75,0.6); pointer-events: none; font-size: 1rem;
      `;

      wrapper.appendChild(select);
      wrapper.appendChild(arrow);
      return wrapper;
    }

    // ── Audio tab ──────────────────────────────────────────────────────────

    function buildAudioTab(): void {
      tabContent.innerHTML = '';

      const musicLbl = makeLabel('Music Volume');
      musicLbl.style.marginTop = '4px';
      tabContent.appendChild(musicLbl);
      tabContent.appendChild(makeSettingsSlider('Music', getMusicVolume(), (v) => {
        setMusicVolume(v);
      }));

      tabContent.appendChild(makeLabel('Sound Effects Volume'));
      tabContent.appendChild(makeSettingsSlider('Sound Effects', getSfxVolume(), (v) => {
        setSfxVolume(v);
      }));
    }

    // ── Visual tab ─────────────────────────────────────────────────────────

    function buildVisualTab(): void {
      tabContent.innerHTML = '';

      const qualityLbl = makeLabel('Quality');
      qualityLbl.style.marginTop = '4px';
      tabContent.appendChild(qualityLbl);
      const qualityOptions: { value: string; label: string }[] = [
        { value: 'low',  label: 'Low'  },
        { value: 'high', label: 'High' },
      ];
      const qualityDropdown = makeStyledDropdown(
        qualityOptions,
        getGraphicsQuality(),
        (v) => { setGraphicsQuality(v as GraphicsQuality); },
      );
      tabContent.appendChild(qualityDropdown);

      tabContent.appendChild(makeLabel('Resolution'));
      const resOptions = getRenderSizeOptions();
      const resOptionsMapped: { value: string; label: string }[] = [];
      for (let i = 0; i < resOptions.length; i++) {
        resOptionsMapped.push({ value: resOptions[i].id, label: resOptions[i].label });
      }
      const resDropdown = makeStyledDropdown(
        resOptionsMapped,
        getSelectedRenderSize().id,
        (v) => { setSelectedRenderSize(v); },
      );
      tabContent.appendChild(resDropdown);

      tabContent.appendChild(makeLabel('Misc'));
      const outlineEnabled = isOffensiveDustOutlineEnabled();
      const outlineBtn = document.createElement('button');
      outlineBtn.style.cssText = `
        width: 100%; padding: 10px 14px; margin-bottom: 10px;
        font-family: 'Cinzel', serif; font-size: 0.88rem; letter-spacing: 0.05em;
        text-align: left; cursor: pointer; border-radius: 4px;
        transition: background 0.15s, border-color 0.15s;
        border: 1px solid rgba(212,168,75,${outlineEnabled ? '0.7' : '0.3'});
        background: rgba(212,168,75,${outlineEnabled ? '0.12' : '0'});
        color: #d4a84b;
      `;
      outlineBtn.textContent = `Offensive Dust Outline: ${outlineEnabled ? 'On' : 'Off'}`;
      outlineBtn.addEventListener('click', () => {
        const nowEnabled = !isOffensiveDustOutlineEnabled();
        setOffensiveDustOutlineEnabled(nowEnabled);
        outlineBtn.textContent = `Offensive Dust Outline: ${nowEnabled ? 'On' : 'Off'}`;
        outlineBtn.style.borderColor = `rgba(212,168,75,${nowEnabled ? '0.7' : '0.3'})`;
        outlineBtn.style.background = `rgba(212,168,75,${nowEnabled ? '0.12' : '0'})`;
      });
      tabContent.appendChild(outlineBtn);
    }

    // ── Gameplay tab ───────────────────────────────────────────────────────

    function buildGameplayTab(): void {
      tabContent.innerHTML = '';

      const glowLbl = makeLabel('Grapple Surface Highlight Opacity');
      glowLbl.style.marginTop = '4px';
      tabContent.appendChild(glowLbl);
      tabContent.appendChild(
        makeSettingsSlider('Highlight Opacity', getReachableEdgeGlowOpacity(), (v) => {
          setReachableEdgeGlowOpacity(v);
        }),
      );

      tabContent.appendChild(makeLabel('Influence Circle Opacity'));
      tabContent.appendChild(
        makeSettingsSlider('Circle Opacity', getInfluenceCircleOpacity(), (v) => {
          setInfluenceCircleOpacity(v);
        }),
      );
    }

    // ── Keybindings tab ────────────────────────────────────────────────────

    function buildKeybindingsTab(): void {
      tabContent.innerHTML = '';

      type KbSubTab = 'keyboard' | 'controller';
      let activeKbSubTab: KbSubTab = 'keyboard';
      let rebindingAction: KeyboardAction | null = null;
      let rebindCleanup: (() => void) | null = null;

      // Sub-tab bar
      const subTabBar = document.createElement('div');
      subTabBar.style.cssText = `
        display: flex; gap: 8px; margin-bottom: 16px; margin-top: 2px;
      `;

      const kbSubBtn = document.createElement('button');
      const ctrlSubBtn = document.createElement('button');

      function styleSubTabs(): void {
        const kbActive = activeKbSubTab === 'keyboard';
        kbSubBtn.style.cssText = `
          flex: 1; padding: 8px 0;
          font-family: 'Cinzel', serif; font-size: 0.8rem; letter-spacing: 0.06em;
          text-transform: uppercase; cursor: pointer; border-radius: 3px;
          color: ${kbActive ? '#fff' : 'rgba(212,168,75,0.6)'};
          background: ${kbActive ? 'rgba(212,168,75,0.18)' : 'rgba(0,0,0,0.3)'};
          border: 1px solid rgba(212,168,75,${kbActive ? '0.6' : '0.2'});
          transition: all 0.15s;
        `;
        ctrlSubBtn.style.cssText = `
          flex: 1; padding: 8px 0;
          font-family: 'Cinzel', serif; font-size: 0.8rem; letter-spacing: 0.06em;
          text-transform: uppercase; cursor: pointer; border-radius: 3px;
          color: ${!kbActive ? '#fff' : 'rgba(212,168,75,0.6)'};
          background: ${!kbActive ? 'rgba(212,168,75,0.18)' : 'rgba(0,0,0,0.3)'};
          border: 1px solid rgba(212,168,75,${!kbActive ? '0.6' : '0.2'});
          transition: all 0.15s;
        `;
      }

      kbSubBtn.textContent = 'Keyboard / Mouse';
      ctrlSubBtn.textContent = 'Controller';
      styleSubTabs();

      kbSubBtn.addEventListener('click', () => {
        cancelRebind();
        activeKbSubTab = 'keyboard';
        styleSubTabs();
        buildBindingList();
      });
      ctrlSubBtn.addEventListener('click', () => {
        cancelRebind();
        activeKbSubTab = 'controller';
        styleSubTabs();
        buildBindingList();
      });

      subTabBar.appendChild(kbSubBtn);
      subTabBar.appendChild(ctrlSubBtn);
      tabContent.appendChild(subTabBar);

      // Binding list container
      const bindingList = document.createElement('div');
      tabContent.appendChild(bindingList);

      // Cancel any in-progress rebind
      function cancelRebind(): void {
        rebindingAction = null;
        if (rebindCleanup !== null) {
          rebindCleanup();
          rebindCleanup = null;
        }
      }

      // Build the binding rows
      function buildBindingList(): void {
        cancelRebind();
        bindingList.innerHTML = '';

        if (activeKbSubTab === 'keyboard') {
          buildKeyboardBindingList();
        } else {
          buildControllerBindingList();
        }
      }

      function buildKeyboardBindingList(): void {
        const bindings = getKeyboardBindings();

        // Fixed mouse bindings header
        const mouseHeader = document.createElement('div');
        mouseHeader.style.cssText = `
          font-family: 'Cinzel', serif; color: rgba(212,168,75,0.45);
          font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase;
          margin-bottom: 6px;
        `;
        mouseHeader.textContent = 'Mouse (fixed)';
        bindingList.appendChild(mouseHeader);

        const fixedMouseActions: { label: string; bind: string }[] = [
          { label: 'Attack / Grapple',  bind: 'Left Click' },
          { label: 'Secondary Weave',   bind: 'Right Click' },
          { label: 'Aim',               bind: 'Mouse Move' },
        ];
        for (let i = 0; i < fixedMouseActions.length; i++) {
          bindingList.appendChild(makeFixedBindingRow(
            fixedMouseActions[i].label,
            fixedMouseActions[i].bind,
          ));
        }

        const kbHeader = document.createElement('div');
        kbHeader.style.cssText = `
          font-family: 'Cinzel', serif; color: rgba(212,168,75,0.45);
          font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase;
          margin-top: 14px; margin-bottom: 6px;
        `;
        kbHeader.textContent = 'Keyboard (rebindable)';
        bindingList.appendChild(kbHeader);

        for (let i = 0; i < KB_ACTIONS.length; i++) {
          const action = KB_ACTIONS[i];
          const meta = KEYBOARD_ACTION_META[action];
          const currentKey = bindings[action];
          bindingList.appendChild(makeRebindRow(action, meta.label, currentKey));
        }

        // Reset button
        const resetRow = document.createElement('div');
        resetRow.style.cssText = `margin-top: 16px; text-align: center;`;
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset to Defaults';
        resetBtn.style.cssText = `
          padding: 8px 20px; font-family: 'Cinzel', serif; font-size: 0.8rem;
          letter-spacing: 0.06em; cursor: pointer; border-radius: 4px;
          color: rgba(212,168,75,0.7); background: transparent;
          border: 1px solid rgba(212,168,75,0.3);
          transition: all 0.15s;
        `;
        resetBtn.addEventListener('mouseenter', () => {
          resetBtn.style.borderColor = 'rgba(212,168,75,0.7)';
          resetBtn.style.color = '#d4a84b';
        });
        resetBtn.addEventListener('mouseleave', () => {
          resetBtn.style.borderColor = 'rgba(212,168,75,0.3)';
          resetBtn.style.color = 'rgba(212,168,75,0.7)';
        });
        resetBtn.addEventListener('click', () => {
          resetKeyboardBindings();
          buildBindingList();
        });
        resetRow.appendChild(resetBtn);
        bindingList.appendChild(resetRow);
      }

      function makeFixedBindingRow(label: string, bind: string): HTMLDivElement {
        const row = document.createElement('div');
        row.style.cssText = `
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 0; border-bottom: 1px solid rgba(212,168,75,0.07);
        `;
        const lblEl = document.createElement('span');
        lblEl.textContent = label;
        lblEl.style.cssText = `
          font-family: 'Cinzel', serif; font-size: 0.85rem; color: rgba(212,168,75,0.55);
          letter-spacing: 0.03em;
        `;
        const bindEl = document.createElement('span');
        bindEl.textContent = bind;
        bindEl.style.cssText = `
          font-family: 'Cinzel', serif; font-size: 0.8rem;
          color: rgba(212,168,75,0.4); letter-spacing: 0.05em;
          padding: 4px 10px; border: 1px solid rgba(212,168,75,0.15);
          border-radius: 3px; background: rgba(0,0,0,0.25);
        `;
        row.appendChild(lblEl);
        row.appendChild(bindEl);
        return row;
      }

      function makeRebindRow(
        action: KeyboardAction,
        label: string,
        currentKey: string,
      ): HTMLDivElement {
        const row = document.createElement('div');
        row.style.cssText = `
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 0; border-bottom: 1px solid rgba(212,168,75,0.07);
        `;

        const lblEl = document.createElement('span');
        lblEl.textContent = label;
        lblEl.style.cssText = `
          font-family: 'Cinzel', serif; font-size: 0.85rem; color: #d4a84b;
          letter-spacing: 0.03em;
        `;

        const keyBtn = document.createElement('button');
        keyBtn.textContent = displayKey(currentKey);
        keyBtn.style.cssText = `
          font-family: 'Cinzel', serif; font-size: 0.8rem; letter-spacing: 0.05em;
          padding: 5px 12px; min-width: 80px; text-align: center;
          border: 1px solid rgba(212,168,75,0.4); border-radius: 3px;
          background: rgba(0,0,0,0.35); color: #d4a84b; cursor: pointer;
          transition: all 0.15s;
        `;
        keyBtn.addEventListener('mouseenter', () => {
          if (rebindingAction !== action) {
            keyBtn.style.borderColor = 'rgba(212,168,75,0.75)';
            keyBtn.style.background = 'rgba(212,168,75,0.1)';
          }
        });
        keyBtn.addEventListener('mouseleave', () => {
          if (rebindingAction !== action) {
            keyBtn.style.borderColor = 'rgba(212,168,75,0.4)';
            keyBtn.style.background = 'rgba(0,0,0,0.35)';
          }
        });

        // Conflict warning label
        const conflictEl = document.createElement('span');
        conflictEl.style.cssText = `
          font-family: 'Cinzel', serif; font-size: 0.72rem; color: #e88;
          margin-right: 8px; display: none; line-height: 1.4;
        `;
        row.appendChild(lblEl);
        row.appendChild(conflictEl);
        row.appendChild(keyBtn);

        keyBtn.addEventListener('click', () => {
          if (rebindingAction === action) {
            // Second click cancels
            cancelRebind();
            buildBindingList();
            return;
          }
          cancelRebind();
          rebindingAction = action;
          keyBtn.textContent = 'Press a key…';
          keyBtn.style.borderColor = '#d4a84b';
          keyBtn.style.background = 'rgba(212,168,75,0.15)';
          keyBtn.style.color = '#fff';
          conflictEl.style.display = 'none';

          // Tracks a pending conflicting key that needs a second press to confirm.
          let pendingConflictKey: string | null = null;
          let pendingConflictAction: KeyboardAction | null = null;

          function onRebindKey(e: KeyboardEvent): void {
            e.preventDefault();
            e.stopImmediatePropagation();

            // Escape always cancels
            if (e.key === 'Escape') {
              cancelRebind();
              buildBindingList();
              return;
            }

            const newKey = e.key;

            if (pendingConflictKey !== null && newKey === pendingConflictKey) {
              // Second press of the conflicting key — user confirms the override
              if (pendingConflictAction !== null) {
                setKeyBinding(pendingConflictAction, '');
              }
              setKeyBinding(action, newKey);
              cancelRebind();
              buildBindingList();
              return;
            }

            // Check for conflict
            const conflictAction = findKeyConflict(newKey, action);
            if (conflictAction !== null) {
              const conflictLabel = KEYBOARD_ACTION_META[conflictAction].label;
              // Warn and wait for a second press to confirm
              pendingConflictKey = newKey;
              pendingConflictAction = conflictAction;
              keyBtn.textContent = displayKey(newKey);
              keyBtn.style.color = '#e88';
              keyBtn.style.borderColor = '#e88';
              conflictEl.textContent = `Conflicts with "${conflictLabel}". Press ${displayKey(newKey)} again to override, or choose another key.`;
              conflictEl.style.display = 'block';
              return;
            }

            setKeyBinding(action, newKey);
            cancelRebind();
            buildBindingList();
          }

          window.addEventListener('keydown', onRebindKey, { capture: true });
          rebindCleanup = () => {
            window.removeEventListener('keydown', onRebindKey, { capture: true });
          };
        });

        return row;
      }

      function buildControllerBindingList(): void {
        const header = document.createElement('div');
        header.style.cssText = `
          font-family: 'Cinzel', serif; color: rgba(212,168,75,0.45);
          font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase;
          margin-bottom: 6px;
        `;
        header.textContent = 'Controller (default mapping)';
        bindingList.appendChild(header);

        for (let i = 0; i < CTRL_ACTIONS.length; i++) {
          const action = CTRL_ACTIONS[i];
          const meta = CONTROLLER_ACTION_META[action];
          const bind = DEFAULT_CONTROLLER_BINDINGS[action];
          bindingList.appendChild(makeFixedBindingRow(meta.label, bind));
        }

        const note = document.createElement('div');
        note.style.cssText = `
          margin-top: 12px; font-family: 'Cinzel', serif;
          font-size: 0.75rem; color: rgba(212,168,75,0.35);
          letter-spacing: 0.03em; line-height: 1.5;
        `;
        note.textContent = 'Controller rebinding is not yet supported. Shown mapping reflects standard modern controller conventions.';
        bindingList.appendChild(note);
      }

      buildBindingList();
    }

    // ── Route to active tab ────────────────────────────────────────────────

    function buildTabContent(): void {
      if (activeSettingsTab === 'audio')       buildAudioTab();
      else if (activeSettingsTab === 'visual') buildVisualTab();
      else if (activeSettingsTab === 'gameplay') buildGameplayTab();
      else                                     buildKeybindingsTab();
    }

    buildTabContent();
    settingsEl.appendChild(panel);

    // ── Back button ────────────────────────────────────────────────────────
    const backBtn = document.createElement('button');
    backBtn.textContent = 'Back';
    backBtn.style.cssText = `
      background: transparent; border: 1px solid rgba(212,168,75,0.25);
      color: rgba(212,168,75,0.6); padding: 0.6rem 2.5rem; font-size: 0.9rem;
      font-family: 'Cinzel', serif; cursor: pointer; transition: all 0.25s;
      border-radius: 2px; letter-spacing: 0.1em; margin-top: 1rem;
    `;
    backBtn.addEventListener('mouseenter', () => {
      backBtn.style.borderColor = 'rgba(212,168,75,0.6)';
      backBtn.style.color = '#d4a84b';
    });
    backBtn.addEventListener('mouseleave', () => {
      backBtn.style.borderColor = 'rgba(212,168,75,0.25)';
      backBtn.style.color = 'rgba(212,168,75,0.6)';
    });
    backBtn.addEventListener('click', showMenuFromSettings);
    settingsEl.appendChild(backBtn);
  }

  // ── Animation loop ───────────────────────────────────────────────────────
  function drawFrame(timestampMs: number): void {
    if (!isRunning) return;

    if (lastFrameTimeMs === 0) lastFrameTimeMs = timestampMs;

    const elapsedMs = timestampMs - lastFrameTimeMs;
    if (elapsedMs >= FRAME_INTERVAL_MS) {
      const framesToAdvance = Math.floor(elapsedMs / FRAME_INTERVAL_MS);
      frameIndex = (frameIndex + framesToAdvance) % FRAME_COUNT;
      lastFrameTimeMs += framesToAdvance * FRAME_INTERVAL_MS;

      const frames = isBlurred ? blurred : normal;
      const img = frames[frameIndex];
      if (img.complete && img.naturalWidth > 0) {
        const cw = bgCanvas.width;
        const ch = bgCanvas.height;
        bgCtx.clearRect(0, 0, cw, ch);

        // Cover-fill: scale to fill canvas while maintaining aspect ratio
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const scale = Math.max(cw / iw, ch / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (cw - dw) / 2;
        const dy = (ch - dh) / 2;
        bgCtx.drawImage(img, dx, dy, dw, dh);
      }
    }

    rafHandle = requestAnimationFrame(drawFrame);
  }

  // ── Mount & start ────────────────────────────────────────────────────────
  root.appendChild(bgCanvas);
  root.appendChild(container);

  isRunning = true;
  rafHandle = requestAnimationFrame(drawFrame);

  // Fade in the title after a brief delay
  setTimeout(() => {
    if (!isDestroyed) {
      titleEl.style.opacity = '1';
    }
  }, 100);

  // Try auto-playing music (will likely need user interaction)
  tryPlayMusic();

  window.addEventListener('keydown', onAnyKey);
  container.addEventListener('click', onAnyClick);
  window.addEventListener('resize', resizeBgCanvas);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  return () => {
    isDestroyed = true;
    isRunning = false;
    if (rafHandle !== 0) {
      cancelAnimationFrame(rafHandle);
      rafHandle = 0;
    }
    music.pause();
    music.src = '';
    window.removeEventListener('keydown', onAnyKey);
    container.removeEventListener('click', onAnyClick);
    window.removeEventListener('resize', resizeBgCanvas);
    if (bgCanvas.parentElement !== null) bgCanvas.parentElement.removeChild(bgCanvas);
    if (container.parentElement !== null) container.parentElement.removeChild(container);
  };
}
