# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## 发布流程备忘（每版适用）

- 打包：`npm run dist`，产物在 `release/`；GitHub Release **必传三件套** `T-Translate-Setup-x.x.x.exe` + `.exe.blockmap` + `latest.yml`（缺 latest.yml 用户端检查更新直接报错）
- OCR 模型热更新只改 `ocr-models` Release 资产（bump manifest version 即可，无需发版），维护手册见 [docs/OCR_MODELS.md](docs/OCR_MODELS.md)
- 语言包 rec 模型目前 v4 代际；上游出 v5 多语言 ONNX 后按 OCR_MODELS.md「更新模型」流程换入

## v0.3 candidates

### 翻译栈 + 在线 OCR 下沉主进程（独立专项，需 design doc）

2026-07-02 设置页专项评估结论：本轮只做小方案（配置变更广播 reload + cache 覆写修复 + OCR 密钥渲染端加密），下沉另立专项。届时一并迁移：

- **翻译 provider 栈下沉** — 三 renderer 各持实例/L1 缓存/failure count 互不共享，L2 localStorage 写入互覆。下沉后：跨窗口缓存命中、密钥单点解密、隐私模式单点强制
- **在线 OCR 调用下沉** — 四家在线 OCR（OCR.space/Google Vision/Azure/百度）改经主进程发请求，密钥只留主进程、不再进任何渲染进程（本轮 D1 拍板选了渲染端加密小修，主进程化为终态方向；旧的四个主进程 handler 已腐化两代并在本轮删除，届时按现行引擎实现重写）
- **硬前提** — 主进程目前是未打包裸 CJS（`"main": "electron/main.js"`），providers 层是 ESM + svg import + 渲染端 i18n/localStorage：下沉前必须先引入主进程打包链（如 vite-plugin-electron）并拆分 provider 的 metadata（UI 用）与运行时；流式需自建 chunk IPC 协议、用户级 abort 需请求 id→AbortController 映射。估 15-25 文件 / ±800-1200 行 / 3-5 工作日

### 设置页 + Provider 专项审计残余（低风险清理，零功能影响）

主体已修（P0/P1/P2 全部 + 大部分 P3，见 gstack 目录审计文档修复状态）。剩下的纯技术债/装饰性清理，不影响功能，单独排期：

- **渲染端死语言包键清扫**（审计 §104，~90 组×2）：settings.tabs/providers/glossary 整块、connectionSettings 整块、providerConfig.ocr、settings.privacy.mode/modes、settings.general.startup/minimize 等无消费者键。删前需逐块 grep 验证非引用（check:i18n 保证 zh/en 删齐）
- **SettingsPanel 死 CSS 类清扫**（§99，约 45 个候选）：CSS→JSX 单向扫描列出 ~55 候选（setting-card 族 / radio-* / stepper-* / mode-standard|offline|secure 等），但需逐个排除动态构造（`mode-${id}`）与 ::before content 用法后才能删，零功能收益、误删即掉样式，低优先。ProviderSettings/styles.css 令牌化已完成（三主题实拍验证）
- **残余死 IPC 通道**（四端对照）：STORE.HAS、SECURE_STORAGE.GET_ACCESS_LOG、SHORTCUTS.GET、SCREENSHOT.SCREEN_BOUNDS、SYSTEM.DIALOG.MESSAGE/LOGS.GET_DIRECTORY、FLOATING_WINDOW.OPEN——handler/preload 齐全但无调用方
- **anthropic 文件内去重**（D24b 剩余）：translate/translateStream ~40 行守卫+prompt 归一化+请求体逐字重复，可抽 `_buildBody`/`_resolvePrompt` 私有方法（纯重构无行为变化）
- **DEFAULT_TTS_CONFIG 四处常量表收敛**（§84）：services/tts/index.js（活）/SettingsPanel/constants.js（活）/electron/state.js（活）三张活表 + config/defaults 已删；跨进程无法共享 import，至少加交叉注释锚定
- **electron/state.js settings.providers:{} 幽灵桶**（§73）：store defaults 给新装种的顶层空桶无消费者；config.js 幽灵字段（translationEngine/providerPriority/theme/fontSize）
- OcrSection 语言下拉的国旗 emoji（🇨🇳 等）：lucide 无国旗图标，保留或改纯文字待定

### 划词检测完整性（0.2.9 已基本落地，剩数据驱动项）

- README 应用支持列表 — 等日常使用积累（`npm run start:debug` 探针日志按应用记录走哪层），逐项标注已知限制
- UIA TextPattern 第 4 层 — **默认不建**（承重墙修复后覆盖大幅改善）；仅当日志出现成片失败样本再评估

### PP-OCRv6 ONNX 实测（能否喂进 esearch-ocr）

PP-OCRv6 已发布（2026-06-11，[官方介绍](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html)）：PPLCNetV4 骨干，tiny/small/medium 三档（1.5M-34.5M 参数），medium 对 v5_server 识别 +5.1%/检测 +4.6%，**单模型 50 语言**（简繁中/英/日 + 46 拉丁语系）。

- **实验**：Paddle2ONNX 导出 v6 tiny/small 的 det/rec + 字典，直接喂 esearch-ocr 跑 temp/ 的 probe 8 场景；风险点 = rec 非对称 stride 的输入形状与字典格式是否匹配 esearch-ocr 加载假设
- **成了的话**：走"模型热更新只改 Release"路径，**拉丁语言包可删**（被基础模型吸收）；韩/西里尔/天城/阿拉伯四包保留
- 顺带：百度 Unlimited-OCR 只有 NVIDIA GPU 路径，不适合内置；其 vLLM 镜像是 OpenAI 兼容 API，有 N 卡用户可把 llm-vision 端点指过去零改动直连——可写 FAQ

### 真 asar 热替换（仅评估，不承诺）

只覆盖纯 JS 改动；koffi/uiohook/node-screenshots/OCR 全在 asarUnpack，native 或 Electron 版本一变必须回全量；且热更新通道必须做包签名校验，否则是供应链攻击口。当前差分下载（v0.2.8 起）已覆盖大部分收益。

### 流式翻译用户级 abort 传播（设置页审计 P2-34，本轮暂缓）

流式翻译无用户级取消：被取代的请求（流进行中清空/切语言解除门禁后）在后台跑完到 [DONE]，白耗 token/本地 GPU。修法需 translate/translateStream 增 `options.signal`，各 provider fetch 用 `AbortSignal.any([signal, timeoutController.signal])` 合并，[main-translation.js](src/services/main-translation.js) 持当前 run 的 AbortController、新 run 启动时 abort 上一个。横跨 ~10 个 provider fetch，属性能优化非正确性 bug，单独排期做全量回归。

### Full onboarding wizard

The v0.2.6 OCR error-to-guidance fix is the short version. Full version: first-launch welcome flow, guided OCR/LLM setup, feature tour. Needs design.

### Incremental unit test coverage buildout

`tests/unit/` 现有 8 个测试文件（selection 三件套 / stream-throttle / ocr-packs / 历史导入规范化等）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

### Lint backlog cleanup

剩余项（App.jsx rules-of-hooks 与 jsx-uses-vars 已在 0.2.9 主面板轮根修）：
- `src/i18n/locales/{en,zh}.js`: 重复 key（selectStyle / notify）— 后定义静默覆盖前定义
- `src/utils/logger.js`: `??` 左侧 constant 是 dead code
- 清完后恢复全局严格（移除 eslint.config.js 剩余 per-file 降级）
