# T-Caption

T-Translate 的浏览器插件：给网页视频显示字幕，识别和翻译都由本机的 T-Translate 完成。设计见 `docs/design/listen.md` §11（桌面侧通道）。

当前状态：S4 —— 能装进 Chrome / Edge，选项页能配对；YouTube 页面上能抄到站点字幕请求、MSE 音频分片、EME 使用和视频状态并报给 service worker；service worker 下命令时能把分片送去识别、把字幕和译文画在视频上。什么时候开、开哪一级还没接（S5 的状态机），网页上不会自己出字幕。

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
src/sw/                           service worker：拉起 offscreen、转发消息、角标、每分钟连一次
src/sw/page-events.js             各标签页的页面证据、给页面下命令、分片送去识别再把字幕发回页面
src/offscreen/companion-client.js 通道客户端（配对、hello、翻译、识别会话、事件流）
src/offscreen/webm-demux.js       WebM 流式解析（任意切块、未知长度、lacing、坏数据重同步）
src/offscreen/decode.js           WebCodecs 解 Opus → 单声道，重采样到 16 kHz
src/offscreen/audio-feeder.js     按秒喂给通道（背压等待、60 秒挂起、90 秒队列上限）
src/offscreen/media-pipeline.js   上面几段串起来，一次一路媒体流（MEDIA_OPEN / PUSH / CLOSE）
src/content/main-world.js         主世界入口（document_start，不碰 chrome.*，不留全局变量）
src/content/hooks/                主世界钩子：fetch / XHR 抄字幕响应、MSE 抄音频分片、EME，握手前先缓冲
src/content/bridge.js             隔离世界一端：MessageChannel 握手（nonce），主世界来的数据一律校验
src/content/page-agent.js         隔离世界总控：上报页面事件、转发分片、执行 service worker 的命令
src/content/media-watch.js        找页面里的 video / audio，报播放状态
src/content/mse-relay.js          MSE 音频：环形缓冲，打开转发后按 256 KB / 1 秒一包送出
src/content/sites/                站点适配：YouTube（媒体 id、timedtext、导航、隐藏站点字幕、播放器操作）、通用
src/content/parsers/              站点字幕解析：VTT、SRT、TTML、json3，detectFormat 认格式
src/content/caption-track.js      字幕画成视频的原生字幕轨（TextTrack）
src/content/overlay.js            覆盖层：站点藏了原生字幕时画在视频上，跟随全屏
src/content/caption-renderer.js   字幕与译文、双语 / 只译文 / 只原文、两种画法切换，接媒体流水线事件
src/options/  src/popup/          选项页（配对）、工具栏弹窗（状态）
src/shared/                       协议常量、消息约定（媒体字节走 base64）、页面事件格式与校验、状态文案、配色
scripts/build.mjs                 esbuild 构建 → dist/（不入库）
scripts/e2e-client.js             端到端：真实通道 + 真实引擎（npm run smoke:caption-client -- --packs <已装听译包目录>）
scripts/e2e-pipeline.js           端到端：浏览器里录 WebM → 插件流水线 → 真实通道与引擎（用法见文件头）
scripts/e2e-render.js             真机：本地页面的视频上画字幕，读 activeCues 并截图（node extension/scripts/e2e-render.js --out <截图目录>）
scripts/e2e-hooks.js              真机：真实 YouTube 页面上验钩子、分片识别、导航、EME（用法见文件头）
scripts/make-fixture.js           重录单测样本 test/fixtures/tone-2s.webm
scripts/lib/browser.js            临时配置的 Chrome / Edge + DevTools 管道
test/                             单测（并入根 vitest：npm test）
```
