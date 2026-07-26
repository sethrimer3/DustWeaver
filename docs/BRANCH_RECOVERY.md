# Branch Recovery Record

This file records deliberate recovery decisions when commit ancestry alone
cannot distinguish missing work from superseded or intentionally rejected work.

## 2026-07-25 recovery

- `agent/issue-453-persistence-boundaries`: superseded by the broader,
  backwards-compatible persistence hardening on `main` in `639d84e1`.
- `codex/editor-hardening-phase-7`: its room-resize transaction is superseded by
  the newer field-mutation integration already on `main`; the remaining legacy
  live-snapshot campaign-spawn redo compatibility was restored with focused
  regression coverage.
- `claude/dustweaver-background-modifier-zgmhx8`: recovered previously on
  `main` as `9172a7b9`, with later editor-layer hardening built on top.
- `claude/cracked-block-shattering-h1cmft`: patch-equivalent implementation is
  already on `main`.
- `claude/adjacent-rooms-render-vgkz58`: recovered onto the current connected
  room foundation. The feature remains gated behind the existing
  `cameraAlwaysCentered && renderAdjacentRooms` setting and draws only
  render-safe terrain snapshots; it never ticks a neighboring simulation.
- `claude/dustweaver-weave-extensions-fvxl70`: recovered through the concurrent
  `13547658` integration on `main`, including the Bow/Sword/Storm behavior and
  its focused deterministic tests. The active Todo still governs the eventual
  migration/removal of the legacy secondary-ability controls; this recovery
  does not override that product direction.

The authoritative enforcement mechanism is
`.github/workflows/agent-branch-integration-audit.yml`, which reports and fails
for unmerged AI-authored branches lacking an open pull request to `main`.
