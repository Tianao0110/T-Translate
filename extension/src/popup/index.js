// Toolbar popup: what T-Caption does in the current tab, the prefs that
// matter while watching (written straight to chrome.storage.local, which the
// worker follows) and the tab's captions as an SRT file.
// popup.html?tab=<tabId> picks the tab instead (only the e2e scripts use it).

import { MSG, request, on } from '../shared/messages.js';
import { describeState } from '../shared/status-text.js';
import { describeTab } from '../shared/tab-status.js';
import { toSrt, exportFileName } from '../shared/subtitle-export.js';
import { createPrefs } from '../sw/prefs.js';
import { t, localize } from '../shared/page.js';

const TARGETS = ['zh', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt', 'it', 'vi', 'th', 'ar'];
const NAME_TAGS = { zh: 'zh-Hans', 'zh-TW': 'zh-Hant' };
const REFRESH_MS = 1000;

const $ = (id) => document.getElementById(id);
const prefs = createPrefs();
let tabId = null;
let tab = null;
let evidence = null;
let channel = null;
let cueCount = 0;

const result = async (type, payload) => {
  const r = await request(type, payload);
  return r.ok ? r.result : null;
};

async function targetTab() {
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  if (Number.isSafeInteger(forced) && forced > 0) return forced;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active?.id ?? null;
}

const siteName = (site) => (site === 'youtube' ? t('siteYoutube') : site === 'bilibili' ? t('siteBilibili') : site);

let names = null;
function langName(code) {
  try {
    names ??= new Intl.DisplayNames([chrome.i18n.getUILanguage()], { type: 'language' });
    return names.of(NAME_TAGS[code] || code) || code;
  } catch {
    return code;
  }
}

function fillTargets(current) {
  const select = $('target');
  const codes = TARGETS.includes(current) ? TARGETS : [...TARGETS, current];
  if (select.dataset.codes !== codes.join(',')) {
    select.replaceChildren(...codes.map((c) => new Option(langName(c), c)));
    select.dataset.codes = codes.join(',');
  }
  select.value = current;
}

function render() {
  const p = prefs.get();
  const view = describeTab({ tab, evidence, channel, prefs: p }, t);
  $('status').dataset.tone = view.tone;
  $('status-text').textContent = view.text;
  $('channel-text').textContent = channel && channel.status !== 'ready' ? describeState(channel, t).text : '';

  const site = evidence?.site;
  const siteRow = $('site-row');
  siteRow.hidden = !site || site === 'generic';
  if (!siteRow.hidden) {
    const name = siteName(site);
    $('site-label').textContent = t('popupSite', [name]);
    $('site-on').checked = !p.siteOff[site];
  }
  $('enabled').checked = p.enabled;
  for (const el of document.querySelectorAll('input[name="display"]')) el.checked = el.value === p.display;
  for (const el of document.querySelectorAll('input[name="mode"]')) el.checked = el.value === p.mode;
  fillTargets(p.targetLang);
  $('export').disabled = cueCount === 0;
}

async function refresh() {
  if (tabId !== null) {
    [tab, evidence] = await Promise.all([result(MSG.TAB_STATE, { tabId }), result(MSG.TAB_EVIDENCE, { tabId })]);
    const q = evidence ? await result(MSG.TAB_COMMAND, { tabId, command: { cmd: 'query' } }) : null;
    cueCount = q?.renderer?.cues ?? 0;
  }
  render();
}

async function exportSrt() {
  const button = $('export');
  button.disabled = true;
  try {
    const r = await result(MSG.TAB_COMMAND, { tabId, command: { cmd: 'cues', op: 'list' } });
    const srt = toSrt(r?.cues || [], { display: prefs.get().display });
    if (!srt) return;
    const url = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: exportFileName({ site: evidence?.site, mediaId: evidence?.mediaId }) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } finally {
    button.disabled = cueCount === 0;
  }
}

localize();
$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});
$('site-on').addEventListener('change', (e) => {
  const site = evidence?.site;
  if (!site || site === 'generic') return;
  const siteOff = { ...prefs.get().siteOff };
  if (e.target.checked) delete siteOff[site];
  else siteOff[site] = true;
  prefs.set({ siteOff });
});
$('enabled').addEventListener('change', (e) => prefs.set({ enabled: e.target.checked }));
$('display').addEventListener('change', (e) => prefs.set({ display: e.target.value }));
$('mode').addEventListener('change', (e) => prefs.set({ mode: e.target.value }));
$('target').addEventListener('change', (e) => prefs.set({ targetLang: e.target.value }));
$('export').addEventListener('click', exportSrt);

prefs.onChange(render);
on(MSG.COMPANION_STATE_CHANGED, (s) => {
  channel = s;
  refresh();
});

(async () => {
  await prefs.load();
  render();
  [channel, tabId] = await Promise.all([result(MSG.COMPANION_LOAD), targetTab()]);
  await refresh();
  setInterval(refresh, REFRESH_MS);
})();
