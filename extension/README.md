# T-Caption

T-Translate 的浏览器插件：给网页视频显示字幕，识别和翻译都由本机的 T-Translate 完成。设计见 `docs/design/listen.md` §11（桌面侧通道）。

当前状态：S5 —— 装好配对后不用再碰：YouTube 页面上视频一出声就自动出双语字幕。有站点字幕就直接翻译；没有就抄播放器的音频送给 T-Translate 识别；DRM 站点在视频上提示一行，点一下让 T-Translate 听系统声音。一次只服务正在看的那个标签页；暂停 5 秒、切走标签页、关掉本站（偏好）都会停。S6 加了 B 站适配、工具栏弹窗（状态、本站开关、显示方式、目标语言、导出 SRT）、选项页的按站点开关与字幕缓存。看过的视频再打开，字幕直接从缓存出来（程序没开也行），只对没看过的段落识别。S7 起 B 站没有字幕的视频也能识别（fMP4 / AAC 音频）。

## 安装（开发者模式）

1. 在仓库根目录运行 `npm run extension:build`，产物在 `extension/dist/`。
2. Chrome 打开 `chrome://extensions`（Edge 是 `edge://extensions`），打开「开发者模式」，点「加载已解压的扩展程序」，选 `extension/dist/`。
3. T-Translate 里打开「设置 → 音频 → 听 → 浏览器插件」，打开「允许浏览器插件连接」并点「配对」；60 秒内到插件的选项页点「配对」。

改了代码重新构建，再到扩展管理页点插件卡片上的刷新按钮。`node extension/scripts/build.mjs --watch` 边改边构建。

## 目录

```
manifest.json                     源模板，构建时写入根 package.json 的版本号
_locales/                         界面文案（zh_CN 默认、en）
icons/                            图标（缺了构建时自动画）
src/sw/                           service worker：拉起 offscreen、转发消息、每分钟连一次
src/sw/page-events.js             各标签页的页面证据、给页面下命令、分片 / 听译会话送去识别再把字幕发回页面
src/sw/session-orchestrator.js    每标签页的三级状态机：何时开、开哪一级、何时停；一次只服务一个标签页；缓存命中直接出字幕，只对没覆盖的段落识别，跑出来的写回缓存
src/sw/tab-arbiter.js             哪个标签页在看（聚焦窗口的活动标签页、各窗口的活动标签页）
src/sw/prefs.js                   偏好（chrome.storage.local 的 prefs：开关、autoListen、显示方式、目标语言、按站点关）
src/sw/badge.js                   角标：通道状态的色点；按标签页标「CC / L / off」
src/sw/cache-db.js                字幕缓存：按媒体存字幕与译文，超 200 条 / 100 MB 淘汰最久没用的；IndexedDB（CACHE_* 消息）
src/offscreen/companion-client.js 通道客户端（配对、hello、翻译、识别会话、事件流）
src/offscreen/webm-demux.js       WebM 流式解析（任意切块、未知长度、lacing、坏数据重同步）
src/offscreen/mp4-demux.js        fMP4 流式解析（moov 取 AAC 配置，moof + mdat 取帧，同 WebM 的事件，坏数据重同步）
src/offscreen/decode.js           WebCodecs 解 Opus / AAC → 单声道，重采样到 16 kHz
src/offscreen/audio-feeder.js     按秒喂给通道（背压等待、60 秒挂起、90 秒队列上限）
src/offscreen/media-pipeline.js   上面几段串起来，按开头字节选 WebM / MP4 解析器，一次一路媒体流（MEDIA_OPEN / PUSH / CLOSE）
src/offscreen/listen-session.js   DRM 兜底：让程序自己听系统声音的会话（LISTEN_OPEN / CLOSE），事件同媒体流水线
src/content/main-world.js         主世界入口（document_start，不碰 chrome.*，不留全局变量）
src/content/hooks/                主世界钩子：fetch / XHR 抄字幕响应、MSE 抄音频分片、EME，握手前先缓冲
src/content/bridge.js             隔离世界一端：MessageChannel 握手（nonce），主世界来的数据一律校验
src/content/page-agent.js         隔离世界总控：上报页面事件、转发分片、执行 service worker 的命令
src/content/media-watch.js        找页面里的 video / audio，报播放状态
src/content/mse-relay.js          MSE 音频：环形缓冲，打开转发后按 256 KB / 1 秒一包送出
src/content/webm-sniff.js         不解封装读 WebM 分片的媒体时间（Cluster Timecode）
src/content/mp4-sniff.js          不解封装读 fMP4 分片的媒体时间（mdhd timescale + tfdt）
src/content/sites/                站点适配：YouTube（媒体 id、timedtext、导航、隐藏站点字幕、播放器操作）、B 站（BV / av / 番剧 id、分 P、字幕清单 → 取字幕体）、通用
src/content/parsers/              站点字幕解析：VTT、SRT、TTML、json3、B 站 JSON，detectFormat 认格式
src/content/caption-track.js      字幕画成视频的原生字幕轨（TextTrack）
src/content/overlay.js            覆盖层：站点藏了原生字幕时画在视频上，跟随全屏
src/content/caption-renderer.js   字幕与译文、双语 / 只译文 / 只原文、两种画法切换，接媒体流水线事件
src/content/notice.js             视频上的一行提示（DRM 时「用 T-Translate 听译」+ 按钮）
src/options/                      选项页：配对、按站点开关、自动听译、字幕缓存
src/popup/                        工具栏弹窗：当前标签页状态、本站开关、显示方式、画法、目标语言、导出字幕
src/shared/                       协议常量、消息约定（媒体字节走 base64）、页面事件格式与校验、状态文案、SRT / VTT 导出、配色
scripts/build.mjs                 esbuild 构建 → dist/（不入库）
scripts/e2e-client.js             端到端：真实通道 + 真实引擎（npm run smoke:caption-client -- --packs <已装听译包目录>）
scripts/e2e-pipeline.js           端到端：浏览器里录 WebM（或 --ffmpeg 转 fMP4 / AAC）→ 插件流水线 → 真实通道与引擎（用法见文件头）
scripts/e2e-render.js             真机：本地页面的视频上画字幕，读 activeCues 并截图（node extension/scripts/e2e-render.js --out <截图目录>）
scripts/e2e-hooks.js              真机：真实 YouTube 页面上验钩子、分片识别、导航、EME（用法见文件头）
scripts/e2e-auto.js               真机：不下任何命令，真实 YouTube 页面上字幕自己出现；暂停 / 切标签页 / 关站点 / DRM 提示（用法见文件头）
scripts/e2e-bilibili.js           真机：真实 B 站页面的证据、AAC 音频识别出双语字幕、MediaSource 重建后续上、字幕清单、分 P；构造清单走一级（用法见文件头）
scripts/e2e-popup.js              真机：真实 YouTube 页面上的弹窗、显示方式、本站开关、导出、缓存与选项页（用法见文件头）
scripts/make-fixture.js           重录单测样本 test/fixtures/tone-2s.webm
scripts/make-fixture-mp4.js       用 ffmpeg 重做单测样本 test/fixtures/tone-2s.m4s（--ffmpeg 传路径）
scripts/lib/browser.js            临时配置的 Chrome / Edge + DevTools 管道
scripts/lib/e2e-shell.js          真机脚本的壳：沙盒 Electron 通道 + 听译包 + 无头 Chrome + 配对
test/                             单测（并入根 vitest：npm test）
```
