// src/components/SettingsPanel/sections/SelectionSection.jsx
// 划词翻译设置区块组件

import React from 'react';
import createLogger from '../../../utils/logger.js';

const logger = createLogger('Settings:Selection');

/**
 * 划词翻译设置区块
 */
const SelectionSection = ({
  settings,
  updateSetting,
  notify
}) => {
  // 切换划词翻译开关
  const handleToggleSelection = async () => {
    try {
      const newState = await window.electron?.selection?.toggle?.();
      logger.debug('Selection toggle result:', newState);
      if (typeof newState === 'boolean') {
        updateSetting('selection', 'enabled', newState);
        notify(newState ? '划词翻译已开启' : '划词翻译已关闭', 'success');
      }
    } catch (e) {
      logger.error('Selection toggle error:', e);
      notify('切换划词翻译失败', 'error');
    }
  };

  return (
    <div className="setting-content">
      <h3>划词翻译设置</h3>
      <p className="setting-description">选中文字后显示翻译按钮，点击即可翻译</p>
      
      {/* 启用/禁用 */}
      <div className="setting-group">
        <label className="setting-label">启用划词翻译</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${settings.selection.enabled ? 'active' : ''}`}
            onClick={handleToggleSelection}
          >
            {settings.selection.enabled ? '开启' : '关闭'}
          </button>
          <span className="toggle-description">
            {settings.selection.enabled ? '选中文字后显示翻译按钮' : '已禁用划词翻译'}
          </span>
        </div>
        <p className="setting-hint">
          也可以使用快捷键 {settings.shortcuts?.selectionTranslate || 'Ctrl+Shift+T'} 快速切换
        </p>
      </div>

      {/* 按钮自动消失时间 */}
      <div className="setting-group">
        <label className="setting-label">按钮自动消失时间</label>
        <div className="setting-row">
          <input
            type="range"
            className="setting-range"
            min="2000"
            max="10000"
            step="1000"
            value={settings.selection.triggerTimeout}
            onChange={(e) => updateSetting('selection', 'triggerTimeout', parseInt(e.target.value))}
          />
          <span className="range-value">{settings.selection.triggerTimeout / 1000}秒</span>
        </div>
        <p className="setting-hint">划词后翻译按钮自动消失的时间</p>
      </div>

      {/* 默认显示原文 */}
      <div className="setting-group">
        <label className="setting-label">默认显示原文</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${settings.selection.showSourceByDefault ? 'active' : ''}`}
            onClick={() => updateSetting('selection', 'showSourceByDefault', !settings.selection.showSourceByDefault)}
          >
            {settings.selection.showSourceByDefault ? '开启' : '关闭'}
          </button>
          <span className="toggle-description">
            {settings.selection.showSourceByDefault ? '翻译结果默认显示原文对照' : '只显示翻译结果'}
          </span>
        </div>
      </div>

      {/* 复制后自动关闭 */}
      <div className="setting-group">
        <label className="setting-label">复制后自动关闭</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${settings.selection.autoCloseOnCopy ? 'active' : ''}`}
            onClick={() => updateSetting('selection', 'autoCloseOnCopy', !settings.selection.autoCloseOnCopy)}
          >
            {settings.selection.autoCloseOnCopy ? '开启' : '关闭'}
          </button>
          <span className="toggle-description">
            {settings.selection.autoCloseOnCopy ? '点击复制后自动关闭翻译窗口' : '复制后保持窗口打开'}
          </span>
        </div>
      </div>

      {/* 窗口透明度 */}
      <div className="setting-group">
        <label className="setting-label">窗口透明度</label>
        <div className="setting-row">
          <input
            type="range"
            className="setting-range"
            min="60"
            max="100"
            value={settings.selection.windowOpacity || 95}
            onChange={(e) => updateSetting('selection', 'windowOpacity', parseInt(e.target.value))}
          />
          <span className="range-value">{settings.selection.windowOpacity || 95}%</span>
        </div>
        <p className="setting-hint">调整划词翻译窗口的透明度</p>
      </div>

      {/* 字符数限制 */}
      <div className="setting-group">
        <label className="setting-label">字符数限制</label>
        <div className="setting-row double">
          <div className="input-with-label">
            <label>最小</label>
            <input
              type="number"
              className="setting-input small"
              value={settings.selection.minChars}
              onChange={(e) => updateSetting('selection', 'minChars', parseInt(e.target.value) || 2)}
              min="1"
              max="10"
            />
          </div>
          <div className="input-with-label">
            <label>最大</label>
            <input
              type="number"
              className="setting-input small"
              value={settings.selection.maxChars}
              onChange={(e) => updateSetting('selection', 'maxChars', parseInt(e.target.value) || 500)}
              min="50"
              max="2000"
            />
          </div>
        </div>
        <p className="setting-hint">少于最小或超过最大字符数的选中内容不会触发翻译</p>
      </div>

      {/* 使用说明 */}
      <div className="setting-group">
        <label className="setting-label">使用说明</label>
        <div className="help-box">
          <p><strong>划词翻译流程：</strong></p>
          <ol>
            <li>用鼠标选中需要翻译的文字</li>
            <li>松开鼠标后，旁边出现翻译按钮</li>
            <li>点击按钮开始翻译</li>
            <li>翻译完成后显示结果卡片</li>
          </ol>
          <p style={{marginTop: '8px'}}><strong>快捷操作：</strong></p>
          <ul>
            <li>拖动标题栏移动窗口</li>
            <li>右下角调整大小</li>
            <li>点击「原文」显示原文对照</li>
            <li>点击「复制」或直接选中文字复制</li>
            <li>按 ESC 或右键关闭</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SelectionSection;
