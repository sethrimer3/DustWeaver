import type { GraphicsQuality } from '../ui/renderSettings';
import { getQualityConfig, type RenderQualityConfig } from '../render/renderQualityConfig';
import type { BloomSystem } from '../render/effects/bloomSystem';
import type { SunbeamRenderer } from '../render/effects/sunbeamRenderer';
import type { SunraysRenderer } from '../render/effects/sunraysRenderer';
import type { AtmosphericLightDust } from '../render/effects/atmosphericLightDust';
import { setWallChunkCacheMemoryKB } from '../render/walls/blockSpriteRenderer';
import { setBgChunkCacheMemoryKB } from '../render/walls/backgroundBlockRenderer';

/** Last quality string for which chunk-cache memory caps were applied. */
let _lastChunkCacheQuality = '';

/**
 * Pre-allocated mutable quality config scratch object used when adaptive
 * reduction is active to avoid per-frame object spread allocation.
 */
const _adaptiveQcScratch: RenderQualityConfig = {
  isBloomEnabled: false,
  bloomIntensity: 0,
  bloomBlurRadiusPx: 0,
  maxDecorationBloomCount: 0,
  maxDustMoteCount: 0,
  maxDynamicLightCount: 0,
  maxParticleLightCount: 0,
  isSunbeamEnabled: false,
  isSunraysEnabled: false,
  isSunraysReducedQuality: true,
};

export interface ApplyRenderQualitySettingsContext {
  graphicsQuality: GraphicsQuality;
  isAdaptiveReductionActive: boolean;
  isDeepReductionActive: boolean;
  bloomSystem: BloomSystem;
  sunbeamRenderer: SunbeamRenderer;
  sunraysRenderer: SunraysRenderer;
  atmosphericLightDust: AtmosphericLightDust;
}

/**
 * Resolve per-frame quality config and apply all quality-driven renderer/system updates.
 */
export function applyRenderQualitySettings(r: ApplyRenderQualitySettingsContext): RenderQualityConfig {
  const qcBase = getQualityConfig(r.graphicsQuality);

  let qc: RenderQualityConfig;
  if (r.isAdaptiveReductionActive) {
    const disableExpensive = r.isDeepReductionActive;
    _adaptiveQcScratch.isBloomEnabled = disableExpensive ? false : qcBase.isBloomEnabled;
    _adaptiveQcScratch.bloomIntensity = qcBase.bloomIntensity;
    _adaptiveQcScratch.bloomBlurRadiusPx = qcBase.bloomBlurRadiusPx;
    _adaptiveQcScratch.isSunbeamEnabled = disableExpensive ? false : qcBase.isSunbeamEnabled;
    _adaptiveQcScratch.isSunraysEnabled = disableExpensive ? false : qcBase.isSunraysEnabled;
    _adaptiveQcScratch.isSunraysReducedQuality = true;
    _adaptiveQcScratch.maxDustMoteCount = Math.max(32, qcBase.maxDustMoteCount >> 1);
    _adaptiveQcScratch.maxDynamicLightCount = Math.max(4, qcBase.maxDynamicLightCount >> 1);
    _adaptiveQcScratch.maxParticleLightCount = Math.max(4, qcBase.maxParticleLightCount >> 1);
    _adaptiveQcScratch.maxDecorationBloomCount = Math.max(16, qcBase.maxDecorationBloomCount >> 1);
    qc = _adaptiveQcScratch;
  } else {
    qc = qcBase;
  }

  r.bloomSystem.setQualityParams(qc.isBloomEnabled, qc.bloomIntensity, qc.bloomBlurRadiusPx);
  r.sunbeamRenderer.setEnabled(qc.isSunbeamEnabled);
  r.sunraysRenderer.setEnabled(qc.isSunraysEnabled);
  r.sunraysRenderer.setReducedQuality(qc.isSunraysReducedQuality);
  r.atmosphericLightDust.setMaxMotes(qc.maxDustMoteCount);
  r.atmosphericLightDust.setDensityMultiplier(r.isAdaptiveReductionActive ? 0.5 : 1.0);
  r.sunbeamRenderer.setDensityMultiplier(
    r.isAdaptiveReductionActive && !r.isDeepReductionActive ? 0.5 : 1.0,
  );

  const chunkCacheQualityKey = `${r.graphicsQuality}:${r.isAdaptiveReductionActive ? 1 : 0}`;
  if (_lastChunkCacheQuality !== chunkCacheQualityKey) {
    _lastChunkCacheQuality = chunkCacheQualityKey;
    const wallMemKB = r.graphicsQuality === 'high' ? 16384 : r.graphicsQuality === 'med' ? 8192 : 4096;
    setWallChunkCacheMemoryKB(wallMemKB);
    const bgMemKB = r.graphicsQuality === 'high' ? 8192 : r.graphicsQuality === 'med' ? 4096 : 2048;
    setBgChunkCacheMemoryKB(bgMemKB);
  }

  return qc;
}
