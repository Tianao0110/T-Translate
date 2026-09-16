// Sample-based image hash (every 100th byte): cheap "same screenshot as last
// tick" check for the floating window's refresh loop. Not cryptographic.

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
