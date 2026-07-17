export type RectResizeEdge = 'left' | 'right' | 'top' | 'bottom'
  | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
export interface EditableBlockRect { xBlock: number; yBlock: number; wBlock: number; hBlock: number }

export function hitTestRectResizeEdge(rect: EditableBlockRect, xBlock: number, yBlock: number, margin = 0.4): RectResizeEdge | null {
  const corners: Array<{ edge: RectResizeEdge; x: number; y: number }> = [
    { edge: 'topLeft', x: rect.xBlock, y: rect.yBlock },
    { edge: 'topRight', x: rect.xBlock + rect.wBlock, y: rect.yBlock },
    { edge: 'bottomLeft', x: rect.xBlock, y: rect.yBlock + rect.hBlock },
    { edge: 'bottomRight', x: rect.xBlock + rect.wBlock, y: rect.yBlock + rect.hBlock },
  ];
  for (const corner of corners) {
    if (Math.abs(xBlock - corner.x) <= margin && Math.abs(yBlock - corner.y) <= margin) return corner.edge;
  }
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
  minWidthBlocks = 1,
  minHeightBlocks = 1,
): EditableBlockRect {
  const right = original.xBlock + original.wBlock;
  const bottom = original.yBlock + original.hBlock;
  let xBlock = original.xBlock;
  let yBlock = original.yBlock;
  let wBlock = original.wBlock;
  let hBlock = original.hBlock;
  if (edge === 'left' || edge === 'topLeft' || edge === 'bottomLeft') {
    xBlock = Math.max(0, Math.min(Math.floor(cursorXBlock), right - minWidthBlocks));
    wBlock = right - xBlock;
  } else if (edge === 'right' || edge === 'topRight' || edge === 'bottomRight') {
    wBlock = Math.max(minWidthBlocks, Math.min(roomWidthBlocks, Math.floor(cursorXBlock)) - xBlock);
  }
  if (edge === 'top' || edge === 'topLeft' || edge === 'topRight') {
    yBlock = Math.max(0, Math.min(Math.floor(cursorYBlock), bottom - minHeightBlocks));
    hBlock = bottom - yBlock;
  } else if (edge === 'bottom' || edge === 'bottomLeft' || edge === 'bottomRight') {
    hBlock = Math.max(minHeightBlocks, Math.min(roomHeightBlocks, Math.floor(cursorYBlock)) - yBlock);
  }
  return { xBlock, yBlock, wBlock, hBlock };
}
