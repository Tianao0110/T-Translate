# 翻译栈设计说明（src/stack/）

代码：`src/stack/`——ESM 源码，`scripts/build/build-stack.js` 用 esbuild 打成 `electron/generated/translation-stack.cjs` 供主进程加载。三条铁律（rtFetch、不 import electron / window、`_t` 走 i18n）在 `CLAUDE.md`；这里记各模块「为什么这样写」与踩过的坑。

## 1. 边界与注入（index.js、runtime.js、logger.js、i18n.js）

- 栈是 v0.3.1 从渲染端搬进主进程的：渲染端不再有任何翻译或在线 OCR 的网络代码，这是结构性的隐私保证。所有平台能力经 `createStack(ctx)` 注入：`fetch` 必须是 Electron 的 `net.fetch`（Node 全局 fetch 绕过系统代理与企业证书，代理用户会直接断网，设计 R1）；`loadProviderConfigs` / `loadOcrConfigs` 返回**已解密**的配置（解密归主进程的 secureVault）；`localOcr`、`localLlm`（内置模型）、`getCustomFilters`、`cacheFilePath`（缺省 = 内存缓存，给测试）、`loadTtsEndpointConfig`。
- logger 工厂**按调用解析**而不是在 `createLogger` 时绑定：栈模块在 import 时就建 logger，早于 `configureRuntime` 注入真工厂；急绑定曾把整条 OCR / 翻译流水线钉在 console 兜底上，磁盘日志一行都没有。`src/core/logger.js` 用不了是因为 `import.meta.env` 是 Vite 专有。
- 栈内 i18n 是独立的 i18next 实例，共用渲染端同一份词表（`check:i18n` 两端一起管）。设计稿 §2.3 原打算错误码跨 IPC，实现改成打包共享词表：所有翻译源 / 服务的错误保持两种语言原样措辞的纯字符串，约 40 处 `_t` 只改 import 就能搬，靠文本匹配的消费者（error-handler 的 ERROR_PATTERNS、OCR 的 vision-unsupported 嗅探）原样可用；语言每次调用经 `ctx.getLanguage()` 解析，切语言不需要同步链。
- `loopback.js` 是离线模式对「这个地址是不是本机」的唯一答案：本地 LLM 源、视觉引擎、外部语音服务器共用。主机名精确匹配（外加 RFC 6761 的 `.localhost` 顶级域）：`localhost.evil.com` 不能算本机，局域网地址也不能。

## 2. 服务层（service.js）

- 从渲染端 `services/translation.js` 机械移植：配置加载注入（secure-storage 瀑布在渲染端时代的东西没了）、自定义过滤器来自 electron-store、L2 缓存注入、死接口（setMode / setPriority / registerFilter / resetFailureCount 全仓零调用者）删除。`privacyMode / useCache` 保留为 options：IPC 门面是执行点并注入它们，服务本身保持参数化可测。
- 本地端点判定：空端点 = 预设默认，每个本地预设默认 localhost，所以只有显式写的地址可能在别的机器上。
- MT（仅翻译小模型）检测按模型名缓存：只在活动源的 `config.model` 变化时重跑，效果是「启动检测一次、换模型再检测」。仅翻译小模型用短提示：它们的聊天模板不认 system 角色，长指令会被当成正文翻译；语气提示保留。
- 内置模型由**包**决定提示形状：仅翻译包走短的 user-only 提示；通用 1.7B 模型用共享模板再加一句「Output language: X」收尾——它遇到两步模板（OCR：先修正再翻译）只做第一步就停，云端源永远看不到这句。
- 占位符用 Unicode 括号 ⟦⟧：用户文本里几乎不会出现，LLM 也不会改写；恢复时用 split/join 避免正文里的正则特殊字符被解释。
- **缓存**：djb2 双哈希做短且抗碰撞的键；模型名是键的一部分（同一个源 id 换本地模型输出完全不同）。缓存条目历史上有过两种形状（L1 存 `text`、L2 存 `translated`），0.3.x 的一个 bug 还把整个对象写进 `translated`——所以取值只返回字符串或什么都不返回；把非字符串往上递曾直接搞死渲染端（React #31），这些条目至今还在用户磁盘上。**没东西可缓存 ≠ 缓存空串**：空答案存进去就永远当翻译端出来（以前更糟，`result.text || result` 把整个包装对象存了进去）。缓存键绑定到第一个可用源 + 模型，换任一个就失效。安全模式完全跳过持久缓存。
- 优先级：`null` = 从未配置 → 默认表；`[]` = 用户明确禁用了所有源 → 尊重它，不悄悄调云端。
- 「这个源现在能不能跑」一处回答：隐私白名单、已配置、以及离线模式下本地源必须真指向本机（局域网 Ollama 也是网络流量）。之后把「已装模型文档上不覆盖目标语言」的源**降级**：本地模型被问不会的语言会自信地答错，「成功」结束链，会那门语言的 Google 永远轮不到。
- 成功收尾合成一处（占位符恢复、词汇表、缓存写入原始输出、结果信封）：以前是三份复制粘贴，只修一份的后果是语言重排在默认流式路径上死了一整个版本。
- `skipFailureCount`：确定性的「做不了这个输入」（DeepL 被问不支持的语言）不计失败，否则一次不支持的语言选择让该源在本会话里对所有语言都被冷板凳。全军覆没（每个源要么试过要么被跳过）时清跳过表再试一次，瞬时故障不会永久困住。
- 流式：合并刷新——占位符恢复与下游发射每个间隔跑一次而不是每个 token；主进程里 `createStreamThrottle` 的 RAF 路径退化成 setTimeout（33 ms 档），这**就是**栈唯一的批处理点，IPC 门面逐帧转发不再合并。终稿套用之后再来的 flush 会用过期的半截覆盖已套词汇表的文本，所以要拦。缓存命中时以单个 chunk 回放，让调用方的流式处理路径照常跑。
- `canChat`：元数据 `type: 'llm'` 不是答案——anthropic 与 gemini 是 llm 但只实现 translate()；要聊天的调用方必须问这里。一个源可能自知此刻不能聊（内置模型跑仅翻译包），链继续走。`chat` 没有可聊的源时回退成翻译用户消息，`requireChat` 让提示会被当成指令翻译的调用方退出这个回退。
- 就绪判定（「现在能翻译吗」）故意建在真实翻译路径同样的三个过滤器上：与翻译按钮不一致的横幅比没有横幅更糟。两类源证据不同，`isConfigured()` 分不出：本地源没有必填项，有没有东西在监听都报已配置——云端有密钥就够（**不探测**，每次启动发请求花的是用户的配额）；本地必须探测（免费、回环、离线也允许）。指向外机的本地源是另一种修法。

## 3. L2 缓存（cache.js）、词汇表（glossary.js）、注册表（registry.js）

- L2 缓存取代渲染端 localStorage 的 `services/cache.js`：单个内存 Map 加防抖 JSON 文件，三扇窗共用一份，旧的跨窗口时间戳合并舞步在结构上消失。旧 localStorage 数据**故意不迁移**（D-2：7 天 TTL 的一次性缓存，冷重建）。安全模式钩子：禁用期间不写盘，禁用**之前**先把待写的防抖冲出去，标准模式下抓到的条目仍落地。批量逐出 20% 而不是 1 条，接近容量时不会每次 set 都逐出。「清空缓存」要连快照一起删，否则重启复活。写入防抖 500 ms 与渲染端缓存一致，流式下每段完成都会 set。
- 词汇表改写的是**译文**，只能作用于模型留在源语言里的词；被模型译成别的词的术语在字符串里看不出对应哪段，需要对齐——那是文档「术语漂移」用模型做的事。单字术语匹配太多不值得替换；长术语优先（"API" 不能抢在 "API Key" 前面）。
- **词汇表的四条规则（v0.5.2，全在 `glossary.js`，`tests/unit/stack/glossary.test.js` 守着）**，起因是 2026-09-18 给用户建术语入门包时发现的四个缺口：
  - **整词匹配**：术语的首尾若是拉丁 / 希腊 / 西里尔字母或数字，那一端必须在词边界上（`termRegex`）。此前是纯子串替换，词条 `prompt` 会把 `prompts` 换成「提示词s」。边界只看这三类有空格的文字：译文里的英文词常常紧贴着汉字（「做了fine-tuning之后」），把汉字也当成「字母」就永远匹配不上；中日韩词条两端没有这类字符，照旧子串匹配。替换用函数形式，译法里的 `$&` 不会被当成反向引用。
  - **目标语言**：`pickTermsForTarget` 排除存给别的目标语言的词条，本语言的精确匹配胜过无语言词条（规则原在渲染端 store，现在两端共用这一份）；结果带 `bound`——词条就是存给这个目标语言的。
  - **无语言词条要原文里有才用**（`glossaryPass`）：无语言词条（老的文件导入、老迁移包）对任何目标语言都可用，中译英时英文译文里天然出现的 `fine-tuning` 会被换成「微调」。现在无语言词条只在**原文**含这个词时才应用；`bound` 的词条不受此限（日译中时模型吐出英文外来词，原文里并没有这个英文词，仍然该换）。调用方传来的词条没有 `bound` 标记一律按无语言处理，宁严勿松。源头也堵了：「导入术语」把词条绑到当前目标语言并在提示里说明，迁移包的术语块带上 `targetLanguage`。
  - **缓存命中也过词汇表**：缓存存的是源的原始输出，命中时此前直接返回、跳过了词汇表——同一句第二次翻译术语就丢了，后加的术语对已缓存的句子也不生效。现在命中与新译走同一个 `_textFields`。
- **词汇表对所有窗口生效（v0.5.2）**：术语存在主窗口的加密收藏里，划词窗、悬浮窗和听译字幕都不是主窗口，也**不许**读历史保险库（`ipc/history-vault.js` 只认主窗口），所以此前它们翻译时根本没有术语。现在主窗口经 `stack:set-glossary` 把术语推给主进程的栈（`service.setGlossary`，只在内存、不落盘；没走 electron-store 是因为那是明文 config.json，而收藏按设计加密存放），请求没带 `glossaryTerms` 时栈按目标语言自己取。主窗口与文档页照旧自带词条（它们手里的是最新状态），显式传空数组表示不用词汇表。门面只认主窗口的推送；条数与长度上限在 `sanitizeGlossaryItems`（5000 条、每项 500 字符），放在栈里而不是 IPC 处理器里，任何主进程调用方都绕不过。
- 默认优先级：本地模型领先，然后是免密钥的云端兜底——与新安装的启用集（`components/ProviderSettings/defaults.js`）同形，「从没打开过设置」与「打开过一次」两条路行为一致；需要密钥的源未配置时瞬间跳过。测试连接绕过实例缓存，未保存的配置不污染活单例。

## 4. 翻译源（providers/）

- 移植记录：每个源都是从 `src/providers/<id>/` 搬来，元数据改读共享表、网络改 rtFetch，逻辑逐字节相同。`metadata.js` 是两端共用的单一来源：渲染端按 id 合并 svg 图标，主进程按 `configSchema` 判断加密 / 必填字段——分叉会毁掉已存密钥或设置表单，所以必须保持 JSON 可序列化。`supportsChat` 是 AI 动作的门，必须与类真实实现 chat() 一致：传统 / 纯 API 源会把提示词翻译一遍，看起来像功能正常；`tests/unit/stack/provider-chat.test.js` 守这一列。Ollama 品牌色白色在浅色主题上消失，改灰。`translate.google.cn` 2022-10 退役，选项只会产生失败，已移除。
- 语言名给 LLM 提示用英文而不是自称：提示词本身是英文，`Translate to Meiteilon` 模型能执行，而陌生文字写的同一请求不能。
- 中止：固定超时的源用 `combineSignal` 合并调用方信号（门面 requestId → AbortController，P2-34）与自身超时；自管 AbortController（闲置看门狗）的源要把外部中止传播进去，且必须先查 `aborted`——已中止信号上的监听器永不触发（回退链把同一个信号交给下一个源）。
- **闲置看门狗而不是总时长超时**：`AbortSignal.timeout(30s)` 会杀掉一条长但健康的流；每收到任何字节（含推理增量与心跳）重置，思考模型与慢硬件不会在还在产出时被杀。`AbortSignal.timeout()` 抛的是 TimeoutError 不是 AbortError，旧的 AbortError 判断从未命中。
- OpenAI 兼容：纯空白回复不是翻译，报成功曾让空串一路当结果并被缓存；「从没开始」与「中途死掉」要区分，用户才知道该调超时还是查服务器；不配置就不发 `max_tokens`，固定上限会悄悄截断长输出（CJK 译文比原文膨胀）。模型列表先 `/v1/models`，失败或为空再走预设的兜底端点（Ollama `/api/tags`），并优先暴露主端点的错误。Ollama 要显式模型名（LM Studio 用已加载的），留空时自动取第一个并缓存到配置。本地生成受硬件限制（冷载入 + 推理模型思考阶段可达数分钟），超时可调；LM Studio JIT 载入，闲置后第一请求付全额载入。
- Anthropic / Gemini：`max_tokens` / 截断的回答不能当完整的成功——会缓存并展示半截译文。Gemini 的安全阈值全部放开：翻译合法地要处理新闻、小说等类别，默认阈值拦太多；多段回答要拼接；状态行读的是 `message` 键不是 `error`。Anthropic 的 dangerous-direct 头在浏览器外是惰性的，保留只为请求形状稳定。
- DeepL：免费密钥以 `:fx` 结尾且主机不同；不支持的语言（旁遮普语）在发请求前就拒并标 `skipFailureCount`；456 = 配额耗尽；`/usage` 是最便宜的探测且顺带报配额。**「强制走免费版主机」默认关（v0.5.2 起，原为开）**：主机选择 = 选项 或 `:fx` 后缀，默认开时不带 `:fx` 的 Key 会被送到免费主机而鉴权失败；默认关则两种 Key 都走对，已保存的 true 不受影响。DeepL 2026-07 起新注册只有 Developer 计划（一次性 100 万字符），老 API Free Key（`:fx`、每月 50 万）仍可用；新 Key 是否还带 `:fx` 没有 Key 验证不了，默认关正是为了不依赖这个答案。
- **默认模型名与停用名单（v0.5.2，2026-09-18 对各家官方文档核实，作者没有任何在线 Key，全部只到文档与单测级）**：
  - DeepSeek `deepseek-chat` / `deepseek-reasoner` 于 2026-07-24 停用（api-docs.deepseek.com/updates），现名 `deepseek-flash`（滚动别名，思考要显式开）。Gemini `gemini-2.0-flash` 于 2026-06-01 关停（ai.google.dev 的 deprecations 页），默认改滚动别名 `gemini-flash-latest`——Google 四个月内连发 3.5 → 3.8，钉具体版本一年内必死，别名不用年年换。Anthropic `claude-sonnet-4-20250514` 已标弃用（退役日未定），默认改 `claude-sonnet-5`。OpenAI `gpt-4o-mini` 仍在役，默认改 `gpt-4.1-mini`：GPT-5.x / 6 全是推理模型，会拒绝兼容层固定发送的 `temperature`，4.1-mini 是仍接受现有请求形状的最新型号。
  - `providers/retired-models.js`：厂商**已关停**的名字 → 现役名字，registry 的三个入口（`createProvider` / `updateProviderConfig` / `initConfigs`）都过一遍，所以设置里存着旧名的老用户不用动手。**只收已关停的**：还在役的型号（哪怕已弃用）不许映射，那等于悄悄换掉用户选的、按量计费的模型。设置页仍显示用户存的旧名，请求按现役名发。
  - 新一代模型默认开思考，回答前面多一个思考块：Claude 的 `content[0]` 可能是 `thinking`（默认 `display: omitted`，文字为空），Gemini 的 `parts` 里可能有 `thought: true`。两个源改为只拼文本块 / 非思考段，此前读 `[0]` 会把正常回答报成「无翻译结果」。思考 token 计入输出上限（Anthropic `max_tokens`、Gemini `maxOutputTokens` 都是思考 + 正文合计），上限从 4096 / 2048 提到 8192，否则长段落会被思考吃掉额度而截断；上限不影响计费，只按实际产出算。
  - 不主动发关思考的参数：`thinking: {type: "disabled"}` 在部分型号上直接 400，Gemini 的 `thinkingLevel` / `thinkingBudget` 按代际不同，用户可以填任意型号，发了反而更容易坏。
  - Gemini 翻译与连接测试的端点从 `v1` 改 `v1beta`：对话路径本来就在 v1beta，官方示例全部用它，别名与新型号在 v1 上是否可用没有依据。
  - 守门单测 `tests/unit/stack/provider-models.test.js`：表单默认值 = 类默认值、默认值不在停用名单、停用名单不指向另一个停用名、带思考块的回答能解析、DeepL 主机选择。
- 百度翻译：MD5 参考实现**别重构**——算法固定，任何改动破坏签名；签名对 UTF-8 字节算；长文本 GET 会超 URL 长度（也撞长查询限速），改 POST 体，阈值与 Google 源的 URL 长度守卫一致。Google（非官方 web API）：tk 位运算是从 translate.google.com 打包 JS 逆向来的，必须与 Google 完全一致否则 403；TKK 种子 `0.0` 对大多数请求量有效；响应形状三种都见过；连接测试要真翻一句，首页探测抓不到 API 封禁。微软：区域绑定密钥要区域头，全局密钥不要。
- 内置模型源（`tengine.js`）：无网络无服务无密钥，把栈的消息合成一 system 一 user 交给 `localLlm` 钩子；多轮对话折成带标签的行（运行时模板只渲染一个 user 轮）；`maxTokens` 按 CJK 约一字一 token 估。仅翻译包 `canChat()` 为 false，AI 动作跳过它。

## 5. OCR 链（ocr/）

- 管理器是共享单例，故意与渲染端原版不同：优先级是**每请求**选项（悬浮窗以前在自己的实例上 setPriority，共享后会把排序泄漏到所有窗口）；视觉锁全局（锁一次所有窗口受益），回退结果带 `visionLocked` 让渲染端不用再一次 IPC 就能措辞；配置经注入的 loader（settings.ocr 平铺桶 + 保险库密钥）。默认顺序：本地引擎在前（无网络无配额），再在线 API；内置视觉模型排在两个经典本地引擎之后，直到它在 OCR 四道门上胜过 PP-OCR。
- **视觉自动降级**：llm-vision 报「不支持视觉」时透明改用 rapid-ocr，结果带 `fallbackFrom`；连续两次失败上**锁**，跳过 llm-vision 直到用户在设置里重新启用——不对不兼容的模型每次截图都锤一遍。锁的原因随计数一起记：只写「locked」的日志让用户不知道该修什么。
- 图片被丢掉的「假成功」检测：视觉请求提示里总带编码图片，`prompt_tokens` 必然几百起（图片 token 按像素算不按字符）；只会文本的服务器悄悄丢图、只按指令作答，`prompt_tokens` 只剩约 100 的 OCR 提示。低于 150 的地板 + 200 = 图片没到模型 → 降级而不是把模型的闲聊当 OCR 输出。只在服务器报 usage 时判定（很多不报，记为已知边界）；紧凑分词的视觉模型远在 150 以上。400 体嗅探与 token 地板产生同一串错误文本，因为 `_isVisionUnsupportedError` 靠模式匹配触发回退——两处关键字要同步。
- 白名单由 IPC 门面从当前模式注入，渲染端不能给；被禁的首选引擎落到过滤后的链而不是直接失败。本地模型缺失 / 损坏降级到 Windows OCR 而不是让截图失败。成功清零失败计数。走优先级列表时读不了该文字的引擎不会报失败——它返回空或乱码——所以要用**结果质量门**判断是否继续走（见下），保留「报成功但读不出」里最好的一个，全链都吃力时仍有东西可回。
- **结果质量门**（`result-quality.js`）：本地引擎对字典表示不了的文字不报失败。渲染样张实测（PP-OCRv6 small 内置基础包）：正确样本 en 0.99 / zh 1.00 / 波兰语 0.99 / 11px 1.00 / 模糊 0.99，密度 1.02（CJK）到 2.92；韩文 / 阿拉伯文 / 天城文 0 块空文本仍 success:true；泰文置信 0.62 输出 "ulanauauu"；希伯来文 0.64 垃圾；俄文（无西里尔包）置信 0.86 但整行只出一个逗号，密度 0.04。只看置信度漏俄文，只看密度漏希伯来文，两者都要，且离正确样本都很远：正确置信最低 0.986 对地板 0.70，正确密度最低 1.02 对地板 0.50。模糊或 11px 也 0.99——这个引擎的置信度反映「这些字形在不在我字典里」而非画质，这正是门安全的原因。密度 = 识别字符数 / 检测框行高（一个行高约一个 CJK 字或两个拉丁字）。**检测不到也不声称**：越南语（0.985，声调全丢）与希腊语（0.90，重音丢）看起来像正常文本，只有对的模型能修，所以本地 OCR 不提供这两种语言。阈值只对本地引擎校准，其他引擎的置信语义不同（API 不给时不少默认 0.9），套上去是瞎猜；空文本对谁都不可用，Windows OCR 空读也报成功。
- 坐标契约（`blocks.js`）：坐标空间是**源图像素**（本地引擎除掉自己的预处理放大，在线引擎收到的就是原图）；粒度是**每行**（或段）——词级框让普通段落在 `shouldUseScatteredMode` 的长宽比测试里像一堆词，会把散落模式强加给正文，只有词框的引擎（OCR.space、Windows OCR、Google Vision 的 textAnnotations）要先并成行。没有可用文本**且**可用框的块直接丢而不是半渲染：无框的会被 `positioned()` 静默跳过，坏框会把面板放错地方；全丢就退化成统一模式，即这些引擎以前的行为。
- 各在线引擎：Azure Read 异步提交再轮询（10 s 预算 1 s 间隔），boundingBox 是 8 数四边形，逐行框无合并变体。百度 OCR：token 30 天，提前一天刷新；`accurate` 带坐标、`accurate_basic`（basic 字面意思就是无坐标）不带，精度相同但百度分别开通计量，先试带坐标的、该账号用不了（6 未开通、17/19 配额、18 QPS）再降 basic，不为用户可能不知道的配额让截图失败；token 与图片错误两个端点都会挂所以不在降级码里。Google Vision 块取 `fullTextAnnotation` 的段落而非逐词的 `textAnnotations[1..]`；段落无 text 字段，要从 symbols 加 detectedBreak 重建。OCR.space 用 Engine 2（小字 / 花体明显更准），`isOverlayRequired` 只多响应体不多计费，overlay 是词框需并成行；同时发 `scale=true`（服务端放大小图），overlay 坐标空间若不是源图像素会落到框外被 `resolveDisplayMode` 丢掉，退化成统一模式即该引擎有框之前的行为。
- 路径 B（AI 动作直接看图）：模型直接读截图而不是总结 OCR 输出，版面与图文交错保持完整、识别错误不叠加；与 recognize() 共用端点、模型、丢图检测与视觉锁，只有提示不同（来自动作配置）。是否可用故意**不探测网络**：可达说明不了有没有载入视觉模型，只能从回复知道，失败时降级。离线模式下远程视觉端点直接拒绝：截图泄漏的远比一行文字多。
- **内置视觉模型的智能分配**（`vision-routing.js`，用户 2026-09-14 拍板）：选中它 = PP-OCR 先读每张截图，简单的到此为止；只有大图（物理像素上 1.75x 屏的整屏 / 半屏截图）、PP-OCR 读成分栏 / 表格 / 混合字号的版面、或它没把握的读取才升级到视觉模型。证据只用 PP-OCR 自己的行框与置信度，像素只看文件头（PNG / JPEG / BMP 尺寸）。表格 = 若干行每行三个以上并排框；分栏 = 两组以上左边缘、各是真正的一栏且纵向重叠；混合字号 = 最高或最矮行离典型值很远。结果里的 `routed` 只用枚举说明走了哪条路。视觉引擎（`tengine-vision.js`）只在双文件包过哈希且视觉宿主在 GPU 上时可用（GPU-only 见 T-ENGINE §10）；未安装或 CPU 拒绝尺寸是诚实失败，管理器走向下一个引擎。始终 Spotting 任务，每行带源图像素框。
- **分配日志（v0.5.2）**：`ROUTING` 那组阈值是 2026-09-14 拍脑袋定的，要调得有数据，所以选中视觉引擎后**每张截图**在主程序日志里记一行（走本地 OCR 的也记，之前只记升级的、且没有数字）：

  ```
  [info]  [Stack:OCRManager] vision routing: to=tengine-vision reason=table mp=0.14 lines=12 conf=0.98 low=0 rows=4 cols=3 spread=1 pp=85ms vision=640ms
  ```

  | 字段 | 含义 | 对着的阈值 |
  | --- | --- | --- |
  | `to` / `reason` | 去向与原因（`simple` = 留在本地 OCR） | — |
  | `mp` | 图片百万像素，读不出文件头时为 null | `LARGE_PIXELS` 1.2 |
  | `lines` | PP-OCR 带框的行数 | `MANY_LINES` 30；版面判断要 `MIN_LINES_FOR_LAYOUT` 8 行起 |
  | `conf` / `low` | 平均行置信度 / 低于 0.6 的行占比 | `LOW_CONFIDENCE` 0.75、`LOW_LINE_SHARE` 0.3 |
  | `rows` | 并排三框以上的行数 | `TABLE_ROWS` 3 |
  | `cols` | 纵向重叠的栏数（表格也会读成栏，判断时表格在前） | 2 |
  | `spread` | 最高或最矮行与典型行高之比 | `SIZE_SPREAD` 2.5 |
  | `pp` / `vision` | 两边各自耗时；`visionFailed` = 视觉失败、本地 OCR 的结果顶上 | — |

  **只有数字，不含任何识别文字**（`describeCapture`，单测守着）。调法：用一两周后在日志里搜 `vision routing:`，把「该走视觉没走」的那几张找出来，看它们卡在哪个字段差一点；「不该走走了」的看是哪个 `reason` 误伤最多，再动对应那一个阈值，别一次动几个。日志在安装版的 `data\logs`，开发态在 `%APPDATA%\t-translate\logs`。无痕模式下文件日志只记 error 级，这一行不落盘，属预期。视觉引擎不可用（显卡关着或模型不在）时不算分配，不记这一行，结果里有 `fallbackReason: 'unavailable'`。
- 本地引擎的栈类（`local-bridge.js`）直接调注入的主进程识别器，少一跳；引擎 id 保持 `rapid-ocr` / `windows-ocr` 兼容已存设置。`blocks` = 段落合并，`rawBlocks` = 逐行，散落模式用 rawBlocks。

## 6. 外部语音端点（tts/endpoint.js）

- OpenAI 兼容的 `POST /v1/audio/speech`，本地服务器（kokoro-fastapi、IndexTTS / GPT-SoVITS / CosyVoice 包装）与 OpenAI 都讲这个契约。放在栈里是为了请求走 rtFetch（系统代理）、密钥走保险库，渲染端看不到被请求的 URL 与密钥；配置每次调用由宿主给，apiKey 主进程侧解密，离线模式直接封 `tts_endpoint_` 前缀。
- 基址同时接受 `http://host:8880` 与 `.../v1`。「已配置」= 有基址；**不探测可达性**（每次渲染设置页都探会锤服务器），speak() 失败时降级。以 JSON 回答语音请求的服务器在说明问题（路由错、格式不支持），要浮出来。设置页的测试是一次短合成——没有标准的「你是不是 TTS 服务器」路由，这是唯一诚实的可达性检查。

## 7. 隐私模式表（privacy-modes.js）

- 三个模式一处定义，主进程执行、渲染端直接 import 显示。Windows OCR 把截图当临时文件交给 PowerShell，无痕承诺不碰磁盘，所以它在无痕模式缺席。本地使用计数在离线模式仍累计（历史开着），以前声称不计让隐私矩阵说谎；只有安全模式关掉它。
