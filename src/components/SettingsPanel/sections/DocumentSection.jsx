// src/components/SettingsPanel/sections/DocumentSection.jsx
// 文档翻译设置区块组件 - 从 SettingsPanel 拆分

import React from 'react';
import { Filter } from 'lucide-react';

/**
 * 文档翻译设置区块
 */
const DocumentSection = ({
  settings,
  updateSetting
}) => {
  // 更新过滤器设置的辅助函数
  const updateFilter = (key, value) => {
    updateSetting('document', 'filters', {
      ...settings.document?.filters,
      [key]: value
    });
  };

  return (
    <div className="setting-content">
      <h3>文档翻译设置</h3>
      <p className="setting-description">配置文档翻译的分段策略、过滤规则和显示样式</p>

      {/* 分段设置 */}
      <div className="setting-group">
        <label className="setting-label">分段设置</label>
        <div className="setting-row">
          <span>单段最大字符数</span>
          <input
            type="number"
            className="setting-input small"
            value={settings.document?.maxCharsPerSegment || 800}
            onChange={(e) => updateSetting('document', 'maxCharsPerSegment', parseInt(e.target.value) || 800)}
            min="200"
            max="2000"
            step="100"
          />
        </div>
        <p className="setting-hint">过长的段落会按此限制自动分割</p>
      </div>

      {/* 批量设置 */}
      <div className="setting-group">
        <label className="setting-label">批量翻译</label>
        <div className="setting-row">
          <span>每批最大 Tokens</span>
          <input
            type="number"
            className="setting-input small"
            value={settings.document?.batchMaxTokens || 2000}
            onChange={(e) => updateSetting('document', 'batchMaxTokens', parseInt(e.target.value) || 2000)}
            min="500"
            max="4000"
            step="500"
          />
        </div>
        <div className="setting-row">
          <span>每批最大段落数</span>
          <input
            type="number"
            className="setting-input small"
            value={settings.document?.batchMaxSegments || 5}
            onChange={(e) => updateSetting('document', 'batchMaxSegments', parseInt(e.target.value) || 5)}
            min="1"
            max="10"
          />
        </div>
        <p className="setting-hint">合并短段落可减少 API 调用次数</p>
      </div>

      {/* 过滤规则 */}
      <div className="setting-group">
        <label className="setting-label">
          <Filter size={16} /> 智能过滤
        </label>
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={settings.document?.filters?.skipShort ?? true}
            onChange={(e) => updateFilter('skipShort', e.target.checked)}
          />
          <span>跳过过短段落</span>
        </label>
        {settings.document?.filters?.skipShort && (
          <div className="setting-row sub-setting">
            <span>最小字符数</span>
            <input
              type="number"
              className="setting-input small"
              value={settings.document?.filters?.minLength || 10}
              onChange={(e) => updateFilter('minLength', parseInt(e.target.value) || 10)}
              min="1"
              max="50"
            />
          </div>
        )}
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={settings.document?.filters?.skipNumbers ?? true}
            onChange={(e) => updateFilter('skipNumbers', e.target.checked)}
          />
          <span>跳过纯数字段落（如页码）</span>
        </label>
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={settings.document?.filters?.skipCode ?? true}
            onChange={(e) => updateFilter('skipCode', e.target.checked)}
          />
          <span>保留代码块不翻译</span>
        </label>
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={settings.document?.filters?.skipTargetLang ?? true}
            onChange={(e) => updateFilter('skipTargetLang', e.target.checked)}
          />
          <span>跳过已是目标语言的段落</span>
        </label>
      </div>

      {/* 显示样式 */}
      <div className="setting-group">
        <label className="setting-label">默认显示样式</label>
        <select
          className="setting-select"
          value={settings.document?.displayStyle || 'below'}
          onChange={(e) => updateSetting('document', 'displayStyle', e.target.value)}
        >
          <option value="below">⬇️ 上下对照 - 译文显示在原文下方</option>
          <option value="side-by-side">⬛ 左右对照 - 原文和译文并排显示</option>
          <option value="source-only">📄 仅原文 - 隐藏译文</option>
          <option value="translated-only">🌐 仅译文 - 隐藏原文</option>
        </select>
      </div>

      {/* 支持格式 */}
      <div className="setting-group">
        <label className="setting-label">支持的文件格式</label>
        <div className="format-tags">
          <span className="format-tag">TXT</span>
          <span className="format-tag">MD</span>
          <span className="format-tag">SRT</span>
          <span className="format-tag">VTT</span>
          <span className="format-tag">PDF</span>
          <span className="format-tag">DOCX</span>
          <span className="format-tag">CSV</span>
          <span className="format-tag">JSON</span>
          <span className="format-tag">EPUB</span>
        </div>
        <p className="setting-hint">支持加密 PDF · 自动识别章节大纲 · 翻译记忆复用</p>
      </div>
    </div>
  );
};

export default DocumentSection;
