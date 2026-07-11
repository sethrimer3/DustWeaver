export const MUSIC_ASSET_PATHS = {
  rainWindAtmosphere: 'MUSIC/rainWindAtmosphere.mp3',
  thoughtfulLevel: 'MUSIC/thoughtfulLevel.mp3',
  titleMenu: 'MUSIC/titleMenu.mp3',
} as const;

export type ConcreteSongId = keyof typeof MUSIC_ASSET_PATHS;

export function resolveMusicAssetUrl(baseUrl: string, songId: ConcreteSongId): string {
  return `${baseUrl}${MUSIC_ASSET_PATHS[songId]}`;
}
