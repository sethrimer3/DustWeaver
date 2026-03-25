import { showMainMenu } from './ui/mainMenu';
import { showWorldMap } from './ui/worldMap';
import { showLoadoutScreen } from './ui/loadout';
import { startGameScreen } from './screens/gameScreen';
import { ParticleKind } from './sim/particles/kinds';
import { createDefaultProgress, PlayerProgress } from './progression/playerProgress';
import { LevelDef } from './levels/levelDef';
import { WORLD1_LEVELS } from './levels/world1';

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
        onLevelComplete: (levelDef) => {
          // Unlock the next level if this was the furthest one completed
          const completedIndex = levelDef.levelNumber - 1; // 0-based
          if (completedIndex + 1 >= progress.world1UnlockedCount) {
            progress.world1UnlockedCount = Math.min(
              WORLD1_LEVELS.length,
              completedIndex + 2,
            );
          }
          navigate('worldMap');
        },
      });
    }
  }

  navigate('mainMenu');
}
