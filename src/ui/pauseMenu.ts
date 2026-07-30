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
  getRenderAdjacentRooms,
  setRenderAdjacentRooms,
  getPixelSpeedometerEnabled,
  setPixelSpeedometerEnabled,
  getPixelSpeedometerPlacement,
  setPixelSpeedometerPlacement,
  getPixelSpeedometerTotalEnabled, setPixelSpeedometerTotalEnabled,
  getPixelSpeedometerHorizontalEnabled, setPixelSpeedometerHorizontalEnabled,
  getPixelSpeedometerVerticalEnabled, setPixelSpeedometerVerticalEnabled,
  getPixelSpeedGraphEnabled, setPixelSpeedGraphEnabled,
  getPixelSpeedGraphOpacity, setPixelSpeedGraphOpacity,
  getSpeedrunTimerEnabled, setSpeedrunTimerEnabled,
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
import { debugPanelVisibility, setDebugPanelVisible } from './debugPanelManager';
import { createSlideReveal } from './slideReveal';
import {
  getSpriteAtlasConfigState,
  getSpriteAtlasUseSetting,
  setSpriteAtlasUseSetting,
} from '../render/atlases/spriteAtlasConfig';
import { setCombatMode, type CombatMode } from '../sim/combatMode';
import { makeButton, makeSlider, makeTabButton, makeCheckboxRow, GOLD, PANEL_BORDER } from './helpers';
import { applyLocalePresentation, createLocaleBindings, getUiFontFamily, t } from '../i18n';
import { buildKeybindingsTab } from './mainMenuSettingsKeybindings';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PauseMenuCallbacks {
  onResume: () => void;
  onExitToMainMenu: () => void;
  onToggleDebug: () => void;
  /** Called when the player clicks "World Editor" to enter the editor directly without changing debug mode. */
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
    font-family: ${getUiFontFamily()};
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
  const i18n = createLocaleBindings();

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
  i18n.bindText(title, 'pause.title');
  title.style.cssText = `
    font-family: ${getUiFontFamily()}; color: ${GOLD}; font-size: 1.6rem;
    margin: 0 0 28px 0; letter-spacing: 3px;
    text-shadow: 0 0 12px rgba(212,168,75,0.4);
  `;
  container.appendChild(title);

  // ── Options sub-panel (hidden by default) ─────────────────────────────────
  const optionsPanel = document.createElement('div');
  optionsPanel.style.cssText = `display: none; text-align: left;`;

  let activeTab: 'sound' | 'graphics' | 'gameplay' | 'keybindings' = 'sound';
  let keybindingsCleanup: (() => void) | null = null;

  function buildOptionsContent(): void {
    keybindingsCleanup?.();
    keybindingsCleanup = null;
    optionsPanel.innerHTML = '';

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.style.cssText = `display: flex; margin-bottom: 16px; border-bottom: 1px solid ${PANEL_BORDER};`;

    const soundTab = makeTabButton(t('pause.tab.sound'), activeTab === 'sound', () => {
      activeTab = 'sound';
      buildOptionsContent();
    });
    const graphicsTab = makeTabButton(t('pause.tab.graphics'), activeTab === 'graphics', () => {
      activeTab = 'graphics';
      buildOptionsContent();
    });
    const gameplayTab = makeTabButton(t('pause.tab.gameplay'), activeTab === 'gameplay', () => {
      activeTab = 'gameplay';
      buildOptionsContent();
    });
    const keybindingsTab = makeTabButton(t('settings.tab.keybindings'), activeTab === 'keybindings', () => {
      activeTab = 'keybindings';
      buildOptionsContent();
    });
    tabBar.appendChild(soundTab);
    tabBar.appendChild(graphicsTab);
    tabBar.appendChild(gameplayTab);
    tabBar.appendChild(keybindingsTab);
    optionsPanel.appendChild(tabBar);

    if (activeTab === 'sound') {
      // Music volume slider
      const musicSlider = makeSlider(t('pause.sound.music'), state.musicVolume, (v) => {
        state.musicVolume = v;
        setMusicVolume(v);
      });
      optionsPanel.appendChild(musicSlider);

      // SFX volume slider
      const sfxSlider = makeSlider(t('pause.sound.sfx'), state.sfxVolume, (v) => {
        state.sfxVolume = v;
        setSfxVolume(v);
      });
      optionsPanel.appendChild(sfxSlider);
    } else if (activeTab === 'gameplay') {
      optionsPanel.appendChild(
        makeCheckboxRow(t('pause.gameplay.momentumCombat'), state.combatMode === 'momentum', (enabled) => {
          const mode: CombatMode = enabled ? 'momentum' : 'legacy';
          state.combatMode = mode;
          setCombatMode(mode);
          saveCombatModeToStorage(mode);
        }),
      );
      optionsPanel.appendChild(
        makeCheckboxRow(t('settings.gameplay.doubleJumpToGrapple'), getDoubleJumpToGrappleEnabled(), (enabled) => {
          setDoubleJumpToGrappleEnabled(enabled);
        }),
      );
      optionsPanel.appendChild(
        makeCheckboxRow(
          t('settings.gameplay.advancedWallJumps'),
          getAdvancedWallJumpsEnabled(),
          (enabled) => { setAdvancedWallJumpsEnabled(enabled); },
          t('settings.gameplay.advancedWallJumpsTooltip'),
        ),
      );
      if (state.isDebugOn) {
        optionsPanel.appendChild(
          makeCheckboxRow(
            t('pause.gameplay.airCurrentsDebug'),
            getAirCurrentsDebugEnabled(),
            (enabled) => { setAirCurrentsDebugEnabled(enabled); },
            t('pause.gameplay.airCurrentsDebugTooltip'),
          ),
        );
        optionsPanel.appendChild(
          makeCheckboxRow(
            t('pause.gameplay.prewarmPanelDebug'),
            debugPanelVisibility.prewarm,
            (enabled) => { setDebugPanelVisible('prewarm', enabled); },
            t('pause.gameplay.prewarmPanelDebugTooltip'),
          ),
        );
      }
    } else if (activeTab === 'graphics') {
      // Graphics quality buttons
      const qualityLabel = document.createElement('div');
      qualityLabel.textContent = t('settings.visual.quality');
      qualityLabel.style.cssText = `
        font-family: ${getUiFontFamily()}; color: ${GOLD};
        font-size: 0.95rem; margin-bottom: 12px;
      `;
      optionsPanel.appendChild(qualityLabel);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = `display: flex; justify-content: center;`;

      const lowBtn = makeQualityButton(t('settings.visual.qualityLow'), state.graphicsQuality === 'low', () => {
        state.graphicsQuality = 'low';
        setGraphicsQuality('low');
        buildOptionsContent();
      });
      const medBtn = makeQualityButton(t('settings.visual.qualityMed'), state.graphicsQuality === 'med', () => {
        state.graphicsQuality = 'med';
        setGraphicsQuality('med');
        buildOptionsContent();
      });
      const highBtn = makeQualityButton(t('settings.visual.qualityHigh'), state.graphicsQuality === 'high', () => {
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
      worldViewLabel.textContent = t('pause.graphics.worldView');
      worldViewLabel.style.cssText = `
        font-family: ${getUiFontFamily()}; color: ${GOLD};
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
        font-family: ${getUiFontFamily()}; color: rgba(212,168,75,0.65);
        font-size: 0.72rem; text-align: center; margin-top: 6px;
      `;
      optionsPanel.appendChild(wvHint);

      // "Camera Always Centered" parent option, with a child "Render Adjacent
      // Rooms" checkbox that smoothly reveals/hides beneath it.  The child is
      // stored independently (see renderSettings) so its checked state survives
      // the parent being toggled; its effective runtime state is gated by the
      // parent (parent && child) — see getEffectiveRenderAdjacentRooms().
      const adjacentReveal = createSlideReveal(state.alwaysCenterCamera);
      adjacentReveal.content.appendChild(
        makeCheckboxRow(t('pause.graphics.renderAdjacentRooms'), getRenderAdjacentRooms(), (enabled) => {
          setRenderAdjacentRooms(enabled);
        }),
      );
      optionsPanel.appendChild(
        makeCheckboxRow(t('pause.graphics.cameraAlwaysCentered'), state.alwaysCenterCamera, (enabled) => {
          state.alwaysCenterCamera = enabled;
          setAlwaysCenterCamera(enabled);
          // Reveal/hide the child without altering its stored checked state.
          adjacentReveal.setExpanded(enabled);
        }),
      );
      optionsPanel.appendChild(adjacentReveal.element);

      // Sprite atlases remain experimental and opt-in.
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
      atlasLabel.textContent = t('settings.visual.spriteAtlases');
      atlasLabel.style.cssText = `
        font-family: ${getUiFontFamily()}; color: ${GOLD}; font-size: 0.88rem;
        cursor: pointer; letter-spacing: 0.4px;
      `;
      const atlasHint = document.createElement('div');
      atlasHint.textContent = getSpriteAtlasConfigState().hardDisableActive
        ? t('pause.graphics.spriteAtlasesHardDisabled')
        : t('pause.graphics.spriteAtlasesHint');
      atlasHint.style.cssText = `
        font-family: ${getUiFontFamily()}; color: rgba(212,168,75,0.65);
        font-size: 0.72rem; text-align: center; margin: -2px 0 10px 0;
      `;
      atlasCheckbox.addEventListener('change', () => {
        const enabled = atlasCheckbox.checked;
        setSpriteAtlasUseSetting(enabled);
        atlasRow.style.borderColor = `rgba(212,168,75,${enabled ? '0.55' : '0.25'})`;
        atlasRow.style.background = `rgba(212,168,75,${enabled ? '0.12' : '0.04'})`;
        atlasHint.textContent = getSpriteAtlasConfigState().hardDisableActive
          ? t('pause.graphics.spriteAtlasesHardDisabled')
          : t('pause.graphics.spriteAtlasesHint');
      });
      atlasRow.appendChild(atlasCheckbox);
      atlasRow.appendChild(atlasLabel);
      optionsPanel.appendChild(atlasRow);
      optionsPanel.appendChild(atlasHint);

      // Visual effect opacity sliders
      const edgeGlowSlider = makeSlider(
        t('pause.graphics.reachableEdgeGlowOpacity'),
        getReachableEdgeGlowOpacity(),
        (v) => { setReachableEdgeGlowOpacity(v); },
      );
      optionsPanel.appendChild(edgeGlowSlider);

      const influenceWidthSlider = makeSlider(
        t('settings.gameplay.influenceHighlightWidth'),
        getInfluenceHighlightWidth(),
        (v) => { setInfluenceHighlightWidth(v); },
      );
      optionsPanel.appendChild(influenceWidthSlider);

      const influenceCircleSlider = makeSlider(
        t('settings.gameplay.influenceCircleOpacity'),
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
      speedometerLabel.textContent = t('settings.gameplay.pixelSpeedometer');
      speedometerLabel.style.cssText = `
        font-family: ${getUiFontFamily()}; color: ${GOLD}; font-size: 0.88rem;
        cursor: pointer; letter-spacing: 0.4px;
      `;
      speedometerCheckbox.addEventListener('change', () => {
        const enabled = speedometerCheckbox.checked;
        setPixelSpeedometerEnabled(enabled);
        speedometerOptions.setExpanded(enabled);
      });
      speedometerRow.appendChild(speedometerCheckbox);
      speedometerRow.appendChild(speedometerLabel);
      optionsPanel.appendChild(speedometerRow);
      const speedometerOptions = createSlideReveal(speedometerEnabled);
      speedometerOptions.content.appendChild(makeCheckboxRow(t('settings.gameplay.totalSpeed'), getPixelSpeedometerTotalEnabled(), setPixelSpeedometerTotalEnabled));
      speedometerOptions.content.appendChild(makeCheckboxRow(t('settings.gameplay.horizontalSpeed'), getPixelSpeedometerHorizontalEnabled(), setPixelSpeedometerHorizontalEnabled));
      speedometerOptions.content.appendChild(makeCheckboxRow(t('settings.gameplay.verticalSpeed'), getPixelSpeedometerVerticalEnabled(), setPixelSpeedometerVerticalEnabled));
      const speedGraphEnabled = getPixelSpeedGraphEnabled();
      const speedGraphOptions = createSlideReveal(speedGraphEnabled);
      speedometerOptions.content.appendChild(makeCheckboxRow(t('settings.gameplay.speedGraph'), speedGraphEnabled, (enabled) => {
          setPixelSpeedGraphEnabled(enabled);
          speedGraphOptions.setExpanded(enabled);
        }));
      speedGraphOptions.content.appendChild(makeSlider(t('settings.gameplay.speedGraphOpacity'), getPixelSpeedGraphOpacity(), setPixelSpeedGraphOpacity));
      speedometerOptions.content.appendChild(speedGraphOptions.element);
      const placementSelect = document.createElement('select');
      placementSelect.style.cssText = `
          display: block; width: 100%; margin: 0 0 8px 0; padding: 8px 10px;
          color: ${GOLD}; background: rgba(30,28,22,0.9); border: 1px solid ${PANEL_BORDER};
          border-radius: 4px; font-family: ${getUiFontFamily()}; cursor: pointer;
        `;
      const placementOptions: readonly [ 'over-player' | 'on-top' | 'both', string ][] = [
          ['over-player', t('settings.gameplay.speedometerOnPlayer')],
          ['on-top', t('settings.gameplay.speedometerOnTop')],
          ['both', t('settings.gameplay.speedometerBoth')],
        ];
      for (const [value, label] of placementOptions) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          option.selected = getPixelSpeedometerPlacement() === value;
          placementSelect.appendChild(option);
        }
      placementSelect.addEventListener('change', () => {
          setPixelSpeedometerPlacement(placementSelect.value as 'over-player' | 'on-top' | 'both');
        });
      speedometerOptions.content.appendChild(placementSelect);
      optionsPanel.appendChild(speedometerOptions.element);
      optionsPanel.appendChild(makeCheckboxRow(t('settings.gameplay.speedrunTimer'), getSpeedrunTimerEnabled(), setSpeedrunTimerEnabled));
    } else {
      const keybindingsContent = document.createElement('div');
      optionsPanel.appendChild(keybindingsContent);
      keybindingsCleanup = buildKeybindingsTab(keybindingsContent);
    }

    // Back button
    const backBtn = makeButton(t('common.back'), () => {
      optionsPanel.style.display = 'none';
      mainButtons.style.display = 'block';
    });
    backBtn.style.marginTop = '22px';
    optionsPanel.appendChild(backBtn);
  }

  // ── Main button column ────────────────────────────────────────────────────
  const mainButtons = document.createElement('div');

  // Resume (top)
  const resumeBtn = makeButton(t('pause.resume'), () => {
    destroy();
    callbacks.onResume();
  });
  resumeBtn.style.borderColor = GOLD;
  mainButtons.appendChild(resumeBtn);


  // Options
  const optionsBtn = makeButton(t('pause.options'), () => {
    mainButtons.style.display = 'none';
    optionsPanel.style.display = 'block';
    buildOptionsContent();
  });
  mainButtons.appendChild(optionsBtn);

  // Debug toggle
  const debugLabel = (): string => t(state.isDebugOn ? 'pause.debugOff' : 'pause.debugOn');
  const debugBtn = makeButton(
    debugLabel(),
    () => {
      callbacks.onToggleDebug();
      debugBtn.textContent = debugLabel();
    },
  );
  mainButtons.appendChild(debugBtn);

  // World Editor — jumps straight into the editor without requiring Debug mode
  const worldEditorBtn = makeButton(t('pause.worldEditor'), () => {
    destroy();
    callbacks.onOpenWorldEditor();
  });
  mainButtons.appendChild(worldEditorBtn);


  // Exit to Main Menu (bottom) — requires a second click for confirmation
  let exitConfirmPending = false;
  let exitConfirmTimerId: ReturnType<typeof setTimeout> | undefined;
  const exitBtn = makeButton(t('pause.exitToMainMenu'), () => {
    if (!exitConfirmPending) {
      exitConfirmPending = true;
      exitBtn.textContent = t('pause.confirmExit');
      exitBtn.style.color = '#ff6b6b';
      exitBtn.style.borderColor = '#ff6b6b';
      // Auto-cancel confirmation after 3 seconds if the player doesn't confirm
      exitConfirmTimerId = setTimeout(() => {
        // Guard: if the menu was destroyed while we were waiting, do nothing.
        if (exitConfirmTimerId === undefined) return;
        if (exitConfirmPending) {
          exitConfirmPending = false;
          exitConfirmTimerId = undefined;
          exitBtn.textContent = t('pause.exitToMainMenu');
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

  // ── Live language switching ───────────────────────────────────────────────
  // Re-labels the persistent buttons and rebuilds the options sub-panel when it
  // is open. Focus/ESC handling is untouched.
  i18n.onLocaleChange(() => {
    applyLocalePresentation(container);
    resumeBtn.textContent = t('pause.resume');
    optionsBtn.textContent = t('pause.options');
    debugBtn.textContent = debugLabel();
    worldEditorBtn.textContent = t('pause.worldEditor');
    if (!exitConfirmPending) exitBtn.textContent = t('pause.exitToMainMenu');
    if (optionsPanel.style.display !== 'none') buildOptionsContent();
  });

  // ── ESC to close ──────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      destroy();
      callbacks.onResume();
    }
  }
  window.addEventListener('keydown', onKey);
  function onGamepadPause(event: Event): void {
    event.preventDefault();
    destroy();
    callbacks.onResume();
  }
  window.addEventListener('dustweaver-gamepad-pause', onGamepadPause);

  function destroy(): void {
    i18n.dispose();
    keybindingsCleanup?.();
    keybindingsCleanup = null;
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('dustweaver-gamepad-pause', onGamepadPause);
    if (exitConfirmTimerId !== undefined) {
      clearTimeout(exitConfirmTimerId);
      exitConfirmTimerId = undefined;
    }
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }

  return destroy;
}
