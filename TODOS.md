# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## v0.2.7 candidates

### 1. Streaming render throttle (RAF + device tier)

Replace per-token `setState` on the `<textarea>` with RAF-based buffering: accumulate tokens, flush one batch per frame, minimum 16ms interval floor (cap at 60fps even on 144/240Hz displays). Two device tiers via `navigator.hardwareConcurrency` + `deviceMemory`: high (≥8 cores, ≥16GB) → 16ms floor, mid/low → 33ms floor. Non-streaming providers (Google/DeepL/Baidu) bypass the throttle. Flush residual buffer on stream end.

Project has no markdown rendering — translation output is a raw `<textarea>`. Expected peak memory reduction is ~1.5-2x on low-end. Verification artifact: before/after Memory snapshots.

### 2. Cache key should include model name

[services/translation.js _getCacheKey](src/services/translation.js:340) keys cache by `${targetLang}-${template}-${providerId}-${hash}`. Missing: **the active model name**. Symptom: user swaps LM Studio model from `hy-mt2-7b` → `qwen3-7b` (same provider id `local-llm`, same source text) → cache key collides → user gets the stale hy-mt2 translation back, not a fresh qwen3 one.

Fix: include `provider.config.model` in the cache key. One-line change once verified the cache key has access to provider config.

### 3. selectedTemplate persistence

[TranslationPanel/index.jsx:53](src/components/TranslationPanel/index.jsx:53) `selectedTemplate` is React state only — resets to `'natural'` every restart. If user switches to `'precise'` or `'formal'`, the choice is lost on next launch. Persist to localStorage (or main electron-store). Low priority; v0.2.6 reset behavior is unchanged from v0.2.5.

### 4. PDF selection translation: retry on non-Adobe readers

v0.2.6 skipped this (Adobe didn't work). Worth re-testing on Foxit / Edge built-in PDF / SumatraPDF — different readers have different clipboard behavior across read-only vs editable modes. If any reader works reliably, document the supported set in README; if multiple fail, debug clipboard path (`electron/utils/native-helper.js` `simulateCtrlC` + `checkSelectionViaClipboard`).

### 5. MT mode UI indicator (nice-to-have)

When the auto-detect ([model-template-mapping.js](src/config/model-template-mapping.js)) flips the prompt to MT-friendly mode (user-only message + simplified instruction), there's no UI feedback. User wonders "why is my translation different now". Small tooltip / badge near the model name in ProviderSettings or near the tone buttons: "MT model detected — using direct prompt". Low priority but boosts confidence.

## v0.3 candidates

### "按下没内容" auto-detect path: text caching root-fix

v0.2.4 mitigated the symptom with an 800ms poll extension. True root cause is focus transfer: icon shows → user clicks icon → focus jumps from target app to icon window → simulateCtrlC fires at a now-defocused target → fails. Proper fix: cache successfully-fetched text + timestamp to `runtime.lastSelectionText` in the Layer 3 clipboard path; on subsequent `SELECTION.GET_TEXT` requests, use cache if <500ms old. Need to calibrate invalidation strategy (clear on mouseup? idle? new selection?).

### Full onboarding wizard

The v0.2.6 OCR error-to-guidance fix is the short version. Full version: first-launch welcome flow, guided OCR/LLM setup, feature tour. Needs design.

### Incremental unit test coverage buildout

`tests/setup.js` exists since v0.2.4 but no `*.test.js` files yet (despite design doc mentioning ~10 pure-fn tests, those got deferred). Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

### Anthropic / Gemini provider consolidation evaluation

v0.2.6 only merged OpenAI-compatible providers. Anthropic and Gemini have different API shapes (messages format / generateContent). Evaluate if they share enough structure with each other or with a "REST translator" abstraction. Risk: abstract base class is reverse-DRY (see `dry-merge-over-abstract` learning). May find the right call is "leave them be".
