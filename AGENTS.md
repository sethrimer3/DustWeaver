# DustWeaver Agent Guide

This file is the short entry point for coding agents. Keep it compact and update it when repo workflow or architecture changes.

## Required read order

1. `AGENTS.md`
2. `docs/AI_REPO_MAP.md`
3. `docs/CURRENT_STATUS.md`
4. `docs/Todo.md`
5. Existing detailed docs as needed: `README.md`, `nextSteps.md`, `docs/decisions/performanceOptimizationDecisions.md`, `docs/decisions/REFACTORING_PLAN.md`, `docs/render-chunk-prewarming.md`, `docs/README.md` (documentation index), and any feature-specific notes.

## Working rule for token-efficient agents

Read the map and status first. Identify the smallest relevant subsystem, then inspect only the needed source files and their immediate dependencies. Do not scan unrelated systems unless a concrete import, data dependency, or failing test points there.

When uncertain, say so and verify with source. Do not infer behavior from old planning notes if current source contradicts them.

## Validation commands

From `package.json`:

```bash
npm run build
npm run lint
npm test
```

Useful dev commands:

```bash
npm run dev
npm run preview
npm run electron
npm run desktop
```

`npm run electron` and `npm run desktop` include `--no-sandbox` for local Electron development.

## DustWeaver-specific boundaries

- Simulation code under `src/sim/` should stay deterministic. Avoid wall-clock randomness or DOM/render dependencies in simulation logic.
- Rendering should read snapshots and runtime room data, not mutate simulation state.
- Room loading, resident-room activation, and transition geometry are sensitive. Prefer small, measured changes.
- Do not casually change `mapSketchRenderer.ts`, `buildCompleteBoundaryWalls`, or transition trigger geometry. These areas are called out in `nextSteps.md` as regression-prone.
- Room transitions use complete boundary walls plus independent trigger strips. Do not reintroduce boundary holes.
- For documentation-only changes, do not modify source code, saved room data, version numbers, or build numbers unless an existing repo rule explicitly requires it.
- Every coherent set of codebase changes made by an AI agent must increment the patch component of `BUILD_NUMBER` in `src/build-info.ts` exactly once (for example, `1.0.0` becomes `1.0.1`). The main menu displays this value. Documentation-only changes do not require a bump unless they accompany code changes.
- Follow the operational workflow in `docs/Todo.md` when selecting or completing Todo tasks. Record useful unfinished implementation context in `nextSteps.md`; check off a Todo only when its core acceptance criteria are complete.

## How to make changes

1. State the subsystem you are touching.
2. Inspect the files named in `docs/AI_REPO_MAP.md` for that task type.
3. Make the smallest coherent change.
4. Run the narrowest useful validation first, then the full validation commands when practical.
5. Report changed files, validation results, and any uncertain areas.

## Branch and integration policy

- A coding task is not complete merely because its commits were pushed to a feature branch.
- Before ending a task that changed code, ensure the work is either merged into `main` or has an open pull request targeting `main`.
- Do not leave completed work only on an `agent/`, `codex/`, `claude/`, `copilot/`, or other feature branch without an open pull request.
- If permissions, conflicts, failing validation, or required review prevent integration, explicitly report the branch name, commit SHA, missing integration step, and blocker. Never describe the task as complete.
- Auto-sync or backup commits do not satisfy this integration requirement.
- Before starting new work, check whether the current branch contains commits not merged into `main`. Preserve and integrate that work before switching branches unless the user explicitly directs otherwise.
- The scheduled `Agent branch integration audit` is an enforcement backstop: any unmerged `agent/`, `codex/`, `claude/`, or `copilot/` branch without an open PR targeting `main` fails the workflow. Do not silence the audit by deleting unique work; merge it, open a PR, or document an explicit rejection after preserving any useful intent on `main`.
