# T-Caption

T-Translate 的浏览器插件：给网页视频显示字幕，识别和翻译都由本机的 T-Translate 完成。设计与分期见 `docs/design/listen.md` §11（桌面侧通道）与仓库外的立项档案。

当前状态：S0 —— 只有通道客户端与协议常量，还不能装进浏览器。

```
src/shared/protocol.js            协议常量、端口范围、NDJSON 切行、退避、分批
src/offscreen/companion-client.js 配对、hello、翻译、识别会话、事件流、系统听译兜底
test/                             单测（并入根 vitest：npm test）
scripts/e2e-client.js             端到端：真实通道 + 真实引擎（npm run smoke:caption-client -- --packs <已装听译包目录>）
```

构建与打包随后续分期加入（esbuild 六入口 → `dist/`，`dist/` 不入库）。
