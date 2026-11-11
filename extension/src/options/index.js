// Options page: pair with T-Translate, see the channel state, reconnect or
// forget the pairing (all of it in the offscreen client via the worker); the
// sites switched off (prefs in chrome.storage.local, which the worker
// follows), each with a remove; the cached videos, newest first, each with
// where and when it was watched and a delete, and emptying the cache.

import { MSG, request, on } from '../shared/messages.js';
import { CLIENT_STATUS } from '../shared/protocol.js';
import { describeState, errorText } from '../shared/status-text.js';
import { createPrefs } from '../sw/prefs.js';
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


// ---- sites switched off ----

const SITE_NAMES = { youtube: 'siteYoutube', bilibili: 'siteBilibili', tiktok: 'siteTiktok' };
const siteName = (key) => (Object.hasOwn(SITE_NAMES, key) ? t(SITE_NAMES[key]) : key);
const prefs = createPrefs();

function button(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function renderBlocked() {
  const off = Object.keys(prefs.get().siteOff).sort();
  $('blocked-sites').replaceChildren(
    ...off.map((key) => {
      const li = document.createElement('li');
      li.className = 'row';
      const name = document.createElement('span');
      name.textContent = siteName(key);
      const remove = button(t('siteRemove'), () => {
        remove.disabled = true;
        const siteOff = { ...prefs.get().siteOff };
        delete siteOff[key];
        prefs.set({ siteOff });
      });
      li.append(name, remove);
      return li;
    })
  );
}

prefs.onChange(renderBlocked);
prefs.load().then(renderBlocked);

// ---- cache ----

const size = (n) => (n < 1024 * 1024 ? `${n > 0 ? Math.max(1, Math.round(n / 1024)) : 0} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const thisYear = new Date().getFullYear();
let dateFormat = null;
function when(ms) {
  const d = new Date(ms);
  dateFormat ??= {
    near: new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    far: new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
  };
  return (d.getFullYear() === thisYear ? dateFormat.near : dateFormat.far).format(d);
}

// The page title without an unread count in front or the site's name behind.
const cleanTitle = (s) =>
  String(s || '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*[-–|]\s*(YouTube|TikTok)\s*$/i, '')
    .replace(/_哔哩哔哩_bilibili$/, '')
    .trim();

function siteOfRecord(m) {
  const site = String(m.key).split(':')[0];
  if (site !== 'generic') return siteName(site);
  try {
    return new URL(m.url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function cacheItem(m) {
  const li = document.createElement('li');
  li.className = 'cache-item';
  const main = document.createElement('div');
  main.className = 'cache-main';
  const title = cleanTitle(m.title) || String(m.key).slice(String(m.key).indexOf(':') + 1);
  const head = document.createElement(m.url ? 'a' : 'span');
  head.className = 'cache-title';
  head.textContent = title;
  if (m.url) Object.assign(head, { href: m.url, target: '_blank', rel: 'noopener noreferrer' });
  const line = document.createElement('span');
  line.className = 'hint';
  line.textContent = t('cacheLine', [siteOfRecord(m) || '?', when(m.updatedAt), String(m.cueCount ?? 0), size(m.bytes || 0)]);
  main.append(head, line);
  const del = button(t('cacheDelete'), async () => {
    del.disabled = true;
    await request(MSG.CACHE_DELETE, { key: m.key });
    renderCache();
  });
  li.append(main, del);
  return li;
}

async function renderCache() {
  const [stats, list] = await Promise.all([request(MSG.CACHE_STATS), request(MSG.CACHE_LIST)]);
  if (!stats.ok) {
    $('cache-stats').textContent = errorText(stats.error?.code || 'error', t);
    return;
  }
  $('cache-stats').textContent = t('cacheStats', [String(stats.result.count), size(stats.result.bytes)]);
  $('cache-list').replaceChildren(...(list.ok && Array.isArray(list.result) ? list.result : []).map(cacheItem));
}

$('cache-clear').addEventListener('click', async () => {
  $('cache-clear').disabled = true;
  await request(MSG.CACHE_CLEAR);
  $('cache-clear').disabled = false;
  renderCache();
});
renderCache();
