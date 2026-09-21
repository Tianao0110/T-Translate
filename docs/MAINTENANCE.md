# 年度维护清单

T-Translate 进入维护模式后，每年照这份清单走一遍，目标是一到两天做完。它回答两个问题：**哪些地方会自己变坏**，和**今年有没有更好的模型值得换**。

程序不回传任何数据，没有崩溃上报，也没有使用统计。所以「坏没坏」只能靠这份清单主动去查，「用户怎么看」只能从 GitHub Issues 和论坛里收。

## 怎么用

- **一年一次**，外加两种被迫的时候：某个依赖出了高危安全公告；用户反馈某个在线源或模型链接失效。
- **先分诊，再动手**。第 1 节半小时看完，决定今年哪几层要动。没坏、没有安全问题、也没有明显更好的替代，就不动。追新不是目的。
- **一层一个提交**。每层改完先过它自己那一行的验证，再进下一层。混在一起出了问题分不清是谁的。
- **全部做完过第 8 节**，然后按平常的流程发版。
- 做完在文末「年检记录」里记一行。

## 1. 分诊（半小时）

| 看什么 | 去哪看 | 要动的信号 |
| --- | --- | --- |
| 依赖安全公告 | `npm audit` | 有 high / critical，且不是只影响开发工具 |
| Electron | electronjs.org 的发布说明与安全公告 | 当前大版本已经出了支持期（Electron 只维护最新三个大版本） |
| 在线源的型号与接口 | 第 6 节那张表里的弃用页 | 默认型号被关停，或接口版本被下线 |
| 模型下载链接 | 说明书第 5 章、设置页各模型卡片上的链接 | 打不开，或上游重新上传过文件（哈希会变） |
| 用户反馈 | 本仓库的 Issues | 同一类问题出现两次以上 |
| 文档 | `npm run check:docs` | 红了 |

## 2. 底层引擎（最贵的一层）

这一层换版要重编或逐字段核对，是每年成本的大头。没有安全问题、上游也没有我们要的东西，可以隔年再动。

| 项 | 现钉版本 | 钉在哪 | 怎么换 | 换完跑 |
| --- | --- | --- | --- | --- |
| llama.cpp 运行时（含视觉、Vulkan） | b10853 | `electron/tengine/runtime/llama-manifest.json` 与 `llama-abi.js` | [T-ENGINE.md](T-ENGINE.md) 第三节「年度换版流程」五步，做完对着第九节检查单勾一遍 | golden 单测、`smoke:llm`、`smoke:llm-host`、`smoke:llm-vision`、`smoke:llm-vision-host`、`smoke:llm-stack` |
| sherpa-onnx 与自编的 WebGPU DLL | 1.13.7，精确版本 | `package.json` 与 `native/sherpa-onnx-webgpu/` | 按 [native/sherpa-onnx-webgpu/README.md](../native/sherpa-onnx-webgpu/README.md) 的配方重编，要 VS 2022 与 cmake，约 25 分钟 | `node scripts/build/overlay-sherpa-runtime.js --check`、`smoke:listen`、`bench:listen` 中英各一次 |
| onnxruntime-node | 1.26.0，精确版本 | `package.json` | **它和上一项锁死**：sherpa 用的 `onnxruntime.dll` 是它提供的，升任何一个都要重编另一个。两个一起升，或都不升 | `smoke:ocr`，带 `--gpu` 再跑一次 |
| koffi | ^2.15 | `package.json` | llama、声音捕获、Win32 调用三处都靠它。升级前读 [T-ENGINE.md](T-ENGINE.md) 第四节和 [design/selection.md](design/selection.md) 第 2 节里记的坑 | 上面全部 smoke，外加手测一次划词 |
| 鼠标钩子、截图、画布（uiohook-napi、node-screenshots、@napi-rs/canvas） | 见 `package.json` | `package.json` 与 `build.asarUnpack` | 预编译原生件，跟着 Electron 的 Node ABI 走；升 Electron 后先确认它们有对应的预编译包 | 手测：划词、截图、文档里的图片 |

sherpa 那一项是最可能卡住人的：没有装 VS 2022 的机器编不出来。换机器前先确认这台机器上的构建环境还在。

## 3. 平台与打包

- **Electron**（现 ^42.4）：一年大约跳六个大版本。逐个读 breaking changes，重点回归 `utilityProcess`（三个引擎宿主）、`net.fetch`（全部网络请求的唯一出口）、`safeStorage`（密钥与历史保险库）、截图排除（内容保护）、各窗口的安全旗标。
- **electron-builder 与 NSIS**：`installer/installer.nsh` 带 UTF-8 BOM，别用会丢 BOM 的编辑器保存；里面有更新护栏（更新时保住模型与数据）和卸载保留逻辑，升级后装一次、更新一次、卸载一次，三样都要试。
- **electron-updater**：Release 必须带 `latest.yml`；两个模型 tag（`ocr-models`、`audio-models`）必须是 Pre-release；永远别开 `allowPrerelease`。
- **electron-store 停在 8**：9 起只有 ESM，主进程是 CommonJS，升了直接起不来。除非先把主进程迁到 ESM，否则不动。
- **构建链**：Node 22（CI 在 `.github/workflows/ci.yml`）、Vite、esbuild（精确版本，打翻译栈用）、Vitest、ESLint。升完跑一遍门禁即可。
- **范围内升级与大版本升级是两回事**。`npm update` 只升到 `package.json` 里范围允许的最新，通常是补丁与小版本，每年做一次、跑完第 8 节即可；之后记得重跑 `node scripts/build/overlay-sherpa-runtime.js`，它会把 sherpa 的补丁 DLL 冲掉。大版本（`npm outdated` 的 Latest 一列）逐个评估破坏性变更，一次只升一个。

## 4. 年度模型评估

每年看一次：今年有没有更好的模型，值不值得换进白名单。三类分开看，互不牵连。

| 类别 | 现在用的 | 白名单在哪 |
| --- | --- | --- |
| 本地翻译与 AI 动作 | Qwen3-1.7B（通用）、Hy-MT2-1.8B（仅翻译） | `electron/shared/llm-packs.js` |
| 本地视觉识别 | PaddleOCR-VL-1.6（主模型加图像编码器） | 同上 |
| 本地 OCR | PP-OCRv6 small 与 medium，七个 v4 语言包 | `scripts/fetch/ocr-model-sources.js`、`electron/shared/ocr-packs.js` |
| 听译 | SenseVoice、zipformer 中英、silero VAD、Qwen3-ASR 0.6B | `scripts/fetch/audio-model-sources.js`、`electron/shared/audio-packs.js` |
| 朗读 | Kokoro v1.1、MeloTTS | 同上 |

### 第一步：收候选

- 各家自己的发布页：Qwen、腾讯混元、PaddleOCR、k2-fsa/sherpa-onnx 的模型库。
- HuggingFace 按任务看当年的热门（翻译、图文识别、语音识别、语音合成）。
- 当年 WMT 通用翻译任务的结果，看小模型那一档。
- TODOS 里已经记着的候选先看（例如 NiuTrans LMT 系列）。

### 第二步：收评价

程序自己不收集任何数据，评价只能从外面来：

- **本仓库的 Issues**：用户说哪种文本翻得差、哪种截图读不出来，这是最有分量的。
- **论坛的实测帖**：r/LocalLLaMA、HuggingFace 模型页的讨论区、V2EX、知乎、B 站。
- 只记一件事：**哪个模型在哪类文本上被说好或被说差**。跑分榜和口水帖不记。
- 记在当年的年检笔记里（作者的留痕目录，不进仓库），下一年对照着看。

### 第三步：过准入门槛

候选先过这几条，过不了就不用往下比：

- **协议**允许我们给下载链接（Apache、MIT 一类）。带地域限制、月活门槛的不收。
- **体积**：Q8 量化在 2 GB 上下。两个槽位合计按 4 GB 内存设计。
- **官方 GGUF**：白名单钉的是上游文件的哈希，第三方转的量化不收。
- **钉版的 llama.cpp 能载入**。载不了就意味着要连运行时一起换版（第 2 节），成本另算。
- **思考能关**：程序一律禁止思考，新模型要先确认它的思考标记，关不掉或会泄漏的不收。
- **速度**：纯 CPU 自检不低于每秒 8 个字，低于这个数设置页会提示用户开显卡。

### 第四步：新旧对比

同一组输入，新旧各跑一遍，看结果、速度和思考泄漏次数。

- **翻译**：仓库里目前没有成套的固定句子集。第一次年检时建一份，二十句上下：中英日互译的短句、一段长文、一段带 OCR 错字的文本、几句带术语的。放进单测目录下的夹具里，以后每年用同一份，结果才可比。
- **听译**：`npm run bench:listen -- --lang zh` 和 `--lang en` 各一次，再加 `--normalize`；高精度档单独跑。结果先看 `statusTrail` 里有没有中途重启。
- **视觉识别**：照 v0.5.1 过的「四道门」再过一遍（速度、坐标误差、多种文字的字符错误率、整屏截图）。
- **本地 OCR 加语言**：字形在字典里不等于模型能读。渲染一张样图跑真引擎，规矩在 [DEVELOPMENT.md](DEVELOPMENT.md) 的「OCR 支持一门新语言」。

### 第五步：换入

确定要换才做：

1. 白名单加一行：文件名、大小、哈希、角色。旧模型留着，已经下载的用户不受影响。
2. 说明书第 5 章与设置页卡片上的下载链接、体积。
3. FAQ 里的速度口径。
4. 跑对应的 smoke，写 CHANGELOG。

OCR 与听译的小包可以不发版直接换 Release 资产，流程在 [OCR_MODELS.md](OCR_MODELS.md)；听译同理走 `npm run audio:release`。

## 5. Windows 系统接口

系统大更新之后手测一遍，平时不用管：

- **声音捕获**：进程回环捕获只在 Win11 25H2 上验过。听译选「全部声音」和「指定程序」各试一次。
- **系统 OCR**：走 PowerShell 5.1 调系统接口，确认它还在、还能读。
- **划词**：三层探测、模拟复制、截图时排除自己的窗口。
- **数据与注册表**：密钥保险库（DPAPI）、开机自启、右键菜单「用 T-Translate 翻译」。
- **显卡**：Vulkan（内置模型）与 WebGPU（OCR、听译）两条路。驱动更新后在「关于 → 显卡加速」里重跑一次自检。

## 6. 在线接口

作者自己不用在线源，也没有任何在线 Key，这一层**只能对着官方文档查**，到单测为止。用户反馈某个源不通时，先看 [design/stack.md](design/stack.md) 第 4 节。

| 源 | 查哪一页 | 看什么 |
| --- | --- | --- |
| DeepSeek | api-docs.deepseek.com 的 updates 与 pricing | 型号名有没有换 |
| Gemini | ai.google.dev/gemini-api/docs/deprecations 与 thinking | 默认用的是滚动别名 `gemini-flash-latest`，一般不用换；看思考的默认行为与输出上限够不够 |
| Claude | Anthropic 文档的模型弃用页 | 默认型号的退役日期 |
| OpenAI | platform.openai.com/docs/deprecations 与 models | 默认型号还在不在；新型号是否还接受 `temperature` |
| DeepL | deepl.com/pro-api、developers.deepl.com | 计划与免费额度的说法 |
| 微软、百度、Google 翻译 | 各自的接口文档 | 接口版本。Google 走的是非官方端点，用「测试连接」真翻一句 |
| 在线 OCR 四家 | Azure、Google Vision、OCR.space、百度 | 接口版本与鉴权方式 |

发现默认型号被**关停**时，三处一起改：

1. `src/stack/providers/metadata.js` 里的默认值与占位文字，预设类的源还要改 `presets-core.js`，独立类的源改类里的默认值。
2. 把旧名字登进 `src/stack/providers/retired-models.js`，存着旧名的老用户就不用动手。**只收已经关停的**，还在役的型号不许映射。
3. FAQ「在线翻译源」那一问里的型号名。

`tests/unit/stack/provider-models.test.js` 会拦住表单默认值与类默认值不一致、默认值本身在停用名单里这两种错。

## 7. 前端库

- **要盯的只有三个**：pdfjs-dist、mammoth、jszip。文档翻译吃的是用户给的 PDF、Word、EPUB，这是程序里唯一解析外来文件的地方。有安全公告就升。
- 其余（React、Zustand、Immer、i18next、lucide-react、dayjs、uuid）：`npm audit` 没有高危就不动。大版本升级对维护模式的程序没有收益，只有回归风险。

## 8. 验证与发版

全部改完，按顺序过：

```bash
npx eslint . --quiet && npm test && npm run stack:build && npx vite build && npm run check:all
```

然后是 smoke，改到哪层跑哪层，年检时全跑：`smoke:offline`、`smoke:ocr`、`smoke:listen`、`smoke:llm`、`smoke:llm-host`、`smoke:llm-vision`、`smoke:llm-vision-host`、`smoke:llm-stack`。带模型参数的几个怎么传，见 [DEVELOPMENT.md](DEVELOPMENT.md) 的「冒烟与基准」。

**升过依赖就要真打一次包**，冒烟不覆盖打包这一步：

```bash
npx electron-builder --dir --publish=never -c.directories.output=release-verify
```

只出解压目录、不出安装包，几分钟。打完看三样：

- `release-verify\win-unpacked\resources\app.asar.unpacked\node_modules` 里原生模块齐不齐。
- 启动 `release-verify\win-unpacked` 里的 `T-Translate.exe`，看它自己的 `data\logs` 里划词模块预热成功。
- 验完删掉 `release-verify`。VS Code 开着时它里面的 `app.asar` 会被锁住删不掉，先关 VS Code。

最后是只有真机能验的：

- 打包，装上一个正式版，点「检查更新」，确认能升到新包，模型与数据都还在。
- 走一遍 `docs/MANUAL.zh.md`，这一年改过的界面、设置项、快捷键、模型链接都同步进去，中英两份。
- 发版流程照 TODOS 里的「发布流程备忘」。

## 年检记录

| 日期 | 动了哪几层 | 换了什么 | 备注 |
| --- | --- | --- | --- |
| 2026-09-20 | 依赖、平台 | `npm update` 把全部依赖升到各自范围内的最新：Electron 42.4.0 → 42.11.6、koffi 2.15 → 2.16.3、mammoth、jszip、immer、vite、vitest 等，共 195 个包换版本；`npm audit` 的 high 四个降到一个（adm-zip，经 onnxruntime 的安装脚本，运行时不用） | 大版本一个没动。两个坑：①`npm update` 会把 sherpa 的补丁 DLL 冲回原版，之后必须跑一次 `node scripts/build/overlay-sherpa-runtime.js`（`--check` 会报 stale）；②vitest 换版后改用根目录的 vite 7，JSX 默认变回经典模式，单测报 `React is not defined`，`vitest.config.js` 里已显式写 `esbuild.jsx: automatic`。八个冒烟与门禁全过；划词、截图、悬浮窗要手测。③**打包当场失败**：`uiohook-napi` 1.5.5 把预编译文件从 `node.napi.node` 改名为 `uiohook-napi.node`，electron-builder 的重编工具只认前者，认不出就从源码编译，而本机 node-gyp 找不到 Visual Studio。运行时不受影响（加载器两种名字都认），所以冒烟和手测都没发现。修法是 `package.json` 的 `build.npmRebuild: false`——原生模块全是 N-API 预编译件，重编本来就是空转。教训已写进第 8 节：升依赖后要真打一次包 |
| 2026-09-18 | 在线接口、文档 | DeepSeek 与 Gemini 的默认型号已被关停，四个在线源换现役型号并加停用名单；全部文档查过时 | 这份清单的第一版随 v0.5.2 写成，底层引擎与本地模型本年未动 |
