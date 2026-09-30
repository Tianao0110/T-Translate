// Page preview overlay placement (components/DocumentTranslator/PagePreview.jsx).

import { describe, it, expect } from 'vitest';
import { highlightStyle } from '../../../src/components/DocumentTranslator/PagePreview.jsx';

describe('highlightStyle', () => {
  it('turns a page-fraction box into percentage offsets and size', () => {
    expect(highlightStyle([0.1, 0.25, 0.6, 0.3])).toEqual({
      left: '10.00%',
      top: '25.00%',
      width: '50.00%',
      height: '5.00%',
    });
  });
});
