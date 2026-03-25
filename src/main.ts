import { startGame } from './game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLDivElement;

if (!canvas || !uiRoot) {
  throw new Error('Missing required DOM elements: game-canvas or ui-root');
}

startGame(canvas, uiRoot);
