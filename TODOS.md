# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## ⏭ v0.3.0 发布（下一步，人工事项）

设置页 + Provider 专项已合并 main（merge 4222c8c，分支已清，2026-07-03）。剩余：

1. 人工回归收尾（重点：跨页保存不丢、重置所有设置、Provider 密钥存取与清空、悬浮窗/划词窗改配置即生效、TTS 开关即时显隐、三主题下翻译源页外观、OCR 密钥迁移后截图识别正常）；发现问题直接在 main 上小修
2. `npm run dist` → GitHub Release 传三件套（exe + blockmap + latest.yml）→ 删除 CHANGELOG 标题中的"待发布"字样并补日期 → TODOS 清扫本节

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

### PP-OCRv6 换代（spike 已验证 ✅ 2026-07-03，待拍板排期）

Spike 结论（复跑：`node temp/ocr-probe/probe-v6.js`，形状检查 `inspect-v6.js`，模型在 temp/ocr-probe/v6-\*）：**上游 eSearch-OCR 模型仓（release tag `4.0.0`）已有官方转换好的 v6 ONNX**（tiny/small/medium 三档），Paddle2ONNX 一步全免；**esearch-ocr 8.5.0 零改动直接加载推理**——rec 输入同为 `[N,3,48,W]`、字典同"行数+2"（blank+space）约定，原风险点全部排除。六场景（zh简/繁/en/ja/拉丁/ko）实测：

- **v6-small（zip 24.8MB）可整包替换 base-v5**：zh简繁/en/ja 全对且置信度更高（0.998-0.999），**拉丁语系全对**（Grüße/Straße/niño/¿ 全中；v5 则 ß→B、ñ→n、¿→i），韩文空输出（同 v5 优雅降级）；速度 190-260ms vs v5 110-330ms（CJK 略慢、拉丁反超），截图场景无感
- **v6-tiny（5.4MB）否决**：字典仅 6904 字**无假名**——日文乱码（二九(二方过世界，conf 0.722）、繁体劣化（測信式/翻澤）、韩文幻觉输出（conf 0.701 有害于回退判断）。官方档位说明印证：tiny 49 语言**不含日语**
- **v6-medium（zip 95MB / 落盘 139MB）已实测**：六场景输出与 small **一字不差**（conf 1.000 vs 0.998-0.999），速度 ~2× 慢（270-791ms）；其 +5.1% 优势在困难样本（模糊照片/艺术字/点阵/旋转），清晰截图显不出。官方定位 medium=server、small=mobile/desktop。**不做默认**；如做"质量优先"选项 → 可选下载"高精度包"：pack 体系 userData 覆盖 base 已支持（medium 文件落 base 目录 + gen:'v6' 即透明生效），只差设置页档位控件（走设置四件套），medium zip 直接挂 ocr-models Release
- **档位事实（官方页已核）**：v6 全系仅 tiny/small/medium 三档（1.5M-34.5M 参数），medium 即顶配（对标并超越 v5_server，CPU 上 OpenVINO 比 v5_server 快 5.2×）；上游转换 ONNX 恰好也是这三档；v6 **无独立多语言模型**，韩/西里尔/天城/阿拉伯继续走 v4 包
- 落地清单：① engine 空格启发式门控 [ocr-engine.js](../electron/utils/ocr-engine.js) `gen !== 'v5'` 改按代际白名单（v6 同样原生空格须关闭）② [ocr-model-sources.js](../scripts/ocr-model-sources.js) BASE_PACK 换 v6-small（files 名 ppocr6_small_det/rec.onnx + dic.txt）+ gen:'v6' + bump version ③ **拉丁包删除**：LANGUAGE_TO_PACK 的 fr/de/es 改映射 base，korean/cyrillic/devanagari/arabic 四包保留 v4 ④ 体积：安装包约 +7MB（25MB zip / 31MB 落盘 vs 现 18MB/21MB）
- **⚠️ 发布顺序陷阱**：老客户端 engine 对 gen≠'v5' 会**开启**空格启发式——若先翻 ocr-models Release，老版本"重新下载基础包"会拿到 v6 且疯狂插空格。**必须先发含门控修复的应用版，再更新模型 Release 资产**
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
