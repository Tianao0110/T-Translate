// The popup's status line for one tab: what the orchestrator does there
// (TAB_STATE), whether the page reported anything (TAB_EVIDENCE) and the
// channel. t is chrome.i18n.getMessage (or a stand-in in tests).

// { tone: 'ok' | 'warn' | 'muted', text }
export function describeTab({ tab, evidence, channel, prefs } = {}, t) {
  if (!evidence) return { tone: 'muted', text: t('tabNoVideo') };
  switch (tab?.state) {
    case 'captions':
      if (!tab.run && tab.cached) return { tone: 'ok', text: t('tabCaptionsCached') };
      return { tone: 'ok', text: tab.run?.tier === 1 ? t('tabCaptionsSite') : t('tabCaptionsAudio') };
    case 'listening':
      return { tone: 'ok', text: t('tabListening') };
    case 'prompt':
      return { tone: 'warn', text: t('tabPrompt') };
    case 'suspended':
      return { tone: 'warn', text: t('tabSuspended') };
    case 'off':
      return { tone: 'muted', text: prefs && prefs.enabled === false ? t('tabDisabled') : t('tabOff') };
    default:
  }
  const block = tab?.block ?? (channel?.status !== 'ready' ? 'offline' : null);
  switch (block) {
    case 'offline':
      return { tone: 'warn', text: t('tabOffline') };
    case 'no-media':
      return { tone: 'muted', text: t('tabNoMedia') };
    case 'hidden':
      return { tone: 'muted', text: t('tabHidden') };
    case 'paused':
      return { tone: 'muted', text: t('tabPaused') };
    case 'ended':
      return { tone: 'muted', text: t('tabEnded') };
    default:
      return { tone: 'muted', text: t('tabWaiting') };
  }
}
