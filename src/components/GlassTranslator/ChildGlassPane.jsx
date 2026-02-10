// src/components/GlassTranslator/ChildGlassPane.jsx
// 子玻璃板组件 - 显示单个文本块的翻译结果
// v9: 双击触发冻结/创建独立窗口，拖动只用于移动位置

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Copy, Check, Loader2 } from 'lucide-react';
import { CHILD_PANE_STATUS } from '../../stores/session.js';

/**
 * 子玻璃板组件
 * 
 * Props:
 * - pane: 子玻璃板数据 { id, sourceText, translatedText, bbox, status, isFrozen }
 * - parentBounds: 母玻璃板边界（用于相对坐标计算）
 * - onPositionChange: 位置变化回调
 * - onFreeze: 冻结回调（双击触发，创建独立窗口）
 * - onClose: 关闭回调（仅冻结状态可用）
 * - theme: 主题
 */
const ChildGlassPane = ({
  pane,
  parentBounds,
  onPositionChange,
  onFreeze,
  onClose,
  theme = 'light',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [renderPos, setRenderPos] = useState({ x: 0, y: 0 });  // 仅用于渲染
  const [copied, setCopied] = useState(false);
  const [showControls, setShowControls] = useState(false);
  
  const paneRef = useRef(null);
  const controlsTimerRef = useRef(null);
  
  // 使用 ref 存储拖动状态，避免 stale closure 问题
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    currentX: 0,
    currentY: 0,
  });
  
  const { id, sourceText, translatedText, bbox, status, isFrozen, error } = pane;
  
  // 双击触发冻结 - 创建独立窗口
  const handleDoubleClick = useCallback((e) => {
    // 翻译完成后才能冻结
    if (status !== CHILD_PANE_STATUS.DONE) return;
    // 已经冻结的不再处理
    if (isFrozen) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = paneRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // 调用冻结回调，传递视口坐标
    onFreeze?.(id, { viewportX: rect.left, viewportY: rect.top });
  }, [id, status, isFrozen, onFreeze]);
  
  // 拖动开始
  const handleMouseDown = useCallback((e) => {
    // 忽略按钮点击
    if (e.target.closest('.child-pane-btn')) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = paneRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // 记录拖动状态到 ref
    dragStateRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      currentX: rect.left,
      currentY: rect.top,
    };
    
    setRenderPos({ x: rect.left, y: rect.top });
    setIsDragging(true);
  }, []);
  
  // 全局鼠标事件处理
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragStateRef.current.isDragging) return;
      
      const newX = e.clientX - dragStateRef.current.offsetX;
      const newY = e.clientY - dragStateRef.current.offsetY;
      
      dragStateRef.current.currentX = newX;
      dragStateRef.current.currentY = newY;
      
      setRenderPos({ x: newX, y: newY });
    };
    
    const handleMouseUp = () => {
      if (!dragStateRef.current.isDragging) return;
      
      const finalX = dragStateRef.current.currentX;
      const finalY = dragStateRef.current.currentY;
      
      dragStateRef.current.isDragging = false;
      setIsDragging(false);
      
      // v9: 拖动只用于移动位置，不再触发冻结
      // 转换为相对坐标
      if (!isFrozen && parentBounds) {
        const relativeX = finalX - parentBounds.x;
        const relativeY = finalY - parentBounds.y;
        onPositionChange?.(id, { x: relativeX, y: relativeY });
      } else if (isFrozen) {
        // 已冻结的保持视口坐标
        onPositionChange?.(id, { x: finalX, y: finalY });
      }
    };
    
    // 始终监听，通过 ref 判断是否在拖动
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [id, isFrozen, parentBounds, onPositionChange]);
  
  // 复制译文
  const handleCopy = useCallback((e) => {
    e.stopPropagation();
    if (!translatedText) return;
    
    navigator.clipboard?.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [translatedText]);
  
  // 显示/隐藏控制按钮
  const handleMouseEnter = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    setShowControls(true);
  }, []);
  
  const handleMouseLeave = useCallback(() => {
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 300);
  }, []);
  
  // 清理定时器
  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);
  
  // 记录翻译完成时的尺寸
  const [fixedSize, setFixedSize] = useState(null);
  
  // 翻译完成后锁定尺寸
  useEffect(() => {
    if (status === CHILD_PANE_STATUS.DONE && !fixedSize && paneRef.current) {
      const rect = paneRef.current.getBoundingClientRect();
      setFixedSize({
        width: rect.width,
        height: rect.height,
      });
    }
  }, [status, fixedSize]);
  
  // 计算样式 - 翻译完成后尺寸固定
  const paneStyle = {
    position: isDragging ? 'fixed' : (isFrozen ? 'fixed' : 'absolute'),
    left: isDragging ? `${renderPos.x}px` : `${bbox.x}px`,
    top: isDragging ? `${renderPos.y}px` : `${bbox.y}px`,
    // 翻译完成后使用固定尺寸
    ...(fixedSize ? {
      width: `${fixedSize.width}px`,
      height: `${fixedSize.height}px`,
    } : {
      minWidth: '80px',
      maxWidth: isFrozen ? '400px' : 'calc(100% - 20px)',
    }),
    zIndex: isDragging ? 9999 : (isFrozen ? 1100 : 1050),
  };
  
  // 根据状态确定类名
  const statusClass = {
    [CHILD_PANE_STATUS.PENDING]: 'pending',
    [CHILD_PANE_STATUS.TRANSLATING]: 'translating',
    [CHILD_PANE_STATUS.DONE]: 'done',
    [CHILD_PANE_STATUS.ERROR]: 'error',
  }[status] || '';
  
  return (
    <div
      ref={paneRef}
      className={`child-glass-pane ${statusClass} ${isFrozen ? 'frozen' : ''} ${isDragging ? 'dragging' : ''}`}
      style={paneStyle}
      data-theme={theme}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      title={status === CHILD_PANE_STATUS.DONE && !isFrozen ? '双击固定为独立窗口' : ''}
    >
      {/* 内容区 */}
      <div className="child-pane-content">
        {status === CHILD_PANE_STATUS.TRANSLATING ? (
          <div className="child-pane-loading">
            <Loader2 className="spin" size={14} />
          </div>
        ) : status === CHILD_PANE_STATUS.ERROR ? (
          <div className="child-pane-error">{error || '翻译失败'}</div>
        ) : (
          <div className="child-pane-text">{translatedText || sourceText}</div>
        )}
      </div>
      
      {/* 控制按钮 */}
      {showControls && (status === CHILD_PANE_STATUS.DONE || isFrozen) && (
        <div className="child-pane-controls">
          <button 
            className="child-pane-btn"
            onClick={handleCopy}
            title="复制译文"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          {isFrozen && onClose && (
            <button 
              className="child-pane-btn close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(id);
              }}
              title="关闭"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ChildGlassPane;
