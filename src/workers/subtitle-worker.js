// src/workers/subtitle-worker.js
// 字幕模式 Web Worker - 处理图片哈希和去重
// 避免阻塞主线程，解决 Long Task 问题

/**
 * 计算图片的差异哈希 (dHash)
 * 比较相邻像素的亮度差异，生成 64 位哈希
 * 
 * @param {ImageData} imageData - 图片数据
 * @returns {string} 64 位二进制哈希字符串
 */
function calculateDHash(imageData) {
  const { data, width, height } = imageData;
  
  // 缩小到 9x8 的灰度图（需要 9 列来比较得到 8 个差异）
  const resizedWidth = 9;
  const resizedHeight = 8;
  const grayscale = new Uint8Array(resizedWidth * resizedHeight);
  
  // 计算缩放比例
  const xRatio = width / resizedWidth;
  const yRatio = height / resizedHeight;
  
  // 采样并转换为灰度
  for (let y = 0; y < resizedHeight; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      // 采样原图对应位置
      const srcX = Math.floor(x * xRatio);
      const srcY = Math.floor(y * yRatio);
      const srcIdx = (srcY * width + srcX) * 4;
      
      // RGB 转灰度 (加权平均)
      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      
      grayscale[y * resizedWidth + x] = gray;
    }
  }
  
  // 比较相邻像素生成哈希
  let hash = '';
  for (let y = 0; y < resizedHeight; y++) {
    for (let x = 0; x < resizedWidth - 1; x++) {
      const left = grayscale[y * resizedWidth + x];
      const right = grayscale[y * resizedWidth + x + 1];
      hash += left > right ? '1' : '0';
    }
  }
  
  return hash;
}

/**
 * 计算两个哈希的汉明距离
 * 
 * @param {string} hash1 
 * @param {string} hash2 
 * @returns {number} 不同位的数量
 */
function hammingDistance(hash1, hash2) {
  if (hash1.length !== hash2.length) return 64; // 最大距离
  
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  return distance;
}

/**
 * 计算两个字符串的 Levenshtein 距离（编辑距离）
 * 用于文本去重
 * 
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} 编辑距离
 */
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  
  // 空字符串情况
  if (m === 0) return n;
  if (n === 0) return m;
  
  // 使用两行数组优化空间
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  
  // 初始化第一行
  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }
  
  // 填充矩阵
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // 删除
        curr[j - 1] + 1,  // 插入
        prev[j - 1] + cost // 替换
      );
    }
    [prev, curr] = [curr, prev]; // 交换
  }
  
  return prev[n];
}

/**
 * 计算文本相似度 (0-100%)
 */
function textSimilarity(str1, str2) {
  if (!str1 && !str2) return 100;
  if (!str1 || !str2) return 0;
  
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 100;
  
  const distance = levenshteinDistance(str1, str2);
  return Math.round((1 - distance / maxLen) * 100);
}

/**
 * 从 ImageData 提取区域
 */
function extractRegion(imageData, region) {
  const { data, width } = imageData;
  const { x, y, w, h } = region;
  
  const regionData = new Uint8ClampedArray(w * h * 4);
  
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const srcIdx = ((y + row) * width + (x + col)) * 4;
      const dstIdx = (row * w + col) * 4;
      
      regionData[dstIdx] = data[srcIdx];
      regionData[dstIdx + 1] = data[srcIdx + 1];
      regionData[dstIdx + 2] = data[srcIdx + 2];
      regionData[dstIdx + 3] = data[srcIdx + 3];
    }
  }
  
  return new ImageData(regionData, w, h);
}

// Worker 消息处理
self.onmessage = function(e) {
  const { type, payload, id } = e.data;
  
  try {
    switch (type) {
      case 'CALCULATE_HASH': {
        // 计算图片哈希
        const { imageData } = payload;
        const hash = calculateDHash(imageData);
        self.postMessage({ type: 'HASH_RESULT', id, payload: { hash } });
        break;
      }
      
      case 'COMPARE_HASH': {
        // 比较两个哈希
        const { hash1, hash2, threshold = 10 } = payload;
        const distance = hammingDistance(hash1, hash2);
        const isSimilar = distance <= threshold;
        self.postMessage({ 
          type: 'COMPARE_RESULT', 
          id, 
          payload: { distance, isSimilar, threshold } 
        });
        break;
      }
      
      case 'COMPARE_TEXT': {
        // 比较两段文本
        const { text1, text2, threshold = 80 } = payload;
        const similarity = textSimilarity(text1, text2);
        const isSimilar = similarity >= threshold;
        self.postMessage({ 
          type: 'TEXT_COMPARE_RESULT', 
          id, 
          payload: { similarity, isSimilar, threshold } 
        });
        break;
      }
      
      case 'EXTRACT_REGION': {
        // 提取图片区域
        const { imageData, region } = payload;
        const regionData = extractRegion(imageData, region);
        self.postMessage({ 
          type: 'REGION_RESULT', 
          id, 
          payload: { imageData: regionData } 
        });
        break;
      }
      
      default:
        self.postMessage({ 
          type: 'ERROR', 
          id, 
          payload: { error: `Unknown message type: ${type}` } 
        });
    }
  } catch (error) {
    self.postMessage({ 
      type: 'ERROR', 
      id, 
      payload: { error: error.message } 
    });
  }
};

// Worker 就绪
self.postMessage({ type: 'READY' });
