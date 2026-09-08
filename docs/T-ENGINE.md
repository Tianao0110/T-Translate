# T-Engine 维护手册

T-Engine 是程序自己的引擎接入层：把本地 OCR、听译、朗读、内置 LLM 这些原生运行时统一装进子进程宿主，用同一套契约管理它们的加载、健康、后端切换与崩溃恢复。这份文档写给以后维护它的人（大概率是未来的自己）：先说边界，再说结构，然后是换版流程、健康与安全口径、排障。

状态：设计已定（2026-09-07，gstack v050-structure-survey / v050-engine-plugin-research），代码随 v0.5.0 第 1 步落地。文中标「已有」的是现在仓库里就有的，其余是落地目标。

## 一、边界

T-Engine 只做三件事：**装载运行时、监控引擎、报告事实**。

- 它不改产品行为。用哪个引擎、什么时候降档、翻译走哪条链，由主进程的策略层决定（`electron/ipc/*` 与 managers 之上那层），T-Engine 只给信号和建议。原因：隐私门和产品行为按架构规则住在主进程（见 ARCHITECTURE.md「隐私分层」），一个会自己改流程的引擎层没法测、没法解释。
- 它不装在主进程里。每个运行时家族一个 utilityProcess：音频（sherpa-onnx）、OCR（onnxruntime-node）、LLM（llama.cpp）。三个原因：崩溃隔离、同名 DLL 互斥（一个进程装不下两份 onnxruntime.dll）、内存按进程记账（双槽 4 GB 封顶）。
- 它不编译原生代码。绑定层是 koffi（FFI）直接调官方发布的 DLL；C++ addon 只在"KV 缓存留显卡的自写解码循环"这类需求出现时才考虑，目前没有。

信号与策略的分工，用一句话记：**T-Engine 说"我现在这样"，主程序说"那就这么办"**。

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
electron/services/llm-host/llm-host.js     LLM utilityProcess（双槽）
electron/services/ocr-host/ocr-host.js     已有：OCR utilityProcess（v0.4.9）
electron/services/audio-engine/audio-worker.js  已有：音频 utilityProcess（v0.4.0）
native/llama-runtime/SHA256SUMS            官方 DLL 清单与校验值（DLL 本身不进 git）
scripts/fetch-llama-runtime.js             按 build 号下载官方 zip、校验、抽出需要的 DLL（打包前跑）
```

契约（每个引擎在宿主里实现五个动作）：`load(pack)` / `unload()` / `run(request) → result | stream` / `health()` / `setProvider(cpu | webgpu | vulkan)`。音频宿主的会话语义（capture / asr-start / tts-gate）留在它自己那层，不进契约。

IPC 通道前缀 `tengine:*`。宿主与主进程之间只走 utilityProcess 消息，不走 HTTP、不开端口。

## 三、运行时与钉版

### llama.cpp（LLM 宿主）

| 项 | 值 |
| --- | --- |
| 来源 | llama.cpp GitHub Release，`llama-<build>-bin-win-cpu-x64.zip` + `llama-<build>-bin-win-vulkan-x64.zip` |
| 当前钉版 | b10853（2026-09-08） |
| 取用文件 | `llama.dll`、`mtmd.dll`、`ggml.dll`、`ggml-base.dll`、`ggml-cpu-*.dll`（全部变体，运行时自选）、`ggml-vulkan.dll`、`libomp.dll` + `LICENSE-LLVM-OpenMP` |
| 不取 | CUDA 包（143–242 MB + cudart 373 MB）、各 `llama-*.exe`、`llama-server-impl.dll`、`ggml-rpc*` |
| 体积 | CPU 集 ~18 MB，Vulkan 后端 57 MB（zip 内 34 MB） |
| 后端加载 | `ggml_backend_load_all_from_path(<DLL 目录>)`，之后 `ggml_backend_dev_count/get/name/description` 枚举设备 |

koffi 装载顺序（否则依赖解析失败）：`SetDllDirectoryW(<目录>)` → `libomp.dll` → `ggml-base.dll` → `ggml.dll` → `llama.dll` → `mtmd.dll`。设备 API（`ggml_backend_dev_name` 等）在 `ggml-base.dll`，注册表 API（`load_all`、`dev_count`、`dev_get`）在 `ggml.dll`，绑定里按顺序尝试两个句柄。

### sherpa-onnx（音频宿主）与 onnxruntime-node（OCR 宿主）

已有，钉在 `package.json` 精确版本（sherpa-onnx-node 1.13.7、onnxruntime-node 1.26.0），sherpa 的 WebGPU 补丁版 DLL 由 `scripts/overlay-sherpa-runtime.js` 覆盖，配方在 `native/sherpa-onnx-webgpu/README.md`。

### 年度换版流程（每年一次，或安全修复时）

1. 选新 build 号，改 `scripts/fetch-llama-runtime.js` 里的常量，跑一次取包，更新 `native/llama-runtime/SHA256SUMS`。
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
- 耗时调用用 `.async`（`llama_decode`、`mtmd_helper_eval_chunks`、模型加载），事件循环留给 IPC 与取消；同一上下文的调用串行，不并发。
- 回调（进度、abort）只在 `.async` 调用期间使用；解码循环在 JS 里，取消靠循环里查标志，一个 token 内响应，不依赖 abort 回调（头文件注明它只对 CPU 生效）。
- 线程数按**物理核**给，超线程反而慢（7945HX：8 线程 22.5 tok/s，16 线程 19.4）。
- 双显卡机器要把 `llama_model_params.devices` 显式指到独显，否则 ggml 会把层分到核显上（本机 Vulkan0 = 4090、Vulkan1 = 610M）。

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

## 六、轻量化口径

- 安装包增量：CPU 运行时 ~18 MB + Vulkan 57 MB（zip 内约 50 MB）。要不要把 Vulkan 后端做成首次开显卡加速时下载的可选件，是产品决定，不是技术限制；决定了就只改取包与清单。
- 内存：模型 mmap 载入，闲置卸载（音频宿主已有 60 s 口径），一个运行时家族一个进程；双槽全热 ≤ 4 GB。
- 启动：宿主按需拉起，DLL 按需装载；主进程零原生依赖增量（koffi 已在）。
- 首次编译：Vulkan / WebGPU 首次推理都要编着色器（文本 1.5 s、视觉 7 s 量级），放在装前自测与自检里热身，不让用户的第一句吃它。

## 七、监控信号与策略表

宿主上报的信号（结构化，进 metrics 日志，不含用户文本）：

| 信号 | 来源 | 主程序拿它做什么 |
| --- | --- | --- |
| `runtime.ready { version, devices[] }` | 装载探针 | 决定可用后端，填「显卡加速」状态行 |
| `engine.health { ok, provider, fallback, loadMs }` | 功能自检 | 开关是否生效、回退原因文案 |
| `request.metrics { promptTokens, genTokens, ms, tokPerSec }` | 每个请求 | 装前自测数字、档位建议（慢于阈值提示换档） |
| `resource { rssMb, vramFreeMb }` | 定时 | 触发闲置卸载、拒绝超预算的加载 |
| `stall / timeout / crash { reason }` | 看门狗 | 重生、退避、连崩后禁用并提示 |

策略写成表，不写成散落的 if：档位（保底 / 内置 / 外接）× 信号 → 动作。改策略只改表，改引擎只改宿主。

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

## 九、换版检查单（复制到 PR 里逐项勾）

- [ ] build 号、SHA256SUMS、取包脚本三处一致
- [ ] 四个头文件与 `llama-abi.js` 逐字段核对，弃用函数已替换
- [ ] golden 测试全过，期望值未被"顺手"改动
- [ ] `npm run smoke:llm`（落地后新增）、`smoke:ocr`、`smoke:listen` 全过
- [ ] 装前自测数字更新到 FAQ
- [ ] 模型白名单 SHA 更新，链接导入页链接有效
- [ ] 安装包内 DLL 清单核对（asar.unpacked 下只有需要的文件）
