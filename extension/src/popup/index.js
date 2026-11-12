// Toolbar popup: what T-Caption does in the current tab, the prefs that
// matter while watching (written straight to chrome.storage.local, which the
// worker follows), turning the site off or on, and the tab's captions as an
// SRT file, and the caption timing of the tab's video. On a page T-Caption
// is not on yet, or whose video's host it may not read, one button asks the
// browser for that host (it has to be asked in the click itself).
// popup.html?tab=<tabId> picks the tab instead (only the e2e scripts use it).

import { MSG, request, on } from '../shared/messages.js';
import { describeState, errorText } from '../shared/status-text.js';
import { describeTab } from '../shared/tab-status.js';
import { matchPattern } from '../shared/match-pattern.js';
import { toSrt, exportFileName } from '../shared/subtitle-export.js';
import { createPrefs, isSiteOff, siteOffEntry } from '../sw/prefs.js';
import { hostPattern } from '../sw/direct-fetch.js';
import { siteKeyOf } from '../sw/session-orchestrator.js';
import { t, localize } from '../shared/page.js';

const TARGETS = ['zh', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt', 'it', 'vi', 'th', 'ar'];
const NAME_TAGS = { zh: 'zh-Hans', 'zh-TW': 'zh-Hant' };
const REFRESH_MS = 1000;
const OFFSET_STEP_S = 0.5;

const $ = (id) => document.getElementById(id);
const prefs = createPrefs();
let tabId = null;
let tab = null;
let evidence = null;
let channel = null;
let cueCount = 0;
let offset = 0; // the tab's caption timing, seconds
let pageUrl = '';
let allow = null; // { pattern, kind: 'site' | 'read' }
let allowNote = '';
const builtIn = (chrome.runtime.getManifest().content_scripts || []).flatMap((c) => c.matches || []).map(matchPattern);

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

// What the button asks for: the video's host the tab waits on, or this
// page's own host when T-Caption has no scripts here (not one of its own sites).
function allowFor() {
  if (tab?.state === 'prompt' && tab.needs?.origin) return { pattern: tab.needs.origin, kind: 'read' };
  if (evidence || !/^https?:\/\//i.test(pageUrl) || builtIn.some((m) => m(pageUrl))) return null;
  try {
    return { pattern: hostPattern(pageUrl), kind: 'site' };
  } catch {
    return null;
  }
}

// The site of the tab's page, for the per-site switch; none without our scripts.
function currentSite() {
  const key = evidence ? siteKeyOf(evidence) : null;
  return key && key !== 'generic' ? key : null;
}

function render() {
  const p = prefs.get();
  allow = allowFor();
  const view = describeTab({ tab, evidence, channel, prefs: p, notEnabled: allow?.kind === 'site' }, t);
  $('status').dataset.tone = view.tone;
  $('status-text').textContent = view.text;
  $('channel-text').textContent = channel && channel.status !== 'ready' ? describeState(channel, t).text : '';
  $('allow-row').hidden = !allow;
  if (allow) $('allow').textContent = allow.kind === 'site' ? t('allowSite') : t('allowRead');
  $('allow-note').textContent = allow ? allowNote : '';

  // 'off' stands for the master switch.
  for (const el of document.querySelectorAll('input[name="display"]')) el.checked = el.value === (p.enabled ? p.display : 'off');
  for (const el of document.querySelectorAll('input[name="mode"]')) el.checked = el.value === p.mode;
  for (const el of document.querySelectorAll('input[name="size"]')) el.checked = el.value === p.size;
  $('auto-pause').checked = p.autoPause;
  $('offset-row').hidden = cueCount === 0;
  $('offset-value').textContent = offsetText(offset);
  fillTargets(p.targetLang);
  $('export').disabled = cueCount === 0;
  const site = currentSite();
  $('site-toggle').hidden = !site;
  if (site) $('site-toggle').textContent = t(isSiteOff(p.siteOff, site) ? 'siteEnable' : 'siteDisable');
}

async function refresh() {
  if (tabId !== null) {
    let info;
    [tab, evidence, info] = await Promise.all([result(MSG.TAB_STATE, { tabId }), result(MSG.TAB_EVIDENCE, { tabId }), chrome.tabs.get(tabId).catch(() => null)]);
    pageUrl = info?.url || info?.pendingUrl || '';
    const q = evidence ? await result(MSG.TAB_COMMAND, { tabId, command: { cmd: 'query' } }) : null;
    cueCount = q?.renderer?.cues ?? 0;
    offset = q?.view?.offset ?? 0;
  }
  render();
}

// "+1.5 s" / "0 s": later is positive.
function offsetText(s) {
  const n = Math.abs(s).toFixed(1).replace(/\.0$/, '');
  const signed = s > 0 ? `+${n}` : s < 0 ? `−${n}` : n;
  return t('offsetValue', [signed]) || `${signed} s`;
}

async function stepOffset(delta) {
  const r = await result(MSG.TAB_COMMAND, { tabId, command: { cmd: 'offset', delta } });
  if (typeof r?.offset === 'number') offset = r.offset;
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
$('allow').addEventListener('click', () => {
  const want = allow;
  if (!want) return;
  allowNote = '';
  // Sent first: if the browser's dialog closes this popup, the worker finishes once the grant arrives.
  request(MSG.SITE_ALLOW, { pattern: want.pattern, tabId, pending: true });
  chrome.permissions.request({ origins: [want.pattern] }).then(
    async (ok) => {
      if (!ok) {
        allowNote = t('allowDenied');
        render();
        return;
      }
      const r = await request(MSG.SITE_ALLOW, { pattern: want.pattern, tabId });
      if (!r.ok) allowNote = errorText(r.error?.code || 'error', t);
      await refresh();
    },
    (e) => {
      allowNote = errorText(String(e?.message || e), t);
      render();
    }
  );
});
// 'off' turns T-Caption off everywhere; any other choice turns it on.
$('display').addEventListener('change', (e) => {
  if (e.target.value === 'off') return prefs.set({ enabled: false });
  prefs.set({ enabled: true, display: e.target.value });
});
// This site off (its pages and subdomains with it), or every entry that
// switched it off removed again.
$('site-toggle').addEventListener('click', () => {
  const key = currentSite();
  if (!key) return;
  const siteOff = { ...prefs.get().siteOff };
  if (isSiteOff(siteOff, key)) for (let k = siteOffEntry(siteOff, key); k; k = siteOffEntry(siteOff, key)) delete siteOff[k];
  else siteOff[key] = true;
  prefs.set({ siteOff });
});
$('mode').addEventListener('change', (e) => prefs.set({ mode: e.target.value }));
$('size').addEventListener('change', (e) => prefs.set({ size: e.target.value }));
$('target').addEventListener('change', (e) => prefs.set({ targetLang: e.target.value }));
$('auto-pause').addEventListener('change', (e) => prefs.set({ autoPause: e.target.checked }));
$('offset-minus').addEventListener('click', () => stepOffset(-OFFSET_STEP_S));
$('offset-plus').addEventListener('click', () => stepOffset(OFFSET_STEP_S));
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
