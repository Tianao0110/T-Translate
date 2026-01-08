// src/utils/image.js
// 图片处理工具函数

/**
 * 计算图片哈希（用于去重）
 * @param {string|Uint8Array} imageData - base64 或二进制图片数据
 * @returns {Promise<string>} 哈希值
 */
export async function calculateHash(imageData) {
  try {
    let buffer;
    
    if (typeof imageData === 'string') {
      // base64 转换
      const base64 = imageData.split(',')[1] || imageData;
      const binary = atob(base64);
      buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        buffer[i] = binary.charCodeAt(i);
      }
    } else if (imageData instanceof Uint8Array) {
      buffer = imageData;
    } else if (imageData instanceof ArrayBuffer) {
      buffer = new Uint8Array(imageData);
    } else {
      return Math.random().toString(36);
    }
    
    // 采样计算哈希（每隔 100 字节取一个，平衡速度和精度）
    let hash = 0;
    for (let i = 0; i < buffer.length; i += 100) {
      hash = ((hash << 5) - hash + buffer[i]) | 0;
    }
    
    return hash.toString(16);
  } catch (error) {
    console.warn('[Image] Hash calculation failed:', error);
    return Math.random().toString(36);
  }
}

/**
 * 比较两个哈希是否相似
 * @param {string} hash1 
 * @param {string} hash2 
 * @param {number} threshold - 汉明距离阈值
 * @returns {boolean}
 */
export function compareHash(hash1, hash2, threshold = 5) {
  if (!hash1 || !hash2) return false;
  if (hash1 === hash2) return true;
  
  // 简单字符串比较（用于我们的简单哈希）
  // 如果哈希完全相同或只差一点，认为相似
  const diff = Math.abs(parseInt(hash1, 16) - parseInt(hash2, 16));
  return diff < threshold;
}

/**
 * 确保图片数据是 base64 格式
 * @param {string|Uint8Array|ArrayBuffer} input 
 * @returns {string} base64 data URL
 */
export function ensureBase64(input) {
  if (typeof input === 'string') {
    if (input.startsWith('data:')) {
      return input;
    }
    return `data:image/png;base64,${input}`;
  }
  
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:image/png;base64,${btoa(binary)}`;
  }
  
  return input;
}

/**
 * 从 base64 提取二进制数据
 * @param {string} base64 - data URL 或纯 base64
 * @returns {Uint8Array}
 */
export function base64ToBytes(base64) {
  const data = base64.split(',')[1] || base64;
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 估算 base64 图片大小（KB）
 * @param {string} base64 
 * @returns {number}
 */
export function estimateBase64Size(base64) {
  if (!base64) return 0;
  const data = base64.split(',')[1] || base64;
  // base64 编码后大约是原始大小的 4/3
  return Math.round((data.length * 3) / 4 / 1024);
}

export default {
  calculateHash,
  compareHash,
  ensureBase64,
  base64ToBytes,
  estimateBase64Size,
};
