// src/utils/performance.js
// 性能优化工具集 - React hooks 和工具函数

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

/**
 * 防抖 Hook
 * @param {any} value - 需要防抖的值
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {any} - 防抖后的值
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * 防抖回调 Hook
 * @param {Function} callback - 需要防抖的回调函数
 * @param {number} delay - 延迟时间（毫秒）
 * @param {Array} deps - 依赖数组
 * @returns {Function} - 防抖后的回调函数
 */
export function useDebouncedCallback(callback, delay = 300, deps = []) {
  const timeoutRef = useRef(null);

  const debouncedCallback = useCallback((...args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [delay, ...deps]);

  // 清理
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

/**
 * 节流回调 Hook
 * @param {Function} callback - 需要节流的回调函数
 * @param {number} limit - 节流间隔（毫秒）
 * @param {Array} deps - 依赖数组
 * @returns {Function} - 节流后的回调函数
 */
export function useThrottledCallback(callback, limit = 100, deps = []) {
  const lastRunRef = useRef(0);
  const timeoutRef = useRef(null);

  const throttledCallback = useCallback((...args) => {
    const now = Date.now();
    const remaining = limit - (now - lastRunRef.current);

    if (remaining <= 0) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      lastRunRef.current = now;
      callback(...args);
    } else if (!timeoutRef.current) {
      timeoutRef.current = setTimeout(() => {
        lastRunRef.current = Date.now();
        timeoutRef.current = null;
        callback(...args);
      }, remaining);
    }
  }, [limit, ...deps]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return throttledCallback;
}

/**
 * 惰性初始化 Hook
 * @param {Function} initializer - 初始化函数
 * @returns {any} - 初始化后的值
 */
export function useLazyInit(initializer) {
  const ref = useRef(null);
  const initialized = useRef(false);

  if (!initialized.current) {
    ref.current = initializer();
    initialized.current = true;
  }

  return ref.current;
}

/**
 * 前一个值 Hook
 * @param {any} value - 当前值
 * @returns {any} - 前一个值
 */
export function usePrevious(value) {
  const ref = useRef();

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

/**
 * 稳定回调 Hook（避免依赖数组问题）
 * @param {Function} callback - 回调函数
 * @returns {Function} - 稳定的回调函数引用
 */
export function useStableCallback(callback) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback((...args) => {
    return callbackRef.current(...args);
  }, []);
}

/**
 * 合并状态 Hook（减少多个 useState）
 * @param {Object} initialState - 初始状态对象
 * @returns {[Object, Function]} - [状态, 更新函数]
 */
export function useMergedState(initialState) {
  const [state, setState] = useState(initialState);

  const mergeState = useCallback((partial) => {
    setState(prev => ({
      ...prev,
      ...(typeof partial === 'function' ? partial(prev) : partial)
    }));
  }, []);

  return [state, mergeState];
}

/**
 * 创建选择器 Hook（避免不必要的重渲染）
 * @param {Object} store - Zustand store 或任意对象
 * @param {Function} selector - 选择器函数
 * @param {Function} equalityFn - 相等性比较函数
 * @returns {any} - 选择的值
 */
export function useShallowSelector(store, selector, equalityFn = shallowEqual) {
  const prev = useRef();
  const selected = selector(store);

  if (equalityFn(prev.current, selected)) {
    return prev.current;
  }

  prev.current = selected;
  return selected;
}

/**
 * 浅比较
 */
export function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }

  return true;
}

/**
 * 创建缓存 Map（用于大型列表的查找优化）
 * @param {Array} items - 数组
 * @param {string|Function} keyGetter - 键获取器
 * @returns {Map} - 缓存 Map
 */
export function createLookupMap(items, keyGetter = 'id') {
  const map = new Map();
  const getKey = typeof keyGetter === 'function' ? keyGetter : (item) => item[keyGetter];

  for (const item of items) {
    map.set(getKey(item), item);
  }

  return map;
}

/**
 * 虚拟列表 Hook（简易版）
 * @param {Object} options - 配置选项
 * @returns {Object} - 虚拟列表状态和方法
 */
export function useVirtualList({
  itemCount,
  itemHeight,
  containerHeight,
  overscan = 3
}) {
  const [scrollTop, setScrollTop] = useState(0);

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = Math.min(itemCount, start + visibleCount + overscan * 2);

    return {
      startIndex: start,
      endIndex: end,
      offsetY: start * itemHeight
    };
  }, [scrollTop, itemHeight, containerHeight, itemCount, overscan]);

  const totalHeight = itemCount * itemHeight;

  const onScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  return {
    startIndex,
    endIndex,
    offsetY,
    totalHeight,
    onScroll,
    visibleItems: endIndex - startIndex
  };
}

/**
 * 性能监控 Hook（开发环境）
 * @param {string} componentName - 组件名称
 */
export function useRenderCount(componentName) {
  const renderCount = useRef(0);
  renderCount.current += 1;

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Render] ${componentName}: ${renderCount.current}`);
    }
  });

  return renderCount.current;
}

/**
 * 批量更新 Helper（React 18 自动批处理，但手动场景可能需要）
 */
export function batchUpdates(callback) {
  // React 18 中 ReactDOM.unstable_batchedUpdates 已不需要
  // 但保留此函数以兼容旧代码
  callback();
}

export default {
  useDebounce,
  useDebouncedCallback,
  useThrottledCallback,
  useLazyInit,
  usePrevious,
  useStableCallback,
  useMergedState,
  useShallowSelector,
  shallowEqual,
  createLookupMap,
  useVirtualList,
  useRenderCount,
  batchUpdates
};
