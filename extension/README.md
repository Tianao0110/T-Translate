# T-Caption

T-Translate 的浏览器插件：给网页视频显示字幕，识别和翻译都由本机的 T-Translate 完成。设计见 `docs/design/listen.md` §11（桌面侧通道）。

当前状态：S2 —— 能装进 Chrome / Edge，选项页能配对；offscreen 能把 WebM/Opus 字节变成带时间轴的字幕与译文事件。还没有页面钩子，网页上还不出字幕。

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
src/offscreen/companion-client.js 通道客户端（配对、hello、翻译、识别会话、事件流）
src/offscreen/webm-demux.js       WebM 流式解析（任意切块、未知长度、lacing、坏数据重同步）
src/offscreen/decode.js           WebCodecs 解 Opus → 单声道，重采样到 16 kHz
src/offscreen/audio-feeder.js     按秒喂给通道（背压等待、60 秒挂起、90 秒队列上限）
src/offscreen/media-pipeline.js   上面几段串起来，一次一路媒体流（MEDIA_OPEN / PUSH / CLOSE）
src/content/                      内容脚本占位（主世界 document_start、隔离世界 document_idle）
src/options/  src/popup/          选项页（配对）、工具栏弹窗（状态）
src/shared/                       协议常量、消息约定（媒体字节走 base64）、状态文案、配色
scripts/build.mjs                 esbuild 构建 → dist/（不入库）
scripts/e2e-client.js             端到端：真实通道 + 真实引擎（npm run smoke:caption-client -- --packs <已装听译包目录>）
scripts/e2e-pipeline.js           端到端：浏览器里录 WebM → 插件流水线 → 真实通道与引擎（用法见文件头）
scripts/make-fixture.js           重录单测样本 test/fixtures/tone-2s.webm
scripts/lib/browser.js            临时配置的 Chrome / Edge + DevTools 管道
test/                             单测（并入根 vitest：npm test）
```
