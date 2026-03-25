import { showMainMenu } from './ui/mainMenu';
import { showWorldMap } from './ui/worldMap';
import { startGameScreen } from './screens/gameScreen';

export function startGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void {
  let cleanup: (() => void) | null = null;

  function navigate(to: 'mainMenu' | 'worldMap' | 'gameplay'): void {
    if (cleanup !== null) {
      cleanup();
      cleanup = null;
    }

    if (to === 'mainMenu') {
      cleanup = showMainMenu(uiRoot, {
        onPlay: () => navigate('worldMap'),
      });
    } else if (to === 'worldMap') {
      cleanup = showWorldMap(uiRoot, {
        onStartLevel: () => navigate('gameplay'),
      });
    } else if (to === 'gameplay') {
      cleanup = startGameScreen(canvas, uiRoot, {
        onReturnToMap: () => navigate('worldMap'),
      });
    }
  }

  navigate('mainMenu');
}
