/**
 * dialogueOverlayRenderer.ts - High-resolution DOM overlay for RPG dialogue boxes.
 *
 * The game world renders at a fixed virtual-pixel resolution, so this overlay
 * uses DOM elements and a device-pixel-ratio canvas for crisp text and portraits.
 */

import type { DialogueEntry } from '../../dialogue/dialogueTypes';
import { DIALOGUE_PORTRAIT_OPTIONS, getDialoguePortraitOption } from '../../dialogue/dialoguePortraits';
import { isSpriteReady, loadImg } from '../imageCache';
import { isAnimatedSpritePortrait, SpritePortraitAnimation } from './spritePortraitAnimation';

/** Rendered size of the portrait canvas in CSS pixels. */
const PORTRAIT_SIZE_CSS_PX = 80;

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
export { DIALOGUE_PORTRAIT_OPTIONS };

export class DialogueOverlayRenderer {
  private readonly _panel: HTMLDivElement;
  private readonly _portraitCanvas: HTMLCanvasElement;
  private readonly _titleEl: HTMLParagraphElement;
  private readonly _textEl: HTMLParagraphElement;
  private readonly _continueEl: HTMLParagraphElement;
  private readonly _textWrapper: HTMLDivElement;
  private _isVisible: boolean = false;
  private _currentPortraitId: string = 'none';
  private readonly _spritePortraitAnimation: SpritePortraitAnimation;

  constructor(uiRoot: HTMLElement) {
    if (!document.getElementById('dialogue-blink-style')) {
      const style = document.createElement('style');
      style.id = 'dialogue-blink-style';
      style.textContent = BLINK_KEYFRAMES;
      document.head.appendChild(style);
    }

    this._panel = document.createElement('div');
    this._panel.style.cssText = PANEL_CSS;
    this._panel.style.display = 'none';

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
    const portraitCtx = this._portraitCanvas.getContext('2d');
    if (portraitCtx === null) throw new Error('Unable to create dialogue portrait canvas');
    this._spritePortraitAnimation = new SpritePortraitAnimation(this._portraitCanvas, portraitCtx);

    this._textWrapper = document.createElement('div');
    this._textWrapper.style.cssText = TEXT_AREA_CSS;

    this._titleEl = document.createElement('p');
    this._titleEl.style.cssText = TITLE_CSS;

    this._textEl = document.createElement('p');
    this._textEl.style.cssText = TEXT_CSS;

    this._continueEl = document.createElement('p');
    this._continueEl.style.cssText = CONTINUE_CSS;
    this._continueEl.textContent = 'v';

    this._textWrapper.appendChild(this._titleEl);
    this._textWrapper.appendChild(this._textEl);
    this._textWrapper.appendChild(this._continueEl);

    this._panel.appendChild(this._portraitCanvas);
    this._panel.appendChild(this._textWrapper);

    uiRoot.appendChild(this._panel);
  }

  get isVisible(): boolean {
    return this._isVisible;
  }

  show(entry: DialogueEntry, title?: string, isLastEntry?: boolean): void {
    const isRight = entry.portraitSide === 'right';
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

  hide(): void {
    this._spritePortraitAnimation.stop();
    this._panel.style.display = 'none';
    this._isVisible = false;
  }

  destroy(): void {
    this._spritePortraitAnimation.stop();
    if (this._panel.parentElement) {
      this._panel.parentElement.removeChild(this._panel);
    }
  }

  private _drawPortrait(portraitId: string): void {
    this._spritePortraitAnimation.stop();
    this._currentPortraitId = portraitId;
    const canvas = this._portraitCanvas;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (portraitId === 'none') {
      ctx.fillStyle = 'rgba(18, 20, 36, 0.7)';
      ctx.fillRect(0, 0, w, h);
      return;
    }

    const option = getDialoguePortraitOption(portraitId);
    if (option !== undefined && option.url.length > 0) {
      const img = loadImg(option.url);
      if (isAnimatedSpritePortrait(portraitId)) {
        this._spritePortraitAnimation.start(isSpriteReady(img) ? img : null);
        if (!isSpriteReady(img)) {
          img.addEventListener('load', () => {
            if (this._currentPortraitId === portraitId) this._spritePortraitAnimation.setImage(img);
          }, { once: true });
        }
        return;
      }
      if (isSpriteReady(img)) {
        this._drawPortraitImage(ctx, img, w, h);
      } else {
        this._drawPortraitFallback(ctx, portraitId, w, h);
        img.addEventListener('load', () => {
          if (this._currentPortraitId === portraitId) this._drawPortrait(portraitId);
        }, { once: true });
      }
      return;
    }

    this._drawPortraitFallback(ctx, portraitId, w, h);
  }

  private _drawPortraitImage(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const scale = Math.max(canvasWidth / img.naturalWidth, canvasHeight / img.naturalHeight);
    const drawWidth = img.naturalWidth * scale;
    const drawHeight = img.naturalHeight * scale;
    const drawX = (canvasWidth - drawWidth) / 2;
    const drawY = (canvasHeight - drawHeight) / 2;

    ctx.fillStyle = 'rgba(10, 12, 24, 1)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
  }

  private _drawPortraitFallback(
    ctx: CanvasRenderingContext2D,
    portraitId: string,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const r = Math.min(cx, cy) - 4 * dpr;

    ctx.fillStyle = 'rgba(10, 12, 24, 1)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#556688';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx - r * 0.18, cy - r * 0.26, r * 0.48, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fill();

    const initials = portraitId.charAt(0).toUpperCase();
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
