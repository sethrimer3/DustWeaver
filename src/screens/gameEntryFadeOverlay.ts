/**
 * Full-viewport black cover for the deterministic post-load entry fade
 * sequence (see gameEntryFadeController.ts). Unlike GameLoadingOverlay this
 * has no CSS transition of its own — alpha is set explicitly every frame from
 * the controller's deterministic elapsed-time calculation, and it sits above
 * the loading overlay's z-index so it always draws on top of everything else
 * including the HUD.
 */

const Z_INDEX = 10000;

export class GameEntryFadeOverlay {
  private el: HTMLDivElement | null = null;

  constructor(private readonly uiRoot: HTMLElement) {}

  /** Sets the cover opacity for this frame. alpha <= 0 removes the element. */
  setAlpha(alpha: number): void {
    if (alpha <= 0) {
      this.destroy();
      return;
    }
    if (this.el === null) {
      const div = document.createElement('div');
      div.style.cssText = [
        'position:absolute',
        'inset:0',
        'background:#000000',
        `z-index:${Z_INDEX}`,
        'pointer-events:none',
      ].join(';');
      this.uiRoot.appendChild(div);
      this.el = div;
    }
    this.el.style.opacity = String(alpha > 1 ? 1 : alpha);
  }

  /** Immediately removes the overlay element, if present. */
  destroy(): void {
    if (this.el?.parentElement) this.el.parentElement.removeChild(this.el);
    this.el = null;
  }
}
