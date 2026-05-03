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
  backBtn.addEventListener('click', onBack);
  settingsEl.appendChild(backBtn);
}
