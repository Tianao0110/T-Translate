// Shared AI-analysis helpers for the favorites/save flows. Two components
// used to carry verbatim copies of these (and the favorites copy was
// Chinese-only); keep prompt + reply parsing in one place.

import i18n from 'i18next';

// Prompts switch by UI language so the LLM returns tags in the user's language
export function getAnalysisPrompts(sourceText, translatedText) {
  const lang = i18n.language || 'zh';
  const isZh = lang.startsWith('zh');

  const systemPrompt = isZh
    ? `你是一个智能标签和摘要生成助手。根据用户提供的原文和译文，生成合适的标签和摘要。

请严格按照以下 JSON 格式返回，不要包含任何其他内容：
{
  "tags": ["标签1", "标签2", "标签3"],
  "summary": "简短摘要（20字以内）",
  "isStyleSuggested": true/false
}

标签规则：
- 生成 3-5 个相关标签
- 标签应该反映内容的主题、领域、风格等
- 使用中文标签

摘要规则：
- 20字以内的简短描述
- 概括内容的核心特点

风格参考判断规则（isStyleSuggested）：
- 如果文本具有独特的文学风格、修辞手法、或值得模仿的表达方式，返回 true
- 如果只是普通的术语、短语、或日常表达，返回 false
- 长度超过 30 字且有明显风格特点的文本更适合作为风格参考`
    : `You are a smart tag and summary generator. Based on the source text and translation provided, generate appropriate tags and a summary.

Return STRICTLY in the following JSON format with no other content:
{
  "tags": ["tag1", "tag2", "tag3"],
  "summary": "Brief summary (under 10 words)",
  "isStyleSuggested": true/false
}

Tag rules:
- Generate 3-5 relevant tags
- Tags should reflect the topic, domain, and style of the content
- Use English tags

Summary rules:
- A brief description under 10 words
- Capture the core meaning of the content

Style reference rules (isStyleSuggested):
- Return true if the text has a distinctive literary style, rhetorical devices, or expressions worth imitating
- Return false if it is just common terms, phrases, or everyday expressions
- Texts longer than 30 words with clear stylistic features are more suitable as style references`;

  const userPrompt = isZh
    ? `原文：${sourceText}\n译文：${translatedText}\n\n请分析并返回 JSON 格式的标签、摘要和风格建议。`
    : `Source: ${sourceText}\nTranslation: ${translatedText}\n\nAnalyze and return tags, summary, and style suggestion in JSON format.`;

  return { systemPrompt, userPrompt };
}

// LLMs often wrap JSON in ``` fences despite being told not to. Throws on
// unparseable replies — callers decide their own fallback.
export function parseJsonReply(content) {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
  cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
  return JSON.parse(cleaned);
}
