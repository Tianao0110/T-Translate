// src/components/SelectionTranslator.jsx
import React, { useState, useEffect, useRef } from 'react';
import '../styles/selection.css';

const API_ENDPOINT = 'http://localhost:1234/v1';

const SelectionTranslator = () => {
  const [mode, setMode] = useState('idle'); // idle | trigger | loading | overlay
  const [translatedText, setTranslatedText] = useState('');
  const [error, setError] = useState('');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [rect, setRect] = useState(null);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState('light');

  // 缓存数据
  const sizedRef = useRef(false);
  // 用于 Resize 逻辑
  const resizeRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0 });

  useEffect(() => {
    // 监听显示信号
    const removeShowListener = window.electron?.selection?.onShowTrigger?.((data) => {
      setMousePos({ x: data.mouseX, y: data.mouseY });
      setRect(data.rect);
      if (data.theme) setTheme(data.theme);
      
      setMode('trigger');
      setError('');
      setTranslatedText('');
      setCopied(false);
      sizedRef.current = false;
    });
    
    // 监听隐藏信号
    const removeHideListener = window.electron?.selection?.onHide?.(() => setMode('idle'));
    
    // ESC 关闭
    const handleKey = (e) => {
      if (e.code === 'Escape') {
        setMode('idle');
        window.electron?.selection?.hide?.();
      }
    };
    window.addEventListener('keydown', handleKey);

    // 清理函数
    return () => {
      if (removeShowListener) removeShowListener();
      if (removeHideListener) removeHideListener();
      window.removeEventListener('keydown', handleKey);
    };
  }, []);

  // 点击圆点 -> 触发翻译
  const handleTriggerClick = async () => {
    setMode('loading');
    
    try {
      // 1. 获取文字
      const result = await window.electron?.selection?.getText?.(rect);
      if (!result?.text) throw new Error('未获取到文字');
      
      // 2. 翻译
      const translation = await translateText(result.text);
      setTranslatedText(translation);
      setError('');
      setMode('overlay');
      
      // 3. 初始自动调整大小 (只执行一次)
      if (!sizedRef.current) {
        sizedRef.current = true;
        setWindowSize(translation);
      }
      
    } catch (err) {
      const errMsg = err.message || '翻译失败';
      setError(errMsg);
      setTranslatedText('');
      setMode('overlay');
      
      if (!sizedRef.current) {
        sizedRef.current = true;
        setWindowSize(errMsg);
      }
    }
  };

  // 初始窗口大小计算
  const setWindowSize = (text) => {
    const charWidth = 8;
    const lineHeight = 22;
    const padding = 40;
    const footerHeight = 32;
    const maxWidth = 380;
    const minWidth = 140;
    
    let width = Math.min(text.length * charWidth + padding, maxWidth);
    width = Math.max(width, minWidth);
    
    const charsPerLine = Math.floor((width - padding) / charWidth);
    const lines = Math.ceil(text.length / charsPerLine);
    let height = lines * lineHeight + padding + footerHeight;
    height = Math.max(height, 80);
    height = Math.min(height, 300);
    
    // 定位在圆点下方
    const x = mousePos.x - width / 2;
    const y = mousePos.y + 20;
    
    window.electron?.selection?.setBounds?.({
      x: Math.round(Math.max(x, 10)),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    });
  };

  // 翻译接口 (优化版)
  const translateText = async (text) => {
    const isChinese = (text.match(/[\u4e00-\u9fff]/g) || []).length / text.length > 0.3;
    const target = isChinese ? 'English' : 'Simplified Chinese';
    
    try {
      const res = await fetch(`${API_ENDPOINT}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { 
              role: 'system', 
              content: `You are a translator. Translate the following text into ${target}. Output ONLY the translation result.` 
            },
            { role: 'user', content: text }
          ],
          temperature: 0.3,
        }),
      });
      
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || 'No translation';
    } catch (e) {
      console.error(e);
      return '翻译失败: 连接不上本地服务';
    }
  };

  // 🟢 手动调整大小逻辑 (Resize Handle)
  const handleResizeDown = (e) => {
    e.preventDefault(); 
    e.stopPropagation();

    // 记录初始状态
    resizeRef.current = {
      startX: e.screenX,
      startY: e.screenY,
      // 使用 document.body 获取当前窗口大小
      startW: document.body.offsetWidth,
      startH: document.body.offsetHeight
    };

    const handleMouseMove = (ev) => {
      const dx = ev.screenX - resizeRef.current.startX;
      const dy = ev.screenY - resizeRef.current.startY;
      
      const newWidth = Math.max(resizeRef.current.startW + dx, 160); // 最小宽度
      const newHeight = Math.max(resizeRef.current.startH + dy, 100); // 最小高度
      
      // 调用 Main 进程调整大小
      window.electron?.selection?.resize?.({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // 点击复制
  const handleClick = () => {
    if (translatedText) {
      window.electron?.clipboard?.writeText?.(translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  const handleContext = (e) => {
    e.preventDefault();
    setMode('idle');
    window.electron?.selection?.hide?.();
  };

  if (mode === 'idle') return null;

  return (
    <div className="sel-root" data-theme={theme}>
      {mode === 'trigger' && (
        <div className="sel-trigger" onClick={handleTriggerClick}>
          <svg viewBox="0 0 24 24" fill="white" width="14" height="14">
            <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
          </svg>
        </div>
      )}
      
      {mode === 'loading' && (
        <div className="sel-loading">
          <div className="sel-spinner" />
        </div>
      )}
      
      {mode === 'overlay' && (
        <div 
          className={`sel-card ${copied ? 'copied' : ''}`}
          onClick={handleClick}
          onContextMenu={handleContext}
        >
          <div className="sel-content">
            {error ? (
              <div className="sel-error">{error}</div>
            ) : (
              <div className="sel-text">{translatedText}</div>
            )}
          </div>

          {/* 🟢 Resize Handle (右下角抓手) */}
          <div className="sel-resize-handle" onMouseDown={handleResizeDown} title="拖动调整大小" />
        </div>
      )}
    </div>
  );
};

export default SelectionTranslator;