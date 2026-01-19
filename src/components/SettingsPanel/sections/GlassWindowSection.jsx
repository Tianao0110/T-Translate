// src/components/SettingsPanel/sections/GlassWindowSection.jsx
// 玻璃窗口设置区块组件 - 从 SettingsPanel 拆分

import React from 'react';

/**
 * 玻璃窗口设置区块
 */
const GlassWindowSection = ({
  settings,
  updateSetting,
  handleSectionChange
}) => {
  // 获取 OCR 引擎显示名称
  const getOcrEngineName = (engine) => {
    const names = {
      'llm-vision': 'LLM Vision',
      'windows-ocr': 'Windows OCR',
      'paddle-ocr': 'PaddleOCR',
      'rapid-ocr': 'RapidOCR',
    };
    return names[engine] || engine;
  };

  return (
    <div className="setting-content">
      <h3>翻译玻璃窗设置</h3>
      <p className="setting-description">配置悬浮翻译窗口的行为和外观</p>
      
      {/* 锁定目标语言 */}
      <div className="setting-group">
        <label className="setting-label">锁定目标语言</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${settings.glassWindow.lockTargetLang ? 'active' : ''}`}
            onClick={() => updateSetting('glassWindow', 'lockTargetLang', !settings.glassWindow.lockTargetLang)}
          >
            {settings.glassWindow.lockTargetLang ? '开启' : '关闭'}
          </button>
          <span className="toggle-description">
            {settings.glassWindow.lockTargetLang ? '始终翻译成目标语言' : '根据原文自动切换（可能导致回译）'}
          </span>
        </div>
        <p className="setting-hint">建议开启，避免中英文来回切换</p>
      </div>

      {/* 智能检测 */}
      <div className="setting-group">
        <label className="setting-label">智能检测</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${settings.glassWindow.smartDetect ? 'active' : ''}`}
            onClick={() => updateSetting('glassWindow', 'smartDetect', !settings.glassWindow.smartDetect)}
          >
            {settings.glassWindow.smartDetect ? '开启' : '关闭'}
          </button>
          <span className="toggle-description">
            {settings.glassWindow.smartDetect ? '自动跳过未变化的内容' : '每次都重新识别翻译'}
          </span>
        </div>
      </div>

      {/* OCR 引擎 */}
      <div className="setting-group">
        <label className="setting-label">OCR 引擎</label>
        <div className="setting-hint-inline">
          使用全局 OCR 设置（当前：{getOcrEngineName(settings.ocr.engine)}）
          <button 
            className="link-button"
            onClick={() => handleSectionChange('ocr')}
            style={{marginLeft: '8px'}}
          >
            前往设置 →
          </button>
        </div>
      </div>

      {/* 默认透明度 */}
      <div className="setting-group">
        <label className="setting-label">默认透明度</label>
        <div className="setting-row">
          <input
            type="range"
            className="setting-range"
            min="30"
            max="100"
            value={Math.round(settings.glassWindow.defaultOpacity * 100)}
            onChange={(e) => updateSetting('glassWindow', 'defaultOpacity', parseInt(e.target.value) / 100)}
          />
          <span className="range-value">{Math.round(settings.glassWindow.defaultOpacity * 100)}%</span>
        </div>
        <p className="setting-hint">在玻璃窗中点击小横条可实时调节</p>
      </div>

      {/* 窗口选项 */}
      <div className="setting-group">
        <label className="setting-label">窗口选项</label>
        <div className="checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.glassWindow.rememberPosition}
              onChange={(e) => updateSetting('glassWindow', 'rememberPosition', e.target.checked)}
            />
            <span>记住窗口位置</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.glassWindow.autoPin}
              onChange={(e) => updateSetting('glassWindow', 'autoPin', e.target.checked)}
            />
            <span>默认置顶显示</span>
          </label>
        </div>
      </div>

      {/* 快捷键 */}
      <div className="setting-group">
        <label className="setting-label">快捷键</label>
        <div className="shortcut-info">
          <div className="shortcut-item">
            <kbd>Ctrl+Alt+G</kbd>
            <span>打开/关闭玻璃窗口</span>
          </div>
          <div className="shortcut-item">
            <kbd>Space</kbd>
            <span>手动截图识别</span>
          </div>
          <div className="shortcut-item">
            <kbd>Esc</kbd>
            <span>退出字幕模式/关闭窗口</span>
          </div>
        </div>
      </div>

      {/* 使用说明 */}
      <div className="setting-group">
        <label className="setting-label">使用说明</label>
        <div className="info-box">
          <p><strong>普通模式：</strong>点击 📷 截图识别当前区域</p>
          <p><strong>字幕模式：</strong>点击 🎬 开启实时字幕翻译</p>
          <p><strong>首次使用字幕模式：</strong>需要先框选视频原字幕区域</p>
        </div>
      </div>
    </div>
  );
};

export default GlassWindowSection;
