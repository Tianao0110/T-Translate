# SettingsPanel.jsx 代码审查报告

## 📋 审查摘要

| 类别 | 问题数 | 严重程度 |
|------|--------|----------|
| Bug | 1 | 🔴 高 |
| 未使用代码 | 9 | 🟡 中 |
| 逻辑优化 | 5 | 🟢 低 |
| 功能缺失 | 4 | 🟡 中 |

---

## 🔴 Bug (必须修复)

### 1. `setActiveTab` 函数不存在 (Line 1408)
```javascript
// 错误
onClick={() => setActiveTab('ocr')}

// 正确
onClick={() => handleSectionChange('ocr')}
```

---

## 🟡 未使用的导入 (可精简)

以下图标只在 import 语句中出现1次，从未使用：

| 图标 | 建议 |
|------|------|
| Database | 删除 |
| Volume2 | 删除 |
| Keyboard | 删除 |
| AlertCircle | 删除 |
| WifiOff | 删除 |
| FolderOpen | 删除 |
| Unlock | 删除 |
| HelpCircle | 删除 |
| ExternalLink | 删除 |
| ChevronRight | 删除 |
| Terminal | 删除 |
| Monitor | 删除 |

---

## 🟢 逻辑优化建议

### 1. navItems 应移到组件外部
```javascript
// 当前：每次渲染都重新创建数组
const navItems = [...];

// 优化：移到组件外部作为常量
const NAV_ITEMS = [...];
```

### 2. 使用 useMemo 优化过滤逻辑
```javascript
// 当前：每次渲染都重新计算
const filteredNavItems = searchQuery.trim() ? ... : navItems;
const groupedNavItems = filteredNavItems.reduce(...);

// 优化：使用 useMemo
const { filteredNavItems, groupedNavItems } = useMemo(() => {
  const filtered = searchQuery.trim() ? ... : NAV_ITEMS;
  const grouped = filtered.reduce(...);
  return { filteredNavItems: filtered, groupedNavItems: grouped };
}, [searchQuery]);
```

### 3. resetSettings 函数未完善
```javascript
// 当前：部分重置只显示提示
if (section) {
  notify(`${section} 设置已重置 (需重启生效)`, 'info');
}

// 建议：实现真正的部分重置逻辑
```

### 4. importSettings 缺少验证
```javascript
// 当前：直接使用导入的数据
const imported = JSON.parse(e.target.result);
setSettings(imported);

// 建议：添加结构验证
const imported = JSON.parse(e.target.result);
if (!validateSettingsStructure(imported)) {
  notify('设置文件格式不正确', 'error');
  return;
}
setSettings(prev => mergeDeep(prev, imported));
```

### 5. 隐私模式卡片代码重复
三个模式卡片代码相似度 90%+，可提取为组件。

---

## 🟡 功能连接检查

### ✅ 正常工作
- `testConnection()` 调用 `translationService.testConnection()`
- `saveSettings()` 同步到 `ocrManager` 和 `translationService`
- 划词翻译设置同步到主进程
- 玻璃窗口设置通过 IPC 通知

### ⚠️ 需要验证
1. `settings.connection.endpoint` 是否实际被 translationService 使用？
   - 当前：设置页面修改的是 settings.connection.endpoint
   - 但：testConnection 没有传入这个值

2. OCR 设置保存后是否立即生效？
   - 当前：调用 `ocrManager.updateConfigs()`
   - 需确认：ocrManager 是否正确响应

---

## 📝 建议新增功能

### 1. 未保存更改检测
```javascript
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
const [originalSettings, setOriginalSettings] = useState(null);

// 离开页面时提醒
useEffect(() => {
  const handleBeforeUnload = (e) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [hasUnsavedChanges]);
```

### 2. 设置导入版本兼容
```javascript
const SETTINGS_VERSION = '1.0';

const importSettings = (data) => {
  if (data._version !== SETTINGS_VERSION) {
    // 迁移旧版本设置
    data = migrateSettings(data);
  }
  setSettings(data);
};
```

### 3. 快捷键自定义界面
当前快捷键是硬编码的，建议添加自定义界面。

### 4. 设置实时预览
某些设置（如字体大小、主题）应该即时生效，无需保存。

---

## 🔧 修复优先级

1. **立即修复**: setActiveTab bug
2. **本次优化**: 清理未使用导入、navItems 外移
3. **后续迭代**: 未保存检测、版本兼容
