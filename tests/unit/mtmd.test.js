// The DLL-free parts of the vision path: the prompt per family and the
// Spotting parser that turns <|LOC_n|> quadrilaterals into pixel boxes.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { renderVisionPrompt, parseSpotting } = require('../../electron/tengine/runtime/mtmd.js');

describe('renderVisionPrompt', () => {
  it('renders the PaddleOCR-VL template around the media marker', () => {
    expect(renderVisionPrompt('paddleocr', '<__media__>', 'Spotting')).toBe('<|begin_of_sentence|>User: <__media__>Spotting:\nAssistant:\n');
  });

  it('refuses a family it has no template for', () => {
    expect(() => renderVisionPrompt('qwen3', '<__media__>', 'OCR')).toThrow(expect.objectContaining({ code: 'LLM_VISION_UNSUPPORTED' }));
  });
});

describe('parseSpotting', () => {
  // Real model output for a 700x200 image whose labels were drawn at known spots.
  const output = [
    '文件<|LOC_64|><|LOC_96|><|LOC_130|><|LOC_96|><|LOC_130|><|LOC_224|><|LOC_64|><|LOC_224|>',
    'Translate now<|LOC_736|><|LOC_108|><|LOC_942|><|LOC_108|><|LOC_942|><|LOC_210|><|LOC_736|><|LOC_210|>',
    '',
    'Cancel<|LOC_738|><|LOC_704|><|LOC_836|><|LOC_704|><|LOC_836|><|LOC_808|><|LOC_738|><|LOC_808|>',
  ].join('\n');

  it('scales the 0..999 grid to pixels and keeps the reading order', () => {
    const lines = parseSpotting(output, 700, 200);
    expect(lines.map((l) => l.text)).toEqual(['文件', 'Translate now', 'Cancel']);
    expect(lines[0].box).toEqual([45, 19, 91, 45]);
    expect(lines[2].box).toEqual([517, 141, 585, 162]);
  });

  it('keeps text without a complete box and drops box-only lines', () => {
    const lines = parseSpotting('plain line\n<|LOC_1|><|LOC_2|><|LOC_3|><|LOC_4|><|LOC_5|><|LOC_6|><|LOC_7|><|LOC_8|>\nhalf<|LOC_9|><|LOC_9|>', 100, 100);
    expect(lines).toEqual([{ text: 'plain line', box: null }, { text: 'half', box: null }]);
  });

  it('normalises a quadrilateral given in any point order', () => {
    const lines = parseSpotting('x<|LOC_900|><|LOC_500|><|LOC_100|><|LOC_500|><|LOC_100|><|LOC_100|><|LOC_900|><|LOC_100|>', 1000, 1000);
    expect(lines[0].box).toEqual([100, 100, 900, 500]);
  });
});
