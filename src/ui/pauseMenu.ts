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
  getPixelSpeedometerEnabled,
  setPixelSpeedometerEnabled,
  getPixelSpeedometerPlacement,
  setPixelSpeedometerPlacement,
  saveCombatModeToStorage,
  WORLD_VIEW_PRESETS, setWorldViewPresetId, getActiveWorldViewPreset,
  type WorldViewPresetId,
  getDoubleJumpToGrappleEnabled,
  setDoubleJumpToGrappleEnabled,
  getAdvancedWallJumpsEnabled,
  setAdvancedWallJumpsEnabled,
  getAirCurrentsDebugEnabled,
  setAirCurrentsDebugEnabled,
} from './renderSettings';
import { setCombatMode, type CombatMode } from '../sim/combatMode';
import { makeButton, makeSlider, makeTabButton, makeCheckboxRow, GOLD, PANEL_BORDER } from './helpers';
import {
  getSpriteAtlasConfigState,
  getSpriteAtlasUseSetting,
  setSpriteAtlasUseSetting,
} from '../render/atlases/spriteAtlasConfig';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PauseMenuCallbacks {
  onResume: () => void;
  onExitToMainMenu: () => void;
  onToggleDebug: () => void;
  /** Called when the player clicks "World Editor" — should enable debug mode (if needed) and enter the editor directly. */
  onOpenWorldEditor: () => void;
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
  /** Current combat mode: 'momentum' (default) or 'legacy'. */
  combatMode: CombatMode;
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
    max-height: 90vh;
    overflow-y: auto;
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

  let activeTab: 'sound' | 'graphics' | 'gameplay' = 'sound';

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
    const gameplayTab = makeTabButton('Gameplay', activeTab === 'gameplay', () => {
      activeTab = 'gameplay';
      buildOptionsContent();
    });
    tabBar.appendChild(soundTab);
    tabBar.appendChild(graphicsTab);
    tabBar.appendChild(gameplayTab);
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
    } else if (activeTab === 'gameplay') {
      optionsPanel.appendChild(
        makeCheckboxRow('Momentum Combat', state.combatMode === 'momentum', (enabled) => {
          const mode: CombatMode = enabled ? 'momentum' : 'legacy';
          state.combatMode = mode;
          setCombatMode(mode);
          saveCombatModeToStorage(mode);
        }),
      );
      optionsPanel.appendChild(
        makeCheckboxRow('Double-jump to grapple', getDoubleJumpToGrappleEnabled(), (enabled) => {
          setDoubleJumpToGrappleEnabled(enabled);
        }),
      );
      optionsPanel.appendChild(
        makeCheckboxRow(
          'Advanced Wall Jumps',
          getAdvancedWallJumpsEnabled(),
          (enabled) => { setAdvancedWallJumpsEnabled(enabled); },
          'When off (default), pressing jump next to a wall always wall-jumps, even with no directional input held. When on, a wall jump requires deliberate intent: wall-sliding, pressing away from the wall, or having been falling in the air for a moment.',
        ),
      );
      if (state.isDebugOn) {
        optionsPanel.appendChild(
          makeCheckboxRow(
            'Air Currents (debug)',
            getAirCurrentsDebugEnabled(),
            (enabled) => { setAirCurrentsDebugEnabled(enabled); },
            'Draws arrows over the room showing the live wind field created by player and enemy movement. Only visible while Debug mode is on.',
          ),
        );
      }
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

      optionsPanel.appendChild(
        makeCheckboxRow('Always Center Camera', state.alwaysCenterCamera, (enabled) => {
          state.alwaysCenterCamera = enabled;
          setAlwaysCenterCamera(enabled);
        }),
      );

      const atlasEnabled = getSpriteAtlasUseSetting();
      const atlasRow = document.createElement('label');
      atlasRow.style.cssText = `
        display: flex; align-items: center; justify-content: center;
        gap: 10px; margin: 16px 0 8px 0;
        padding: 10px 14px;
        background: rgba(212,168,75,${atlasEnabled ? '0.12' : '0.04'});
        border: 1px solid rgba(212,168,75,${atlasEnabled ? '0.55' : '0.25'});
        border-radius: 6px;
        cursor: pointer;
      `;
      const atlasCheckbox = document.createElement('input');
      atlasCheckbox.type = 'checkbox';
      atlasCheckbox.checked = atlasEnabled;
      atlasCheckbox.style.cssText = `width: 18px; height: 18px; cursor: pointer; accent-color: ${GOLD};`;
      const atlasLabel = document.createElement('span');
      atlasLabel.textContent = 'Use sprite atlases (experimental)';
      atlasLabel.style.cssText = `
        font-family: 'Cinzel', serif; color: ${GOLD}; font-size: 0.88rem;
        cursor: pointer; letter-spacing: 0.4px;
      `;
      const atlasHint = document.createElement('div');
      atlasHint.textContent = getSpriteAtlasConfigState().hardDisableActive
        ? 'Hard-disabled internally while legacy rendering remains active.'
        : 'Reload or re-enter the room after changing this.';
      atlasHint.style.cssText = `
        font-family: 'Cinzel', serif; color: rgba(212,168,75,0.65);
        font-size: 0.72rem; text-align: center; margin: -2px 0 10px 0;
      `;
      atlasCheckbox.addEventListener('change', () => {
        const enabled = atlasCheckbox.checked;
        setSpriteAtlasUseSetting(enabled);
        atlasRow.style.borderColor = `rgba(212,168,75,${enabled ? '0.55' : '0.25'})`;
        atlasRow.style.background = `rgba(212,168,75,${enabled ? '0.12' : '0.04'})`;
        atlasHint.textContent = getSpriteAtlasConfigState().hardDisableActive
          ? 'Hard-disabled internally while legacy rendering remains active.'
          : 'Reload or re-enter the room after changing this.';
      });
      atlasRow.appendChild(atlasCheckbox);
      atlasRow.appendChild(atlasLabel);
      optionsPanel.appendChild(atlasRow);
      optionsPanel.appendChild(atlasHint);

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

      const speedometerEnabled = getPixelSpeedometerEnabled();
      const speedometerRow = document.createElement('label');
      speedometerRow.style.cssText = `
        display: flex; align-items: center; justify-content: center;
        gap: 10px; margin: 16px 0 8px 0;
        padding: 10px 14px;
        background: rgba(212,168,75,${speedometerEnabled ? '0.12' : '0.04'});
        border: 1px solid rgba(212,168,75,${speedometerEnabled ? '0.55' : '0.25'});
        border-radius: 6px;
        cursor: pointer;
      `;
      const speedometerCheckbox = document.createElement('input');
      speedometerCheckbox.type = 'checkbox';
      speedometerCheckbox.checked = speedometerEnabled;
      speedometerCheckbox.style.cssText = `width: 18px; height: 18px; cursor: pointer; accent-color: ${GOLD};`;
      const speedometerLabel = document.createElement('span');
      speedometerLabel.textContent = 'Pixel speedometer';
      speedometerLabel.style.cssText = `
        font-family: 'Cinzel', serif; color: ${GOLD}; font-size: 0.88rem;
        cursor: pointer; letter-spacing: 0.4px;
      `;
      speedometerCheckbox.addEventListener('change', () => {
        const enabled = speedometerCheckbox.checked;
        setPixelSpeedometerEnabled(enabled);
        buildOptionsContent();
      });
      speedometerRow.appendChild(speedometerCheckbox);
      speedometerRow.appendChild(speedometerLabel);
      optionsPanel.appendChild(speedometerRow);
      if (speedometerEnabled) {
        const placementSelect = document.createElement('select');
        placementSelect.style.cssText = `
          display: block; width: 100%; margin: 0 0 8px 0; padding: 8px 10px;
          color: ${GOLD}; background: rgba(30,28,22,0.9); border: 1px solid ${PANEL_BORDER};
          border-radius: 4px; font-family: 'Cinzel', serif; cursor: pointer;
        `;
        for (const [value, label] of [['over-player', 'Over Player'], ['on-top', 'On top'], ['both', 'Both']] as const) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          option.selected = getPixelSpeedometerPlacement() === value;
          placementSelect.appendChild(option);
        }
        placementSelect.addEventListener('change', () => {
          setPixelSpeedometerPlacement(placementSelect.value as 'over-player' | 'on-top' | 'both');
        });
        optionsPanel.appendChild(placementSelect);
      }
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

  // World Editor — jumps straight into the editor without requiring Debug mode
  const worldEditorBtn = makeButton('World Editor', () => {
    destroy();
    callbacks.onOpenWorldEditor();
  });
  mainButtons.appendChild(worldEditorBtn);


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
