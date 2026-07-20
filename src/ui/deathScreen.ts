/**
 * Death screen overlay.
 *
 * When the player dies:
 *   1. Everything freezes (sim is paused by gameScreen)
 *   2. Screen fades to 50% darkness
 *   3. Blurred menu background animation plays at 50% opacity over that
 *   4. "Dusts..." text displayed
 *   5. "Return to Last Save" button
 *   6. "Return to Main Menu" button
 *
 * All text uses Cinzel, Regular 400.
 */

import { createMenuAnimatedBackground } from './menuAnimatedBackground';
import { getPreloadedMenuAnimationFrames, MENU_ANIMATION_FPS } from './menuAnimationFrames';

export interface DeathScreenCallbacks {
  onReturnToLastSave: () => void;
  onReturnToMainMenu: () => void;
}

export function showDeathScreen(
  root: HTMLElement,
  callbacks: DeathScreenCallbacks,
): () => void {
  const menuFrames = getPreloadedMenuAnimationFrames();
  const animatedBackground = createMenuAnimatedBackground({
    normalFrames: menuFrames.blurred,
    blurredFrames: menuFrames.blurred,
    fps: MENU_ANIMATION_FPS,
    opacity: 0.5,
    zIndex: 1,
  });
  animatedBackground.showBlurred();

  // ── Preload blurred frames ─────────────────────────────────────────────────
  // ── Overlay container ──────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    z-index: 2000; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    opacity: 0; transition: opacity 1s ease-in;
  `;

  // ── 50% dark background ────────────────────────────────────────────────────
  const darkLayer = document.createElement('div');
  darkLayer.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.5); z-index: 0;
  `;
  overlay.appendChild(darkLayer);

  // ── Animation canvas (blurred at 50% opacity) ──────────────────────────────
  overlay.appendChild(animatedBackground.element);

  // ── UI content ─────────────────────────────────────────────────────────────
  const content = document.createElement('div');
  content.style.cssText = `
    position: relative; z-index: 2;
    display: flex; flex-direction: column; align-items: center;
    gap: 1.5rem;
  `;

  // Title text
  const titleEl = document.createElement('div');
  titleEl.textContent = 'Dusts...';
  titleEl.style.cssText = `
    font-family: 'Cinzel', serif; font-weight: 400;
    font-size: 3.5rem; color: #d4a84b;
    text-shadow: 0 0 40px rgba(212,168,75,0.5), 0 0 80px rgba(212,168,75,0.25);
    letter-spacing: 0.08em;
  `;
  content.appendChild(titleEl);

  // Helper to create death menu buttons
  function createDeathButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      background: rgba(30,28,22,0.85); border: 1px solid rgba(212,168,75,0.4);
      color: #d4a84b; padding: 0.9rem 3rem; font-size: 1.1rem;
      font-family: 'Cinzel', serif; font-weight: 400; cursor: pointer;
      transition: all 0.25s; border-radius: 2px;
      letter-spacing: 0.12em; min-width: 280px;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(212,168,75,0.12)';
      btn.style.borderColor = 'rgba(212,168,75,0.8)';
      btn.style.textShadow = '0 0 12px rgba(212,168,75,0.5)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(30,28,22,0.85)';
      btn.style.borderColor = 'rgba(212,168,75,0.4)';
      btn.style.textShadow = 'none';
    });
    btn.addEventListener('click', onClick);
    return btn;
  }

  const btnLastSave = createDeathButton('Return to Last Save', () => {
    destroy();
    callbacks.onReturnToLastSave();
  });
  content.appendChild(btnLastSave);

  const btnMainMenu = createDeathButton('Return to Main Menu', () => {
    destroy();
    callbacks.onReturnToMainMenu();
  });
  content.appendChild(btnMainMenu);

  overlay.appendChild(content);

  // ── Animation loop ─────────────────────────────────────────────────────────
  // ── Mount ──────────────────────────────────────────────────────────────────
  root.appendChild(overlay);

  // Fade in
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────
  function destroy(): void {
    animatedBackground.destroy();
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }

  return destroy;
}
