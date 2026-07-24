/**
 * gameRenderDeviceOverlay.ts — Device-canvas overlay rendering for the game frame.
 *
 * Handles rendering of UI elements drawn directly on the device canvas (not
 * the virtual 480×270 canvas) after the upscale step:
 *   • Touch joystick (thumb stick and outer ring)
 *   • Debug control hints banner
 *
 * Extracted from gameRender.ts to keep the main render orchestrator leaner.
 * Follows the same context-interface pattern as gameHudRenderer.ts.
 */

import type { InputState } from '../input/handler';
import { JOYSTICK_MAX_RADIUS_PX } from '../input/handler';
import type { WorldState } from '../sim/world';
import { renderHudOverlay } from '../render/hud/overlay';
import type { HudState } from '../render/hud/overlay';
import type { RenderProfiler } from '../render/hud/renderProfiler';
import {
  getTotalMoteSlotCount,
  getAvailableMoteSlotCount,
  getEffectiveGrappleRangeWorld,
  MOTE_STATE_DEPLETED,
} from '../sim/motes/orderedMoteQueue';
import { debugPanelVisibility } from '../ui/debugPanelManager';
import { getPixelMaterialDebugCounterText } from '../render/pixelMaterials/pixelMaterialDebugRenderer';
import { getAirCurrentsDebugLegendText } from '../render/pixelMaterials/airCurrentsDebugRenderer';
import { getAirCurrentsDebugEnabled } from '../ui/renderSettings';
import type { EditorRenderMask } from '../editor/editorRenderMask';
import { isLayerVisibleInMask } from '../editor/editorRenderMask';

// ── Constants ───────────────────────────────────────────────────────────────

/** Touch joystick outer ring radius (virtual pixels). */
const JOYSTICK_OUTER_RADIUS_PX = JOYSTICK_MAX_RADIUS_PX;
/** Touch joystick thumb indicator radius (virtual pixels). */
const JOYSTICK_INNER_RADIUS_PX = 22;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ── Device overlay context ──────────────────────────────────────────────────

/** Subset of RenderFrameContext fields needed by renderDeviceOverlay(). */
export interface DeviceOverlayContext {
  deviceCtx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  virtualCanvas: HTMLCanvasElement;
  inputState: InputState;
  isDebugMode: boolean;
  world: WorldState;
  currentRoom: { name: string };
  hudState: HudState;
  renderProfiler?: RenderProfiler;
}

export interface HighResolutionDebugOverlayContext {
  deviceCtx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  virtualCanvas: HTMLCanvasElement;
  isDebugMode: boolean;
  world: WorldState;
  currentRoom: { name: string };
  hudState: HudState;
  renderProfiler?: RenderProfiler;
  /** Editor render mask; omitted/null means runtime (unchanged behavior). */
  mask?: EditorRenderMask | null;
}

/**
 * Renders debug/stat text panels directly on the device canvas so they remain
 * sharp at native display resolution.
 */
export function renderHighResolutionDebugOverlay(r: HighResolutionDebugOverlayContext): void {
  const { deviceCtx, canvas, virtualCanvas, isDebugMode, world, currentRoom, hudState, renderProfiler, mask } = r;
  if (!isDebugMode) return;
  if (!isLayerVisibleInMask(mask, 'debug')) return;

  const scaleXPx = canvas.width / virtualCanvas.width;
  const scaleYPx = canvas.height / virtualCanvas.height;

  deviceCtx.save();
  deviceCtx.scale(scaleXPx, scaleYPx);

  // Pass per-panel visibility so only toggled sections are drawn.
  renderHudOverlay(deviceCtx, hudState, renderProfiler, virtualCanvas.width, true, debugPanelVisibility);

  // ── Room name label (gated behind "room" panel) ──────────────────────────
  if (debugPanelVisibility.room) {
    deviceCtx.fillStyle = 'rgba(255,255,255,0.45)';
    deviceCtx.font = '7px monospace';
    const roomLabel = currentRoom.name;
    const labelWidthPx = deviceCtx.measureText(roomLabel).width;
    deviceCtx.fillText(roomLabel, (virtualCanvas.width - labelWidthPx) * 0.5, 22);
  }

  // ── Sand / air-currents counter readout (gated behind "particles" panel) ─
  // Drawn here on the device canvas (not the low-res virtual canvas) so the
  // text stays crisp at native display resolution.
  if (debugPanelVisibility.particles) {
    deviceCtx.font = '8px monospace';
    deviceCtx.textAlign = 'left';
    deviceCtx.textBaseline = 'top';
    deviceCtx.fillStyle = 'rgba(255,255,255,0.85)';
    deviceCtx.fillText(getPixelMaterialDebugCounterText(world), 4, 4);
    if (getAirCurrentsDebugEnabled()) {
      deviceCtx.fillText(getAirCurrentsDebugLegendText(), 4, 14);
    }
  }

  // ── Mote / particle stats (gated behind "particles" panel) ───────────────
  if (debugPanelVisibility.particles) {
    const totalSlots = getTotalMoteSlotCount(world);
    const availableSlots = getAvailableMoteSlotCount(world);
    const depletedSlots = totalSlots - availableSlots;
    const ratio = totalSlots > 0 ? availableSlots / totalSlots : 1.0;
    const effectiveRangeWorld = getEffectiveGrappleRangeWorld(world);
    const displayRadiusWorld = world.moteGrappleDisplayRadiusWorld;

    let slotBar = '';
    for (let i = 0; i < world.moteSlotCount; i++) {
      slotBar += world.moteSlotState[i] === MOTE_STATE_DEPLETED ? '○' : '●';
    }

    const moteLines = [
      `Motes: ${availableSlots}/${totalSlots} (${(ratio * 100).toFixed(0)}%)`,
      `Depleted: ${depletedSlots}`,
      `Range eff: ${effectiveRangeWorld.toFixed(1)}  disp: ${displayRadiusWorld.toFixed(1)}`,
      slotBar || '(no motes)',
    ];

    const lineHeightPx = 9;
    const padXPx = 4;
    const padYPx = 4;
    const panelWidthPx = 150;
    const panelHeightPx = moteLines.length * lineHeightPx + padYPx * 2;
    const panelXPx = virtualCanvas.width - panelWidthPx - padXPx;
    const panelYPx = padYPx;

    deviceCtx.font = '7px monospace';
    deviceCtx.fillStyle = 'rgba(0,0,0,0.50)';
    deviceCtx.fillRect(panelXPx, panelYPx, panelWidthPx, panelHeightPx);
    deviceCtx.fillStyle = '#b0f080';
    for (let li = 0; li < moteLines.length; li++) {
      deviceCtx.fillText(moteLines[li], panelXPx + padXPx, panelYPx + padYPx + (li + 1) * lineHeightPx - 2);
    }
  }

  deviceCtx.restore();
}

// ── Public render function ──────────────────────────────────────────────────

/**
 * Renders device-canvas overlays after the virtual canvas has been upscaled.
 * All coordinates are in physical device pixels (canvas.width × canvas.height).
 *
 * @param r  Device overlay context (subset of RenderFrameContext).
 */
export function renderDeviceOverlay(r: DeviceOverlayContext): void {
  const { deviceCtx, canvas, virtualCanvas, inputState, isDebugMode } = r;

  renderHighResolutionDebugOverlay(r);

  // ── Touch joystick ────────────────────────────────────────────────────────
  if (inputState.isTouchJoystickActiveFlag === 1) {
    const bx = inputState.touchJoystickBaseXPx;
    const by = inputState.touchJoystickBaseYPx;
    const joystickCurrentXPx = inputState.touchJoystickCurrentXPx;
    const joystickCurrentYPx = inputState.touchJoystickCurrentYPx;

    // Scale radii from virtual pixels to device canvas pixels so the joystick
    // appears at the correct physical size regardless of device resolution.
    const joystickScale = canvas.height / virtualCanvas.height;
    const outerRadiusPx = JOYSTICK_OUTER_RADIUS_PX * joystickScale;
    const innerRadiusPx = JOYSTICK_INNER_RADIUS_PX * joystickScale;

    deviceCtx.save();
    deviceCtx.beginPath();
    deviceCtx.arc(bx, by, outerRadiusPx, 0, Math.PI * 2);
    deviceCtx.strokeStyle = 'rgba(0,207,255,0.35)';
    deviceCtx.lineWidth = 2 * joystickScale;
    deviceCtx.stroke();
    deviceCtx.fillStyle = 'rgba(0,207,255,0.08)';
    deviceCtx.fill();

    const joystickDx = joystickCurrentXPx - bx;
    const joystickDy = joystickCurrentYPx - by;
    const dist = Math.sqrt(joystickDx * joystickDx + joystickDy * joystickDy);
    let thumbXPx = joystickCurrentXPx;
    let thumbYPx = joystickCurrentYPx;
    if (dist > outerRadiusPx) {
      thumbXPx = bx + (joystickDx / dist) * outerRadiusPx;
      thumbYPx = by + (joystickDy / dist) * outerRadiusPx;
    }

    deviceCtx.beginPath();
    deviceCtx.arc(thumbXPx, thumbYPx, innerRadiusPx, 0, Math.PI * 2);
    deviceCtx.fillStyle = 'rgba(0,207,255,0.45)';
    deviceCtx.fill();
    deviceCtx.restore();
  }

  // ── Control hints ─────────────────────────────────────────────────────────
  if (isDebugMode) {
    const controlHintText = IS_TOUCH_DEVICE
      ? 'L.thumb L/R=walk  |  L.thumb up=jump  |  2nd finger tap=attack  |  2nd finger hold=block  |  TAP MENU to return'
      : 'A/D=walk  |  W/Space/↑=jump  |  Click=attack  |  Hold=block  |  Hold Left Click=grapple  |  ESC=menu';
    deviceCtx.fillStyle = 'rgba(255,255,255,0.3)';
    deviceCtx.font = '12px monospace';
    const hintWidthPx = deviceCtx.measureText(controlHintText).width;
    deviceCtx.fillText(controlHintText, (canvas.width - hintWidthPx) / 2, canvas.height - 10);
  }
}
