// Page (MAIN) world at document_start. The media and caption hooks land here
// later; for now only a marker that the script ran, nothing is patched.

Object.defineProperty(window, '__tCaption', {
  value: Object.freeze({ world: 'main', stage: 'scaffold' }),
  configurable: true,
});
