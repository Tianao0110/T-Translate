# 模型包与存储设计说明

代码：`electron/packs/`（`model-root.js` 模型根目录、`model-pack-core.js` 通用包管理器、`model-migrate.js` 旧位置搬迁、`pack-roots.js` 多根合并）、各领域外壳 `electron/ocr/ocr-pack-manager.js`、`electron/listen/audio-pack-manager.js`、`electron/tts/tts-pack-manager.js`、`electron/llm/llm-pack-manager.js`。发布与 manifest 协议见 `docs/OCR_MODELS.md`。

## 1. 模型放在哪（model-root.js）

- 默认是**安装目录下的 `models/`**，不是 userData。包动辄几百 MB，装在 D:/F: 的用户希望大块头也在那里，而不是让系统盘的 %APPDATA% 一直长。开发态「安装目录」是 node_modules/electron，所以用仓库自己的 `models/`（已 gitignore）顶替。
- userData 只是**兜底**：安装目录写不了（Program Files 且无管理员）才落回去。`storageState()` 把「是否兜底」报给设置页。
- **读两处、写一处**：读取时同时看激活根与 v0.4.0 以前的 userData 根，早期版本下载的、手放的、开发跑出来的包原地照用；新下载只落激活根。v0.4.7 起 userData 本身可能已搬进安装目录，所以旧根要问 `app-paths.legacyUserData()`，不能自己拼。
- `TT_MODELS_ROOT` 环境变量给 smoke / bench 脚本用：它们把一切沙盒到临时目录，不能让开发用的 `models/` 收集测试包。根目录每进程只探测一次。
- `pack-roots.js` 给听译与朗读的包管理器复用「激活根 + 旧根 + 合并列表」；合并时激活根最后扫，同 id 的旧副本被它覆盖。OCR 侧有内置基础包的逻辑，自己在 `ocr-engine.js` 里做。

## 2. 旧位置搬迁（model-migrate.js）

- 搬的是 v0.4.0 以前落在 userData 的包，目标是激活根。顺序是**复制 → 按字节数核对 → 删旧**，旧副本只在整包落地后才删，中途失败用户手里仍是原来的东西。
- 激活根里已经有同名包（搬家后又下载过一次）只删旧不复制。
- 进度按全局字节数报，一条进度条覆盖 OCR / 听译 / 朗读三类。只认带 `pack.json` 的目录，半截下载和散文件留在原地。
- 依赖注入 fs / path / copyFile，单测在临时目录跑、不需要 Electron。

## 3. 通用包管理器（model-pack-core.js）

- 来历：从 OCR 包管理器原样抽出（v0.4.x），听译 / 朗读复用同一套下载 / 校验 / 暂存换入 / 删除机制。程序只写死 manifest 地址，新包靠编辑 Release 发布，不用发版。
- **不 import electron**：`fetch` 由各领域外壳注入（`net.fetch`）。原因是 vitest 里 CJS 的 electron 外部化陷阱，与 secure-vault 一样走 DI；logger 也懒加载，单测注入 `deps.logger`。
- **包 id 白名单** `SAFE_PACK_ID`：id 会变成目录名（`<root>/<id>` 与 `.staging-<id>`），是唯一一个由调用方给出又落到文件系统路径上的值，而且删除是递归删。v0.4.1 实证过 `../../Documents` 这种 id 能逃出根目录把落点整个删掉，之后加了这道检查；manifest 里的 id 也过同一检查（manifest 是下载来的文件，被篡改也不能写到根外面）。
- **删除的根目录约束** `allowedRoots` / `assertInsideAllowedRoot`：递归强制删除只能对「可证明位于本领域某个根之下、且不是根本身」的目录执行，`resolvePackDir` 出错也变不成任意目录的删除。`resolvePackDir` 存在的意义是旧版本装在别的根里的包也能删——那恰恰是用户最想回收的空间。
- **离线门** `offlineGate` 放在这一层而不是 IPC 处理器：两个领域、两条网络路径（manifest 与包下载）在结构上一起被拒，不靠每个处理器记得检查。`file://` 是本地读取不算联网，不拦（这是 env 覆盖用的测试路径）。下载前**再查一次**离线门：manifest 可能是切离线之前缓存的，不能凭它放行大得多的包下载。
- `packFilter`：听译与朗读共用一份 manifest，一个 id 交到错误的通道会把语音包装进 asr-models，所以每个领域只认自己的包类型，其余答 `PACK_UNKNOWN`。
- `evictSessions` 要 **await**：引擎在另一个进程里的领域，必须等文件句柄真放掉再换目录。
- zip 解包 `safeEntryPath`：条目保留相对路径（朗读语音包带整棵 `espeak-ng-data/`、`dict/` 目录树，sherpa 按目录打开），以前靠「压扁成 basename」防 zip-slip，改成显式检查——不许绝对路径、盘符相对路径、`..` 段，解析后必须落在目标目录内，篡改的压缩包直接中止安装而不是被悄悄重排。
- 暂存换入：解到 `.staging-<id>`，写 `pack.json`（镜像 manifest 条目，离线扫描才知道装了什么），逐出会话，删旧目录，`rename` 换入；任一步失败清掉暂存。
- 版本比较 `compareVersions` 放在这里：每个包注册表（OCR、音频）都需要「manifest 比已装的新吗」这一个判断。
- schema 上限 `supportedSchema`：老版本程序遇到更新的 manifest schema 直接拒（`MANIFEST_TOO_NEW`），不误读。

## 4. 各领域外壳

- OCR（`ocr-pack-manager.js`）：`resolvePackDir` 覆盖旧 userData 根，但**故意排除内置基础包目录**——它是程序的一部分，`removePack` 必须继续落到 `BUILTIN_PACK` 拒绝，而不是把安装包里的模型删掉。离线门是后补的：此前离线模式还能拉 manifest 下载语言包，违背了离线的唯一承诺。`TT_OCR_MANIFEST_URL` 可指到 `file://` 或本地 http 做测试。
- LLM（`llm-pack-manager.js`）：不下载，用户按链接手放文件到 `<models>/llm-models`。白名单文件名 + 钉定大小才做哈希（2 GB 几秒，按 size + mtime 缓存），哈希对上才算「就绪」；名字和大小对但字节不同的文件明确拒绝并说明；不在白名单的文件列为 unlisted，只有开发者门打开才可用；永远不从文件夹外面装载文件。多部件包一个部件错则整包拒、一个缺则「部分」。
