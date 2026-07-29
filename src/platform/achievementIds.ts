/** Registry of all known DustWeaver Steam achievement IDs. */

export const ACHIEVEMENT_IDS = [
  'FIRST_WEAVE',
  'FIRST_CLEAR',
  'STORMWEAVE_MASTER',
  'DUSTWEAVER_COMPLETE',
  'SPEED_RUNNER',
  'NO_HIT_ROOM',
  'MOTE_HOARDER',
  'ICE_FREEZE_CHAIN',
  'WORKSHOP_AUTHOR',
  'WORKSHOP_SUBSCRIBER',
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export function isAchievementId(value: string): value is AchievementId {
  return (ACHIEVEMENT_IDS as readonly string[]).includes(value);
}
