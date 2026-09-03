# T-Translate 架构文档

## 项目概述

T-Translate 是一个基于 Electron + React + Vite 的离线翻译工具，支持：
- 划词翻译（最多 8 个冻结窗口）
- 截图 OCR 翻译
- 悬浮窗口实时翻译
- 听译（本机实时转写系统声音 + 逐句翻译，模型按需下载）
- 文档翻译（PDF、DOCX、EPUB、TXT、SRT/VTT）
- 多种翻译源（本地 LLM、OpenAI、DeepL、Gemini 等）

## 目录结构

```
t-translate/
├── .editorconfig               # 编辑器统一配置 (LF, 2空格)
├── .gitignore
├── .prettierrc                 # 代码格式化
├── .prettierignore
├── eslint.config.js            # ESLint 配置
├── vite.config.js              # Vite 构建配置
├── vitest.config.js            # 测试配置
├── package.json
│
├── docs/                       # 项目文档
│   ├── ARCHITECTURE.md         # 架构设计（本文件）
│   ├── DEVELOPMENT.md          # 开发者指南（新增翻译源/OCR 引擎）
│   ├── I18N_GUIDE.md           # 国际化指南（三层 i18n 体系）
│   ├── OCR_MODELS.md           # OCR 模型维护手册
│   ├── FAQ.md                  # 常见问题
│   └── THEME_CUSTOMIZATION.md  # 主题定制
│
├── electron/                   # 主进程代码
│   ├── main.js                 # 主进程入口
│   ├── state.js                # 全局状态 (store, runtime, windows)
│   ├── screenshot-module.js    # 截图核心逻辑
│   ├── generated/              # esbuild 产物 translation-stack.cjs（gitignore，构建时生成）
│   ├── preloads/               # Preload 脚本 (每个窗口一个)
│   ├── shared/                 # 主/渲染进程共享常量
│   ├── ipc/                    # IPC 处理器 (按功能拆分，translation-stack.js 为栈 facade，history-vault.js 为历史加密库)
│   ├── managers/               # 窗口/托盘/菜单管理器 + audio-engine-manager（听译 ASR 子进程）
│   ├── services/audio-engine/  # 听译 worker（utilityProcess 内跑 VAD+ASR，见「听译引擎与驻留口径」）
│   └── utils/                  # 工具函数（secure-vault/secure-audit/history-vault/ocr-engine/
│                               #   model-root=模型根目录解析 / model-pack-core=模型包下载安装工厂 +
│                               #   ocr-pack-manager、audio-pack-manager 两个实例）
│
├── src/                        # 渲染进程代码
│   ├── main.jsx                # 应用入口
│   ├── App.jsx                 # 根组件
│   ├── i18n.js                 # 国际化初始化
│   │
│   ├── components/             # React 组件（PascalCase 目录）
│   │   ├── MainWindow/         # 主窗口布局
│   │   ├── TranslationPanel/   # 翻译面板 (含 hooks/ 和 styles/)
│   │   ├── SettingsPanel/      # 设置面板 (含 sections/ 和 styles/)
│   │   ├── HistoryPanel/       # 历史记录
│   │   ├── FavoritesPanel/     # 收藏功能
│   │   ├── FloatingWindow/    # 悬浮窗口
│   │   ├── SelectionTranslator/# 划词翻译
│   │   ├── DocumentTranslator/ # 文档翻译
│   │   ├── ProviderSettings/   # 翻译源设置
│   │   ├── TitleBar/           # 标题栏
│   │   └── ErrorBoundary/      # 错误边界
│   │
│   ├── stack/                  # 翻译+OCR 栈源码（ESM；esbuild 打包为主进程 CJS，运行时单实例）
│   │   ├── index.js            # createStack 入口（ctx 依赖注入：net.fetch/store/密钥）
│   │   ├── service.js          # 翻译服务（provider 路由/降级/两级缓存/免译过滤器/隐私门控单点）
│   │   ├── registry.js         # Provider 注册中心
│   │   ├── providers/          # 翻译源实现 + metadata.js（跨端共享的纯数据表）
│   │   └── ocr/                # 在线 OCR 四引擎 + LLM Vision + 本地引擎 local-bridge
│   │
│   ├── services/               # 渲染端服务层
│   │   ├── stack-client.js     # 主进程栈的渲染端客户端（stack:* IPC，同名 API）
│   │   ├── main-translation.js # 主窗口翻译编排
│   │   ├── pipeline.js         # 悬浮窗口流水线
│   │   └── tts/                # TTS 语音 (base, index, web-speech)
│   │
│   ├── stores/                 # Zustand 状态管理
│   │   ├── translation-store.js# 翻译状态
│   │   ├── config.js           # 配置状态
│   │   ├── session.js          # 会话状态
│   │   └── sync-to-electron.js # 主进程同步
│   │
│   ├── assets/
│   │   └── provider-icons/     # 翻译源 svg 图标（config/provider-icons.js 集中引入）
│   │
│   ├── config/                 # 前端配置
│   │   ├── constants.js        # 常量定义
│   │   ├── defaults.js         # 默认值
│   │   ├── templates.js        # 翻译模板
│   │   ├── privacy-modes.js    # 隐私模式
│   │   ├── languages.js       # 语言目录（134 种）+ 拼音索引，渲染端与栈共用
│   │   ├── ocr-languages.js   # OCR 可识别语言（56 种）→ 模型包，与主进程那份互校
│   │   ├── custom-languages.js # 用户自定义语言的校验与合并
│   │   ├── model-language-coverage.js # 模型语言能力表（只影响降级链排序）
│   │   ├── provider-icons.js   # stack 共享表 + 图标合成的渲染端 provider 目录
│   │   └── filters.js          # 免译过滤器（stack 与渲染端共用的纯数据）
│   │
│   ├── i18n/                   # 语言包
│   │   └── locales/
│   │       ├── zh.js           # 中文
│   │       └── en.js           # English
│   │
│   ├── hooks/                  # 共享 hooks（use-visible-hotkey 等）
│   ├── utils/                  # 工具函数
│   ├── styles/                 # 全局样式
│   │   ├── index.css           # CSS Reset + 基础变量
│   │   └── App.css             # 全局共享样式
│   │
│   └── windows/                # 子窗口入口
│       ├── floating-window-entry.jsx     # 悬浮窗口入口
│       └── selection-entry.jsx # 划词翻译入口
│
├── public/                     # 静态资源 + HTML 入口
│   ├── index.html              # 主窗口
│   ├── selection.html          # 划词翻译
│   ├── floating-window.html              # 悬浮窗口
│   ├── child-pane.html         # 子面板
│   ├── screenshot.html         # 截图选区
│   ├── icon.png                # 应用图标
│   ├── icon.ico                # Windows 图标
│   └── tray-icon.ico           # 托盘图标
│
├── resources/                  # 应用资源
│   └── ocr/                    # 内置 OCR 基础模型（fetch-ocr-models 拉取，gitignore）
│
├── scripts/                    # 工具脚本
│   ├── build-stack.js          # esbuild 打包翻译栈（dev/build 自动执行）
│   ├── fetch-ocr-models.js     # 拉取内置 OCR 基础模型
│   ├── build-ocr-release.js    # 生成 ocr-models Release 资产（发模型用）
│   ├── audio-model-sources.js  # 听译模型包来源与角色映射（换模型改这里）
│   ├── build-audio-release.js  # 生成 audio-models Release 资产
│   ├── model-licenses/         # 模型协议原文（随包分发，见 NOTICE）
│   ├── smoke-listen.js         # 听译整链冒烟 + 延迟测量（npm run smoke:listen）
│   ├── smoke-offline.js        # 离线模式所有下载入口拒绝断言（npm run smoke:offline）
│   ├── check-constants.js      # 常量同步检查
│   ├── check-i18n.js           # i18n key 一致性检查
│   └── check-hardcoded-chinese.js  # 硬编码中文扫描
│
└── tests/                      # 测试
    ├── setup.js                # 测试环境配置
    ├── mocks/electron.js       # 主进程模块单测用 electron stub
    └── unit/                   # 单元测试
```

## 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                         View Layer                              │
│  components/* (React Components，三渲染窗口)                     │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Store Layer (Zustand)                   │
│  translation-store.js, config.js, session.js                    │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Renderer Service Layer                       │
│  stack-client.js（栈客户端）, main-translation.js, pipeline.js   │
└────────────────────────────────┬────────────────────────────────┘
                                 │ stack:* IPC
                                 │ （流式批帧 / 请求 id→abort / 隐私模式主进程注入）
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              Main-Process Translation Stack（单实例）            │
│  electron/generated/translation-stack.cjs ←esbuild← src/stack/* │
│  service（路由/降级/两级缓存/过滤器/隐私门控单点）                │
│  registry → local-llm, ollama, openai, anthropic, deepl,        │
│             gemini, deepseek, google-translate, microsoft, baidu │
│  ocr/*（在线四引擎 + LLM Vision + 本地 local-bridge 直调）        │
│  网络出口统一 net.fetch（Chromium 栈，随系统代理）；              │
│  密钥解密仅在主进程（secure-vault + 审计）                        │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Electron Main Process                      │
│  main.js → ipc/*（translation-stack.js facade）→ managers/*     │
└─────────────────────────────────────────────────────────────────┘
```

三个渲染窗口（主窗/悬浮/划词）共享同一个主进程栈实例：缓存全局命中、
翻译源故障计数全局生效、设置保存一次生效；渲染进程不含任何翻译/在线
OCR 网络代码，离线与无痕语义由主进程按请求强制（结构性隐私保证）。

无痕模式的口径是「本次会话不留任何痕迹」，逐模块落点：历史 / 收藏统计 /
AI 结果不入库（store 侧 stash 回环）；L2 翻译缓存暂停落盘；文档翻译进度不写；
听译会话照常，但会话日志不写（会话中切入无痕即时停写，`log-close`）；
程序运行日志只留 error 一级（`logger.setSecureFileLogging`，渲染进程经
`logs:write` 进来的行同受限）；Windows OCR 因需把截图写成临时文件交给
PowerShell，无痕下不在允许引擎表里（`privacy-modes.js`）；迁移包导出关闭。
API 密钥解密照常（无痕不等于离线）。

### AI 动作框架（v0.3.3）

「总结 / 理解」这类动作**是数据不是代码**：一个动作 = 一份提示词配置。加动作
不用改逻辑，只加一条配置；用户导入的第三方配置走同一条路径。

```
config/ai-actions.js        动作目录：内置两条（summarize / explain）+ 字段契约
                            + normalizeActionConfig（导入唯一闸门）
services/ai-action-runner   纯逻辑：文本量度 / 触发判定 / 模板渲染 / 路径选择
                            + runAiAction（唯一出口，调 stack-client）
services/ai-action-store    导入配置的读取缓存，每次读都重新过一遍闸门
hooks/use-ai-actions        三个窗口共用：能力探测、可用动作、结果折叠展开
```

三条容易被违反的约束：

1. **能力看实现不看元数据**。`metadata.supportsChat` 只供 UI 显示；运行时一律走
   `service.getChatCapability()`（与 `chatCompletion` 同一个 provider 循环），AI
   路径带 `requireChat`——否则只会翻译的源会把提示词翻译一遍还回来，看着像功能
   正常。`tests/unit/provider-chat.test.js` 拿真实类核对那一列，防止漂移
2. **两条路径，失败降级**。有视觉模型且手里有截图 → 路径 B（模型直接读图）；否则
   路径 A（文本）。路径 B 失败且有识别文本时自动回落 A——用户不该为模型看不见图
   买单
3. **隐私跟随翻译**。LLM 调用的门在主进程 facade（同 translate）；结果写历史的门
   在 `translation-store.attachAiResult`（同 addToHistory，无痕不写）；理解模式的
   结果作为独立主条目走 addToHistory（kind `'understand'`，同一道无痕门，动作声明
   `history:'none'` 则不写）；路径 B 在离线模式下还要求视觉端点必须在本机

### 稳定性与系统集成（v0.3.7）

```
electron/utils/crash-guard.js   崩溃自愈：渲染进程异常退出限次自动重载（3 分钟
                                窗口内 3 次；clean-exit/killed 不触发）+ 启动哨兵
                                （连续 3 次未撑过 60s 稳定窗口 → 安全模式：禁硬件
                                加速、跳过原生模块预热）。依赖注入、零 electron
                                require，直接可测
src/utils/migration-pack.js     迁移包 build/parse 纯函数。导出读 electron-store
                                存储态（设置页内存态含解密后的 OCR 密钥，绝不可
                                导）；两端都过 stripSecrets + 结构白名单
electron/utils/open-with.js     右键菜单 argv 解析（.pdf/.docx/.txt 白名单）。
                                冷启动走 process.argv，热启动走 second-instance
                                转发；路径只在主进程暂存，渲染端单一 invoke 取
                                文件内容——无任意路径读取面。注册表项由
                                installer/installer.nsh 安装写入、卸载对称清除
```

### 听译引擎与驻留口径（v0.4.0，捕获层 v0.4.1 换代）

```
electron/managers/audio-engine-manager.js  音频 utilityProcess 的唯一持有者（ASR 会话 + 神经 TTS）
electron/services/audio-engine/audio-worker.js  识别模型、音频捕获、语音合成都在这个子进程里
electron/utils/win-audio-capture.js        WASAPI 捕获（koffi，v0.4.1）
electron/utils/model-root.js               模型根目录解析（安装目录优先）
electron/utils/audio-pack-manager.js       识别模型包下载/卸载（工厂第二实例，asr-models）
electron/utils/tts-pack-manager.js         语音包下载/卸载（工厂第三实例，tts-models，v0.4.2）
electron/utils/tts-models.js               已装语音包发现：pack.json 的 files 解析成绝对路径
src/services/tts/neural.js                 渲染端神经语音引擎：分块播放、音色挑选、按句回落
```

**音频从哪来（v0.4.1 起）**：`win-audio-capture` 用 koffi 直接调 WASAPI，两条激活路径同一
个出口格式（16kHz 单声道 float32，直接喂 VAD；系统路径由引擎转换，进程路径由我们自己降采样，见表）：

| 来源 | 激活方式 | 系统要求 | 取到的是 |
|------|----------|----------|----------|
| 全部声音 | 端点环回 + `AUTOCONVERTPCM` | 全部 Windows | 系统音量之后的混音，按端点音量（`IAudioEndpointVolume` 报的 dB）反向补偿回原始电平——用户开多小声都不影响识别（8% 音量是 -38 dB，补偿前 VAD 基本失聪）；静音仍是无声。硬件音量的设备靠削波守卫识别后停用补偿 |
| 只听某程序 / 排除某程序 | `ActivateAudioInterfaceAsync` + `PROCESS_LOOPBACK` | Win10 build 20348+（实际=Win11） | 该进程树的渲染流，在端点音量之前（系统静音也照抓；但该程序在音量合成器里被单独静音则取不到）。要的是引擎原生 48k 立体声，由 `win-audio-resample` 自己 3:1 降采样——引擎自带的 16k 转换让 VAD 在同一首歌上少开 14% 的行 |

捕获跑在 worker 里，音频进 VAD 之前不跨进程；渲染端只收文字和一个电平数。**环回只在端点上有活动渲染流时才送包**：机器完全静默（视频暂停、没有任何程序在放）时一包都不来（2026-09-02 实测三次 0 帧，有程序出声即 1.49s/1.5s），所以 worker 在 1 秒没收到 PCM 后主动把电平归零，smoke 则自己放一个近乎无声的振荡器再断言。设备切换由
`AUDCLNT_E_DEVICE_INVALIDATED` 明确报出并自行重建（最多三次）。**v0.4.1 之前**这一层是渲染
进程的 `getDisplayMedia`（因此要请求一条随即停掉的视频轨）+ JS 重采样，两者都已删除。
只听某程序时每秒核对一次目标进程还在不在：进程环回在目标退出后仍会源源不断地送全零包，
没有任何标志或错误，所以只能主动查；查到退出即发 `source-gone`，manager 就地切回全部声音
并通知渲染端复位选择器。

**VAD 前的自动增益**：silero 对电平敏感而识别器不敏感（fbank 归一）——标准朗读集里 rms 0.003 的录音识别器照转、VAD 却整句不开门。`makeAgc` 在 32ms 窗上做慢包络跟随（目标 0.05、封顶 30 dB、静音门 0.0005、只抬不压），喂 VAD 与镜像段落的都是抬过的信号，电平条与 rms 指标仍读原始信号；metrics 行带 `agcGain`。静音闭合 0.5s、句头预留 0.6s 也是同一轮基准定的（英文整链 WER 22.9 → 14.7 → 10.6）。

**硬切的切点与接缝**：开放段到 9s 时不在整点下刀，而是在最后 1.5s 里按每窗 RMS 找最安静的一个 32ms 窗（`pickCutWindow`，保留末尾 8 窗不切），切点之后的音频作为 carry 明确带进下一段——VAD reset 之后到它重新认定之间的窗也并入 carry，认定发生时 carry 成为新段的头；若新段由 VAD 自然闭合收尾，解码时把 carry 中 VAD 段起点之前的部分拼到前面（按全局样本坐标算，零重叠）。3s 内没人认领的 carry 自成一个定稿。此前硬切固定在 9.0s，连续演讲每段开头丢一两个字母（57 段里 8 段残词）。

**VAD 的两档与两个自动动作**：silero 阈值默认 0.5（说话），SenseVoice 给每个定稿打的音频事件
决定档位——最近三个定稿有两个是 `<|BGM|>` 就在下一个段间用 0.3 重建 VAD，连续三个说话再回
0.5（实测同一首歌进程环回 0.5 下漏 14% 的歌词行，0.3 全中）。两个兜底：①看门狗报「有声无字」
（响着 12 秒没定稿）时直接放宽到 0.3 且本会话不再收回；②自动语言的会话里连续三个定稿同一
语言就把识别器钉到该语言（段间重建一次），避免混播内容逐句在中/日/粤间乱跳出乱码。音乐里
一两个字的碎定稿不上屏也不翻译（`isNegligibleFinal`）。这些都在会话日志里留事件
（`vad-threshold` / `vad-relax` / `lang-pinned` / `dropped-short`），metrics 行带当前阈值与端点音量 dB。

**载卸时序**：模型只在会话内驻留，不做常驻缓存。

| 时刻 | 发生什么 |
|------|----------|
| 点开始 | fork 子进程 → `init` 声明模型路径 → `asr-start` 才真正加载 |
| 会话中 | 定稿引擎 SenseVoice + 可选草稿引擎 zipformer 同时在内存 |
| 点停止 | `asr-stop` 冲刷 → 主进程发 `unload`（丢引擎引用、放开模型文件）→ `shutdown` → 进程退出 |
| 关窗/切 SECURE | 同上，`once('closed')` 与隐私监听各自兜底 |
| 换包 | `stopSessionAndWait` 等进程真正退出才动目录——Windows 上文件句柄没放开，换包会在 150MB 下载的最后一步失败 |

**内存口径**（2026-08-27 双模型 3 分钟 soak / 2026-08-29 smoke 复测）：会话中子进程 RSS 596–676MB
且平稳；会话结束进程退出，回到 0。只装基座包约省一半。主进程侧的 OCR 会话是另一
套缓存（LRU 2 个，换包/换档位时清），与听译互不影响。

**延迟口径**（`npm run smoke:listen` 实测，两次跑差 <20ms）：

| 指标 | 装草稿引擎 | 只装基座包 |
|------|-----------|-----------|
| 引擎加载 | 2.2 s | 1.2–1.4 s |
| 首字（草稿出第一个字） | 0.56–0.57 s | 0.80–0.83 s |
| 草稿刷新间隔 | 0.31 s | 1.03 s（伪流式节流值） |
| 定稿（说完到出定稿） | 0.37 s | 0.37 s |
| 解码 RTF | 0.033–0.044 | 同 |

口径说明：计时从音频进入 worker 到事件送达。**v0.4.1 起采集也在 worker 内**，
所以此前要另计的渲染端 `createScriptProcessor(4096)` 那 ~85ms 已经不存在，用户
眼里只再多 IPC 与绘制。定稿延迟的主要成分是 VAD 尾静音（`minSilence` 0.5s，为准确率从 0.35 放上来的）
而不是算力，所以调它才是调定稿快慢。样本是合成语音，真实带 BGM 的场景 VAD 闭合更晚。

**模型文件的信任边界**（v0.4.1 定，用户拍板）：包下载有 sha256 校验；**用户手动放进
`asr-models/` 的文件按本机信任处理，不做校验**——能往目录里放文件的人同样能直接运行任意
程序，校验挡不住有意的本地攻击者，只挡得住意外。我们保证的是**坏文件不会拖垮主程序**：
识别引擎在独立 utilityProcess 里，一个不是 ONNX 的文件会让它原生崩溃（`0xE06D7363`，
JS 的 try/catch 接不到），主进程无恙，且载入期崩溃不再重试（重试必然同样崩），
界面直接报「模型加载失败——文件可能不完整或不是识别模型」。

### 神经语音（v0.4.2）

同一个 worker、同一份 `audio-models` 清单，多出一种包类型 `tts-voice` 与一个根目录 `tts-models`。
两个管理器各列各的类型（`computePackList(…, types)`），并用 `packFilter` 在核心层拒绝跨域的包 id——
把语音包 id 递给识别模型通道会得到 `PACK_UNKNOWN`，而不是把语音包装进 `asr-models`。
语音包带整棵目录（kokoro 的 `espeak-ng-data/`、jieba 的 `dict/`），`model-pack-core.extractZipTo`
因此从「压平到文件名」改为保留相对路径，zip-slip 守卫改成显式检查（绝对路径、盘符、`..`
一律拒绝并中止安装；JSZip 载入时自己也会消解 `..`）。

| 包 | 引擎 | 体积 | 音色 | 采样率 | 用途 |
|----|------|------|------|--------|------|
| `tts-kokoro-zh-en` | kokoro（fp32） | 341MB | 0-1 美音女、2 英音女、3-57 中文女、58-102 中文男 | 24k | 主档；英文靠包内 espeak-ng-data 音素化（GPL-3 数据，NOTICE 已列） |
| `tts-melo-zh-en` | vits（MeloTTS，fp32） | 157MB | 1 个女声 | 44.1k | 中英夹杂句子；`preferMixed` 让渲染端自动选它 |

int8 版本是负优化（x86 上比 fp32 慢 4 倍且不随线程数涨），所以两个包都是 fp32。

**worker 协议**：`tts-generate {id, text, sid, speed, pack}` → 若干 `tts-chunk {id, samples, sampleRate}`
→ `tts-done {id, cancelled}`。`maxNumSentences: 1` 让 sherpa 的进度回调按句出块，渲染端收到第一句就
开始播（`neural.js` 在一个 AudioContext 上顺序排队各块）。`tts-cancel` 让回调返回 0，sherpa 会在句间
真正停下；`unload tts` 排在合成链之后放引用并回 `tts-unloaded`。`enableExternalBuffer` 恒为 false
（Electron V8 内存笼）。合成跑在 addon 自己的线程上（4 线程），与识别只争 CPU。

**驻留口径（零闲置铁律的唯一放宽）**：没有听译会话时朗读会起一个 TTS-only 进程（无识别模型、
无会话日志）；最后一次朗读后闲置 60s 卸载退出，悬浮窗在屏上时续期。听译会话里加载的语音随会话
生灭；会话结束时若语音仍热则进程转为 TTS-only 留下。开始听译时若已有 TTS-only 进程，直接换成
会话进程（下次朗读重载语音，1.3-2.2s）。换/卸语音包走 `unloadTtsAndWait`：TTS-only 进程直接退出，
会话内只卸语音并等 ack。

**静音闸门（批 4）**：任一窗口的 `TTSManager` 在状态变为 SPEAKING/PAUSED 时经 `audio-engine:tts-playing`
报告，manager 按 webContents id 计数（多窗口互不误解除）并向 worker 发 `tts-gate`；worker 的
`makeTtsGate` 在 on 期间丢弃全部 PCM、off 后再挡 300ms（环回路径的尾延迟），同时把闸门状态推回悬浮窗
（`audio-engine:tts-gate`）显示「朗读中 · 暂停收音」并压平电平条。会话中途开始时 `asr-ready` 补发一次。
选闸门而不选 Win11 的进程排除，是因为它全平台可用且不用重开音频客户端；代价是朗读的几秒里外部声音也丢。

**设置页「音频」节**：侧栏一项，进去是「听」「读」两张只读状态卡（`AudioSection`），点卡进子页、左上角
返回；「读」内分「朗读 / 语音包」两页，「朗读」页（`TTSSection`，embedded）= 引擎分段开关 → 「当前朗读」
状态行（本机 / API、回落说明、试听）→ 引擎自己的块（神经：中英各一行音色；系统：默认音色；外接：翻译源
卡片式表单）→ 三滑块一行。音色用 `VoicePicker` 面板（搜索 + 性别/语言筛选 + 常用置顶 + 三列小片各带试听）。
分段开关是用户定的设置页统一样式（所有"选择"都改它），这一轮只铺音频子页。

**渲染端选音色**（`src/utils/tts-voice-pick.js`，纯函数）：用户指定的音色优先（其包读不了该语言时
才放弃）；自动模式按目标语言/文本文字系统选常用音色；中英夹杂且装了 `preferMixed` 包时改用它；
没有包覆盖的语言（日文等）抛 `NO_VOICE_FOR_LANG`，`TTSManager` 把这一句交给系统语音而不改引擎设置。

**实测**（`npm run smoke:listen` TTS 段，Ryzen 9 7945HX）：kokoro 英文首块 0.64s、2.6s 音频合成 0.64s；
kokoro 中文换包含载入首块 1.5s；MeloTTS 冷启动（含进程与包载入）首块 2.6s。

**外接语音服务（第三个引擎，`src/stack/tts/endpoint.js`）**：只做 OpenAI 兼容 `POST {baseUrl}/v1/audio/speech`
（model / input / voice / speed / response_format=wav），本地 IndexTTS、GPT-SoVITS、CosyVoice、kokoro-fastapi 的
服务端和 OpenAI 都吃这一个协议。请求模块放在翻译栈里，与翻译源同一条铁律：`rtFetch`（= `net.fetch`，系统代理）、
不抛异常、错误文案走 `_t`。三个通道 `stack:tts-capability / tts-speak / tts-test` 在 `translation-stack.js` 里
按请求读隐私模式——**离线模式一律拒绝**（`OFFLINE_BLOCKED`），密钥前缀 `tts_endpoint_` 同时在密钥库的离线
封锁名单上，所以离线时连解密都不发生。`tts-speak` 进 in-flight 表，渲染端停止即 `stack:abort` 中断 HTTP。
渲染端 `src/services/tts/endpoint.js` 整段拿到字节后 `decodeAudioData` 播放（首版不分块）；服务不可达 / 非音频
应答 / 离线都抛 `ENDPOINT_*`，`TTSManager` 逐句回落系统语音。设置页只有地址 / 密钥 / 模型 / 音色四个字段和
一个「测试并试听」（用一句真合成当连通性检查，没有标准的探活路由）；密钥失焦即入库，settings 里只记 `hasKey`。

## 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 组件目录 | PascalCase | `TranslationPanel/`, `TitleBar/` |
| 翻译源目录 | kebab-case | `local-llm/`, `google-translate/` |
| JS/JSX 文件 | kebab-case | `translation-store.js`, `error-handler.js` |
| CSS 文件 | kebab-case | `styles.css`, `layout.css` |
| 常量 | UPPER_SNAKE_CASE | `MAX_FROZEN_WINDOWS` |

## 开发命令

```bash
npm start                # 启动开发环境（先打包栈，再 vite + electron）
npm run start:debug      # 同上 + 划词链路探针日志（TT_SELECTION_DEBUG=1）
npm run stack:build      # 单独打包翻译栈（esbuild → electron/generated/）
npm run build            # 构建生产版本
npm run dist             # 打包安装程序（产物在 release/，发布传三件套 exe+blockmap+latest.yml）
npm run lint             # ESLint 检查（全仓 0 error 是底线）
npm run format           # Prettier 格式化
npm test                 # 运行测试（vitest）
npm run check:all        # 常量同步 + i18n 键同步 + 硬编码中文，三连
```
