/**
 * gameDustSelectionState.ts — Dust selection wheel state machine.
 *
 * Owns the wheel's open/closed/animating lifecycle and the currently
 * highlighted option. Deliberately holds no simulation truth: the actual
 * dust-type change is driven through `beginDustTypeSwitch` (sim/weaves/
 * dustTypeSwitch.ts) and persisted onto `PlayerProgress.selectedDustKind`.
 * This module is pure UI/input-timing state — it uses wall-clock timestamps
 * (`nowMs`, threaded from the same frame timestamp gameScreen already uses
 * for other cosmetic timers) and never touches the deterministic sim tick.
 *
 * `isOpen()` reflects whether the wheel should currently capture grapple/weave
 * input (true through the 'opening' and 'open' phases). The 'closing' phase
 * is purely a cosmetic fade/contract animation after a selection or
 * cancellation has already been committed — input arbitration in
 * gameCommandProcessor.ts does not wait for it.
 */

import type { WorldState } from '../sim/world';
import type { PlayerProgress } from '../progression/playerProgress';
import { ParticleKind } from '../sim/particles/kinds';
import {
  DustWheelOption,
  buildDustWheelOptions,
  isDustWheelEligible,
  resolveEffectiveSelectedDustKind,
  findNearestDustWheelOption,
} from '../sim/weaves/dustWheelOptions';
import { computeDustWheelAim } from '../input/dustWheelInput';
import { beginDustTypeSwitch, isDustTypeSwitchInProgress } from '../sim/weaves/dustTypeSwitch';

/** Duration (ms) of the outward expansion animation when the wheel opens. */
export const DUST_WHEEL_OPEN_ANIM_MS = 160;
/** Duration (ms) of the inward contraction + fade when the wheel closes. */
export const DUST_WHEEL_CLOSE_ANIM_MS = 130;

type DustWheelAnimPhase = 'closed' | 'opening' | 'open' | 'closing';

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/**
 * True when the player currently has enough unlocked dust kinds AND no
 * dust-switch transition is already running. The wheel becomes available
 * again automatically once every participating mote resolves.
 */
export function isDustWheelAvailable(world: WorldState, progress: PlayerProgress | undefined): boolean {
  return isDustWheelEligible(progress) && !isDustTypeSwitchInProgress(world);
}

export class DustSelectionWheelController {
  private phase: DustWheelAnimPhase = 'closed';
  private options: DustWheelOption[] = [];
  private animStartMs = 0;
  private activeKindAtOpen: ParticleKind | null = null;
  private highlightedKind: ParticleKind | null = null;
  /**
   * True from the moment a selection/cancellation closes the wheel until the
   * physical grapple-fire button (and right mouse / secondary weave button)
   * has returned to neutral. Prevents the same physical press that made the
   * selection from releasing into a stray GrappleRelease/WeaveEnd command on
   * a later frame once `isOpen()` has already gone false. Cleared by
   * `updateInputCaptureLatch`, which callers must poll every frame.
   */
  private inputCaptureLatchActive = false;

  /** True while the wheel should capture grapple/weave/attack input (opening or fully open). */
  isOpen(): boolean {
    return this.phase === 'opening' || this.phase === 'open';
  }

  /**
   * True while grapple/weave/attack input should still be captured/suppressed:
   * either the wheel is genuinely open, or the post-close input latch hasn't
   * cleared yet (the physical button used to select/cancel is still held).
   */
  shouldCaptureGrappleWeaveInput(): boolean {
    return this.isOpen() || this.inputCaptureLatchActive;
  }

  /**
   * Advances the input-capture latch. Call once per frame with the current
   * physical grapple-fire / secondary-weave button states; clears the latch
   * once both have returned to neutral.
   */
  updateInputCaptureLatch(isGrappleHeld: boolean, isRightMouseDown: boolean): void {
    if (this.inputCaptureLatchActive && !isGrappleHeld && !isRightMouseDown) {
      this.inputCaptureLatchActive = false;
    }
  }

  /** True once the close animation has fully finished and no state remains. */
  isFullyClosed(): boolean {
    return this.phase === 'closed';
  }

  getOptions(): readonly DustWheelOption[] {
    return this.options;
  }

  getActiveKindAtOpen(): ParticleKind | null {
    return this.activeKindAtOpen;
  }

  getHighlightedKind(): ParticleKind | null {
    return this.highlightedKind;
  }

  setHighlightedKind(kind: ParticleKind | null): void {
    this.highlightedKind = kind;
  }

  /**
   * Recomputes the highlighted option from a live aim point (mouse position,
   * touch position, or any other continuous aim source) relative to the
   * player's visual center. Safe to call every frame while open; a no-op
   * (clears the highlight) when not open.
   */
  updateHighlightFromAim(
    playerXWorld: number,
    playerYWorld: number,
    aimXWorld: number,
    aimYWorld: number,
  ): void {
    if (!this.isOpen()) {
      this.highlightedKind = null;
      return;
    }
    const aim = computeDustWheelAim(aimXWorld, aimYWorld, playerXWorld, playerYWorld);
    if (aim.isInDeadZone) {
      this.highlightedKind = null;
      return;
    }
    const nearest = findNearestDustWheelOption(this.options, aim.angleRad);
    this.highlightedKind = nearest !== null ? nearest.kind : null;
  }

  /** Opens the wheel. No-op if already open/opening. */
  open(progress: PlayerProgress | undefined, nowMs: number): void {
    if (this.isOpen()) return;
    this.options = buildDustWheelOptions(progress);
    if (this.options.length === 0) return; // caller should already gate on eligibility
    this.activeKindAtOpen = resolveEffectiveSelectedDustKind(progress);
    this.highlightedKind = null;
    this.phase = 'opening';
    this.animStartMs = nowMs;
  }

  /** Closes the wheel without changing the selected dust (cancel, Escape, forced close). */
  cancel(nowMs: number): void {
    if (this.phase === 'closed' || this.phase === 'closing') return;
    // Arm the latch whenever a genuinely-open wheel closes (selection or
    // cancellation) — the physical button that drove this gesture may still
    // be held, and must not leak into grapple/weave input next frame.
    this.inputCaptureLatchActive = true;
    this.phase = 'closing';
    this.animStartMs = nowMs;
  }

  /**
   * Resolves a selection made at world-space aim point (aimXWorld, aimYWorld)
   * relative to the player's visual center. Returns what happened so callers
   * can react (e.g. play a sound only on an actual switch).
   *
   *   - 'deadzone'    — aim was inside the center dead zone; consumed, wheel stays open.
   *   - 'same'        — selected the already-active dust kind; wheel closes, no switch.
   *   - 'switched'    — a new dust kind was selected, persisted, and the mote
   *                     transformation (if any live motes participate) began.
   */
  selectAtAim(
    world: WorldState,
    progress: PlayerProgress | undefined,
    aimXWorld: number,
    aimYWorld: number,
    playerXWorld: number,
    playerYWorld: number,
    nowMs: number,
  ): 'deadzone' | 'same' | 'switched' {
    const aim = computeDustWheelAim(aimXWorld, aimYWorld, playerXWorld, playerYWorld);
    if (aim.isInDeadZone) return 'deadzone';

    const nearest = findNearestDustWheelOption(this.options, aim.angleRad);
    if (nearest === null) {
      this.cancel(nowMs);
      return 'same';
    }

    const currentKind = this.activeKindAtOpen;
    if (nearest.kind === currentKind) {
      this.cancel(nowMs);
      return 'same';
    }

    if (progress !== undefined) {
      progress.selectedDustKind = nearest.kind;
    }
    beginDustTypeSwitch(world, nearest.kind);
    this.cancel(nowMs);
    return 'switched';
  }

  /** Advances the cosmetic open/close animation. Call once per rendered frame. */
  tick(nowMs: number): void {
    if (this.phase === 'opening') {
      if (nowMs - this.animStartMs >= DUST_WHEEL_OPEN_ANIM_MS) this.phase = 'open';
    } else if (this.phase === 'closing') {
      if (nowMs - this.animStartMs >= DUST_WHEEL_CLOSE_ANIM_MS) {
        this.phase = 'closed';
        this.options = [];
        this.highlightedKind = null;
        this.activeKindAtOpen = null;
      }
    }
  }

  /** Eased expansion factor in [0, 1] — 0 fully collapsed/invisible, 1 fully expanded. */
  getExpansion01(nowMs: number): number {
    if (this.phase === 'closed') return 0;
    if (this.phase === 'open') return 1;
    const duration = this.phase === 'opening' ? DUST_WHEEL_OPEN_ANIM_MS : DUST_WHEEL_CLOSE_ANIM_MS;
    const t = duration > 0 ? Math.min(1, Math.max(0, (nowMs - this.animStartMs) / duration)) : 1;
    const eased = easeOutCubic(t);
    return this.phase === 'opening' ? eased : 1 - eased;
  }
}
