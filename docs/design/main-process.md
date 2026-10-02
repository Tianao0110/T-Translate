# 主进程平台层设计说明

代码：`electron/main.js`、`electron/state.js`、`electron/windows/`、`electron/platform/`、`electron/security/`、`electron/screenshot/`。划词翻译见 `selection.md`，听译见 `listen.md`。

## 1. 启动顺序与数据目录（app-paths.js、data-root.js、main.js）

- `applyAppPaths` 必须在 `require('./state')` 之前跑：electron-store 与 logger 都在第一次 require 时冻结路径。它只依赖 fs / path，日志行交回调用方（logger 还没起）。
- 打包版且安装目录可写 → 一切放在 `<install>\data`（设置、历史保险库、缓存、日志），Chromium 自己的存储重定向到 `data\browser`，顶层保持可读；安装目录不可写（Program Files 无管理员）或开发态 → userData 留在 Electron 默认（`%APPDATA%\t-translate`），只把 browser 子目录切出来。真 Electron 探针证实 Chromium 全部文件（含 DIPS / GPUCache / Local State）都跟 sessionData 走。
- 首次搬家从旧 userData 复制 config.json、translation-data.enc、旧缓存与三项浏览器数据（Local State、Local Storage、IndexedDB）。**`Local State` 不可少**：Windows 上 safeStorage 用保存在该文件里的随机密钥加密（密文 v10 前缀），DPAPI 只包住这把密钥；不带它，历史保险库与所有已存 API 密钥在新目录全部解不开（首轮真机漏了，用户历史被判 corrupt，靠沙盒副本恢复）。目标存在就不覆盖，二次启动是空操作，旧目录留给关于页清理。Electron 每次启动都会重建空的 `%APPDATA%\t-translate`，空目录不算旧数据。
- 原地整理：Chromium 条目改名进 browser\（同卷 rename 即时完成），v0.4.6 的 data\ 子目录提上来，旧的 Caches\ 文件退休。
- `TT_USERDATA` 是开发 / QA 沙箱覆盖。
- 单实例锁：输掉的实例立即退出，它的 before-quit 不能碰启动探针计数；右键菜单「用 T-Translate 打开」的文件经 argv（冷启动）或 second-instance 转发，只认 installer.nsh 注册的扩展名（.pdf/.docx/.txt），也因此开发态的 electron.exe / main.js / --flags 永远不会被当成文档。
- 启动探针必须在第一个同步 tick、app-ready 之前跑：只有那时 `disableHardwareAcceleration()` 还有效。
- Windows 通知按 AppUserModelID 路由（`com.ttranslate.core`，须与 package.json build.appId 一致），否则打包版里渲染端的 HTML5 通知永远到不了通知中心。
- 退出：before-quit 先停原生钩子再销毁窗口；will-quit 关闭 T-Engine 的 utilityProcess（Electron 不会自动回收）；5 s 后强制 `process.exit`，uiohook 的原生线程可能拖住进程。
- 显示器拔掉时把落在上面的主窗与悬浮窗搬回有效显示器。

## 2. 崩溃守卫与安全模式（crash-guard.js）

- 启动探针：electron-store 里的脏标记，启动时置位，存活 60 s 或正常退出时清除；下次启动仍在就是上一次没活到稳定（崩溃、强杀、启动卡死），连续失败计数 +1，到 3 次进安全模式（关硬件加速、不预热原生模块）。一次健康运行全部归零。故意退出也算健康，哪怕很短。
- 渲染进程自愈：`render-process-gone` 的异常原因（crashed / oom / launch-failed / integrity-failure / abnormal-exit）就地 reload，3 分钟滑动窗口内最多 3 次；超过交给各窗口的放弃回调——主窗口重启整个程序直接进安全模式（计数预置到阈值，pending 保持 false，重启本身不再加一次失败）；悬浮窗直接关闭，用户从托盘重开一个新的。`clean-exit` 与 `killed`（系统或用户）不重载。
- 不 require electron、全部依赖注入：vitest 下 CJS 的 `require('electron')` 会拿到真包（别名 mock 只覆盖 ESM）。

## 3. 日志（logger.js）

- electron-log，按天轮转、5 MB 上限、留 7 天；模块加载时就配好目录（`app.getPath` 在 ready 前可用，等 ready 会把启动期日志全丢进默认的 main.log）。
- Error 的 message / stack / code 都是不可枚举属性，`JSON.stringify` 把每个 Error 渲染成 `{}`——日志文件曾满是它，一条崩溃都诊断不了；对象整体 `{}` 时也退回运行时描述。
- 文件名用本地日期而不是 `toISOString`（UTC）：UTC 以西的机器傍晚就滚到「明天」的文件，里面的时间戳却是本地。
- 无痕模式文件层只留 error：常规 info/warn 描述用户在做什么，模式承诺不留这种痕迹；渲染端经 `logs:write` 来的行走同一传输，同受限。
- 写入前过滤 API 密钥 / bearer token（特定模式先于通用 key=value）。

## 4. 开机自启、更新、旧键清理

- 开机自启（login-item.js）：Electron 把 HKCU Run 值放在 AppUserModelId 名下，只读写那一个名字。v0.3.7 之前没设 AUMID，旧项在 Electron 默认名 `electron.app.T-Translate` 下，`getLoginItemSettings` 看不见；v0.4.7 的补回逻辑又写了一条 → 登录时起两次，第二实例把窗口拉出来。Node 没有注册表 API，用每台 Windows 都有的 reg.exe 查/删旧名，一次性，标记存 `settings.startup.runEntryMigrated`；每次启动只补缺失的项——重写已有项会重置用户在任务管理器里设的「已禁用」。
- 更新器（auto-updater.js）：electron-updater，blockmap 差分、SHA512、可续传、NSIS 静默安装；下载由关于页触发，但已下载的更新在用户不点安装直接退出时也会应用。`disableWebInstaller` 置 true，否则每次下载都告警。GitHub 的发布说明是 HTML，关于页只画纯文本。`TT_UPDATE_CONFIG` 让未打包的探针指向本地 feed。
- 退休设置键（store-cleanup.js）：渲染端迁移只从内存副本里删旧键、回写时只写子桶，死键在 config.json 里躺了几年；一次性删除，幂等。`state.js` 里 glass → floatingWindow 的键改名同理。默认值里不再播种 providers / connection 两个退休桶：播种会在每次全新安装上重建幽灵键，渲染端迁移再永久带着它们。

## 5. 窗口（window-manager.js、tray-manager.js、menu-manager.js）

- 每扇窗都 `hardenWebContents`：preload 跨导航仍挂着并暴露 `secureStorage.decrypt`，被导航到攻击页面就等于把密钥桥交出去，只允许自己的页面（file:// 或开发服务器）；`window.open` 只放行 http/https 到 `shell.openExternal`，否则注入的 `window.open` 就是「让系统运行这个」（file:// 指向 exe、UNC 路径、ms-msdt: 之类）。与 open-external IPC 处理器同一份白名单（`security/url-policy.js`）。
- 主窗：关闭即隐藏，托盘的退出才真退（`runtime.isQuitting`）；位置用 `displayHelper.ensureBoundsOnDisplay` 防止显示器拔掉后落在屏外。v0.3.3 之前存的是 `getPosition()` 原样的 `[x, y]` 数组，读侧取 `.x/.y` 得到 undefined，每次启动都居中——两种形态都接受。
- 悬浮窗：`backgroundThrottling: false`（失焦时刷新循环必须继续）；`WDA_EXCLUDEFROMCAPTURE` 让 OCR 不把自己的覆盖层读回来，用户可选允许被截取；`getNativeWindowHandle()` 返回的是**装着 HWND 的 Buffer**，直接交给 koffi 的 `void*` 传的是 Buffer 的地址，Win32 拿到假窗口每次都返回 false（实测 IsWindow(buffer) false、IsWindow(decoded) true），必须 `koffi.decode` 出句柄。不再有 `setDisplayMediaRequestHandler`：v0.4.1 前听译经 getDisplayMedia 抓系统音，要申请屏幕源再立刻停掉视频轨；现在原生 WASAPI，程序不再为音频申请屏幕捕获。边界持久化去抖 300 ms：手动标题栏拖动每帧 setBounds，同步写盘 60 次/秒会卡。Windows 上失焦可能丢置顶 z 序，blur 时重设，保持默认 `floating` 级、不升到 `screen-saver`（会压住用户其它钉住的工具）。ESC / Space 在渲染端处理（知道 UI 优先级：历史面板 > 散落面板 > 关闭，并做子窗清理），主进程故意不加 before-input-event 快捷键。关闭时收割所有子面板窗口（它们是没有父窗的置顶孤儿）。
- 截图窗：跨所有显示器的并集矩形，`enableLargerThanScreen`，`screen-saver` 级置顶（临时覆盖层，允许）。
- 托盘：Windows 先发 click 再发 double-click，单击延迟 300 ms，真正的双击能取消它再触发划词开关。划词项用普通菜单项而不是 checkbox：checkbox 让 Windows 给每一行预留勾选列，是菜单看起来松散的唯一原因；托盘图标（右下角绿点）与提示已经表明状态。标签跟随 `settings.interface.language` 变化，无需额外 IPC。
- 菜单：主窗口无边框、从不显示菜单栏，所以应用菜单**只为快捷键存在**（Ctrl+Q、编辑角色、缩放、F11、Ctrl+,），没有快捷键的项永远点不到——v0.5.2 删掉了「置顶」勾选（主窗口置顶另有渲染端按钮经 `set-always-on-top`）和帮助三项。文字经 `main-i18n`，`menu.ok` 是原生对话框的按钮文字，不是菜单项：v0.5.1 清理菜单键时把它当无用键删了，安全模式提示框的按钮于是显示成 `menu.ok`（`t()` 缺键时静默返回键名）。v0.5.2 恢复，并加 `tests/unit/main/main-i18n-keys.test.js` 扫全部调用点；同一条单测还抓出 `floatingWindow.windowNotFound` 从来没进过表。

## 6. 截图（screenshot/）

- 先 node-screenshots（原生、逐显示器、快），退回 desktopCapturer（单张拼接缩略图）。node-screenshots 版本不一：有的暴露属性有的是方法，`getValue` 两者兼容。
- 坐标空间：渲染端给的 `bounds` 是 Electron 逻辑坐标（已除以 scaleFactor）；node-screenshots 在 Windows 上返回物理像素，某些 Linux 是逻辑，先按物理匹配再退回逻辑。
- 悬浮窗区域抓取（`captureRegion`）用 `display.nativeOrigin` 按物理原点匹配显示器：混合 DPI 下 `逻辑中心 × scaleFactor` 不是全局物理坐标（各显示器物理原点各自排布），会选错显示器；退路一物理中心（同 DPI 正确）、退路二逻辑匹配。裁剪尺寸下限 1 px：横跨显示器的窗口能退化成 0 尺寸 → 空 nativeImage → 不透明的「截图失败」。
- 多 GPU：desktopCapturer 有时只返回一台显示器却当成全部，面积比或宽高比对不上就按宽高比猜是哪台显示器再裁。
- ESC 取消经 `globalShortcut`，选区窗关闭时注销。气泡模式把结果发给主窗口后台处理（主窗口未创建时先建再强制隐藏，否则 ready-to-show 会弹出来），`screenshot-captured-silent` 是字面量通道名（跨版本兼容）。
- **贴图**（`pin-windows.js`，截图翻译输出的默认档）：裁出的图钉成原位、原大的置顶窗口，图只在内存里（主进程一份供右键复制，贴图页面一份显示），不写盘、不随重启恢复。最多 8 张，再钉关掉最早的一张。窗口尺寸在 Windows 上做不到逐像素精确：默认 `thickFrame` 让 x 偏左约 6 px，关掉后构造出来的窗口仍比请求大几个物理像素（175% 下 400×150 成了 706×272），`setBounds` 之后还多 2 px——所以窗口用透明的，页面把图按「自然尺寸 ÷ devicePixelRatio」画在左上角，一个图像像素对一个设备像素，多出来的边透明；让图跟着窗口拉伸会发虚。拖动不用 `-webkit-app-region`（透明窗上失效，且吞掉右键与之后要用的单击），页面自己跟踪指针、主进程按钉住时的尺寸 `setBounds`，每帧重传尺寸会在分数缩放下越拖越大。右键（复制当前显示的内容后关闭）与 Esc（不复制）挂在入口文件的 window 上而不在组件里：渲染出错时也关得掉；渲染进程死掉的贴图直接销毁，10 秒内没报告图已画好的贴图丢弃。按在贴图上不算划词手势（`isPointInPins`），不看焦点：贴图恒在置顶层。
- **贴图页面**（`components/PinWindow/`）：图画好后显示窗口，再识别 + 翻译一次（`pipeline.js`）：OCR 引擎、目标语言、同语言处理都由主进程从设置里随 `pin:get-init` 给出，同语言规则与划词窗的截图路径一致（`resolveSameLanguageTarget`），失败一律变成 `{ error }` 不抛。识别翻译中显示原图加角落转圈；成功后译文层直接盖上（不透明——半透明会把原图的字透出来，读不清），单击切回原图；失败时停在原图加红色角标，单击看错误原因。只有真翻译过的才进历史（`pin:add-to-history` 转给主窗口，与划词窗同一条 `add-to-history`，无痕模式由主窗口的 store 拦）。右键复制按当前显示：原图状态复制主进程存的那份原图（逐像素），译文状态由主进程 `capturePage` 截图片框那块（截前给根元素加 `pin-capturing` 藏掉边框与角标，等两帧再截）；拼两张图的方案用户提过，没做。开发态 StrictMode 会把挂载 effect 跑两遍，识别翻译用 ref 守成只跑一次，否则每张图都识别翻译两遍。窗口 `sandbox: false`：preload 要 require `preloads/stack-bridge.js`（与划词窗相同）。
- **译文贴回原位**（第 3 步）：识别结果带坐标且框落在图内时（`resolveDisplayMode('scattered')`，粒度沿用悬浮窗：审过的段落按段、词堆按词），逐块翻译（并发 2，同语言判断一次批量），全部翻完才一起盖上；没坐标（视觉模型）或框对不上图时退回整段覆盖。每块是一块同色底盖住原文：背景取文字框外 3 px 边带的主色、字色取框内离背景最远的那批像素（`patch-colors.js`，在页面里从截图取样，任何带坐标的引擎都适用；PP-OCR 自己也估了颜色但在识别宿主出口丢掉了，没去改宿主）——这是从图像来的数据色，不走主题令牌。字号在「原文行高（原始行框高度的中位数）× 0.85」以内二分取能放下的最大值，最小 8 px；还放不下就截断、悬停看全文。**不往下长、不挪位置**：试过放不下就往下长再用 `pane-layout` 防重叠，长出来的块会盖住旁边保留原图的内容，挪开又会露出自己的原文——悬浮窗的卡片能挪，贴图的块必须钉在自己的原文上。已是目标语言或无需翻译的块不盖，保留原图像素：重画同一段字，字体不同、还可能被截一个字。个别块翻译失败时那块留原文，全部失败才进错误状态。
- **划词复制**（第 4 步）：译文贴片与整段译文本身就是文字；原图上铺一层透明的识别行（每行按行框放，字号取行高、`scaleX` 拉到行宽，选中时只看得到高亮），译文状态下没被贴片盖住的行（已是目标语言、翻译失败的块）也铺上，所以两种状态都能选到画面上的每一段字。按在文字上拖是原生选字，按在别处拖是移动窗口——字很密时从行与行的空隙拖。单击等 250 ms 再切换原图 / 译文，第二下按下就取消（双击留给停靠，用户 2026-10-01 定：双击不选词、单击慢一拍换画面不闪）；第二下按下时 `preventDefault`，挡掉原生双击选词与三击选段。元素按识别引擎的段落顺序排（块内从上到下）：只按纵坐标排，两栏并排时拖选会跨栏交错；表格的单元格顺序仍取决于引擎的版面结果。复制自己拼文本（`copy` 事件里一个元素一行）：绝对定位的元素被浏览器序列化成一整串、行间没有换行。Ctrl+C 走 Chromium 原生快捷键，没有挂菜单也能用（真机经调试协议派发按键验过）。
- **缩放**（第 5 步，用户 2026-10-01 定：滚轮 + 拖边框，「太多会阻挡视野」）：整张贴图（图、贴片、透明文字层）用一个 `transform: scale` 缩放，窗口经 `pin:set-bounds` 跟着改尺寸，主进程记下新尺寸供之后拖动用。用 transform 不用重排：字号适配与文字层的拉伸都按原始尺寸算一次，缩放时不重算，选字照常命中。滚轮以光标为中心（光标下的内容点缩放前后在屏幕上不动），倍率 `exp(-deltaY × 0.0015)`——鼠标一格约 1.16 倍，触控板的小步也连续；范围 0.25–4 倍，且短边不小于 16 px。滚轮被缩放占用，整段译文过长时只能拖滚动条或把贴图放大来看。边缘 6 px 内是调整大小（光标随之变），等比缩放、对边或对角固定，优先于选字与拖窗。连续滚动时 `window.screenX` 跟不上还没落地的 setBounds，锚点按页面自己记的上一次请求的窗口位置算。边框的粗细按缩放反向除掉，始终 2 px；右键复制「当前显示」时截的是缩放后的样子。

## 7. 安全层（security/）

- 密钥保险库（secure-vault.js）：safeStorage 解密 + 离线门 + 访问审计合一。离线模式直接禁止解密所有在线服务的密钥前缀（provider_* 在线源、ocr_*、tts_endpoint_——外接朗读端点即便在 localhost 也是网络服务），承诺「不发请求」时连凭据都不可读。`OCR_SECRET_FIELDS` 与渲染端 `src/ocr/ocr-key-vault.js` 必须同步。残留的 `***encrypted***` 占位符说明加密副本已丢，置空让翻译源在密钥检查处失败而不是把占位符发出去。
- 审计（secure-audit.js）：从 IPC 层抽出，栈内解密与 IPC 共用一条轨迹和爆发告警（60 s 内 > 15 次非批量解密），否则最大的消费者（栈内）审计看不见。设置页加载、栈启动/重载、OCR 配置加载是合法的批量扫描，记录但不计入告警；告警 5 分钟一次。
- 历史保险库（history-vault.js）：DPAPI 加密，密文绑定 Windows 用户账户。能读不能解密的文件是损坏或别的账户的副本：改名 `.corrupt-<ts>` 隔离而不是覆盖，从空开始。保存写临时文件再 rename，原子。
- 离线判定只有一份（privacy-gate.js）：曾长出三份复制（更新器 IPC、音频包管理器、OCR 缺口），绝对的承诺不能逐个调用点拼写。
- url-policy.js 是纯函数，不 require electron，可单测。

## 8. 全局状态（state.js）

electron-store 是跨进程配置的唯一真相，渲染端经 IPC 读写；Zustand 存 UI 状态并把相关切片镜像进 store。主进程只读 store，永不用 executeJavaScript 往渲染端塞东西。`runtime.safeMode` 是启动期决定，`windows` 是带 getter/setter 的窗口引用代理。
