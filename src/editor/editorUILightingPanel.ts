/**
 * Editor lighting panel — builds the DOM controls for the lighting
 * category in the editor sidebar and provides an update helper.
 *
 * Extracted from editorUI.ts.  All lighting-related DOM construction
 * and per-frame sync logic lives here so that editorUI.ts stays focused
 * on panel layout and orchestration.
 */

import type {
  EditorState,
  EditorUICallbacks,
  LightingEffect,
  AmbientLightDirection,
  BlockSeamBlending,
  VoidEdgeStyle,
} from './editorState';
import { LIGHTING_OPTIONS, AMBIENT_LIGHT_DIRECTION_OPTIONS } from './editorState';
import { PANEL_BORDER, TEXT_COLOR } from './editorStyles';

/**
 * Deterministic value signature over every field syncInPlace() reads —
 * cheap to compare with `===`, letting syncInPlace() return immediately
 * (no DOM writes at all) when nothing relevant changed, instead of
 * unconditionally rewriting every non-focused control's value every call.
 */
export function computeLightingValueSig(state: EditorState, currentLighting: string): string {
  const room = state.roomData;
  const s = room?.sunrays;
  return [
    currentLighting,
    room?.ambientLightDirection ?? '',
    room?.directionalBias ?? 0.65,
    room?.sideExposureStrength ?? 0.35,
    room?.minimumWallLight ?? 0.15,
    room?.falloffPower ?? 1.4,
    room?.backgroundLightSpill ?? 0.0,
    room?.solidLightSoftness ?? 0.0,
    room?.blockSeamBlending ?? 'off',
    room?.voidEdgeStyle ?? 'off',
    s?.enabled ?? false,
    s?.style ?? 'soft',
    s?.angleDeg ?? 100,
    s?.intensity ?? 0.5,
    s?.rayCount ?? 6,
    s?.animationEnabled ?? true,
  ].join('|');
}

export interface EditorLightingPanel {
  /** Top-level container div for all lighting controls. Appended to the
   *  palette area by `syncOnRebuild()` when the lighting category is active. */
  readonly lightingDiv: HTMLDivElement;
  /**
   * Full refresh — called when the palette is being rebuilt because the
   * active category just became 'lighting'.  Sets all controls to current
   * state values unconditionally and appends `lightingDiv` to `paletteDiv`.
   */
  syncOnRebuild(state: EditorState, currentLighting: string, paletteDiv: HTMLElement): void;
  /**
   * Incremental sync — called when the lighting category is already active
   * and a rebuild was not triggered.  Only updates controls that do not
   * currently have focus so active slider drags are not interrupted.
   */
  syncInPlace(state: EditorState, currentLighting: string): void;
  /** Resets tracked state; call from the parent panel's `destroy()`. */
  resetState(): void;
}

export function createEditorLightingPanel(
  getCallbacks: () => EditorUICallbacks | null,
): EditorLightingPanel {
  let _lastRenderedLightingEffect = '';
  let _lastSyncInPlaceSig = '';

  // ── Slider row helper ─────────────────────────────────────────────────────
  function makeSliderRow(
    labelText: string,
    min: number,
    max: number,
    step: number,
    defaultVal: number,
    onChange: (v: number) => void,
  ): { row: HTMLElement; slider: HTMLInputElement; valueLabel: HTMLSpanElement } {
    const row = document.createElement('div');
    row.style.cssText = 'margin-top: 6px;';
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px;';
    const lbl = document.createElement('div');
    lbl.textContent = labelText;
    lbl.style.cssText = `font-size: 11px; color: rgba(241,231,203,0.7);`;
    const valueLabel = document.createElement('span');
    valueLabel.style.cssText = `font-size: 11px; color: ${TEXT_COLOR}; font-family: monospace;`;
    valueLabel.textContent = defaultVal.toFixed(2);
    headerRow.appendChild(lbl);
    headerRow.appendChild(valueLabel);
    row.appendChild(headerRow);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(defaultVal);
    slider.style.cssText = 'width: 100%; cursor: pointer;';
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valueLabel.textContent = v.toFixed(2);
      onChange(v);
    });
    slider.addEventListener('click', (e) => e.stopPropagation());
    row.appendChild(slider);
    return { row, slider, valueLabel };
  }

  // ── Lighting effect dropdown ──────────────────────────────────────────────
  const lightingDiv = document.createElement('div');
  lightingDiv.style.cssText = `margin-bottom: 8px;`;
  const lightingLabel = document.createElement('div');
  lightingLabel.textContent = 'Lighting';
  lightingLabel.style.cssText = `font-size: 11px; color: rgba(241,231,203,0.7); margin-bottom: 4px;`;
  lightingDiv.appendChild(lightingLabel);
  const lightingSelect = document.createElement('select');
  lightingSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const opt of LIGHTING_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    lightingSelect.appendChild(o);
  }
  lightingSelect.addEventListener('change', () => {
    getCallbacks()?.onLightingEffectChange(lightingSelect.value as LightingEffect);
  });
  lightingSelect.addEventListener('click', (e) => e.stopPropagation());
  lightingDiv.appendChild(lightingSelect);

  // ── Ambient Light Direction dropdown ──────────────────────────────────────
  const ambientDirLabel = document.createElement('div');
  ambientDirLabel.textContent = 'Ambient Direction';
  ambientDirLabel.style.cssText = `font-size: 11px; color: rgba(241,231,203,0.7); margin-top: 6px; margin-bottom: 4px;`;
  lightingDiv.appendChild(ambientDirLabel);
  const ambientDirSelect = document.createElement('select');
  ambientDirSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '(room default)';
  ambientDirSelect.appendChild(defaultOpt);
  for (const opt of AMBIENT_LIGHT_DIRECTION_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    ambientDirSelect.appendChild(o);
  }
  ambientDirSelect.addEventListener('change', () => {
    const val = ambientDirSelect.value as AmbientLightDirection | '';
    getCallbacks()?.onAmbientLightDirectionChange(val === '' ? undefined : val);
  });
  ambientDirSelect.addEventListener('click', (e) => e.stopPropagation());
  lightingDiv.appendChild(ambientDirSelect);

  // ── Directional-lighting blend sliders ────────────────────────────────────
  const { row: dirBiasRow, slider: dirBiasSlider, valueLabel: dirBiasValLabel } =
    makeSliderRow('Directional Bias', 0, 1, 0.01, 0.65,
      (v) => getCallbacks()?.onDirectionalBiasChange(v));
  lightingDiv.appendChild(dirBiasRow);

  const { row: sideExpRow, slider: sideExpSlider, valueLabel: sideExpValLabel } =
    makeSliderRow('Side/Bottom Exposure', 0, 1, 0.01, 0.35,
      (v) => getCallbacks()?.onSideExposureStrengthChange(v));
  lightingDiv.appendChild(sideExpRow);

  const { row: minWallRow, slider: minWallSlider, valueLabel: minWallValLabel } =
    makeSliderRow('Min Wall Light', 0, 1, 0.01, 0.15,
      (v) => getCallbacks()?.onMinimumWallLightChange(v));
  lightingDiv.appendChild(minWallRow);

  const { row: falloffRow, slider: falloffSlider, valueLabel: falloffValLabel } =
    makeSliderRow('Falloff Power', 0.5, 3, 0.05, 1.4,
      (v) => getCallbacks()?.onFalloffPowerChange(v));
  lightingDiv.appendChild(falloffRow);

  const { row: bgSpillRow, slider: bgSpillSlider, valueLabel: bgSpillValLabel } =
    makeSliderRow('Background Spill', 0, 0.5, 0.01, 0.0,
      (v) => getCallbacks()?.onBackgroundLightSpillChange(v));
  lightingDiv.appendChild(bgSpillRow);

  const { row: slSoftRow, slider: slSoftSlider, valueLabel: slSoftValLabel } =
    makeSliderRow('Solid Light Softness', 0, 1, 0.01, 0.0,
      (v) => getCallbacks()?.onSolidLightSoftnessChange(v));
  lightingDiv.appendChild(slSoftRow);

  // ── Block Seam Blending dropdown ──────────────────────────────────────────
  const SEAM_BLENDING_OPTIONS: { id: BlockSeamBlending; label: string }[] = [
    { id: 'off',     label: 'Off' },
    { id: 'subtle',  label: 'Subtle' },
    { id: 'organic', label: 'Organic' },
    { id: 'heavy',   label: 'Heavy' },
  ];
  const seamBlendLabel = document.createElement('div');
  seamBlendLabel.textContent = 'Block Seam Blending';
  seamBlendLabel.style.cssText = `font-size: 11px; color: rgba(241,231,203,0.7); margin-top: 6px; margin-bottom: 4px;`;
  lightingDiv.appendChild(seamBlendLabel);
  const seamBlendSelect = document.createElement('select');
  seamBlendSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const opt of SEAM_BLENDING_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    seamBlendSelect.appendChild(o);
  }
  seamBlendSelect.addEventListener('change', () => {
    getCallbacks()?.onSeamBlendingChange(seamBlendSelect.value as BlockSeamBlending);
  });
  seamBlendSelect.addEventListener('click', (e) => e.stopPropagation());
  lightingDiv.appendChild(seamBlendSelect);

  // ── Void Edge Style dropdown ──────────────────────────────────────────────
  const VOID_EDGE_OPTIONS: { id: VoidEdgeStyle; label: string }[] = [
    { id: 'off',          label: 'Off' },
    { id: 'noisyEdge',    label: 'Noisy Black Edge' },
    { id: 'exteriorFill', label: 'Exterior Fill + Noisy Edge' },
  ];
  const voidEdgeLabel = document.createElement('div');
  voidEdgeLabel.textContent = 'Void Edge Style';
  voidEdgeLabel.style.cssText = `font-size: 11px; color: rgba(241,231,203,0.7); margin-top: 6px; margin-bottom: 4px;`;
  lightingDiv.appendChild(voidEdgeLabel);
  const voidEdgeSelect = document.createElement('select');
  voidEdgeSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const opt of VOID_EDGE_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    voidEdgeSelect.appendChild(o);
  }
  voidEdgeSelect.addEventListener('change', () => {
    getCallbacks()?.onVoidEdgeStyleChange(voidEdgeSelect.value as VoidEdgeStyle);
  });
  voidEdgeSelect.addEventListener('click', (e) => e.stopPropagation());
  lightingDiv.appendChild(voidEdgeSelect);

  // ── Sunrays (procedural god-rays) ──────────────────────────────────────────
  const sunraysLabel = document.createElement('div');
  sunraysLabel.textContent = 'Sunrays';
  sunraysLabel.style.cssText = `font-size: 11px; color: rgba(241,231,203,0.7); margin-top: 10px; margin-bottom: 4px; border-top: 1px solid ${PANEL_BORDER}; padding-top: 6px;`;
  lightingDiv.appendChild(sunraysLabel);

  const sunraysEnabledRow = document.createElement('label');
  sunraysEnabledRow.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(241,231,203,0.7); cursor: pointer;';
  const sunraysEnabledCheckbox = document.createElement('input');
  sunraysEnabledCheckbox.type = 'checkbox';
  sunraysEnabledRow.appendChild(sunraysEnabledCheckbox);
  const sunraysEnabledText = document.createElement('span');
  sunraysEnabledText.textContent = 'Enable Sunrays';
  sunraysEnabledRow.appendChild(sunraysEnabledText);
  sunraysEnabledCheckbox.addEventListener('change', () => {
    getCallbacks()?.onSunraysEnabledChange(sunraysEnabledCheckbox.checked);
  });
  sunraysEnabledRow.addEventListener('click', (e) => e.stopPropagation());
  lightingDiv.appendChild(sunraysEnabledRow);

  const sunraysStyleLabel = document.createElement('div');
  sunraysStyleLabel.textContent = 'Ray Style';
  sunraysStyleLabel.style.cssText = `font-size: 11px; color: rgba(241,231,203,0.7); margin-top: 6px; margin-bottom: 4px;`;
  lightingDiv.appendChild(sunraysStyleLabel);
  const sunraysStyleSelect = document.createElement('select');
  sunraysStyleSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const opt of [{ id: 'hard', label: 'Hard (crisp)' }, { id: 'soft', label: 'Soft (blurred)' }]) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    sunraysStyleSelect.appendChild(o);
  }
  sunraysStyleSelect.addEventListener('change', () => {
    getCallbacks()?.onSunraysStyleChange(sunraysStyleSelect.value as 'hard' | 'soft');
  });
  sunraysStyleSelect.addEventListener('click', (e) => e.stopPropagation());
  lightingDiv.appendChild(sunraysStyleSelect);

  const sunraysSourceLabel = document.createElement('div');
  sunraysSourceLabel.textContent = 'Source: Top of Screen';
  sunraysSourceLabel.style.cssText = `font-size: 10px; color: rgba(241,231,203,0.45); margin-top: 4px;`;
  lightingDiv.appendChild(sunraysSourceLabel);

  const { row: sunraysAngleRow, slider: sunraysAngleSlider, valueLabel: sunraysAngleValLabel } =
    makeSliderRow('Ray Angle (deg)', 20, 160, 1, 100,
      (v) => getCallbacks()?.onSunraysAngleChange(v));
  sunraysAngleValLabel.textContent = '100';
  lightingDiv.appendChild(sunraysAngleRow);

  const { row: sunraysIntensityRow, slider: sunraysIntensitySlider, valueLabel: sunraysIntensityValLabel } =
    makeSliderRow('Sunrays Intensity', 0, 1, 0.01, 0.5,
      (v) => getCallbacks()?.onSunraysIntensityChange(v));
  lightingDiv.appendChild(sunraysIntensityRow);

  const { row: sunraysRayCountRow, slider: sunraysRayCountSlider, valueLabel: sunraysRayCountValLabel } =
    makeSliderRow('Ray Count', 1, 16, 1, 6,
      (v) => getCallbacks()?.onSunraysRayCountChange(v));
  sunraysRayCountValLabel.textContent = '6';
  lightingDiv.appendChild(sunraysRayCountRow);

  const sunraysAnimRow = document.createElement('label');
  sunraysAnimRow.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(241,231,203,0.7); cursor: pointer; margin-top: 6px;';
  const sunraysAnimCheckbox = document.createElement('input');
  sunraysAnimCheckbox.type = 'checkbox';
  sunraysAnimRow.appendChild(sunraysAnimCheckbox);
  const sunraysAnimText = document.createElement('span');
  sunraysAnimText.textContent = 'Animate (sway/pulse)';
  sunraysAnimRow.appendChild(sunraysAnimText);
  sunraysAnimCheckbox.addEventListener('change', () => {
    getCallbacks()?.onSunraysAnimationChange(sunraysAnimCheckbox.checked);
  });
  sunraysAnimRow.addEventListener('click', (e) => e.stopPropagation());
  lightingDiv.appendChild(sunraysAnimRow);

  // ── Sync helpers ──────────────────────────────────────────────────────────

  function syncOnRebuild(state: EditorState, currentLighting: string, paletteDiv: HTMLElement): void {
    lightingSelect.value = currentLighting;
    ambientDirSelect.value = state.roomData?.ambientLightDirection ?? '';
    dirBiasSlider.value = String(state.roomData?.directionalBias ?? 0.65);
    dirBiasValLabel.textContent  = (state.roomData?.directionalBias  ?? 0.65).toFixed(2);
    sideExpSlider.value = String(state.roomData?.sideExposureStrength ?? 0.45);
    sideExpValLabel.textContent  = (state.roomData?.sideExposureStrength ?? 0.45).toFixed(2);
    minWallSlider.value = String(state.roomData?.minimumWallLight ?? 0.18);
    minWallValLabel.textContent  = (state.roomData?.minimumWallLight  ?? 0.18).toFixed(2);
    falloffSlider.value = String(state.roomData?.falloffPower ?? 1.4);
    falloffValLabel.textContent  = (state.roomData?.falloffPower  ?? 1.4).toFixed(2);
    seamBlendSelect.value = state.roomData?.blockSeamBlending ?? 'off';
    voidEdgeSelect.value = state.roomData?.voidEdgeStyle ?? 'off';
    const sunrays = state.roomData?.sunrays;
    sunraysEnabledCheckbox.checked = sunrays?.enabled ?? false;
    sunraysStyleSelect.value = sunrays?.style ?? 'soft';
    sunraysAngleSlider.value = String(sunrays?.angleDeg ?? 100);
    sunraysAngleValLabel.textContent = String(sunrays?.angleDeg ?? 100);
    sunraysIntensitySlider.value = String(sunrays?.intensity ?? 0.5);
    sunraysIntensityValLabel.textContent = (sunrays?.intensity ?? 0.5).toFixed(2);
    sunraysRayCountSlider.value = String(sunrays?.rayCount ?? 6);
    sunraysRayCountValLabel.textContent = String(sunrays?.rayCount ?? 6);
    sunraysAnimCheckbox.checked = sunrays?.animationEnabled ?? true;
    _lastRenderedLightingEffect = currentLighting;
    // Force the next syncInPlace() call to actually run — the values were
    // just set unconditionally above, but _lastSyncInPlaceSig hasn't been
    // told that yet (a rebuild doesn't otherwise touch it).
    _lastSyncInPlaceSig = '';
    paletteDiv.appendChild(lightingDiv);
  }

  function syncInPlace(state: EditorState, currentLighting: string): void {
    const sig = computeLightingValueSig(state, currentLighting);
    if (sig === _lastSyncInPlaceSig) return;
    _lastSyncInPlaceSig = sig;

    if (currentLighting !== _lastRenderedLightingEffect && document.activeElement !== lightingSelect) {
      _lastRenderedLightingEffect = currentLighting;
      lightingSelect.value = currentLighting;
    }
    if (document.activeElement !== ambientDirSelect) {
      ambientDirSelect.value = state.roomData?.ambientLightDirection ?? '';
    }
    function syncSlider(
      slider: HTMLInputElement,
      valLabel: HTMLSpanElement,
      val: number | undefined,
      def: number,
    ): void {
      if (document.activeElement !== slider) {
        const v = val ?? def;
        slider.value = String(v);
        valLabel.textContent = v.toFixed(2);
      }
    }
    syncSlider(dirBiasSlider,  dirBiasValLabel,  state.roomData?.directionalBias,       0.65);
    syncSlider(sideExpSlider,  sideExpValLabel,  state.roomData?.sideExposureStrength,  0.35);
    syncSlider(minWallSlider,  minWallValLabel,  state.roomData?.minimumWallLight,       0.15);
    syncSlider(falloffSlider,  falloffValLabel,  state.roomData?.falloffPower,           1.4);
    syncSlider(bgSpillSlider,  bgSpillValLabel,  state.roomData?.backgroundLightSpill,  0.0);
    syncSlider(slSoftSlider,   slSoftValLabel,   state.roomData?.solidLightSoftness,    0.0);
    if (document.activeElement !== seamBlendSelect) {
      seamBlendSelect.value = state.roomData?.blockSeamBlending ?? 'off';
    }
    if (document.activeElement !== voidEdgeSelect) {
      voidEdgeSelect.value = state.roomData?.voidEdgeStyle ?? 'off';
    }
    const sunrays = state.roomData?.sunrays;
    if (document.activeElement !== sunraysEnabledCheckbox) {
      sunraysEnabledCheckbox.checked = sunrays?.enabled ?? false;
    }
    if (document.activeElement !== sunraysStyleSelect) {
      sunraysStyleSelect.value = sunrays?.style ?? 'soft';
    }
    syncSlider(sunraysAngleSlider, sunraysAngleValLabel, sunrays?.angleDeg, 100);
    syncSlider(sunraysIntensitySlider, sunraysIntensityValLabel, sunrays?.intensity, 0.5);
    syncSlider(sunraysRayCountSlider, sunraysRayCountValLabel, sunrays?.rayCount, 6);
    if (document.activeElement !== sunraysAnimCheckbox) {
      sunraysAnimCheckbox.checked = sunrays?.animationEnabled ?? true;
    }
  }

  function resetState(): void {
    _lastRenderedLightingEffect = '';
    _lastSyncInPlaceSig = '';
  }

  return { lightingDiv, syncOnRebuild, syncInPlace, resetState };
}
