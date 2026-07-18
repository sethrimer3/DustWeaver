export type RectResizeEdge = 'left' | 'right' | 'top' | 'bottom';
export interface EditableBlockRect { xBlock: number; yBlock: number; wBlock: number; hBlock: number }

export function hitTestRectResizeEdge(rect: EditableBlockRect, xBlock: number, yBlock: number, margin = 0.4): RectResizeEdge | null {
  const candidates: Array<{ edge: RectResizeEdge; distance: number; inSpan: boolean }> = [
    { edge: 'left', distance: Math.abs(xBlock - rect.xBlock), inSpan: yBlock >= rect.yBlock - margin && yBlock <= rect.yBlock + rect.hBlock + margin },
    { edge: 'right', distance: Math.abs(xBlock - rect.xBlock - rect.wBlock), inSpan: yBlock >= rect.yBlock - margin && yBlock <= rect.yBlock + rect.hBlock + margin },
    { edge: 'top', distance: Math.abs(yBlock - rect.yBlock), inSpan: xBlock >= rect.xBlock - margin && xBlock <= rect.xBlock + rect.wBlock + margin },
    { edge: 'bottom', distance: Math.abs(yBlock - rect.yBlock - rect.hBlock), inSpan: xBlock >= rect.xBlock - margin && xBlock <= rect.xBlock + rect.wBlock + margin },
  ];
  let best: RectResizeEdge | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate.inSpan && candidate.distance <= margin && candidate.distance < bestDistance) {
      best = candidate.edge;
      bestDistance = candidate.distance;
    }
  }
  return best;
}

export function resizeBlockRect(
  original: EditableBlockRect,
  edge: RectResizeEdge,
  cursorXBlock: number,
  cursorYBlock: number,
  roomWidthBlocks: number,
  roomHeightBlocks: number,
): EditableBlockRect {
  const right = original.xBlock + original.wBlock;
  const bottom = original.yBlock + original.hBlock;
  let xBlock = original.xBlock;
  let yBlock = original.yBlock;
  let wBlock = original.wBlock;
  let hBlock = original.hBlock;
  if (edge === 'left') {
    xBlock = Math.max(0, Math.min(Math.floor(cursorXBlock), right - 1));
    wBlock = right - xBlock;
  } else if (edge === 'right') {
    wBlock = Math.max(1, Math.min(roomWidthBlocks, Math.floor(cursorXBlock)) - xBlock);
  } else if (edge === 'top') {
    yBlock = Math.max(0, Math.min(Math.floor(cursorYBlock), bottom - 1));
    hBlock = bottom - yBlock;
  } else {
    hBlock = Math.max(1, Math.min(roomHeightBlocks, Math.floor(cursorYBlock)) - yBlock);
  }
  return { xBlock, yBlock, wBlock, hBlock };
}
