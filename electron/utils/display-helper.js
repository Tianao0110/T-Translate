// electron/utils/display-helper.js
// 多显示器支持工具函数

const { screen } = require('electron');

/**
 * 获取所有显示器的合并边界
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number }}
 */
function getAllDisplaysBounds() {
  const displays = screen.getAllDisplays();
  
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  displays.forEach(display => {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
  });
  
  return {
    minX, minY, maxX, maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * 检查点是否在任意显示器上
 * @param {number} x 
 * @param {number} y 
 * @returns {boolean}
 */
function isPointOnAnyDisplay(x, y) {
  const displays = screen.getAllDisplays();
  return displays.some(display => {
    const { x: dx, y: dy, width, height } = display.bounds;
    return x >= dx && x < dx + width && y >= dy && y < dy + height;
  });
}

/**
 * 检查矩形是否至少部分在某个显示器上可见
 * @param {{ x: number, y: number, width: number, height: number }} bounds 
 * @param {number} minVisiblePixels - 最少可见像素（默认 50）
 * @returns {boolean}
 */
function isBoundsVisible(bounds, minVisiblePixels = 50) {
  const displays = screen.getAllDisplays();
  
  for (const display of displays) {
    const db = display.bounds;
    
    // 计算重叠区域
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, db.x + db.width) - Math.max(bounds.x, db.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, db.y + db.height) - Math.max(bounds.y, db.y));
    const overlapArea = overlapX * overlapY;
    
    if (overlapArea >= minVisiblePixels * minVisiblePixels) {
      return true;
    }
  }
  
  return false;
}

/**
 * 获取离指定点最近的显示器
 * @param {number} x 
 * @param {number} y 
 * @returns {Electron.Display}
 */
function getNearestDisplay(x, y) {
  return screen.getDisplayNearestPoint({ x, y });
}

/**
 * 确保窗口边界在有效显示器范围内
 * 如果窗口位置无效，将其移动到主显示器中心
 * 
 * @param {{ x?: number, y?: number, width: number, height: number }} bounds - 窗口边界
 * @param {Object} options - 选项
 * @param {number} options.minVisiblePixels - 最少可见像素（默认 100）
 * @param {boolean} options.centerOnInvalid - 无效时是否居中（默认 true）
 * @returns {{ x: number, y: number, width: number, height: number, adjusted: boolean }}
 */
function ensureBoundsOnDisplay(bounds, options = {}) {
  const { minVisiblePixels = 100, centerOnInvalid = true } = options;
  
  // 如果没有位置信息，使用主显示器中心
  if (bounds.x === undefined || bounds.y === undefined) {
    const primary = screen.getPrimaryDisplay();
    return {
      x: Math.round(primary.bounds.x + (primary.bounds.width - bounds.width) / 2),
      y: Math.round(primary.bounds.y + (primary.bounds.height - bounds.height) / 2),
      width: bounds.width,
      height: bounds.height,
      adjusted: true,
    };
  }
  
  // 检查当前位置是否有效
  if (isBoundsVisible(bounds, minVisiblePixels)) {
    return { ...bounds, adjusted: false };
  }
  
  // 位置无效，需要调整
  if (centerOnInvalid) {
    // 移动到主显示器中心
    const primary = screen.getPrimaryDisplay();
    return {
      x: Math.round(primary.bounds.x + (primary.bounds.width - bounds.width) / 2),
      y: Math.round(primary.bounds.y + (primary.bounds.height - bounds.height) / 2),
      width: bounds.width,
      height: bounds.height,
      adjusted: true,
    };
  } else {
    // 移动到最近显示器的可见区域
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const nearestDisplay = getNearestDisplay(centerX, centerY);
    const db = nearestDisplay.bounds;
    
    // 确保窗口完全在显示器内
    let newX = Math.max(db.x, Math.min(bounds.x, db.x + db.width - bounds.width));
    let newY = Math.max(db.y, Math.min(bounds.y, db.y + db.height - bounds.height));
    
    return {
      x: Math.round(newX),
      y: Math.round(newY),
      width: bounds.width,
      height: bounds.height,
      adjusted: true,
    };
  }
}

/**
 * 确保窗口在屏幕边界内（考虑边距）
 * @param {{ x: number, y: number, width: number, height: number }} bounds 
 * @param {number} margin - 边距（默认 10）
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function constrainToScreen(bounds, margin = 10) {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const display = getNearestDisplay(centerX, centerY);
  const db = display.workArea; // 使用工作区域（排除任务栏）
  
  let { x, y, width, height } = bounds;
  
  // 限制宽高不超过显示器
  width = Math.min(width, db.width - margin * 2);
  height = Math.min(height, db.height - margin * 2);
  
  // 限制位置在显示器内
  x = Math.max(db.x + margin, Math.min(x, db.x + db.width - width - margin));
  y = Math.max(db.y + margin, Math.min(y, db.y + db.height - height - margin));
  
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/**
 * 获取适合显示窗口的位置（跟随鼠标或指定位置）
 * @param {{ width: number, height: number }} size - 窗口尺寸
 * @param {{ x?: number, y?: number }} position - 期望位置（可选，默认鼠标位置）
 * @param {Object} options - 选项
 * @param {number} options.offsetX - X 偏移（默认 20）
 * @param {number} options.offsetY - Y 偏移（默认 20）
 * @param {number} options.margin - 屏幕边距（默认 10）
 * @returns {{ x: number, y: number }}
 */
function getWindowPosition(size, position = null, options = {}) {
  const { offsetX = 20, offsetY = 20, margin = 10 } = options;
  
  // 获取参考点
  let refX, refY;
  if (position && position.x !== undefined && position.y !== undefined) {
    refX = position.x;
    refY = position.y;
  } else {
    const cursor = screen.getCursorScreenPoint();
    refX = cursor.x;
    refY = cursor.y;
  }
  
  // 获取该点所在显示器
  const display = getNearestDisplay(refX, refY);
  const db = display.workArea;
  
  // 初始位置（在参考点右下方）
  let x = refX + offsetX;
  let y = refY + offsetY;
  
  // 如果超出右边界，放到左边
  if (x + size.width > db.x + db.width - margin) {
    x = refX - size.width - offsetX;
  }
  
  // 如果超出下边界，放到上边
  if (y + size.height > db.y + db.height - margin) {
    y = refY - size.height - offsetY;
  }
  
  // 确保不超出左上边界
  x = Math.max(db.x + margin, x);
  y = Math.max(db.y + margin, y);
  
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * 监听显示器变化
 * @param {Function} callback - 回调函数 (event: 'added' | 'removed' | 'changed', display)
 * @returns {Function} 取消监听函数
 */
function onDisplayChange(callback) {
  const handleAdded = (event, display) => callback('added', display);
  const handleRemoved = (event, display) => callback('removed', display);
  const handleChanged = (event, display, changedMetrics) => callback('changed', display, changedMetrics);
  
  screen.on('display-added', handleAdded);
  screen.on('display-removed', handleRemoved);
  screen.on('display-metrics-changed', handleChanged);
  
  // 返回取消监听函数
  return () => {
    screen.removeListener('display-added', handleAdded);
    screen.removeListener('display-removed', handleRemoved);
    screen.removeListener('display-metrics-changed', handleChanged);
  };
}

/**
 * 获取显示器信息摘要（用于日志）
 * @returns {string}
 */
function getDisplaySummary() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  
  return displays.map((d, i) => {
    const isPrimary = d.id === primary.id;
    return `[${i + 1}${isPrimary ? '*' : ''}] ${d.bounds.width}x${d.bounds.height} @${d.scaleFactor}x (${d.bounds.x},${d.bounds.y})`;
  }).join(' | ');
}

module.exports = {
  getAllDisplaysBounds,
  isPointOnAnyDisplay,
  isBoundsVisible,
  getNearestDisplay,
  ensureBoundsOnDisplay,
  constrainToScreen,
  getWindowPosition,
  onDisplayChange,
  getDisplaySummary,
};
