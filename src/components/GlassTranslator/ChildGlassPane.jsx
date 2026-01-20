// src/components/GlassTranslator/ChildGlassPane.jsx
// 子玻璃板组件 - 显示单个文本块的翻译结果

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Copy, Check, Loader2, GripVertical } from 'lucide-react';
import { CHILD_PANE_STATUS } from '../../stores/session.js';

/**
 * 子玻璃板组件
 * 
 * Props:
 * - pane: 子玻璃板数据 { id, sourceText, translatedText, bbox, status, isFrozen }
 * - parentBounds: 母玻璃板边界（用于判断是否拖出）
 * - onPositionChange: 位置变化回调
 * - onFreeze: 冻结回调（拖出母板时）
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
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, paneX: 0, paneY: 0 });
  const [copied, setCopied] = useState(false);
  const [showControls, setShowControls] = useState(false);
  
  const paneRef = useRef(null);
  const controlsTimerRef = useRef(null);
  
  const { id, sourceText, translatedText, bbox, status, isFrozen, error } = pane;
  
  // 拖动开始
  const handleMouseDown = useCallback((e) => {
    // 忽略按钮点击
    if (e.target.closest('.child-pane-btn')) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      paneX: bbox.x,
      paneY: bbox.y,
    });
    setIsDragging(true);
  }, [bbox.x, bbox.y]);
  
  // 拖动中 + 拖动结束
  useEffect(() => {
    if (!isDragging) return;
    
    const handleMouseMove = (e) => {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      
      const newX = dragStart.paneX + deltaX;
      const newY = dragStart.paneY + deltaY;
      
      onPositionChange?.(id, { x: newX, y: newY });
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      
      // 检查是否拖出母玻璃板（只对未冻结的有效）
      if (!isFrozen && parentBounds && paneRef.current) {
        const rect = paneRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // 检查中心点是否在父容器外
        const isOutside = (
          centerX < parentBounds.x ||
          centerX > parentBounds.x + parentBounds.width ||
          centerY < parentBounds.y ||
          centerY > parentBounds.y + parentBounds.height
        );
        
        if (isOutside && onFreeze) {
          // 冻结：转换为视口坐标
          onPositionChange?.(id, { x: rect.left, y: rect.top });
          onFreeze(id);
        }
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStart, id, isFrozen, parentBounds, onPositionChange, onFreeze]);
  
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
  
  // 计算样式
  const paneStyle = {
    position: isFrozen ? 'fixed' : 'absolute',
    left: `${bbox.x}px`,
    top: `${bbox.y}px`,
    minWidth: '80px',
    maxWidth: isFrozen ? '400px' : 'calc(100% - 20px)',
    zIndex: isFrozen ? 1100 : 1050,
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
    >
      {/* 拖动手柄（视觉指示） */}
      <div className="child-pane-handle">
        <GripVertical size={10} />
      </div>
      
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
