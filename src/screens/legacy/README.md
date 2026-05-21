# Legacy Seamless Room Crossing Code

This directory marks the location of legacy seamless/two-room crossing files that are
**no longer imported by active gameplay code**.

See `src/render/transitions/legacy/README.md` for the full list of legacy transition files
and instructions for re-enabling them.

## Files in This Location

| File | Description |
|------|-------------|
| `twoRoomCrossing.ts` | Two-room smooth camera-crossing state machine (BUILD 279–297) |
| `gameSeamlessStaging.ts` | Seamless two-room staged-world state (BUILD 284+) |

These files are not imported by `gameScreen.ts` and do not affect gameplay performance.
