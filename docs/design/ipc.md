# IPC 层、预加载与共享表设计说明

代码：`electron/ipc/`（每个领域一个文件，`index.js` 是依赖注入根）、`electron/preloads/`（每扇窗一份最小权限 API）、`electron/shared/`（主进程与渲染端共用的常量、通道表、包注册表）。隐私分层的总原则在 `CLAUDE.md` 与 `docs/ARCHITECTURE.md`，这里只记各处「为什么这样写」。

## 1. 翻译栈门面（ipc/translation-stack.js）

- 门面是栈的**唯一执行点**：持有栈单例（`src/stack/` 的打包产物），每次请求从 store 读 `privacyMode` 并注入 `privacyMode / useCache`，渲染端传来的这两个字段一律丢弃——任何调用点都无法再削弱安全 / 离线模式。
- 中止注册表 `requestId / streamId → AbortController`：取消或被新请求取代时真正中断上游 HTTP（P2-34）。条目在完成时删除、发送方 webContents 销毁时中止、每 10 分钟一次 GC 兜底，不可能泄漏。
- 错误以本地化后的纯字符串跨越边界：invoke 处理器返回结果对象、永不 throw——Electron 会把抛出的 Error 压扁成裸消息。
- 栈的网络走 Chromium 网络栈（`net.fetch`）：系统代理与企业证书的行为与当初写各翻译源时依赖的渲染端 fetch 完全一致。
- 内置模型：栈的 `tengine` 源经 `llm/llm-manager.js` 到 LLM 宿主，文件选择、驻留与试用日志都在 manager；文本原样过、只回数字。视觉槽同理，图片字节不进任何日志。
- 外部 TTS 端点：字段来自设置，密钥来自保险库；离线模式下密钥为 null（前缀在封锁表里）。
- 启动后闲置时预载栈（D-5a 拍板）：第一次翻译不付配置解密与缓存读取的代价，加载坏了也在启动日志里露头而不是首次使用时。
- `noCache` 是唯一从载荷层接受的例外，结构上安全：它只能把缓存进一步**关掉**，永远打不开，安全模式的门仍决定上限。听译设它——字幕行是一次性的，否则会把共享缓存挤空。流式路径同一契约。
- 流式：invoke 立即以 streamId 返回，帧经 `STREAM_CHUNK` 推送（栈内已按约 33 ms 合并）。
- `canChat` 也在门面的隐私模式下回答：离线模式里云端 LLM 不能算「AI 可用」。
- 连接测试的离线门在这里而不是渲染端：`testProvider` 自己套白名单加离线的「端点必须本地」规则，模式永远是门面的。
- 状态回传前把 schema 里 `encrypted: true` 的字段全部打码：解密后的密钥只存在于主进程。
- `stack:set-glossary`（v0.5.2）：主窗口把词汇表推给栈，划词窗、悬浮窗与听译字幕翻译时由栈自己取词条。**只认主窗口的 webContents**（与历史保险库同一条规矩——别的窗口不该能改写所有窗口的译文），预加载里只有主窗口的桥有这个方法。词条只在主进程内存里，不落盘；上限与清洗在栈的 `sanitizeGlossaryItems`，不在处理器里。缘由与规则见 `docs/design/stack.md` 第 3 节。
- `stack:detect-language`：同语言判断（`src/stack/language-id.js`），纯本地、只读，不经隐私门，离线模式照常可用；划词窗、悬浮窗、主窗口的桥都有。每次最多 2000 条（stack-client 按 1000 条分批），超量或载荷不对返回 null，渲染端据此退回本地判断。缘由见 `docs/design/stack.md` 第 8 节。
- OCR：引擎白名单从**当前**模式注入，渲染端不可能放宽（旧调用点把白名单当参数传、靠约定）。截图是程序里最敏感的输入。视觉路径 B 同一白名单，再加离线的本地端点规则。
- 外部 TTS 端点按定义是网络服务（即使在 localhost），离线模式三条通道全部拒绝，渲染端引擎报自己不可用、管理器留在系统语音。设置页可用草稿配置（未保存、密钥可空）端到端试听。音频以 ArrayBuffer 原样跨 IPC（结构化克隆）。
- `privacy.js` 切模式后通知门面：安全模式暂停 L2 缓存落盘（`setPersistEnabled` 里先冲掉待写）。主进程内的调用方（听译翻译器）走与渲染端相同的清洗：模式从 store 读、缓存只减不增、中止照常登记。

## 2. 允许表与隐私门

- **store 允许表**（`ipc/store-allowlist.js`）：通用 store 桥被所有窗口共用，没有它被攻破的渲染端能写任何键——包括翻译门面与密钥库每次请求都重读的 `privacyMode`。模式只能经过校验的 `privacy:setMode` 改。新增渲染端持久化的键要扩展对应谓词并在单测里镜像；拒绝故意做得响（记日志 + 失败结果），忘了登记在开发期就露头，而不是变成一个悄悄失效的设置控件。`settings` 整键与 `floatingWindowLocal.opacity` 只为「恢复全部设置」放行，透明度本身走悬浮窗专用通道。`store-clear` 通道已删：零调用者，且会从任何渲染端把 `privacyMode` 抹回默认。
- **隐私模式 IPC**（`ipc/privacy.js`）：0.2.9 删掉了 `strict`，它的核心承诺（不联网）映射到 offline。安全模式跨重启持久，所以日志门在启动时也套一次，不只在切换时。`PRIVACY_MODES` 里曾漏掉 SECURE，`privacy:setMode('secure')` 校验失败、主进程的模式键静默保持旧值——三个模式必须都在表里。
- **密钥库 IPC**（`ipc/secure-storage.js`）：safeStorage（DPAPI）加密，无明文回退——加密不可用就拒存。审计与离线门放在 `security/secure-vault.js` / `secure-audit.js` 共享模块里，因为主进程的翻译栈在进程内走同一条路解密，只做在 IPC 里的审计看不见栈的流量。识别出的批量上下文（BULK_CONTEXTS）记审计但不计入突发告警。不提供访问日志查询通道：审计给异常检测与安全告警用，不给 UI 消费。
- **历史保险库 IPC**（`ipc/history-vault.js`）：持久化 blob 是整份翻译历史，两个覆盖层窗口的预加载本就不暴露这些通道，处理器再按发送方拒一次，与密钥库同样的纵深防御。

## 3. 窗口类 IPC

### 悬浮窗（ipc/floating-window.js）

- 子面板表在模块作用域而不是每次 register 里：window-manager 要在悬浮窗关闭时一并关掉面板，面板不能活过父窗口。
- 没有 OPEN 处理器：悬浮窗只经全局快捷键打开。
- 透明度由渲染端以 CSS 变量套用（子面板不受影响），主进程只持久化。
- **手动拖窗**：透明无边框窗上 `-webkit-app-region` 拖拽在 Electron 42 失效（装机版 0.2.8 亦复现），渲染端自己跟踪指针、以 mousemove 频率 `on`（非 handle）流式送位置。尺寸在拖动开始时抓一次随每帧传入：分数缩放（1.75x）下裸 `setPosition` 每次都重新舍入尺寸，误差累积、窗口拖着拖着就变大；恒定 DIP 尺寸经 `setBounds` 每帧舍入一致。
- 设置合并的兜底值镜像 `src/components/SettingsPanel/constants.js` 的 `DEFAULT_SETTINGS.floatingWindow`，窗口本地的滑块值优先于设置页默认。
- 捕获可见性即时生效：`WDA_EXCLUDEFROMCAPTURE` 让 OCR 不会读到自己的覆盖层，用户可选择允许被截图 / 录屏。
- 设置广播必须也送到划词窗：它是常驻（hide 不 close）的渲染进程，带自己的翻译栈客户端，否则一直用第一次翻译时的配置快照直到重启。
- 翻译结果与 AI 结果经主窗口的 `DATA.ADD_TO_HISTORY` 通道进历史 store（与划词窗同一条路），store 自己套安全模式门，这里不再查。跳设置用 `navigate` 带 `settings:<section>`，一趟同时切页签与滚到分节。
- **区域截取前把自己与子面板都隐藏**：`WDA_EXCLUDEFROMCAPTURE` 也套着，但它在各种 GPU / 驱动组合下不保证，透明度才是真正决定正确性的兜底。2026-08-19 之前 affinity 调用根本没生效——HWND 被当 Buffer 传给 koffi——全靠这层兜底在工作（见 `makeWindowInvisibleToCapture`）。
- 结果带**被截取那块显示器**的缩放：渲染端要用它把 OCR 像素坐标映回 CSS px，混合 DPI 下自己的 devicePixelRatio 可能属于另一块屏。
- 数据同步直接读渲染端 Zustand 持久化的 `translation-store`（形状 `{ state: { history } }`）。
- 独立子面板：按文本尺寸自适应并钳位（小片段可读、不出巨型覆盖层）；面板正压在原文上，不排除捕获的话下一次截取会 OCR 到面板自己的译文。

### 划词窗（ipc/selection.js）

- 按**发送 IPC 的窗口**寻址而不是活动槽窗口：冻结卡片已从 `windows.selection` 脱离，`getSelectionWindow()` 会把它的隐藏 / 缩放 / 拖动误投到当前活动的卡片上。
- 三个以上连续空行折成两个（段落检测会多产空行）。
- 防误触：剪贴板里可能是文件拖放而不是选中文本，靠抓取时**恢复之前**新鲜读到的格式区分；文件选择只翻有意义的文件名（去目录、扩展名、分隔符；太短或纯数字符号无翻译价值就不翻）。
- 剪贴板机制（互斥、全格式恢复、成功缓存）全在 `selection/clipboard-capture.js`，mouseup 探测与这里的抓取才不会互相覆盖。

### 截图（ipc/screenshot.js）

- 截取流程本体在 `screenshot/flow.js`，经 managers 到达；以前这里那份副本已漂移且无人引用，删了。
- 只在主窗口截图前可见**且**从界面（非热键）发起时才恢复主窗口。
- `main-i18n` 的 `t(key, params)` 第二参数是插值参数不是回退串，键都存在，只传键。

### 系统（ipc/system.js）

- 读文件上限与 `src/document/document-parser.js` 的 `MAX_FILE_SIZE` 一致：解析器反正拒绝更大的，这里放宽只会把整份文件读进内存、跨 IPC 送去被拒。
- 「用 T-Translate 打开」是一次性取件：渲染端永不提供路径，只读主进程从 argv 解析的待处理路径，没有任意文件读取面。
- 外链只放行 http / https。
- 更新器：IPC 不流式，下载状态在主进程记、进度经独立通道推；离线模式承诺「不发网络请求」包括更新器，门在主进程一处覆盖所有窗口。渲染端仍送 `{downloadUrl, downloadName}`，忽略——electron-updater 下载的是上一次检查从 feed 解析到的东西。
- 保存对话框与写文件合成一次 invoke：渲染端没有任意文件的 fs，单独返回路径对它没用。
- 渲染端日志落盘：`src/core/logger.js` 只写控制台，React 崩溃、未处理的 rejection、window.onerror 以前在日志文件里完全看不见。单向（`on`）——写日志永远不让调用方等待；单条封顶，失控循环也冲不破 5 MB 文件上限。
- 开机自启：`getLoginItemSettings` 在开发态不可靠，状态镜像到 store，读的时候 store 优先。v0.3.7 之前的 Run 项名字退役一次，当前名字的项与偏好保持一致（`platform/login-item.js`）。

## 4. 引擎与包类 IPC

- **OCR**（`ipc/ocr.js`）：注册时从设置播种模型档位，渲染端切换经 `SET_MODEL_TIER` 更新。原生库在闲置时预热，且只在本地引擎被选中时——否则白付内存。健康检查默认轻量（只看文件），`deep` 才建会话。各引擎识别函数没有自己的 IPC：v0.3.1 栈迁移退役了 `ocr:paddle-ocr / ocr:windows-ocr` 通道，翻译栈门面（`ctx.localOcr`）在主进程内直接调这些导出。
- **听译**（`ipc/audio-engine.js`）：朗读单次文本封顶（翻译面板最长也就几段，再长不是朗读请求）；渲染端请求收窄到 worker 接受的字段。音源列表要采样峰值表，所以是 invoke。每句终稿的翻译与会话结束的字幕文件在主进程 `listen/listen-translator.js`。下载的离线门**不在这里**，在 `audio-pack-manager.downloadPack`，对所有调用方成立；`OFFLINE_BLOCKED` 经 catch 像其他拒绝一样到达。神经 TTS 纯本地合成，离线与安全门都不适用，音频只回给 `event.sender` 不广播。静音门：每扇窗报自己的播放状态，manager 取或——一扇窗停了不会在另一扇还在说时解除静音。语音包与识别包同一份 manifest、同一进度通道，自己的根与管理器（`tts-models`，逐出的是语音不是会话）。
- **GPU 开关**（`ipc/gpu.js`）：一个持久化标志 `settings.gpu.enabled`，主进程套到 `tengine/registry.js` 里每个能上显卡的引擎。打开是一次自检不是许愿：每个引擎在自己的宿主进程里把模型载上显卡并热身，上不去的自己回 CPU 并说明原因；至少一个成功开关才生效，设置页显示每个引擎的真实后端。提供器即时切换（下次请求重建会话），不重启程序。听译按表留在 CPU（int8，见 T-ENGINE §10）。每引擎记最近一次自检，页面显示后端不用为了问一句就拉进程。
- **存储**（`ipc/models.js`）：引擎持有模型文件句柄，搬迁与清理前先停听译会话、释放语音、丢 OCR 会话。旧 `%APPDATA%` 文件夹只在 userData 真的搬走过**且**里面还有东西时才提供清理：Electron 每次启动都会重建默认 userData 目录（空的），那个壳不是旧数据，不能让按钮复活。删除在还有模型包时拒绝（先搬——700 MB 不是该误删的量），也拒绝删活目录或其父目录。
- **T-Engine**（`ipc/tengine.js`）：主进程是事件流的第一个读者，每个宿主生命周期事件都进程序日志，引擎出问题没开窗也留痕。指标落盘（T-ENGINE §7）安全模式不写，门逐事件读，会话中切模式下一行生效。

## 5. 全局快捷键（ipc/shortcuts.js、shared/shortcut-rules.js）

- 渲染端写 Ctrl / Meta，Electron `globalShortcut` 要 CommandOrControl / Command。
- 悬浮窗重截键（`CommandOrControl+Alt+Space`）不让悬浮窗取得焦点：目标程序（Teams 字幕、浏览器）要保持前台不藏内容；悬浮窗隐藏时空操作。
- 新绑定与别的程序冲突时恢复旧绑定；编辑绑定期间「暂停」= 先注销，用户才能按那个键。
- **修饰键规则**：没有强修饰键的绑定（裸 Backspace / 空格 / 字母）注册能成功，但程序运行期间会在系统范围吞掉那个键；Shift 单独不算——Shift+字母仍会劫持打字。F1–F24 没有打字职责可以裸绑。规则被 IPC（更新时拒绝）与启动注册（修复已持久化的绑定）共用；两种拼写（渲染端格式与 Electron 别名）判法相同，手改的配置也判得对。启动时修复是因为规则出现之前记下的裸键会在每次启动时零反馈地劫持系统按键。

## 6. 预加载

- 主窗口预加载需要 `sandbox: false`，因为它提供 JSON 读写的最小 fs 助手。接收通道有允许表：通用 `ipc.on / ipcRenderer.on` 桥按它把关，渲染端不能订阅任意通道；send / invoke 不需要表，它们只能经显式的 electronAPI 方法到达。暴露时去重：热重载会重新执行 preload，只有「API already exposed」这个错误是良性的。
- 三个覆盖层窗口（悬浮窗、划词窗、子面板）都有单向的崩溃上报到磁盘日志——渲染端日志以前只写控制台，这些窗口的任何错误都活不过一次重启。
- 悬浮窗与划词窗能**只读**隐私模式：流水线按它过滤云端翻译源，截图是最敏感的输入；切模式留在主窗口。划词窗没有 secureStorage：翻译 v0.3.1 起在主进程栈里，这扇窗没理由看到解密的密钥。划词窗只翻译，`stackBridge` 用 `keys` 收窄，不暴露测试 / 管理面。
- 主窗口不碰听译会话：只管理包；听译的抓音、会话控制属于悬浮窗预加载。只读状态（哪个模型在线、草稿引擎在不在）单独一条：手放的模型文件夹没有 pack.json，光看包列表答不了「现在能不能听译」。
- 语音包与识别包同一进度通道，靠载荷里的 packId 分列表。神经 TTS 是主窗口拿到的唯一音频引擎面：合成在音频 worker，PCM 逐句流回、在窗口里用 WebAudio 播放；任何引擎（含系统语音）播放都会静音听译抓取。

## 7. 共享表（electron/shared/）

- **通道表**（`channels.js`）：每个通道旁注明方向与载荷。v0.4.1 抓音进 worker 原生 WASAPI 层后，渲染端不再产 PCM，它曾用来推的 pcm / event 通道整体删除而不是留着悬空。`PRIVACY_MODES` 三个值必须齐全（见第 2 节）。`module.exports.default` 是给 Vite ESM 消费者的。
- **常量表**（`constants.js`）与 `src/config/constants.js` 成对，`npm run check:constants` 校验同步。
- **OCR 包注册表**（`ocr-packs.js`）：基础包随程序，语言包按需从 `ocr-models` Release 下载；高精度变体类型 `base-variant` 让它既不出现在基础行也不出现在语言包列表。语言分组镜像 `src/config/ocr-languages.js` 的 `OCR_LANGUAGE_GROUPS`（渲染端不能 import 这份文件，`check:languages` 防漂移）；为什么越南语 / 希腊语 / 乌兹别克语 / 蒙古语不在列表、以及上游 `ka` 其实是卡纳达语不是格鲁吉亚语，见 `docs/OCR_MODELS.md`。manifest 里还带其他程序代际的条目（它们的基础包、已并入本代基础模型的包），跳过本代用不了的；已装但不在 manifest 的包（或 manifest 没拉到）仍列出、仍可卸载——永远不藏磁盘上有的东西。
- **音频包注册表**（`audio-packs.js`）：类型 = 基础终稿引擎（含 VAD，恰好一个）/ 两遍草稿引擎（可选，缺则伪流式草稿）/ 高精度终稿引擎（v0.4.8，可选，替换基础引擎出终稿，VAD 仍由基础包提供，永不单独存在）/ 神经语音包（任意个）。一份 manifest 两个领域共用，各包管理器只列自己的类型；新版程序才认识的类型跳过而不是列出。**超过 400 MB 的包只给链接**（v0.4.10 起的规矩）：用户自己下上游压缩包、把文件夹放进 `<models>/asr-models`，注册表里的布局就是定位器信任的布局，有没有 pack.json 都算（「手放 = 本地可信」）；随程序内置所以离线也能解析，并合并进同 id 的 manifest 条目，设置页能显示链接与目标文件夹；`scripts/fetch/audio-model-sources.js` 有同一条目给发布构建，单测保证两处一致。
- **LLM 白名单**（`llm-packs.js`）：这是 T-Engine 唯一会加载的 GGUF 文件，除非开发者门打开。GGUF 解析器出过内存安全 CVE，所以 sha256 是安全边界不是提示；每年与 llama.cpp 构建一起重新钉版。权重从不打包或转存，用户按链接下载放进 `<models>/llm-models`。白名单外文件的角色只看文件名：只有混元 MT 家族（hy-mt2-7b、hunyuan-mt-1.8b …）是仅翻译——与栈里给 LM Studio 模型选模板的家族判断相同——其余都是通用模型，名字里别处出现 "MT"（Qwen…-M-TI）不算。按名字与精确大小做廉价预检，扫描器只在文件可能是白名单里那一个（或其 mmproj）时才哈希 2 GB，哈希仍是最终裁决。
- **路径表**（`paths.js`）在 app ready 之前就可能被加载，所以不用 `app.isPackaged` 判开发态。**主进程 i18n**（`main-i18n.js`、`tray-labels.js`）：react-i18next 只在渲染端，主进程维护自己的小表，语言检测复用托盘表的 `getLanguage()`。
