import { showMainMenu } from './ui/mainMenu';
import { showWorldMap } from './ui/worldMap';
import { showLoadoutScreen } from './ui/loadout';
import { startGameScreen } from './screens/gameScreen';
import { ParticleKind } from './sim/particles/kinds';
import { createDefaultProgress, PlayerProgress } from './progression/playerProgress';
import { LevelDef } from './levels/levelDef';
import { WORLD1_LEVELS } from './levels/world1';
import { WORLD2_LEVELS } from './levels/world2';
import { SaveSlotData, saveSaveSlot } from './progression/saveSlots';

function getNextLevel(current: LevelDef): LevelDef | null {
  const source = current.worldNumber === 1 ? WORLD1_LEVELS : WORLD2_LEVELS;
  const nextIndex = current.levelNumber;
  return source[nextIndex] ?? null;
}


export function startGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void {
  let cleanup: (() => void) | null = null;

  let progress: PlayerProgress = createDefaultProgress();

  /** Active save-slot index (set when player picks a slot). */
  let activeSlotIndex = 0;
  /** Timestamp (ms from performance.now) when gameplay started for the current session (for play-time tracking). */
  let sessionStartMs = 0;
  /** Active save data reference for persisting updates. */
  let activeSaveData: SaveSlotData | null = null;

  /** The level the player has selected to play next. */
  let selectedLevel: LevelDef = WORLD1_LEVELS[0];

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
    to: 'mainMenu' | 'worldMap' | 'loadout' | 'gameplay',
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
          navigate('worldMap');
        },
      });
    } else if (to === 'worldMap') {
      cleanup = showWorldMap(uiRoot, progress, {
        onStartLevel: (_prog, level) => {
          selectedLevel = level;
          navigate('loadout');
        },
      });
    } else if (to === 'loadout') {
      cleanup = showLoadoutScreen(uiRoot, progress, {
        onConfirm: (chosenLoadout) => {
          progress.loadout = chosenLoadout.slice();
          navigate('gameplay', chosenLoadout);
        },
        onCancel: () => navigate('worldMap'),
      });
    } else if (to === 'gameplay') {
      const activeLoadout = loadout ?? progress.loadout;
      cleanup = startGameScreen(canvas, uiRoot, activeLoadout, selectedLevel, {
        onReturnToMap: () => navigate('worldMap'),
        onExitDoor: (levelDef, target) => {
          const completedIndex = levelDef.levelNumber - 1;

          if (levelDef.worldNumber === 1) {
            if (completedIndex >= progress.world1UnlockedCount - 1) {
              progress.world1UnlockedCount = Math.min(WORLD1_LEVELS.length, completedIndex + 2);
            }
            if (levelDef.levelNumber === WORLD1_LEVELS.length && progress.world2UnlockedCount === 0) {
              progress.world2UnlockedCount = 1;
            }
          } else if (levelDef.worldNumber === 2) {
            if (completedIndex >= progress.world2UnlockedCount - 1) {
              progress.world2UnlockedCount = Math.min(WORLD2_LEVELS.length, completedIndex + 2);
            }
          }

          // Persist after level completion
          persistSaveSlot();

          if (target === 'menu') {
            navigate('mainMenu');
            return;
          }

          const nextLevel = getNextLevel(levelDef);
          if (nextLevel !== null) {
            selectedLevel = nextLevel;
            navigate('loadout');
            return;
          }

          navigate('worldMap');
        },
      });
    }
  }

  navigate('mainMenu');
}
