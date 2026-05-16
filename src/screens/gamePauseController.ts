import { showPauseMenu, type PauseMenuState } from '../ui/pauseMenu';
import {
  getAlwaysCenterCamera,
  getGraphicsQuality,
  getMusicVolume,
  getSfxVolume,
} from '../ui/renderSettings';

interface CreateGamePauseControllerParams {
  uiRoot: HTMLElement;
  canOpenPauseMenu: () => boolean;
  onResetFrameClock: () => void;
  onExitToMainMenu: () => void;
  onDebugModeChanged: (isDebugMode: boolean) => void;
}

export interface GamePauseControllerState {
  isPaused: boolean;
  isDebugMode: boolean;
  pauseMenuState: PauseMenuState;
}

export interface GamePauseController {
  state: GamePauseControllerState;
  openPauseMenu: () => void;
  destroy: () => void;
}

export function createGamePauseController(
  params: CreateGamePauseControllerParams,
): GamePauseController {
  const {
    uiRoot,
    canOpenPauseMenu,
    onResetFrameClock,
    onExitToMainMenu,
    onDebugModeChanged,
  } = params;

  const initialMusicVolume = getMusicVolume();
  const initialSfxVolume = getSfxVolume();
  const initialGraphicsQuality = getGraphicsQuality();
  const initialAlwaysCenterCamera = getAlwaysCenterCamera();

  const state: GamePauseControllerState = {
    isPaused: false,
    isDebugMode: false,
    pauseMenuState: {
      isDebugOn: false,
      musicVolume: initialMusicVolume,
      sfxVolume: initialSfxVolume,
      graphicsQuality: initialGraphicsQuality,
      alwaysCenterCamera: initialAlwaysCenterCamera,
    },
  };

  let pauseMenuCleanup: (() => void) | null = null;

  function openPauseMenu(): void {
    if (state.isPaused || !canOpenPauseMenu()) return;
    state.isPaused = true;
    pauseMenuCleanup = showPauseMenu(uiRoot, state.pauseMenuState, {
      onResume: () => {
        state.isPaused = false;
        pauseMenuCleanup = null;
        onResetFrameClock();
      },
      onExitToMainMenu: () => {
        state.isPaused = false;
        pauseMenuCleanup = null;
        onExitToMainMenu();
      },
      onToggleDebug: () => {
        state.isDebugMode = !state.isDebugMode;
        state.pauseMenuState.isDebugOn = state.isDebugMode;
        onDebugModeChanged(state.isDebugMode);
      },
    });
  }

  function destroy(): void {
    if (pauseMenuCleanup !== null) {
      pauseMenuCleanup();
      pauseMenuCleanup = null;
    }
    state.isPaused = false;
    state.isDebugMode = false;
    state.pauseMenuState.isDebugOn = false;
    state.pauseMenuState.musicVolume = initialMusicVolume;
    state.pauseMenuState.sfxVolume = initialSfxVolume;
    state.pauseMenuState.graphicsQuality = initialGraphicsQuality;
    state.pauseMenuState.alwaysCenterCamera = initialAlwaysCenterCamera;
  }

  return {
    state,
    openPauseMenu,
    destroy,
  };
}
