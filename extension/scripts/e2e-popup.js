// The toolbar popup and the options page on a real YouTube page, hands off
// (shell in lib/e2e-shell.js). Once captions run on their own (tier 2, as
// in e2e-auto.js), the popup opens in a background tab as
// popup.html?tab=<id> (a foreground tab would take the video's place):
//
//   (a) the status line says what the orchestrator does in that tab; a tab
//       without our scripts has no video
//   (b) the display segments: the track's active cue follows (translation
//       only, then both lines)
//   (c) the site switch: the tab goes off with the badge, then back on
//   (d) export: an SRT download (Browser.setDownloadBehavior) with at least
//       as many cues as the track had
//   (e) the cache through the worker: put → get → stats → clear → stats,
//       the record in IndexedDB, the options page's cache and site cards
//
//   npx electron extension/scripts/e2e-popup.js --packs <installed asr-models dir> [--browser <exe>] [--out <screenshots dir>] [--headed] [--video <id>] [--lang zh-CN]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not
// copied. The sandbox is left in place for the recycle bin.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { REPO, arg, checklist, run } = require('../../scripts/lib/electron-smoke');
const { startShell } = require('./lib/e2e-shell');

const { step, summary } = checklist();
const VIDEO = arg('--video') || 'UF8uR6Z6KLc';
const LANG = arg('--lang') || 'en-US';
const LOCALE = /^zh/i.test(LANG) ? 'zh_CN' : 'en';
const MESSAGES = JSON.parse(fs.readFileSync(path.join(REPO, `extension/_locales/${LOCALE}/messages.json`), 'utf8'));
const msg = (k, subs = []) => subs.reduce((s, v, i) => s.replace(new RegExp(`\\$${Object.keys(MESSAGES[k].placeholders || {})[i]}\\$`, 'i'), v), MESSAGES[k].message);

// SRT blocks as { n, timing, lines }: number, timing line, text line count.
function parseSrt(text) {
  return text
    .trim()
    .split(/\n\n+/)
    .map((b) => b.split('\n'))
    .filter((l) => /^\d+$/.test(l[0]) && /-->/.test(l[1] || ''))
    .map((l) => ({ n: Number(l[0]), timing: l[1], lines: l.length - 2, text: l.slice(2).join(' / ') }));
}

async function main() {
  const shell = await startShell({ name: 'tt-caption-popup', step, version: 'e2e-s6-popup', shotPrefix: 't-caption-s6' });
  if (!shell) return 2;
  const { cdp, evaluate, open, until, state, stateIs, shoot, dump, trackInfo, ext, badge } = shell;
  const numbers = {};
  const downloads = path.join(shell.box.dir, 'downloads');
  fs.mkdirSync(downloads, { recursive: true });

  try {
    await shell.setPrefs({ targetLang: 'zh' });

    // ---- captions on their own ----
    const { sessionId: page1 } = await open('about:blank');
    shell.pages.add(page1);
    await cdp.send('Page.navigate', { url: `https://www.youtube.com/watch?v=${VIDEO}` }, page1);
    const tab1 = await until(() => shell.tabIdOf('https://www.youtube.com/watch'), 15000);
    await until(() => evaluate(page1, `!document.querySelector('#movie_player.ad-showing') && !!document.querySelector('#movie_player')`), 90000, 500);
    const captions = await stateIs(tab1, 'captions', 60000);
    const active1 = await until(async () => {
      const r = await trackInfo(page1);
      return r && r.active.some((t) => t.includes('\n')) ? r : null;
    }, 90000, 300);
    step('captions run by themselves on YouTube', !!captions && !!active1, `tier ${captions?.run?.tier}; ${JSON.stringify(active1?.active)}`);
    if (!active1) await dump(tab1);

    // ---- (a) the popup ----
    const openPopup = async (tabId) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${shell.extId}/popup.html?tab=${tabId}`, background: true });
      const sessionId = await shell.browser.attach(targetId);
      await cdp.send('Page.enable', {}, sessionId);
      return { targetId, sessionId };
    };
    const { sessionId: pop, targetId: popTarget } = await openPopup(tab1);
    const popupView = () =>
      evaluate(pop, `(() => ({ status: document.getElementById('status-text').textContent, tone: document.getElementById('status').dataset.tone, channel: document.getElementById('channel-text').textContent, siteShown: !document.getElementById('site-row').hidden, site: document.getElementById('site-label').textContent, siteOn: document.getElementById('site-on').checked, enabled: document.getElementById('enabled').checked, display: document.querySelector('input[name=display]:checked')?.value ?? null, mode: document.querySelector('input[name=mode]:checked')?.value ?? null, target: document.getElementById('target').value, targets: document.getElementById('target').options.length, exportOn: !document.getElementById('export').disabled }))()`);
    const want = captions?.run?.tier === 1 ? msg('tabCaptionsSite') : msg('tabCaptionsAudio');
    const v1 = await until(async () => {
      const v = await popupView();
      return v.status === want && v.exportOn ? v : null;
    }, 10000);
    step('(a) the popup’s status line says what runs in the tab; controls show the prefs', !!v1 && v1.siteShown && v1.siteOn && v1.enabled && v1.display === 'bilingual' && v1.mode === 'track' && v1.target === 'zh', JSON.stringify(v1 || (await popupView())));
    const popBox = await evaluate(pop, `(() => { const r = document.body.getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    if (v1) {
      for (const scheme of ['dark', 'light']) {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, pop);
        await shoot(pop, `5-popup-${LOCALE}-${scheme}`, popBox);
      }
      await cdp.send('Emulation.setEmulatedMedia', { features: [] }, pop);
    }
    const { sessionId: popOther, targetId: otherTarget } = await openPopup(Number(await evaluate(shell.opt, `chrome.tabs.getCurrent().then((t) => t.id)`)));
    const vOther = await until(async () => {
      const v = await evaluate(popOther, `({ status: document.getElementById('status-text').textContent, siteShown: !document.getElementById('site-row').hidden, exportOn: !document.getElementById('export').disabled })`);
      return v.status ? v : null;
    }, 5000);
    step('(a) a tab without our scripts: no video, no site switch, nothing to export', vOther?.status === msg('tabNoVideo') && !vOther.siteShown && !vOther.exportOn, JSON.stringify(vOther));
    await cdp.send('Target.closeTarget', { targetId: otherTarget });

    // ---- (b) display ----
    const click = (sel) => evaluate(pop, `(document.querySelector(${JSON.stringify(sel)}).click(), true)`);
    await click('input[name=display][value=translation]');
    const onlyTr = await until(async () => {
      const r = await trackInfo(page1);
      return r && r.active.length && r.active.every((t) => !t.includes('\n') && t.startsWith('[译]')) ? r : null;
    }, 15000, 300);
    const prefsTr = await shell.getPrefs();
    await click('input[name=display][value=bilingual]');
    const both = await until(async () => {
      const r = await trackInfo(page1);
      return r && r.active.some((t) => t.includes('\n[译]')) ? r : null;
    }, 15000, 300);
    step('(b) display segments: the track’s active cue follows (translation only, then both)', prefsTr?.display === 'translation' && !!onlyTr && !!both, `${JSON.stringify(onlyTr?.active)} → ${JSON.stringify(both?.active)}`);
    const sizeOnPage = (want) => until(() => evaluate(page1, `document.querySelector('video').getAttribute('data-tc-cap-size') === ${JSON.stringify(want)} || null`), 10000, 200);
    const sizeChecked = await evaluate(pop, `document.querySelector('input[name=size]:checked')?.value ?? null`);
    await click('input[name=size][value=small]');
    const small = await sizeOnPage('small');
    const prefsSmall = await shell.getPrefs();
    await click('input[name=size][value=medium]');
    const medium = await sizeOnPage('medium');
    step('(b) size segments: medium checked, small then medium reach the video', sizeChecked === 'medium' && prefsSmall?.size === 'small' && !!small && !!medium, `checked ${sizeChecked}; prefs ${prefsSmall?.size}; page small ${!!small}, medium ${!!medium}`);

    // ---- (c) the site switch ----
    await click('#site-on');
    const off = await stateIs(tab1, 'off', 10000);
    const [badgeOff] = (await badge(tab1)) || [];
    const vOff = await until(async () => {
      const v = await popupView();
      return v.status === msg('tabOff') ? v : null;
    }, 5000);
    const prefsOff = await shell.getPrefs();
    step('(c) site switch off: the tab is off, the badge says off, so does the popup', !!off && badgeOff === msg('badgeOff') && !!vOff && prefsOff?.siteOff?.youtube === true, `${off?.state} badge ${badgeOff}; popup “${vOff?.status}”; prefs ${JSON.stringify(prefsOff?.siteOff)}`);
    await click('#site-on');
    const back = await stateIs(tab1, 'captions', 30000);
    const vBack = await until(async () => {
      const v = await popupView();
      return v.siteOn && (v.status === want || v.status === msg('tabCaptionsCached')) ? v : null;
    }, 10000);
    step('(c) on again: captions come back (recognized or from the cache)', !!back && !!vBack, `${back?.state} tier ${back?.run?.tier}; popup “${vBack?.status}”`);
    if (!back) await dump(tab1);

    // ---- (d) export ----
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    await until(async () => (await popupView()).exportOn, 15000);
    const before = await trackInfo(page1);
    await click('#export');
    const file = path.join(downloads, `t-caption-youtube-${VIDEO}.srt`);
    const got = await until(async () => (fs.existsSync(file) && fs.statSync(file).size > 0 ? fs.readFileSync(file, 'utf8') : null), 15000);
    const exported = got ? parseSrt(got) : [];
    numbers.export = { file: path.basename(file), cues: exported.length, trackCues: before?.cues ?? null, bilingual: exported.filter((c) => c.lines === 2).length, first: exported[0] };
    step('(d) export: an SRT file with at least the track’s cues, both lines', exported.length > 0 && exported.length >= (before?.cues ?? Infinity) && numbers.export.bilingual > 0, JSON.stringify(numbers.export));

    // ---- (e) the cache through the worker ----
    const listed = (await ext('tab/command', { tabId: tab1, command: { cmd: 'cues', op: 'list' } }))?.result?.cues || [];
    const key = `youtube:${VIDEO}`;
    const put = await ext('cache/put', { key, record: { cues: listed, tier: 2, lang: 'en', target: 'zh' } });
    const get = await ext('cache/get', { key });
    const stats1 = await ext('cache/stats');
    const idb = await evaluate(shell.opt, `new Promise((resolve) => { const q = indexedDB.open('t-caption'); q.onsuccess = () => { const db = q.result; const t = db.transaction('subtitles', 'readonly').objectStore('subtitles'); const c = t.count(); const k = t.index('updatedAt').getAllKeys(); t.transaction.oncomplete = () => { resolve({ stores: [...db.objectStoreNames], count: c.result, keys: k.result }); db.close(); }; }; q.onerror = () => resolve({ error: String(q.error) }); })`);
    numbers.cache = { put: put?.result, getCues: get?.result?.cues?.length ?? null, stats: stats1?.result, idb };
    step('(e) cache put → get → stats through the worker, the record in IndexedDB', put?.ok && get?.result?.cues?.length === listed.length && listed.length > 0 && stats1?.result?.count === 1 && stats1.result.bytes === put.result.bytes && idb?.count === 1 && idb.keys?.[0] === key, JSON.stringify(numbers.cache));

    await cdp.send('Page.reload', {}, shell.opt);
    const optView = await until(() => evaluate(shell.opt, `(() => { const s = document.getElementById('cache-stats')?.textContent; return s ? { stats: s, yt: document.getElementById('site-youtube').checked, bili: document.getElementById('site-bilibili').checked, auto: document.getElementById('auto-listen').checked } : null; })()`), 10000);
    const optBox = await evaluate(shell.opt, `(() => { const r = document.querySelector('main').getBoundingClientRect(); return { x: r.left - 8, y: r.top - 8, width: r.width + 16, height: r.height + 16 }; })()`);
    await shoot(shell.opt, `6-options-${LOCALE}`, optBox);
    await evaluate(shell.opt, `(document.getElementById('cache-clear').click(), true)`);
    const cleared = await until(async () => {
      const s = await ext('cache/stats');
      return s?.result?.count === 0 ? s.result : null;
    }, 5000);
    const empty = msg('cacheStats', ['0', '0 KB']);
    const optAfter = await until(() => evaluate(shell.opt, `(() => { const s = document.getElementById('cache-stats').textContent; return s === ${JSON.stringify(empty)} ? s : null; })()`), 5000);
    numbers.cache.options = { before: optView, after: optAfter, stats: cleared };
    step('(e) the options page shows the cache and site switches; Clear empties it (stats 0)', !!optView && optView.stats === msg('cacheStats', ['1', `${Math.round(put.result.bytes / 1024)} KB`]) && optView.yt && optView.bili && !optView.auto && !!cleared && cleared.bytes === 0 && !!optAfter, JSON.stringify(numbers.cache.options));
    const gone = await ext('cache/get', { key });
    step('(e) after clearing the record is gone', gone?.ok && gone.result === null, JSON.stringify(gone));

    await cdp.send('Target.closeTarget', { targetId: popTarget });
    numbers.state = (await state(tab1))?.state;
    numbers.siteExceptions = shell.pageExceptions.site;
    step('no exceptions from our scripts on the pages, none in extension contexts', shell.pageExceptions.ours.length === 0 && shell.extProblems.length === 0, [...shell.pageExceptions.ours, ...shell.extProblems].join(' || '));
    console.log(`\n  numbers: ${JSON.stringify(numbers, null, 1)}`);
    console.log(`  screenshots:\n    ${shell.shots.join('\n    ')}`);
  } finally {
    await shell.close();
  }
  return summary();
}

run(main);
