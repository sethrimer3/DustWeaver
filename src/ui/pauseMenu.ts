/**
 * Pause menu overlay shown when the player presses ESC during gameplay.
 *
 * Structure:
 *   - "Options" button → opens options sub-panel with Sound / Graphics tabs
 *   - "Exit to Main Menu" button
 *   - "Debug On" / "Debug Off" toggle button
 *
 * Options sub-panel:
 *   - Sound tab: Music volume slider, SFX volume slider
 *   - Graphics tab: Low / Med / High quality buttons
 */

import {
  getReachableEdgeGlowOpacity, setReachableEdgeGlowOpacity,
  getInfluenceCircleOpacity, setInfluenceCircleOpacity,
  getInfluenceHighlightWidth, setInfluenceHighlightWidth,
  setMusicVolume, setSfxVolume,
  setGraphicsQuality,
  setAlwaysCenterCamera,
  setManualSprintEnabled,
  WORLD_VIEW_PRESETS, setWorldViewPresetId, getActiveWorldViewPreset,
  type WorldViewPresetId,
} from './renderSettings';
import { makeButton, makeSlider, makeTabButton, GOLD, PANEL_BORDER } from './helpers';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PauseMenuCallbacks {
  onResume: () => void;
  onExitToMainMenu: () => void;
  onToggleDebug: () => void;
  /** Called after a World View preset change so the caller can resize the virtual canvas. */
  onWorldViewChanged?: () => void;
}

export interface PauseMenuState {
  isDebugOn: boolean;
  musicVolume: number;
  sfxVolume: number;
  graphicsQuality: 'low' | 'med' | 'high';
  /** Whether the always-center-camera mode is enabled. */
  alwaysCenterCamera: boolean;
  /** Active world view preset id. */
  worldViewPresetId: WorldViewPresetId;
  /** When true, sprint requires holding the Sprint key; when false, sprint is always active while moving. */
  manualSprintEnabled: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DARK_BG = 'rgba(0,0,0,0.78)';
const PANEL_BG = 'rgba(20,18,14,0.92)';

function makeQualityButton(
  text: string,
  isActive: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    flex: 1;
    padding: 10px 6px;
    margin: 0 4px;
    font-family: 'Cinzel', serif;
    font-size: 0.95rem;
    color: ${isActive ? '#fff' : GOLD};
    background: ${isActive ? 'rgba(212,168,75,0.3)' : 'rgba(30,28,22,0.7)'};
    border: 2px solid ${isActive ? GOLD : PANEL_BORDER};
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  `;
  btn.addEventListener('click', onClick);
  return btn;
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Shows the pause menu overlay. Returns a cleanup function that removes the UI.
 */
export function showPauseMenu(
  root: HTMLElement,
  state: PauseMenuState,
  callbacks: PauseMenuCallbacks,
): () => void {
  // ── Overlay ───────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: ${DARK_BG};
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  `;

  // ── Container ─────────────────────────────────────────────────────────────
  const container = document.createElement('div');
  container.style.cssText = `
    background: ${PANEL_BG};
    border: 1px solid ${PANEL_BORDER};
    border-radius: 10px;
    padding: 36px 30px 24px 30px;
    min-width: 320px;
    max-width: 420px;
    text-align: center;
  `;

  // ── Title ─────────────────────────────────────────────────────────────────
  const title = document.createElement('h2');
  title.textContent = 'PAUSED';
  title.style.cssText = `
    font-family: 'Cinzel', serif; color: ${GOLD}; font-size: 1.6rem;
    margin: 0 0 28px 0; letter-spacing: 3px;
    text-shadow: 0 0 12px rgba(212,168,75,0.4);
  `;
  container.appendChild(title);

  // ── Options sub-panel (hidden by default) ─────────────────────────────────
  const optionsPanel = document.createElement('div');
  optionsPanel.style.cssText = `display: none; text-align: left;`;

  let activeTab: 'sound' | 'graphics' = 'sound';

  function buildOptionsContent(): void {
    optionsPanel.innerHTML = '';

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.style.cssText = `display: flex; margin-bottom: 16px; border-bottom: 1px solid ${PANEL_BORDER};`;

    const soundTab = makeTabButton('Sound', activeTab === 'sound', () => {
      activeTab = 'sound';
      buildOptionsContent();
    });
    const graphicsTab = makeTabButton('Graphics', activeTab === 'graphics', () => {
      activeTab = 'graphics';
      buildOptionsContent();
    });
    tabBar.appendChild(soundTab);
    tabBar.appendChild(graphicsTab);
    optionsPanel.appendChild(tabBar);

    if (activeTab === 'sound') {
      // Music volume slider
      const musicSlider = makeSlider('Music', state.musicVolume, (v) => {
        state.musicVolume = v;
        setMusicVolume(v);
      });
      optionsPanel.appendChild(musicSlider);

      // SFX volume slider
      const sfxSlider = makeSlider('SFX', state.sfxVolume, (v) => {
        state.sfxVolume = v;
        setSfxVolume(v);
      });
      optionsPanel.appendChild(sfxSlider);
    } else {
      // Graphics quality buttons
      const qualityLabel = document.createElement('div');
      qualityLabel.textContent = 'Quality';
      qualityLabel.style.cssText = `
        font-family: 'Cinzel', serif; color: ${GOLD};
        font-size: 0.95rem; margin-bottom: 12px;
      `;
      optionsPanel.appendChild(qualityLabel);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = `display: flex; justify-content: center;`;

      const lowBtn = makeQualityButton('Low', state.graphicsQuality === 'low', () => {
        state.graphicsQuality = 'low';
        setGraphicsQuality('low');
        buildOptionsContent();
      });
      const medBtn = makeQualityButton('Med', state.graphicsQuality === 'med', () => {
        state.graphicsQuality = 'med';
        setGraphicsQuality('med');
        buildOptionsContent();
      });
      const highBtn = makeQualityButton('High', state.graphicsQuality === 'high', () => {
        state.graphicsQuality = 'high';
        setGraphicsQuality('high');
        buildOptionsContent();
      });
      btnRow.appendChild(lowBtn);
      btnRow.appendChild(medBtn);
      btnRow.appendChild(highBtn);
      optionsPanel.appendChild(btnRow);

      // World View preset buttons
      const worldViewLabel = document.createElement('div');
      worldViewLabel.textContent = 'World View';
      worldViewLabel.style.cssText = `
        font-family: 'Cinzel', serif; color: ${GOLD};
        font-size: 0.95rem; margin: 18px 0 12px 0;
      `;
      optionsPanel.appendChild(worldViewLabel);

      const wvBtnRow = document.createElement('div');
      wvBtnRow.style.cssText = `display: flex; justify-content: center;`;

      for (const preset of WORLD_VIEW_PRESETS) {
        const isActive = state.worldViewPresetId === preset.id;
        const wvBtn = makeQualityButton(preset.label, isActive, () => {
          state.worldViewPresetId = preset.id;
          setWorldViewPresetId(preset.id);
          if (callbacks.onWorldViewChanged) callbacks.onWorldViewChanged();
          buildOptionsContent();
        });
        wvBtn.title = preset.description;
        wvBtnRow.appendChild(wvBtn);
      }
      optionsPanel.appendChild(wvBtnRow);

      // World View description hint
      const activePreset = getActiveWorldViewPreset();
      const wvHint = document.createElement('div');
      wvHint.textContent = activePreset.description;
      wvHint.style.cssText = `
        font-family: 'Cinzel', serif; color: rgba(212,168,75,0.65);
        font-size: 0.72rem; text-align: center; margin-top: 6px;
      `;
      optionsPanel.appendChild(wvHint);

      // Visual effect opacity sliders
      const edgeGlowSlider = makeSlider(
        'Reachable Edge Glow Opacity',
        getReachableEdgeGlowOpacity(),
        (v) => { setReachableEdgeGlowOpacity(v); },
      );
      optionsPanel.appendChild(edgeGlowSlider);

      const influenceWidthSlider = makeSlider(
        'Influence Highlight Width',
        getInfluenceHighlightWidth(),
        (v) => { setInfluenceHighlightWidth(v); },
      );
      optionsPanel.appendChild(influenceWidthSlider);

      const influenceCircleSlider = makeSlider(
        'Influence Circle Opacity',
        getInfluenceCircleOpacity(),
        (v) => { setInfluenceCircleOpacity(v); },
      );
      optionsPanel.appendChild(influenceCircleSlider);
    }

    // Back button
    const backBtn = makeButton('Back', () => {
      optionsPanel.style.display = 'none';
      mainButtons.style.display = 'block';
    });
    backBtn.style.marginTop = '22px';
    optionsPanel.appendChild(backBtn);
  }

  // ── Main button column ────────────────────────────────────────────────────
  const mainButtons = document.createElement('div');

  // Resume (top)
  const resumeBtn = makeButton('Resume', () => {
    destroy();
    callbacks.onResume();
  });
  resumeBtn.style.borderColor = GOLD;
  mainButtons.appendChild(resumeBtn);

  // ── Manual Sprint toggle — prominent control option ───────────────────────
  const manualSprintRow = document.createElement('div');
  manualSprintRow.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    gap: 10px; margin: 4px 0 12px 0;
    padding: 10px 14px;
    background: rgba(212,168,75,0.12);
    border: 1px solid rgba(212,168,75,0.45);
    border-radius: 6px;
  `;
  const manualSprintCheckbox = document.createElement('input');
  manualSprintCheckbox.type = 'checkbox';
  manualSprintCheckbox.id = 'pause-manual-sprint';
  manualSprintCheckbox.checked = state.manualSprintEnabled;
  manualSprintCheckbox.style.cssText = `width: 18px; height: 18px; cursor: pointer; accent-color: ${GOLD};`;
  const manualSprintLabel = document.createElement('label');
  manualSprintLabel.htmlFor = 'pause-manual-sprint';
  manualSprintLabel.textContent = 'Manual Sprint (hold Shift)';
  manualSprintLabel.style.cssText = `
    font-family: 'Cinzel', serif; color: ${GOLD}; font-size: 0.95rem;
    cursor: pointer; letter-spacing: 0.5px;
  `;
  manualSprintCheckbox.addEventListener('change', () => {
    state.manualSprintEnabled = manualSprintCheckbox.checked;
    setManualSprintEnabled(manualSprintCheckbox.checked);
  });
  manualSprintRow.appendChild(manualSprintCheckbox);
  manualSprintRow.appendChild(manualSprintLabel);
  mainButtons.appendChild(manualSprintRow);

  // Options
  const optionsBtn = makeButton('Options', () => {
    mainButtons.style.display = 'none';
    optionsPanel.style.display = 'block';
    buildOptionsContent();
  });
  mainButtons.appendChild(optionsBtn);

  // Debug toggle
  const debugBtn = makeButton(
    state.isDebugOn ? 'Debug Off' : 'Debug On',
    () => {
      callbacks.onToggleDebug();
      debugBtn.textContent = state.isDebugOn ? 'Debug Off' : 'Debug On';
    },
  );
  mainButtons.appendChild(debugBtn);

  // Always Center Camera — inline checkbox below Debug toggle
  const alwaysCenterRow = document.createElement('div');
  alwaysCenterRow.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    gap: 10px; margin: 6px 0 10px 0;
  `;
  const alwaysCenterCheckbox = document.createElement('input');
  alwaysCenterCheckbox.type = 'checkbox';
  alwaysCenterCheckbox.id = 'pause-always-center-camera';
  alwaysCenterCheckbox.checked = state.alwaysCenterCamera;
  alwaysCenterCheckbox.style.cssText = `width: 16px; height: 16px; cursor: pointer; accent-color: ${GOLD};`;
  const alwaysCenterLabel = document.createElement('label');
  alwaysCenterLabel.htmlFor = 'pause-always-center-camera';
  alwaysCenterLabel.textContent = 'Always Center Camera';
  alwaysCenterLabel.style.cssText = `
    font-family: 'Cinzel', serif; color: ${GOLD}; font-size: 0.88rem; cursor: pointer;
  `;
  alwaysCenterCheckbox.addEventListener('change', () => {
    state.alwaysCenterCamera = alwaysCenterCheckbox.checked;
    setAlwaysCenterCamera(alwaysCenterCheckbox.checked);
  });
  alwaysCenterRow.appendChild(alwaysCenterCheckbox);
  alwaysCenterRow.appendChild(alwaysCenterLabel);
  mainButtons.appendChild(alwaysCenterRow);

  // Exit to Main Menu (bottom) — requires a second click for confirmation
  let exitConfirmPending = false;
  let exitConfirmTimerId: ReturnType<typeof setTimeout> | undefined;
  const exitBtn = makeButton('Exit to Main Menu', () => {
    if (!exitConfirmPending) {
      exitConfirmPending = true;
      exitBtn.textContent = 'Confirm Exit?';
      exitBtn.style.color = '#ff6b6b';
      exitBtn.style.borderColor = '#ff6b6b';
      // Auto-cancel confirmation after 3 seconds if the player doesn't confirm
      exitConfirmTimerId = setTimeout(() => {
        // Guard: if the menu was destroyed while we were waiting, do nothing.
        if (exitConfirmTimerId === undefined) return;
        if (exitConfirmPending) {
          exitConfirmPending = false;
          exitConfirmTimerId = undefined;
          exitBtn.textContent = 'Exit to Main Menu';
          exitBtn.style.color = '';
          exitBtn.style.borderColor = '';
        }
      }, 3000);
    } else {
      destroy();
      callbacks.onExitToMainMenu();
    }
  });
  mainButtons.appendChild(exitBtn);

  container.appendChild(mainButtons);
  container.appendChild(optionsPanel);
  overlay.appendChild(container);
  root.appendChild(overlay);

  // ── ESC to close ──────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      destroy();
      callbacks.onResume();
    }
  }
  window.addEventListener('keydown', onKey);

  function destroy(): void {
    window.removeEventListener('keydown', onKey);
    if (exitConfirmTimerId !== undefined) {
      clearTimeout(exitConfirmTimerId);
      exitConfirmTimerId = undefined;
    }
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }

  return destroy;
}
