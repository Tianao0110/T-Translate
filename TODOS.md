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

### LLM 视觉 OCR 丢失位置信息（2026-07-12 用户提出，研究性质）

llm-vision 引擎（API 交给本地视觉模型识别）只返回纯文本、无 bbox——悬浮窗散点模式被迫回退整段（徽标"散点→整段"），漫画/标签场景体验降级。候选方向（需实验验证）：

- ① **结构化输出 prompt**：要求模型返回行级 JSON + 归一化坐标。Qwen2-VL 系原生支持 grounding（bbox 定位），但小参数本地模型坐标精度未知，且不同模型能力参差——需按模型分级启用
- ② **混合管线**：本地 PP-OCR det 模型只出框（det 权重仅 ~9MB、无需 rec 语言包），裁切文本条喂 LLM 识别——框准、字准，代价是 N 个框 N 次调用（或拼图批量）
- ③ **场景引导**：散点需求场景（悬浮窗）提示切换本地 OCR 引擎，llm-vision 保持整段专用——零研发成本的兜底文案方案

### Full onboarding wizard

The v0.2.6 OCR error-to-guidance fix is the short version. Full version: first-launch welcome flow, guided OCR/LLM setup, feature tour. Needs design.

### Incremental unit test coverage buildout

`tests/unit/` 现有 15 个测试文件（selection 三件套 / stream-throttle / ocr-packs / 历史导入 / stack 五件套：service·cache·i18n·ocr·secure-vault / secure-audit / error-classification 等）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

