// src/components/SelectionTranslator.jsx
import React, { useState, useEffect, useRef } from 'react';
import '../styles/selection.css';

const API_ENDPOINT = 'http://localhost:1234/v1';

// 默认设置
const DEFAULT_SETTINGS = {
  triggerTimeout: 4000,
  showSourceByDefault: false,
  autoCloseOnCopy: false,
  minChars: 2,
  maxChars: 500,
};

const SelectionTranslator = () => {
  const [mode, setMode] = useState('idle');
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [error, setError] = useState('');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [rect, setRect] = useState(null);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState('light');
  const [showSource, setShowSource] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const sizedRef = useRef(false);
  const resizeRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0 });
  const autoHideTimerRef = useRef(null);

  useEffect(() => {
    const removeShowListener = window.electron?.selection?.onShowTrigger?.((data) => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      
      setMousePos({ x: data.mouseX, y: data.mouseY });
      setRect(data.rect);
      
      // 应用主题
      if (data.theme) setTheme(data.theme);
      
      // 应用设置
      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);
      
      // 根据设置决定是否默认显示原文
      setShowSource(newSettings.showSourceByDefault);
      
      setMode('trigger');
      setError('');
      setSourceText('');
      setTranslatedText('');
      setCopied(false);
      sizedRef.current = false;
      
      // 使用设置中的自动消失时间
      autoHideTimerRef.current = setTimeout(() => {
        setMode('idle');
        window.electron?.selection?.hide?.();
      }, newSettings.triggerTimeout);
    });
    
    const removeHideListener = window.electron?.selection?.onHide?.(() => {
      setMode('idle');
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    });
    
    const handleKey = (e) => {
      if (e.code === 'Escape') {
        setMode('idle');
        window.electron?.selection?.hide?.();
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      if (removeShowListener) removeShowListener();
      if (removeHideListener) removeHideListener();
      window.removeEventListener('keydown', handleKey);
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, []);

  const handleTriggerClick = async () => {
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    setMode('loading');
    
    try {
      const result = await window.electron?.selection?.getText?.(rect);
      if (!result?.text) throw new Error('未获取到文字');
      
      const text = result.text.trim();
      
      // 检查字符数限制
      if (text.length < settings.minChars) {
        throw new Error(`文字太短（最少 ${settings.minChars} 字符）`);
      }
      if (text.length > settings.maxChars) {
        throw new Error(`文字太长（最多 ${settings.maxChars} 字符）`);
      }
      
      setSourceText(text);
      const translation = await translateText(text);
      setTranslatedText(translation);
      setError('');
      setMode('overlay');
      
      if (!sizedRef.current) {
        sizedRef.current = true;
        setWindowSize(translation);
      }
    } catch (err) {
      setError(err.message || '翻译失败');
      setTranslatedText('');
      setMode('overlay');
      if (!sizedRef.current) {
        sizedRef.current = true;
        setWindowSize(err.message || '翻译失败');
      }
    }
  };

  const setWindowSize = (text) => {
    const charWidth = 8, lineHeight = 22, padding = 40, toolbarHeight = 36;
    const maxWidth = 420, minWidth = 180;
    
    let width = Math.min(text.length * charWidth + padding, maxWidth);
    width = Math.max(width, minWidth);
    
    const charsPerLine = Math.floor((width - padding) / charWidth);
    const lines = Math.ceil(text.length / charsPerLine);
    let height = lines * lineHeight + padding + toolbarHeight;
    height = Math.max(height, 100);
    height = Math.min(height, 400);
    
    const sw = window.screen?.availWidth || 1920;
    const sh = window.screen?.availHeight || 1080;
    
    let x = mousePos.x - width / 2;
    let y = mousePos.y + 20;
    
    if (x < 10) x = 10;
    if (x + width > sw - 10) x = sw - width - 10;
    if (y + height > sh - 10) y = mousePos.y - height - 10;
    if (y < 10) y = 10;
    
    window.electron?.selection?.setBounds?.({
      x: Math.round(x), y: Math.round(y),
      width: Math.round(width), height: Math.round(height)
    });
  };

  const translateText = async (text) => {
    const isChinese = (text.match(/[\u4e00-\u9fff]/g) || []).length / text.length > 0.3;
    const target = isChinese ? 'English' : 'Simplified Chinese';
    
    const res = await fetch(`${API_ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: `Translate into ${target}. Output ONLY the result.` },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
      }),
    });
    
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  };

  const handleResizeDown = (e) => {
    e.preventDefault(); 
    e.stopPropagation();
    resizeRef.current = {
      startX: e.screenX, startY: e.screenY,
      startW: document.body.offsetWidth, startH: document.body.offsetHeight
    };

    const onMove = (ev) => {
      const dx = ev.screenX - resizeRef.current.startX;
      const dy = ev.screenY - resizeRef.current.startY;
      window.electron?.selection?.resize?.({
        width: Math.max(resizeRef.current.startW + dx, 160),
        height: Math.max(resizeRef.current.startH + dy, 80)
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleCopy = (e) => {
    e.stopPropagation();
    if (translatedText) {
      window.electron?.clipboard?.writeText?.(translatedText);
      setCopied(true);
      
      // 如果设置了复制后自动关闭
      if (settings.autoCloseOnCopy) {
        setTimeout(() => {
          setMode('idle');
          window.electron?.selection?.hide?.();
        }, 500);
      } else {
        setTimeout(() => setCopied(false), 1200);
      }
    }
  };

  const toggleSource = (e) => {
    e.stopPropagation();
    setShowSource(!showSource);
  };

  const handleClose = (e) => {
    if (e) e.preventDefault();
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
        <div className={`sel-card ${copied ? 'copied' : ''}`} onContextMenu={handleClose}>
          <div className="sel-toolbar">
            <button className={`sel-btn ${showSource ? 'active' : ''}`} onClick={toggleSource} title="显示原文">
              原文
            </button>
            <button className={`sel-btn ${copied ? 'success' : ''}`} onClick={handleCopy} title="复制译文">
              {copied ? '已复制' : '复制'}
            </button>
            <div className="sel-spacer" />
            <button className="sel-btn sel-btn-close" onClick={handleClose} title="关闭 (ESC)">✕</button>
          </div>
          
          <div className="sel-content">
            {error ? (
              <div className="sel-error">{error}</div>
            ) : (
              <>
                {showSource && sourceText && (
                  <div className="sel-source">{sourceText}</div>
                )}
                <div className="sel-text">{translatedText}</div>
              </>
            )}
          </div>

          <div className="sel-resize-handle" onMouseDown={handleResizeDown} />
        </div>
      )}
    </div>
  );
};

export default SelectionTranslator;
