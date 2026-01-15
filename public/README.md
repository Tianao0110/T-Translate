# 应用图标配置指南

## 📁 需要准备的文件

请将以下图标文件放在 `/public` 目录下：

| 文件名 | 尺寸 | 用途 | 必需 |
|--------|------|------|:----:|
| `icon.png` | 512x512 或 1024x1024 | 主图标（通用） | ✅ |
| `icon.ico` | 256x256 (多尺寸) | Windows 应用图标 | ✅ |
| `icon.icns` | 512x512 | macOS 应用图标 | macOS |
| `tray-icon.png` | 16x16 或 32x32 | 系统托盘图标 | 可选 |
| `tray-icon@2x.png` | 32x32 或 64x64 | 高分屏托盘图标 | 可选 |

## 🛠️ 图标生成工具

### 方法1：在线工具（推荐）
1. **IconKitchen**: https://icon.kitchen/
2. **CloudConvert**: https://cloudconvert.com/png-to-ico
3. **iConvert Icons**: https://iconverticons.com/online/

### 方法2：命令行工具

```bash
# 安装 ImageMagick
# Windows: choco install imagemagick
# macOS: brew install imagemagick
# Linux: sudo apt install imagemagick

# PNG → ICO (Windows)
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# PNG → ICNS (macOS)
# 需要先创建 iconset 文件夹
mkdir icon.iconset
sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
```

## 📝 快速开始

最简单的方式：

1. 准备一个 **512x512** 或更大的 PNG 图标
2. 命名为 `icon.png` 放在 `/public` 目录
3. 使用在线工具转换为 `icon.ico`
4. 运行 `npm run dev` 测试

## ✅ 检查清单

- [ ] `/public/icon.png` - 主图标
- [ ] `/public/icon.ico` - Windows 图标
- [ ] 图标背景透明或纯色
- [ ] 图标在小尺寸下仍然清晰可辨
