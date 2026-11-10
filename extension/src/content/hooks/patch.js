// Page-world patching that the page cannot tell from the original: each hook
// is a Proxy of the browser's function (same name, length, [native code]
// toString), the original runs exactly as before and its result or exception
// goes back untouched; our observer runs afterwards and never throws.

// Replaces owner[name] with a Proxy of it; observe(result, self, args) runs
// after a call that returned. False when there is nothing to patch.
export function hookMethod(owner, name, observe, { before = null } = {}) {
  const desc = owner ? Object.getOwnPropertyDescriptor(owner, name) : null;
  if (!desc || typeof desc.value !== 'function') return false;
  const proxy = new Proxy(desc.value, {
    apply(target, self, args) {
      if (before) {
        try {
          before(self, args);
        } catch {}
      }
      const result = Reflect.apply(target, self, args);
      try {
        observe(result, self, args);
      } catch {}
      return result;
    },
  });
  Object.defineProperty(owner, name, { ...desc, value: proxy });
  return true;
}

// Same for an accessor's setter: observe(self, value) after the set returned.
export function hookSetter(owner, name, observe) {
  const desc = owner ? Object.getOwnPropertyDescriptor(owner, name) : null;
  if (!desc || typeof desc.set !== 'function') return false;
  const set = new Proxy(desc.set, {
    apply(target, self, args) {
      const result = Reflect.apply(target, self, args);
      try {
        observe(self, args[0]);
      } catch {}
      return result;
    },
  });
  Object.defineProperty(owner, name, { ...desc, set });
  return true;
}

// Runs install() and turns the outcome into 'ok' / 'absent' / 'failed'.
export function tryHook(install) {
  try {
    return install() ? 'ok' : 'absent';
  } catch {
    return 'failed';
  }
}
