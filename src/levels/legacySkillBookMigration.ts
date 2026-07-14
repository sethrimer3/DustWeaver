/**
 * Legacy room JSON predating the `dustSkillTombs` migration sometimes stores
 * a `weaveId` directly on `skillBooks` entries, outside their declared
 * `{ xBlock, yBlock }` shape. This reads that untyped field so both the
 * editor and runtime loaders can promote such entries into skill-tomb shape
 * without each maintaining its own unsafe cast.
 */
export function extractLegacySkillBookWeaves(
  skillBooks: readonly { xBlock: number; yBlock: number }[] | undefined,
): { xBlock: number; yBlock: number; weaveId: string }[] {
  return (skillBooks ?? [])
    .filter(s => !!(s as unknown as Record<string, unknown>)['weaveId'])
    .map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
      weaveId: (s as unknown as Record<string, unknown>)['weaveId'] as string,
    }));
}
