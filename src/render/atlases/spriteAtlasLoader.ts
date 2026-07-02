import { decodeImg, isSpriteDecodeReady, isSpriteReady, loadImg } from '../imageCache';
import {
  getSpriteAtlasConfigState,
  isSpriteAtlasEnabled,
  setSpriteAtlasEnabledForDev,
  type SpriteAtlasConfigState,
} from './spriteAtlasConfig';
import type {
  LoadedSpriteAtlas,
  SpriteAtlasLookupResult,
  SpriteAtlasMetadata,
  SpriteAtlasStats,
} from './spriteAtlasTypes';

type AtlasState =
  | { status: 'idle'; metadata: SpriteAtlasMetadata; imageUrl: string }
  | { status: 'loading'; metadata: SpriteAtlasMetadata; imageUrl: string; image: HTMLImageElement }
  | { status: 'loaded'; atlas: LoadedSpriteAtlas }
  | { status: 'failed'; metadata: SpriteAtlasMetadata | null; imageUrl: string | null; reason: string };

const _ATLAS_METADATA_GLOB = import.meta.glob(
  '/ASSETS/DERIVED/SPRITE_ATLASES/*.json',
  { eager: true, import: 'default' },
) as Record<string, SpriteAtlasMetadata>;

const _ATLAS_IMAGE_GLOB = import.meta.glob(
  '/ASSETS/DERIVED/SPRITE_ATLASES/*.png',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

const _states = new Map<string, AtlasState>();
const _warned = new Set<string>();
const _perTheme = new Map<string, { lookups: number; hits: number; misses: number; fallbacks: number }>();
let _lookups = 0;
let _hits = 0;
let _misses = 0;
let _fallbacks = 0;
let _unsupportedPaths = 0;

export interface SpriteAtlasDebugInfo {
  readonly enabled: boolean;
  readonly config: SpriteAtlasConfigState;
  readonly runtimeInitialized: boolean;
  readonly metadataCount: number;
  readonly loadedAtlases: readonly string[];
  readonly failedAtlases: readonly string[];
  readonly loadingAtlases: readonly string[];
  readonly idleAtlases: readonly string[];
  readonly stats: SpriteAtlasStats;
  readonly instructions: {
    readonly inspect: string;
    readonly enable: string;
    readonly disable: string;
    readonly benchmark: string;
    readonly reload: string;
  };
}

export interface SpriteAtlasBenchUnavailable {
  readonly ok: false;
  readonly roomId: string;
  readonly error: string;
  readonly prerequisite: string;
  readonly debug: SpriteAtlasDebugInfo;
}

function _themeStats(themeId: string): { lookups: number; hits: number; misses: number; fallbacks: number } {
  let stats = _perTheme.get(themeId);
  if (stats === undefined) {
    stats = { lookups: 0, hits: 0, misses: 0, fallbacks: 0 };
    _perTheme.set(themeId, stats);
  }
  return stats;
}

function _recordLookup(themeId: string): void {
  _lookups++;
  _themeStats(themeId).lookups++;
}

function _recordHit(themeId: string): void {
  _hits++;
  _themeStats(themeId).hits++;
}

function _recordMiss(themeId: string): void {
  _misses++;
  _themeStats(themeId).misses++;
}

function _recordFallback(themeId: string): void {
  _fallbacks++;
  _themeStats(themeId).fallbacks++;
}

function _isMetadata(value: SpriteAtlasMetadata): boolean {
  return typeof value.version === 'number'
    && typeof value.themeId === 'string'
    && typeof value.sourceRoot === 'string'
    && typeof value.atlasImage === 'string'
    && value.sprites !== null
    && typeof value.sprites === 'object'
    && !Array.isArray(value.sprites);
}

function _warnOnce(key: string, message: string): void {
  if (!import.meta.env.DEV || _warned.has(key)) return;
  _warned.add(key);
  console.warn(message);
}

function _buildInitialStates(): void {
  for (const [jsonPath, metadata] of Object.entries(_ATLAS_METADATA_GLOB)) {
    if (!_isMetadata(metadata)) {
      _warnOnce(`invalid:${jsonPath}`, `[spriteAtlasLoader] Invalid atlas metadata: ${jsonPath}`);
      continue;
    }
    const imagePath = jsonPath.replace(/[^/]+\.json$/, metadata.atlasImage);
    const imageUrl = _ATLAS_IMAGE_GLOB[imagePath];
    if (imageUrl === undefined) {
      _states.set(metadata.themeId, {
        status: 'failed',
        metadata,
        imageUrl: null,
        reason: `missing atlas image module for ${metadata.atlasImage}`,
      });
      continue;
    }
    _states.set(metadata.themeId, { status: 'idle', metadata, imageUrl });
  }
}

_buildInitialStates();

function _stateForTheme(themeId: string): AtlasState | null {
  return _states.get(themeId) ?? null;
}

function _startLoad(themeId: string, state: Extract<AtlasState, { status: 'idle' }>): AtlasState {
  const image = loadImg(state.imageUrl);
  const loadingState: AtlasState = {
    status: 'loading',
    metadata: state.metadata,
    imageUrl: state.imageUrl,
    image,
  };
  _states.set(themeId, loadingState);

  image.addEventListener('load', () => {
    _states.set(themeId, {
      status: 'loaded',
      atlas: {
        themeId,
        metadata: state.metadata,
        image,
        imageUrl: state.imageUrl,
      },
    });
  }, { once: true });

  image.addEventListener('error', () => {
    _states.set(themeId, {
      status: 'failed',
      metadata: state.metadata,
      imageUrl: state.imageUrl,
      reason: 'atlas image failed to load',
    });
    _warnOnce(`load:${themeId}`, `[spriteAtlasLoader] Atlas image failed to load for '${themeId}'. Falling back to individual sprites.`);
  }, { once: true });

  if (isSpriteReady(image)) {
    _states.set(themeId, {
      status: 'loaded',
      atlas: {
        themeId,
        metadata: state.metadata,
        image,
        imageUrl: state.imageUrl,
      },
    });
    return _states.get(themeId)!;
  }

  return loadingState;
}

function _loadState(themeId: string): AtlasState | null {
  const state = _stateForTheme(themeId);
  if (state === null || state.status !== 'idle') return state;
  return _startLoad(themeId, state);
}

export function preloadSpriteAtlasForTheme(themeId: string): void {
  if (!isSpriteAtlasEnabled()) return;
  const state = _loadState(themeId);
  if (state === null) _recordMiss(themeId);
}

export async function decodeSpriteAtlasForTheme(themeId: string): Promise<void> {
  if (!isSpriteAtlasEnabled()) return;
  const state = _loadState(themeId);
  if (state === null || state.status === 'failed') return;
  const imageUrl = state.status === 'loaded' ? state.atlas.imageUrl : state.imageUrl;
  await decodeImg(imageUrl);
  const latest = _states.get(themeId);
  if (latest?.status === 'loading' && isSpriteDecodeReady(latest.image)) {
    _states.set(themeId, {
      status: 'loaded',
      atlas: {
        themeId,
        metadata: latest.metadata,
        image: latest.image,
        imageUrl: latest.imageUrl,
      },
    });
  }
}

export function getAtlasSprite(themeId: string | null, spriteKey: string | null): SpriteAtlasLookupResult | null {
  if (!isSpriteAtlasEnabled()) return null;
  if (themeId === null || spriteKey === null) {
    _misses++;
    return null;
  }

  _recordLookup(themeId);
  const state = _loadState(themeId);
  if (state === null) {
    _recordMiss(themeId);
    return null;
  }
  if (state.status === 'failed') {
    _recordFallback(themeId);
    return null;
  }
  if (state.status === 'idle' || state.status === 'loading') {
    _recordFallback(themeId);
    return null;
  }

  const sprite = state.atlas.metadata.sprites[spriteKey];
  if (sprite === undefined) {
    _recordMiss(themeId);
    return null;
  }
  if (!isSpriteReady(state.atlas.image)) {
    _recordFallback(themeId);
    return null;
  }
  _recordHit(themeId);
  return { atlas: state.atlas, sprite, spriteKey };
}

export function recordUnsupportedSpriteAtlasPath(_pathKind: string): void {
  if (!isSpriteAtlasEnabled()) return;
  _unsupportedPaths++;
}

export function getSpriteAtlasStats(): SpriteAtlasStats {
  const loadedAtlases: string[] = [];
  const failedAtlases: string[] = [];
  const loadingAtlases: string[] = [];
  for (const [themeId, state] of _states.entries()) {
    if (state.status === 'loaded') loadedAtlases.push(themeId);
    else if (state.status === 'failed') failedAtlases.push(themeId);
    else if (state.status === 'loading') loadingAtlases.push(themeId);
  }
  loadedAtlases.sort();
  failedAtlases.sort();
  loadingAtlases.sort();
  const perTheme: SpriteAtlasStats['perTheme'] = {};
  for (const [themeId, stats] of [..._perTheme.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    perTheme[themeId] = { ...stats };
  }
  return {
    enabled: isSpriteAtlasEnabled(),
    metadataCount: _states.size,
    loadedAtlasCount: loadedAtlases.length,
    failedAtlasCount: failedAtlases.length,
    loadingAtlasCount: loadingAtlases.length,
    loadedAtlases,
    failedAtlases,
    loadingAtlases,
    lookups: _lookups,
    hits: _hits,
    misses: _misses,
    fallbacks: _fallbacks,
    unsupportedPaths: _unsupportedPaths,
    perTheme,
  };
}

export function getSpriteAtlasDebugInfo(): SpriteAtlasDebugInfo {
  const idleAtlases: string[] = [];
  for (const [themeId, state] of _states.entries()) {
    if (state.status === 'idle') idleAtlases.push(themeId);
  }
  idleAtlases.sort();
  const stats = getSpriteAtlasStats();
  return {
    enabled: stats.enabled,
    config: getSpriteAtlasConfigState(),
    runtimeInitialized: true,
    metadataCount: _states.size,
    loadedAtlases: stats.loadedAtlases,
    failedAtlases: stats.failedAtlases,
    loadingAtlases: stats.loadingAtlases,
    idleAtlases,
    stats,
    instructions: {
      inspect: 'window.__dwSpriteAtlasDebug()',
      enable: 'window.__dwSetSpriteAtlasesEnabled(true); location.reload()',
      disable: 'window.__dwSetSpriteAtlasesEnabled(false); location.reload()',
      benchmark: "await window.__dwBenchSpriteAtlasRoom('lobby')",
      reload: 'Reload is recommended after toggling so room setup, preloading, and rendering all use the same atlas mode.',
    },
  };
}

export function installSpriteAtlasDiagnostics(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  type DwWindow = Window & {
    __dwSpriteAtlasStats?: () => SpriteAtlasStats;
    __dwSetSpriteAtlasesEnabled?: (enabled: boolean) => SpriteAtlasConfigState;
    __dwSpriteAtlasDebug?: () => SpriteAtlasDebugInfo;
    __dwBenchSpriteAtlasRoom?: (roomId: string, opts?: unknown) => Promise<SpriteAtlasBenchUnavailable>;
  };
  const w = window as DwWindow;
  w.__dwSpriteAtlasStats = getSpriteAtlasStats;
  w.__dwSetSpriteAtlasesEnabled = (enabled: boolean) => setSpriteAtlasEnabledForDev(Boolean(enabled));
  w.__dwSpriteAtlasDebug = getSpriteAtlasDebugInfo;
  w.__dwBenchSpriteAtlasRoom = async (roomId: string): Promise<SpriteAtlasBenchUnavailable> => ({
    ok: false,
    roomId,
    error: 'Sprite atlas room benchmark is not ready yet. Start gameplay first, then call this helper again.',
    prerequisite: 'startGameScreen must install the transition-backed benchmark helper.',
    debug: getSpriteAtlasDebugInfo(),
  });
}

installSpriteAtlasDiagnostics();
