// The `stack` object a window's preload exposes: the main-process translation
// stack behind stack:* IPC (ipc/translation-stack.js is the other end). No
// privacyMode / useCache here — the facade injects them. `keys` narrows the
// surface for windows that only translate.

function stackBridge(ipcRenderer, keys = null) {
  const all = {
    translate: (payload) => ipcRenderer.invoke("stack:translate", payload),
    streamStart: (payload) => ipcRenderer.invoke("stack:translate-stream-start", payload),
    abort: (id) => ipcRenderer.invoke("stack:abort", { id }),
    chat: (payload) => ipcRenderer.invoke("stack:chat", payload),
    chatCapability: () => ipcRenderer.invoke("stack:chat-capability"),
    testProvider: (providerId) => ipcRenderer.invoke("stack:test-provider", { providerId }),
    testProviderConfig: (providerId, config) =>
      ipcRenderer.invoke("stack:test-provider-config", { providerId, config }),
    providersStatus: () => ipcRenderer.invoke("stack:providers-status"),
    readiness: () => ipcRenderer.invoke("stack:readiness"),
    currentProvider: () => ipcRenderer.invoke("stack:current-provider"),
    reload: () => ipcRenderer.invoke("stack:reload"),
    clearCache: (level) => ipcRenderer.invoke("stack:clear-cache", { level }),
    cacheStats: () => ipcRenderer.invoke("stack:cache-stats"),
    ocrRecognize: (imageData, options) =>
      ipcRenderer.invoke("stack:ocr-recognize", { imageData, options }),
    ocrResetVision: () => ipcRenderer.invoke("stack:ocr-reset-vision"),
    visionChat: (messages, imageData, options) =>
      ipcRenderer.invoke("stack:vision-chat", { messages, imageData, options }),
    visionCapability: () => ipcRenderer.invoke("stack:vision-capability"),
    // External TTS endpoint (tts/endpoint.js). Audio comes back as bytes;
    // playback stays in the renderer, the request never leaves main.
    ttsCapability: () => ipcRenderer.invoke("stack:tts-capability"),
    ttsSpeak: (payload) => ipcRenderer.invoke("stack:tts-speak", payload),
    ttsTest: (config) => ipcRenderer.invoke("stack:tts-test", { config }),
    onStreamChunk: (callback) => {
      const handler = (event, frame) => callback(frame);
      ipcRenderer.on("stack:stream-chunk", handler);
      return () => ipcRenderer.removeListener("stack:stream-chunk", handler);
    },
    onChanged: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("stack:changed", handler);
      return () => ipcRenderer.removeListener("stack:changed", handler);
    },
  };
  if (!keys) return all;
  return Object.fromEntries(keys.map((k) => [k, all[k]]));
}

module.exports = { stackBridge };
