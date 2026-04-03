import { startGame } from './game';
import { initRoomRegistry } from './levels/rooms';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLDivElement;

if (!canvas || !uiRoot) {
  throw new Error('Missing required DOM elements: game-canvas or ui-root');
}

// Load room JSON data files before starting the game.
initRoomRegistry().then(() => {
  startGame(canvas, uiRoot);
}).catch((err) => {
  console.error('Failed to initialize room registry:', err);
  // Start anyway — some rooms may have loaded
  startGame(canvas, uiRoot);
});
