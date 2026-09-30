// Prompt echo: a small model that "translates" the system prompt's
// requirement list instead of the text. service.js checks each successful
// non-streaming result and retries once with the short user-only prompt.
// Why and the samples it was built from: docs/design/stack.md §2.

const LIST_LINE = /^\s*(?:[-•*·]|\d{1,2}[.)])\s+\S/u;
const MARKER_EXAMPLE = '⟦...⟧';

function listLines(text) {
  return (text || '').split('\n').filter((line) => LIST_LINE.test(line)).length;
}

// The short-prompt retry sometimes translates its own one-line instruction
// ahead of the text: "<instruction>:" + blank line + translation. Dropped
// unless the source itself opens that way.
export function stripInstructionLead(output, source) {
  const lead = (output || '').match(/^([^\n]*[:：])[^\S\n]*\n[^\S\n]*\n([\s\S]+)$/u);
  if (!lead) return output;
  const text = source || '';
  if (/\n\s*\n/.test(text) || /[:：]\s*$/.test(text.split('\n')[0])) return output;
  return lead[2].trim();
}

// output: the model's answer; source: the text as sent (after marker
// protection); prompt: the system prompt content used for the request.
export function isPromptEcho(output, source, prompt) {
  if (!output) return false;
  if (output.includes(MARKER_EXAMPLE) && !(source || '').includes(MARKER_EXAMPLE)) return true;
  return listLines(prompt) >= 3 && listLines(output) >= 3 && listLines(source) < 2;
}
