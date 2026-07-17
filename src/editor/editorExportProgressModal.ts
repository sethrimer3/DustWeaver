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

/** Steps that occur before any room has been written — shown with an indeterminate/pulsing bar. */
const INDETERMINATE_STEPS = new Set(['serializing', 'writing-campaign', 'writing-manifest', 'cleaning-stale']);

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Creates and appends a progress modal to `root`.
 * The modal blocks interaction with the editor while export is in progress.
 * Call `destroy()` to remove it once the export resolves.
 *
 * @param root      The DOM element to append the modal backdrop to.
 * @param title     Optional heading text. Defaults to `'📦 Exporting Campaign'`.
 *                  Pass a custom string when reusing the modal for non-export
 *                  contexts, e.g. `'🔄 Generating Room Cache'`.
 * @param onCancel  Optional callback invoked when the user clicks the Cancel
 *                  button shown while the export is in progress. When
 *                  omitted, no Cancel button is shown.
 */
export function createExportProgressModal(
  root: HTMLElement,
  title?: string,
  onCancel?: () => void,
): ExportProgressModal {
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
  titleEl.textContent = title ?? '📦 Exporting Campaign';
  titleEl.style.cssText = `font-size:15px;font-weight:bold;color:${GREEN};letter-spacing:0.05em;`;
  panel.appendChild(titleEl);

  // ── Row: status text + elapsed time ───────────────────────────────────────
  const statusRow = document.createElement('div');
  statusRow.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:12px;';
  panel.appendChild(statusRow);

  const statusEl = document.createElement('div');
  statusEl.textContent = 'Preparing…';
  statusEl.style.cssText = `font-size:12px;color:${TEXT_COLOR};min-height:18px;flex:1;`;
  statusRow.appendChild(statusEl);

  const elapsedEl = document.createElement('div');
  elapsedEl.style.cssText = 'font-size:11px;color:rgba(192,255,208,0.5);white-space:nowrap;';
  statusRow.appendChild(elapsedEl);

  // ── Progress bar container ────────────────────────────────────────────────
  const pulseAnimName = `dw-export-pulse-${Math.random().toString(36).slice(2)}`;
  const styleEl = document.createElement('style');
  styleEl.textContent = `@keyframes ${pulseAnimName} { 0% { transform: translateX(-100%); } 100% { transform: translateX(340%); } }`;
  panel.appendChild(styleEl);

  const barContainer = document.createElement('div');
  barContainer.style.cssText = [
    'width:100%', 'height:10px',
    'background:rgba(255,255,255,0.08)',
    'border-radius:5px',
    'overflow:hidden',
    'position:relative',
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

  // Indeterminate sweep shown before per-room progress is available, so the
  // bar always visibly conveys "still working" rather than sitting frozen.
  const pulseEl = document.createElement('div');
  pulseEl.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'width:25%', 'height:100%',
    'background:rgba(255,255,255,0.35)', 'border-radius:5px',
    `animation:${pulseAnimName} 1.1s ease-in-out infinite`,
    'display:none',
  ].join(';');
  barContainer.appendChild(pulseEl);
  panel.appendChild(barContainer);

  // ── Secondary detail line (room count etc.) ───────────────────────────────
  const detailEl = document.createElement('div');
  detailEl.style.cssText = 'font-size:11px;color:rgba(192,255,208,0.55);min-height:14px;';
  panel.appendChild(detailEl);

  // ── Cancel button (only while the export is still running) ───────────────
  let cancelBtn: HTMLButtonElement | null = null;
  if (onCancel !== undefined) {
    cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = [
      'margin-top:2px', 'padding:6px 20px', 'align-self:center',
      'font-size:12px', `font-family:'Cinzel',monospace`,
      'cursor:pointer', 'border-radius:4px',
      'background:rgba(255,255,255,0.06)', 'color:rgba(255,255,255,0.7)',
      'border:1.5px solid rgba(255,255,255,0.25)',
    ].join(';');
    cancelBtn.addEventListener('click', () => {
      if (cancelBtn === null) return;
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Cancelling…';
      onCancel();
    });
    panel.appendChild(cancelBtn);
  }

  // ── Append to root ────────────────────────────────────────────────────────
  root.appendChild(backdrop);

  // ── Auto-dismiss / elapsed-time handles ───────────────────────────────────
  let autoDismissHandle: ReturnType<typeof setTimeout> | null = null;
  const startedAtMs = Date.now();
  const elapsedTickHandle: ReturnType<typeof setInterval> = setInterval(() => {
    const secs = Math.floor((Date.now() - startedAtMs) / 1000);
    elapsedEl.textContent = secs < 1 ? '' : `${secs}s`;
  }, 1000);

  function removeCancelButton(): void {
    if (cancelBtn !== null && cancelBtn.parentElement) {
      cancelBtn.parentElement.removeChild(cancelBtn);
      cancelBtn = null;
    }
  }

  function setIndeterminate(active: boolean): void {
    pulseEl.style.display = active ? 'block' : 'none';
  }

  // ── Update logic ──────────────────────────────────────────────────────────
  function update(event: ExportProgressEvent): void {
    statusEl.textContent = event.message;
    setIndeterminate(INDETERMINATE_STEPS.has(event.step));

    if (event.step === 'exporting-room' && event.roomIndex !== undefined && event.totalRooms !== undefined) {
      const pct = Math.round((event.roomIndex / event.totalRooms) * 100);
      barFill.style.width = `${pct}%`;
      // Show count and percentage; the status line already shows the room name.
      const roomIdLabel = event.roomId !== undefined ? ` — ${event.roomId}` : '';
      detailEl.textContent = `${event.roomIndex} / ${event.totalRooms} rooms${roomIdLabel} (${pct}%)`;
    } else if (event.step === 'complete') {
      barFill.style.width = '100%';
      const written = event.writtenRooms ?? 0;
      const skipped = event.skippedRooms ?? 0;
      detailEl.textContent = `${written} written, ${skipped} unchanged`;
      // Show success colouring.  Use a generic label so the modal is reusable
      // for both editor exports and cache-generation contexts.
      titleEl.textContent = '✅ Complete';
      titleEl.style.color = '#44ff88';
      clearInterval(elapsedTickHandle);
      removeCancelButton();
      // Auto-dismiss after 2 seconds on success.
      autoDismissHandle = setTimeout(() => destroy(), 2000);
    } else if (event.step === 'cancelled') {
      barFill.style.background = 'rgba(255,255,255,0.3)';
      titleEl.textContent = '⏹ Export Cancelled';
      titleEl.style.color = 'rgba(255,255,255,0.7)';
      detailEl.textContent = '';
      clearInterval(elapsedTickHandle);
      removeCancelButton();
      addDismissButton();
    } else if (event.step === 'error') {
      barFill.style.background = '#ff4422';
      barFill.style.width = '100%';
      titleEl.textContent = '❌ Export Failed';
      titleEl.style.color = '#ff6644';
      detailEl.textContent = '';
      clearInterval(elapsedTickHandle);
      removeCancelButton();
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
    clearInterval(elapsedTickHandle);
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
