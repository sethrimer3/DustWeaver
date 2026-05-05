/**
 * dialogueOverlayRenderer.ts — High-resolution DOM overlay for RPG dialogue boxes.
 *
 * WHY NOT THE VIRTUAL CANVAS: The game world renders at a fixed 480×270 virtual
 * pixel canvas that is upscaled with nearest-neighbour sampling for a pixelated
 * retro look.  Rendering dialogue text into that canvas would produce blurry,
 * pixelated text.  This renderer creates DOM elements positioned over the game
 * canvas in actual device pixels, giving crisp typography on all displays and
 * DPI-awareness at no extra cost since CSS already handles device pixel ratios.
 *
 * PORTRAIT PLACEHOLDERS: Each portraitId is rendered as a colored circle with
 * initials using a small canvas element scaled by devicePixelRatio.
 * TODO: Replace stub portrait rendering in _drawPortrait() with real portrait
 * asset loading once final art is available (e.g., load HTMLImageElement from
 * SPRITES/portraits/{portraitId}.png and drawImage() onto the canvas).
 *
 * HOW DIALOGUE TRIGGERS ARE STORED: Dialogue triggers are stored in RoomDef as
 * RoomDialogueTriggerDef objects, each containing a full Conversation with entries.
 * The room JSON serialisation (roomJson.ts / roomJsonSchema.ts) persists these
 * alongside all other room data.  See src/dialogue/dialogueTypes.ts for the data model.
 */

import type { DialogueEntry } from '../../dialogue/dialogueTypes';
import { STUB_PORTRAIT_IDS } from '../../dialogue/dialogueTypes';

// ── Stub portrait visual config ───────────────────────────────────────────────
// TODO: Remove PORTRAIT_COLORS and PORTRAIT_INITIALS once real portrait assets
//       replace the stub canvas rendering in _drawPortrait().

const PORTRAIT_COLORS: Readonly<Record<string, string>> = {
  none:     'transparent',
  narrator: '#778899',
  hero:     '#d4a017',
  elder:    '#9b59b6',
  merchant: '#27ae60',
  enemy:    '#c0392b',
};

const PORTRAIT_INITIALS: Readonly<Record<string, string>> = {
  none:     '',
  narrator: 'N',
  hero:     'H',
  elder:    'E',
  merchant: 'M',
  enemy:    '✕',
};

/** Rendered size of the portrait canvas in CSS pixels. */
const PORTRAIT_SIZE_CSS_PX = 80;

// ── CSS strings ───────────────────────────────────────────────────────────────

const PANEL_CSS = `
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 14px 16px 14px 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 14px;
  background: rgba(6, 8, 18, 0.92);
  border-top: 2px solid rgba(150, 170, 220, 0.22);
  font-family: 'Cinzel', 'Georgia', serif;
  pointer-events: none;
  z-index: 500;
  min-height: 110px;
  max-height: 210px;
`;

const TEXT_AREA_CSS = `
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 5px;
  overflow: hidden;
  min-width: 0;
`;

const TITLE_CSS = `
  font-size: 13px;
  font-weight: bold;
  color: rgba(220, 200, 140, 1.0);
  letter-spacing: 0.07em;
  text-shadow: 0 0 8px rgba(220, 180, 60, 0.55);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TEXT_CSS = `
  font-size: 14px;
  line-height: 1.6;
  color: rgba(228, 234, 255, 0.95);
  word-break: break-word;
  white-space: pre-wrap;
  margin: 0;
  flex: 1;
  overflow: hidden;
`;

const CONTINUE_CSS = `
  font-size: 15px;
  color: rgba(90, 190, 255, 0.88);
  text-align: right;
  padding-right: 2px;
  margin: 0;
`;

const BLINK_KEYFRAMES = `@keyframes dialogueAdvanceBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}`;

const BLINK_ANIMATION = 'dialogueAdvanceBlink 0.8s step-end infinite';

/** Re-export so callers that render the portrait picker can use the same list. */
export { STUB_PORTRAIT_IDS };

/**
 * High-resolution dialogue overlay renderer.
 *
 * Manages a single DOM panel element shown at the bottom of the game area.
 * The panel is appended to uiRoot and positioned in actual device pixels —
 * it is never affected by the game canvas virtual-pixel zoom or upscale pass.
 */
export class DialogueOverlayRenderer {
  private readonly _panel: HTMLDivElement;
  private readonly _portraitCanvas: HTMLCanvasElement;
  private readonly _titleEl: HTMLParagraphElement;
  private readonly _textEl: HTMLParagraphElement;
  private readonly _continueEl: HTMLParagraphElement;
  private readonly _textWrapper: HTMLDivElement;
  private _isVisible: boolean = false;

  constructor(uiRoot: HTMLElement) {
    // Inject blink keyframe stylesheet once per document lifetime.
    if (!document.getElementById('dialogue-blink-style')) {
      const style = document.createElement('style');
      style.id = 'dialogue-blink-style';
      style.textContent = BLINK_KEYFRAMES;
      document.head.appendChild(style);
    }

    this._panel = document.createElement('div');
    this._panel.style.cssText = PANEL_CSS;
    this._panel.style.display = 'none';

    // Portrait canvas — drawn at devicePixelRatio for crisp rendering on high-DPI.
    this._portraitCanvas = document.createElement('canvas');
    this._portraitCanvas.style.cssText = `
      width: ${PORTRAIT_SIZE_CSS_PX}px;
      height: ${PORTRAIT_SIZE_CSS_PX}px;
      border-radius: 6px;
      border: 1px solid rgba(150, 170, 220, 0.28);
      flex-shrink: 0;
      image-rendering: pixelated;
    `;
    const dpr = window.devicePixelRatio || 1;
    this._portraitCanvas.width = Math.round(PORTRAIT_SIZE_CSS_PX * dpr);
    this._portraitCanvas.height = Math.round(PORTRAIT_SIZE_CSS_PX * dpr);

    // Text area: speaker title + body text + continue indicator.
    this._textWrapper = document.createElement('div');
    this._textWrapper.style.cssText = TEXT_AREA_CSS;

    this._titleEl = document.createElement('p');
    this._titleEl.style.cssText = TITLE_CSS;

    this._textEl = document.createElement('p');
    this._textEl.style.cssText = TEXT_CSS;

    this._continueEl = document.createElement('p');
    this._continueEl.style.cssText = CONTINUE_CSS;
    this._continueEl.textContent = '▼';

    this._textWrapper.appendChild(this._titleEl);
    this._textWrapper.appendChild(this._textEl);
    this._textWrapper.appendChild(this._continueEl);

    // Default layout: portrait on left, text on right.
    this._panel.appendChild(this._portraitCanvas);
    this._panel.appendChild(this._textWrapper);

    uiRoot.appendChild(this._panel);
  }

  /** Whether the dialogue overlay is currently visible. */
  get isVisible(): boolean {
    return this._isVisible;
  }

  /**
   * Shows the dialogue overlay with the given entry.
   *
   * @param entry       The dialogue entry to display.
   * @param title       Optional speaker name shown above the text.
   * @param isLastEntry True when this is the final entry — changes the continue indicator.
   */
  show(entry: DialogueEntry, title?: string, isLastEntry?: boolean): void {
    const isRight = entry.portraitSide === 'right';

    // Reorder portrait to left or right inside the flex row.
    if (isRight) {
      this._panel.appendChild(this._portraitCanvas);
    } else {
      this._panel.insertBefore(this._portraitCanvas, this._panel.firstChild);
    }

    this._drawPortrait(entry.portraitId);

    if (title && title.trim().length > 0) {
      this._titleEl.textContent = title;
      this._titleEl.style.display = 'block';
    } else {
      this._titleEl.textContent = '';
      this._titleEl.style.display = 'none';
    }

    this._textEl.textContent = entry.text;

    this._continueEl.textContent = isLastEntry ? '■' : '▼';
    this._continueEl.style.animation = BLINK_ANIMATION;

    this._panel.style.display = 'flex';
    this._isVisible = true;
  }

  /** Hides the dialogue overlay. */
  hide(): void {
    this._panel.style.display = 'none';
    this._isVisible = false;
  }

  /**
   * Removes the overlay panel from the DOM.
   * Call when destroying the game screen to avoid leaking DOM nodes.
   */
  destroy(): void {
    if (this._panel.parentElement) {
      this._panel.parentElement.removeChild(this._panel);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Draws a stub portrait on the portrait canvas.
   *
   * TODO: Replace stub canvas drawing with real portrait asset loading.
   *       Once SPRITES/portraits/{portraitId}.png assets exist, load them as
   *       HTMLImageElement objects (cache in a Map keyed by portraitId) and
   *       use ctx.drawImage() here instead of the circle-and-initials approach.
   */
  private _drawPortrait(portraitId: string): void {
    const canvas = this._portraitCanvas;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 4 * dpr;

    ctx.clearRect(0, 0, w, h);

    const color = PORTRAIT_COLORS[portraitId] ?? '#556688';

    if (portraitId === 'none' || color === 'transparent') {
      // Empty portrait state — subtle dark fill.
      ctx.fillStyle = 'rgba(18, 20, 36, 0.7)';
      ctx.fillRect(0, 0, w, h);
      return;
    }

    // Dark background.
    ctx.fillStyle = 'rgba(10, 12, 24, 1)';
    ctx.fillRect(0, 0, w, h);

    // Filled circle.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Soft inner highlight.
    ctx.beginPath();
    ctx.arc(cx - r * 0.18, cy - r * 0.26, r * 0.48, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fill();

    // Initials text.
    const initials = PORTRAIT_INITIALS[portraitId] ?? portraitId.charAt(0).toUpperCase();
    ctx.font = `bold ${Math.round(r * 0.78)}px Cinzel, Georgia, serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 5 * dpr;
    ctx.fillText(initials, cx, cy + r * 0.05);
    ctx.shadowBlur = 0;
  }
}
