# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## 发布流程备忘（每版适用）

- **版本号五处一起改，缺一处就对不上**：`package.json` / `package-lock.json`（自述的两个 version 字段，手改 package.json 不会带上它——v0.3.0～v0.3.2 三版都漂着发出去了）/ `README.md` 徽章 / `README.zh-CN.md` 徽章 / `CHANGELOG.md` 把「未发布」**改标题**成 `## vX.Y.Z — 日期 — 主题`（别在它前面新插一节，那样两条旧记录会留在孤立的「未发布」里）。代码里没有硬编码版本，运行时读 `app.getVersion()`，不用管；docs 里的历史版本号是叙述，别改
- **新功能发版前对齐文档**：README×2 功能表 + 功能段、docs/FAQ（用户会问什么）、docs/ARCHITECTURE + DEVELOPMENT（后来人怎么改）。v0.3.3 的 AI 动作就是发完才发现四份文档零提及
- 打包：`npm run dist`，产物在 `release/`；GitHub Release **必传三件套** `T-Translate-Setup-x.x.x.exe` + `.exe.blockmap` + `latest.yml`（缺 latest.yml 用户端检查更新直接报错）
- OCR 模型热更新只改 `ocr-models` Release 资产（bump manifest version 即可，无需发版），维护手册见 [docs/OCR_MODELS.md](docs/OCR_MODELS.md)
- 语言包 rec 模型目前 v4 代际；上游出 v5 多语言 ONNX 后按 OCR_MODELS.md「更新模型」流程换入

## 下一版本候选

### ~~主进程内存体检+瘦身~~ 已搁置（2026-07-11 用户拍板：属过度优化，暂不做）

实测形态健康：用时 ~700MB 是推理期弹性上探、闲时回落 ~200MB，非泄漏。复启条件=闲置基线持续爬升不回落、或用户侧真实反馈；届时量化数据与杠杆分析在协作记忆 memory-checkup-lead 里备着，别凭空重推

### 划词检测完整性（0.2.9 已基本落地，剩数据驱动项）

- README 应用支持列表 — 等日常使用积累（`npm run start:debug` 探针日志按应用记录走哪层），逐项标注已知限制
- UIA TextPattern 第 4 层 — **默认不建**（承重墙修复后覆盖大幅改善）；仅当日志出现成片失败样本再评估

### PP-OCRv6 后续候选（换代 + 高精度档均已随 v0.3.0 落地 ✅ 2026-07-04）

基础包已换 v6-small（feat/ocr-v6：新 id base-v6 + 空格门控按代际 + 拉丁包退役 + manifest 新旧双轨服务老客户端）；medium 高精度档已落地（feat/ocr-model-tier：模型档位控件 + base-v6-hq 可下载可切换 + 引擎按档位解析 base 目录）。发布动作见上方 v0.3.0 节步骤 2。剩余候选：

- ~~doc_cls 旋转分类器~~ **已实测弃案（2026-07-04）**：倒置图可纠正，但日文横排截图被误判竖排、韩文包乱码——主场景回归不可接受，详见 OCR_MODELS.md 已知边界（含复现方法）。别再捡
- 档位备忘：v6 全系仅 tiny/small/medium 三档（官方页 2026-07-03 已核），tiny 无假名不可用；v6 无独立多语言模型，韩/西里尔/天城/阿拉伯继续 v4 包；spike 复跑脚本已随 2026-07-10 temp 清理退役（结论与复现方法保全在 docs/OCR_MODELS.md 已知边界节）
- 合入时补测：竖排文本、真实截图小字（实拍回归）
- ~~百度 Unlimited-OCR vLLM 直连提示~~ ✅ 已写入 docs/FAQ.md（2026-07-10）

### 真 asar 热替换（仅评估，不承诺）

只覆盖纯 JS 改动；koffi/uiohook/node-screenshots/OCR 全在 asarUnpack，native 或 Electron 版本一变必须回全量；且热更新通道必须做包签名校验，否则是供应链攻击口。当前差分下载（v0.2.8 起）已覆盖大部分收益。

### AI 动作框架收尾项（v0.3.3 已发布，剩数据驱动项）

- **长段阈值仍是估值**：中文 150 字 / 英文 120 词写在 `src/config/ai-actions.js` `LONG_FORM_GATE`，设计阶段就说要拿真实技术文档实测再定。用一段时间后按"该出现却没出现 / 不该出现却出现"的实感调
- **理解模式结果不进历史**：那条路没有翻译条目可挂（AI 结果是翻译的附属，无附主则不写）。若要回看，需要单独设计一个"理解记录"，或让理解模式也留一条主条目——属产品决策，未定

### LLM 视觉 OCR 丢失位置信息（其余六个引擎已于 v0.3.4 补齐，只剩这一个）

v0.3.4 给 Windows OCR / Azure / Google Vision / OCR.space / 百度 五个引擎补上了行级坐标（坐标契约与粒度铁律见 `src/stack/ocr/blocks.js` 注释）。**llm-vision 仍是唯一无坐标的引擎**——模型只被要求输出文字，散点模式下退回整段（现在两种模式都会给提示）。候选方向（需实验验证，需要机器上有 Qwen2-VL 类模型）：

- ① **结构化输出 prompt**：要求模型返回行级 JSON + 归一化坐标。Qwen2-VL 系原生支持 grounding（bbox 定位），但小参数本地模型坐标精度未知，且不同模型能力参差——需按模型分级启用 + 坐标合法性校验（`display-mode.js` 的 `coordsFitFrame` 已经是现成的兜底闸门，越界整组丢弃）
- ② **混合管线**：本地 PP-OCR det 模型只出框（det 权重仅 ~9MB、无需 rec 语言包），裁切文本条喂 LLM 识别——框准、字准，代价是 N 个框 N 次调用（或拼图批量）
- ③ **场景引导**：散点需求场景（悬浮窗）提示切换本地 OCR 引擎，llm-vision 保持整段专用——零研发成本的兜底文案方案

**四个在线引擎的坐标只有 fixture 验证**（按各家文档的响应形状建的，见 `tests/unit/ocr-blocks.test.js`），无密钥无法端到端实测；Windows OCR 与本地引擎是实测过的。哪天有密钥了，实拍一次散点排版确认坐标空间无误。

### 语言选择器的后续（主体已完成，未发布）

134 种目录 + 新选择器 + 自定义语言已落地。剩余候选：

- **可以扩到 240+**：谷歌 2024 年又加了 110 种（含藏语、粤语等）。核对脚本 `scripts/verify-google-languages.mjs` 现成，跑一轮就知道哪些码可用；未做是因为那批低资源语言翻译质量参差，等有人提再说
- **模型语言表只有五条**（Llama 3.x / Qwen 2-3 / NLLB / MADLAD / Opus-MT，见 `config/model-language-coverage.js`）。故意不求全——缺条目零代价，只在降级链排序上生效、绝不进 UI。Mistral、Gemma、Phi 跨版本语言覆盖差异太大，写进去准确度不如不写
- **选择器没有搜索框**：设计上靠字母索引，134 种够用；真扩到 240+ 时要重新评估

### ~~绿色便携化（数据不落 APPDATA）~~ 已评估，暂不做（2026-08-10 用户拍板）

结论：可行、约 1-2 天、风险低，不影响现有安装版。评估结论存档如下，重启时不必重推。

- **全仓 userData 落点只有 5 处，且全部走 `app.getPath('userData')`，零硬编码路径**：electron-store 的 config.json、[logger.js:71](electron/utils/logger.js:71) 的 logs/、[ocr-engine.js:39](electron/utils/ocr-engine.js:39) 的 ocr-models/、[translation-stack.js:52](electron/ipc/translation-stack.js:52) 的 Caches/、Chromium 自带的 Local Storage/IndexedDB。**一句 `app.setPath('userData', …)` 全部跟着搬**
- ⚠️ **唯一真陷阱是 require 顺序**：[main.js:12](electron/main.js:12) require `./state` 时 [state.js:36](electron/state.js:36) 顶层就 `new Store()` 了，setPath 必须更早（main.js 最顶或抽独立首个 require）。顺序错了不报错，只会静默写回老位置
- ⚠️ **userData 之外还有一处残留**：[system.js:265](electron/ipc/system.js:265) 的开机自启走 `setLoginItemSettings` → 写 `HKCU\...\Run` 注册表。「卸载完全不留」要成立就必须处理它（便携版隐藏该开关或退出时清），否则是假承诺
- 其余：便携版不能装进 Program Files（不可写）→ electron-builder 加 `portable`/`zip` target 与 NSIS 并存，前者自带 `PORTABLE_EXECUTABLE_DIR` 可当检测依据；老用户迁移提示；OCR 模型跟着搬（高精度包 139MB）需在文档说明

### 首次启动弱引导（2026-08-11 设计已定稿，未实施）

用户拍板走**弱引导**而非多步向导："用户点击进哪里，哪里就会有相对应的小提示"。三块：

- **主面板常驻提示条**：检测到当前翻译不了时常驻一条，按钮直达设置→翻译源，配好即消。判据不能看 `isConfigured()`——本地源无必填字段、永远报"已配置"；要按真实可达性判：云端源有 key 就算可用（**不探测**，每次启动发一次 API 调用会烧配额），本地源探 localhost 端点（免费、离线模式下也合法）。区分两类要读 `requiresNetwork`，它是 provider 类上的 getter 不在 metadata 里，应让 `getAllProvidersStatus()` 从实例读它带进 IPC 载荷，别往 metadata 抄一份（"能力看实现不看元数据"）
- **首次启动轻弹窗**：走 ConfirmDialog 的样式语言，内容 = 功能速览 + 指明先配翻译源，不在弹窗里做配置。**`guide.*` 那组 i18n 是现成文案且全仓零消费者**（4 张功能卡 + 副标题 + "不再显示"），正好复活
- **两处一次性小提示**：用户点名了**改写风格**与**收藏**，先只做这两处（一次性提示铺太多，第一次打开处处冒泡反而烦）

状态存 electron-store 顶层 `onboarding: { welcomeSeen, hints: {...} }`，配一个"重新查看引导"复位入口放设置→关于（免得成幽灵键）。

已确认**不做**：简略/全部设置切换早就实现了（`SettingsPanel/index.jsx` 的 `simpleMode`，默认简略，带一次性提示），用户看过后表示"已经够了，不用动"。

### Incremental unit test coverage buildout

`tests/unit/` 现有 34 个测试文件（selection / stack 五件套 / OCR 坐标 / 语言目录与选择器 / 历史中毒数据 / 渲染端日志转发 等）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

