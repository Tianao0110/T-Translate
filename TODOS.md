# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## 发布流程备忘（每版适用）

- **版本号五处一起改，缺一处就对不上**：`package.json` / `package-lock.json`（自述的两个 version 字段，手改 package.json 不会带上它——v0.3.0～v0.3.2 三版都漂着发出去了）/ `README.md` 徽章 / `README.zh-CN.md` 徽章 / `CHANGELOG.md` 把「未发布」**改标题**成 `## vX.Y.Z — 日期 — 主题`（别在它前面新插一节，那样两条旧记录会留在孤立的「未发布」里）。代码里没有硬编码版本，运行时读 `app.getVersion()`，不用管；docs 里的历史版本号是叙述，别改
- **新功能发版前对齐文档**：README×2 功能表 + 功能段、docs/FAQ（用户会问什么）、docs/ARCHITECTURE + DEVELOPMENT（后来人怎么改）。v0.3.3 的 AI 动作就是发完才发现四份文档零提及
- 打包：`npm run dist`，产物在 `release/`；GitHub Release **必传三件套** `T-Translate-Setup-x.x.x.exe` + `.exe.blockmap` + `latest.yml`（缺 latest.yml 用户端检查更新直接报错）。⚠️ 打包前**关掉 VS Code**：它锁着 `release/win-unpacked/resources/app.asar`，`npm run dist` 会以 `EBUSY` 失败；非要并行就换输出目录 `-c.directories.output=release-xxx`
- 模型热更新不用发版，只改对应 Release 资产：OCR 走 `ocr-models` tag（手册 [docs/OCR_MODELS.md](docs/OCR_MODELS.md)），听译走 `audio-models` tag（`npm run audio:release` 生成资产）。**两个 tag 都必须勾 Pre-release**，否则 electron-updater 会把它们当最新版去找 latest.yml；同理**永远别开 allowPrerelease**
- 听译改动发版前跑 `npm run smoke:listen`（整链 13 项断言 + 延迟数字），改了模型或分发链必跑
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

### 真 asar 热替换（仅评估，不承诺）

只覆盖纯 JS 改动；koffi/uiohook/node-screenshots/OCR 全在 asarUnpack，native 或 Electron 版本一变必须回全量；且热更新通道必须做包签名校验，否则是供应链攻击口。当前差分下载（v0.2.8 起）已覆盖大部分收益。

### LLM 视觉 OCR 丢失位置信息（其余六个引擎已于 v0.3.4 补齐，只剩这一个）

v0.3.4 给 Windows OCR / Azure / Google Vision / OCR.space / 百度 五个引擎补上了行级坐标（坐标契约与粒度铁律见 `src/stack/ocr/blocks.js` 注释）。**llm-vision 仍是唯一无坐标的引擎**——模型只被要求输出文字，散点模式下退回整段（现在两种模式都会给提示）。候选方向（需实验验证，需要机器上有 Qwen2-VL 类模型）：

- ① **让模型返回坐标** —— ✅ **2026-08-19 实测可行**，用户机器上的 `baidu.unlimited-ocr`（LM Studio）：800×520 合成图，**5/5 块全中、位置误差均值和最大都是 3px、文字逐字准确、1.3 秒**，全部框都在 `coordsFitFrame` 容差内。实现要点：
  - ⚠️ **别逼模型输出 JSON**。第一版提示词要求 `[{"text":..,"box":..}]`，结果既漏块又开始胡编文字；换成"列出每个文字块和它的边界框"这种它原生会说的话就全对。用模型的原生格式，别跟它较劲
  - 它的原生格式是每行 `text [x1,y1,x2,y2]文字`，坐标**归一化到 0-1000**，要按画面尺寸还原
  - 解析时文本捕获必须在换行处截断：`[^\[]*` 会贪婪吞掉下一块的 `text` 关键字，导致每隔一块漏一块（我踩过，一度以为是模型漏块）
  - ❌ **真实截图上失败，方向①因此不成立为通用功能**（2026-08-19 二次实测，2000×965 的亚马逊商品页）：45.7 秒、只读对开头四五块，随后陷入重复幻觉——同一句 "The Ground Truth image displays a single, solid horizontal l…" 连吐 20 多遍，框在图上排成一列梯子。缩到 1000px / 700px 都试过：**幻觉照旧**（29 块里 23 块是同一句），缩放只是让框变规整
  - ☠️ **最要命的是这些坏结果全部通过校验**：33 个框里 32 个形状合法、全部在画面内。`coordsFitFrame` 和上面那套框合法性校验**都拦不住**——框是规规矩矩的矩形，只是落在空白处、配着编造的文字。唯一能识别的信号是"大量块文字完全相同"，但那已经是给一个根本没在干活的模型打补丁
  - **合成图那 3px 只证明了简单版面可行**（稀疏、高对比、无背景图）。漫画气泡、字幕条这类可能仍然可用，但程序**无法预先判断自己面对的是哪一种**
  - 📌 **结论：优先考虑方向②（本地 det 出框 + LLM 出字）**。det 模型不会凭空编造位置，而位置正是这里唯一不能靠"重试/校验"补救的东西。另外真实截图 43-46 秒本身对悬浮窗场景就是不可接受的
  - **必须按模型分级，已有反例**：同机 `qwythos-9b-v2`（Qwen-VL 系，`bbox_2d`/`text_content` 格式）文字也是 5/5 全对，但**坐标只有 2/5 可用、位置误差均值 97px**，另外三个是废框——上下颠倒（`[195,300,500,225]`）、竖条形状（`[40,10,70,300]`）
  - ⚠️ **`coordsFitFrame` 拦不住这种废框**：它们全都在画面范围内，只是形状没有意义。接这个功能必须补一层框合法性校验——`x2>x1 && y2>y1`、非退化尺寸、高不大于宽（一行文字不可能竖着）。没有这层，坏坐标会直接变成散点面板上错位的窗格
  - 探针在 scratchpad `probe-vision-coords.js`（自渲染标准答案 + 按像素量误差 + 复用 coordsFitFrame 的判据），复跑成本很低
- ② **混合管线**：本地 PP-OCR det 模型只出框（det 权重仅 ~9MB、无需 rec 语言包），裁切文本条喂 LLM 识别——框准、字准，代价是 N 个框 N 次调用（或拼图批量）
- ③ **场景引导**：散点需求场景（悬浮窗）提示切换本地 OCR 引擎，llm-vision 保持整段专用——零研发成本的兜底文案方案

**四个在线引擎的坐标只有 fixture 验证**（按各家文档的响应形状建的，见 `tests/unit/ocr-blocks.test.js`），无密钥无法端到端实测；Windows OCR 与本地引擎是实测过的。哪天有密钥了，实拍一次散点排版确认坐标空间无误。

### ~~悬浮窗截图闪烁~~ 已关闭（2026-08-19），**降透明度兜底保留别动**

用户实机无闪烁，去掉兜底是纯风险（判错代价 = OCR 到悬浮窗自己的译文）。有人真抱怨再议。

### 语言选择器的后续（主体已随 v0.3.5 发布）

134 种目录 + 新选择器 + 自定义语言 + 文档段落讲解已落地。剩余候选：

- **可以扩到 240+**：谷歌 2024 年又加了 110 种（含藏语、粤语等）。核对脚本 `scripts/verify-google-languages.mjs` 现成，跑一轮就知道哪些码可用；未做是因为那批低资源语言翻译质量参差，等有人提再说
- **模型语言表只有五条**（Llama 3.x / Qwen 2-3 / NLLB / MADLAD / Opus-MT，见 `config/model-language-coverage.js`）。故意不求全——缺条目零代价，只在降级链排序上生效、绝不进 UI。Mistral、Gemma、Phi 跨版本语言覆盖差异太大，写进去准确度不如不写
- **选择器没有搜索框**：设计上靠字母索引，134 种够用；真扩到 240+ 时要重新评估
- ⚠️ **暂时性死区已犯三次**，第三次（一键总结的 concurrency）**漏进了 main**。
  "人工留意"这个缓解手段就此作废——留意的人是我，照样漏。现在的防线是
  `tests/unit/document-translator-mount.test.jsx`：把组件挂载一次。已验证它对着
  崩溃版本会红。**它只覆盖必然求值的那部分**（组件体顶层、依赖数组），条件分支里
  的错误照样漏——FloatingWindow / SelectionTranslator /
  SettingsPanel 三个挂载冒烟测试已随 v0.3.7 批 1 补齐
- **`no-use-before-define` 现状**：开 `{variables:true, functions:false}` 还剩 20 处
  命中，分布在 6 个组件 + 2 个工具文件，**全部是回调体内的调用期引用（运行时无害）**，
  危险的渲染期引用已清零。要开成 error 得先把这 20 处重排，风险在于 FloatingWindow
  那几处涉及 useState 声明位置。**没做，等哪次动那些文件时顺手**

### ~~内置本地翻译模型（腾讯混元 MT 1.8B）~~ 已评估，不做（2026-08-19 用户拍板）

用户设想：程序自己加载 GGUF，调用时才载入，彻底不依赖 LM Studio / Ollama。
**否决理由是用户侧的**——「对低配用户来说确实无法确认是否有用」。2 GB 常驻内存
（当前峰值的三倍）+ 1.9 GB 磁盘，换一个在低配机器上可能慢到没法用的东西。

评估结论存档，重启时不必重推：

- **提示词层已经是现成的**：[model-template-mapping.js](src/config/model-template-mapping.js)
  的 Hunyuan MT 规则示例里就写着 `hunyuan-mt-1.8b`，`mt-direct` 早在跑
- **接入层几乎白送**：本地源走 OpenAI 兼容 HTTP，加一个源 = presets-core.js 里
  一条带 endpoint 的记录
- **分发层现成**：OCR 语言包那套（manifest + 流式下载 + sha256 + 解压 + 可卸载）
  直接能装模型
- **缺的只有推理运行时**。两种形态：打包 `llama-server.exe` 起子进程（上层零改动、
  崩了只废这一个源）优于 `node-llama-cpp` 进程内加载（原生插件崩溃带走主进程）。
  用户想要的是后者
- ⚠️ **真正的硬门槛是许可证，没查过**：腾讯混元系列走自家社区许可，历史上有地域
  排除、月活阈值、署名要求，而分发权重正是这类条款管的事——本项目自己写着"永远
  免费、源码开放"。**要复活这条，第一步是逐条读模型页协议，不是写代码**
- ⚠️ **第二个门槛是实测速度**：1.8B Q8_0 纯 CPU 翻一句要多久，只能装 LM Studio
  拉这个模型掐表。这个数决定一切，我们谁都没测

**价值定位别记错**：谷歌翻译已内置、免费、零下载，多数语种上比 1.8B 强。内置
模型的价值是离线 + 隐私 + 开箱即用，不是翻得更好。

### ~~绿色便携化（数据不落 APPDATA）~~ 已复活：2026-08-29 用户定「数据归位」方向后，此项即其终态（见上方数据归位节的第三步）；下面的评估结论直接用

结论：可行、约 1-2 天、风险低，不影响现有安装版。

- **全仓 userData 落点全部走 `app.getPath('userData')`，零硬编码路径**：electron-store 的 config.json、[logger.js:71](electron/utils/logger.js:71) 的 logs/、[translation-stack.js:52](electron/ipc/translation-stack.js:52) 的 Caches/、Chromium 自带的 Local Storage/IndexedDB。**一句 `app.setPath('userData', …)` 全部跟着搬**。模型不在此列了——v0.4.0 起 OCR 与听译模型都落安装目录的 `models/`（[model-root.js](electron/utils/model-root.js)），便携化时它们本来就跟着程序走
- ⚠️ **唯一真陷阱是 require 顺序**：[main.js:12](electron/main.js:12) require `./state` 时 [state.js:36](electron/state.js:36) 顶层就 `new Store()` 了，setPath 必须更早（main.js 最顶或抽独立首个 require）。顺序错了不报错，只会静默写回老位置
- ⚠️ **userData 之外还有一处残留**：[system.js:265](electron/ipc/system.js:265) 的开机自启走 `setLoginItemSettings` → 写 `HKCU\...\Run` 注册表。「卸载完全不留」要成立就必须处理它（便携版隐藏该开关或退出时清），否则是假承诺
- 其余：便携版不能装进 Program Files（不可写）→ electron-builder 加 `portable`/`zip` target 与 NSIS 并存，前者自带 `PORTABLE_EXECUTABLE_DIR` 可当检测依据；老用户迁移提示

### ~~听译安全审查~~ 已交付（v0.4.1）

报告在 gstack `v041-listen-security-audit-2026-08-30.md`。挖到并修掉一个 P0（模型包卸载的目录穿越，两域共享代码）+ IPC 面三处上限。**手放模型的信任口径已拍板=本机信任**（用户 2026-08-30）：不做校验，写进 ARCHITECTURE；保证的是坏文件不拖垮主程序（已成立），并且载入期崩溃不再白重试。剩下的：

- **P3 不修，记着**：`ipcMain` 不校验 sender，被攻破的主窗口渲染进程能拉起 ASR worker（约 600MB）。拿不到转写内容（只发给悬浮窗），纯资源消耗。全 App 通道都是这个形态，要做就整体做一批
- 文档宣称三条已核（音频不落盘 / 非麦克风成立；「不截屏」那条随 v0.4.1 变成结构事实并已写进 FAQ）

### 数据归位：UserData → 程序目录（用户 2026-08-29 定为长期方向；**排期=听译完善之后**——先走完 v0.4.1 听译三件与 TTS 批，再开第一步。铁律不等排期，即刻生效）

**即刻生效的开发铁律**：新功能落盘一律走程序目录优先的 data-root（model-root.js 模式：安装目录可写用之，否则回退 userData），**不再新增裸 `app.getPath('userData')` 落点**。审计固定动作加一条：grep 新增 userData 引用。

**终态=一步切换而非逐项搬**：Chromium 自管存储（localStorage/IndexedDB，zustand 持久化在里面）不能单独指路径，逐项搬永远剩这一块。终点是启动最早期 `app.setPath('userData', 安装目录\data)` 整体迁移——即 2026-08-10 搁置的便携化方案，评估仍有效（require 顺序陷阱=state.js 顶层 new Store 之前必须 setPath / 开机自启注册表残留 / Program Files 不可写回退），本指令将其复活为正式方向。

**两个产品契约碰撞，实施批拍板**：①自动更新清安装目录——models 的 NSIS stash/restore 护栏要扩成盖住整个 data 目录 ②卸载语义反转：现承诺"卸载默认保留数据"，数据进安装目录后卸载=默认全删；绿色语义 or 卸载器也 stash，二选一

**分步节奏（每步独立可 ship）**：

- v0.4.x 第一步=模型归位收尾（本体已在安装目录，补存量）：
  - 老 userData 模型一键搬迁：设置页检测旧根有模型→提示+「移到程序目录」按钮，带进度跨盘复制+删，OCR/听译共用；搬完 activeDir 即显新位置
  - userData 回退要有感：安装目录不可写时设置页明示"当前存储在用户目录（安装目录不可写）"，不许静默
  - 卸载询问文案与安装目录 models 归属核对，两边别矛盾
- 第二步=轻量单文件（翻译缓存/会话日志/文档进度）改走 data-root，双根读兼容存量
- 第三步=整体切换（便携化终态）：config+保险库+Chromium 存储随 setPath 一次迁移，含一次性存量搬运与上述两契约拍板

新下载的默认位置 v0.4.0 已改（安装目录\models，[model-root.js](electron/utils/model-root.js)）；欠的是存量与边界：

- **老用户 userData 里的既有模型不会自动归位**（当时拍板不写迁移代码）——补「移到程序目录」入口：设置页检测到旧根有模型时出一行提示+按钮，带进度跨盘复制+删，OCR/听译共用；搬完 activeDir 即显新位置
- **userData 回退要有感**：安装目录不可写而回退 UserData 时，设置页明示"当前存储在用户目录（安装目录不可写）"，别静默——否则用户以为归位了实际没有
- 顺带核对：卸载询问文案说"删除全部用户数据"时，安装目录 models 随程序目录走、不在该清单内，两边文案别互相矛盾

### ~~指定程序的声音~~ 已交付（v0.4.1）

原生 WASAPI 层落在 [win-audio-capture.js](electron/utils/win-audio-capture.js)（koffi，不编译原生插件）；spike 报告在 gstack `v041-process-loopback-spike-2026-08-30.md`。全系统捕获也一并换到这条路，渲染端的 getDisplayMedia + 重采样已删除。剩下的活口：

- **只在这台机器上验过**（Win11 25H2 / build 26200）。Win10 与 Win11 早期 build 的实机表现未知；发版前的人工检查里过一遍「全部声音」这条路
- **泵用的是 20ms 轮询 + 2s 客户端缓冲**，没用 koffi 的 async 等待。长跑（数小时）下的漂移未测——smoke 只跑 1.5s
- **排除自家 TTS 尚未接线**：机制已具备（exclude 模式实测归零），但今天的规则仍是「听译模式下不朗读」。放开它属 TTS 批的事，届时把自家进程树默认排除
- 目标进程中途退出、中途开始播放的行为未测

### 听译上线后的观察项（v0.4.0 交付，非阻塞）

- **BGM 场景偶出过短碎段**：歌曲背景下 VAD 会把一两个字的碎片当成句子定稿（如「如。」），出屏且触发一次翻译。备选修法=过短定稿不出屏也不翻译。用户觉得烦再做
- **无痕模式是否放开听译**：当初禁用是因为会话日志记录识别原文；v0.4.0 起日志默认只写指标不写文字，禁用的原始理由已经不成立。要放开就得先确认无痕模式下"完全不写日志"还是"只写指标可接受"

### Incremental unit test coverage buildout

`tests/unit/` 现有 65 个测试文件、728 用例（selection / stack 五件套 / OCR 坐标 / 语言目录与选择器 / 历史与理解条目 / 段落笔记 / 历史保险库与存储路由 / store 白名单 / 模型包 core 与换包时序 / 听译模型发现与包列表 / 听译声音来源 / TTS 引擎落回 等）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

