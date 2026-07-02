const LOCAL_STORAGE_KEY = 'dw.useSpriteAtlases';

declare global {
  interface Window {
    __DW_USE_SPRITE_ATLASES?: boolean;
  }
}

export const USE_SPRITE_ATLASES = false;
export const SPRITE_ATLAS_LOCAL_STORAGE_KEY = LOCAL_STORAGE_KEY;

export function isSpriteAtlasEnabled(): boolean {
  if (!import.meta.env.DEV) return USE_SPRITE_ATLASES;
  if (typeof window === 'undefined') return USE_SPRITE_ATLASES;
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
  readonly localStorageKey: string;
  readonly localStorageValue: string | null;
  readonly overrideValue: boolean | null;
  readonly storageAvailable: boolean;
  readonly reloadRequired: boolean;
  readonly message: string;
}

export function getSpriteAtlasConfigState(): SpriteAtlasConfigState {
  let localStorageValue: string | null = null;
  let storageAvailable = false;
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    try {
      localStorageValue = window.localStorage?.getItem(LOCAL_STORAGE_KEY) ?? null;
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
    localStorageKey: LOCAL_STORAGE_KEY,
    localStorageValue,
    overrideValue,
    storageAvailable,
    reloadRequired: true,
    message: 'Sprite atlas mode is read by render/preload paths during room setup; reload or re-enter the room after changing it for a clean benchmark.',
  };
}

export function setSpriteAtlasEnabledForDev(enabled: boolean): SpriteAtlasConfigState {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return getSpriteAtlasConfigState();
  }
  window.__DW_USE_SPRITE_ATLASES = enabled;
  try {
    window.localStorage?.setItem(LOCAL_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // The in-memory override still lets the current DEV page report the requested state.
  }
  return getSpriteAtlasConfigState();
}
