// The channel state as words, for the options page, the popup and the
// toolbar tooltip. t is chrome.i18n.getMessage (or a stand-in in tests).

import { CLIENT_STATUS } from './protocol.js';

const PRIVACY_KEYS = { standard: 'privacyStandard', secure: 'privacySecure', offline: 'privacyOffline' };

const ERROR_KEYS = {
  'protocol-mismatch': 'errProtocol',
  'pairing-failed': 'errPairing',
  unreachable: 'errUnreachable',
  'hello-failed': 'errUnreachable',
  unauthorized: 'errUnauthorized',
};

// { tone: 'ok' | 'warn' | 'muted', text }
export function describeState(state, t) {
  if (state?.status === CLIENT_STATUS.READY) {
    const mode = PRIVACY_KEYS[state.privacyMode] ? t(PRIVACY_KEYS[state.privacyMode]) : String(state.privacyMode ?? '?');
    return { tone: 'ok', text: t('statusReady', [String(state.appVersion ?? '?'), String(state.port ?? '?'), mode]) };
  }
  if (state?.status === CLIENT_STATUS.OFFLINE) return { tone: 'warn', text: t('statusOffline') };
  return { tone: 'muted', text: t('statusUnpaired') };
}

export function errorText(code, t) {
  return ERROR_KEYS[code] ? t(ERROR_KEYS[code]) : t('errGeneric', [String(code)]);
}
