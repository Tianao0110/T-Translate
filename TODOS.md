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

### 4. Layer 1/2 路径"按下没内容"根因修复

**Why**: v0.2.5 Phase B 的 pass-through 方案只覆盖 Layer 3 场景（`checkSelectionViaClipboard` 抓到 text 就顺着 SHOW_TRIGGER 传给 renderer）。Layer 1/2 路径（Chrome/VSCode/Notepad++ 等简单应用）的 `hasTextSelection` 只返回布尔 —— 没捕获 text，图标显示后点击仍会走 `GET_TEXT` → `fetchSelectedText` 二次抓，理论上仍会出现"按下没内容"（实际比 Acrobat 类 Layer 3 场景少，因为简单应用焦点转移比较滞后）。

**Approach**: 改 `hasTextSelection` 返回 Layer 1/2 成功时也主动调 Layer 3 fetch 拿到 text，再通过 `showSelectionTrigger(x, y, rect, text)` 传给 renderer。这样所有路径的 text 都在 mouseup 时捕获一次并传递，renderer 点击图标零二次 fetch。

**Why not v0.2.5**: 当前 Phase B scope ~20 行；扩到 Layer 1/2 会变成 ~60-80 行（要改 `hasTextSelection` 返回 shape，或加一个"成功后额外抓"的辅助函数）。用户反馈没把 Layer 1/2 当主要痛点，Acrobat 场景才是高发 bug。等 v0.2.5 发布、Phase B pass-through 生效后，基于真实数据（Layer 1/2 场景是否仍有"按下没内容"用户投诉）决定要不要做。

**Blockers**: Phase T toolchain 打通才能写测试验证；v0.2.5 发布一周观察期。

### 5. Lint backlog（v0.2.5 Phase T 兜底，留待逐个修）

**Why**: v0.2.5 Phase T 把 eslint 9 装通后，跑 `npm run lint` 出 539 warnings + 21 个 pre-existing errors（已在 eslint.config.js 里以 per-file 降级为 warning 兜底，让 lint exit 0）。这些不是 Phase T 引入的，是历史累积，但都是真问题，应该真修而不是永远 suppress。

**Approach**: 一个文件一个文件清。具体：
- `src/i18n/locales/en.js` + `zh.js`：`selectStyle`（L113 vs L131）/ `notify`（L9 vs L362）/ `docParser`（L635 vs L652）三对重复 key —— **后定义覆盖前定义、translation 字符串静默丢失**。需要语义判断：是改名（两边都保留语义）还是合并（保留正确的那条）。
- `src/App.jsx`：8 个 `react-hooks/rules-of-hooks` errors —— L31-34 + L36/L102/L121/L153/L179 各种 hook 在 early return 之后被调。需要确认是 Zustand pattern 误报还是真违反 hook 规则；如真违反，重写 component shape 把 hooks 拉到顶部。
- `src/components/DocumentTranslator/index.jsx`：3 个 `navigateSearch` undefined（L1158 / L1165 / L1168）—— 找出 `navigateSearch` 应该从哪 import，或者它该是别的名字。
- `src/utils/logger.js`：`process` 'no-undef'（已被 `globals.node` 覆盖了，但 `no-constant-binary-expression` 在 L18 仍需要看）—— `??` 左侧 constant 是 dead code，删或改逻辑。

去 v0.3 一次性清完（或拆几个小 PR）。**清完后把 eslint.config.js 里的 per-file 降级 override 删掉**，恢复全局严格。

**Why not v0.2.5**: Phase T scope 是 toolchain 跑通；逐个修历史 lint error 跨文件 + 跨 component shape 改造，超 Phase T。Phase C（注释减脂）也不会顺手解 —— 那个是注释，不是代码 bug。

**Blockers**: 无（toolchain 已通，可以独立做）。

---

## Dev environment

### gstack 升级 0.16.1 → 1.12.2

**Why**: 当前用的 gstack 0.16.1，最新是 1.12.2 —— 跨主版本号（0.x → 1.x 是 "首次 stable" 语义）。积累了若干主版本 bugfix + 新 skill；0.16 会越来越老，某些 bin 工具 schema 迟早被 deprecate。

**Approach**: `cd ~/.claude/skills/gstack && git pull`（或跑 /gstack-upgrade skill）→ 过一遍常用 skill（office-hours / plan-eng-review / review / ship）的行为是否和 0.16 预期一致 → 看新版 CHANGELOG 挑有价值的变更用起来。

**Why not v0.2.5 cycle 内**: v0.2.5 的 office-hours + plan-eng-review 已在 0.16.1 跑完、产物都已定稿；中途换工具版本会让同 cycle 内 skill 调用产出不一致，retrospective 时麻烦。

**Blockers**: v0.2.5 tag 打完。

---

## Conventions

- **Stale-check**: Re-visit TODOs each time a new release ships (or quarterly). Delete anything completed or no longer relevant.
- **Format**: Each TODO has Why / Approach / Why not now / Blockers. If you can't answer Why not now, you should probably do it now.
- **Scope discipline**: Don't add "wouldn't it be cool if..." speculation here. This file is for known-valuable work with clear motivation, not idea storage.
