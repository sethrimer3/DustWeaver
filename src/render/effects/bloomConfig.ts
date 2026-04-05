export interface BloomConfig {
  enabled: boolean;
  intensity: number;
  blurRadiusPx: number;
  threshold: number;
  glowTargetScale: number;
}

export const DEFAULT_BLOOM_CONFIG: BloomConfig = {
  enabled: true,
  intensity: 0.9,
  blurRadiusPx: 3,
  threshold: 0.05,
  glowTargetScale: 0.5,
};
