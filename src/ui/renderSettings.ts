import { getStoredFloat, setStoredFloat } from '../utils/storage';

// ── Audio Volume ─────────────────────────────────────────────────────────────

const MUSIC_VOLUME_STORAGE_KEY = 'dustweaver-music-volume';
const SFX_VOLUME_STORAGE_KEY = 'dustweaver-sfx-volume';
const DEFAULT_MUSIC_VOLUME = 0.7;
const DEFAULT_SFX_VOLUME = 0.7;

export function getMusicVolume(): number {
  return getStoredFloat(MUSIC_VOLUME_STORAGE_KEY, DEFAULT_MUSIC_VOLUME, 0, 1);
}

export function setMusicVolume(volume: number): void {
  setStoredFloat(MUSIC_VOLUME_STORAGE_KEY, volume, 0, 1);
}

export function getSfxVolume(): number {
  return getStoredFloat(SFX_VOLUME_STORAGE_KEY, DEFAULT_SFX_VOLUME, 0, 1);
}

export function setSfxVolume(volume: number): void {
  setStoredFloat(SFX_VOLUME_STORAGE_KEY, volume, 0, 1);
}

// ── Graphics Quality ─────────────────────────────────────────────────────────

const GRAPHICS_QUALITY_STORAGE_KEY = 'dustweaver-graphics-quality';
export type GraphicsQuality = 'low' | 'med' | 'high';
const DEFAULT_GRAPHICS_QUALITY: GraphicsQuality = 'med';

export function getGraphicsQuality(): GraphicsQuality {
  const value = localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY);
  if (value === 'low' || value === 'med' || value === 'high') return value;
  return DEFAULT_GRAPHICS_QUALITY;
}

export function setGraphicsQuality(quality: GraphicsQuality): void {
  localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, quality);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface RenderSizeOption {
  id: string;
  label: string;
  widthPx: number;
  heightPx: number;
}

const RENDER_SIZE_STORAGE_KEY = 'dustweaver-render-size-id';
const OFFENSIVE_DUST_OUTLINE_STORAGE_KEY = 'dustweaver-offensive-dust-outline-enabled';
const REACHABLE_EDGE_GLOW_OPACITY_STORAGE_KEY = 'dustweaver-reachable-edge-glow-opacity';
const INFLUENCE_CIRCLE_OPACITY_STORAGE_KEY = 'dustweaver-influence-circle-opacity';
const INFLUENCE_HIGHLIGHT_WIDTH_STORAGE_KEY = 'dustweaver-influence-highlight-width';
const DOUBLE_JUMP_TO_GRAPPLE_STORAGE_KEY = 'dustweaver-double-jump-to-grapple';
const PIXEL_SPEEDOMETER_STORAGE_KEY = 'dustweaver-pixel-speedometer-enabled';
const PIXEL_SPEEDOMETER_PLACEMENT_STORAGE_KEY = 'dustweaver-pixel-speedometer-placement';
const PIXEL_SPEEDOMETER_TOTAL_STORAGE_KEY = 'dustweaver-pixel-speedometer-total-enabled';
const PIXEL_SPEEDOMETER_HORIZONTAL_STORAGE_KEY = 'dustweaver-pixel-speedometer-horizontal-enabled';
const PIXEL_SPEEDOMETER_VERTICAL_STORAGE_KEY = 'dustweaver-pixel-speedometer-vertical-enabled';
const PIXEL_SPEED_GRAPH_STORAGE_KEY = 'dustweaver-pixel-speed-graph-enabled';
const PIXEL_SPEED_GRAPH_OPACITY_STORAGE_KEY = 'dustweaver-pixel-speed-graph-opacity';
const SPEEDRUN_TIMER_STORAGE_KEY = 'dustweaver-speedrun-timer-enabled';
const AIR_CURRENTS_DEBUG_STORAGE_KEY = 'dustweaver-air-currents-debug-enabled';
const DEFAULT_RENDER_SIZE_ID = '1080p';

const RENDER_SIZE_OPTIONS: RenderSizeOption[] = [
  { id: '720p', label: '1280 × 720 (720p)', widthPx: 1280, heightPx: 720 },
  { id: '900p', label: '1600 × 900 (900p)', widthPx: 1600, heightPx: 900 },
  { id: '1080p', label: '1920 × 1080 (1080p)', widthPx: 1920, heightPx: 1080 },
  { id: '1440p', label: '2560 × 1440 (1440p)', widthPx: 2560, heightPx: 1440 },
  { id: '4k', label: '3840 × 2160 (4K)', widthPx: 3840, heightPx: 2160 },
];

export function getRenderSizeOptions(): readonly RenderSizeOption[] {
  return RENDER_SIZE_OPTIONS;
}

function getOptionById(renderSizeId: string): RenderSizeOption | null {
  for (let i = 0; i < RENDER_SIZE_OPTIONS.length; i++) {
    if (RENDER_SIZE_OPTIONS[i].id === renderSizeId) {
      return RENDER_SIZE_OPTIONS[i];
    }
  }
  return null;
}

function detectScreenSizeOptionId(): string {
  const screenWidthPx = window.screen?.width ?? 0;
  const screenHeightPx = window.screen?.height ?? 0;

  if (screenWidthPx <= 0 || screenHeightPx <= 0) {
    return DEFAULT_RENDER_SIZE_ID;
  }

  const longEdgePx = Math.max(screenWidthPx, screenHeightPx);
  const shortEdgePx = Math.min(screenWidthPx, screenHeightPx);

  let bestOptionId = DEFAULT_RENDER_SIZE_ID;
  let bestOptionAreaPx = 0;

  for (let i = 0; i < RENDER_SIZE_OPTIONS.length; i++) {
    const option = RENDER_SIZE_OPTIONS[i];
    const optionLongEdgePx = Math.max(option.widthPx, option.heightPx);
    const optionShortEdgePx = Math.min(option.widthPx, option.heightPx);

    if (optionLongEdgePx <= longEdgePx && optionShortEdgePx <= shortEdgePx) {
      const optionAreaPx = option.widthPx * option.heightPx;
      if (optionAreaPx > bestOptionAreaPx) {
        bestOptionAreaPx = optionAreaPx;
        bestOptionId = option.id;
      }
    }
  }

  return bestOptionId;
}

export function getSelectedRenderSize(): RenderSizeOption {
  const storedId = localStorage.getItem(RENDER_SIZE_STORAGE_KEY);
  if (storedId !== null) {
    const storedOption = getOptionById(storedId);
    if (storedOption !== null) {
      return storedOption;
    }
  }

  const detectedOption = getOptionById(detectScreenSizeOptionId());
  return detectedOption ?? RENDER_SIZE_OPTIONS[2];
}

export function setSelectedRenderSize(renderSizeId: string): RenderSizeOption {
  const option = getOptionById(renderSizeId) ?? getOptionById(DEFAULT_RENDER_SIZE_ID) ?? RENDER_SIZE_OPTIONS[0];
  localStorage.setItem(RENDER_SIZE_STORAGE_KEY, option.id);
  return option;
}

export function isOffensiveDustOutlineEnabled(): boolean {
  const value = localStorage.getItem(OFFENSIVE_DUST_OUTLINE_STORAGE_KEY);
  return value === '1';
}

export function setOffensiveDustOutlineEnabled(isEnabled: boolean): void {
  localStorage.setItem(OFFENSIVE_DUST_OUTLINE_STORAGE_KEY, isEnabled ? '1' : '0');
}

// ── Momentum Combat Golden Trail ─────────────────────────────────────────────

const MOMENTUM_TRAIL_STORAGE_KEY = 'dustweaver-momentum-trail-enabled';

/**
 * Whether the golden high-speed trail renders while the player is in the
 * momentum-combat invulnerability state.  Defaults to enabled.
 */
export function isMomentumTrailEnabled(): boolean {
  const value = localStorage.getItem(MOMENTUM_TRAIL_STORAGE_KEY);
  return value !== '0';
}

export function setMomentumTrailEnabled(isEnabled: boolean): void {
  localStorage.setItem(MOMENTUM_TRAIL_STORAGE_KEY, isEnabled ? '1' : '0');
}

// ── Reachable Edge Glow Opacity ─────────────────────────────────────────────

const DEFAULT_REACHABLE_EDGE_GLOW_OPACITY = 0.5;

export function getReachableEdgeGlowOpacity(): number {
  return getStoredFloat(REACHABLE_EDGE_GLOW_OPACITY_STORAGE_KEY, DEFAULT_REACHABLE_EDGE_GLOW_OPACITY);
}

export function setReachableEdgeGlowOpacity(opacity: number): void {
  setStoredFloat(REACHABLE_EDGE_GLOW_OPACITY_STORAGE_KEY, opacity, 0, 1);
}

// ── Influence Circle Opacity ────────────────────────────────────────────────

const DEFAULT_INFLUENCE_CIRCLE_OPACITY = 0.5;

export function getInfluenceCircleOpacity(): number {
  return getStoredFloat(INFLUENCE_CIRCLE_OPACITY_STORAGE_KEY, DEFAULT_INFLUENCE_CIRCLE_OPACITY);
}

export function setInfluenceCircleOpacity(opacity: number): void {
  setStoredFloat(INFLUENCE_CIRCLE_OPACITY_STORAGE_KEY, opacity, 0, 1);
}

// ── Influence Highlight Width ────────────────────────────────────────────────

/** Fraction of the circle circumference that is highlighted (0–1). Default 25%. */
const DEFAULT_INFLUENCE_HIGHLIGHT_WIDTH = 0.25;

export function getInfluenceHighlightWidth(): number {
  return getStoredFloat(INFLUENCE_HIGHLIGHT_WIDTH_STORAGE_KEY, DEFAULT_INFLUENCE_HIGHLIGHT_WIDTH, 0, 1);
}

export function setInfluenceHighlightWidth(width: number): void {
  setStoredFloat(INFLUENCE_HIGHLIGHT_WIDTH_STORAGE_KEY, width, 0, 1);
}

/**
 * When enabled, pressing jump in midair after all normal jump options are
 * exhausted fires the grapple toward the current aim point. Defaults to off.
 */
export function getDoubleJumpToGrappleEnabled(): boolean {
  return localStorage.getItem(DOUBLE_JUMP_TO_GRAPPLE_STORAGE_KEY) === '1';
}

export function setDoubleJumpToGrappleEnabled(enabled: boolean): void {
  localStorage.setItem(DOUBLE_JUMP_TO_GRAPPLE_STORAGE_KEY, enabled ? '1' : '0');
}

/**
 * Shows the player's current in-game pixel velocity in the HUD. Defaults to off.
 */
export function getPixelSpeedometerEnabled(): boolean {
  return localStorage.getItem(PIXEL_SPEEDOMETER_STORAGE_KEY) === '1';
}

export function setPixelSpeedometerEnabled(enabled: boolean): void {
  localStorage.setItem(PIXEL_SPEEDOMETER_STORAGE_KEY, enabled ? '1' : '0');
}

export type PixelSpeedometerPlacement = 'over-player' | 'on-top' | 'both';

export function getPixelSpeedometerPlacement(): PixelSpeedometerPlacement {
  const value = localStorage.getItem(PIXEL_SPEEDOMETER_PLACEMENT_STORAGE_KEY);
  if (value === 'on-top' || value === 'both') return value;
  return 'over-player';
}

export function setPixelSpeedometerPlacement(placement: PixelSpeedometerPlacement): void {
  localStorage.setItem(PIXEL_SPEEDOMETER_PLACEMENT_STORAGE_KEY, placement);
}

function getDefaultOnBoolean(storageKey: string): boolean {
  return localStorage.getItem(storageKey) !== '0';
}

function setStoredBoolean(storageKey: string, enabled: boolean): void {
  localStorage.setItem(storageKey, enabled ? '1' : '0');
}

export function getPixelSpeedometerTotalEnabled(): boolean { return getDefaultOnBoolean(PIXEL_SPEEDOMETER_TOTAL_STORAGE_KEY); }
export function setPixelSpeedometerTotalEnabled(enabled: boolean): void { setStoredBoolean(PIXEL_SPEEDOMETER_TOTAL_STORAGE_KEY, enabled); }
export function getPixelSpeedometerHorizontalEnabled(): boolean { return getDefaultOnBoolean(PIXEL_SPEEDOMETER_HORIZONTAL_STORAGE_KEY); }
export function setPixelSpeedometerHorizontalEnabled(enabled: boolean): void { setStoredBoolean(PIXEL_SPEEDOMETER_HORIZONTAL_STORAGE_KEY, enabled); }
export function getPixelSpeedometerVerticalEnabled(): boolean { return getDefaultOnBoolean(PIXEL_SPEEDOMETER_VERTICAL_STORAGE_KEY); }
export function setPixelSpeedometerVerticalEnabled(enabled: boolean): void { setStoredBoolean(PIXEL_SPEEDOMETER_VERTICAL_STORAGE_KEY, enabled); }
export function getPixelSpeedGraphEnabled(): boolean { return localStorage.getItem(PIXEL_SPEED_GRAPH_STORAGE_KEY) === '1'; }
export function setPixelSpeedGraphEnabled(enabled: boolean): void { setStoredBoolean(PIXEL_SPEED_GRAPH_STORAGE_KEY, enabled); }
export function getPixelSpeedGraphOpacity(): number { return getStoredFloat(PIXEL_SPEED_GRAPH_OPACITY_STORAGE_KEY, 0.55, 0.1, 1); }
export function setPixelSpeedGraphOpacity(opacity: number): void { setStoredFloat(PIXEL_SPEED_GRAPH_OPACITY_STORAGE_KEY, opacity, 0.1, 1); }

/** The gameplay speedrun timer is opt-in and defaults to hidden on a fresh install. */
export function getSpeedrunTimerEnabled(): boolean { return localStorage.getItem(SPEEDRUN_TIMER_STORAGE_KEY) === '1'; }
export function setSpeedrunTimerEnabled(enabled: boolean): void { setStoredBoolean(SPEEDRUN_TIMER_STORAGE_KEY, enabled); }

/**
 * Shows the "Air Currents" debug overlay (arrows visualizing the pixel-material
 * wind-momentum field). Only has any effect while debug mode is also on — see
 * `render/pixelMaterials/airCurrentsDebugRenderer.ts`. Defaults to off.
 */
export function getAirCurrentsDebugEnabled(): boolean {
  return localStorage.getItem(AIR_CURRENTS_DEBUG_STORAGE_KEY) === '1';
}

export function setAirCurrentsDebugEnabled(enabled: boolean): void {
  localStorage.setItem(AIR_CURRENTS_DEBUG_STORAGE_KEY, enabled ? '1' : '0');
}

// ── World View Presets ────────────────────────────────────────────────────────

export type WorldViewPresetId = 'normal' | 'wide' | 'far';

export interface WorldViewPreset {
  id: WorldViewPresetId;
  label: string;
  /** Virtual canvas height in pixels. Width is derived from the device canvas aspect ratio multiplied by this height. */
  virtualHeight: number;
  /** Human-readable description shown in the pause menu. */
  description: string;
}

export const WORLD_VIEW_PRESETS: readonly WorldViewPreset[] = [
  { id: 'normal', label: 'Normal', virtualHeight: 270, description: '480×270 · 4× at 1080p' },
  { id: 'wide',   label: 'Wide',   virtualHeight: 360, description: '640×360 · 3× at 1080p' },
  { id: 'far',    label: 'Far',    virtualHeight: 540, description: '960×540 · 2× at 1080p' },
];

const WORLD_VIEW_STORAGE_KEY  = 'dustweaver-world-view';
const DEFAULT_WORLD_VIEW_ID: WorldViewPresetId = 'normal';

export function getWorldViewPresetId(): WorldViewPresetId {
  const value = localStorage.getItem(WORLD_VIEW_STORAGE_KEY);
  if (value === 'normal' || value === 'wide' || value === 'far') return value;
  return DEFAULT_WORLD_VIEW_ID;
}

export function setWorldViewPresetId(id: WorldViewPresetId): void {
  localStorage.setItem(WORLD_VIEW_STORAGE_KEY, id);
}

export function getActiveWorldViewPreset(): WorldViewPreset {
  const id = getWorldViewPresetId();
  for (let i = 0; i < WORLD_VIEW_PRESETS.length; i++) {
    if (WORLD_VIEW_PRESETS[i].id === id) return WORLD_VIEW_PRESETS[i];
  }
  return WORLD_VIEW_PRESETS[0];
}

// ── Always Center Camera ─────────────────────────────────────────────────────

const ALWAYS_CENTER_CAMERA_STORAGE_KEY = 'dustweaver-always-center-camera';

/**
 * When true, the camera always centres on the player with no room-edge clamping.
 * Areas outside the room show as black.  Persists in localStorage.
 * Default: false.
 */
export function getAlwaysCenterCamera(): boolean {
  return localStorage.getItem(ALWAYS_CENTER_CAMERA_STORAGE_KEY) === '1';
}

export function setAlwaysCenterCamera(enabled: boolean): void {
  localStorage.setItem(ALWAYS_CENTER_CAMERA_STORAGE_KEY, enabled ? '1' : '0');
}

// ── Render Adjacent Rooms (child of Always Center Camera) ─────────────────────

const RENDER_ADJACENT_ROOMS_STORAGE_KEY = 'dustweaver-render-adjacent-rooms';

/**
 * Child option of "Camera Always Centered".  When effective, the game renders
 * the current room plus its directly transition-linked (radius-1) neighbours as
 * a static, render-only view so the world reads as continuous at room edges.
 *
 * Stored independently from the parent so its checked state survives the parent
 * being toggled off and on.  Default: false (off).  See
 * {@link getEffectiveRenderAdjacentRooms} for the effective runtime gate.
 */
export function getRenderAdjacentRooms(): boolean {
  return localStorage.getItem(RENDER_ADJACENT_ROOMS_STORAGE_KEY) === '1';
}

export function setRenderAdjacentRooms(enabled: boolean): void {
  localStorage.setItem(RENDER_ADJACENT_ROOMS_STORAGE_KEY, enabled ? '1' : '0');
}

/**
 * The effective adjacent-room rendering state.  Adjacent rendering only makes
 * sense while the camera is unclamped/centred, so the child setting is gated by
 * the parent:  `cameraAlwaysCentered && renderAdjacentRooms`.
 *
 * Turning the parent off immediately disables adjacent rendering while
 * preserving the child's stored checked state (so it returns checked when the
 * parent is re-enabled).
 */
export function getEffectiveRenderAdjacentRooms(): boolean {
  return getAlwaysCenterCamera() && getRenderAdjacentRooms();
}

// ── Advanced Wall Jumps ──────────────────────────────────────────────────────

const ADVANCED_WALL_JUMPS_STORAGE_KEY = 'dustweaver-advanced-wall-jumps';

/**
 * When false (default), any jump press while next to a quality wall — not
 * grappling, not grounded, not in coyote time — triggers a wall jump
 * regardless of horizontal input direction (including no input at all).
 * When true, wall jumps require deliberate intent (wall-sliding, pressing
 * away from the wall, or having been airborne/falling for a few ticks) —
 * the original stricter behavior.
 * Persists in localStorage.
 */
export function getAdvancedWallJumpsEnabled(): boolean {
  return localStorage.getItem(ADVANCED_WALL_JUMPS_STORAGE_KEY) === '1';
}

export function setAdvancedWallJumpsEnabled(enabled: boolean): void {
  localStorage.setItem(ADVANCED_WALL_JUMPS_STORAGE_KEY, enabled ? '1' : '0');
}

// ── Combat Mode ──────────────────────────────────────────────────────────────

import type { CombatMode } from '../sim/combatMode';

const COMBAT_MODE_STORAGE_KEY = 'dustweaver-combat-mode';

export function getCombatModeFromStorage(): CombatMode {
  return localStorage.getItem(COMBAT_MODE_STORAGE_KEY) === 'legacy' ? 'legacy' : 'momentum';
}

export function saveCombatModeToStorage(mode: CombatMode): void {
  localStorage.setItem(COMBAT_MODE_STORAGE_KEY, mode);
}

