// src/components/SettingsPanel/sections/TranslationSection.jsx
// 翻译设置区块组件 - 从 SettingsPanel 拆分

import React from 'react';
import { Trash2 } from 'lucide-react';

/**
 * 翻译设置区块
 */
const TranslationSection = ({
  settings,
  updateSetting,
  notify,
  // Store 状态
  autoTranslate,
  setAutoTranslate,
  autoTranslateDelay,
  setAutoTranslateDelay,
  useStreamOutput,
  setUseStreamOutput
}) => {
  // 清除缓存
  const handleClearCache = () => {
    if (window.confirm('确定要清除翻译缓存吗？')) {
      localStorage.removeItem('translation-cache');
      notify('缓存已清除', 'success');
    }
  };

  return (
    <div className="setting-content">
      <h3>翻译设置</h3>
      <p className="setting-description">配置翻译行为和输出方式</p>
      
      {/* 自动翻译 */}
      <div className="setting-group">
        <label className="setting-switch">
          <input 
            type="checkbox" 
            checked={autoTranslate} 
            onChange={(e) => setAutoTranslate(e.target.checked)} 
          />
          <span className="switch-slider"></span>
          <span className="switch-label">自动翻译</span>
        </label>
        <p className="setting-hint">输入停止后自动开始翻译</p>
      </div>
      
      {/* 自动翻译延迟 - 只在开启自动翻译时显示 */}
      {autoTranslate && (
        <div className="setting-group">
          <label className="setting-label">自动翻译延迟: {autoTranslateDelay}ms</label>
          <input 
            type="range" 
            className="setting-range" 
            min="300" 
            max="2000" 
            step="100"
            value={autoTranslateDelay} 
            onChange={(e) => setAutoTranslateDelay(parseInt(e.target.value))} 
          />
          <p className="setting-hint">停止输入后等待多久开始翻译</p>
        </div>
      )}
      
      {/* 流式输出 */}
      <div className="setting-group">
        <label className="setting-switch">
          <input 
            type="checkbox" 
            checked={useStreamOutput} 
            onChange={(e) => setUseStreamOutput(e.target.checked)} 
          />
          <span className="switch-slider"></span>
          <span className="switch-label">流式输出（打字机效果）</span>
        </label>
        <p className="setting-hint">开启后翻译结果将逐字显示</p>
      </div>
      
      {/* 缓存管理 */}
      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <h4 style={{marginBottom: '12px', color: 'var(--text-secondary)'}}>翻译缓存</h4>
        <p className="setting-hint" style={{marginBottom: '12px'}}>
          缓存已翻译的内容，相同文本再次翻译时直接返回结果
        </p>
        <button className="danger-button" onClick={handleClearCache}>
          <Trash2 size={16} /> 清除缓存
        </button>
      </div>
    </div>
  );
};

export default TranslationSection;
