# T-Translate

基于 Electron + React + Vite 的离线翻译工具。

## ✨ 功能特性

- 🔤 **划词翻译** - 选中文字自动弹出翻译（支持最多 8 个冻结窗口）
- 📸 **截图翻译** - 截取屏幕区域进行 OCR + 翻译
- 🪟 **玻璃窗口** - 透明悬浮窗实时翻译
- 🎬 **字幕采集** - 实时采集屏幕区域字幕并翻译
- 🔒 **隐私模式** - 支持标准/离线/无痕/严格四种模式
- 🤖 **多翻译源** - 本地 LLM、OpenAI、DeepL、Gemini、DeepSeek、Google 翻译

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm start

# 构建生产版本
npm run build

# 打包安装程序
npm run dist
```

## 📁 项目结构

```
t-translate/
├── electron/           # 主进程代码
│   ├── main.js         # 主进程入口
│   ├── preloads/       # Preload 脚本
│   ├── shared/         # 共享常量和配置
│   ├── ipc/            # IPC 处理器
│   ├── managers/       # 窗口/托盘/菜单管理器
│   └── utils/          # 工具函数
│
├── src/                # 渲染进程代码
│   ├── components/     # React 组件
│   ├── providers/      # 翻译源 Provider
│   ├── services/       # 服务层
│   ├── stores/         # Zustand 状态管理
│   └── config/         # 前端配置
│
├── public/             # HTML 入口 + 静态资源
├── resources/          # 应用资源 (OCR 训练数据)
├── scripts/            # 工具脚本
└── docs/               # 项目文档
```

## 📚 文档

详细文档请查看 `docs/` 目录：

- [架构设计](docs/ARCHITECTURE.md) - 项目架构和分层设计
- [重构计划](docs/REFACTOR_PLAN.md) - 目录结构重构详情
- [文件结构](docs/FILE_STRUCTURE_PLAN.md) - 文件组织规范
- [开发指南](docs/DEVELOPMENT.md) - 开发环境配置和流程
- [功能说明](docs/FEATURES.md) - 功能特性详解
- [划词翻译技术](docs/SELECTION_TRANSLATOR_TECH.md) - 划词翻译实现原理

## 🔧 开发命令

```bash
npm start              # 启动开发环境
npm run build          # 构建生产版本
npm run dist           # 打包安装程序
npm run check:constants # 检查常量同步状态
```

## 🏗️ 技术栈

- **框架**: Electron 28 + React 18
- **构建**: Vite 5
- **状态管理**: Zustand
- **样式**: CSS Modules
- **OCR**: Tesseract.js / LLM Vision
- **本地 LLM**: LM Studio 兼容 API

## 📄 许可证

MIT License

---

**版本**: v0.1.3  
**最后更新**: 2025-01-17
