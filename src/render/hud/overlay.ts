/**
 * HUD overlay renderer.
 *
 * Draws the performance counters (FPS, frame time, particle count) and an
 * optional movement debug panel driven by HudDebugState.  The debug panel is
 * omitted when the `debug` field is absent from HudState, so it can be
 * removed by simply not populating it in gameScreen.ts.
 *
 * When debug mode is on a second panel (the render profiler) is drawn in the
 * top-right corner by delegating to RenderProfiler.drawOverlay().
 */

import type { RenderProfiler } from './renderProfiler';

/** Optional per-tick player movement debug data shown in the debug panel. */
export interface HudDebugState {
  isGrounded: boolean;
  isStandingOnSurface: boolean;
  coyoteTimeTicks: number;
  jumpBufferTicks: number;
  isWallSlidingFlag: boolean;
  isTouchingWallLeft: boolean;
  isTouchingWallRight: boolean;
  wallJumpLockoutTicks: number;
  isGrappleActive: boolean;
  grappleLengthWorld: number;
  grapplePullInAmountWorld: number;
  isGrappleMissActive: boolean;
  grappleParticleStartIndex: number;
  isGrappleChainHiddenFlag: boolean;
  isSkidding: boolean;
  isSliding: boolean;
  isSprinting: boolean;
  inputUp: boolean;
  inputLeft: boolean;
  inputRight: boolean;
  inputDown: boolean;
  inputShift: boolean;
  inputLeftClick: boolean;
  inputRightClick: boolean;
  inputGrapple: boolean;
  inputInteract: boolean;
}

export interface HudState {
  fps: number;
  frameTimeMs: number;
  particleCount: number;
  /** When present, a movement debug panel is drawn below the performance counters. */
  debug?: HudDebugState;
}

export function renderHudOverlay(
  ctx: CanvasRenderingContext2D,
  hud: HudState,
  renderProfiler?: RenderProfiler,
  virtualWidthPx?: number,
  isDebugMode?: boolean,
): void {
  const perfLines = [
    `FPS: ${hud.fps.toFixed(1)}`,
    `Frame: ${hud.frameTimeMs.toFixed(2)}ms`,
    `Particles: ${hud.particleCount}`,
  ];

  let debugLines: string[] = [];
  if (hud.debug !== undefined) {
    const d = hud.debug;
    debugLines = [
      `Grounded: ${d.isGrounded ? 'Y' : 'N'}`,
      `OnSurface: ${d.isStandingOnSurface ? 'Y' : 'N'}`,
      `Coyote:   ${d.coyoteTimeTicks}t`,
      `JumpBuf:  ${d.jumpBufferTicks}t`,
      `WallL/R:  ${d.isTouchingWallLeft ? 'L' : '-'}${d.isTouchingWallRight ? 'R' : '-'}` +
        `  Slide:${d.isWallSlidingFlag ? 'Y' : 'N'}`,
      `WallLock: ${d.wallJumpLockoutTicks}t`,
      `Sprint:${d.isSprinting ? 'Y' : 'N'} Skid:${d.isSkidding ? 'Y' : 'N'} Sld:${d.isSliding ? 'Y' : 'N'}`,
      `Grapple:  ${d.isGrappleActive ? `len=${d.grappleLengthWorld.toFixed(0)} pull=${d.grapplePullInAmountWorld.toFixed(0)}` : 'off'}`,
      `GrpMiss:${d.isGrappleMissActive ? 'Y' : 'N'} pIdx=${d.grappleParticleStartIndex} chain=${d.isGrappleChainHiddenFlag ? 'hidden' : 'visible'}`,
      `Input U/L/R/D/Sh: ${d.inputUp ? 'U' : '-'}${d.inputLeft ? 'L' : '-'}${d.inputRight ? 'R' : '-'}${d.inputDown ? 'D' : '-'}${d.inputShift ? 'S' : '-'}`,
      `Input M1/M2: ${d.inputLeftClick ? 'M1' : '--'}/${d.inputRightClick ? 'M2' : '--'}`,
      `Input Grap/Int: ${d.inputGrapple ? 'G' : '-'} / ${d.inputInteract ? 'I' : '-'}`,
    ];
  }

  const allLines = [...perfLines, ...debugLines];

  const padXPx    = 8;
  const padYPx    = 8;
  const lineHeightPx = 9;
  const fontSizePx   = 7;
  const panelWidth   = 180;

  ctx.save();
  ctx.font = `${fontSizePx}px monospace`;

  // Background panel
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(padXPx - 4, padYPx - 4, panelWidth, allLines.length * lineHeightPx + 8);

  // Performance lines in green
  ctx.fillStyle = '#00ff99';
  for (let i = 0; i < perfLines.length; i++) {
    ctx.fillText(perfLines[i], padXPx, padYPx + fontSizePx + i * lineHeightPx);
  }

  // Debug lines in yellow (visually distinct from perf counters)
  if (debugLines.length > 0) {
    ctx.fillStyle = '#ffd23c';
    for (let i = 0; i < debugLines.length; i++) {
      const y = padYPx + fontSizePx + (perfLines.length + i) * lineHeightPx;
      ctx.fillText(debugLines[i], padXPx, y);
    }
  }

  ctx.restore();

  // Render-stage profiler panel (top-right corner, debug only).
  if (renderProfiler !== undefined && virtualWidthPx !== undefined && isDebugMode === true) {
    renderProfiler.drawOverlay(ctx, virtualWidthPx, true);
  }
}

