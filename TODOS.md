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

### 划词检测完整性（0.2.9 已基本落地，剩数据驱动项）

- README 应用支持列表 — 等日常使用积累（`npm run start:debug` 探针日志按应用记录走哪层），逐项标注已知限制
- UIA TextPattern 第 4 层 — **默认不建**（承重墙修复后覆盖大幅改善）；仅当日志出现成片失败样本再评估

### PP-OCRv6 后续候选（换代 + 高精度档均已随 v0.3.0 落地 ✅ 2026-07-04）

基础包已换 v6-small（feat/ocr-v6：新 id base-v6 + 空格门控按代际 + 拉丁包退役 + manifest 新旧双轨服务老客户端）；medium 高精度档已落地（feat/ocr-model-tier：模型档位控件 + base-v6-hq 可下载可切换 + 引擎按档位解析 base 目录）。发布动作见上方 v0.3.0 节步骤 2。剩余候选：

- ~~doc_cls 旋转分类器~~ **已实测弃案（2026-07-04）**：倒置图可纠正，但日文横排截图被误判竖排、韩文包乱码——主场景回归不可接受，详见 OCR_MODELS.md 已知边界（含复现方法）。别再捡
- 档位备忘：v6 全系仅 tiny/small/medium 三档（官方页 2026-07-03 已核），tiny 无假名不可用；v6 无独立多语言模型，韩/西里尔/天城/阿拉伯继续 v4 包；spike 数据与复跑脚本在 temp/ocr-probe/（probe-v6.js 四引擎对比 / probe-tier.js 档位切换 / inspect-v6.js 形状检查）
- 合入时补测：竖排文本、真实截图小字（过全量 probe.js + 实拍）
- 顺带：百度 Unlimited-OCR 只有 NVIDIA GPU 路径，不适合内置；其 vLLM 镜像是 OpenAI 兼容 API，有 N 卡用户可把 llm-vision 端点指过去零改动直连——可写 FAQ

### 真 asar 热替换（仅评估，不承诺）

只覆盖纯 JS 改动；koffi/uiohook/node-screenshots/OCR 全在 asarUnpack，native 或 Electron 版本一变必须回全量；且热更新通道必须做包签名校验，否则是供应链攻击口。当前差分下载（v0.2.8 起）已覆盖大部分收益。

### 流式翻译用户级 abort 传播（设置页审计 P2-34，本轮暂缓）

流式翻译无用户级取消：被取代的请求（流进行中清空/切语言解除门禁后）在后台跑完到 [DONE]，白耗 token/本地 GPU。修法需 translate/translateStream 增 `options.signal`，各 provider fetch 用 `AbortSignal.any([signal, timeoutController.signal])` 合并，[main-translation.js](src/services/main-translation.js) 持当前 run 的 AbortController、新 run 启动时 abort 上一个。横跨 ~10 个 provider fetch，属性能优化非正确性 bug，单独排期做全量回归。

### Full onboarding wizard

The v0.2.6 OCR error-to-guidance fix is the short version. Full version: first-launch welcome flow, guided OCR/LLM setup, feature tour. Needs design.

### Incremental unit test coverage buildout

`tests/unit/` 现有 8 个测试文件（selection 三件套 / stream-throttle / ocr-packs / 历史导入规范化等）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

