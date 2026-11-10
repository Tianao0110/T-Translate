// Toolbar badge. Without a tab: a coloured dot for the channel state (grey
// unpaired, amber offline, green ready) and the state in words as the
// tooltip. Per tab: what the orchestrator does there, as a short glyph over
// the channel colour, with the tooltip saying so; a tab waiting for the
// video's host to be allowed shows an amber '!' (the popup has the button).

import { CLIENT_STATUS } from '../shared/protocol.js';
import { describeState } from '../shared/status-text.js';

export const BADGE_COLORS = {
  [CLIENT_STATUS.UNPAIRED]: '#9aa0a6',
  [CLIENT_STATUS.OFFLINE]: '#e8a400',
  [CLIENT_STATUS.READY]: '#1e8e3e',
};

const TAB_BADGE = {
  captions: { text: 'badgeCaptions', title: 'titleCaptions' },
  listening: { text: 'badgeListening', title: 'titleListening' },
  off: { text: 'badgeOff', title: 'titleOff', color: '#9aa0a6' },
  prompt: { text: 'badgeListening', title: 'titlePrompt', color: '#e8a400' },
  suspended: { text: null, title: 'titleSuspended' },
};
const PERMISSION_BADGE = { glyph: '!', title: 'titlePermission', color: '#e8a400' };

const t = (key, subs) => chrome.i18n.getMessage(key, subs);

export async function showBadge(state) {
  const color = BADGE_COLORS[state?.status] || BADGE_COLORS[CLIENT_STATUS.UNPAIRED];
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color }),
    // A single space draws the colour as a dot without a glyph.
    chrome.action.setBadgeText({ text: ' ' }),
    chrome.action.setTitle({ title: `${t('appName')} · ${describeState(state, t).text}` }),
  ]);
}

// state null clears the tab's own badge (back to the global one); detail is the orchestrator's.
export async function showTabBadge(tabId, state, channel, detail = null) {
  if (!Number.isInteger(tabId)) return;
  if (state === null) {
    await Promise.all([chrome.action.setBadgeText({ tabId, text: '' }), chrome.action.setTitle({ tabId, title: '' })]).catch(() => {});
    return;
  }
  const b = state === 'prompt' && detail?.why === 'permission' ? PERMISSION_BADGE : TAB_BADGE[state];
  const color = b?.color || BADGE_COLORS[channel?.status] || BADGE_COLORS[CLIENT_STATUS.UNPAIRED];
  const title = b ? t(b.title) : describeState(channel, t).text;
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color }),
    chrome.action.setBadgeText({ tabId, text: b?.glyph ?? (b?.text ? t(b.text) : ' ') }),
    chrome.action.setTitle({ tabId, title: `${t('appName')} · ${title}` }),
  ]).catch(() => {});
}
