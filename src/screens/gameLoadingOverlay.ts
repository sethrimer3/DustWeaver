/**
 * Self-contained loading overlay shown while room sprites are loading.
 *
 * Displayed immediately over the game viewport; fades out and removes itself
 * once the readiness check passes and the minimum display time has elapsed.
 *
 * Usage:
 *   const overlay = new GameLoadingOverlay(uiRoot);
 *   overlay.show();
 *   // Each frame:
 *   overlay.tick(() => areRoomSpritesReady(currentRoom));
 */

/** How often (ms) the readiness callback is polled to avoid per-frame DOM reads. */
const CHECK_INTERVAL_MS = 50;

/** Minimum time (ms) the overlay is shown to avoid a flash on fast loads. */
const MIN_SHOW_MS = 200;

export class GameLoadingOverlay {
  private el: HTMLDivElement | null = null;
  private minShowUntilMs = 0;
  private lastCheckMs = 0;

  constructor(private readonly uiRoot: HTMLElement) {}

  /** Creates and attaches the overlay element to `uiRoot`. */
  show(): void {
    if (this.el !== null) return;
    const div = document.createElement('div');
    div.style.cssText = [
      'position:absolute',
      'inset:0',
      'background:#000',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'z-index:9999',
      "font-family:'Cinzel',serif",
      'font-size:1.2rem',
      'color:#00cfff',
      'pointer-events:none',
      'transition:opacity 0.3s',
    ].join(';');
    div.textContent = 'Loading\u2026';
    this.uiRoot.appendChild(div);
    this.el = div;
    this.minShowUntilMs = performance.now() + MIN_SHOW_MS;
    this.lastCheckMs = 0;
  }

  /**
   * Polls readiness; fades out and removes the overlay once the minimum
   * show time has elapsed and `isReady()` returns true.
   * Call once per frame.
   */
  tick(isReady: () => boolean): void {
    if (this.el === null) return;
    const now = performance.now();
    if (now < this.minShowUntilMs) return;
    if (now - this.lastCheckMs < CHECK_INTERVAL_MS) return;
    this.lastCheckMs = now;
    if (!isReady()) return;
    // Sprites ready — fade out and remove the overlay.
    const el = this.el;
    this.el = null;
    el.style.opacity = '0';
    setTimeout(() => {
      if (el.parentElement !== null) el.parentElement.removeChild(el);
    }, 300);
  }

  /** Immediately removes the overlay without a fade (e.g. on screen teardown). */
  destroy(): void {
    if (this.el?.parentElement) this.el.parentElement.removeChild(this.el);
    this.el = null;
  }
}
