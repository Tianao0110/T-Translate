# OCR 模型与语言包维护手册

本地 OCR 自 v0.2.8-OCR 起基于 [esearch-ocr](https://github.com/xushengfeng/eSearch-OCR)（Apache-2.0）+ onnxruntime-node 运行 PaddleOCR 系列 ONNX 模型。模型不进 git 仓库、不进 npm 包，按三条路径分发：

| 路径 | 内容 | 何时使用 |
| --- | --- | --- |
| 安装包内置 | 基础包 base-v6（det + 简繁英日及 46 拉丁语系 rec + 字典，下载 ~25MB / 落盘 ~31MB） | 随安装包分发，开箱即用 |
| 应用内下载 | 语言包（韩/西里尔/天城文/阿拉伯，各 ~8MB；拉丁包已被 base-v6 吸收退役） | 用户在 设置 → OCR → 语言包 按需下载 |
| 应用内修复 | 基础包重新下载到 userData | 内置模型损坏 / 缺失时 |

## 运行时目录

- 内置基础包：`<resources>/resources/ocr/base/`（打包产物；开发时为 `resources/ocr/base/`，gitignored）
- 下载的包：`%APPDATA%/t-translate/ocr-models/<packId>/`，每包一个目录 = 模型文件 + `pack.json`
- 解析顺序：userData 副本 > 内置副本（基础包）；语言包只存在于 userData
- 卸载语言包 = 整目录删除，不留任何文件

## GitHub `ocr-models` Release（语言包分发源）

应用启动「刷新」语言包列表时，从固定 URL 拉取清单：

```
https://github.com/Tianao0110/T-Translate/releases/download/ocr-models/manifest.json
```

### 首次发布（一次性）

```bash
npm run ocr:release        # 生成 release-ocr-models/（7 个 zip + manifest.json）
```

1. GitHub → Releases → Draft a new release，tag 填 `ocr-models`（不要带 v 前缀）
2. **勾选 "Set as a pre-release"** —— 防止 electron-updater 把它当成应用最新版
3. 上传 `release-ocr-models/` 里的全部 8 个文件，发布

> **新旧双轨**：manifest 同时携带 `LEGACY_PACKS`（base-v5 + latin）服务 v6 换代前的老客户端——它们的基础包修复按 id `base-v5` 取包、法德西仍映射拉丁包，且其引擎对 gen≠'v5' 会开空格启发式，**绝不能收到 v6 模型**。旧资产（ppocr_v5_mobile.zip / latin.zip）永远保留在 Release 上，legacy 条目不 bump 版本。新客户端在 `computePackList` 里自动跳过异代 base 与被吸收的语言包。

### 日后更新模型（无需发应用新版）

1. 在 [scripts/ocr-model-sources.js](../scripts/ocr-model-sources.js) 更新对应包的 `url`（新模型来源）并 **bump `version`**
2. `npm run ocr:release` 重新生成
3. 到 `ocr-models` Release 页 **删除旧资产、上传新 zip + 新 manifest.json**（tag 不变）
4. 用户端点「刷新」即看到「可更新」徽章，点更新完成升级；应用代码零改动

新增语言包同理：在 `ocr-model-sources.js` 的 `LANG_PACKS` 加条目 + 在 `electron/shared/ocr-packs.js` 的 `LANGUAGE_TO_PACK` 加语言映射 + 设置页语言下拉、`ocr.packs.names.*` 文案补齐（这一步需要发版）。

## manifest.json 协议（schemaVersion 1）

```jsonc
{
  "schemaVersion": 1,          // 不兼容变更时 +1；旧客户端会拒绝过新的 schema
  "updatedAt": "2026-06-10",
  "baseUrl": "https://github.com/<owner>/<repo>/releases/download/ocr-models",
  "packs": [{
    "id": "korean",            // 唯一 id，= 安装目录名
    "type": "lang",            // base | lang
    "gen": "v4",               // 模型代际；引擎仅对 v3/v4 开空格启发式（v5+ 原生识别空格）
    "version": "1.0.0",        // 与本地 pack.json 比较以提示更新
    "file": "korean.zip",      // 资产文件名（与 baseUrl 拼接；也可用 url 字段覆写）
    "size": 8952561,           // 字节，用于进度估算
    "sha256": "…",             // 下载后强校验，不匹配即拒装
    "languages": ["ko"],       // 此包解锁的识别语言
    "files": { "rec": "korean_rec.onnx", "dict": "korean_dict.txt" }  // zip 内文件名
  }]
}
```

下载流程（[electron/utils/ocr-pack-manager.js](../electron/utils/ocr-pack-manager.js)）：下载 → sha256 校验 → 解压到 `.staging-<id>` → 写 pack.json → 原子换入正式目录。任一步失败即清掉 staging，不留半成品。

## 开发环境

clone 之后跑一次（`npm run build` / `npm run dist` 会自动执行）：

```bash
npm run ocr:models      # 拉基础模型到 resources/ocr/base
```

本地端到端回归 probe（gitignored，temp/ocr-probe/）：

```bash
npx electron temp/ocr-probe/probe.js          # 引擎识别：中/英/日 + 语言包安装与回退
npx electron temp/ocr-probe/probe-packs.js    # 包管理：下载/校验拒绝/卸载零残留
npx electron temp/ocr-probe/probe-ipc.js      # IPC 注册完整性 + 健康检查
```

测试清单 URL 可用环境变量覆写：`TT_OCR_MANIFEST_URL=file:///path/to/manifest.json`。

## 已知边界

- 剩余四个语言包（韩/西里尔/天城/阿拉伯）rec 模型仍为 PP-OCRv4 代际——PP-OCRv6 是单模型 50 语言（简繁中/英/日 + 46 拉丁），**没有独立多语言模型**，这四种文字不在其覆盖内；上游出新代多语言 ONNX 后按「更新模型」流程换入
- v6 基础模型三档中本项目用 small（官方定位 mobile/desktop）；medium（落盘 139MB，清晰截图输出与 small 一致、速度约 2 倍慢）可做未来"高精度包"可选下载，tiny 无假名不可用（见 TODOS）
- **旁遮普语（Punjabi/古木基文 Gurmukhi）无法支持**：已核对 PP-OCRv5 全部 11 个多语言模型的语种表（2026-06），PaddleOCR 系没有 Gurmukhi 模型，做不成语言包。巴基斯坦写法（Shahmukhi，阿拉伯字母系）与 arabic 包覆盖的乌尔都文接近、可能部分可用但非官方支持；印度写法只能走在线引擎（Google Vision 支持 pa）或 LLM Vision。上游若新增 Gurmukhi 模型，按「新增语言包」流程接入
- 引擎未接角度分类器（doc_cls）：整图旋转 / 倒置文本不纠正；v5 基础模型自带竖排识别，截图场景足够
- Windows OCR 引擎走系统语言包（设置 → 时间和语言 → 语言 安装），与本仓库模型体系无关
