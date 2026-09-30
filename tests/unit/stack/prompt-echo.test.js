// Prompt-echo detection (src/stack/prompt-echo.js), on answers the built-in
// Qwen3-1.7B actually gave during the 2026-09-29 document timing run.

import { describe, it, expect } from 'vitest';
import { isPromptEcho, stripInstructionLead } from '../../../src/stack/prompt-echo.js';
import { getSystemPrompt } from '../../../src/config/templates.js';

const PROMPT = `${getSystemPrompt('natural', 'zh').content}\n- Output language: Chinese (Simplified). Never answer in any other language.`;

const ECHOES = [
  '要求：\n- 使用自然、口语化的语气\n- 保持原意和语境\n- 只输出翻译，不添加任何解释或注释\n- 不翻译内容中的特殊标记如 ⟦...⟧\n- 输出语言：简体中文。不要用任何其他语言回答',
  '要求：\n- 使用自然、口语化的语气\n- 保持原意和语气\n- 只输出翻译，不添加任何解释或注释\n- 不要翻译特殊标记内的内容\n- 输出语言：简体中文。不要用其他语言回答',
];

describe('isPromptEcho', () => {
  it('flags the translated requirement list', () => {
    for (const output of ECHOES) {
      expect(isPromptEcho(output, ', 1980; Van Wyk, 1987; Bosch and Von Gadow, 1990;', PROMPT)).toBe(true);
    }
  });

  it('leaves real translations alone', () => {
    expect(isPromptEcho('南非的研究表明，造林会减少水流。', 'Research from South Africa shows afforestation reduces flow.', PROMPT)).toBe(false);
  });

  it('allows lists that the source already has', () => {
    const source = 'Main changes:\n- faster start\n- smaller files\n- new icons';
    expect(isPromptEcho('主要变化：\n- 启动更快\n- 文件更小\n- 新图标', source, PROMPT)).toBe(false);
  });

  it('keeps protected markers that the source carries', () => {
    expect(isPromptEcho('运行 ⟦0⟧ 之后重启', 'Run ⟦0⟧ and restart', PROMPT)).toBe(false);
    expect(isPromptEcho('示例 ⟦...⟧', 'Example ⟦...⟧', PROMPT)).toBe(false);
  });

  it('drops a translated instruction line ahead of the retry answer', () => {
    const answer = '将以下内容翻译成简体中文，语气自然、口语化，仅输出翻译结果，不加任何解释：\n\n(1) 将观测到的 FDC 百分位数时间序列拟合模型';
    expect(stripInstructionLead(answer, '(1) fit a model to the observed annual time series of FDC percentiles'))
      .toBe('(1) 将观测到的 FDC 百分位数时间序列拟合模型');
  });

  it('keeps a colon lead the source already has', () => {
    const answer = '主要变化：\n\n启动更快';
    expect(stripInstructionLead(answer, 'Main changes:\n\nfaster start')).toBe(answer);
    expect(stripInstructionLead('结果如下：数值 3.75', 'The results are as follows: 3.75')).toBe('结果如下：数值 3.75');
  });

  it('does not read a list into a prompt that has none', () => {
    const short = 'Translate the following text into Chinese (Simplified) in a natural tone. ONLY output the translated result without any explanation:';
    expect(isPromptEcho('- 一\n- 二\n- 三', 'one two three', short)).toBe(false);
  });
});
