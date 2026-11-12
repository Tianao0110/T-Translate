// Options page: four numbers at the top (connection, cached videos, their
// size, blocked sites); pair with T-Translate, see the channel state,
// reconnect or forget the pairing (all of it in the offscreen client via the
// worker); the sites switched off (prefs in chrome.storage.local, which the
// worker follows), each with a remove; the cached videos, newest first, ten
// to a page, each with where and when it was watched, picked to export as SRT
// or delete, and emptying the cache.

import { MSG, request, on } from '../shared/messages.js';
import { CLIENT_STATUS } from '../shared/protocol.js';
import { describeState, errorText } from '../shared/status-text.js';
import { toSrt, exportFileName } from '../shared/subtitle-export.js';
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
  $('tile-conn').textContent = t(state?.status === CLIENT_STATUS.READY ? 'tileReady' : paired ? 'tileOffline' : 'tileUnpaired');
  // How to pair matters only until it is done.
  $('pair-hint').hidden = state?.status === CLIENT_STATUS.READY;
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

const SITE_NAMES = { youtube: 'siteYoutube', bilibili: 'siteBilibili', tiktok: 'siteTiktok', netflix: 'siteNetflix' };
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
  $('tile-blocked').textContent = String(off.length);
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

const PAGE_SIZE = 10;
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

const siteKeyOfRecord = (key) => String(key).split(':')[0];
const mediaIdOfRecord = (key) => String(key).slice(String(key).indexOf(':') + 1);

function siteOfRecord(m) {
  const site = siteKeyOfRecord(m.key);
  if (site !== 'generic') return siteName(site);
  try {
    return new URL(m.url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

let records = []; // metadata, newest first
let page = 0;
const picked = new Set(); // keys, kept across pages

const pageCount = () => Math.max(1, Math.ceil(records.length / PAGE_SIZE));
const onPage = () => records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

function cacheItem(m) {
  const li = document.createElement('li');
  li.className = 'cache-item';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = picked.has(m.key);
  box.addEventListener('change', () => {
    if (box.checked) picked.add(m.key);
    else picked.delete(m.key);
    renderSelection();
  });
  const main = document.createElement('div');
  main.className = 'cache-main';
  const head = document.createElement(m.url ? 'a' : 'span');
  head.className = 'cache-title';
  head.textContent = cleanTitle(m.title) || mediaIdOfRecord(m.key);
  if (m.url) Object.assign(head, { href: m.url, target: '_blank', rel: 'noopener noreferrer' });
  const line = document.createElement('span');
  line.className = 'hint';
  line.textContent = t('cacheLine', [siteOfRecord(m) || '?', when(m.updatedAt), String(m.cueCount ?? 0), size(m.bytes || 0)]);
  main.append(head, line);
  li.append(box, main);
  return li;
}

function renderSelection() {
  const keys = onPage().map((m) => m.key);
  const all = $('cache-select-page');
  all.checked = keys.length > 0 && keys.every((k) => picked.has(k));
  all.indeterminate = !all.checked && keys.some((k) => picked.has(k));
  all.disabled = keys.length === 0;
  $('cache-selected').textContent = picked.size ? t('cacheSelected', [String(picked.size)]) : '';
  $('cache-export').disabled = picked.size === 0;
  $('cache-delete').disabled = picked.size === 0;
}

function renderList() {
  page = Math.min(page, pageCount() - 1);
  $('cache-list').replaceChildren(...onPage().map(cacheItem));
  $('cache-page').textContent = t('cachePage', [String(page + 1), String(pageCount())]);
  $('cache-prev').disabled = page === 0;
  $('cache-next').disabled = page >= pageCount() - 1;
  document.querySelector('.pager').hidden = pageCount() < 2;
  renderSelection();
}

async function renderCache() {
  const [stats, list] = await Promise.all([request(MSG.CACHE_STATS), request(MSG.CACHE_LIST)]);
  if (!stats.ok) {
    $('cache-stats').textContent = errorText(stats.error?.code || 'error', t);
    return;
  }
  $('cache-stats').textContent = t('cacheStats', [String(stats.result.count), size(stats.result.bytes)]);
  $('tile-videos').textContent = String(stats.result.count);
  $('tile-size').textContent = size(stats.result.bytes);
  records = list.ok && Array.isArray(list.result) ? list.result : [];
  const known = new Set(records.map((m) => m.key));
  for (const k of [...picked]) if (!known.has(k)) picked.delete(k);
  renderList();
}

// Each picked video as its own SRT file, in the popup's display choice; read
// without counting as a use, so the list keeps its order.
async function exportPicked() {
  const display = prefs.get().display;
  for (const key of records.map((m) => m.key).filter((k) => picked.has(k))) {
    const r = await request(MSG.CACHE_GET, { key, peek: true });
    const srt = r.ok && r.result ? toSrt(r.result.cues || [], { display }) : '';
    if (!srt) continue;
    const url = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: exportFileName({ site: siteKeyOfRecord(key), mediaId: mediaIdOfRecord(key) }) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

$('cache-select-page').addEventListener('change', (e) => {
  for (const m of onPage()) {
    if (e.target.checked) picked.add(m.key);
    else picked.delete(m.key);
  }
  renderList();
});
$('cache-prev').addEventListener('click', () => {
  page = Math.max(0, page - 1);
  renderList();
});
$('cache-next').addEventListener('click', () => {
  page = Math.min(pageCount() - 1, page + 1);
  renderList();
});
$('cache-export').addEventListener('click', async () => {
  $('cache-export').disabled = true;
  await exportPicked();
  renderSelection();
});
$('cache-delete').addEventListener('click', async () => {
  $('cache-delete').disabled = true;
  await request(MSG.CACHE_DELETE, { keys: [...picked] });
  picked.clear();
  renderCache();
});
$('cache-clear').addEventListener('click', async () => {
  $('cache-clear').disabled = true;
  await request(MSG.CACHE_CLEAR);
  $('cache-clear').disabled = false;
  picked.clear();
  page = 0;
  renderCache();
});
renderCache();
