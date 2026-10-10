# 本地 OCR 设计说明

代码：`electron/ocr/ocr-engine.js`（主进程门面：包解析、档位、健康）、`electron/services/ocr-host/ocr-host.js`（OCR 宿主 utilityProcess）、`electron/services/ocr-host/ppocr/`（PP-OCR 流水线）、`electron/ocr/windows-ocr.js`（Windows.Media.Ocr 驱动）、T-Engine 侧 `electron/tengine/engines/ocr.js`。模型发布、语言包与已知边界见 `docs/OCR_MODELS.md`。

## 1. 分工（ocr-engine.js）

- 主进程只解析包：根目录、`pack.json`、档位；模型运行时（ppocr + onnxruntime-node + skia）从 v0.4.9 起在 OCR 宿主进程里，原生故障（ONNX Runtime、开了 WebGPU 之后的显卡驱动）带走的是宿主不是程序。门面的每个导出保持 v0.4.9 以前的形状，错误码也沿用（`BASE_MODELS_MISSING` / `PACK_NOT_INSTALLED` / `LOAD_FAILED`），上层按它们分支。
- 包目录解析顺序：下载根（激活根、旧 userData 根）里的副本优先于内置副本——基础模型的更新与修复就是这样落地的，不碰程序自己的 resources。`pack.json` 里的文件名一律取 `basename`：模型文件永远平铺在包目录里，手改或畸形的 `pack.json` 引用不到目录外。
- 档位：`high` 优先 medium 变体（`base-v6-hq`），包被手动删了而设置仍是 high 时静默回落 `base-v6`。换档 / 卸载 / 更新任何基础包都要清**整个**会话缓存：det 模型来自基础包，供每个语言会话使用，不只是自己那把 key。
- 语言包未装：用基础模型识别而不是失败，结果带 `packFallback` 与 `requestedLanguage`，调用方出提示。
- 健康检查两档：轻量只验模型文件解析得到且非空（设置页进入时调），深度再到宿主里真建会话（抓坏模型与坏原生绑定），留给用户显式动作。`activeBase` 报的是包 id 而不是目录名（内置副本的目录就叫 `base`）。
- `prewarm` 只把宿主拉起来让原生库先装载，会话仍然懒建；`hostStatus` 回答「基础模型实际跑在哪个后端、若回退是为什么」，供设置页的 GPU 开关显示。

## 2. 宿主进程（ocr-host.js）

- 与音频 worker **分开两个进程**：两者各带一份 `onnxruntime.dll`，同一进程装不下两份同名 DLL。
- 原生库在第一个请求时才 require，fork 时不装。
- WebGPU 执行提供器（Dawn on D3D12）随 onnxruntime-node 自带 dxcompiler / dxil，不用装也不用下载。
- **不接文档方向分类器**：短行 CJK 截图被误判成竖排（日文横排成乱码、韩文损坏），实测弃案，详见 `OCR_MODELS.md` 已知边界。
- 空格启发式只给 v3/v4 识别模型；v5 起模型自己认空格，再开启发式会多插。
- **热身**：WebGPU 第一次跑要编着色器（实测 0.5–1.1 s），在建会话时用一张空白帧吃掉，不落在用户第一次截图上；之后不同尺寸只多几十毫秒。
- **GPU 回退是粘的**：建会话或热身失败一次，这个宿主之后全走 CPU，原因记在 `providerFallback` 随每次 health 回报；只有显式 `set-provider` 才清掉重试。
- 会话缓存 LRU 两把（`provider:packId`），promise 入缓存让并发请求共用一次加载，加载失败要从缓存删掉免得毒死后续请求。
- **丢掉的会话要显式释放**（2026-10-09）：挤出 LRU、`evict`、`set-provider`、版面会话换包时立即 `release()`，还有请求在跑的等最后一个结束再放。以前只删引用，onnxruntime-node 的原生内存和 WebGPU 缓冲等 GC，实际一直不还。实测（独立进程跑同一条流水线）：识别过一张 2400×1400 的图后显存约 1.4 GB、私有提交约 1.8 GB，`release()` 后 3 秒内显存回到 14 MB、任务管理器口径 368 → 174 MB；重建后第一次识别约 1.8 秒（热会话 0.4 秒）。显存随识别过的最大图片涨、不回落；WebGPU 的四种缓冲缓存模式（bucket / lazyRelease / simple / disabled）实测没有差别。
- **CPU 会话关掉 arena**（`enableCpuMemArena: false`）：arena 只涨不还，5 次识别后任务管理器口径 830 MB，关掉后 146 MB，速度不变慢。WebGPU 会话不关：私有内存几乎不变（1946 对 1997 MB）。
- 小图放大：`preprocess.scale` 只对最长边 < 1200 的图生效——小截图字形小，放大再检测才认得出；大图放大得不偿失。检测框从放大坐标除回源图像素。
- 结果形状：`blocks` 来自版面分析后的段落，`rawBlocks` 是原始行；置信度取 blocks 均值。

## 3. PP-OCR 流水线（ppocr/）

- 派生自 esearch-ocr 8.5.0（Apache-2.0，xushengfeng），保留署名。改动：前后处理改在平铺 TypedArray 上做（原来是嵌套数组与字符串 key），候选框来自连通域而不是轮廓追踪，去掉了浏览器、调试、文档方向、版面模型代码；只留宿主调用的部分，结果形状不变。`layout.js`（阅读顺序 / 分栏 / 段落）原样搬来，只把调试日志桩掉，不在热路径上。
- 张量布局：平面顺序是 **B、G、R**，各自用自己的 mean/std 归一化——这是上游喂模型的布局，保持它结果才逐字一致。
- 检测（det.js）：缩到 32 的倍数、跑模型、概率图按 0.3 二值化、每个连通域取最小外接矩形、unclip 1.5 倍还原被收缩的文本核、仿射裁正、估背景 / 文字颜色（只采样左侧 4×高的列，同上游），再按颜色把框往内收最多 4 px 空白边。步骤与常量与上游一致。「fill」缩放时源图小于模型输入保持原尺寸，所以映射回源图的比例要按较小的那边算。
- 识别（rec.js）：竖框先转横、缩到模型高度、贪心 CTC；每步留次优类给 v3/v4 的空格启发式；行均值 < 0.5 丢弃。字典最后一行的空行代表空格类，没有就补一个。
- 几何（cv.js）：8 连通域只回边界像素（旋转矩形只需要这些，孔洞不生框）；Andrew 单调链凸包 + 旋转卡尺，角度按 OpenCV 口径 [0, 180)。

## 4. Windows OCR 驱动（windows-ocr.js）

- 用 PowerShell 5.1 承载 WinRT 调用，脚本以 `-EncodedCommand`（base64 UTF-16LE）传：内联 `-Command` 要经 cmd.exe 与 PowerShell 两层参数解析，引号 / 换行 / 管道在不同机器上被弄坏的方式还不一样。不 import electron，`node` 直接可测。
- 语言映射：设置语言 → Windows 语言标签，未映射或 auto 给空串 = 用用户 Windows 配置文件里的语言。
- CJK 输出里 Windows OCR 每个字之间插空格，按 CJK 相邻规则去掉，拉丁与拉丁之间的空格保留。
- 坐标：`OcrLine` 自身没有矩形，只有 `Words` 有，所以行框是词框的并集。取**行**粒度与本地引擎的 `rawBlocks` 对齐；给词框的话悬浮窗的版面启发式会把它读成「一堆词」。框直接是源图像素（截图原样写盘，没有缩放）。
- 输出不是 JSON 时当纯文本用：某台机器 `ConvertTo-Json` 失常时退化到 0.3.4 以前「只有文字没坐标」的行为，而不是整个识别失败。PS 5.1 会把单元素数组塌成对象、空数组可能给 null，解析时要兜。
- 临时文件名带随机后缀：同一毫秒并发两次识别不能共用一个文件。stderr 是完整的 PS 错误记录，只取第一行有意义的文字。

## 5. 版面分析（layout.js）

- 给文档翻译的 PDF 解析用（渲染端怎么用这些块见 `design/renderer.md` §5「版面模型接入」）：渲染端每页送一张长边 1024px 的 PNG，宿主回 `{ blocks: [{ label, score, box, order }] }`，`box` 是占整图的比例，`order` 是阅读顺序。不识别文字。
- 只在显卡加速开着时放行：`ocr:layout` 在 IPC 层查 `settings.gpu.enabled`，关着回 `LAYOUT_NEEDS_GPU`，渲染端不发请求、PDF 走纯规则。与内置视觉模型同一口径（用户 2026-09-29 定）。门面错误码：`LAYOUT_NOT_INSTALLED`（包不在）、`LAYOUT_FAILED`（宿主出错）。
- 模型：PP-DocLayoutV3 官方 ONNX（`PaddlePaddle/PP-DocLayoutV3_onnx`，Apache-2.0），`ocr-models` 发布里的 `layout-v3` 包（type `layout`，不进语言包列表；发布流程见 `OCR_MODELS.md`）。
- 输入：`image` [1, 3, 800, 800]，RGB 直接拉伸到 800×800（不保比例）后 /255，不减均值；`scale_factor` [800/H, 800/W]；`im_shape` [800, 800]。
- 输出：`fetch_name_0` 每框 `[类别, 分数, x1, y1, x2, y2, 阅读序号]`，坐标已按 `scale_factor` 还原成原图像素；`fetch_name_1` 是有效框数；`fetch_name_2` 是每框 200×200 掩码（一页约 48MB），`session.run` 只取前两个输出，掩码不回传。V2 的每框多一列（两把顺序键：a 升序、b 降序），`parseRows` 两种都认。25 个类别两代相同。分数低于 0.45 的框丢掉。
- 为什么是 V3 不是 V2：程序走的 WebGPU 上两者每页都是约 0.12 秒；V3 小 40%（125MB 对 204MB），表格里的斜体不再被当成行内公式，与 PaddleOCR-VL-1.6 同一套，拍照倾斜页也能处理。DirectML / CPU 上 V3 慢一半，但那条路不用。数字与试过的转换路子在 TODOS「B 档」。
- 会话：自己一把缓存（`provider:packId`），不和识别会话抢位置，一次只留一个；和识别会话同一套 WebGPU 失败回 CPU 的粘性回退；换档 / 卸载 / 切显卡同样清掉。模型文件读进内存后不占文件句柄，会话开着也能直接删包（真机验证过）。没有空白帧热身：每次启动后第一页多约 4 秒，只在打开 PDF 时发生。
