import { showMainMenu } from './ui/mainMenu';
import { showWorldMap } from './ui/worldMap';
import { showLoadoutScreen } from './ui/loadout';
import { startGameScreen } from './screens/gameScreen';
import { ParticleKind } from './sim/particles/kinds';
import { createDefaultProgress, PlayerProgress } from './progression/playerProgress';
import { LevelDef } from './levels/levelDef';
import { WORLD1_LEVELS } from './levels/world1';
import { WORLD2_LEVELS } from './levels/world2';

function getNextLevel(current: LevelDef): LevelDef | null {
  const source = current.worldNumber === 1 ? WORLD1_LEVELS : WORLD2_LEVELS;
  const nextIndex = current.levelNumber;
  return source[nextIndex] ?? null;
}


export function startGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void {
  let cleanup: (() => void) | null = null;

  const progress: PlayerProgress = createDefaultProgress();

  /** The level the player has selected to play next. */
  let selectedLevel: LevelDef = WORLD1_LEVELS[0];

  function navigate(
    to: 'mainMenu' | 'worldMap' | 'loadout' | 'gameplay',
    loadout?: ParticleKind[],
  ): void {
    if (cleanup !== null) {
      cleanup();
      cleanup = null;
    }

    if (to === 'mainMenu') {
      cleanup = showMainMenu(uiRoot, {
        onPlay: () => navigate('worldMap'),
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
