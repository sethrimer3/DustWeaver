/**
 * exportOutcome.ts — Pure helper for resolving the terminal export-progress
 * state once `exportCampaignWithProgress()` resolves.
 *
 * Split out from editorExport.ts (which pulls in Vite-only modules via
 * `import.meta.env` at import time) so it can be unit tested under plain
 * `node:test` without a bundler.
 */

/** Subset of `ExportProgressEvent` that `resolveExportOutcomeEvent` can produce. */
export interface ExportOutcomeEvent {
  step: 'complete' | 'error' | 'cancelled';
  message: string;
  writtenRooms?: number;
  skippedRooms?: number;
}

/** Shape of the resolved value of `exportCampaignWithProgress()`. */
export interface ExportOutcomeResult {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
  writtenRooms?: number;
  skippedRooms?: number;
  removedCount?: number;
}

/**
 * Derives the terminal `ExportProgressEvent` that should be applied to the
 * progress modal once `exportCampaignWithProgress()` resolves, given whether
 * the modal already reached a terminal state via a live progress event.
 *
 * The final 'complete'/'error' progress event sent by the main process and
 * the resolved IPC result both report completion, and their relative arrival
 * order at the renderer isn't guaranteed. Whichever arrives second must not
 * be discarded (leaving the modal stuck showing stale progress) or
 * double-applied (e.g. resetting the auto-dismiss timer twice).
 *
 * @param alreadySettled  True if a 'complete' or 'error' progress event was
 *                        already observed for this export.
 * @param result          The resolved value of `exportCampaignWithProgress()`.
 * @returns  The event to apply to the modal, or `null` if the modal is
 *           already in a terminal state and nothing further should happen.
 */
export function resolveExportOutcomeEvent(
  alreadySettled: boolean,
  result: ExportOutcomeResult,
): ExportOutcomeEvent | null {
  if (alreadySettled) return null;

  if (result.ok) {
    const written = result.writtenRooms ?? 0;
    const skipped = result.skippedRooms ?? 0;
    const removed = result.removedCount ?? 0;
    const message = `Export complete — ${written} room(s) written, ${skipped} unchanged` +
      (removed > 0 ? `, ${removed} stale file(s) removed` : '');
    return { step: 'complete', message, writtenRooms: written, skippedRooms: skipped };
  }

  if (result.cancelled) {
    return { step: 'cancelled', message: result.error ?? 'Export cancelled' };
  }

  return { step: 'error', message: `Export failed: ${result.error ?? 'Unknown error'}` };
}
