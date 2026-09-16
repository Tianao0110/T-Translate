# 听译与朗读设计说明

代码里只留「这段做什么、接到哪」的指针；每个数字为什么是这个数、踩过什么坑，记在这里。涉及的文件：`electron/services/audio-engine/`（worker 进程：`audio-worker.js` 协议分发、`asr-session.js`、`capture.js`、`tts.js`、`io.js`、`probe-metrics.js`、`tts-text-en.js`、`asr-result.js`）与 `electron/listen/`（`audio-engine-manager.js`、`listen-translator.js`、`listen-autosave.js`、`listen-prompt.js`、`asr-models.js`、`win-audio-capture.js`、`win-audio-gain.js`、`win-audio-resample.js`）、`electron/tts/`。

## 1. 进程与边界

- ASR 与神经 TTS 跑在同一个 utilityProcess：两者共用一份 sherpa / onnxruntime，原生崩溃不会拖垮主进程。合成在插件自己的线程上，听译会话和朗读只争 CPU。
- 抓音（v0.4.1 起）也在 worker 里：WASAPI 直接把 16 kHz 单声道 float32 交给 VAD，音频在被识别前不跨进程、不经渲染端、不走屏幕捕获权限。
- 音频帧只转写不落盘。JSONL 会话日志只记时延与指标；识别出的文字默认不写（`TT_LISTEN_LOG_TEXT=1` 才写），看视频不留逐字稿。无痕模式连指标日志都不写；会话中切入无痕，`log-close` 立刻停写、会话照常。
- 零闲置：会话结束 worker 随之退出；宿主窗口关闭时 `once('closed')` 兜底强停。唯一的放宽是 TTS：语音包加载要 1.3–2.2 s，TTS-only 进程在最后一句后保温 `TTS_IDLE_MS`（悬浮窗还在屏上就继续保温），之后退出。听译会话复用已起的进程；会话里加载的语音随会话同生同灭。
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
- 高精度档（Qwen3-ASR，v0.4.8）：定稿不带语言与 BGM 标签，语言钉与音乐策略在它下面不触发；草稿只信流式引擎，没有就 `none`（1 GB 模型不做草稿重解）。`maxNewTokens` 512 / `maxTotalLen` 1024：定稿 ≤ 9 s 足够，超出上下文会出垃圾——所以 VAD 门永远不绕过。
- Qwen3-ASR 会在幻觉碎片里吐换行，sherpa 手写 JSON 不转义控制字符，`decodeAsync` 抛 SyntaxError 曾把整个宿主带崩（听译基准抓到的丢句根因）。`asr-result.js`：重读原始 JSON 把控制字符换空格再 parse；`<asr_text>` 帧只在开头才被 sherpa 剥掉，幻觉前导会把整帧漏进字幕，只留标记之后。

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

## 7. 朗读（tts.js、tts-text-en.js、tts-models.js）

- 一次只驻留一个语音包，`generate` 指名别的包先换；合成串行；取消让进度回调返回 0，sherpa 中途停。`TtsRequest.enableExternalBuffer` 必须为 false：Electron 的 V8 内存笼拒绝 napi 外部 ArrayBuffer（"External buffers are not allowed"），与 `Vad.front(false)` 同一个雷，且只在第一次真实合成时爆。
- 4 线程：kokoro fp32 在桌面 CPU 上 4 线程 RTF 0.23–0.28，ASR 用 2 线程，6 核机器两边都不饿抓音。WebGPU 上并行由运行时做，多线程只会争抢（1 线程）。
- WebGPU 每种语言第一次合成要编译管线（中文实测 2.8 s），载入时用每种语言一句短话热身（`warmup`），失败不致命（sherpa 会话内已回退 CPU）。
- `maxNumSentences: 1` 才让进度回调按句流出：第一块是第一句，不是整段。
- 语音包的中文规则 FST（number-zh / date-zh / phone-zh）会把英文句子里的 "2026" 读成中文；无 CJK 的文本先把数字拼成英文单词（`tts-text-en`），FST 就无可改写。
- 各包语速不一致：MeloTTS 中文比 kokoro 快 ~20%（同一 22 字句 kokoro 5.09 s、MeloTTS 4.18 s），`speedScale`（每包一个数或 {zh,en}）重定基滑块，0.9 是用户 2026-09-02 听感定的；manifest 未带 speedScale 的旧包用 `DEFAULT_SPEED_SCALE`。
- `ttsGen` 代数：换包期间排在运行中合成后面的卸载，若中途来了新载入即作废。

## 8. 模型包与目录（asr-models.js、tts-models.js、pack-roots.js）

- 两种布局都认：包（`asr-models/<packId>/pack.json` 的 `files` 映射角色 → 文件名）与手放的 sherpa 原始 tarball（VAD 在根、目录名含 `sense-voice` / `streaming-zipformer`，文件名固定）。包优先；基座与草稿各自独立解析，可混搭。高精度档只有包布局。链接手放的大包（`MANUAL_PACKS`）无 pack.json，目录名与文件清单就是契约，同 id 的 pack.json 安装胜出。
- 多根：安装目录的 models 为活动根，旧的 userData 位置仍被列出、可用、可删；活动根在 id 冲突时胜出（`pack-roots.js`）。
- 语音包每个引用路径都必须存在才算可用，半换或手删的目录跳过而不是让 worker 载入时崩。

## 9. 字幕翻译与自动保存（listen-translator.js、listen-autosave.js、listen-prompt.js）

- v0.5.0 起翻译在主进程：每条定稿走同一个栈、同一道隐私门，流式推给悬浮窗（`{id, text, done}`），窗口只画；转写与已完成的译文一起留在这里，会话结束落 SRT 时不管窗口是否还开着。
- 上下文提示词：逐句翻译丢掉代词、话题与语域，把前两句放进 system 消息、user 消息只留当句，小模型才不会连上下文一起翻。只有 LLM 源读 `systemPrompt`，MT 引擎忽略。上下文最多 2 行 / 300 字。
- 字幕行 `noCache`：一次性的行缓存了只会挤掉用户真正的翻译缓存。重绘节流 100 ms，快模型不至于每个 token 一次提交。会话结束等在途译文最多 3 s 再落盘。转写上限 20000 行（两小时电影约 2000 行），是失控兜底不是预算。
- 自动保存到 `<data>\listen\<程序名>-<本地时间>.srt`，只留 20 个；无痕不写、用户开关可关，门在主进程。

## 10. 与文档相关的旧记录

- 音乐场景诊断与阈值数字：gstack `v041-listen-music-diagnosis`；进程环回 spike：`v041-process-loopback-spike`（激活 4 ms，EXCLUDE 模式实测 0.00000，静音下进程环回照抓 0.03874 vs 0.03877）；准确性基准与 AGC / 切分数字：`v042-accuracy-baseline`；听译复查：`v050-listen-review`。
