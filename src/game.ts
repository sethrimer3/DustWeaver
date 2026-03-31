import { showMainMenu } from './ui/mainMenu';
import { showLoadoutScreen } from './ui/weaveLoadout';
import { showCharacterSelect } from './ui/characterSelect';
import { startGameScreen } from './screens/gameScreen';
import { ParticleKind } from './sim/particles/kinds';
import { createDefaultProgress, PlayerProgress } from './progression/playerProgress';
import { SaveSlotData, saveSaveSlot } from './progression/saveSlots';


export function startGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void {
  let cleanup: (() => void) | null = null;

  let progress: PlayerProgress = createDefaultProgress();

  /** Active save-slot index (set when player picks a slot). */
  let activeSlotIndex = 0;
  /** Timestamp (ms from performance.now) when gameplay started for the current session (for play-time tracking). */
  let sessionStartMs = 0;
  /** Active save data reference for persisting updates. */
  let activeSaveData: SaveSlotData | null = null;

  /** Persist the current save slot (update lastPlayed and accumulate play time). */
  function persistSaveSlot(): void {
    if (activeSaveData === null) return;
    const now = performance.now();
    if (sessionStartMs > 0) {
      activeSaveData.playTimeMs += now - sessionStartMs;
      sessionStartMs = now;
    }
    activeSaveData.lastPlayedIso = new Date().toISOString();
    activeSaveData.progress = progress;
    saveSaveSlot(activeSlotIndex, activeSaveData);
  }

  function navigate(
    to: 'mainMenu' | 'characterSelect' | 'loadout' | 'gameplay',
    loadout?: ParticleKind[],
  ): void {
    // Persist progress when leaving gameplay
    if (cleanup !== null) {
      if (activeSaveData !== null && sessionStartMs > 0) {
        persistSaveSlot();
      }
      cleanup();
      cleanup = null;
    }

    if (to === 'mainMenu') {
      cleanup = showMainMenu(uiRoot, {
        onPlay: (slotIndex, saveData) => {
          activeSlotIndex = slotIndex;
          activeSaveData = saveData;
          progress = saveData.progress;
          sessionStartMs = performance.now();
          // If the save has explored rooms (returning player), skip loadout + character select
          if (progress.exploredRoomIds.length > 0) {
            navigate('gameplay', progress.loadout);
          } else {
            navigate('characterSelect');
          }
        },
      });
    } else if (to === 'characterSelect') {
      cleanup = showCharacterSelect(uiRoot, {
        onConfirm: (characterId) => {
          progress.characterId = characterId;
          navigate('loadout');
        },
        onCancel: () => navigate('mainMenu'),
      });
    } else if (to === 'loadout') {
      cleanup = showLoadoutScreen(uiRoot, progress, {
        onConfirm: (chosenLoadout, chosenWeaveLoadout) => {
          progress.loadout = chosenLoadout.slice();
          progress.weaveLoadout = chosenWeaveLoadout;
          navigate('gameplay', chosenLoadout);
        },
        onCancel: () => navigate('mainMenu'),
      });
    } else if (to === 'gameplay') {
      const activeLoadout = loadout ?? progress.loadout;
      const startRoomId = progress.lastSaveRoomId ?? null;
      cleanup = startGameScreen(canvas, uiRoot, activeLoadout, startRoomId, {
        onReturnToMenu: () => {
          persistSaveSlot();
          navigate('mainMenu');
        },
        onSave: () => {
          persistSaveSlot();
        },
      }, progress);
    }
  }

  navigate('mainMenu');
}
