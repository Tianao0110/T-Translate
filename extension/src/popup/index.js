// Toolbar popup: the channel state in one line and a way to the options page.

import { MSG, request, on } from '../shared/messages.js';
import { describeState } from '../shared/status-text.js';
import { t, localize } from '../shared/page.js';

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');

function render(state) {
  const view = describeState(state, t);
  statusEl.dataset.tone = view.tone;
  statusText.textContent = view.text;
}

localize();
document.getElementById('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});
on(MSG.COMPANION_STATE_CHANGED, render);
request(MSG.COMPANION_LOAD).then((reply) => render(reply.ok ? reply.result : null));
