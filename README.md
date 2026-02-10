# T-Translate

<p align="center">
  <img src="public/icon.png" width="128" height="128" alt="T-Translate Logo">
</p>

<p align="center">
  <strong>智能离线翻译工具</strong><br>
  基于 Electron + React + Vite 构建，支持本地 LLM 翻译
</p>

---

## ✨ 功能特性

### 🔤 划词翻译
- 选中任意文字自动弹出翻译窗口
- 支持最多 8 个冻结窗口同时显示
- 智能检测源语言

### 📸 截图 OCR 翻译
- 截取屏幕区域进行文字识别
- 支持多种 OCR 引擎 (RapidOCR、Windows OCR、LLM Vision)
- 识别后自动翻译

### 🪟 玻璃窗口
- 透明悬浮窗实时翻译
- 支持拖拽、缩放、置顶
- 可创建多个独立子面板

### 📄 文档翻译
- 支持 PDF、DOCX、EPUB、TXT 格式
- 保持原文档结构
- 批量翻译导出

### 🔊 TTS 朗读
- 翻译结果语音朗读
- 支持多种语音引擎
- 可调节语速

### 🔒 隐私模式
| 模式 | 历史记录 | 缓存 | 云端翻译 |
|------|:--------:|:----:|:--------:|
| 标准模式 | ✅ | ✅ | ✅ |
| 离线模式 | ✅ | ✅ | ❌ |
| 无痕模式 | ❌ | ❌ | ✅ |
| 严格模式 | ❌ | ❌ | ❌ |

### 🤖 多翻译源
- **本地 LLM**: LM Studio / Ollama (完全离线)
- **OpenAI**: GPT-4 / GPT-3.5
- **DeepL**: 高质量翻译
- **Gemini**: Google AI
- **DeepSeek**: 国产大模型
- **Google 翻译**: 快速翻译

---

## 🚀 快速开始

### 下载安装

从 [Releases](https://github.com/Tianao0110/T-Translate/releases) 页面下载最新版本：

- **Windows**: `T-Translate-Setup-x.x.x.exe`

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/Tianao0110/T-Translate.git
cd T-Translate

# 安装依赖
npm install

# 开发模式
npm start

# 构建生产版本
npm run build

# 打包安装程序
npm run dist
```

---

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+T` | 显示/隐藏主窗口 |
| `Ctrl+Shift+S` | 截图翻译 |
| `Ctrl+Shift+G` | 打开玻璃窗口 |
| `Ctrl+Shift+D` | 开启/关闭划词翻译 |
| `Ctrl+Enter` | 执行翻译 |
| `Ctrl+Shift+C` | 复制翻译结果 |

*快捷键可在设置中自定义*

---

## 📁 项目结构

```
t-translate/
├── electron/               # 主进程代码
│   ├── main.js             # 主进程入口
│   ├── preloads/           # Preload 脚本
│   ├── shared/             # 共享常量和配置
│   ├── ipc/                # IPC 处理器
│   ├── managers/           # 窗口/托盘/菜单管理器
│   └── utils/              # 工具函数
│
├── src/                    # 渲染进程代码
│   ├── components/         # React 组件 (PascalCase)
│   ├── providers/          # 翻译源 Provider (kebab-case)
│   ├── services/           # 服务层 (含 tts/ 子目录)
│   ├── stores/             # Zustand 状态管理
│   ├── config/             # 前端配置
│   ├── i18n/               # 语言包 (zh, en)
│   ├── utils/              # 工具函数
│   ├── styles/             # 全局样式
│   ├── windows/            # 子窗口入口
│   └── workers/            # Web Workers
│
├── public/                 # HTML 入口 + 静态资源
├── resources/              # 应用资源 (OCR 训练数据)
├── tests/                  # 单元测试
├── scripts/                # 工具脚本
└── docs/                   # 项目文档
```

---

## 📚 文档

详细文档请查看 `docs/` 目录：

| 文档 | 说明 |
|------|------|
| [架构设计](docs/ARCHITECTURE.md) | 项目架构和分层设计 |
| [开发指南](docs/DEVELOPMENT.md) | 自定义翻译源和 OCR 引擎开发 |
| [功能说明](docs/FEATURES.md) | 功能特性详解 |
| [划词翻译技术](docs/SELECTION_TRANSLATOR_TECH.md) | 划词翻译实现原理 |
| [主题定制](docs/THEME_CUSTOMIZATION.md) | 主题和样式定制 |
| [TTS 开发](docs/TTS_DEVELOPMENT.md) | 语音朗读功能开发 |
| [国际化指南](docs/I18N_GUIDE.md) | 多语言开发指南 |

---

## 🏗️ 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Electron 28 + React 18 |
| 构建 | Vite 5 |
| 状态管理 | Zustand |
| 样式 | CSS Variables + CSS Modules |
| OCR | @gutenye/ocr-node (RapidOCR) / Windows OCR / LLM Vision |
| 本地 LLM | LM Studio / Ollama 兼容 API |
| 打包 | electron-builder |

---

## 🔧 开发命令

```bash
npm start              # 启动开发环境
npm run build          # 构建生产版本
npm run dist           # 打包安装程序
npm run check:constants # 检查常量同步状态
```

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

## 🙏 致谢

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [LM Studio](https://lmstudio.ai/)
- [RapidOCR](https://github.com/RapidAI/RapidOCR)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/Tianao0110">Tianao</a>
</p>

<p align="center">
  <strong>版本</strong>: v0.2.0 &nbsp;|&nbsp; <strong>更新日期</strong>: 2026-02-09
</p>
