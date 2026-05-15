/**
 * mainMenuSettingsKeybindings.ts — Keybindings settings tab.
 *
 * Owns the keyboard/controller binding sub-tab UI, including the live-rebind
 * flow with conflict detection. Extracted from mainMenuSettings.ts (BUILD 312).
 *
 * Usage:
 *   buildKeybindingsTab(tabContentEl);
 */

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
  type KeyboardAction,
} from '../input/keybindings';

/**
 * Builds the keybindings tab content into `tabContentEl`.
 * Clears `tabContentEl.innerHTML` before building.
 */
export function buildKeybindingsTab(tabContent: HTMLDivElement): void {
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
