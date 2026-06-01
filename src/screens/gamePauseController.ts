import { showPauseMenu, type PauseMenuState } from '../ui/pauseMenu';
import {
  getAlwaysCenterCamera,
  getGraphicsQuality,
  getMusicVolume,
  getSfxVolume,
  getWorldViewPresetId,
  getManualSprintEnabled,
} from '../ui/renderSettings';

interface CreateGamePauseControllerParams {
  uiRoot: HTMLElement;
  canOpenPauseMenu: () => boolean;
  onResetFrameClock: () => void;
  onExitToMainMenu: () => void;
  onDebugModeChanged: (isDebugMode: boolean) => void;
  /** Called when the player changes the World View preset so the caller can resize the canvas. */
  onResizeCanvas?: () => void;
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
    onResizeCanvas,
  } = params;

  const initialMusicVolume = getMusicVolume();
  const initialSfxVolume = getSfxVolume();
  const initialGraphicsQuality = getGraphicsQuality();
  const initialAlwaysCenterCamera = getAlwaysCenterCamera();
  const initialWorldViewPresetId = getWorldViewPresetId();
  const initialManualSprintEnabled = getManualSprintEnabled();

  const state: GamePauseControllerState = {
    isPaused: false,
    isDebugMode: false,
    pauseMenuState: {
      isDebugOn: false,
      musicVolume: initialMusicVolume,
      sfxVolume: initialSfxVolume,
      graphicsQuality: initialGraphicsQuality,
      alwaysCenterCamera: initialAlwaysCenterCamera,
      worldViewPresetId: initialWorldViewPresetId,
      manualSprintEnabled: initialManualSprintEnabled,
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
      onWorldViewChanged: onResizeCanvas,
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
    state.pauseMenuState.worldViewPresetId = initialWorldViewPresetId;
    state.pauseMenuState.manualSprintEnabled = initialManualSprintEnabled;
  }

  return {
    state,
    openPauseMenu,
    destroy,
  };
}
