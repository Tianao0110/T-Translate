// src/components/SettingsPanel/sections/ConnectionSection.jsx
// 连接设置区块组件 - 从 SettingsPanel 拆分

import React from 'react';
import { Wifi, RefreshCw, Code2 } from 'lucide-react';

/**
 * LM Studio 连接设置区块
 */
const ConnectionSection = ({
  settings,
  updateSetting,
  connectionStatus,
  isTesting,
  testConnection,
  models
}) => {
  return (
    <div className="setting-content">
      <h3>LM Studio 连接设置</h3>
      
      {/* API 端点 */}
      <div className="setting-group">
        <label className="setting-label">API 端点</label>
        <div className="input-group">
          <input
            type="text"
            className="setting-input"
            value={settings.connection.endpoint}
            onChange={(e) => updateSetting('connection', 'endpoint', e.target.value)}
            placeholder="http://localhost:1234/v1"
          />
          <button 
            className={`test-button ${connectionStatus}`} 
            onClick={testConnection} 
            disabled={isTesting}
          >
            {isTesting ? (
              <RefreshCw size={16} className="animate-spin"/>
            ) : (
              <Wifi size={16}/>
            )}
            {isTesting ? '测试中...' : '测试连接'}
          </button>
        </div>
      </div>
      
      {/* 超时时间 */}
      <div className="setting-group">
        <label className="setting-label">超时时间 (ms)</label>
        <input 
          type="number" 
          className="setting-input" 
          value={settings.connection.timeout} 
          onChange={(e) => updateSetting('connection', 'timeout', parseInt(e.target.value))} 
          step="1000"
        />
      </div>
      
      {/* 可用模型列表 */}
      {models.length > 0 && (
        <div className="setting-group">
          <label className="setting-label">可用模型</label>
          <div className="models-list">
            {models.map((m, i) => (
              <div key={i} className="model-item">
                <Code2 size={14}/>
                <span>{m.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectionSection;
