/**
 * Pure formatting/signature helpers for the editor UI's room-density
 * indicator (editorUI.ts). Split out so the "only touch the DOM when the
 * displayed values change" logic is testable without a DOM or Vite's
 * import.meta.env (editorUI.ts itself can't be imported outside a Vite/
 * browser context, so this needs to live in its own plain module).
 */

import type { RoomComplexitySeverity } from '../levels/roomComplexity';

/** One string per distinct combination of displayed values — changes iff the rendered text would change. */
export function computeDensityDisplaySignature(
  hasRoom: boolean,
  totalPlacedCount: number,
  severity: RoomComplexitySeverity,
  topCategoryLabel: string,
): string {
  if (!hasRoom) return '';
  return `${totalPlacedCount}|${severity}|${topCategoryLabel}`;
}

export function capitalizeSeverity(severity: RoomComplexitySeverity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export function formatDensityTotalLine(totalPlacedCount: number): string {
  return `Room density: ${totalPlacedCount.toLocaleString()} elements`;
}

export function formatDensitySuffixLine(topCategoryLabel: string): string {
  return ` — mostly ${topCategoryLabel}`;
}
