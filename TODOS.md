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

### 3. SelectionTranslator 里的 translation.sourceLanguage 从未被使用

**Why**: Copilot 在 v0.2.4 PR 审查里发现的既有问题（非本 PR 引入）。`src/components/SelectionTranslator/index.jsx` 的 `translateText` 签名只接受 `overrideTargetLang`，内部硬编码 `sourceLang: 'auto'`（index.jsx:528）。三个调用点（L246 screenshot 路径、L328 CapsLock 直出路径、L402 icon 流）都只传 targetLanguage。结果：用户设置 / 主进程发来的 `translation.sourceLanguage` 完全不生效，但 payload 里一直带着这字段造成读代码时的误读。

**Approach**: 二选一——
- **A. 打通 sourceLanguage**：`translateText` 签名加 `overrideSourceLang`；三个调用点传进来；L528 改成 `sourceLang: overrideSourceLang || translation.sourceLanguage || 'auto'`。
- **B. 删 dead payload**：`DEFAULT_TRANSLATION` / `data.translation` 摘掉 sourceLanguage；主进程同步不发送。

选 A 前先确认产品是否希望「手动指定源语言」真的生效（目前 UI 里有这选项吗？）；选 B 前确认没有其他调用点依赖。

**Why not v0.2.4**: 既有问题，非 b61adba 引入；跨 state shape + 3 调用点 + 翻译层，超 v0.2.4 scope。

**Blockers**: 先拍 A/B 的产品决策。

---

## Conventions

- **Stale-check**: Re-visit TODOs each time a new release ships (or quarterly). Delete anything completed or no longer relevant.
- **Format**: Each TODO has Why / Approach / Why not now / Blockers. If you can't answer Why not now, you should probably do it now.
- **Scope discipline**: Don't add "wouldn't it be cool if..." speculation here. This file is for known-valuable work with clear motivation, not idea storage.
