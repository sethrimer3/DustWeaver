import { showMainMenu } from './ui/mainMenu';
import { showWorldMap } from './ui/worldMap';
import { showLoadoutScreen } from './ui/loadout';
import { startGameScreen } from './screens/gameScreen';
import { ParticleKind } from './sim/particles/kinds';
import { createDefaultProgress, PlayerProgress } from './progression/playerProgress';

export function startGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void {
  let cleanup: (() => void) | null = null;

  // Player progress persists for the session (in-memory).
  const progress: PlayerProgress = createDefaultProgress();

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
      onStartLevel: (_prog) => navigate('loadout'),
      });
    } else if (to === 'loadout') {
      cleanup = showLoadoutScreen(uiRoot, progress, {
        onConfirm: (chosenLoadout) => {
          // Persist the chosen loadout back to the progress object.
          progress.loadout = chosenLoadout.slice();
          navigate('gameplay', chosenLoadout);
        },
        onCancel: () => navigate('worldMap'),
      });
    } else if (to === 'gameplay') {
      const activeLoadout = loadout ?? progress.loadout;
      cleanup = startGameScreen(canvas, uiRoot, activeLoadout, {
        onReturnToMap: () => navigate('worldMap'),
      });
    }
  }

  navigate('mainMenu');
}
