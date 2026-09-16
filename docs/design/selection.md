# 划词翻译设计说明

代码：`electron/selection/`（`controller.js` 鼠标钩子与两条出口、`selection-state-machine.js` 手势状态机、`clipboard-capture.js` 剪贴板抓取、`captured-text.js` 文本清理）、`electron/platform/native-helper.js`（Win32 探测）、`electron/ipc/selection.js`、渲染端 `src/components/SelectionTranslator/`。

## 1. 手势识别（selection-state-machine.js）

全局鼠标钩子（uiohook-napi）把 mousedown / mousemove / mouseup 喂给状态机：IDLE → POSSIBLE（采样中）→ LIKELY（条件满足，准备出图标）→ CONFIRMED（mouseup）。

- 采样每 25 ms，位移 < 1.5 px 或 10 ms 内不足 3 px 的样本当噪声丢掉。
- 条件 A 方向稳定：≥ 80 ms、总位移 ≥ 12 px、最近 5 个方向变化的中位数 < 15°（180° 折返、>120° 的离群值忽略）。
- 条件 B 慢而准：≥ 100 ms、最近 5 个样本平均速度 ≤ 0.1 px/ms、单跳 ≤ 3 px。
- 条件 D 快速果断（后补，修「快速划过一个词没识别到」）：≥ 10 ms、≥ 8 px、水平分量 ≥ 5 px、dy/dx ≤ 0.6、速度 > 0.2 px/ms（与 B 的 ≤ 0.1 不重叠）。检查顺序 D → A → B，D 最快先判。
- 条件 C 双击/三击：距上次 mouseup < 400 ms 且 < 15 px。多击进 LIKELY 后走「延迟确认」：等满整个多击窗口再探测。早探（曾 80 ms）落在双击与三击之间，合成的 Ctrl+C 打断应用自己的三击扩选，抓到的是双击的词而不是整段；窗口内再来一次点击就取消并重排。
- 回撤：进 LIKELY 后 120 ms 宽限，之后连续 3 个 > 60° 的方向突变退回 POSSIBLE。
- 超时：POSSIBLE 4 s，LIKELY 2 s；LIKELY 的看门狗在每个被接受的样本上刷新（含义是「2 s 没动」而不是「进入 LIKELY 2 s」，否则慢速多行拖选会被中途杀掉）。CapsLock 直达路径不设看门狗（mouseup 自然收尾）。
- 时钟可注入：条件都是位移除以墙钟时间，单测必须控制时间，真实 sleep 在负载下会拉长并翻转判定。
- 每次 mouseup 都写 upTime（直达路径也写），否则直达之后的下一次双击会误判。

## 2. 三层探测（native-helper.js）

mouseup 判定为选择后，先做不动剪贴板的探测，再决定要不要走剪贴板：

1. 焦点 + 控件类过滤：`GetForegroundWindow` → `GetGUIThreadInfo` 取真正聚焦的控件类名。`GetGUIThreadInfo` 必须声明 `_Inout_`，koffi 才把填好的结构体拷回 JS；没有它焦点与光标句柄永远是空，检测静默失败。`cbSize` 必须精确等于 x64 下的 72 字节。桌面 / 资源管理器视图 / 列表树 / 按钮标签 / 滑块 / 滚动条 → 直接「无选择」。
2. 标准编辑控件 `EM_GETSEL`（同步、无副作用）：Edit / RichEdit 家族 / Win11 记事本的 RichEditD2DPT / .NET TextBox，类名精确匹配（子串匹配会让 OlkPeoplePickerEdit 命中 Edit 规则）。用 `SendMessageTimeoutW(SMTO_ABORTIFHUNG)`，200 ms，卡死的目标窗口不能拖住主进程；超时当失败落到第三层。Word 的 `_WwG` 故意不在这一层：EM_GETSEL 对它返回 0/0 会短路成「无选择」，它只在复杂应用表里。
3. 复杂应用 → 剪贴板回退：Chrome / Edge / Electron / WebView2 / Firefox / Windows Terminal / VSCode / Office 三件 / 经典 Outlook 的一堆内部类（rctrl_renwnd32、Olk 前缀、AfxWndW、NetUIHWND、SUPERGRID、Outlook Host）/ PDF 阅读器（AVL_AVView、AcrobatSDIWindow、SUMATRA_PDF_FRAME、Foxit）。PDF 页面视图有选择但没有 Win32 光标，不显式列入就落到「未知类无光标 = 无选择」，剪贴板层根本没机会（探针日志确认）。复杂应用表允许前缀/子串（Chrome_WidgetWin_、Olk、WebView）。
4. 未知类但有光标 → 剪贴板；无光标 → 无选择。

每个判定带 `focusResolved` / `hasCaret` 诊断字段，`TT_SELECTION_DEBUG=1` 时 `[probe:*]` 日志只记控件类与方法，永不记文本；cmd 的 `set X=1 && …` 会把尾随空格带进值，解析要 trim。坐标校验探针：uiohook 事件坐标在缩放屏上是物理像素（1.75x 读数约 1.75 倍），所以一律用 `screen.getCursorScreenPoint()`。

## 3. 剪贴板抓取（clipboard-capture.js）

- 一把互斥锁：mouseup 探测与图标点击的抓取曾交错并互相覆盖对方的恢复。
- 全格式快照与恢复（文本 / HTML / RTF / 图片）：被动探测覆盖掉用户还没粘贴的截图曾是真实的数据丢失路径。剪贴板里是文件且无文本时拒绝探测（文件格式无法经 API 恢复），返回 `fileClipboard`，探测结果记为「未定」而不是假的「无选择」。
- 成功缓存 500 ms：抓到之后图标点击的第二次抓取直接复用，修掉复杂应用里焦点转移后「按了没内容」；每次新的 mousedown 清缓存，缓存只能在同一次手势内复用。
- 轮询到复制落地：非空文本或出现文件格式（资源管理器复制文件产生 CF_HDROP 常无文本），普通应用 800 ms、Office 类 1000 ms。产生的格式要在恢复之前读，恢复后再读就是文件拖放误判的老 bug。
- 合成 Ctrl+C 前先清粘住的 Ctrl / C 键态（Word 会留下按住态，合成键序会变成输入字母 c）；先松 C 再松 Ctrl。

## 4. 文本清理（captured-text.js）

Outlook 等复制 CRLF，Chromium 在 `white-space: pre-wrap` 下把孤立的 CR 当成独立换行，划词窗里每个段落间隔翻倍，翻译源也看到同样的噪声 → 统一 LF。PDF 阅读器原样复制连字码点（ﬁ ﬂ ﬀ …），没有这些字形的字体渲染成豆腐、翻译源看到垃圾 → 标准 Unicode 连字无损展开，PUA 自定义连字无法恢复留原样。NBSP → 空格；换行前的尾随空格与三连空行折叠。

## 5. 两条出口与窗口几何（controller.js）

- 图标路径：40×40 方形触发窗。Electron 42 在 Windows 上把无边框透明窗钳到约 30×37 的最小值，旧的 28×28 变成非方形，`border-radius: 50%` 渲染成椭圆；40 在所有测过的 DPI 上都不被钳，渲染端也把图标钉成固定尺寸。位置用 `display.workArea` 而不是 `bounds`，图标不会塞进任务栏下面，也与卡片在渲染端的 availWidth/Height 钳制同一参照系。SHOW_TRIGGER 带上所在显示器的工作区，渲染端才能把卡片钳在正确的显示器上（`window.screen` 只有当前显示器、没有全局原点）。
- 预取文本直通：第三层已抓到的文本随 SHOW_TRIGGER 带给渲染端，点击图标直接用，跳过第二次剪贴板抓取。
- CapsLock 直达（设置开 + CapsLock 灯亮）：跳过图标，先发 `capturing` 阶段的加载点（抓取约 0.8 s，无声的空档像坏了），抓到文本发 `translate`；抓空则翻成「失败」态图标（红 + 抖动），点击重试。需要真实拖动（≥ 8 px）：纯点击不能注入 Ctrl+C。
- 终端类（Windows Terminal、conhost、VirtualConsoleClass、mintty、PuTTY）里直达路径降级成点击确认的图标：无选择时的 Ctrl+C 是 SIGINT，会杀掉正在跑的进程。
- 窗口拖拽检测：mousedown 记前台窗口的 id 与位置，mouseup 比对；同一窗口移了 > 10 px 就是标题栏拖拽，任何探测/注入都跳过。双击标题栏最大化的尺寸变化落在 mouseup 之后，延迟确认里再查一次。
- 划词窗常驻 `hide()` 不销毁（设计如此，别当 bug）；渲染进程死了（崩溃、开发服务器重启）再复用只会得到一具透明的尸体，所以 `render-process-gone` 与主框架真实加载失败标记 `_rendererDead`，下次创建时销毁重建。`did-fail-load` 的 -3（中止的加载，如 HMR）与子框架不算死——曾把健康窗口误销毁，症状是「载入模型后划词窗黑了」。
- 冻结卡片最多 8 个，满了拒绝而不是悄悄关最老的（那是用户故意钉住的内容）。置顶级别是 `floating` 不是 `screen-saver`：冻结卡片可能存活很久，`screen-saver` 会压在用户自己钉住的工具之上。
- 截图 OCR 复用同一扇窗：`showSelectionLoading` 出 28 px 加载点，20 s 看门狗——OCR 永不回报（渲染端没就绪、消息丢了）时不能留下一个关不掉的转圈。结果模式二（只给文本，窗口自己翻译，复用同一条翻译与历史流）与模式三（已译文本 / 错误直接显示）。设置载荷统一由 `buildSelectionSettingsPayload` 生成——各调用点曾各写一份，截图模式二/三漏了 showSourceByDefault 与 triggerTimeout，默认值也不一致。
- `settings.selection` 走缓存镜像：electron-store 每次 `.get()` 都从磁盘重读整份设置文件，对全局 mousedown/mouseup 热路径太慢。
- uIOhook 是单例 EventEmitter，`.stop()` 不会摘监听器；开关划词翻译前先 `removeAllListeners`，否则重复处理器互相竞态，双击抓取失效。

## 6. 预热

启动后 3 s（自启 8 s）预加载 uiohook-napi、koffi、划词窗与状态机，第一次手势不付加载代价。安全模式跳过（原生模块是启动崩溃的头号嫌疑）。
