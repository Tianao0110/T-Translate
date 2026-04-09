# TODOS

Long-lived work items tracked across releases. Things that are not a current release's scope but are worth remembering.

## v0.3 candidates

### 1. Text caching to root-fix "按下没内容" on auto-detect path

**Why**: The `/plan-eng-review` (2026-04-08) discovered the real root cause of the "按下没内容" bug. When the user auto-selects text via kinematics (not hotkey), the state machine + 3-layer filter (`hasTextSelection` → `checkSelectionViaClipboard`) succeeds pre-icon-click. Icon shows. User clicks icon → focus moves from target app to icon window → `fetchSelectedText` (second clipboard round) sends `simulateCtrlC` to the now-defocused target → fails. The 800ms poll extension in v0.2.4 only mitigates the timing symptom, not the focus-transfer root cause.

**Approach**: In the Layer 3 `checkSelectionViaClipboard` path, cache the successfully fetched text to `runtime.lastSelectionText` with a timestamp. When user clicks the icon and IPC `SELECTION.GET_TEXT` fires, check the cache first (if <500ms old, use it; otherwise fetch fresh).

**Why not v0.2.4**: Scope creep. hotkey path already bypasses this bug region. Auto-detect path users rarely hit it. Needs cache invalidation strategy (how long? purge on mouseup? clear on idle?) that requires real usage data to calibrate.

**Blockers**: none. Can be done any time after v0.2.4 ships.

### 2. Alt hotkey conflict matrix (field-tested compatibility)

**Why**: v0.2.4 will ship with an Alt-hold hotkey for fast, explicit-intent text selection. This may or may not conflict with application-specific Alt behaviors. The /plan-eng-review Phase 0.5 spike will test Chrome specifically. But there's a long tail of apps where the behavior is unknown:

- **Known to likely conflict**: Acrobat Reader (Alt activates menu bar), VSCode (Alt+click is multi-cursor), Figma (Alt+drag is duplicate), Office suite (Alt activates Ribbon)
- **Unknown**: Firefox, Edge, Slack, Discord, Telegram, IntelliJ/WebStorm, Sublime, Obsidian, Notion, Notepad++, RStudio, Jupyter Lab, Electron-based apps in general

**Approach**: Maintain a public matrix (in README or a dedicated doc) of "which apps Alt-hotkey works in / which it conflicts with / workarounds". Let users contribute PRs. Could eventually inform a "known-bad-app fallback" feature.

**Why not v0.2.4**: Scope. This is ongoing documentation, not a feature. Starts empty, grows with real user reports.

**Blockers**: v0.2.4 must ship first so users can actually use the hotkey.

### 3. Project-wide unit test coverage (incremental buildout)

**Why**: The /plan-eng-review discovered the project has **zero existing tests** despite having a full vitest + jsdom + @testing-library setup. Running `npm test` currently fails because `tests/setup.js` was never created. v0.2.4 fixes this by creating `tests/setup.js` and adding 4 unit test files around the new code. But the other ~280 .js/.jsx files in the project remain uncovered.

**Approach**: Not a one-time task. Principle: **add a test whenever you touch a file**. Over time, coverage grows organically from the edges inward. Don't pursue 100% coverage (solo project, diminishing returns), but aim for "every new feature ships with a test" and "every bug fix ships with a regression test".

**Why not v0.2.4**: Infinite scope. v0.2.4 covers the new code from this release.

**Blockers**: `tests/setup.js` must exist (v0.2.4 ships this).

### 4. SelectionSection parent component / store-set IPC wiring documentation

**Why**: During /plan-eng-review, I realized `SelectionSection.jsx` is a "dumb" prop-driven component. It doesn't directly read/write settings — it receives props and callbacks from a parent. I didn't trace the parent component (likely `SettingsPanel/index.jsx` or equivalent) during review, so the v0.2.4 implementation will need to **discover at code-edit time** how settings are currently wired: which parent owns the state, how it calls `store-set` IPC to persist changes, which callback shape the child expects.

**Approach**: When implementing Phase 3 Step 10 of v0.2.4 design doc, trace the wiring first (grep for `SelectionSection` imports, read parent). Document findings inline in a comment for future editors.

**Why not v0.2.4 scope explicitly**: It's implicitly in v0.2.4 — you'll naturally discover this when adding the 3 new UI elements. This TODO is a **reminder to document what you find** so the next change doesn't re-discover the same wiring.

**Blockers**: v0.2.4 implementation.

---

## Conventions

- **Stale-check**: Re-visit TODOs each time a new release ships (or quarterly). Delete anything completed or no longer relevant.
- **Format**: Each TODO has Why / Approach / Why not now / Blockers. If you can't answer Why not now, you should probably do it now.
- **Scope discipline**: Don't add "wouldn't it be cool if..." speculation here. This file is for known-valuable work with clear motivation, not idea storage.
