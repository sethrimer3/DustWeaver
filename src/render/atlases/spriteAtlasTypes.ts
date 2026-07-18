export interface SpriteAtlasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly sourcePath: string;
}

export interface SpriteAtlasMetadata {
  readonly version: number;
  readonly themeId: string;
  readonly sourceRoot: string;
  readonly atlasImage: string;
  readonly generatedAt: string;
  readonly padding?: number;
  readonly width?: number;
  readonly height?: number;
  readonly sprites: Record<string, SpriteAtlasRect>;
}

export interface LoadedSpriteAtlas {
  readonly themeId: string;
  readonly metadata: SpriteAtlasMetadata;
  readonly image: HTMLImageElement;
  readonly imageUrl: string;
}

export interface SpriteAtlasLookupResult {
  readonly atlas: LoadedSpriteAtlas;
  readonly sprite: SpriteAtlasRect;
  readonly spriteKey: string;
}

export interface SpriteAtlasStats {
  readonly enabled: boolean;
  readonly hardDisableActive: boolean;
  readonly metadataCount: number;
  readonly loadedAtlasCount: number;
  readonly failedAtlasCount: number;
  readonly loadingAtlasCount: number;
  readonly loadedAtlases: readonly string[];
  readonly failedAtlases: readonly string[];
  readonly loadingAtlases: readonly string[];
  readonly lookups: number;
  readonly hits: number;
  readonly misses: number;
  readonly fallbacks: number;
  readonly unsupportedPaths: number;
  readonly legacyDraws: number;
  readonly attemptedDraws: number;
  readonly disabledBypasses: number;
  readonly perTheme: Record<string, {
    readonly lookups: number;
    readonly hits: number;
    readonly misses: number;
    readonly fallbacks: number;
  }>;
}
