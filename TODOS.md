# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## 发布流程备忘（每版适用）

- 打包：`npm run dist`，产物在 `release/`；GitHub Release **必传三件套** `T-Translate-Setup-x.x.x.exe` + `.exe.blockmap` + `latest.yml`（缺 latest.yml 用户端检查更新直接报错）
- OCR 模型热更新只改 `ocr-models` Release 资产（bump manifest version 即可，无需发版），维护手册见 [docs/OCR_MODELS.md](docs/OCR_MODELS.md)
- 语言包 rec 模型目前 v4 代际；上游出 v5 多语言 ONNX 后按 OCR_MODELS.md「更新模型」流程换入

## 下一版本候选

### 主进程内存体检+瘦身（2026-07-10 用户实测立项）

用时主进程 ~700MB（标准档、各渲染窗仅 40-50MB；闲时可回落 ~200MB，弹性正常非泄漏）。大头=ONNX arena（推理后不归还）+图像链缓冲。先量化拆账单再动刀：
- 首选杠杆：OCR 会话空闲驱逐（N 分钟无识别 evictSessions 释放 arena，[ocr-engine.js](electron/utils/ocr-engine.js) 已有驱逐机制缺空闲定时器；重建 ~0.5s 与 deep 检查同量级）
- 次选：esearch.init ortOption 传 sessionOptions 做 arena 收缩实验（需实测速度代价）；图像链 buffer 滞留审计
- 已复核不动：划词窗常驻保留（仅 40-50MB）；闲时 200MB 是 Electron 多窗地板

### 主题二期候选（一期已随 v0.3.1 落地 2026-07-04）

- **浅色顶栏柔化**：浅色主题的亮蓝渐变顶栏保留了品牌感（用户未拍板动它）；如后续想统一，参照深色做法（表面色 + 强调只标活跃项），提案 artifact 05 节有示意
- 备忘：主题决策全记录在 workflow-playbook 记忆（琥珀 C3/青碧 F2/彩虹签名 R1/渐变保留/米白豆沙弃案）；新增强调面文字必须用 `--text-on-accent`，独立窗口（悬浮/划词）不加载 App.css 令牌表、只能用局部变量

### 划词检测完整性（0.2.9 已基本落地，剩数据驱动项）

- README 应用支持列表 — 等日常使用积累（`npm run start:debug` 探针日志按应用记录走哪层），逐项标注已知限制
- UIA TextPattern 第 4 层 — **默认不建**（承重墙修复后覆盖大幅改善）；仅当日志出现成片失败样本再评估

### PP-OCRv6 后续候选（换代 + 高精度档均已随 v0.3.0 落地 ✅ 2026-07-04）

基础包已换 v6-small（feat/ocr-v6：新 id base-v6 + 空格门控按代际 + 拉丁包退役 + manifest 新旧双轨服务老客户端）；medium 高精度档已落地（feat/ocr-model-tier：模型档位控件 + base-v6-hq 可下载可切换 + 引擎按档位解析 base 目录）。发布动作见上方 v0.3.0 节步骤 2。剩余候选：

- ~~doc_cls 旋转分类器~~ **已实测弃案（2026-07-04）**：倒置图可纠正，但日文横排截图被误判竖排、韩文包乱码——主场景回归不可接受，详见 OCR_MODELS.md 已知边界（含复现方法）。别再捡
- 档位备忘：v6 全系仅 tiny/small/medium 三档（官方页 2026-07-03 已核），tiny 无假名不可用；v6 无独立多语言模型，韩/西里尔/天城/阿拉伯继续 v4 包；spike 复跑脚本已随 2026-07-10 temp 清理退役（结论与复现方法保全在 docs/OCR_MODELS.md 已知边界节）
- 合入时补测：竖排文本、真实截图小字（过全量 probe.js + 实拍）
- 顺带：百度 Unlimited-OCR 只有 NVIDIA GPU 路径，不适合内置；其 vLLM 镜像是 OpenAI 兼容 API，有 N 卡用户可把 llm-vision 端点指过去零改动直连——可写 FAQ

### 真 asar 热替换（仅评估，不承诺）

只覆盖纯 JS 改动；koffi/uiohook/node-screenshots/OCR 全在 asarUnpack，native 或 Electron 版本一变必须回全量；且热更新通道必须做包签名校验，否则是供应链攻击口。当前差分下载（v0.2.8 起）已覆盖大部分收益。

### 悬浮窗散点/整段判定加强 或 手动模式切换（2026-07-06 用户提出）

散点子窗口判定是纯几何启发式（[pipeline.js:37](src/services/pipeline.js:37) shouldUseScatteredMode：列对齐+行距+水平散布三条件），误判时整段文字被炸成子窗格、或散落 UI 标签被并成一段。两个方向（可只做②）：
- ① 启发式加强：字号一致性/多列检测/块数上限等补充信号
- ② **工具栏手动三态开关（自动/散点/整段，持久化）**——判定不可能全对，手动兜底符合产品习惯，推荐先做这个；散点判定结果在结果区提示当前模式，切换后用上次截图立即重排（imageData 需暂存一份）

### Full onboarding wizard

The v0.2.6 OCR error-to-guidance fix is the short version. Full version: first-launch welcome flow, guided OCR/LLM setup, feature tour. Needs design.

### Incremental unit test coverage buildout

`tests/unit/` 现有 15 个测试文件（selection 三件套 / stream-throttle / ocr-packs / 历史导入 / stack 五件套：service·cache·i18n·ocr·secure-vault / secure-audit / error-classification 等）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

