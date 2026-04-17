/**
 * Keybinding definitions, defaults, and localStorage persistence.
 *
 * Only the primary keyboard key for each action is rebindable here.
 * Several actions also have fixed alternate keys baked into handler.ts
 * (e.g., ArrowLeft always triggers MoveLeft in addition to the bound key).
 *
 * Controller bindings are display-only in this version: the default mapping
 * is stored and shown in the UI, but runtime Gamepad API remapping is not yet
 * wired up. The structure is ready to support it.
 */

// ─── Keyboard actions ────────────────────────────────────────────────────────

export const KB_ACTIONS = [
  'moveLeft',
  'moveRight',
  'moveDown',
  'jump',
  'sprint',
  'interact',
  'toggleFullscreen',
] as const;

export type KeyboardAction = typeof KB_ACTIONS[number];

export interface KeyboardActionMeta {
  label: string;
  /** Fixed alternate keys that always work regardless of binding (cannot be rebound). */
  alwaysAlternates: string[];
}

export const KEYBOARD_ACTION_META: Record<KeyboardAction, KeyboardActionMeta> = {
  moveLeft:         { label: 'Move Left',          alwaysAlternates: ['ArrowLeft'] },
  moveRight:        { label: 'Move Right',         alwaysAlternates: ['ArrowRight'] },
  moveDown:         { label: 'Move Down',          alwaysAlternates: ['ArrowDown'] },
  jump:             { label: 'Jump',               alwaysAlternates: [' ', 'ArrowUp'] },
  sprint:           { label: 'Sprint',             alwaysAlternates: [] },
  interact:         { label: 'Interact',           alwaysAlternates: [] },
  toggleFullscreen: { label: 'Toggle Fullscreen',  alwaysAlternates: [] },
};

export const DEFAULT_KEYBOARD_BINDINGS: Record<KeyboardAction, string> = {
  moveLeft:         'a',
  moveRight:        'd',
  moveDown:         's',
  jump:             'w',
  sprint:           'Shift',
  interact:         'f',
  toggleFullscreen: 'p',
};

// ─── Controller actions ──────────────────────────────────────────────────────

export const CTRL_ACTIONS = [
  'moveHorizontal',
  'jump',
  'sprint',
  'interact',
  'primaryAction',
  'secondaryAction',
  'pause',
] as const;

export type ControllerAction = typeof CTRL_ACTIONS[number];

export const CONTROLLER_ACTION_META: Record<ControllerAction, { label: string }> = {
  moveHorizontal: { label: 'Move'             },
  jump:           { label: 'Jump'             },
  sprint:         { label: 'Sprint / Dash'    },
  interact:       { label: 'Interact'         },
  primaryAction:  { label: 'Attack / Grapple' },
  secondaryAction:{ label: 'Secondary Weave'  },
  pause:          { label: 'Pause'            },
};

export const DEFAULT_CONTROLLER_BINDINGS: Record<ControllerAction, string> = {
  moveHorizontal:  'Left Stick',
  jump:            'A / Cross',
  sprint:          'LB / L1',
  interact:        'B / Circle',
  primaryAction:   'RT / R2',
  secondaryAction: 'LT / L2',
  pause:           'Start / Options',
};

// ─── Storage ─────────────────────────────────────────────────────────────────

const KB_BINDINGS_STORAGE_KEY = 'dustweaver-kb-bindings';

// In-memory cache — initialised lazily on first access.
let _kbBindings: Record<KeyboardAction, string> | null = null;

function loadKbBindings(): Record<KeyboardAction, string> {
  const stored = localStorage.getItem(KB_BINDINGS_STORAGE_KEY);
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as Partial<Record<KeyboardAction, string>>;
      const result = { ...DEFAULT_KEYBOARD_BINDINGS };
      for (let i = 0; i < KB_ACTIONS.length; i++) {
        const action = KB_ACTIONS[i];
        if (typeof parsed[action] === 'string' && (parsed[action] as string).length > 0) {
          result[action] = parsed[action] as string;
        }
      }
      return result;
    } catch {
      // Corrupted storage — fall through to defaults.
    }
  }
  return { ...DEFAULT_KEYBOARD_BINDINGS };
}

function saveKbBindings(bindings: Record<KeyboardAction, string>): void {
  localStorage.setItem(KB_BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
}

export function getKeyboardBindings(): Record<KeyboardAction, string> {
  if (_kbBindings === null) {
    _kbBindings = loadKbBindings();
  }
  return _kbBindings;
}

export function setKeyBinding(action: KeyboardAction, key: string): void {
  const bindings = getKeyboardBindings();
  bindings[action] = key;
  saveKbBindings(bindings);
}

export function resetKeyboardBindings(): void {
  _kbBindings = { ...DEFAULT_KEYBOARD_BINDINGS };
  saveKbBindings(_kbBindings);
}

/**
 * Returns the action whose binding conflicts with `key`, or null if there is
 * no conflict (excluding the action being replaced itself).
 */
export function findKeyConflict(
  key: string,
  excludingAction: KeyboardAction,
): KeyboardAction | null {
  const bindings = getKeyboardBindings();
  const keyLower = key.toLowerCase();
  for (let i = 0; i < KB_ACTIONS.length; i++) {
    const action = KB_ACTIONS[i];
    if (action === excludingAction) continue;
    if (bindings[action].toLowerCase() === keyLower) {
      return action;
    }
  }
  return null;
}

// ─── Key display helpers ─────────────────────────────────────────────────────

const KEY_DISPLAY_MAP: Record<string, string> = {
  ' ':          'Space',
  'ArrowLeft':  '←',
  'ArrowRight': '→',
  'ArrowUp':    '↑',
  'ArrowDown':  '↓',
  'Escape':     'Esc',
  'Enter':      'Enter',
  'Backspace':  'Backspace',
  'Delete':     'Delete',
  'Tab':        'Tab',
  'Shift':      'Shift',
  'Control':    'Ctrl',
  'Alt':        'Alt',
  'Meta':       'Meta',
  'CapsLock':   'Caps',
};

/** Returns a human-readable display label for a KeyboardEvent.key value. */
export function displayKey(key: string): string {
  if (KEY_DISPLAY_MAP[key] !== undefined) {
    return KEY_DISPLAY_MAP[key];
  }
  // Single printable character — show uppercased.
  if (key.length === 1) {
    return key.toUpperCase();
  }
  return key;
}

/** Returns true if the event key matches the stored binding (case-insensitive for letters). */
export function keyMatches(eKey: string, binding: string): boolean {
  return eKey.toLowerCase() === binding.toLowerCase();
}
