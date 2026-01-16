# 配置中心化 (Config Centralization)

## 架构

```
源头层 (Source)          桥接层 (Bridge)          消费层 (Consumer)
electron/shared/         src/config/              src/components/
├── constants.js    →    defaults.js         →   ├── stores/
├── channels.js                                  ├── services/
└── index.js                                     └── components/
```

## 修改的文件

### 1. 源头层 - electron/shared/
- `constants.js` - 所有常量的唯一定义
  - PRIVACY_MODES, THEMES, OCR_ENGINES
  - TEMPLATE_KEYS, TRANSLATION_STATUS
  - LANGUAGE_CODES, DEFAULTS, PROVIDER_IDS
- `channels.js` - IPC 通道常量（引用 constants.js）
- `index.js` - 统一导出入口

### 2. 桥接层 - src/config/
- `defaults.js` - ESM 包装，重新导出给前端
- `privacy-modes.js` - 隐私模式详细配置（使用常量 ID）

### 3. 消费层 - src/
- `stores/translation-store.js` - 使用常量替代硬编码
- `stores/config.js` - 使用常量替代硬编码
- `services/translation.js` - 使用常量替代硬编码
- `services/main-translation.js` - 使用常量替代硬编码
- `components/SelectionTranslator/index.jsx` - 使用常量替代硬编码
- `components/SettingsPanel/constants.js` - 从 privacy-modes.js 导入

### 4. Vite 配置
- `vite.config.js` - 添加 `server.fs.allow: ['..']`

## 安装

```bash
# 覆盖文件
cp -r config-centralization/* ./

# 或逐个复制
cp -r config-centralization/electron/shared/* electron/shared/
cp -r config-centralization/src/config/* src/config/
cp -r config-centralization/src/stores/* src/stores/
cp -r config-centralization/src/services/* src/services/
cp config-centralization/src/components/SelectionTranslator/index.jsx src/components/SelectionTranslator/
cp config-centralization/src/components/SettingsPanel/constants.js src/components/SettingsPanel/
cp config-centralization/vite.config.js ./
```

## 使用示例

### 主进程 (Electron)
```javascript
const { CHANNELS, PRIVACY_MODES } = require('./shared');

ipcMain.handle(CHANNELS.SELECTION.TOGGLE, () => { ... });
```

### 前端 (React)
```javascript
import { PRIVACY_MODES, THEMES, DEFAULTS } from '@config/defaults';

const [theme, setTheme] = useState(THEMES.LIGHT);
const [mode, setMode] = useState(PRIVACY_MODES.STANDARD);
```

## 原则

1. **单一定义**: 所有常量只在 `electron/shared/constants.js` 定义一次
2. **桥接隔离**: 前端不直接导入 `electron/shared`，通过 `src/config/defaults.js` 中转
3. **向后兼容**: 保留原有导出，渐进迁移
