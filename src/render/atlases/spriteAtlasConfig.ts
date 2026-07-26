const LOCAL_STORAGE_KEY = 'dw.useSpriteAtlases';

declare global {
  interface Window {
    __DW_USE_SPRITE_ATLASES?: boolean;
    __dwSetSpriteAtlasesEnabled?: (enabled: boolean) => SpriteAtlasConfigState;
    __dwSpriteAtlasDebug?: () => SpriteAtlasConfigState;
  }
}

export const USE_SPRITE_ATLASES = false;
export const FORCE_DISABLE_SPRITE_ATLASES = true;
export const SPRITE_ATLAS_LOCAL_STORAGE_KEY = LOCAL_STORAGE_KEY;

export interface SpriteAtlasConfigState {
  readonly enabled: boolean;
  readonly requestedEnabled: boolean;
  readonly defaultEnabled: boolean;
  readonly hardDisableActive: boolean;
  readonly localStorageKey: string;
  readonly localStorageValue: string | null;
  readonly overrideValue: boolean | null;
  readonly storageAvailable: boolean;
  readonly reloadRequired: boolean;
  readonly message: string;
}

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

export function setSpriteAtlasUseSetting(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.__DW_USE_SPRITE_ATLASES = enabled;
  try {
    window.localStorage?.setItem(LOCAL_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // The in-memory override still lets diagnostics report the requested state.
  }
  window.dispatchEvent(new CustomEvent('dw:sprite-atlas-mode-changed', {
    detail: getSpriteAtlasConfigState(),
  }));
}

export function isSpriteAtlasEnabled(): boolean {
  if (FORCE_DISABLE_SPRITE_ATLASES) return false;
  if (!import.meta.env?.DEV) return USE_SPRITE_ATLASES;
  if (typeof window === 'undefined') return USE_SPRITE_ATLASES;
  if (typeof window.__DW_USE_SPRITE_ATLASES === 'boolean') {
    return window.__DW_USE_SPRITE_ATLASES;
  }
  return getSpriteAtlasUseSetting();
}

export function getSpriteAtlasConfigState(): SpriteAtlasConfigState {
  let localStorageValue: string | null = null;
  let storageAvailable = false;
  if (typeof window !== 'undefined') {
    try {
      localStorageValue = window.localStorage?.getItem(LOCAL_STORAGE_KEY) ?? null;
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
  }
  const overrideValue = typeof window !== 'undefined' && typeof window.__DW_USE_SPRITE_ATLASES === 'boolean'
    ? window.__DW_USE_SPRITE_ATLASES
    : null;
  return {
    enabled: isSpriteAtlasEnabled(),
    requestedEnabled: getSpriteAtlasUseSetting(),
    defaultEnabled: USE_SPRITE_ATLASES,
    hardDisableActive: FORCE_DISABLE_SPRITE_ATLASES,
    localStorageKey: LOCAL_STORAGE_KEY,
    localStorageValue,
    overrideValue,
    storageAvailable,
    reloadRequired: true,
    message: FORCE_DISABLE_SPRITE_ATLASES
      ? 'Sprite atlas rendering is hard-disabled internally; gameplay uses the legacy sprite path.'
      : 'Sprite atlas mode is experimental. Reload or re-enter the room after changing it for a clean test.',
  };
}

export function installSpriteAtlasDevGlobals(): void {
  if (!import.meta.env?.DEV || typeof window === 'undefined') return;
  window.__dwSetSpriteAtlasesEnabled = (enabled: boolean) => {
    setSpriteAtlasUseSetting(enabled);
    return getSpriteAtlasConfigState();
  };
  window.__dwSpriteAtlasDebug = getSpriteAtlasConfigState;
}
