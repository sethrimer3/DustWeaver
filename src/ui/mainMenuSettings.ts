/**
 * Settings panel for the main menu.
 *
 * Extracted from mainMenu.ts to keep that module focused on navigation and
 * background animation. This module owns the tabbed settings UI:
 *   - Audio   (music/SFX volume)
 *   - Visual  (quality, resolution, dust outline)
 *   - Gameplay (grapple/influence sliders)
 *   - Keybindings (keyboard rebind, controller reference)
 */

import {
  getRenderSizeOptions,
  getSelectedRenderSize,
  setSelectedRenderSize,
  isOffensiveDustOutlineEnabled,
  setOffensiveDustOutlineEnabled,
  isMomentumTrailEnabled,
  setMomentumTrailEnabled,
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
  getInfluenceHighlightWidth,
  setInfluenceHighlightWidth,
  getDoubleJumpToGrappleEnabled,
  setDoubleJumpToGrappleEnabled,
  getPixelSpeedometerEnabled,
  setPixelSpeedometerEnabled,
  getAdvancedWallJumpsEnabled,
  setAdvancedWallJumpsEnabled,
} from './renderSettings';
import { buildKeybindingsTab } from './mainMenuSettingsKeybindings';
import {
  getSpriteAtlasConfigState,
  getSpriteAtlasUseSetting,
  setSpriteAtlasUseSetting,
} from '../render/atlases/spriteAtlasConfig';

/**
 * Builds the settings panel into `settingsEl` and attaches a back button
 * that calls `onBack`.
 *
 * Call this every time the settings screen is shown (it clears and rebuilds
 * the container so state is always fresh).
 *
 * @param settingsEl  The flex container managed by the caller (shown/hidden externally).
 * @param onBack      Navigation callback invoked when the user presses Back.
 */
export function buildSettingsUI(settingsEl: HTMLDivElement, onBack: () => void): void {
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

  function makeCheckboxRow(
    label: string,
    initialValue: boolean,
    onChangeFn: (enabled: boolean) => void,
    tooltip?: string,
  ): HTMLLabelElement {
    const row = document.createElement('label');
    row.style.cssText = `
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 10px 14px; margin-bottom: 8px;
      font-family: 'Cinzel', serif; font-size: 0.88rem; letter-spacing: 0.05em;
      cursor: pointer; border-radius: 4px;
      border: 1px solid rgba(212,168,75,${initialValue ? '0.7' : '0.3'});
      background: rgba(212,168,75,${initialValue ? '0.12' : '0'});
      color: #d4a84b;
      box-sizing: border-box;
    `;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = initialValue;
    checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer; accent-color: #d4a84b; flex: 0 0 auto;';

    const text = document.createElement('span');
    text.textContent = label;

    checkbox.addEventListener('change', () => {
      const enabled = checkbox.checked;
      onChangeFn(enabled);
      row.style.borderColor = `rgba(212,168,75,${enabled ? '0.7' : '0.3'})`;
      row.style.background = `rgba(212,168,75,${enabled ? '0.12' : '0'})`;
    });

    row.appendChild(checkbox);
    row.appendChild(text);

    if (tooltip !== undefined) {
      const hint = document.createElement('span');
      hint.textContent = '?';
      hint.title = tooltip;
      hint.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        width: 16px; height: 16px; border-radius: 50%; flex: 0 0 auto;
        font-family: 'Cinzel', serif; font-size: 0.7rem; font-weight: 700;
        color: rgba(212,168,75,0.85); border: 1px solid rgba(212,168,75,0.5);
        background: rgba(0,0,0,0.25); cursor: help;
      `;
      row.appendChild(hint);
    }

    return row;
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
      { value: 'med',  label: 'Med'  },
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
    const atlasEnabled = getSpriteAtlasUseSetting();
    const atlasRow = document.createElement('label');
    atlasRow.style.cssText = `
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 10px 14px; margin-bottom: 8px;
      font-family: 'Cinzel', serif; font-size: 0.88rem; letter-spacing: 0.05em;
      cursor: pointer; border-radius: 4px;
      border: 1px solid rgba(212,168,75,${atlasEnabled ? '0.7' : '0.3'});
      background: rgba(212,168,75,${atlasEnabled ? '0.12' : '0'});
      color: #d4a84b;
      box-sizing: border-box;
    `;
    const atlasCheckbox = document.createElement('input');
    atlasCheckbox.type = 'checkbox';
    atlasCheckbox.checked = atlasEnabled;
    atlasCheckbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer; accent-color: #d4a84b; flex: 0 0 auto;';
    const atlasText = document.createElement('span');
    atlasText.textContent = 'Use sprite atlases (experimental)';
    const atlasHint = document.createElement('div');
    atlasHint.style.cssText = `
      margin: -2px 0 10px 28px;
      font-family: 'Cinzel', serif;
      color: rgba(212,168,75,0.55);
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      line-height: 1.35;
    `;
    const updateAtlasHint = (): void => {
      const state = getSpriteAtlasConfigState();
      atlasHint.textContent = state.hardDisableActive
        ? 'Currently hard-disabled internally while legacy room rendering remains active.'
        : 'Reload or re-enter the room after changing this for a clean test.';
    };
    atlasCheckbox.addEventListener('change', () => {
      const enabled = atlasCheckbox.checked;
      setSpriteAtlasUseSetting(enabled);
      atlasRow.style.borderColor = `rgba(212,168,75,${enabled ? '0.7' : '0.3'})`;
      atlasRow.style.background = `rgba(212,168,75,${enabled ? '0.12' : '0'})`;
      updateAtlasHint();
    });
    atlasRow.appendChild(atlasCheckbox);
    atlasRow.appendChild(atlasText);
    tabContent.appendChild(atlasRow);
    updateAtlasHint();
    tabContent.appendChild(atlasHint);

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

    const trailEnabled = isMomentumTrailEnabled();
    const trailBtn = document.createElement('button');
    trailBtn.style.cssText = `
      width: 100%; padding: 10px 14px; margin-bottom: 10px;
      font-family: 'Cinzel', serif; font-size: 0.88rem; letter-spacing: 0.05em;
      text-align: left; cursor: pointer; border-radius: 4px;
      transition: background 0.15s, border-color 0.15s;
      border: 1px solid rgba(212,168,75,${trailEnabled ? '0.7' : '0.3'});
      background: rgba(212,168,75,${trailEnabled ? '0.12' : '0'});
      color: #d4a84b;
    `;
    trailBtn.textContent = `Momentum Combat Golden Trail: ${trailEnabled ? 'On' : 'Off'}`;
    trailBtn.addEventListener('click', () => {
      const nowEnabled = !isMomentumTrailEnabled();
      setMomentumTrailEnabled(nowEnabled);
      trailBtn.textContent = `Momentum Combat Golden Trail: ${nowEnabled ? 'On' : 'Off'}`;
      trailBtn.style.borderColor = `rgba(212,168,75,${nowEnabled ? '0.7' : '0.3'})`;
      trailBtn.style.background = `rgba(212,168,75,${nowEnabled ? '0.12' : '0'})`;
    });
    tabContent.appendChild(trailBtn);
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

    tabContent.appendChild(makeLabel('Influence Highlight Width'));
    tabContent.appendChild(
      makeSettingsSlider('Highlight Width', getInfluenceHighlightWidth(), (v) => {
        setInfluenceHighlightWidth(v);
      }),
    );

    tabContent.appendChild(makeLabel('Influence Circle Opacity'));
    tabContent.appendChild(
      makeSettingsSlider('Circle Opacity', getInfluenceCircleOpacity(), (v) => {
        setInfluenceCircleOpacity(v);
      }),
    );

    tabContent.appendChild(makeLabel('Controls'));
    tabContent.appendChild(
      makeCheckboxRow('Double-jump to grapple', getDoubleJumpToGrappleEnabled(), (enabled) => {
        setDoubleJumpToGrappleEnabled(enabled);
      }),
    );
    tabContent.appendChild(
      makeCheckboxRow('Pixel speedometer', getPixelSpeedometerEnabled(), (enabled) => {
        setPixelSpeedometerEnabled(enabled);
      }),
    );
    tabContent.appendChild(
      makeCheckboxRow('Advanced Wall Jumps', getAdvancedWallJumpsEnabled(), (enabled) => {
        setAdvancedWallJumpsEnabled(enabled);
      }, 'When off (default), pressing jump next to a wall always wall-jumps, even with no directional input held. When on, a wall jump requires deliberate intent: wall-sliding, pressing away from the wall, or having been falling in the air for a moment.'),
    );
  }

  // ── Route to active tab ────────────────────────────────────────────────

  function buildTabContent(): void {
    if (activeSettingsTab === 'audio')       buildAudioTab();
    else if (activeSettingsTab === 'visual') buildVisualTab();
    else if (activeSettingsTab === 'gameplay') buildGameplayTab();
    else                                     buildKeybindingsTab(tabContent);
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
  backBtn.addEventListener('click', onBack);
  settingsEl.appendChild(backBtn);
}
