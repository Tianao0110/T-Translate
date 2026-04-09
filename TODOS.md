# TODOS

Long-lived work items tracked across releases. Things that are not a current release's scope but are worth remembering.

## v0.3 candidates

### 1. Text caching to root-fix "按下没内容" on auto-detect path

**Why**: The `/plan-eng-review` (2026-04-08) discovered the real root cause of the "按下没内容" bug. When the user auto-selects text via kinematics (not hotkey), the state machine + 3-layer filter (`hasTextSelection` → `checkSelectionViaClipboard`) succeeds pre-icon-click. Icon shows. User clicks icon → focus moves from target app to icon window → `fetchSelectedText` (second clipboard round) sends `simulateCtrlC` to the now-defocused target → fails. The 800ms poll extension in v0.2.4 only mitigates the timing symptom, not the focus-transfer root cause.

**Approach**: In the Layer 3 `checkSelectionViaClipboard` path, cache the successfully fetched text to `runtime.lastSelectionText` with a timestamp. When user clicks the icon and IPC `SELECTION.GET_TEXT` fires, check the cache first (if <500ms old, use it; otherwise fetch fresh).

**Why not v0.2.4**: Scope creep. hotkey path already bypasses this bug region. Auto-detect path users rarely hit it. Needs cache invalidation strategy (how long? purge on mouseup? clear on idle?) that requires real usage data to calibrate.

**Blockers**: none. Can be done any time after v0.2.4 ships.

### 2. Project-wide unit test coverage (incremental buildout)

**Why**: The /plan-eng-review discovered the project has **zero existing tests** despite having a full vitest + jsdom + @testing-library setup. Running `npm test` currently fails because `tests/setup.js` was never created. v0.2.4 fixes this by creating `tests/setup.js` and adding 4 unit test files around the new code. But the other ~280 .js/.jsx files in the project remain uncovered.

**Approach**: Not a one-time task. Principle: **add a test whenever you touch a file**. Over time, coverage grows organically from the edges inward. Don't pursue 100% coverage (solo project, diminishing returns), but aim for "every new feature ships with a test" and "every bug fix ships with a regression test".

**Why not v0.2.4**: Infinite scope. v0.2.4 covers the new code from this release.

**Blockers**: `tests/setup.js` must exist (v0.2.4 ships this).

---

## Conventions

- **Stale-check**: Re-visit TODOs each time a new release ships (or quarterly). Delete anything completed or no longer relevant.
- **Format**: Each TODO has Why / Approach / Why not now / Blockers. If you can't answer Why not now, you should probably do it now.
- **Scope discipline**: Don't add "wouldn't it be cool if..." speculation here. This file is for known-valuable work with clear motivation, not idea storage.
