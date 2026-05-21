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
import type { DebugPanelVisibility } from '../../ui/debugPanelManager';
import { isPanelVisible } from '../../ui/debugPanelManager';

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
  /** True when the zip is currently active (player zipping toward anchor). */
  isGrappleZipActive: boolean;
  /** True while the player is stuck at the zip endpoint. */
  isGrappleStuck: boolean;
  /** True if the player has physically reached the zip surface this zip session. */
  hasZipImpactedSurface: boolean;
  /** Ticks remaining in the zip-jump window (0 = expired or not in window). */
  zipJumpWindowTicksLeft: number;
  /** Current grapple input mode: 0=Hold, 1=Toggle. */
  grappleInputMode: number;
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
  // ── Water / buoyancy debug ────────────────────────────────────────────────
  isInLiquid: boolean;
  submergedFraction: number;
  liquidSurfaceYWorld: number;
  depthFactor: number;
  /** Buoyancy acceleration applied this tick (wu/s²). */
  buoyancyAccelWorldPerSec2: number;
  /** Effective gravity scale applied in water this tick (fraction of normal gravity). */
  gravityScale: number;
  /** Player vertical velocity (wu/s); negative = upward. */
  playerVelocityYWorld: number;
  // ── Wall jump / slide diagnostic (movement panel) ─────────────────────────
  /** Which wall side is being reported: 'left', 'right', or 'none'. */
  wallDbgSide: 'left' | 'right' | 'none';
  /** Height of the individual wall partition the player is contacting (world units). */
  wallDbgRawPartHeightWorld: number;
  /** Height of the aggregated logical wall surface (world units). */
  wallDbgLogicalWallHeightWorld: number;
  /** Player feet Y used as the wall contact point (world units). */
  wallDbgContactYWorld: number;
  /** True when a ground-connected floor was found at the base of the wall. */
  wallDbgGroundFloor: boolean;
  /** Top Y of the bottom exclusion zone (world units; 0 when no floor). */
  wallDbgExclusionMinY: number;
  /** Bottom Y of the bottom exclusion zone = floor top (world units; 0 when no floor). */
  wallDbgExclusionMaxY: number;
  /** True when the player contact Y is inside the ground-connected exclusion zone. */
  wallDbgContactInExclusion: boolean;
  /** True when a wall jump is currently allowed from the checked side. */
  wallDbgJumpAllowed: boolean;
  /** True when wall sliding is currently allowed from the checked side. */
  wallDbgSlideAllowed: boolean;
  /** True when wall slide is suppressed specifically because the surface is too short (< 3 blocks). */
  wallDbgSlideSuppressedShort: boolean;
  /** True when wall jump or slide is suppressed because the contact is inside the bottom exclusion zone. */
  wallDbgActionSuppressedExclusion: boolean;
  /**
   * Lateral-sample detected adjacent floor top Y (world units).
   * `Infinity` when no floor was detected beside the face.
   * Shows which Y level the system identified as ground-connected via the
   * lateral solid-occupancy query in `computeGroundConnectedExclusion`.
   */
  wallDbgAdjacentFloorTopY: number;
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
  panelVisibility?: DebugPanelVisibility,
): void {
  // When panelVisibility is provided, each section is shown only when its
  // flag is true.  When undefined (e.g. legacy callers), all sections show.
  const showPerf       = isPanelVisible('performance', panelVisibility);
  const showParticles  = isPanelVisible('particles',   panelVisibility);
  const showMovement   = isPanelVisible('movement',    panelVisibility);
  const showGrapple    = isPanelVisible('grapple',     panelVisibility);
  const showWater      = isPanelVisible('water',       panelVisibility);

  // ── Top "green" lines: performance counters ──────────────────────────────
  const perfLines: string[] = [];
  if (showPerf) {
    perfLines.push(`FPS: ${hud.fps.toFixed(1)}`);
    perfLines.push(`Frame: ${hud.frameTimeMs.toFixed(2)}ms`);
  }
  if (showParticles) {
    perfLines.push(`Particles: ${hud.particleCount}`);
  }

  // ── Debug lines (yellow) split by panel ──────────────────────────────────
  const debugLines: string[] = [];
  if (hud.debug !== undefined) {
    const d = hud.debug;

    if (showMovement) {
      debugLines.push(
        `Grounded: ${d.isGrounded ? 'Y' : 'N'}`,
        `OnSurface: ${d.isStandingOnSurface ? 'Y' : 'N'}`,
        `Coyote:   ${d.coyoteTimeTicks}t`,
        `JumpBuf:  ${d.jumpBufferTicks}t`,
        `WallL/R:  ${d.isTouchingWallLeft ? 'L' : '-'}${d.isTouchingWallRight ? 'R' : '-'}` +
          `  Slide:${d.isWallSlidingFlag ? 'Y' : 'N'}`,
        `WallLock: ${d.wallJumpLockoutTicks}t`,
        `Sprint:${d.isSprinting ? 'Y' : 'N'} Skid:${d.isSkidding ? 'Y' : 'N'} Sld:${d.isSliding ? 'Y' : 'N'}`,
        `Input U/L/R/D/Sh: ${d.inputUp ? 'U' : '-'}${d.inputLeft ? 'L' : '-'}${d.inputRight ? 'R' : '-'}${d.inputDown ? 'D' : '-'}${d.inputShift ? 'S' : '-'}`,
        `Input M1/M2: ${d.inputLeftClick ? 'M1' : '--'}/${d.inputRightClick ? 'M2' : '--'}`,
        // ── Wall eligibility diagnostics ─────────────────────────────────
        `WallSide: ${d.wallDbgSide}  RawH:${d.wallDbgRawPartHeightWorld.toFixed(0)}wu`,
        `LogicalH:${d.wallDbgLogicalWallHeightWorld.toFixed(0)}wu  ContactY:${d.wallDbgContactYWorld.toFixed(0)}`,
        `GndFloor:${d.wallDbgGroundFloor ? 'Y' : 'N'}  FLY:${Number.isFinite(d.wallDbgAdjacentFloorTopY) ? d.wallDbgAdjacentFloorTopY.toFixed(0) : '∞'}  ExclY:[${d.wallDbgExclusionMinY.toFixed(0)},${d.wallDbgExclusionMaxY.toFixed(0)}]`,
        `InExcl:${d.wallDbgContactInExclusion ? 'Y' : 'N'}  Jump:${d.wallDbgJumpAllowed ? 'OK' : 'NO'}  Slide:${d.wallDbgSlideAllowed ? 'OK' : 'NO'}`,
        `SlideShort:${d.wallDbgSlideSuppressedShort ? 'Y' : 'N'}  ExclSuppr:${d.wallDbgActionSuppressedExclusion ? 'Y' : 'N'}`,
      );
    }

    if (showGrapple) {
      debugLines.push(
        `Grapple:  ${d.isGrappleActive ? `len=${d.grappleLengthWorld.toFixed(0)} pull=${d.grapplePullInAmountWorld.toFixed(0)}` : 'off'}`,
        `GrpMiss:${d.isGrappleMissActive ? 'Y' : 'N'} pIdx=${d.grappleParticleStartIndex} chain=${d.isGrappleChainHiddenFlag ? 'hidden' : 'visible'}`,
        `Zip:${d.isGrappleZipActive ? (d.hasZipImpactedSurface ? 'ZIPPING(impacted)' : 'ZIPPING') : (d.isGrappleStuck ? `STUCK win=${d.zipJumpWindowTicksLeft}t` : 'off')} mode=${d.grappleInputMode === 0 ? 'Hold' : 'Toggle'}`,
        `Input Grap/Int: ${d.inputGrapple ? 'G' : '-'} / ${d.inputInteract ? 'I' : '-'}`,
      );
    }

    if (showWater) {
      debugLines.push(
        `Water: ${d.isInLiquid ? 'IN' : 'OUT'} sub=${d.submergedFraction.toFixed(2)} df=${d.depthFactor.toFixed(2)}`,
        `Buoy: ${d.buoyancyAccelWorldPerSec2.toFixed(1)}wu/s² gScale=${d.gravityScale.toFixed(2)} velY=${d.playerVelocityYWorld.toFixed(1)}`,
        `LiqSurf: ${d.liquidSurfaceYWorld.toFixed(1)}`,
      );
    }
  }

  const allLines = [...perfLines, ...debugLines];

  const padXPx    = 8;
  const padYPx    = 8;
  const lineHeightPx = 9;
  const fontSizePx   = 7;
  const panelWidth   = 180;

  ctx.save();
  ctx.font = `${fontSizePx}px monospace`;

  if (allLines.length > 0) {
    // Background panel
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(padXPx - 4, padYPx - 4, panelWidth, allLines.length * lineHeightPx + 8);

    // Performance / particle lines in green
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
  }

  ctx.restore();

  // Render-stage profiler panel (top-right corner, debug only).
  if (renderProfiler !== undefined && virtualWidthPx !== undefined && isDebugMode === true) {
    renderProfiler.drawOverlay(ctx, virtualWidthPx, true, panelVisibility);
  }
}

