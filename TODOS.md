# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## ⏭ v0.3.0 发布（下一步，人工事项）

设置页 + Provider 专项已合并 main（merge 4222c8c，分支已清，2026-07-03）。剩余：

1. 人工回归收尾（重点：跨页保存不丢、重置所有设置、Provider 密钥存取与清空、悬浮窗/划词窗改配置即生效、TTS 开关即时显隐、三主题下翻译源页外观、OCR 密钥迁移后截图识别正常、**v6 基础模型截图识别中/英/日/法德西 + 语言包下载卸载**）；发现问题直接在 main 上小修
2. **更新 `ocr-models` Release**：`npm run ocr:release` 重新生成 → 到 Release 页删除旧 manifest.json，上传新 manifest.json + ppocr_v6_small.zip + ppocr_v6_medium.zip（**其余旧资产全部保留**——老客户端靠 base-v5/latin 条目活着）。须在 0.3.0 发布前完成，否则新装用户"修复基础包"找不到 base-v6、高精度档下载不到 medium
3. `npm run dist` → GitHub Release 传三件套（exe + blockmap + latest.yml）→ 删除 CHANGELOG 标题中的"待发布"字样并补日期 → TODOS 清扫本节

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

### 设置页 + Provider 专项审计残余（仅剩一项）

审计残余已于 2026-07-03 三批清完（死通道/幽灵桶/config.js 字段/anthropic 去重/TTS 常量收敛/死语言包键 ~90 组/国旗与隐私页 emoji/ProviderSettings CSS 令牌化）。仅剩：

- **SettingsPanel 死 CSS 类清扫**（§99，~55 候选）：CSS→JSX 单向扫描候选含 setting-card 族 / radio-* / stepper-* / mode-standard|offline|secure 等，删前需逐个排除动态构造（`mode-${id}`）与 ::before content 用法，零功能收益、误删即掉样式——低优先

### 划词检测完整性（0.2.9 已基本落地，剩数据驱动项）

- README 应用支持列表 — 等日常使用积累（`npm run start:debug` 探针日志按应用记录走哪层），逐项标注已知限制
- UIA TextPattern 第 4 层 — **默认不建**（承重墙修复后覆盖大幅改善）；仅当日志出现成片失败样本再评估

### OCR 设置页加载卡顿（用户实测反馈 2026-07-04，待排查）

进入 设置 → OCR 有可感知卡顿。预埋线索（未验证，按嫌疑排序）：

- **头号嫌疑**：OcrSection 挂载即自动健康检查（engine=rapid-ocr 且已装时），[ocr-engine.js](electron/utils/ocr-engine.js) 首次 `ensureEnv()` 会在**主进程同步 require** onnxruntime-node / @napi-rs/canvas 原生 DLL + 构建 ONNX 会话——主进程事件循环被阻塞，全窗口跟着顿；v6 模型更大（31MB vs 21MB）加重，高精度档（139MB）会更狠
- 次要：挂载时 `loadPacks(false)` 首次无缓存 → 同步发起 GitHub manifest 网络请求（异步不阻塞但抢时机）；`checkWindowsOCR` WinRT 调用
- 修法候选：① 健康检查改轻量版（文件存在性校验，不建会话），真会话留到首次识别 ② 原生模块预热挪到应用启动后空闲期 ③ 会话构建下沉 worker/utilityProcess（重构大，可并入翻译栈下沉专项一起做）
- 排查手段：主进程 `console.time` 包 ensureEnv/createSession + 渲染端 Performance 面板看长任务归属

### PP-OCRv6 后续候选（换代 + 高精度档均已随 v0.3.0 落地 ✅ 2026-07-04）

基础包已换 v6-small（feat/ocr-v6：新 id base-v6 + 空格门控按代际 + 拉丁包退役 + manifest 新旧双轨服务老客户端）；medium 高精度档已落地（feat/ocr-model-tier：模型档位控件 + base-v6-hq 可下载可切换 + 引擎按档位解析 base 目录）。发布动作见上方 v0.3.0 节步骤 2。剩余候选：

- **doc_cls 旋转分类器**：整图旋转/倒置文本目前不纠正（OCR_MODELS.md 已知边界），上游有现成 doc_cls.onnx（6.5MB，release 8.1.0）；接入 esearch-ocr init 的 docCls 参数即可，适合并入下一轮 OCR 小批
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

### Lint backlog cleanup

仅剩一项（locales 重复 key 与 logger.js `??` 死代码已清，no-constant-binary-expression 已恢复 error 级）：
- `no-case-declarations` 存量 5 处 case 内声明（全局仍 warn 级），清完后升 error
