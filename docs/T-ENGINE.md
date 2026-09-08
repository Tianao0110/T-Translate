# T-Engine 维护手册

T-Engine 是程序自己的引擎接入层：把本地 OCR、听译、朗读、内置 LLM 这些原生运行时统一装进子进程宿主，用同一套契约管理它们的加载、健康、后端切换与崩溃恢复。这份文档写给以后维护它的人（大概率是未来的自己）：先说边界，再说结构，然后是换版流程、健康与安全口径、排障。

状态：设计已定（2026-09-07，gstack v050-structure-survey / v050-engine-plugin-research），代码随 v0.5.0 第 1 步落地。文中标「已有」的是现在仓库里就有的，其余是落地目标。

## 一、边界

T-Engine 只做三件事：**装载运行时、监控引擎、报告事实**。

- 它不改产品行为。用哪个引擎、什么时候降档、翻译走哪条链，由主进程的策略层决定（`electron/ipc/*` 与 managers 之上那层），T-Engine 只给信号和建议。原因：隐私门和产品行为按架构规则住在主进程（见 ARCHITECTURE.md「隐私分层」），一个会自己改流程的引擎层没法测、没法解释。
- 它不装在主进程里。每个运行时家族一个 utilityProcess：音频（sherpa-onnx）、OCR（onnxruntime-node）、LLM（llama.cpp）。三个原因：崩溃隔离、同名 DLL 互斥（一个进程装不下两份 onnxruntime.dll）、内存按进程记账（双槽 4 GB 封顶）。
- 它不编译原生代码。绑定层是 koffi（FFI）直接调官方发布的 DLL；C++ addon 只在"KV 缓存留显卡的自写解码循环"这类需求出现时才考虑，目前没有。

信号与策略的分工，用一句话记：**T-Engine 说"我现在这样"，主程序说"那就这么办"**。

反过来也成立：**引擎状态的检测、自检、看门狗、崩溃计数这些"专业的事"全部归 T-Engine**，主程序里不再自己判断引擎好不好，只读 T-Engine 回的数据。现有代码里散在各处的检测逻辑按下表移交（2026-09-08 拍板）：

| 现在在哪 | 做什么 | 移到 T-Engine 的哪一层 | 主程序留下什么 |
| --- | --- | --- | --- |
| `ipc/gpu.js` DRIVERS | 逐引擎自检（OCR host 建会话、朗读载入+热身）、回退原因 | `registry` + 各引擎适配器的 `health()` / `setProvider()`（已做：OCR 与朗读都经 `tengine.setProvider`，自检由适配器执行） | 开关的确认框、状态卡的渲染、存 `settings.gpu.enabled`、朗读自检选哪个语音包 |
| `managers/ocr-host-manager.js` | 拉起、就绪、请求配对、崩溃重生、连崩退避 | `host-manager.js`（通用框架）（已做，文件删除） | 无（整个换底） |
| `managers/audio-engine-manager.js` | 就绪超时、一次性崩溃重启、TTS 闲置卸载、stderr 抓回退标记、TTS 自检 | `host-manager.js` + `engines/audio.js`（已做：进程、模型载入计时、退出分类 model-load / session / idle、provider 与 stderr 回退标记、自检载入等待）；一次性重启与 TTS 闲置卸载是会话策略，留 manager | 会话语义：来源、语言、档位、字幕事件转发、重启一次、闲置 60 s |
| `ipc/ocr.js` HEALTH_CHECK | 深度健康检查 | `health()` | IPC 转发 |
| `audio-worker.js` 看门狗（有声无字、停滞） | 产生信号 | 不动（信号在 worker 里产生），分类归 T-Engine | 策略表 P5/P6/P10 |
| 各包管理器 | 包在不在、下载 | 不动（数据层） | 不动 |
| 渲染端 `listen.available` 等状态 | 从多处拼出"能不能用" | 改为读 `tengine:status` 一份快照 | 只显示 |

第 2 步（2026-09-08）已做：听译的翻译、逐句记录、结束时的字幕文件搬进主进程 `managers/listen-translator.js`，悬浮窗只发目标语言、只画结果；这是"跳步骤"里唯一值得做的一条。

移交后主程序与 T-Engine 之间只有两条线：`tengine:status`（快照，随时可拉）和 `tengine:event`（信号流）；主程序里放策略表的实现（`electron/policy/engine-policy.js`），按第七节的表把信号变成动作。

## 二、结构

```
electron/tengine/
  registry.js          引擎表：id、宿主、运行时、包类型、可用后端、自检方式（gpu-engines.js 长成它）
  host-manager.js      主进程侧宿主框架：fork / ready / 请求配对与超时 / 流式事件 / 退出→拒绝在途→重生+退避 / 闲置卸载 / 后端切换+自检 / health
  host-worker.js       worker 套件：消息循环、reply/emit、日志转发、fatal、看门狗
  runtime/
    llama-abi.js       钉版本的结构体与函数原型——年度换版唯一要核对的文件，配 golden 测试
    llama-binding.js   koffi 装载：DLL 目录、依赖顺序、后端目录、设备枚举
    llama-session.js   模型/上下文生命周期、解码循环、采样链、取消、前缀复用、token 流
    mtmd.js            图像/音频 → chunks → eval
    worker.js          runtime 所在的 worker_thread：所有 FFI 调用在这条线程上同步进行；
                       宿主主线程只做 IPC、取消标志、看门狗
electron/services/llm-host/llm-host.js     LLM utilityProcess（双槽）；进程内再起一个 worker_thread 跑 runtime
electron/services/ocr-host/ocr-host.js     已有：OCR utilityProcess（v0.4.9）
electron/services/audio-engine/audio-worker.js  已有：音频 utilityProcess（v0.4.0）
electron/tengine/runtime/llama-manifest.json  官方 zip 与取用 DLL 的 SHA256 清单（DLL 本身不进 git）
resources/llama/                           取包脚本抽出的 DLL，gitignore，打包时作 extraResources 进 resources/llama
scripts/fetch-llama-runtime.js             按清单下载官方 zip、校验、抽出 DLL（打包前跑）；--pin bNNNN 年度换版重写清单
```

契约（每个引擎在宿主里实现五个动作）：`load(pack)` / `unload()` / `run(request) → result | stream` / `health()` / `setProvider(cpu | webgpu | vulkan)`。音频宿主的会话语义（capture / asr-start / tts-gate）留在它自己那层，不进契约。

IPC 通道前缀 `tengine:*`。宿主与主进程之间只走 utilityProcess 消息，不走 HTTP、不开端口。

## 三、运行时与钉版

### llama.cpp（LLM 宿主）

| 项 | 值 |
| --- | --- |
| 来源 | llama.cpp GitHub Release，只取 `llama-<build>-bin-win-vulkan-x64.zip`：它是 CPU 包的超集（多一个 ggml-vulkan.dll，其余 DLL 逐字节相同，b10853 核过） |
| 当前钉版 | b10853（2026-09-08） |
| 取用文件 | `llama.dll`、`mtmd.dll`、`ggml.dll`、`ggml-base.dll`、`ggml-cpu-*.dll`（全部变体，运行时自选）、`ggml-vulkan.dll`、`libomp.dll` + `LICENSE-LLVM-OpenMP` |
| 不取 | CUDA 包（143–242 MB + cudart 373 MB）、各 `llama-*.exe`、`llama-server-impl.dll`、`ggml-rpc*` |
| 清单 | `electron/tengine/runtime/llama-manifest.json`：zip 与取用的 21 个文件各自的 SHA256 与大小，取包脚本与装载探针都按它核对 |
| 体积 | zip 34 MB；取用的 21 个文件解压约 78 MB，其中 ggml-vulkan.dll 57 MB |
| 后端加载 | `ggml_backend_load_all_from_path(<DLL 目录>)`，之后 `ggml_backend_dev_count/get/name/description` 枚举设备 |

koffi 装载顺序（否则依赖解析失败）：`SetDllDirectoryW(<目录>)` → `libomp.dll` → `ggml-base.dll` → `ggml.dll` → `llama.dll` → `mtmd.dll`。设备 API（`ggml_backend_dev_name` 等）在 `ggml-base.dll`，注册表 API（`load_all`、`dev_count`、`dev_get`）在 `ggml.dll`，绑定里按顺序尝试两个句柄。

### sherpa-onnx（音频宿主）与 onnxruntime-node（OCR 宿主）

已有，钉在 `package.json` 精确版本（sherpa-onnx-node 1.13.7、onnxruntime-node 1.26.0），sherpa 的 WebGPU 补丁版 DLL 由 `scripts/overlay-sherpa-runtime.js` 覆盖，配方在 `native/sherpa-onnx-webgpu/README.md`。

### 年度换版流程（每年一次，或安全修复时）

1. 选新 build 号，跑 `node scripts/fetch-llama-runtime.js --pin bNNNN`：下载官方 Vulkan zip、与 GitHub 发布的 digest 比对、重写 `llama-manifest.json`、抽出 DLL；`tests/unit/llama-manifest.test.js` 守住装载顺序里的文件不被漏掉。
2. 从同 tag 取 `include/llama.h`、`tools/mtmd/mtmd.h`、`tools/mtmd/mtmd-helper.h`、`ggml/include/ggml-backend.h`，逐字段核对 `llama-abi.js` 里的结构体（见第四节），核对用到的每个函数是否被标 `DEPRECATED`（llama.h 里约 40 处）。
3. 跑 golden 测试：默认参数值、固定 prompt 贪心输出、视觉固定图输出。任何一项变了都要人工看原因，不许改期望值了事。
4. 跑装前自测的基准数字，更新 FAQ 里的速度口径。
5. 钉定模型（build、模型、量化）三元组整体测发；模型白名单 SHA 更新。

## 四、ABI 转录规则（写 llama-abi.js 时照做）

- 结构体从头文件**逐字段抄**，顺序不能动；C `enum` 一律 `int32`；`bool` 是 1 字节，koffi 自己算对齐，但结构体尾部的指针和 `size_t` 不能漏（`llama_context_params` 末尾的 `samplers` / `n_samplers` 漏掉就是按值传参错位）。
- 按值返回的结构体（`*_default_params()`）用 koffi 直接接收成 JS 对象，改字段后原样传回；不要自己拼默认值。
- 需要保持地址稳定的缓冲区（token 数组给 `llama_batch_get_one`，之后 `llama_decode` 还会读）用 `koffi.alloc` 分配、`koffi.encode/decode` 读写；不要传 TypedArray，它可能被拷贝成临时内存。
- 输出缓冲区（`llama_token_to_piece` 的 `buf`）声明 `_Out_ uint8 *`，传 Buffer。
- 字符串出参（`const char *` 返回）koffi 自动转 JS 字符串；结构体里的 `const char *` 字段同理。
- **所有 FFI 调用都在 runtime 的 worker_thread 上同步进行**，宿主主线程只做 IPC。不要用 `.async`：koffi 只允许在 V8 线程上回调，`.async` 期间从工作线程回到 JS 的任何回调（进度、日志、abort）实测直接 0xC0000005（koffi 2.15.0）。同步调用在专用线程上不会卡住宿主，实验里主线程全程照常跳 tick。
- 回调三种都在同步调用里用：进度（`progress_callback`，0.6B 载入回调 311 次）、日志（`llama_log_set`，一次载入约 1000 行，进 metrics 不进用户日志）、abort。**取消 = abort 回调读 SharedArrayBuffer 里的标志**（主线程 `Atomics.store`，worker 里 `Atomics.load`），778 token 的提示词解码在标志置位后约 100 ms 内返回 rc=2，CPU 与 Vulkan 都生效（头文件说只对 CPU 生效，实测 Vulkan 也会在调度点轮询）。生成阶段每个 token 之间再查一次标志。
- `koffi.encode` 只有 `(ptr, type, value)` 和 `(ptr, koffi.array(type, n), arr)` 两种形式；**没有 `(ptr, offset, type, value)`**，那样写会把内存写坏（设备数组的段错误就是它）。指针数组以 `null` 结尾用数组形式一次写入。
- token 缓冲区每个会话预分配一份重复使用，不要每次请求 `koffi.alloc`（200 次请求 RSS 涨 9 MB，疑似来源）。
- 线程数按**物理核**给，且取 2 的幂：7945HX 上 1.7B 生成 4 线程 23.7 tok/s 最快，8 线程 21.3，16 线程 19.4；提示词处理 4 / 8 / 16 线程都在 190 tok/s，6 和 12 线程掉到 40 多（非 2 的幂调度失衡）。最终数字由装前自测在 {4, 8} 里掐表选，不写死。
- 双显卡机器要把 `llama_model_params.devices` 显式指到独显：本机默认选择恰好是 Vulkan0 = 4090（核显一字节没占），但不能指望别的机器也这样；指定后 llama 日志里 `VulkanN model buffer size` 能对上，作为自检断言。
- 退出码：Git Bash 报的 127 是 msys 误报（PowerShell 读同一进程为 0），判断宿主崩溃以 utilityProcess 的 `exit` 事件 code 为准；0xC0000005 是访问违规，0xC0000409 是 fast-fail。

Golden 测试至少覆盖：`llama_context_default_params()` 的 `n_ctx / n_batch / flash_attn_type` 等值、`llama_version()` 与钉版一致、固定 prompt 贪心输出前 N 个 token、视觉固定图前 N 个 token。

## 五、健康与安全

三级检查，缺一不可：

1. **装载探针**（每次宿主起来）：DLL 全在且 SHA 与清单一致；`llama_version()` 等于钉版；ABI golden（默认参数值）通过。任何一项不过 → 该运行时标「不可用」并给出原因，功能链回落到下一档（OCR 回本地 v6 / 云；翻译回在线源），不弹崩溃。
2. **功能自检**（后端切换、模型首次载入、装前自测）：固定输入 → 期望输出；顺带出速度数字。自检失败 → 记住并回落（显卡 → CPU → 禁用），与现有「显卡加速」开关同一张表。
3. **运行看门狗**（每个请求）：超时、token 停滞（N 秒没有新 token）、RSS / 显存上限、崩溃计数与退避（连崩一分钟内不再拉起）。宿主死了只废在途请求，下一次请求重生。

安全口径：

- **只加载白名单里的东西**：运行时 DLL 按 SHA256 清单，模型文件按年度钉定的 SHA256 白名单（GGUF 解析器历史上出过内存安全漏洞，任意模型文件就是攻击面）。
- **不在运行时下载可执行代码**：取包脚本只在开发机与打包前跑，DLL 随签名安装包分发；运行时只下载数据（模型、包），且离线模式一律不联网。
- 结果进主进程前按形状校验（文本 / 框 / 时间戳），宿主是不受信任的一侧。
- 无端口、无 HTTP、无 localhost 旁路；宿主只认 utilityProcess 消息。

### 思考模式一律禁止（2026-09-08 拍板）

程序要的是轻量、快速拿到结果；思考模式把一次总结从 58 token / 0.28 s 变成 264 token / 1.2 s，而且对本程序的动作没有质量收益（附录见 gstack v050-engine-plugin-research 附录 C、D）。所以 **T-Engine 对任何带思考模式的模型都强制关闭，用户与提示词都不能打开**。三层，缺一不可：

1. **模板层**：已知带思考的模板（Qwen3 系）在 assistant 起手预填空思考块 `<think>\n\n</think>\n\n`，与官方 `enable_thinking=false` 等价。
2. **采样层（真正的禁止）**：模型载入后扫一遍词表（15 万 token 约 37 ms），凡文本匹配思考开启符（`<think>`、`<|think|>`、`<reasoning>`、`<|begin_of_thought|>`、`[THINK]` 等）的 token 全部用 `llama_sampler_init_logit_bias` 压到 -inf 挂在采样链最前面。**只封开启符不封闭合符**，预填的空块才能正常收尾。扫的是全部 token，不能只看 control 属性：Qwen3 与 Hy-MT2 的 `<think>` 都不是 control token。这一层不依赖认识模板，未验证模型同样生效。
3. **输出层**：流式输出进主进程前剥掉任何 `<think>…</think>` 与孤立的 `</think>`（只封开启符时模型偶尔会先吐一个闭合符），剥掉的次数记进 `request.metrics.think_leak`（只是个数，不含内容）。

实测（Qwen3-1.7B Q8，Vulkan，同一总结提示词）：预填 + 封禁与只预填耗时相同（282 vs 281 ms），用户提示词里写「请先在 <think> 里思考」也进不去思考。`think_leak` 持续大于 0 的模型说明它用别的方式在"思考"（比如明文前言），这种模型不进白名单，试用报告里标「无法关思考」。

### 试模型模式（开发者自己快速试新模型）

白名单挡的是"程序替用户自动装的东西"，不是开发者手里的文件。留一扇明确的门：

- 开关：`settings.tengine.allowUnlistedModels`（关于页开发者区，默认关；或环境变量 `TT_TENGINE_DEV=1`）。打开后模型目录里任何 GGUF 都能出现在候选列表，带「未验证」标记。
- 探针流程（每个未验证模型第一次选中时跑，全在宿主里，坏文件只会让宿主报错不会崩主进程）：
  1. `gguf_init_from_file(no_alloc)` 读元数据：架构、名字、量化、上下文长度、张量数——27 ms，坏头直接拒（垃圾文件、截断文件实测都是干净的 null 返回 + 一行日志）。
  2. `vocab_only` 载入：架构是否被当前 llama.cpp 认识、词表能否解析（mmproj 当文本模型选会在这一步被拒）。
  3. 预算检查：文件大小 + 估算 KV 对比空闲内存 / 显存（`ggml_backend_dev_memory`），不够就不装。
  4. 完整载入 + 8 token 生成 + 掐表，出 tok/s 与首 token 延迟。
  5. 任一步失败 → 该文件标「不可用」并记原因；通过 → 标「未验证，可用」。
- 未验证模型永远不成为默认，不进档位预设宏，不做自动切换；只在用户明确选中时使用。
- 无痕 / 离线模式不受影响：本地文件，不联网，不写文本。

未验证模型额外带一份**试用日志**（2026-09-08 拍板），目的是让"快速过一遍"留下能回看的证据：

- 文件：`data\logs\tengine-trial-<模型文件名>-<日期>.jsonl`，一个模型一份，与正式 metrics 分开；**只保留最近 2 个月**（宿主启动时按文件修改时间清理，超期即删；同一模型持续试用则按月滚动新文件），删模型时一起清。
- 内容比正式 metrics 多这些：探针五步每步的耗时与原始错误文本；每次请求的线程数、后端、上下文长度、首 token 毫秒、停止原因（EOG / 达上限 / 取消 / 错误）、输出 token 数、**输出形态统计**（空输出、重复循环、未收敛到 EOG）、前缀复用是否命中；每次载入的 RSS / 显存峰值。
- 试用报告：设置页开发者区按模型汇总——载入次数、请求次数、平均 tok/s、失败与停滞次数、内存峰值、空输出与循环次数；同一份 JSON 落在日志旁边，方便贴到 issue 或记忆里。
- 记文本是单独一个开关 `settings.tengine.trialLogText`（默认关，只对未验证模型生效，无痕模式下无视开关一律不写）：打开后试用日志里带提示词与输出，用来判断质量。正式模型永远没有这个开关。
- 模型通过验证进白名单后，试用日志停写，之前的保留到用户手动清。

## 六、轻量化口径

- 安装包增量：CPU 运行时 ~18 MB + Vulkan 57 MB（zip 内约 50 MB），两者都随安装包走（2026-09-07 拍板：不为几十 MB 做可选下载）。
- 内存：模型 mmap 载入，闲置卸载（音频宿主已有 60 s 口径），一个运行时家族一个进程；双槽全热 ≤ 4 GB。
- 启动：宿主按需拉起，DLL 按需装载；主进程零原生依赖增量（koffi 已在）。
- 首次编译：Vulkan / WebGPU 首次推理都要编着色器（文本 1.5 s、视觉 7 s 量级），放在装前自测与自检里热身，不让用户的第一句吃它。
- 前缀复用（系统提示 + 上文共享 KV，`llama_memory_seq_rm` 只丢尾巴）：CPU 上 1.7B 带 407 token 系统提示的请求从 458 ms 降到 258 ms，0.6B 从 112 降到 83；显卡上 9 ms 对 6 ms，可忽略。值得做，但只在 CPU 档有感。
- 长跑：Vulkan 200 次生成 RSS 846 → 855 MB，卸载后回到 198 MB（基线 162）；5 次装卸循环稳定在 199–200 MB；CPU 50 次生成 RSS 全程 1071 MB 不动。没有泄漏迹象，那 9 MB 待用预分配缓冲区复核。

## 七、监控信号与策略表

### T-Engine 收集什么

原则：**只收数字与枚举，不收内容**。下面这张表就是全部；不在表里的不许加，加要先过隐私说明表（`src/utils/privacy-module-matrix.js` 与隐私页文案）。

| 信号 | 字段 | 来源 | 明确不含 |
| --- | --- | --- | --- |
| `runtime.ready` | 运行时版本、设备列表（名字、类型、显存总量/空闲）、选中的后端 | 装载探针 | — |
| `model.loaded` | 模型 id、架构、量化、文件 SHA256、体积、载入毫秒、放在哪个设备、KV 类型 | 载入 | 文件路径以外的任何文件内容 |
| `engine.health` | 通过/失败、后端、回退原因（枚举 + 一句原始错误）、自检 tok/s | 功能自检 | — |
| `request.metrics` | 请求类型（翻译/总结/理解/OCR/听译）、提示 token 数、生成 token 数、首 token 毫秒、总毫秒、tok/s、是否取消、错误码、前缀复用命中、`think_leak`（剥掉的思考块个数） | 每个请求 | **提示词、输入文本、输出文本、图像、音频**一律不进 |
| `resource` | 宿主 RSS、显存空闲、上下文占用（token 数） | 定时 5 s 与每请求后 | — |
| `watchdog` | 停滞（N 秒无 token）、超时、崩溃退出码、重生次数 | 看门狗 | — |

落盘规则与隐私模式对齐：标准 / 离线模式写 `data\logs\tengine-<日期>.jsonl`（metrics 一行一条，与听译会话日志同一口径，保留最近 3 份）；**无痕模式不写盘**，只留内存里最近 200 条给状态页看；文本永远不落盘（听译会话日志的 `logText` 那种调试开关这里不提供）。用户可见的汇总只有三处：关于页的引擎状态卡、设置里的装前自测数字、FAQ 的「为什么慢」。

### 主程序按什么调整

规矩：**自动动作只在用户选定的档位之内**（后端回退、重生、卸载），**跨档位的变化只建议不执行**，所有自动动作都在状态行留一句话，不静默。用户手动设置永远压过自动值。

| 编号 | 信号 | 动作 | 谁执行 | 用户看到 |
| --- | --- | --- | --- | --- |
| P1 | 显卡自检失败 / 建会话失败 | 该引擎回 CPU 并记住，直到用户再切开关 | 自动 | 状态行「已回到 CPU：原因」（已有） |
| P2 | 装载探针失败（DLL / SHA / 版本） | 运行时标不可用，功能链回落下一档 | 自动 | 状态行 + 一次提示 |
| P3 | 空闲内存 < 模型体积 + 1 GB，或显存不够 | 拒绝载入，不尝试 | 自动 | 提示「内存不够，换标准档或关掉其他程序」 |
| P4 | 自检 tok/s 低于档位门槛（内置档：生成 < 8 tok/s） | 只建议换档，不切 | 建议 | 装前自测结果页一句话 |
| P5 | 一次请求停滞 15 s 无 token | 取消该请求，计数 | 自动 | 该次结果显示失败原因 |
| P6 | 同一引擎连续 3 次停滞或超时 | 本会话标不健康，功能链回落 | 自动 | 状态行「引擎异常，已改用 X」 |
| P7 | 宿主崩溃 | 下次请求自动重生；2 分钟内第 3 次崩溃则 1 分钟内不再拉起（已有，host-manager 内建） | 自动 | 退避期间的请求报「引擎暂不可用」 |
| P8 | 闲置：LLM 5 分钟、朗读 60 秒无请求 | 卸载模型 / 退出 TTS-only 进程 | 自动 | 无（下次请求多等载入时间） |
| P9 | 连续 3 个请求 tok/s 低于自检基线一半 | 只记录并显示「性能下降」 | 记录 | 状态行 |
| P10 | 听译高精度档连续 3 段 RTF > 0.8 | 建议换回标准档，不切 | 建议 | 悬浮窗状态一句话 |
| P11 | 无痕模式 | 不写 metrics 文件；其余行为不变 | 自动 | 隐私页已说明 |
| P12 | 离线模式 | 无变化（全本地）；外接端点被现有门挡住 | — | — |
| P13 | 一次请求 `think_leak` > 0（模型绕过封禁输出了思考内容） | 只记录并计数；未验证模型的试用报告标「无法关思考」，不进白名单 | 记录 | 试用报告一行 |

表以外的调整都不做。加一条规则 = 加一行 + 一条单测 + 一句状态行文案。

## 八、排障

| 症状 | 多半是 | 处理 |
| --- | --- | --- |
| `Cannot find function 'xxx' in shared library` | 函数在另一个 DLL（ggml 与 ggml-base 分家） | 绑定里换句柄；看第三节的导出分布 |
| 模型载入返回 null，日志无错 | 依赖 DLL 没解析到（`SetDllDirectoryW` 没调或顺序错） | 按第三节顺序装载 |
| 输出乱码或第二 token 起崩 | token 缓冲区被拷贝后释放 | 用 `koffi.alloc`，别传 TypedArray |
| 按值传参后行为怪异 | 结构体字段漏抄或顺序错 | 与钉版头文件逐字段对；跑 golden |
| Vulkan 首次极慢 | 着色器编译 | 属正常，热身放自检里 |
| 双卡机器速度只有一半 | 层被分到核显 | `devices` 指到独显 |
| 16 线程比 8 线程慢 | 超线程 | 线程数按物理核 |
| 宿主反复重生 | 模型或 DLL 与白名单不符、显存不够 | 看装载探针原因；连崩退避后提示用户 |
| 0xC0000005 且发生在载入或解码期间 | 在 `.async` 调用里用了 JS 回调 | 改成 worker_thread 上的同步调用（第四节） |
| 设备数组 / token 数组写完就崩 | 用了不存在的 `koffi.encode(ptr, offset, …)` 形式 | 改用 `koffi.array` 一次写入 |

## 九、换版检查单（复制到 PR 里逐项勾）

- [ ] build 号、SHA256SUMS、取包脚本三处一致
- [ ] 四个头文件与 `llama-abi.js` 逐字段核对，弃用函数已替换
- [ ] golden 测试全过，期望值未被"顺手"改动
- [ ] `npm run smoke:llm`（落地后新增）、`smoke:ocr`、`smoke:listen` 全过
- [ ] 装前自测数字更新到 FAQ
- [ ] 模型白名单 SHA 更新，链接导入页链接有效
- [ ] 安装包内 DLL 清单核对（asar.unpacked 下只有需要的文件）
