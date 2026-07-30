/**
 * Authoritative manifest of playable-character sprite paths.
 *
 * Single source of truth for which characters exist, which animation-frame
 * files each one ships beyond the baseline standing/crouching pair, and how
 * those files are named on disk — used by both the sprite loader
 * (characterSprites.ts) and regression tests, so the two can never drift
 * apart silently.
 */

/** Every character selectable via characterId (progress/world/save data). */
export const PLAYABLE_CHARACTER_IDS = ['knight', 'demonFox', 'princess', 'outcast'] as const;
export type PlayableCharacterId = typeof PLAYABLE_CHARACTER_IDS[number];

export type CharacterAnimationFrame = 'jumping' | 'falling' | 'fastFalling' | 'swinging';

/**
 * Per-character animation frames that actually exist on disk beyond the
 * baseline standing/crouching pair. Characters not listed here (or states
 * omitted for a listed character) fall back to the standing sprite directly
 * — no request is made for artwork that was intentionally never authored.
 */
export const CHARACTER_AVAILABLE_ANIMATION_FRAMES: Readonly<Record<PlayableCharacterId, ReadonlyArray<CharacterAnimationFrame>>> = {
  knight: [],
  demonFox: [],
  princess: [],
  outcast: ['jumping', 'falling', 'fastFalling', 'swinging'],
};

/** Filename suffix (after `${characterId}_`) for each optional animation frame. */
export const CHARACTER_ANIMATION_FILE_SUFFIX: Readonly<Record<CharacterAnimationFrame, string>> = {
  jumping: 'jumping',
  falling: 'falling',
  fastFalling: 'fastfalling',
  swinging: 'swinging',
};

/**
 * Folder segment (relative to `SPRITES/PLAYERS/`) each character's sprite
 * files actually live under. Defaults to the character's own id; characters
 * whose art was archived into a subfolder (e.g. `BonusCharacters/`) get an
 * explicit override here so the declared path matches reality rather than
 * assuming a uniform `PLAYERS/${id}/` layout for every character.
 */
const CHARACTER_SPRITE_DIR: Readonly<Record<PlayableCharacterId, string>> = {
  knight: 'BonusCharacters/knight',
  demonFox: 'BonusCharacters/demonFox',
  princess: 'BonusCharacters/princess',
  outcast: 'outcast',
};

/** Base request path (without suffix/extension) for a character's sprite files. */
export function getCharacterSpriteBasePath(characterId: string): string {
  const dir = CHARACTER_SPRITE_DIR[characterId as PlayableCharacterId] ?? characterId;
  return `SPRITES/PLAYERS/${dir}/${characterId}`;
}

/**
 * Every sprite URL required for `characterId` to render fully: standing,
 * crouching, and any animation frames declared in
 * `CHARACTER_AVAILABLE_ANIMATION_FRAMES`. This is the exact list of files
 * that must exist under `ASSETS/` (and therefore in a built `dist/`) for the
 * character to never fall back to the green placeholder box.
 */
export function getRequiredCharacterSpriteUrls(characterId: PlayableCharacterId): string[] {
  const base = getCharacterSpriteBasePath(characterId);
  const urls = [`${base}_standing.png`, `${base}_crouching.png`];
  for (const frame of CHARACTER_AVAILABLE_ANIMATION_FRAMES[characterId]) {
    urls.push(`${base}_${CHARACTER_ANIMATION_FILE_SUFFIX[frame]}.png`);
  }
  return urls;
}

/** Type guard: true when `id` is a registered playable character. */
export function isPlayableCharacterId(id: string): id is PlayableCharacterId {
  return (PLAYABLE_CHARACTER_IDS as readonly string[]).includes(id);
}
