/**
 * Centralized loading and animation controller for Dust Container and Shard Container sprites.
 * Provides randomly crossfaded frame transitions for active (filled) dust containers both
 * on the game HUD and inside inventory loadout DOM elements.
 */

import { loadImg, isSpriteReady } from '../imageCache';

const ANIM_FRAME_COUNT = 10;

let _emptyImg: HTMLImageElement | undefined;
let _fullFallbackImg: HTMLImageElement | undefined;
let _animFrames: HTMLImageElement[] | undefined;
let _shardImgs: HTMLImageElement[] | undefined;

export function getDustContainerEmptyImg(): HTMLImageElement {
  if (_emptyImg === undefined) {
    _emptyImg = loadImg('SPRITES/DUST/DustContainer/DustContainerFrame_Empty.png');
  }
  return _emptyImg;
}

export function getDustContainerFullImg(): HTMLImageElement {
  if (_fullFallbackImg === undefined) {
    _fullFallbackImg = loadImg('SPRITES/DUST/DustContainer/DustContainerFrame_Full.png');
  }
  return _fullFallbackImg;
}

export function getDustContainerAnimFrame(frameIndex: number): HTMLImageElement {
  if (_animFrames === undefined) {
    _animFrames = [];
    for (let i = 1; i <= ANIM_FRAME_COUNT; i++) {
      _animFrames.push(loadImg(`SPRITES/DUST/DustContainer/Animation/DustContainerAnimation_Frame (${i}).png`));
    }
  }
  const safeIdx = ((Math.floor(frameIndex) % ANIM_FRAME_COUNT) + ANIM_FRAME_COUNT) % ANIM_FRAME_COUNT;
  return _animFrames[safeIdx];
}

export function getShardContainerImg(shardCount: number): HTMLImageElement {
  if (_shardImgs === undefined) {
    _shardImgs = [
      loadImg('SPRITES/DUST/ShardContainer/ShardContainer_Empty.png'),
      loadImg('SPRITES/DUST/ShardContainer/ShardContainer_OneShard.png'),
      loadImg('SPRITES/DUST/ShardContainer/ShardContainer_TwoShards.png'),
      loadImg('SPRITES/DUST/ShardContainer/ShardContainer_ThreeShards.png'),
    ];
  }
  const safeCount = Math.max(0, Math.min(3, Math.floor(shardCount)));
  return _shardImgs[safeCount];
}

interface SlotAnimState {
  currentFrame: number;
  targetFrame: number;
  startMs: number;
  durationMs: number;
}

const _slotStates = new Map<number, SlotAnimState>();

/**
 * Renders a dust container slot onto a canvas context, applying a smooth randomized
 * crossfade between animation frames when the slot is filled.
 */
export function drawAnimatedDustContainer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  isFilled: boolean,
  slotIndex: number,
  nowMs: number,
): void {
  if (!isFilled) {
    const emptyImg = getDustContainerEmptyImg();
    if (isSpriteReady(emptyImg)) {
      ctx.drawImage(emptyImg, x, y, w, h);
    } else {
      // Fallback rectangle while loading image
      ctx.fillStyle = 'rgba(12,10,7,0.88)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(105,82,35,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    return;
  }

  let state = _slotStates.get(slotIndex);
  if (state === undefined || nowMs < state.startMs - 2000) {
    const initialFrame = Math.abs(Math.floor(slotIndex * 3)) % ANIM_FRAME_COUNT;
    let targetFrame = (initialFrame + 1 + Math.floor(Math.random() * (ANIM_FRAME_COUNT - 1))) % ANIM_FRAME_COUNT;
    if (targetFrame === initialFrame) targetFrame = (targetFrame + 1) % ANIM_FRAME_COUNT;
    state = {
      currentFrame: initialFrame,
      targetFrame,
      startMs: nowMs,
      durationMs: 400 + Math.floor(Math.random() * 400),
    };
    _slotStates.set(slotIndex, state);
  }

  if (nowMs >= state.startMs + state.durationMs) {
    state.currentFrame = state.targetFrame;
    let next = Math.floor(Math.random() * ANIM_FRAME_COUNT);
    if (next === state.currentFrame) next = (next + 1) % ANIM_FRAME_COUNT;
    state.targetFrame = next;
    state.startMs = nowMs;
    state.durationMs = 400 + Math.floor(Math.random() * 400);
  }

  const t = Math.max(0, Math.min(1, (nowMs - state.startMs) / state.durationMs));
  const imgA = getDustContainerAnimFrame(state.currentFrame);
  const imgB = getDustContainerAnimFrame(state.targetFrame);

  const readyA = isSpriteReady(imgA);
  const readyB = isSpriteReady(imgB);

  if (readyA && readyB) {
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.drawImage(imgA, x, y, w, h);
    ctx.globalAlpha = t;
    ctx.drawImage(imgB, x, y, w, h);
    ctx.restore();
  } else if (readyA) {
    ctx.drawImage(imgA, x, y, w, h);
  } else {
    const fallback = getDustContainerFullImg();
    if (isSpriteReady(fallback)) {
      ctx.drawImage(fallback, x, y, w, h);
    } else {
      // Fallback rectangle while loading image
      ctx.fillStyle = 'rgba(92,65,8,0.96)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#d4a84b';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = '#ffd85a';
      ctx.fillRect(x + 2, y + 2, Math.max(1, w - 4), Math.max(1, h - 4));
    }
  }
}

/**
 * Initiates a real-time requestAnimationFrame loop on a DOM canvas element in menus,
 * running the randomized crossfade animation. Returns a cleanup callback to cancel the loop.
 */
export function startDustContainerCanvasAnimation(
  canvas: HTMLCanvasElement,
  isFilled: boolean,
  slotIndex: number,
): () => void {
  const ctxOrNull = canvas.getContext('2d');
  if (ctxOrNull === null) return () => { /* no-op */ };
  const ctx = ctxOrNull;

  let rafId = 0;
  let running = true;

  function frame(): void {
    if (!running) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAnimatedDustContainer(ctx, 0, 0, canvas.width, canvas.height, isFilled, slotIndex, performance.now());
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);

  return () => {
    running = false;
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}
