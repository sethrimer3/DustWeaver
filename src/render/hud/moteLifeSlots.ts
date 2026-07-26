export const MOTE_LIFE_SLOT_SIZE_PX = 10;
export const MOTE_LIFE_SLOT_WIDTH_PX = 10;
export const MOTE_LIFE_SLOT_HEIGHT_PX = 10;
export const MOTE_LIFE_SLOT_GAP_PX = 2;
export const MOTE_LIFE_SLOT_ROWS = 2;
export const MOTE_LIFE_ORIGIN_X_PX = 8;
export const MOTE_LIFE_ORIGIN_Y_PX = 8;

export interface MoteLifeSlotPosition {
  column: number;
  row: number;
  xPx: number;
  yPx: number;
}

/** Column-major layout: top, bottom, then the next column to the right. */
export function getMoteLifeSlotPosition(slotIndex: number): MoteLifeSlotPosition {
  const safeIndex = Math.max(0, Math.floor(slotIndex));
  const column = Math.floor(safeIndex / MOTE_LIFE_SLOT_ROWS);
  const row = safeIndex % MOTE_LIFE_SLOT_ROWS;
  return {
    column,
    row,
    xPx: MOTE_LIFE_ORIGIN_X_PX + column * (MOTE_LIFE_SLOT_WIDTH_PX + MOTE_LIFE_SLOT_GAP_PX),
    yPx: MOTE_LIFE_ORIGIN_Y_PX + row * (MOTE_LIFE_SLOT_HEIGHT_PX + MOTE_LIFE_SLOT_GAP_PX),
  };
}

export function getMoteLifeColumnCount(maxMoteCapacity: number): number {
  if (!Number.isFinite(maxMoteCapacity) || maxMoteCapacity <= 0) return 0;
  return Math.ceil(Math.floor(maxMoteCapacity) / MOTE_LIFE_SLOT_ROWS);
}
