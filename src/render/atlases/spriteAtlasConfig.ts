const LOCAL_STORAGE_KEY = 'dw.useSpriteAtlases';
const DISABLE_LOCAL_STORAGE_KEY = 'dw.disableSpriteAtlases';

declare global {
  interface Window {
    __DW_USE_SPRITE_ATLASES?: boolean;
  }
}

export const USE_SPRITE_ATLASES = false;
export const FORCE_DISABLE_SPRITE_ATLASES = true;
export const SPRITE_ATLAS_LOCAL_STORAGE_KEY = LOCAL_STORAGE_KEY;
export const DISABLE_SPRITE_ATLAS_LOCAL_STORAGE_KEY = DISABLE_LOCAL_STORAGE_KEY;

export function isSpriteAtlasHardDisabled(): boolean {
  return FORCE_DISABLE_SPRITE_ATLASES;
}

export function getSpriteAtlasUseSetting(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(LOCAL_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function _dispatchAtlasModeChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('dw:sprite-atlas-mode-changed', {
    detail: getSpriteAtlasConfigState(),
  }));
}

export function setSpriteAtlasUseSetting(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.__DW_USE_SPRITE_ATLASES = enabled;
  try {
    window.localStorage?.setItem(LOCAL_STORAGE_KEY, enabled ? 'true' : 'false');
    window.localStorage?.setItem(DISABLE_LOCAL_STORAGE_KEY, enabled ? '0' : '1');
  } catch {
    // The in-memory override still updates the effective state for this page.
  }
  _dispatchAtlasModeChanged();
}

export function isSpriteAtlasUsageDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(DISABLE_LOCAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSpriteAtlasUsageDisabled(disabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(DISABLE_LOCAL_STORAGE_KEY, disabled ? '1' : '0');
    if (disabled) {
      window.__DW_USE_SPRITE_ATLASES = false;
      window.localStorage?.setItem(LOCAL_STORAGE_KEY, 'false');
    }
  } catch {
    window.__DW_USE_SPRITE_ATLASES = false;
  }
  _dispatchAtlasModeChanged();
}

export function isSpriteAtlasEnabled(): boolean {
  if (FORCE_DISABLE_SPRITE_ATLASES) return false;
  if (!import.meta.env.DEV) return USE_SPRITE_ATLASES;
  if (typeof window === 'undefined') return USE_SPRITE_ATLASES;
  if (isSpriteAtlasUsageDisabled()) return false;
  if (typeof window.__DW_USE_SPRITE_ATLASES === 'boolean') {
    return window.__DW_USE_SPRITE_ATLASES;
  }
  try {
    const stored = window.localStorage?.getItem(LOCAL_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Ignore storage access failures; the safe default remains disabled.
  }
  return USE_SPRITE_ATLASES;
}

export interface SpriteAtlasConfigState {
  readonly enabled: boolean;
  readonly defaultEnabled: boolean;
  readonly hardDisableActive: boolean;
  readonly localStorageKey: string;
  readonly localStorageValue: string | null;
  readonly disableLocalStorageKey: string;
  readonly disableLocalStorageValue: string | null;
  readonly usageDisabled: boolean;
  readonly overrideValue: boolean | null;
  readonly storageAvailable: boolean;
  readonly reloadRequired: boolean;
  readonly message: string;
}

export function getSpriteAtlasConfigState(): SpriteAtlasConfigState {
  let localStorageValue: string | null = null;
  let disableLocalStorageValue: string | null = null;
  let storageAvailable = false;
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    try {
      localStorageValue = window.localStorage?.getItem(LOCAL_STORAGE_KEY) ?? null;
      disableLocalStorageValue = window.localStorage?.getItem(DISABLE_LOCAL_STORAGE_KEY) ?? null;
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
  }
  const overrideValue = import.meta.env.DEV
    && typeof window !== 'undefined'
    && typeof window.__DW_USE_SPRITE_ATLASES === 'boolean'
    ? window.__DW_USE_SPRITE_ATLASES
    : null;
  return {
    enabled: isSpriteAtlasEnabled(),
    defaultEnabled: USE_SPRITE_ATLASES,
    hardDisableActive: FORCE_DISABLE_SPRITE_ATLASES,
    localStorageKey: LOCAL_STORAGE_KEY,
    localStorageValue,
    disableLocalStorageKey: DISABLE_LOCAL_STORAGE_KEY,
    disableLocalStorageValue,
    usageDisabled: isSpriteAtlasUsageDisabled(),
    overrideValue,
    storageAvailable,
    reloadRequired: true,
    message: FORCE_DISABLE_SPRITE_ATLASES
      ? 'Sprite atlas rendering is hard-disabled internally while the legacy render path is being restored.'
      : 'Sprite atlas mode is read by render/preload paths during room setup; reload or re-enter the room after changing it for a clean benchmark.',
  };
}

export function setSpriteAtlasEnabledForDev(enabled: boolean): SpriteAtlasConfigState {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return getSpriteAtlasConfigState();
  }
  window.__DW_USE_SPRITE_ATLASES = enabled;
  try {
    if (enabled) {
      window.localStorage?.setItem(DISABLE_LOCAL_STORAGE_KEY, '0');
    }
    window.localStorage?.setItem(LOCAL_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // The in-memory override still lets the current DEV page report the requested state.
  }
  _dispatchAtlasModeChanged();
  return getSpriteAtlasConfigState();
}
