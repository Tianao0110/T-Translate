// React performance hooks: debounce, throttle, lazy init, shallow selectors,
// virtual list, render counter.

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

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

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

// Leading-then-trailing throttle: fires immediately on first call, then again
// once `limit` has elapsed if more calls came in during the cooldown.
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

export function useLazyInit(initializer) {
  const ref = useRef(null);
  const initialized = useRef(false);

  if (!initialized.current) {
    ref.current = initializer();
    initialized.current = true;
  }

  return ref.current;
}

export function usePrevious(value) {
  const ref = useRef();

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

// Returns a stable callback identity even when the underlying function changes.
// Useful when a child memo'd component would otherwise re-render on every parent render.
export function useStableCallback(callback) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback((...args) => {
    return callbackRef.current(...args);
  }, []);
}

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

export function useShallowSelector(store, selector, equalityFn = shallowEqual) {
  const prev = useRef();
  const selected = selector(store);

  if (equalityFn(prev.current, selected)) {
    return prev.current;
  }

  prev.current = selected;
  return selected;
}

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

export function createLookupMap(items, keyGetter = 'id') {
  const map = new Map();
  const getKey = typeof keyGetter === 'function' ? keyGetter : (item) => item[keyGetter];

  for (const item of items) {
    map.set(getKey(item), item);
  }

  return map;
}

// Windowed-list helper: returns indices/offsets for rendering only the visible
// slice. Caller wraps the rendered items in a container with `totalHeight`.
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

// React 18 auto-batches updates; this wrapper exists for callers that still
// imported the React-17-style helper.
export function batchUpdates(callback) {
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
