// Options page: pair with T-Translate, see the channel state, reconnect or
// forget the pairing. All work happens in the offscreen client via the worker.

import { MSG, request, on } from '../shared/messages.js';
import { CLIENT_STATUS } from '../shared/protocol.js';
import { describeState, errorText } from '../shared/status-text.js';
import { t, localize } from '../shared/page.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const statusText = $('status-text');
const errorEl = $('error');
const buttons = { pair: $('pair'), reconnect: $('reconnect'), forget: $('forget') };

let state = null;
let busy = null; // the button whose request is in flight
let actionError = null;

function render() {
  const view = describeState(state, t);
  statusEl.dataset.tone = view.tone;
  statusText.textContent = state ? view.text : '';
  const paired = !!state && state.status !== CLIENT_STATUS.UNPAIRED;
  buttons.pair.disabled = !!busy;
  buttons.pair.classList.toggle('primary', !paired);
  buttons.reconnect.disabled = !!busy || !paired;
  buttons.forget.disabled = !!busy || !paired;
  buttons.pair.textContent = t(busy === 'pair' ? 'pairing' : 'pair');
  buttons.reconnect.textContent = t(busy === 'reconnect' ? 'connecting' : 'reconnect');
  // A protocol mismatch outlives the click that found it.
  const code = actionError || (state?.lastError === 'protocol-mismatch' ? state.lastError : null);
  errorEl.textContent = code ? errorText(code, t) : '';
}

async function act(name, type) {
  busy = name;
  actionError = null;
  render();
  const reply = await request(type);
  busy = null;
  if (reply.ok) state = reply.result;
  else actionError = reply.error?.code || 'error';
  render();
}

localize();
document.title = t('optionsTitle');
buttons.pair.addEventListener('click', () => act('pair', MSG.COMPANION_PAIR));
buttons.reconnect.addEventListener('click', () => act('reconnect', MSG.COMPANION_CONNECT));
buttons.forget.addEventListener('click', () => act('forget', MSG.COMPANION_FORGET));
on(MSG.COMPANION_STATE_CHANGED, (s) => {
  state = s;
  render();
});
render();
act('load', MSG.COMPANION_LOAD);
