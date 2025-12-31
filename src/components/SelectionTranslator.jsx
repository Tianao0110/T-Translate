// src/components/SelectionTranslator.jsx
// 划词翻译组件 - 显示触发图标和译文框
import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import llmClient from '../utils/llm-client';

const SelectionTranslator = () => {
  // 状态
  const [mode, setMode] = useState('idle'); // idle | trigger | loading | result
  const [selectedText, setSelectedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');
  
  // 设置
  const [settings, setSettings] = useState({
    triggerIcon: 'dot', // dot | translate | custom
    triggerSize: 24,
    triggerColor: '#3b82f6',
    customIconPath: '',
    hoverDelay: 300,
    triggerTimeout: 5000,
    resultTimeout: 3000,
    minChars: 2,
    maxChars: 500,
  });
  
  // Refs
  const triggerTimeoutRef = useRef(null);
  const resultTimeoutRef = useRef(null);
  const hoverTimeoutRef = useRef(null);
  const containerRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // 初始化
  useEffect(() => {
    loadSettings();
    
    // 监听显示触发点
    if (window.electron?.selection?.onShowTrigger) {
      window.electron.selection.onShowTrigger((data) => {
        console.log('[Selection] Show trigger:', data);
        setSelectedText(data.text);
        setPosition({ x: data.x, y: data.y });
        setMode('trigger');
        setError('');
        setTranslatedText('');
        
        // 设置自动消失定时器
        clearTimeout(triggerTimeoutRef.current);
        triggerTimeoutRef.current = setTimeout(() => {
          if (mode === 'trigger') {
            setMode('idle');
          }
        }, settings.triggerTimeout);
      });
    }
    
    // 监听隐藏
    if (window.electron?.selection?.onHide) {
      window.electron.selection.onHide(() => {
        setMode('idle');
        clearAllTimeouts();
      });
    }
    
    // 键盘事件
    const handleKeyDown = (e) => {
      if (e.code === 'Escape') {
        setMode('idle');
        window.electron?.selection?.hide?.();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearAllTimeouts();
    };
  }, []);

  const clearAllTimeouts = () => {
    clearTimeout(triggerTimeoutRef.current);
    clearTimeout(resultTimeoutRef.current);
    clearTimeout(hoverTimeoutRef.current);
  };

  const loadSettings = async () => {
    try {
      if (window.electron?.selection?.getSettings) {
        const s = await window.electron.selection.getSettings();
        if (s) setSettings(prev => ({ ...prev, ...s }));
      }
    } catch (e) {
      console.error('[Selection] Load settings failed:', e);
    }
  };

  // 鼠标悬停触发点
  const handleTriggerMouseEnter = () => {
    clearTimeout(triggerTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      startTranslation();
    }, settings.hoverDelay);
  };

  const handleTriggerMouseLeave = () => {
    clearTimeout(hoverTimeoutRef.current);
    // 重新设置消失定时器
    triggerTimeoutRef.current = setTimeout(() => {
      if (mode === 'trigger') {
        setMode('idle');
      }
    }, settings.triggerTimeout);
  };

  // 开始翻译
  const startTranslation = async () => {
    if (!selectedText || mode === 'loading') return;
    
    setMode('loading');
    clearAllTimeouts();
    
    try {
      // 检测语言
      const chineseChars = selectedText.match(/[\u4e00-\u9fff]/g) || [];
      const isChineseSource = chineseChars.length / selectedText.length > 0.3;
      const targetLang = isChineseSource ? 'en' : 'zh';
      
      const langNames = { 'zh': '中文', 'en': '英文' };
      const systemPrompt = `你是一个专业翻译助手。请将以下文本翻译成${langNames[targetLang]}。只输出翻译结果，不要添加任何解释。`;
      
      const response = await llmClient.chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: selectedText }
      ]);
      
      const result = response?.content?.trim() || '';
      setTranslatedText(result);
      setMode('result');
      
      // 添加到历史
      if (result && window.electron?.selection?.addToHistory) {
        window.electron.selection.addToHistory({
          id: `sel-${Date.now()}`,
          sourceText: selectedText,
          translatedText: result,
          sourceLanguage: isChineseSource ? 'zh' : 'en',
          targetLanguage: targetLang,
          timestamp: Date.now(),
          source: 'selection-translator'
        });
      }
      
    } catch (e) {
      console.error('[Selection] Translation error:', e);
      setError(e.message || '翻译失败');
      setMode('result');
    }
  };

  // 结果框 - 鼠标离开后自动关闭
  const handleResultMouseLeave = () => {
    resultTimeoutRef.current = setTimeout(() => {
      setMode('idle');
      window.electron?.selection?.hide?.();
    }, settings.resultTimeout);
  };

  const handleResultMouseEnter = () => {
    clearTimeout(resultTimeoutRef.current);
  };

  // 左键点击关闭
  const handleResultClick = (e) => {
    if (e.button === 0 && !isDraggingRef.current) {
      setMode('idle');
      window.electron?.selection?.hide?.();
    }
  };

  // 右键拖动
  const handleResultMouseDown = (e) => {
    if (e.button === 2) {
      e.preventDefault();
      isDraggingRef.current = true;
      dragOffsetRef.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y
      };
      
      const handleMouseMove = (moveEvent) => {
        if (isDraggingRef.current) {
          setPosition({
            x: moveEvent.screenX - dragOffsetRef.current.x,
            y: moveEvent.screenY - dragOffsetRef.current.y
          });
          // 通知主进程移动窗口
          window.electron?.selection?.setPosition?.(
            moveEvent.screenX - dragOffsetRef.current.x,
            moveEvent.screenY - dragOffsetRef.current.y
          );
        }
      };
      
      const handleMouseUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
      
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
  };

  // 双击复制
  const handleDoubleClick = () => {
    if (translatedText) {
      if (window.electron?.clipboard?.writeText) {
        window.electron.clipboard.writeText(translatedText);
      } else {
        navigator.clipboard.writeText(translatedText);
      }
      // 视觉反馈
      const el = containerRef.current;
      if (el) {
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 300);
      }
    }
  };

  // 阻止右键菜单
  const handleContextMenu = (e) => {
    e.preventDefault();
  };

  // 渲染触发图标
  const renderTrigger = () => {
    const style = {
      width: settings.triggerSize,
      height: settings.triggerSize,
      backgroundColor: settings.triggerColor,
    };
    
    if (settings.triggerIcon === 'dot') {
      return <div className="trigger-dot" style={style} />;
    } else if (settings.triggerIcon === 'translate') {
      return (
        <div className="trigger-icon" style={{ ...style, backgroundColor: 'transparent' }}>
          <svg viewBox="0 0 24 24" fill={settings.triggerColor} width={settings.triggerSize} height={settings.triggerSize}>
            <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
          </svg>
        </div>
      );
    } else if (settings.triggerIcon === 'custom' && settings.customIconPath) {
      return <img src={settings.customIconPath} className="trigger-custom" style={{ width: settings.triggerSize, height: settings.triggerSize }} />;
    }
    
    return <div className="trigger-dot" style={style} />;
  };

  if (mode === 'idle') {
    return null;
  }

  return (
    <div 
      className="selection-container"
      ref={containerRef}
      onContextMenu={handleContextMenu}
    >
      {mode === 'trigger' && (
        <div 
          className="selection-trigger"
          onMouseEnter={handleTriggerMouseEnter}
          onMouseLeave={handleTriggerMouseLeave}
        >
          {renderTrigger()}
        </div>
      )}
      
      {mode === 'loading' && (
        <div className="selection-loading">
          <Loader2 className="spin" size={20} />
        </div>
      )}
      
      {mode === 'result' && (
        <div 
          className="selection-result"
          onClick={handleResultClick}
          onMouseDown={handleResultMouseDown}
          onMouseEnter={handleResultMouseEnter}
          onMouseLeave={handleResultMouseLeave}
          onDoubleClick={handleDoubleClick}
        >
          {error ? (
            <span className="error">{error}</span>
          ) : (
            <span className="text">{translatedText}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default SelectionTranslator;
