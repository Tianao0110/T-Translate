// Image helpers: hashing for dedupe, base64 conversion.

// Sample-based hash (every 100th byte) — cheap and good enough to detect
// "same screenshot as last tick" for the glass refresh loop. Not cryptographic.
export async function calculateHash(imageData) {
  try {
    let buffer;

    if (typeof imageData === 'string') {
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

export function compareHash(hash1, hash2, threshold = 5) {
  if (!hash1 || !hash2) return false;
  if (hash1 === hash2) return true;

  const diff = Math.abs(parseInt(hash1, 16) - parseInt(hash2, 16));
  return diff < threshold;
}

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

export function base64ToBytes(base64) {
  const data = base64.split(',')[1] || base64;
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Base64 inflates raw bytes by 4/3; return approximate KB
export function estimateBase64Size(base64) {
  if (!base64) return 0;
  const data = base64.split(',')[1] || base64;
  return Math.round((data.length * 3) / 4 / 1024);
}

export default {
  calculateHash,
  compareHash,
  ensureBase64,
  base64ToBytes,
  estimateBase64Size,
};
