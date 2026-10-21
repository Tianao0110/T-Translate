// What the explain path is handed (src/ai/content-kind.js): code, a stack
// trace, a formula, or ordinary text. The negatives matter most — anything
// that looks only a little like code or maths must stay 'text' and be
// translated as before.

import { describe, it, expect } from 'vitest';
import { classifyContent } from '../../../src/ai/content-kind.js';

const kinds = (samples) => samples.map((s) => [s, classifyContent(s)]);
const all = (samples, kind) => expect(kinds(samples).filter(([, k]) => k !== kind)).toEqual([]);

describe('code', () => {
  it('recognizes code in common languages', () => {
    all([
      `function using(promise, fn) {\n  busy.set(promise, (busy.get(promise) || 0) + 1);\n  try {\n    return await fn(await promise);\n  } finally {\n    release(promise);\n  }\n}`,
      'const doubled = items.map((x) => x * 2);',
      'def greet(name):\n    if not name:\n        return None\n    return f"Hello, {name}"',
      'public static int add(int a, int b) {\n    return a + b;\n}',
      'SELECT name, age FROM users WHERE age > 18 ORDER BY name;',
      '<div class="card">\n  <span class="title">{{ title }}</span>\n</div>',
      '#include <stdio.h>\nint main(void) {\n  printf("hi");\n  return 0;\n}',
      'func add(a int, b int) int {\n\treturn a + b\n}',
      'fn main() {\n    let x = 5;\n    println!("{}", x);\n}',
      '#!/bin/bash\nset -e\nnpm ci\nnpm test',
      "// 取用户列表\nconst users = await api.get('/users');\nif (!users.length) return [];",
      'interface User {\n  id: number;\n  name: string;\n}',
    ], 'code');
  });
});

describe('error', () => {
  it('recognizes stack traces and tracebacks', () => {
    all([
      "TypeError: Cannot read properties of undefined (reading 'map')\n    at App (App.jsx:12:15)\n    at renderWithHooks (react-dom.development.js:16305:18)",
      'Traceback (most recent call last):\n  File "main.py", line 3, in <module>\n    print(1 / 0)\nZeroDivisionError: division by zero',
      'Exception in thread "main" java.lang.NullPointerException\n\tat com.example.App.main(App.java:14)',
    ], 'error');
  });

  it('a single-line error message is still translated', () => {
    expect(classifyContent("TypeError: Cannot read properties of undefined (reading 'map')")).toBe('text');
  });
});

describe('formula', () => {
  it('recognizes equations, expressions and LaTeX', () => {
    all([
      'x^2 - 5x + 6 = 0',
      '2x + 3 = 7',
      'E = mc^2',
      'y = mx + b',
      'σ(x) = 1/(1+e^-x)',
      'a² + b² = c²',
      'f(x) = sin(x) + cos(x)',
      '∫ x dx',
      '\\frac{\\partial L}{\\partial w}',
      '\\sum_{i=1}^{n} i',
      '解方程 x²-5x+6=0',
    ], 'formula');
  });
});

describe('ordinary text', () => {
  it('prose in any script stays text', () => {
    all([
      'Pinned screenshots stay on top of other windows while the translation covers the original.',
      'Run `npm install` and then call `init()` to start the app.',
      '这个功能会在你选中文字后弹出翻译卡片。',
      '价格是 $12.99（含税），折扣 20%。',
      '其中 x 表示时间，y 表示距离',
      'The value of x depends on the input size and the cache hit rate.',
      'Set retries = 3 in the config file before running.',
      '- Fix the bug\n- Add tests\n- Update docs',
      'Settings -> Selection -> Enable',
      'This value is null when the user is logged out.',
      'Check the log if (and only if) the sync fails.',
      '1. Open settings\n2. Turn on GPU acceleration\n3. Restart the app',
      '# 使用说明\n选中文字后会弹出翻译卡片。',
    ], 'text');
  });

  it('numbers, codes and identifiers are not maths or code', () => {
    all([
      '2026-10-21', '12:30', 'v0.5.5', '192.168.1.1', '+86 138-0000-0000', '$12.99', '45%',
      'x86-64', 'COVID-19', 'B-2', 'A4', '2 + 3 = 5',
      'maxRetryCount', 'user_name',
      'https://github.com/Tianao0110/T-Translate/releases',
      'npm install --save-dev vitest',
    ], 'text');
  });

  it('empty or non-string input is text', () => {
    expect(classifyContent('')).toBe('text');
    expect(classifyContent('   ')).toBe('text');
    expect(classifyContent(null)).toBe('text');
  });
});
