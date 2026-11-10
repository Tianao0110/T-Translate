// Toolbar badge: a coloured dot for the channel state (grey unpaired, amber
// offline, green ready) and the state in words as the tooltip.

import { CLIENT_STATUS } from '../shared/protocol.js';
import { describeState } from '../shared/status-text.js';

export const BADGE_COLORS = {
  [CLIENT_STATUS.UNPAIRED]: '#9aa0a6',
  [CLIENT_STATUS.OFFLINE]: '#e8a400',
  [CLIENT_STATUS.READY]: '#1e8e3e',
};

export async function showBadge(state) {
  const color = BADGE_COLORS[state?.status] || BADGE_COLORS[CLIENT_STATUS.UNPAIRED];
  const t = (key, subs) => chrome.i18n.getMessage(key, subs);
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color }),
    // A single space draws the colour as a dot without a glyph.
    chrome.action.setBadgeText({ text: ' ' }),
    chrome.action.setTitle({ title: `${t('appName')} · ${describeState(state, t).text}` }),
  ]);
}
