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
- ~~泰米尔 / 泰卢固 / 卡纳达三个语言包~~ ✅ **已加入（2026-08-19）**，识别语言 56→59。上游 `ka.zip` 名为格鲁吉亚语码实为卡纳达语，我们用 `kn`；实测质量低于同代其他包（74/71/71% 对天城文 87%），已写进 OCR_MODELS.md 已知边界。**待发布动作：`npm run ocr:release` 后把三个新 zip + manifest 传上 ocr-models Release**
- ~~百度 Unlimited-OCR vLLM 直连提示~~ ✅ 已写入 docs/FAQ.md（2026-07-10）

### 真 asar 热替换（仅评估，不承诺）

只覆盖纯 JS 改动；koffi/uiohook/node-screenshots/OCR 全在 asarUnpack，native 或 Electron 版本一变必须回全量；且热更新通道必须做包签名校验，否则是供应链攻击口。当前差分下载（v0.2.8 起）已覆盖大部分收益。

### AI 动作框架收尾项（v0.3.3 已发布，剩数据驱动项）

- ~~长段阈值仍是估值~~ ✅ **改成用户可配（2026-08-19）**：设置 → AI 动作 →「总结」出现的门槛，默认仍是 150。用户拿捏比我们实测更省事，也更准——门槛该多高本来就取决于他看什么内容。英文按词数换算（×0.8），只让用户调一个数
- **理解模式结果不进历史**：那条路没有翻译条目可挂（AI 结果是翻译的附属，无附主则不写）。若要回看，需要单独设计一个"理解记录"，或让理解模式也留一条主条目——属产品决策，未定

### LLM 视觉 OCR 丢失位置信息（其余六个引擎已于 v0.3.4 补齐，只剩这一个）

v0.3.4 给 Windows OCR / Azure / Google Vision / OCR.space / 百度 五个引擎补上了行级坐标（坐标契约与粒度铁律见 `src/stack/ocr/blocks.js` 注释）。**llm-vision 仍是唯一无坐标的引擎**——模型只被要求输出文字，散点模式下退回整段（现在两种模式都会给提示）。候选方向（需实验验证，需要机器上有 Qwen2-VL 类模型）：

- ① **让模型返回坐标** —— ✅ **2026-08-19 实测可行**，用户机器上的 `baidu.unlimited-ocr`（LM Studio）：800×520 合成图，**5/5 块全中、位置误差均值和最大都是 3px、文字逐字准确、1.3 秒**，全部框都在 `coordsFitFrame` 容差内。实现要点：
  - ⚠️ **别逼模型输出 JSON**。第一版提示词要求 `[{"text":..,"box":..}]`，结果既漏块又开始胡编文字；换成"列出每个文字块和它的边界框"这种它原生会说的话就全对。用模型的原生格式，别跟它较劲
  - 它的原生格式是每行 `text [x1,y1,x2,y2]文字`，坐标**归一化到 0-1000**，要按画面尺寸还原
  - 解析时文本捕获必须在换行处截断：`[^\[]*` 会贪婪吞掉下一块的 `text` 关键字，导致每隔一块漏一块（我踩过，一度以为是模型漏块）
  - **合成图的成绩不能外推**：高对比、无锯齿、背景干净。漫画气泡/视频字幕/小字截图要另外验
  - **必须按模型分级，已有反例**：同机 `qwythos-9b-v2`（Qwen-VL 系，`bbox_2d`/`text_content` 格式）文字也是 5/5 全对，但**坐标只有 2/5 可用、位置误差均值 97px**，另外三个是废框——上下颠倒（`[195,300,500,225]`）、竖条形状（`[40,10,70,300]`）
  - ⚠️ **`coordsFitFrame` 拦不住这种废框**：它们全都在画面范围内，只是形状没有意义。接这个功能必须补一层框合法性校验——`x2>x1 && y2>y1`、非退化尺寸、高不大于宽（一行文字不可能竖着）。没有这层，坏坐标会直接变成散点面板上错位的窗格
  - 探针在 scratchpad `probe-vision-coords.js`（自渲染标准答案 + 按像素量误差 + 复用 coordsFitFrame 的判据），复跑成本很低
- ② **混合管线**：本地 PP-OCR det 模型只出框（det 权重仅 ~9MB、无需 rec 语言包），裁切文本条喂 LLM 识别——框准、字准，代价是 N 个框 N 次调用（或拼图批量）
- ③ **场景引导**：散点需求场景（悬浮窗）提示切换本地 OCR 引擎，llm-vision 保持整段专用——零研发成本的兜底文案方案

**四个在线引擎的坐标只有 fixture 验证**（按各家文档的响应形状建的，见 `tests/unit/ocr-blocks.test.js`），无密钥无法端到端实测；Windows OCR 与本地引擎是实测过的。哪天有密钥了，实拍一次散点排版确认坐标空间无误。

### ~~悬浮窗截图闪烁~~ 已关闭（2026-08-19 用户实测「暂时没有发现问题」）

反截屏句柄修好后本想去掉降透明度那层兜底以消除闪烁，但用户实机看不到闪烁，
去掉兜底就成了纯风险没有收益（判错的代价是 OCR 到悬浮窗自己的译文）。**兜底
保留，别再动这块**；哪天有人真的抱怨闪烁再说。

### ~~跨段术语一致性~~ 已完成，但**范围被用户主动收窄**（2026-08-19）

做出来的是：文档翻译工具栏「术语检查」→ 弹窗列出术语库里有、但译文仍是原文的
词 → 全部替换 → 段落里原文词与替换词双向高亮，点高亮可看原词并单独撤销。
零模型调用，纯字符串匹配。

**两件事被明确否掉，别再提议：**

- **「模型把术语译成了别的词」这类不报**。第一版做了，用户实测后要求整条删除，
  理由是产品定位：「必须让用户先进一步理解大概内容，而不是那些专业级别的」。
  这类结果既修不了（字符串里没有信息指明该改哪一段），又是专业译者的活，而且
  模型在变好、这类问题会自己减少
- **原计划的第二步「未知术语的模型对齐」（扫全文找跨段译法不一致的词）同理作废**。
  它正是"专业级别"的那种功能，且每个候选词都要调模型——与用户「我注重效率，其次
  是质量」的排序相反。要复活得用户明确重提

顺带修掉的真 bug：术语库的语言不固定（store 的去重键本来就是
`(sourceText, targetLanguage)`），而 `getGlossaryTerms()` 曾不分语言全部返回，
译成法语时会把中文译法塞进去，且静默无报错。现在按目标语言取，没标语言的旧
条目（导入文件不带语言）仍可用。

### 语言选择器的后续（主体已随 v0.3.5 发布）

134 种目录 + 新选择器 + 自定义语言 + 文档段落讲解已落地。剩余候选：

- **可以扩到 240+**：谷歌 2024 年又加了 110 种（含藏语、粤语等）。核对脚本 `scripts/verify-google-languages.mjs` 现成，跑一轮就知道哪些码可用；未做是因为那批低资源语言翻译质量参差，等有人提再说
- **模型语言表只有五条**（Llama 3.x / Qwen 2-3 / NLLB / MADLAD / Opus-MT，见 `config/model-language-coverage.js`）。故意不求全——缺条目零代价，只在降级链排序上生效、绝不进 UI。Mistral、Gemma、Phi 跨版本语言覆盖差异太大，写进去准确度不如不写
- **选择器没有搜索框**：设计上靠字母索引，134 种够用；真扩到 240+ 时要重新评估
- ⚠️ **暂时性死区已犯三次**，第三次（一键总结的 concurrency）**漏进了 main**。
  "人工留意"这个缓解手段就此作废——留意的人是我，照样漏。现在的防线是
  `tests/unit/document-translator-mount.test.jsx`：把组件挂载一次。已验证它对着
  崩溃版本会红。**它只覆盖必然求值的那部分**（组件体顶层、依赖数组），条件分支里
  的错误照样漏——所以其他大组件也该各加一个挂载冒烟测试，尤其 FloatingWindow、
  SelectionTranslator、SettingsPanel
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

### ~~绿色便携化（数据不落 APPDATA）~~ 已评估，暂不做（2026-08-10 用户拍板）

结论：可行、约 1-2 天、风险低，不影响现有安装版。评估结论存档如下，重启时不必重推。

- **全仓 userData 落点只有 5 处，且全部走 `app.getPath('userData')`，零硬编码路径**：electron-store 的 config.json、[logger.js:71](electron/utils/logger.js:71) 的 logs/、[ocr-engine.js:39](electron/utils/ocr-engine.js:39) 的 ocr-models/、[translation-stack.js:52](electron/ipc/translation-stack.js:52) 的 Caches/、Chromium 自带的 Local Storage/IndexedDB。**一句 `app.setPath('userData', …)` 全部跟着搬**
- ⚠️ **唯一真陷阱是 require 顺序**：[main.js:12](electron/main.js:12) require `./state` 时 [state.js:36](electron/state.js:36) 顶层就 `new Store()` 了，setPath 必须更早（main.js 最顶或抽独立首个 require）。顺序错了不报错，只会静默写回老位置
- ⚠️ **userData 之外还有一处残留**：[system.js:265](electron/ipc/system.js:265) 的开机自启走 `setLoginItemSettings` → 写 `HKCU\...\Run` 注册表。「卸载完全不留」要成立就必须处理它（便携版隐藏该开关或退出时清），否则是假承诺
- 其余：便携版不能装进 Program Files（不可写）→ electron-builder 加 `portable`/`zip` target 与 NSIS 并存，前者自带 `PORTABLE_EXECUTABLE_DIR` 可当检测依据；老用户迁移提示；OCR 模型跟着搬（高精度包 139MB）需在文档说明

### ~~首次启动弱引导~~ ✅ 三块全部落地（2026-08-19）

主面板常驻提示条（判据复用真实翻译路径的过滤器；云端源有 key 就算数不探测，
本地源探端点）+ 首次启动功能速览弹窗（复活了零消费者的 `guide.*` 文案）+ 改写
风格与收藏两处一次性提示。状态存 electron-store 顶层 `onboarding`。

⚠️ **「重新查看引导」入口按用户要求删了**，改由全量重置一并清 `onboarding`——
所以 `resetSettings` 里那份"要清的 side-band 存储"清单现在也管着它，以后再加
这类标记记得跟上。

### Incremental unit test coverage buildout

`tests/unit/` 现有 34 个测试文件（selection / stack 五件套 / OCR 坐标 / 语言目录与选择器 / 历史中毒数据 / 渲染端日志转发 等）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

