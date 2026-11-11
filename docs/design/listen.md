# 听译与朗读设计说明

代码里只留「这段做什么、接到哪」的指针；每个数字为什么是这个数、踩过什么坑，记在这里。涉及的文件：`electron/services/audio-engine/`（worker 进程：`audio-worker.js` 协议分发、`asr-session.js`、`capture.js`、`tts.js`、`io.js`、`probe-metrics.js`、`tts-text-en.js`、`asr-result.js`）与 `electron/listen/`（`audio-engine-manager.js`、`listen-translator.js`、`listen-autosave.js`、`listen-prompt.js`、`asr-models.js`、`win-audio-capture.js`、`win-audio-gain.js`、`win-audio-resample.js`）、`electron/tts/`。

## 1. 进程与边界

- ASR 与神经 TTS 跑在同一个 utilityProcess：两者共用一份 sherpa / onnxruntime，原生崩溃不会拖垮主进程。合成在插件自己的线程上，听译会话和朗读只争 CPU。
- 抓音（v0.4.1 起）也在 worker 里：WASAPI 直接把 16 kHz 单声道 float32 交给 VAD，不经渲染端、不走屏幕捕获权限。标准档的音频在被识别前不跨进程；高精度档的定稿段经主进程送到 T-Engine 的语音宿主（§4），同样只在内存里，不经渲染端、不落盘。
- 音频帧只转写不落盘。JSONL 会话日志只记时延与指标；识别出的文字默认不写（`TT_LISTEN_LOG_TEXT=1` 才写），看视频不留逐字稿。无痕模式连指标日志都不写；会话中切入无痕，`log-close` 立刻停写、会话照常。
- 零闲置：会话结束 worker 随之退出；宿主窗口关闭时 `once('closed')` 兜底强停。唯一的放宽是 TTS：语音包加载要 1.3–2.2 s，TTS-only 进程在最后一句后保温 `TTS_IDLE_MS`（悬浮窗还在屏上就继续保温），之后退出。听译会话复用已起的进程；会话里加载的语音随会话同生同灭。高精度档的语音宿主不跟 worker 走，最后一次请求 5 分钟后卸载（llm-manager 的媒体槽）。
- 崩溃重启：一次会话只自动重启一次，再崩就报 `engine-dead`。载入阶段就死（`everReady=false`）不重试——手放的假 ONNX 走原生异常（0xE06D7363）把进程带走，JS 的 try/catch 接不到，再载入只会同样崩。
- 会话日志文件只留 3 份（`MAX_PROBE_LOGS`，用户 2026-09-03 拍板）：它只记指标与错误，任务是解释最近一次故障。

## 2. 分段策略（asr-session.js）

VAD 只交出已闭合的段；开段期间 worker 自己镜像音频，每 `PARTIAL_INTERVAL_MS` 重解一次做草稿，闭合后的定稿替换草稿。译文只消费定稿（v0.4.0 契约）。

分层强制切段，对齐专业字幕每条 ≈7 s 的上限与 sherpa 自身「段越长越放宽停顿阈值」的思路：

| 阶段 | 规则 |
| --- | --- |
| < `SOFT_SPLIT_FROM_S`（5 s） | 只有 VAD 的静音闭合 |
| ≥ 5 s | 谷值切：最近 `VALLEY_WINDOWS`（8 窗 ≈ 0.26 s）全部低于自适应 RMS 地板（段均值 × `VALLEY_RATIO`）就在此定稿；切点与 VAD 的再确认都落在静音里 |
| ≥ 5 s 且流式草稿 | 文本静止切：草稿 `TEXT_QUIESCENCE_MS`（0.8 s）没长就闭合——唱腔与拖音让声学地板一直高，但草稿引擎在句尾停止出字，是两遍架构白送的语义停顿信号 |
| ≥ `HARD_SPLIT_S`（9 s） | 硬切，切在最近 ~1.5 s（`CUT_LOOKBACK_WINDOWS`）里最安静的窗（`pickCutWindow`），保留至少 `CUT_MIN_TAIL_WINDOWS` 给下一段开头 |

- `VALLEY_RATIO` 0.3（曾 0.2）：真实 BGM 抬高能量地板，0.2 时谷值几乎从不触发（探针日志：旁白 0/14、歌曲 1/10），全靠 9 s 硬切。音乐里的假谷值落在间奏，本来就是句界。
- sherpa 自己的 `maxSpeechDuration` 只当不可信的后备（12/18 上限下曾记到 21 s / 31 s 的段）。
- 硬切后的尾巴（切点到 VAD 再确认之间）是下一句的开头，显式带入下一段（`carry`），用全局采样位置无重叠地拼在下一个定稿前；之前每次硬切后下一段都少一两个字（"ut your"、"rote about"）。没人再确认的 carry 超过 `CARRY_MAX_S`（3 s）自己定稿。
- Pre-roll：静音期保留最近 `PRE_ROLL_WINDOWS`（19 窗 ≈ 0.6 s）。VAD 约 0.15 s 的确认窗会吞掉句头（"些技术" ← "这些技术"）；朗读语音上软起音能晚开到 1.5 s，0.6 s（曾 0.32 s）是英文管线 WER 14.7% → 10.6% 的一部分。
- 段起点只能前进：强制切段调用 `vad.reset()`，sherpa 的段时钟随之归零，导出的 SRT 时间轴曾倒退（17.10 → 22.18 → 0.23）。两种段源都改基于 `vadFedSamples` 的会话时钟。
- 音乐上的短碎片（`isNegligibleFinal`：CJK ≤ 2 字、拉丁 ≤ 3 字，且定稿标 `<|BGM|>`）不上屏、不翻译，只算看门狗活动。

## 3. VAD、AGC 与阈值

- 只用 silero。ten-vad 2026-08-27 试过当天回退：sherpa 移植去掉了音高特征，真实音乐（主要场景）漏掉大部分唱腔——67 s 歌曲只出 3 个碎段，silero 连续出。除非先在 BGM 日志上赢过 silero，别用干净语音基准把它加回来。
- `minSpeechDuration` 0.15（曾 0.25）：更快确认起音。`minSilenceDuration` 0.5（0.35 → 0.5）：0.35 把朗读句在每个逗号处切成无上下文碎片，FLEURS 英文 WER 14.7% (0.35) vs 10.6% (0.5)，0.6 没有更好；代价每个定稿晚 0.15 s，强制切段仍兜住无停顿语音。`maxSpeechDuration` 18：12 时 27% 的段被硬切（p90 14.9 s），18 过 p90，SenseVoice 超过 ~20 s 退化，不再高。
- 阈值按内容：语音 0.5、音乐 0.3（`makeVadThresholdPolicy`）。真实歌曲经进程环回，0.5 只开出 86% 的歌词行，0.3 100%，语音不受影响（gstack v041-listen-music-diagnosis）。SenseVoice 每个定稿带音频事件标签，最近三条里两条 BGM 就降，连续三条语音才升；只在段间换 VAD 实例（新 silero 从非语音态起步，段中换会丢后半句）。
- 看门狗（`makeSignalWatchdog`）：`no-audio` 5 s 无声；`no-speech` 12 s 有声无定稿（曾 30 s：探针日志有一段 21 s 音频在进、VAD 不出，30 s 内用户毫无提示）。12 s 大于任何正常句间隙（9 s 硬切）。VAD 开着段也算活动，否则干净语音基准的第一句就误报并放宽了 VAD。`no-speech` 且仍在 0.5 时整场降到 0.3 并锁住（`hold`）——会随三条语音定稿爬回去的策略 12 s 后又聋。
- AGC（`makeAgc`）：silero 对电平敏感而识别器不敏感（fbank 归一化，VAD 不）。FLEURS 录音 rms 0.003 在 0.5 下从不开段，SenseVoice 却转写正常；前置后英文 WER 22.9% → 14.7%（gstack v042-accuracy-baseline）。32 ms 窗的慢包络：快攻（起音不过放）、慢放（停顿不抽噪声底）、门限放过数字静音、上限 30 dB；只抬不压，响源原样——所有早期测量都在这个域。初始包络取门限的十倍：安静的第一句立刻抬起，而不是等慢放的 ~5 s。
- 电平表与 rms 指标读原始信号，安静源在日志里仍显安静。

## 4. 两遍引擎、语言钉与高精度档

- 草稿引擎（流式 zipformer）可选：zh/en 选定 → `stream`；ja/ko/yue → `pseudo`（模型无此语言）；自动 → 先 `pseudo`，第一条 zh/en 定稿切到 `stream`（并追喂已镜像音频）；其他标签不信（歌曲前奏上 yue/ja 是噪声），交给语言钉。载入失败静默降 `pseudo`，定稿链永不依赖草稿。草稿在段界重置（自然闭合与强制切都在静音里）；若在定稿落地时重置会丢下一段的开头。
- 语言钉：自动语言会话里连续 `LANG_PIN_STREAK`（3）条同语言定稿后把识别器钉到该语言。SenseVoice 逐段检测在混合或音乐音频上漂移（一首中文歌 31 条定稿里 5 条标成 ja/yue/en），错语言解出的是垃圾。重建只在段间、在解码链里做，在途定稿不会看到半建的模型。
- 高精度档（Qwen3-ASR，经 T-Engine 语音宿主）：worker 照常切段，定稿段发给主进程（`hq-transcribe`，16 kHz float），主进程交 `llm-manager.transcribe` → `llm-asr` 宿主（llama.cpp + mtmd 音频编码器，`runtime/mtmd.js` 的 `attachAudio`），结果回 worker（`hq-result`）后与 SenseVoice 定稿同样处理。定稿不带语言与 BGM 标签，语言钉与音乐策略在它下面不触发；草稿只信流式引擎，没有就 `none`。
- 为什么换：v0.4.10 试过把 sherpa 的 Qwen3-ASR fp32 直接放 WebGPU，总 RTF 与 int8 CPU 持平——sherpa 解码每步把 57 个输出（logits + 各层 KV）从显卡读回，每个 token 固定 50–60 ms（gstack v049-gpu-research）。llama.cpp b10853 的 mtmd 自带 Qwen3-ASR 音频编码（`qwen3a`，上游 PR #19441），KV 缓存和采样留在显卡上，钉版不用换。引擎级 FLEURS 各 150 句：0.6B 显卡中文 CER 7.69%（sherpa int8 7.76%）、英文 WER 5.39%（6.63%），每句中位 0.12 s（1.57 s）；1.7B 为 7.06% / 4.69%，0.2 s（gstack v053-hq-asr-gpu-spike）。英文差距里有一截是数字写法：sherpa int8 把数字念成单词，GGUF 出阿拉伯数字，和参考一致。
- 同一个 GGUF 也在 CPU 上跑，sherpa 的 qwen3Asr 分支撤掉：8 GB 以上的独立显卡上取 1.7B，更小的卡、核显和 CPU 上取 0.6B，只装了一个就用那一个（`resolveAsr`；显存规则与实测账在 T-ENGINE.md 第六节）。CPU 线程定 4（核少的机器按核数一半，至少 2）：整链英文 40 句定稿延迟中位 / p90，8 线程 1.13 / 2.49 s（另一次积压到 29.8 s，与 worker 的草稿引擎抢核），2 线程 1.16 / 1.57 s，4 线程 0.85 / 1.11 s。
- 兜底在 worker 侧，SenseVoice 一直加载着：宿主报错或被停滞保护（P6）判为不健康 → 这一段由 SenseVoice 出；一段在解码链里排队超过 2.5 s → SenseVoice（积压上限）；10 s 没答复 → 发 `hq-cancel` 撤回（不撤的话那条慢请求继续占着宿主，后面几段跟着排队、跟着超时），这一段由 SenseVoice 出，之后 30 s 冷却期都走 SenseVoice，再回到高精度。停止之后剩下的定稿共用 2 s：已经在宿主上的那段改成 2 s 到期撤回，还没发出的剩不到 0.5 s 就直接走 SenseVoice——worker 要等解码链清空才发 `asr-stopped`，而管理器只给 3 s 停止宽限，超了整个进程被杀，最后一句连同自动保存一起丢。退回在会话日志里记 `hq-fallback`（原因：错误码 / backlog / timeout / cooldown / stop），bench 数的就是它。
- 会话开始时预载语音模型（`ensureAsrLoaded`）；预载和第一段定稿同时到时合并成一次载入（媒体槽的 `slotLoading`）。
- 整链 bench（FLEURS 40 句，原始电平，定稿延迟中位 / p90）：显卡 1.7B 中文 CER 11.8%，0.65 / 0.89 s；英文 CER 8.4%、WER 10.8%，0.42 / 0.71 s。CPU 0.6B 中文 11.9%，0.90 / 1.13 s；英文 8.4% / 11.4%，0.85 / 1.11 s。旧 sherpa CPU 档英文 WER 12.8%，1.1 / 1.5 s；中文 10.8–12.4%，1.1 / 1.4 s。整链的中文差距被切段稀释（40 句里 22 句被切成多段）。别的程序把 CPU 吃满时（实测另一个进程占 ~85%），CPU 版每段都会超时，兜底把延迟压在 10 s 以内。
- 带背景音乐（2026-09-26，用户给的中英混唱说唱，203 s，按 LRC 歌词打分，会话语言自动）：整链字错率 标准档 39.3% → 显卡 1.7B 23.6% / CPU 0.6B 21.9%，零退回；纯引擎按歌词行切段，新引擎 31.4% 与旧 sherpa 31.3% 持平，SenseVoice 45–54%。「带音乐或噪声时更准」这句提示据此保留。
- 弱 CPU（同日，钉核模拟，FLEURS 中文）：4 核 8 线程与本机一样（0.86 / 1.10 s，零退回）；4 核 4 线程、2 核 2 线程、4 核 4 线程外加同核跑内置翻译模型，定稿中位都在 1.5 s 左右、p90 约 3.6 s，40 段最多退回 1 段，准确率不变。决定快慢的是语音线程数（4 → 2 慢一倍），总核数和同核的翻译负载影响很小。单核本身慢的老 CPU 模拟不了（不能降频），按比例估每段约 2.5 s，排队超限的段会多起来、改由标准档出。数字与方法在 gstack v053 报告「2026-09-26 补测」。
- 旧 sherpa 高精度包（`asr-hq` 类型、`MANUAL_PACKS` 条目）：新版不再用，设置页只在已安装时列出、供删除；audio-models 的 manifest 仍保留这个条目给旧版程序（它们靠它显示和下载高精度包），别删。
- 档位是高精度而语音槽不可用（没放模型、换了电脑、升级前装的是旧包）：会话照常按标准档跑，进入监听后发一次 `hint-hq-missing`，8 秒后没被别的状态顶掉就退回 `listening`。只在会话开始时判断，中途放好模型要下次开始才生效；设置页的档位下面同时有一行常驻说明。
- 经 sherpa 跑 Qwen3-ASR 时的换行 / `<asr_text>` 帧问题随 qwen3Asr 分支退役；`asr-result.js` 只剩 JSON 宽松解析（sherpa 手写 JSON 不转义控制字符，SenseVoice 也走它）。llama.cpp 路径由 `mtmd.parseAsrReply` 拆「language X<asr_text>正文」。

## 5. 抓音（win-audio-capture.js）

- koffi 驱动 COM，不编译原生插件（与 native-helper 同路线），Electron 升级不用重编。
- 两种激活、一种输出：`system` = 默认渲染端点 `IAudioClient` + LOOPBACK，所有 Windows；`include/exclude` = `ActivateAudioInterfaceAsync(VAD\Process_Loopback)`，需要 build 20348+（消费级 Win10 止于 19045，实际即 Win11），UI 必须如实降级到全系统。
- 系统环回在端点音量之后取样：静音得静音，音量 8% 是 -38 dB，把 0.35 rms 的歌变成 0.005，silero 聋了（歌词行 38% → 补偿后 95%）。`win-audio-gain`：读 `GetMasterVolumeLevel`（dB，滑块的 0..1 不是线性幅度：8% 读 -38 而不是 -22），反向补偿，上限 40 dB（-60 dB 的滑块不能把噪声底当信号），留 6 dB 余量（引擎实测比端点少衰减 ~1.5 dB、有的播放器热 ~2 dB、砖墙母带还原过头会削波；0.19 rms 与 0.31 的歌词覆盖率相同）。硬件音量的设备环回本来就没衰减，反向增益只会削波，而硬件标志说不清（Realtek 报硬件音量仍软件衰减），所以看结果：增益下持续削波（`makeClipGuard`，32000 样本窗内 >1% 削波）就整场关掉补偿。
- 进程环回在端点音量之前取样，静音照录。它没有 mix format（`GetMixFormat` 返回 E_NOTIMPL），可直接要 16k 单声道，但引擎自己的转换让 VAD 少开 14% 歌词行（86% vs 95%）；改要原生 48 kHz 立体声，在 `win-audio-resample` 用 63 抽头 windowed-sinc 3:1 抽取（每输出样本一次点积，~1M 乘/秒）。系统路径让引擎转换（AUTOCONVERTPCM，实测与自转相同）。
- 目标进程退出后进程环回继续送零包，无标志无 HRESULT（实测），每 ~1 s 查一次进程是否还在，没了报 `source-gone`，manager 原地切回全系统抓音。
- 轮询而不阻塞事件句柄：pump 跑在 worker 唯一的 JS 线程上，阻塞会停掉解码；20 ms 对 2 s 客户端缓冲无溢出风险，延迟可忽略（首字 ~560 ms）。`DATA_DISCONTINUITY` 计数而不忽略：它区分「音频停了」和「我们没读」。静音包没有有效数据指针，但时间轴必须推进，否则 VAD 看到跳切而不是停顿。
- 设备失效（插耳机换默认设备）是明确的 HRESULT（`AUDCLNT_E_DEVICE_INVALIDATED`），800 ms 后重建，最多 3 次。
- COM 完成回调对象由 koffi 回调表拼成，所有部件在激活期间必须保持引用，否则 GC 会在 Windows 脚下释放 vtable；引用计数返回常量（生命周期归我们）。koffi 的 proto 名字全局唯一，只声明一次。MTA 初始化：进程环回激活在工作线程上完成；主进程里返回 RPC_E_CHANGED_MODE 无妨。`koffi.address()` 不接受 Buffer，要嵌进结构体的内存用 `koffi.alloc`。激活超时 3 s（曾 10 s）：健康激活 ~4 ms，等十秒的用户会先按停止。
- 只有打开过音频流的进程才出现在会话列表里，所以选择器是「先放声再选」。

## 6. 会话管理（audio-engine-manager.js）

- 进程归属、模型载入计时、退出分类、provider 与朗读自检在 T-Engine 适配器（`tengine/engines/audio.js`）；这里只剩会话语义：来源、语言、档位、告诉窗口什么、一次性重启。
- 抓音在 `asr-ready` 之后才开：模型还在载入时打开的音频客户端只会填一个没人读的缓冲。会话中途开始的 TTS 静音闸门会被新会话继承。
- `asr-stopped` 后先 `unload asr` 再决定进程去留：模型文件此刻释放，`stopSessionAndWait` 背后的包替换依赖它（Windows 上 worker 还开着 .onnx 时换包会失败，而且会失败在 150 MB 下载的最后一刻）。
- TTS-only 的 worker 上「先卸载再做事」有陷阱：`unloadTtsAndWait` 对 childState idle 的进程语义是让子进程退出，随后的 `tts-load` 发给已死句柄会 60 s 超时。自检因此不再先卸载（worker 切 provider 已自行丢弃语音，同 provider 驻留时 `tts-load` 重发 `tts-ready`）。
- 静音闸门按上报的 webContents 计数：多窗口互不解除；worker 侧丢弃闸门期间的音频再加 300 ms 尾巴（环回路径的延迟），程序永远不转写自己的声音。这在每个 Windows 版本都可用，不像进程排除，也不需要重启音频客户端。
- `normalizeSource` 把渲染端给的来源收窄成 worker 接受的三种形态；`off` 不开音频客户端，由调用方喂 PCM（smoke / bench 回放 wav）。
- **会话归属与 sink**（2026-11-09，为伴生通道加）：`startSession({ owner: 'companion', sink })` 让会话向 sink（status / segment / partial / translation / autosaved / level 任选）汇报而不是向宿主窗口，不挂窗口关闭兜底，翻译器按会话关掉 SRT 自动保存（`beginSession({ autosave: false })`，转写仍留在内存给翻译当上下文）。一次只有一个会话：伴生来的 start 碰上占用返回 `{ ok: false, busy }`；**用户自己的听译优先**——窗口 start 碰上伴生会话时先 `stopSession('preempted')`，把这次 start 存进 `pendingStart`，等 worker 退出或转为 TTS 保温后 `finishSession()` 再起；sink 在最后一个终态状态（stopped / model-load-failed / engine-dead）送达之后才清。窗口自己的 STOP 带 `{ from: 'window' }`，不会结束它没开的伴生会话（悬浮窗卸载时会盲发一次 STOP）。

## 7. 朗读（tts.js、tts-text-en.js、tts-models.js）

- 一次只驻留一个语音包，`generate` 指名别的包先换；合成串行；取消让进度回调返回 0，sherpa 中途停。`TtsRequest.enableExternalBuffer` 必须为 false：Electron 的 V8 内存笼拒绝 napi 外部 ArrayBuffer（"External buffers are not allowed"），与 `Vad.front(false)` 同一个雷，且只在第一次真实合成时爆。
- 4 线程：kokoro fp32 在桌面 CPU 上 4 线程 RTF 0.23–0.28，ASR 用 2 线程，6 核机器两边都不饿抓音。WebGPU 上并行由运行时做，多线程只会争抢（1 线程）。
- WebGPU 每种语言第一次合成要编译管线（中文实测 2.8 s），载入时用每种语言一句短话热身（`warmup`），失败不致命（sherpa 会话内已回退 CPU）。
- `maxNumSentences: 1` 才让进度回调按句流出：第一块是第一句，不是整段。
- 语音包的中文规则 FST（number-zh / date-zh / phone-zh）会把英文句子里的 "2026" 读成中文；无 CJK 的文本先把数字拼成英文单词（`tts-text-en`），FST 就无可改写。
- 各包语速不一致：MeloTTS 中文比 kokoro 快 ~20%（同一 22 字句 kokoro 5.09 s、MeloTTS 4.18 s），`speedScale`（每包一个数或 {zh,en}）重定基滑块，0.9 是用户 2026-09-02 听感定的；manifest 未带 speedScale 的旧包用 `DEFAULT_SPEED_SCALE`。
- `ttsGen` 代数：换包期间排在运行中合成后面的卸载，若中途来了新载入即作废。

## 8. 模型包与目录（asr-models.js、tts-models.js、pack-roots.js）

- 两种布局都认：包（`asr-models/<packId>/pack.json` 的 `files` 映射角色 → 文件名）与手放的 sherpa 原始 tarball（VAD 在根、目录名含 `sense-voice` / `streaming-zipformer`，文件名固定）。包优先；基座与草稿各自独立解析，可混搭。高精度档的模型不在这里，由 llm-manager 在 `llm-models` 里按白名单认（§4）。链接手放的大包（`MANUAL_PACKS`）无 pack.json，目录名与文件清单就是契约，同 id 的 pack.json 安装胜出。
- 多根：安装目录的 models 为活动根，旧的 userData 位置仍被列出、可用、可删；活动根在 id 冲突时胜出（`pack-roots.js`）。
- 语音包每个引用路径都必须存在才算可用，半换或手删的目录跳过而不是让 worker 载入时崩。

## 9. 字幕翻译与自动保存（listen-translator.js、listen-autosave.js、listen-prompt.js）

- v0.5.0 起翻译在主进程：每条定稿走同一个栈、同一道隐私门，流式推给悬浮窗（`{id, text, done}`），窗口只画；转写与已完成的译文一起留在这里，会话结束落 SRT 时不管窗口是否还开着。
- 上下文提示词：逐句翻译丢掉代词、话题与语域，把前两句放进 system 消息、user 消息只留当句，小模型才不会连上下文一起翻。只有 LLM 源读 `systemPrompt`，MT 引擎忽略。上下文最多 2 行 / 300 字。
- 字幕行 `noCache`：一次性的行缓存了只会挤掉用户真正的翻译缓存。重绘节流 100 ms，快模型不至于每个 token 一次提交。会话结束等在途译文最多 3 s 再落盘。转写上限 20000 行（两小时电影约 2000 行），是失控兜底不是预算。
- 自动保存到 `<data>\listen\<程序名>-<本地时间>.srt`，只留 20 个；无痕不写、用户开关可关，门在主进程。

## 10. 与文档相关的旧记录

- 音乐场景诊断与阈值数字：gstack `v041-listen-music-diagnosis`；进程环回 spike：`v041-process-loopback-spike`（激活 4 ms，EXCLUDE 模式实测 0.00000，静音下进程环回照抓 0.03874 vs 0.03877）；准确性基准与 AGC / 切分数字：`v042-accuracy-baseline`；听译复查：`v050-listen-review`。

## 11. 伴生通道（companion/）

T-Caption 浏览器插件把字幕文本送来翻译、把音频送来识别；程序只当引擎，数据只在本机。代码：`electron/companion/`（`protocol.js` 常量与纯函数、`session.js` 会话包装、`server.js` HTTP 服务、`index.js` 按开关起停），IPC 在 `electron/ipc/companion.js`，冒烟 `npm run smoke:companion`。

- **为什么 HTTP + NDJSON，不用 WebSocket**：Node 只有 WebSocket 客户端没有服务端，不加依赖就得自己写帧协议；MV3 的 service worker 读 `fetch` 的响应流最顺，WebSocket 在它被浏览器停掉时没有任何保证。一个请求一件事，错误就是 HTTP 状态码。事件流每行一个 JSON，`{}` 是 15 s 一次的心跳，让插件分得清「没有新字幕」和「连接断了」。
- **只绑 127.0.0.1**，端口从 38423 起逐个试 10 个；Windows 把 Hyper-V 保留段报成 EACCES，也当占用跳过。插件在同一范围里探测。
- **三道门，顺序固定**：① `x-tt-client: t-caption/<版本>`——网页加自定义头必须先预检，而预检拿不到授权；② Origin 只认 `chrome-extension://` 加 32 位 a–p 与 `moz-extension://` 加 UUID，没有 Origin 的非浏览器客户端（冒烟脚本）放行，`null` 与任何 http/https 一律 403；③ Bearer 令牌，常量时间比较，只有 `/v1/pair` 不要。网页来源永远拿不到 CORS 头：就算某个请求漏过去，浏览器也不把响应交给网页。私网预检（Private Network Access）的许可只回给扩展来源。三道门的拒绝每分钟最多记 5 条 warn，刷不爆日志。
- **令牌放 `companion.token`，不放 `settings.*`**：渲染层的通用 store 桥只读写 `settings.*`（`electron/ipc/store-allowlist.js`），令牌在外面，设置页能看状态、开配对、换令牌，却读不到令牌本身。令牌只经配对交给插件。
- **配对窗口一次性**：设置页点一下开 60 s，第一次配对成功就关；窗口外 `/v1/pair` 回 403。换令牌让已配对的插件全部失效、断开事件流，要重新配对。
- **会话**：一次一个（听译会话本来就只能一个）。`feed` 模式插件送 PCM（float32 小端、16 kHz 单声道，单次 ≤ 1 MB、每秒 ≤ 20 次）；`system` 模式由 worker 抓系统声音，是 DRM 站点的兜底——受保护的视频拿不到音频数据，只能听扬声器里出来的声音。事件只送 status / segment / translation / closed，不送草稿和电平：插件按时间轴显示定稿，草稿用不上。积压最多 500 条，订阅时先补发，插件晚连上事件流也不丢开头；会话结束后用同一 id 还能拿到最后的 `closed`。
- **时间轴**：segment 的 start / end = 打开时给的 `mediaStartS` + worker 的会话秒。worker 崩溃自动重启后时钟从 0 起，`feed` 模式按已收的样本数续上，`system` 模式按墙钟估。
- **预算与背压**：送进去的音频最多领先最新终稿的结束点 60 s，超了回 429 和 `Retry-After`。插件预取音频（钩 MSE，约提前 1 分钟）不会把 worker 喂出积压；没有人声的长段（片头曲、长静音）里没有终稿，60 s 后自然卡住，插件据此挂起预取，等播放追上再续，或带新的 `mediaStartS` 重开会话。`x-seq` 重复或倒退回 409 `stale-seq`（重试不会喂两遍），跳号照收。
- **跳转**：插件的视频跳过 3 s 以上时，不关会话重开（重开 = 退出进程、重新加载模型，到首句约 6.7 s），而是 `POST /v1/asr/seek {id, mediaStartS}`，同一个识别会话原地换起点；`hello` 的 `capabilities.seek` 为真才这么做，旧程序照旧关 / 开。
  - worker 把还开着的半句按旧时间轴冲成终稿、清掉音频状态（不满一窗的尾巴丢掉），模型不动，回 `atS`：worker 自己的会话秒，就是分界，此后的终稿起点 ≥ `atS`，冲出来的 < `atS`。由 worker 报而不由主进程按已收样本算：worker 不算那条尾巴，TTS 门开着时还整段丢，每次差几十毫秒，跳得多了会累积。worker 时钟不归零，归零会让旧终稿和新终稿撞时间。
  - 通道会话记一串 `epochs`（会话秒 → 媒体起点），每条终稿落到起点不晚于它的最后一条；崩溃重启只改 `clockS`，epoch 存的是会话秒，不受影响。跳转前送进去还没出终稿的音频作废，预算在分界处放掉，否则新位置一直 429。翻译上下文在第一条起点 ≥ `atS` 的终稿处断开，不在回 ack 时断：冲出来的半句是 ack 之后才解完的。
  - 插件把会话从旧媒体流「租」给新媒体流：旧流的喂送器等在途那一包送完再交出（新流的 seek 和旧流的 feed 走两条连接，不等会乱序），下一条同语言对的流解出音频时用 seek 接手，失败就关掉再按老路开新的；5 s 没人接就关（跳转后马上暂停）。旧流照样只发一次 `closed`，reason `handover`。
  - ack 之后才解完的终稿（那半句、预取积压的几句）送到新流的 key 下，时间还是旧位置的；译文跟着它的终稿走。新流的打开赶在旧流的关闭之前到时（MSE 的推送排在关闭前面），同语言对的替换也当交接。
  - 跳到还没缓冲的位置时，视频在 seeking 里 readyState 掉到 2 以下，状态机先以 `other-tab`（本页不再合格）停掉，而不是 `seek`；service worker 看停的那一刻主视频是不是还在 seeking，是就同样不排空、交接。
- **程序不留记录**：伴生会话不自动保存 SRT（§6 的 `autosave: false`）、不写历史；日志不记音频和文字，只记路由、状态码、耗时与次数，会话指标日志照 §1 只有数字。翻译走同一个栈、同一道隐私门（`stackHooks.translateStream`）；`/v1/translate` 用缓存（字幕文本会重复），听译逐句翻译仍不进缓存（§9）。
- **用户自己的听译优先**：悬浮窗开听译时抢占伴生会话（§6 最后一条），插件收到 `closed`、`reason: 'preempted'`；伴生会话碰上窗口会话回 409 `busy`、`owner: 'window'`。`closed` 的 reason 词表：`closed`（插件自己关）、`idle`（30 s 无人读写）、`disabled`（开关关掉）、`preempted`（被窗口听译抢占）、`window-closed`，以及引擎终态名 `model-load-failed` / `engine-dead` / `no-model`。抢占的原因由管理器放在 `stopped` 的 detail 里（`preempted`，其它停法也带各自的原因），时序判断（下一个微任务里归属已是 `window`）只作没有 detail 时的后备。
- **没人读也没人送，30 秒自动关**：service worker 随时会被浏览器停掉，留下的会话（尤其 `system` 模式还在抓系统声音）不能一直开着。
- **默认关**：`settings.companion.enabled` 不是 true 就不监听端口。
- **会话结束时还在翻的句子**：翻译器给在途翻译最多 3 s 落定（§9）；管理器在这段时间里把 id 不超过该会话最后一句的译文仍送回退役的 sink（5 s 宽限，id 全局递增所以不会错投给下一个会话）；会话包装在 `stopped` 之后等这些 `pending` 过的 id 都 `done`（上限 3.5 s）才发 `closed`。插件在 `closed` 之前收到的就是全部；仍缺译文的句子用 `/v1/translate` 补。
