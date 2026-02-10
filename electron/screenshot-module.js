/**
 * 截图模块 - 支持多显示器和多 GPU 配置
 * 
 * 优先使用 node-screenshots 库（需要安装：npm install node-screenshots）
 * 如果未安装，回退到 Electron 的 desktopCapturer
 */

const { screen, desktopCapturer, BrowserWindow, nativeImage } = require('electron');
const path = require('path');

// 尝试加载 node-screenshots
let nodeScreenshots = null;
try {
  nodeScreenshots = require('node-screenshots');
  console.log('[Screenshot] node-screenshots loaded successfully');
} catch (e) {
  console.log('[Screenshot] node-screenshots not available, will use desktopCapturer fallback');
}

// 存储截图数据
let screenshotData = null;
let screenshotWindow = null;

/**
 * 获取截图数据
 */
function getScreenshotData() {
  return screenshotData;
}

/**
 * 设置截图数据
 */
function setScreenshotData(data) {
  screenshotData = data;
}

/**
 * 清理截图数据
 */
function clearScreenshotData() {
  screenshotData = null;
}

/**
 * 获取截图窗口
 */
function getScreenshotWindow() {
  return screenshotWindow;
}

/**
 * 设置截图窗口
 */
function setScreenshotWindow(win) {
  screenshotWindow = win;
}

/**
 * 使用 node-screenshots 预截取所有显示器
 */
async function captureWithNodeScreenshots(displays, totalBounds) {
  if (!nodeScreenshots) return null;
  
  try {
    const { Monitor } = nodeScreenshots;
    const monitors = Monitor.all();
    
    // 先检查 API 格式（方法还是属性）
    const firstMonitor = monitors[0];
    const isMethodApi = typeof firstMonitor.id === 'function';
    
    console.log('[Screenshot] node-screenshots API style:', isMethodApi ? 'method' : 'property');
    console.log('[Screenshot] Found', monitors.length, 'monitors');
    
    // 根据 API 格式获取值的辅助函数
    const getValue = (obj, key) => {
      if (typeof obj[key] === 'function') {
        return obj[key]();
      }
      return obj[key];
    };

    console.log('[Screenshot] node-screenshots monitors:', monitors.map(m => ({
      id: getValue(m, 'id'),
      name: getValue(m, 'name'),
      bounds: [getValue(m, 'x'), getValue(m, 'y'), getValue(m, 'width'), getValue(m, 'height')],
      scaleFactor: getValue(m, 'scaleFactor'),
      isPrimary: getValue(m, 'isPrimary')
    })));

    // 预截取每个显示器
    const monitorScreenshots = [];
    for (const monitor of monitors) {
      try {
        const image = monitor.captureImageSync();
        const pngBuffer = image.toPngSync();
        
        const monitorData = {
          id: getValue(monitor, 'id'),
          x: getValue(monitor, 'x'),
          y: getValue(monitor, 'y'),
          width: getValue(monitor, 'width'),
          height: getValue(monitor, 'height'),
          scaleFactor: getValue(monitor, 'scaleFactor'),
          isPrimary: getValue(monitor, 'isPrimary'),
          imageBuffer: pngBuffer
        };
        
        monitorScreenshots.push(monitorData);
        console.log('[Screenshot] Captured monitor:', monitorData.id, monitorData.width, 'x', monitorData.height);
      } catch (e) {
        console.error('[Screenshot] Failed to capture monitor:', e.message);
      }
    }

    if (monitorScreenshots.length === 0) {
      console.error('[Screenshot] No monitors captured');
      return null;
    }

    return {
      type: 'node-screenshots',
      monitors: monitorScreenshots,
      displays: displays,
      totalBounds: totalBounds
    };
  } catch (error) {
    console.error('[Screenshot] node-screenshots capture failed:', error);
    return null;
  }
}

/**
 * 使用 desktopCapturer 截取屏幕（回退方案）
 */
async function captureWithDesktopCapturer(displays, primaryDisplay, totalBounds, maxScaleFactor) {
  try {
    const captureWidth = Math.round(totalBounds.totalWidth * maxScaleFactor);
    const captureHeight = Math.round(totalBounds.totalHeight * maxScaleFactor);
    
    console.log('[Screenshot] desktopCapturer size:', { captureWidth, captureHeight });
    
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: captureWidth,
        height: captureHeight,
      },
    });

    console.log('[Screenshot] desktopCapturer sources:', sources.map(s => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id,
      size: s.thumbnail.getSize()
    })));

    // 检查截图有效性
    const firstSource = sources[0];
    const thumbSize = firstSource?.thumbnail?.getSize();
    
    const expectedArea = totalBounds.totalWidth * totalBounds.totalHeight;
    const actualArea = thumbSize ? thumbSize.width * thumbSize.height : 0;
    const areaRatio = actualArea / expectedArea;
    
    const expectedAspect = totalBounds.totalWidth / totalBounds.totalHeight;
    const actualAspect = thumbSize ? thumbSize.width / thumbSize.height : 0;
    const aspectDiff = Math.abs(expectedAspect - actualAspect);
    
    const maybeInvalid = displays.length > 1 && (areaRatio < 0.8 || areaRatio > 1.2 || aspectDiff > 0.5);
    
    console.log('[Screenshot] Validity check:', {
      areaRatio: areaRatio.toFixed(2),
      aspectDiff: aspectDiff.toFixed(2),
      maybeInvalid
    });

    return {
      type: 'desktopCapturer',
      sources: sources,
      displays: displays,
      primaryDisplay: primaryDisplay,
      totalBounds: totalBounds,
      maybeInvalid: maybeInvalid
    };
  } catch (error) {
    console.error('[Screenshot] desktopCapturer capture failed:', error);
    return null;
  }
}

/**
 * 从 node-screenshots 数据中裁剪图像
 */
function cropFromNodeScreenshots(data, bounds) {
  const { monitors, displays } = data;
  
  // bounds 是 Electron 的逻辑坐标（已经除以 scaleFactor）
  // 需要找到对应的 Electron display 来获取正确的 scaleFactor
  
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  
  console.log('[Screenshot] Selection center (logical):', { centerX, centerY });
  
  // 先找到选区所在的 Electron display（使用逻辑坐标）
  let targetDisplay = displays[0];
  for (const display of displays) {
    const { x, y, width, height } = display.bounds;
    if (centerX >= x && centerX < x + width &&
        centerY >= y && centerY < y + height) {
      targetDisplay = display;
      break;
    }
  }
  
  console.log('[Screenshot] Target display (Electron):', targetDisplay.bounds, 'scaleFactor:', targetDisplay.scaleFactor);
  
  // 使用 Electron display 的 scaleFactor
  const scaleFactor = targetDisplay.scaleFactor;
  
  // 找到对应的 node-screenshots monitor
  // node-screenshots 的坐标是物理像素，需要转换
  let targetMonitor = monitors[0];
  
  // 将 Electron 的逻辑中心坐标转换为物理坐标来匹配
  const physicalCenterX = centerX * scaleFactor;
  const physicalCenterY = centerY * scaleFactor;
  
  for (const monitor of monitors) {
    // monitor 的坐标已经是物理像素
    if (physicalCenterX >= monitor.x && physicalCenterX < monitor.x + monitor.width &&
        physicalCenterY >= monitor.y && physicalCenterY < monitor.y + monitor.height) {
      targetMonitor = monitor;
      break;
    }
  }
  
  // 如果按物理坐标找不到，尝试用逻辑坐标匹配（有些系统 node-screenshots 返回逻辑坐标）
  if (targetMonitor === monitors[0]) {
    for (const monitor of monitors) {
      if (centerX >= monitor.x && centerX < monitor.x + monitor.width &&
          centerY >= monitor.y && centerY < monitor.y + monitor.height) {
        targetMonitor = monitor;
        break;
      }
    }
  }
  
  console.log('[Screenshot] Target monitor (node-screenshots):', targetMonitor.id, 
    'at', targetMonitor.x, targetMonitor.y, 
    'size:', targetMonitor.width, 'x', targetMonitor.height);
  
  // 计算选区相对于 Electron display 的逻辑偏移
  const logicalRelativeX = bounds.x - targetDisplay.bounds.x;
  const logicalRelativeY = bounds.y - targetDisplay.bounds.y;
  
  console.log('[Screenshot] Logical relative position:', { x: logicalRelativeX, y: logicalRelativeY });
  
  // 转换为物理像素坐标用于裁剪
  // 截图是物理分辨率，所以需要乘以 scaleFactor
  const cropBounds = {
    x: Math.max(0, Math.round(logicalRelativeX * scaleFactor)),
    y: Math.max(0, Math.round(logicalRelativeY * scaleFactor)),
    width: Math.round(bounds.width * scaleFactor),
    height: Math.round(bounds.height * scaleFactor)
  };
  
  // 确保不超出截图边界
  const imgWidth = targetMonitor.width;
  const imgHeight = targetMonitor.height;
  cropBounds.x = Math.min(cropBounds.x, imgWidth - 1);
  cropBounds.y = Math.min(cropBounds.y, imgHeight - 1);
  cropBounds.width = Math.min(cropBounds.width, imgWidth - cropBounds.x);
  cropBounds.height = Math.min(cropBounds.height, imgHeight - cropBounds.y);
  
  console.log('[Screenshot] Final crop bounds:', cropBounds, 'from image:', imgWidth, 'x', imgHeight);
  
  // 使用 nativeImage 裁剪
  const fullImage = nativeImage.createFromBuffer(targetMonitor.imageBuffer);
  const actualSize = fullImage.getSize();
  console.log('[Screenshot] Actual image size:', actualSize);
  
  const croppedImage = fullImage.crop(cropBounds);
  
  return croppedImage.toDataURL();
}

/**
 * 从 desktopCapturer 数据中裁剪图像
 */
function cropFromDesktopCapturer(data, bounds) {
  const { sources, displays, totalBounds, maybeInvalid } = data;
  
  const fullScreenshot = sources[0].thumbnail;
  const screenshotSize = fullScreenshot.getSize();
  
  // 如果有多 GPU 问题，尝试匹配最合适的显示器
  if (maybeInvalid && displays.length > 1) {
    console.log('[Screenshot] Multi-GPU issue detected, attempting to match display');
    
    // 根据截图宽高比猜测对应的显示器
    const thumbAspect = screenshotSize.width / screenshotSize.height;
    
    let matchedDisplay = null;
    let bestMatch = Infinity;
    
    for (const display of displays) {
      const displayAspect = (display.bounds.width * display.scaleFactor) / (display.bounds.height * display.scaleFactor);
      const diff = Math.abs(thumbAspect - displayAspect);
      if (diff < bestMatch) {
        bestMatch = diff;
        matchedDisplay = display;
      }
    }
    
    if (matchedDisplay) {
      console.log('[Screenshot] Matched display:', matchedDisplay.bounds);
      
      const relativeX = bounds.x - matchedDisplay.bounds.x;
      const relativeY = bounds.y - matchedDisplay.bounds.y;
      
      const scaleX = screenshotSize.width / matchedDisplay.bounds.width;
      const scaleY = screenshotSize.height / matchedDisplay.bounds.height;
      
      let cropBounds = {
        x: Math.round(relativeX * scaleX),
        y: Math.round(relativeY * scaleY),
        width: Math.round(bounds.width * scaleX),
        height: Math.round(bounds.height * scaleY),
      };
      
      // 边界检查
      cropBounds.x = Math.max(0, Math.min(cropBounds.x, screenshotSize.width - 1));
      cropBounds.y = Math.max(0, Math.min(cropBounds.y, screenshotSize.height - 1));
      cropBounds.width = Math.max(1, Math.min(cropBounds.width, screenshotSize.width - cropBounds.x));
      cropBounds.height = Math.max(1, Math.min(cropBounds.height, screenshotSize.height - cropBounds.y));
      
      console.log('[Screenshot] Crop bounds (multi-GPU):', cropBounds);
      
      const croppedImage = fullScreenshot.crop(cropBounds);
      return croppedImage.toDataURL();
    }
  }
  
  // 正常模式：使用总边界计算
  const scaleX = screenshotSize.width / totalBounds.totalWidth;
  const scaleY = screenshotSize.height / totalBounds.totalHeight;
  
  const relativeX = bounds.x - totalBounds.minX;
  const relativeY = bounds.y - totalBounds.minY;
  
  let cropBounds = {
    x: Math.round(relativeX * scaleX),
    y: Math.round(relativeY * scaleY),
    width: Math.round(bounds.width * scaleX),
    height: Math.round(bounds.height * scaleY),
  };
  
  // 边界检查
  cropBounds.x = Math.max(0, Math.min(cropBounds.x, screenshotSize.width - 1));
  cropBounds.y = Math.max(0, Math.min(cropBounds.y, screenshotSize.height - 1));
  cropBounds.width = Math.max(1, Math.min(cropBounds.width, screenshotSize.width - cropBounds.x));
  cropBounds.height = Math.max(1, Math.min(cropBounds.height, screenshotSize.height - cropBounds.y));
  
  console.log('[Screenshot] Crop bounds (normal):', cropBounds);
  
  const croppedImage = fullScreenshot.crop(cropBounds);
  return croppedImage.toDataURL();
}

/**
 * 处理选区并返回裁剪后的图像
 */
function processSelection(bounds) {
  if (!screenshotData) {
    throw new Error('没有预先截取的屏幕图像');
  }
  
  console.log('[Screenshot] Processing selection:', bounds);
  console.log('[Screenshot] Data type:', screenshotData.type);
  
  if (screenshotData.type === 'node-screenshots') {
    return cropFromNodeScreenshots(screenshotData, bounds);
  } else {
    return cropFromDesktopCapturer(screenshotData, bounds);
  }
}

/**
 * 检查 node-screenshots 是否可用
 */
function isNodeScreenshotsAvailable() {
  return nodeScreenshots !== null;
}

module.exports = {
  getScreenshotData,
  setScreenshotData,
  clearScreenshotData,
  getScreenshotWindow,
  setScreenshotWindow,
  captureWithNodeScreenshots,
  captureWithDesktopCapturer,
  processSelection,
  isNodeScreenshotsAvailable,
  
  /**
   * 截取指定区域（用于玻璃翻译窗口）
   * @param {Object} bounds - { x, y, width, height }
   * @returns {Promise<string|null>} - base64 图片数据
   */
  async captureRegion(bounds) {
    try {
      if (!nodeScreenshots) {
        console.error('[Screenshot] node-screenshots not available for captureRegion');
        return null;
      }
      
      const { Monitor } = nodeScreenshots;
      const { screen, nativeImage } = require('electron');
      
      // 获取 Electron 的 displays 信息（逻辑坐标）
      const displays = screen.getAllDisplays();
      
      // 获取 node-screenshots 的 monitors
      const monitors = Monitor.all();
      
      if (monitors.length === 0) {
        console.error('[Screenshot] No monitors found');
        return null;
      }
      
      // 处理 monitors 数据
      const processedMonitors = monitors.map(m => {
        const getValue = (obj, key) => typeof obj[key] === 'function' ? obj[key]() : obj[key];
        return {
          id: getValue(m, 'id'),
          x: getValue(m, 'x'),
          y: getValue(m, 'y'),
          width: getValue(m, 'width'),
          height: getValue(m, 'height'),
          scaleFactor: getValue(m, 'scaleFactor') || 1,
          monitor: m
        };
      });
      
      console.log('[Screenshot] Electron displays:', displays.map(d => ({
        bounds: d.bounds,
        scaleFactor: d.scaleFactor
      })));
      console.log('[Screenshot] node-screenshots monitors:', processedMonitors.map(m => ({
        id: m.id, x: m.x, y: m.y, width: m.width, height: m.height
      })));
      
      // 找到选区中心点
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      
      console.log('[Screenshot] Selection center (logical):', { centerX, centerY });
      
      // 找到选区所在的 Electron display（使用逻辑坐标）
      let targetDisplay = displays[0];
      for (const display of displays) {
        const { x, y, width, height } = display.bounds;
        if (centerX >= x && centerX < x + width &&
            centerY >= y && centerY < y + height) {
          targetDisplay = display;
          break;
        }
      }
      
      console.log('[Screenshot] Target display (Electron):', targetDisplay.bounds, 'scaleFactor:', targetDisplay.scaleFactor);
      
      // 使用 Electron display 的 scaleFactor
      const scaleFactor = targetDisplay.scaleFactor;
      
      // 找到对应的 node-screenshots monitor
      let targetMonitor = processedMonitors[0];
      
      // 将 Electron 的逻辑中心坐标转换为物理坐标来匹配
      const physicalCenterX = centerX * scaleFactor;
      const physicalCenterY = centerY * scaleFactor;
      
      for (const monitor of processedMonitors) {
        if (physicalCenterX >= monitor.x && physicalCenterX < monitor.x + monitor.width &&
            physicalCenterY >= monitor.y && physicalCenterY < monitor.y + monitor.height) {
          targetMonitor = monitor;
          break;
        }
      }
      
      // 如果按物理坐标找不到，尝试用逻辑坐标匹配
      if (targetMonitor === processedMonitors[0]) {
        for (const monitor of processedMonitors) {
          if (centerX >= monitor.x && centerX < monitor.x + monitor.width &&
              centerY >= monitor.y && centerY < monitor.y + monitor.height) {
            targetMonitor = monitor;
            break;
          }
        }
      }
      
      console.log('[Screenshot] Target monitor:', targetMonitor.id, 
        'at', targetMonitor.x, targetMonitor.y, 
        'size:', targetMonitor.width, 'x', targetMonitor.height);
      
      // 截取目标显示器
      const image = targetMonitor.monitor.captureImageSync();
      const pngBuffer = image.toPngSync();
      
      // 计算选区相对于 Electron display 的逻辑偏移
      const logicalRelativeX = bounds.x - targetDisplay.bounds.x;
      const logicalRelativeY = bounds.y - targetDisplay.bounds.y;
      
      console.log('[Screenshot] Logical relative position:', { x: logicalRelativeX, y: logicalRelativeY });
      
      // 转换为物理像素坐标用于裁剪
      const cropBounds = {
        x: Math.max(0, Math.round(logicalRelativeX * scaleFactor)),
        y: Math.max(0, Math.round(logicalRelativeY * scaleFactor)),
        width: Math.round(bounds.width * scaleFactor),
        height: Math.round(bounds.height * scaleFactor)
      };
      
      // 确保不超出截图边界
      const imgWidth = targetMonitor.width;
      const imgHeight = targetMonitor.height;
      cropBounds.x = Math.min(cropBounds.x, imgWidth - 1);
      cropBounds.y = Math.min(cropBounds.y, imgHeight - 1);
      cropBounds.width = Math.min(cropBounds.width, imgWidth - cropBounds.x);
      cropBounds.height = Math.min(cropBounds.height, imgHeight - cropBounds.y);
      
      console.log('[Screenshot] Final crop bounds:', cropBounds, 'from image:', imgWidth, 'x', imgHeight);
      
      // 使用 nativeImage 裁剪
      const fullImage = nativeImage.createFromBuffer(pngBuffer);
      const actualSize = fullImage.getSize();
      console.log('[Screenshot] Actual image size:', actualSize);
      
      const croppedImage = fullImage.crop(cropBounds);
      
      return croppedImage.toDataURL();
    } catch (error) {
      console.error('[Screenshot] captureRegion error:', error);
      return null;
    }
  }
};
