/**
 * editorExportProgressModal.ts — Non-blocking export progress modal.
 *
 * Shown during an Electron campaign export to give the user real-time
 * feedback while the main process writes files asynchronously.
 *
 * Usage:
 *   const modal = createExportProgressModal(uiRoot);
 *   modal.update({ step: 'serializing', message: 'Serializing campaign...' });
 *   // ... receive IPC progress events ...
 *   modal.destroy();
 */

import type { ExportProgressEvent } from '../levels/roomCacheManifest';
import { PANEL_BG, PANEL_BORDER, TEXT_COLOR, GREEN } from './editorStyles';

// ── Public interface ──────────────────────────────────────────────────────────

export interface ExportProgressModal {
  /** Update the modal to reflect a new progress event. */
  update(event: ExportProgressEvent): void;
  /** Remove the modal from the DOM. Safe to call multiple times. */
  destroy(): void;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Creates and appends a progress modal to `root`.
 * The modal blocks interaction with the editor while export is in progress.
 * Call `destroy()` to remove it once the export resolves.
 */
export function createExportProgressModal(root: HTMLElement): ExportProgressModal {
  // ── Backdrop ─────────────────────────────────────────────────────────────
  const backdrop = document.createElement('div');
  backdrop.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
    'background:rgba(0,0,0,0.75)', 'z-index:3000',
    'display:flex', 'align-items:center', 'justify-content:center',
    'pointer-events:auto',
  ].join(';');

  // ── Panel ─────────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.style.cssText = [
    `background:${PANEL_BG}`,
    `border:1px solid ${PANEL_BORDER}`,
    'border-radius:8px',
    'padding:28px 36px',
    'display:flex',
    'flex-direction:column',
    'align-items:stretch',
    'gap:14px',
    `font-family:'Cinzel',monospace`,
    'min-width:340px',
    'max-width:500px',
    'box-shadow:0 0 40px rgba(0,0,0,0.9)',
  ].join(';');
  backdrop.appendChild(panel);

  // ── Title ─────────────────────────────────────────────────────────────────
  const titleEl = document.createElement('div');
  titleEl.textContent = '📦 Exporting Campaign';
  titleEl.style.cssText = `font-size:15px;font-weight:bold;color:${GREEN};letter-spacing:0.05em;`;
  panel.appendChild(titleEl);

  // ── Status text ───────────────────────────────────────────────────────────
  const statusEl = document.createElement('div');
  statusEl.textContent = 'Preparing…';
  statusEl.style.cssText = `font-size:12px;color:${TEXT_COLOR};min-height:18px;`;
  panel.appendChild(statusEl);

  // ── Progress bar container ────────────────────────────────────────────────
  const barContainer = document.createElement('div');
  barContainer.style.cssText = [
    'width:100%', 'height:10px',
    'background:rgba(255,255,255,0.08)',
    'border-radius:5px',
    'overflow:hidden',
  ].join(';');

  const barFill = document.createElement('div');
  barFill.style.cssText = [
    'height:100%',
    'width:0%',
    `background:${GREEN}`,
    'border-radius:5px',
    'transition:width 0.15s ease',
  ].join(';');
  barContainer.appendChild(barFill);
  panel.appendChild(barContainer);

  // ── Secondary detail line (room count etc.) ───────────────────────────────
  const detailEl = document.createElement('div');
  detailEl.style.cssText = 'font-size:11px;color:rgba(192,255,208,0.55);min-height:14px;';
  panel.appendChild(detailEl);

  // ── Append to root ────────────────────────────────────────────────────────
  root.appendChild(backdrop);

  // ── Auto-dismiss handle ───────────────────────────────────────────────────
  let autoDismissHandle: ReturnType<typeof setTimeout> | null = null;

  // ── Update logic ──────────────────────────────────────────────────────────
  function update(event: ExportProgressEvent): void {
    statusEl.textContent = event.message;

    if (event.step === 'exporting-room' && event.roomIndex !== undefined && event.totalRooms !== undefined) {
      const pct = Math.round((event.roomIndex / event.totalRooms) * 100);
      barFill.style.width = `${pct}%`;
      detailEl.textContent = `${event.roomIndex} / ${event.totalRooms} rooms`;
    } else if (event.step === 'complete') {
      barFill.style.width = '100%';
      const written = event.writtenRooms ?? 0;
      const skipped = event.skippedRooms ?? 0;
      detailEl.textContent = `${written} written, ${skipped} unchanged`;
      // Show success colouring.
      titleEl.textContent = '✅ Export Complete';
      titleEl.style.color = '#44ff88';
      // Auto-dismiss after 2 seconds on success.
      autoDismissHandle = setTimeout(() => destroy(), 2000);
    } else if (event.step === 'error') {
      barFill.style.background = '#ff4422';
      barFill.style.width = '100%';
      titleEl.textContent = '❌ Export Failed';
      titleEl.style.color = '#ff6644';
      detailEl.textContent = '';
      // Add a dismiss button so the user can close the error.
      addDismissButton();
    } else if (event.step === 'writing-manifest' || event.step === 'cleaning-stale') {
      barFill.style.width = '95%';
      detailEl.textContent = '';
    } else if (event.step === 'serializing' || event.step === 'writing-campaign') {
      barFill.style.width = '5%';
      detailEl.textContent = '';
    }
  }

  let dismissAdded = false;
  function addDismissButton(): void {
    if (dismissAdded) return;
    dismissAdded = true;
    const btn = document.createElement('button');
    btn.textContent = 'Close';
    btn.style.cssText = [
      'margin-top:8px', 'padding:8px 24px', 'align-self:center',
      'font-size:12px', `font-family:'Cinzel',monospace`,
      'cursor:pointer', 'border-radius:4px',
      'background:rgba(100,30,20,0.6)', 'color:#ff6644',
      'border:1.5px solid #ff6644',
    ].join(';');
    btn.addEventListener('click', () => destroy());
    panel.appendChild(btn);
  }

  function destroy(): void {
    if (autoDismissHandle !== null) {
      clearTimeout(autoDismissHandle);
      autoDismissHandle = null;
    }
    if (backdrop.parentElement) {
      backdrop.parentElement.removeChild(backdrop);
    }
  }

  return { update, destroy };
}
