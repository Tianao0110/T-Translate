// src/components/HistoryPanel.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Clock, Search, Filter, Download, Upload, Trash2, Copy, Star, StarOff,
  Calendar, ChevronDown, ChevronRight, MoreVertical, FileText, Globe,
  BarChart3, TrendingUp, X, Check, AlertCircle, RefreshCw, Edit3
} from 'lucide-react';
import useTranslationStore from '../stores/translation-store';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import '../styles/components/HistoryPanel.css'; 

// 配置 dayjs
dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

/**
 * 历史记录面板组件
 */
const HistoryPanel = ({ searchQuery = '', filterOptions = {}, showNotification }) => {
  const notify = showNotification || ((msg, type) => console.log(`[${type}] ${msg}`));

  // 默认使用网格视图
  const [viewMode, setViewMode] = useState('grid');
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [groupBy, setGroupBy] = useState('date');
  const [showStats, setShowStats] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [dateRange, setDateRange] = useState('all');
  
  // Store
  const {
    history,
    favorites,
    clearHistory,
    restoreFromHistory,
    addToFavorites,
    removeFromFavorites,
    removeFromHistory, // 确保从 Store 解构此方法
    exportHistory,
    importHistory,
    getStatistics
  } = useTranslationStore();

  const statistics = useMemo(() => getStatistics(), [history, getStatistics]);

  // 过滤和排序
  const filteredHistory = useMemo(() => {
    if (!Array.isArray(history)) return [];
    
    let filtered = [...history];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        (item.sourceText || '').toLowerCase().includes(query) ||
        (item.translatedText || '').toLowerCase().includes(query)
      );
    }

    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    const week = now - 7 * 24 * 60 * 60 * 1000;
    const month = now - 30 * 24 * 60 * 60 * 1000;

    switch (dateRange) {
      case 'today': filtered = filtered.filter(item => item.timestamp >= today); break;
      case 'week': filtered = filtered.filter(item => item.timestamp >= week); break;
      case 'month': filtered = filtered.filter(item => item.timestamp >= month); break;
      default: break;
    }

    if (filterOptions.language && filterOptions.language !== 'all') {
      filtered = filtered.filter(item =>
        item.sourceLanguage === filterOptions.language ||
        item.targetLanguage === filterOptions.language
      );
    }

    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'date': comparison = (a.timestamp || 0) - (b.timestamp || 0); break;
        case 'length': comparison = (a.sourceText?.length || 0) - (b.sourceText?.length || 0); break;
        default: break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [history, searchQuery, dateRange, filterOptions, sortBy, sortOrder]);

  // 分组
  const groupedHistory = useMemo(() => {
    if (groupBy === 'none') return [{ title: '所有记录', items: filteredHistory }];

    const groups = {};
    filteredHistory.forEach(item => {
      let key = '其他';
      if (groupBy === 'date') {
        const date = dayjs(item.timestamp);
        const today = dayjs();
        if (date.isSame(today, 'day')) key = '今天';
        else key = date.format('YYYY-MM-DD');
      } else if (groupBy === 'language') {
        key = `${item.sourceLanguage} → ${item.targetLanguage}`;
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    return Object.entries(groups).map(([title, items]) => ({ title, items }));
  }, [filteredHistory, groupBy]);

  // 导出
  const handleExport = useCallback(async (format = 'json') => {
    setIsExporting(true);
    try {
      const data = exportHistory(format);
      const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `history_${Date.now()}.json`;
      a.click();
      notify('导出成功', 'success');
    } catch (error) {
      notify('导出失败', 'error');
    } finally {
      setIsExporting(false);
    }
  }, [exportHistory, notify]);

  // 导入
  const handleImport = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await importHistory(file);
      if (result.success) notify(`导入 ${result.count} 条记录`, 'success');
      else throw new Error(result.error);
    } catch (error) {
      notify('导入失败', 'error');
    }
    event.target.value = null;
  }, [importHistory, notify]);

  // 渲染统计
  const renderStatistics = () => {
    if (!showStats) return null;
    return (
      <div className="statistics-panel">
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-icon"><BarChart3 size={20} /></div><div className="stat-content"><div className="stat-value">{statistics.totalTranslations}</div><div className="stat-label">总翻译</div></div></div>
          <div className="stat-card"><div className="stat-icon"><TrendingUp size={20} /></div><div className="stat-content"><div className="stat-value">{statistics.todayTranslations}</div><div className="stat-label">今日</div></div></div>
        </div>
        <button className="stats-close" onClick={() => setShowStats(false)}><X size={16} /></button>
      </div>
    );
  };

  // 渲染网格项
  const renderGridItem = (item) => {
    const isSelected = selectedItems.has(item.id);
    return (
      <div key={item.id} className={`history-card ${isSelected ? 'selected' : ''}`}>
        <div className="card-header" style={{display:'flex', justifyContent:'space-between', paddingBottom:8, borderBottom:'1px solid var(--border-primary)', marginBottom:8}}>
          <span style={{fontSize:12, color:'var(--accent-primary)', fontWeight:600}}>
            {item.sourceLanguage} → {item.targetLanguage}
          </span>
          <button 
            className="card-action-btn danger"
            onClick={(e) => {
              e.stopPropagation();
              if (removeFromHistory) removeFromHistory(item.id); 
            }}
            style={{border:'none', background:'transparent', cursor:'pointer', color:'var(--text-tertiary)'}}
            title="删除"
          >
            <X size={14} />
          </button>
        </div>
        <div className="card-content" style={{fontSize:13, lineHeight:1.5, marginBottom:8}}>
          <div style={{color:'var(--text-secondary)', marginBottom:4}}>{item.sourceText}</div>
          <div style={{color:'var(--text-primary)', fontWeight:500}}>{item.translatedText}</div>
        </div>
        <div className="card-footer" style={{fontSize:11, color:'var(--text-tertiary)', display:'flex', justifyContent:'space-between'}}>
          <span>{dayjs(item.timestamp).format('MM-DD HH:mm')}</span>
          <div style={{display:'flex', gap:4}}>
            <button onClick={() => navigator.clipboard.writeText(item.translatedText)} style={{border:'none', background:'transparent', cursor:'pointer'}} title="复制"><Copy size={14} /></button>
            <button onClick={() => { restoreFromHistory(item.id); notify('已恢复', 'success'); }} style={{border:'none', background:'transparent', cursor:'pointer'}} title="编辑"><Edit3 size={14} /></button>
          </div>
        </div>
      </div>
    );
  };

  // 渲染列表项
  const renderHistoryItem = (item) => {
    return (
      <div key={item.id} className="history-item">
        <div className="history-item-header">
          <div className="item-info">
            <span className="language-tag">{item.sourceLanguage} → {item.targetLanguage}</span>
            <span className="item-time">{dayjs(item.timestamp).fromNow()}</span>
          </div>
          <div className="item-preview">
            <div className="preview-text source">{(item.sourceText || '').substring(0, 50)}</div>
            <div className="preview-text translated">{(item.translatedText || '').substring(0, 50)}</div>
          </div>
          <div className="item-actions">
            <button className="action-btn" onClick={() => restoreFromHistory(item.id)}><RefreshCw size={16}/></button>
            <button className="action-btn" onClick={() => navigator.clipboard.writeText(item.translatedText)}><Copy size={16}/></button>
            <button className="action-btn danger" onClick={() => removeFromHistory && removeFromHistory(item.id)}><Trash2 size={16}/></button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="history-panel">
      {/* 工具栏 */}
      <div className="history-toolbar">
        <div className="toolbar-left">
          <div className="view-switcher" style={{display:'flex', gap:4, marginRight: 8}}>
            <button className={`toolbar-btn ${viewMode==='list'?'active':''}`} onClick={()=>setViewMode('list')} title="列表"><FileText size={16}/></button>
            <button className={`toolbar-btn ${viewMode==='grid'?'active':''}`} onClick={()=>setViewMode('grid')} title="网格"><Globe size={16}/></button>
          </div>
          <button className={`toolbar-btn ${showStats?'active':''}`} onClick={() => setShowStats(!showStats)}><BarChart3 size={16} /> 统计</button>
          <div className="separator" />
          <select className="toolbar-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="date">按日期</option><option value="none">不分组</option>
          </select>
        </div>
        <div className="toolbar-right">
          <button className="toolbar-btn danger" onClick={() => { if(confirm('清空历史？')) clearHistory(); }}><Trash2 size={16} /> 清空</button>
        </div>
      </div>

      {/* 统计 */}
      {renderStatistics()}

      {/* 列表内容 */}
      <div className="history-content">
        {filteredHistory.length === 0 ? (
          <div className="empty-state"><Clock size={48} className="empty-icon" /><p>暂无记录</p></div>
        ) : (
          <div className={viewMode === 'grid' ? 'favorites-grid' : 'history-list'}>
            {viewMode === 'grid' ? (
              filteredHistory.map(item => renderGridItem(item))
            ) : (
              groupedHistory.map((group, idx) => (
                <div key={idx} className="history-group">
                  {groupBy !== 'none' && <div className="group-header"><span className="group-title">{group.title}</span></div>}
                  <div className="group-items">{group.items.map(renderHistoryItem)}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryPanel;