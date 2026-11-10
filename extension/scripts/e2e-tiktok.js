// TikTok on real pages, hands off: the real companion server and listen
// engine in a sandbox Electron, the built extension in Chrome (shell in
// lib/e2e-shell.js), nothing commanded from outside. Read through the
// extension's own messages and the page over CDP; the next video is an
// ArrowDown key event sent to the page over CDP. Signed out throughout; a
// captcha or login wall is recorded, never worked around.
//
//   (a) the feed (/foryou) with the player's WebVTT requests failed, like a
//       video without captions: the evidence says tiktok, the item id of
//       the playing video, hooks in place; the audio is an MSE fMP4
//       HE-AAC stream (mp4a.40.29 or .5) that is forwarded; tier 2 runs and
//       real sentences show on the video, bilingual: on the overlay where
//       the player keeps the <video> transparent and draws a canvas, else
//       on the track. Videos are walked with ArrowDown until an HE-AAC v2
//       one has spoken (at most --walk)
//   (b) each ArrowDown is a navigation under the same URL: a new navSeq and
//       media id, the old capture closed, a new one on the new video's
//       stream, none of the old video's cues on the new one, its own
//       sentences on the track; the time from the key to them
//   (c) video pages (/@user/video/<id>, links from the feed's item data), a
//       longer one and a short one whose audio is appended all at once: the
//       media id from the URL, captions the same way
//   (d) WebVTT allowed again, on another video page with captions: the
//       file is copied and claimed by its item (item data), tier 1 starts,
//       both lines on the video, the caption layer hidden; then the feed:
//       tier 1 follows ArrowDown (the player prefetches the next videos'
//       files), and with the player's CC button on its layer stays hidden
//   (e) the site switched off in prefs: stopped, badge off; on again
//
//   npx electron extension/scripts/e2e-tiktok.js --packs <installed asr-models dir> [--browser <exe>] [--out <screenshots dir>] [--headed] [--walk <videos, default 6>]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not
// copied. The sandbox is left in place for the recycle bin.
/* eslint-disable no-console */

const { arg, sleep, checklist, run } = require('../../scripts/lib/electron-smoke');
const { startShell } = require('./lib/e2e-shell');

const { step, summary } = checklist();
const WALK = Math.max(2, Number(arg('--walk')) || 6);
const FEED = 'https://www.tiktok.com/foryou';
// Subtitle files end in a 32-hex id; video files do not.
const VTT_FILE = /\/video\/tos\/(?:[^/]+\/)+([0-9a-f]{32})\/?$/;

// The video the viewer sees (playing and largest, else largest) and our track on it.
const TRACK = `(() => {
  const vs = [...document.querySelectorAll('video')];
  const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
  const v = vs.filter((x) => !x.paused).sort((a, b) => area(b) - area(a))[0] || vs.sort((a, b) => area(b) - area(a))[0];
  if (!v) return null;
  const w = v.closest('[id^="xgwrapper-"]');
  const ours = (x) => Array.from(x.textTracks || []).find((t) => t.label === 'T-Caption');
  const t = ours(v);
  const r = v.getBoundingClientRect();
  // The overlay (used over a transparent, canvas-drawn video) or the native track.
  const host = v.parentElement && v.parentElement.querySelector(':scope > .tc-cap-host');
  const box = host && host.shadowRoot && host.shadowRoot.querySelector('.tc-cap-box');
  const lines = box && !box.hidden ? [...box.querySelectorAll('.tc-cap-line')].map((l) => l.textContent) : [];
  const onTrack = t && t.mode === 'showing' && t.activeCues ? Array.from(t.activeCues).map((c) => c.text) : [];
  const transparent = !!v.checkVisibility && v.checkVisibility() && !v.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  return { item: w ? w.id.split('-').pop() : null, t: v.currentTime, dur: v.duration, paused: v.paused, muted: v.muted, loop: v.loop, transparent, drawn: host ? 'overlay' : t && t.mode === 'showing' ? 'track' : null, box: { x: r.left, y: r.top, width: r.width, height: r.height }, cues: [...(t && t.cues ? Array.from(t.cues).map((c) => c.text) : []), ...(lines.length ? [lines.join('\\n')] : [])], active: [...onTrack, ...(lines.length ? [lines.join('\\n')] : [])], videos: vs.length };
})()`;
const WALLS = `(() => {
  const q = (s) => document.querySelector(s);
  const captcha = q('#captcha-verify-container, .captcha_verify_container, #captcha_container, [class*="captcha_verify"]');
  const login = q('[data-e2e="login-modal"], #loginContainer');
  return { href: location.href, captcha: captcha ? String(captcha.id || captcha.className).slice(0, 60) : null, login: login ? String(login.id || login.className).slice(0, 60) : null };
})()`;

async function main() {
  const shell = await startShell({ name: 'tt-caption-tiktok', step, version: 'e2e-s8-tiktok', shotPrefix: 't-caption-s8' });
  if (!shell) return 2;
  const { cdp, evaluate, open, until, evidence, query, tabIdOf, stateIs, shoot, dump, opt } = shell;
  const numbers = { walls: [] };
  const mediaEvents = () => evaluate(opt, 'window.__media');
  const segmentsOf = (evs, key) => (evs || []).filter((e) => e.event.type === 'segment' && (!key || e.key === key));
  const track = (session) => evaluate(session, TRACK).catch(() => null);
  const bilingual = (r) => (r && r.active.some((t) => t.includes('\n')) ? r : null);
  const zoomOf = (r) => r && { x: Math.max(0, r.box.x), y: Math.max(0, r.box.y + r.box.height * 0.55), width: r.box.width, height: r.box.height * 0.45 };
  const walls = async (session, where) => {
    const w = await evaluate(session, WALLS).catch(() => null);
    if (w && (w.captcha || w.login)) numbers.walls.push({ where, ...w });
    return w;
  };

  try {
    await shell.setPrefs({ targetLang: 'zh' });
    await evaluate(opt, `(() => { window.__media = []; chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'media/event') window.__media.push({ at: Date.now(), ...m.payload }); }); })()`);
    numbers.decoder = await evaluate(opt, `Promise.all([['mp4a.40.29', 44100, 2], ['mp4a.40.5', 44100, 2], ['mp4a.40.2', 44100, 2]].map(([codec, sampleRate, numberOfChannels]) => AudioDecoder.isConfigSupported({ codec, sampleRate, numberOfChannels }).then((r) => codec + ':' + r.supported, (e) => codec + ':' + e.name)))`);
    console.log(`  [S8] AudioDecoder.isConfigSupported: ${numbers.decoder.join(', ')}`);

    // ---- the page and its network ----
    const { sessionId: page } = await open('about:blank');
    const pressDown = async () => {
      for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 }, page);
    };
    // The first-visit tip over the feed ("use the ↑↓ keys…"): its own button.
    const dismissTip = () => evaluate(page, `(() => { const t = [...document.querySelectorAll('div, span')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Got it'); const b = t && (t.closest('button, [role="button"]') || t); if (!b) return false; b.click(); return true; })()`).catch(() => false);
    // A screenshot the moment a bilingual cue is on the video, then its lower part.
    const shootLive = async (name, item) => {
      const tr = await until(async () => {
        const r = await track(page);
        return r && (!item || r.item === item) ? bilingual(r) : null;
      }, 20000, 100);
      if (!tr) return null;
      await shoot(page, name);
      await shoot(page, `${name}-zoom`, zoomOf(tr));
      return tr.active;
    };
    shell.pages.add(page);
    await cdp.send('Network.enable', {}, page);
    const items = new Map(); // item id → { author, dur, subs: [{ lang, file }] }
    const vtt = []; // the player's WebVTT requests
    const vttById = new Map();
    const listen = { block: true, blocked: 0 };
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/video/tos/*', resourceType: 'XHR', requestStage: 'Request' }] }, page);
    cdp.listen((m) => {
      if (m.sessionId !== page) return;
      if (m.method === 'Fetch.requestPaused') {
        const file = VTT_FILE.exec(new URL(m.params.request.url).pathname)?.[1];
        if (file && listen.block) {
          listen.blocked++;
          cdp.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }, page).catch(() => {});
        } else cdp.send('Fetch.continueRequest', { requestId: m.params.requestId }, page).catch(() => {});
        return;
      }
      if (m.method === 'Network.requestWillBeSent') {
        const u = m.params.request.url;
        let path = '';
        try {
          path = new URL(u).pathname;
        } catch {}
        const file = VTT_FILE.exec(path)?.[1];
        if (file) {
          const r = { file, type: m.params.type, host: new URL(u).hostname, at: Date.now(), status: null, ct: null, bytes: null, head: null, failed: null };
          vtt.push(r);
          vttById.set(m.params.requestId, r);
        } else if (/\/api\/(?:[\w-]+\/)*(?:item_list|item\/detail)\/?$/.test(path)) vttById.set(m.params.requestId, { list: true });
      }
      if (m.method === 'Network.responseReceived' && vttById.has(m.params.requestId)) {
        const r = vttById.get(m.params.requestId);
        r.status = m.params.response.status;
        r.ct = m.params.response.headers['content-type'] ?? m.params.response.headers['Content-Type'] ?? null;
      }
      if (m.method === 'Network.loadingFailed' && vttById.has(m.params.requestId)) vttById.get(m.params.requestId).failed = m.params.errorText;
      if (m.method === 'Network.loadingFinished' && vttById.has(m.params.requestId)) {
        const r = vttById.get(m.params.requestId);
        r.bytes = m.params.encodedDataLength;
        cdp.send('Network.getResponseBody', { requestId: m.params.requestId }, page).then(
          ({ body, base64Encoded }) => {
            const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
            if (!r.list) return void (r.head = text.slice(0, 40).replace(/\s+/g, ' '));
            try {
              for (const it of JSON.parse(text).itemList || []) {
                if (!it?.id) continue;
                const subs = (it.video?.subtitleInfos || []).map((s) => ({ lang: s.LanguageCodeName, source: s.Source, file: VTT_FILE.exec(new URL(s.Url).pathname)?.[1] ?? null, host: new URL(s.Url).hostname }));
                items.set(it.id, { author: it.author?.uniqueId, dur: it.video?.duration, subs });
              }
            } catch {}
          },
          () => {}
        );
      }
    });

    // ---- (a) / (b): the feed, captions failed ----
    const tOpen = Date.now();
    await cdp.send('Page.navigate', { url: FEED }, page);
    const tab = await until(() => tabIdOf('https://www.tiktok.com/'), 20000);
    const ev1 = await until(async () => {
      const ev = await evidence(tab);
      return ev?.primaryElId && ev.mediaId && ev.mse.streams.some((s) => s.kind === 'audio') ? ev : null;
    }, 45000);
    const w1 = await walls(page, 'feed open');
    const t1 = await track(page);
    const media1 = ev1?.media.find((x) => x.elId === ev1.primaryElId);
    numbers.feed = { url: ev1?.url, mediaId: ev1?.mediaId, pageItem: t1?.item, navSeq: ev1?.navSeq, videos: t1?.videos, video: media1 && { state: media1.state, duration: media1.duration, muted: media1.muted, w: media1.width, h: media1.height, loop: t1?.loop }, walls: w1 };
    step('(a) evidence: site tiktok, the playing video’s item id, hooks in place', ev1?.site === 'tiktok' && !!ev1.mediaId && ev1.mediaId === t1?.item && ev1.hooks?.main === 'ok' && ev1.hooks?.mse === 'ok' && ev1.hooks?.xhr === 'ok', `${JSON.stringify(numbers.feed)}; hooks ${JSON.stringify(ev1?.hooks)}`);
    if (!ev1) await dump(tab);

    // One video at a time: its audio stream, the capture, the first sentence
    // and the first bilingual cue on its own video; then ArrowDown.
    const visited = [];
    const oldTexts = new Set();
    for (let i = 0; i < WALK; i++) {
      const ev = await evidence(tab);
      const st = await shell.state(tab);
      const row = { item: ev?.mediaId, navSeq: ev?.navSeq, codec: ev?.mse.audio?.codec ?? null, forward: ev?.mse.audio?.forward ?? null, mime: ev?.mse.audio?.mime ?? null, duration: null, tier2Ms: null, firstSentenceMs: null, bilingualMs: null, sentence: null, onTrack: null, keys: [], pace: null, tier: st?.run?.tier ?? null };
      if (i > 0) Object.assign(row, { switch: visited[i - 1].next });
      const from = i === 0 ? tOpen : row.switch.at;
      const samples = [];
      // Up to 30 s (or until it spoke and showed): streams twice a second.
      for (const s0 = Date.now(); Date.now() - s0 < 30000; await sleep(500)) {
        const e = await evidence(tab);
        const s = await shell.state(tab);
        const tr = await track(page);
        if (!e || e.mediaId !== row.item) break; // the feed moved on by itself
        const a = e.mse.streams.find((x) => x.streamId === e.capture?.streamId) || e.mse.streams.find((x) => x.streamId === e.mse.audio?.streamId);
        samples.push({ t: Date.now(), chunks: a?.chunks ?? 0, bytes: a?.bytes ?? 0, streamId: a?.streamId ?? null });
        row.codec = a?.codec ?? row.codec;
        row.duration ??= e.media.find((x) => x.elId === e.primaryElId)?.duration ?? null;
        if (s?.run?.tier === 2 && row.tier2Ms === null) row.tier2Ms = Date.now() - from;
        if (e.capture?.key && !row.keys.includes(e.capture.key)) row.keys.push(e.capture.key);
        const segs = segmentsOf(await mediaEvents()).filter((x) => row.keys.includes(x.key));
        if (segs.length && row.firstSentenceMs === null) {
          row.firstSentenceMs = segs[0].at - from;
          row.sentence = { text: segs[0].event.text, start: segs[0].event.start, end: segs[0].event.end, key: segs[0].key };
        }
        if (tr?.item === row.item && bilingual(tr) && row.bilingualMs === null) {
          row.bilingualMs = Date.now() - from;
          row.onTrack = tr.active;
          row.drawn = { on: tr.drawn, transparent: tr.transparent };
          if (!visited.some((v) => v.shot)) {
            row.shot = true;
            numbers.tipDismissed = await dismissTip();
            numbers.feedShot = await shootLive('1-feed-captions', row.item);
          }
        }
        row.sentences = segs.length;
        if (row.bilingualMs !== null && Date.now() - s0 > 6000) break;
      }
      if (samples.length > 1) {
        const [a, b] = [samples[0], samples.at(-1)];
        row.pace = { chunks: b.chunks - a.chunks, kb: Math.round((b.bytes - a.bytes) / 1024), seconds: Math.round((b.t - a.t) / 1000), streamChunks: b.chunks, avgChunkB: b.chunks ? Math.round(b.bytes / b.chunks) : null };
      }
      for (const s of segmentsOf(await mediaEvents()).filter((x) => row.keys.includes(x.key))) oldTexts.add(s.event.text);
      visited.push(row);
      const v2done = visited.some((v) => v.codec === 'mp4a.40.29' && v.bilingualMs !== null);
      if (i >= 2 && v2done) break;
      if (i === WALK - 1) break;

      // ArrowDown, then the switch: navSeq, media id, captures, cues.
      const before = await evidence(tab);
      // A capture already closed (a loop restarts it) needs no closing.
      const oldKey = before?.capture?.on ? before.capture.key : null;
      await dismissTip();
      const tKey = Date.now();
      await pressDown();
      const next = { at: tKey, fromItem: row.item, oldKey, closedBefore: before?.capture?.on === false ? before.capture.key : null, presses: 1, navigatedMs: null, mediaId: null, navSeq: null, pageItem: null, oldClosedMs: null, newKey: null, newCaptureMs: null, stale: [] };
      for (const s0 = Date.now(); Date.now() - s0 < 8000; await sleep(100)) {
        // A key the feed missed (not focused yet): once more.
        if (next.navigatedMs === null && next.presses === 1 && Date.now() - tKey > 3000) {
          next.presses++;
          await pressDown();
        }
        const e = await evidence(tab);
        const tr = await track(page);
        if (e && e.navSeq > (before?.navSeq ?? 0) && next.navigatedMs === null) Object.assign(next, { navigatedMs: Date.now() - tKey, mediaId: e.mediaId, navSeq: e.navSeq });
        if (tr && tr.item && tr.item !== row.item) {
          next.pageItem = tr.item;
          for (const c of tr.cues) if (oldTexts.has(c.split('\n')[0])) next.stale.push(c.slice(0, 60));
        }
        const evs = await mediaEvents();
        if (oldKey && next.oldClosedMs === null && evs.some((x) => x.key === oldKey && x.at >= tKey && (x.event.type === 'closed' || (x.event.type === 'status' && x.event.state === 'stopped')))) next.oldClosedMs = evs.find((x) => x.key === oldKey && x.at >= tKey && (x.event.type === 'closed' || x.event.type === 'status')).at - tKey;
        if (e?.capture?.on && e.capture.key !== (oldKey ?? next.closedBefore) && next.navigatedMs !== null && next.newKey === null) Object.assign(next, { newKey: e.capture.key, newCaptureMs: Date.now() - tKey, newStream: e.capture.streamId, oldStream: before?.capture?.streamId ?? null });
        if (next.navigatedMs !== null && next.newKey && (next.oldClosedMs !== null || !oldKey) && Date.now() - s0 > 2000) break;
      }
      next.stale = [...new Set(next.stale)];
      row.next = next;
      if (next.navigatedMs === null) {
        await dump(tab);
        break;
      }
    }
    numbers.walk = visited.map((row) => {
      const v = { ...row };
      const next = row.next;
      for (const k of ['next', 'switch', 'shot']) delete v[k];
      return { ...v, next: next && { presses: next.presses, navigatedMs: next.navigatedMs, mediaId: next.mediaId, navSeq: next.navSeq, pageItem: next.pageItem, oldKey: next.oldKey, oldClosedMs: next.oldClosedMs, newKey: next.newKey, newCaptureMs: next.newCaptureMs, streams: `${next.oldStream}→${next.newStream}`, stale: next.stale } };
    });
    console.log(`  [S8] walk:\n    ${numbers.walk.map((v) => JSON.stringify(v)).join('\n    ')}`);
    numbers.vttBlocked = listen.blocked;
    const first = visited[0];
    step('(a) MSE audio is fMP4 HE-AAC, forwarded', !!first && /^mp4a\.40\.(5|29|2)$/.test(first.codec || '') && first.forward === true, `${first?.mime} ${first?.codec} forward ${first?.forward}; codecs seen ${[...new Set(visited.map((v) => v.codec))].join(', ')}`);
    const spoke = visited.find((v) => v.bilingualMs !== null);
    step('(a) captions failed: tier 2 runs, real sentences show on the track, bilingual', !!spoke && spoke.tier2Ms !== null, spoke ? `video ${spoke.item} (${spoke.codec}, ${spoke.duration} s): tier 2 at ${spoke.tier2Ms} ms, first sentence ${spoke.firstSentenceMs} ms, bilingual cue ${spoke.bilingualMs} ms; «${spoke.sentence?.text}»; ${listen.blocked} WebVTT requests failed` : 'no video spoke');
    // TikTok draws most videos on a canvas over a transparent <video>: the native track would not show there.
    const drawn = visited.filter((v) => v.drawn).map((v) => ({ item: v.item, ...v.drawn }));
    step('(a) captions are drawn where they show: the overlay over a transparent (canvas-drawn) video, else the track', drawn.length > 0 && drawn.every((d) => d.on === (d.transparent ? 'overlay' : 'track')), JSON.stringify(drawn));
    const v2 = visited.find((v) => v.codec === 'mp4a.40.29' && v.bilingualMs !== null);
    const v2any = visited.filter((v) => v.codec === 'mp4a.40.29');
    step('(a) HE-AAC v2 (mp4a.40.29) is decoded: real sentences from it', !!v2, v2 ? `video ${v2.item}: «${v2.sentence?.text}» (${v2.sentences} sentences); isConfigSupported ${numbers.decoder.join(', ')}` : `${v2any.length} v2 videos visited, none spoke: ${JSON.stringify(v2any.map((v) => ({ item: v.item, sentences: v.sentences, tier2Ms: v.tier2Ms })))}`);
    const switches = visited.filter((v) => v.next).map((v) => ({ from: v.item, ...v.next }));
    const goodSwitch = (s) => s.navigatedMs !== null && s.mediaId === s.pageItem && s.mediaId !== s.fromItem && !s.stale.length;
    step('(b) ArrowDown is a navigation: new navSeq, the new item’s media id, none of the old cues on the new video', switches.length > 0 && switches.every(goodSwitch), JSON.stringify(switches.map((s) => ({ from: s.from, to: s.mediaId, page: s.pageItem, navSeq: s.navSeq, ms: s.navigatedMs, stale: s.stale }))));
    step('(b) the old capture closes (or was closed already), a new one opens on the new video’s stream', switches.length > 0 && switches.every((s) => (!s.oldKey || s.oldClosedMs !== null) && s.newKey && s.newStream !== s.oldStream), JSON.stringify(switches.map((s) => ({ old: s.oldKey ?? `${s.closedBefore} (closed before)`, closedMs: s.oldClosedMs, new: s.newKey, openedMs: s.newCaptureMs, streams: `${s.oldStream}→${s.newStream}` }))));
    const after = visited.slice(1).filter((v) => v.bilingualMs !== null);
    step('(b) a video after the switch gets its own sentences on the track', after.length > 0, after.map((v) => `${v.item} (${v.codec}): ${v.bilingualMs} ms after the key, first sentence ${v.firstSentenceMs} ms «${v.sentence?.text}»`).join('; ') || JSON.stringify(visited.slice(1).map((v) => ({ item: v.item, sentences: v.sentences, tier2Ms: v.tier2Ms }))));
    if (after.length) numbers.nextShot = await shootLive('2-next-video', visited.at(-1).item);

    // ---- (c) video pages, captions failed ----
    const seen = new Set(visited.map((v) => v.item));
    const pickPage = (withSubs, min, max) => [...items.entries()].filter(([id, x]) => !seen.has(id) && x.author && x.dur >= min && x.dur <= max && (!withSubs || x.subs.some((s) => /^eng/.test(s.lang || '') && s.file))).sort((a, b) => a[1].dur - b[1].dur)[0];
    // One video page: its media id, tier 2, sentences after opening it, the
    // audio appended by the time the capture opened.
    async function videoPage(name, pick, shot) {
      if (!pick) return step(name, false, `no item to open among ${items.size}`);
      const [id, it] = pick;
      seen.add(id);
      const url = `https://www.tiktok.com/@${it.author}/video/${id}`;
      // Never opened before: nothing may be cached for it, no earlier video's cue may show on it.
      const cachedBefore = (await shell.ext('cache/get', { key: `tiktok:${id}` }))?.result?.cues?.length ?? 0;
      const tC = Date.now();
      await cdp.send('Page.navigate', { url }, page);
      const stale = new Set();
      const watchStale = setInterval(() => {
        track(page).then((tr) => {
          if (tr?.item === id) for (const c of tr.cues) if (oldTexts.has(c.split('\n')[0])) stale.add(c.slice(0, 60));
        });
      }, 300);
      const evC = await until(async () => {
        const e = await evidence(tab);
        return e?.mediaId === id && e.primaryElId ? e : null;
      }, 30000);
      await walls(page, name);
      // This page's own captures (the last page's may still flush a sentence or two).
      const keys = new Set();
      const capC = await until(async () => {
        const e = await evidence(tab);
        if (e?.mediaId === id && e.capture?.key) keys.add(e.capture.key);
        return e?.capture?.on && e.mediaId === id ? e : null;
      }, 40000);
      const trC = await until(async () => {
        const e = await evidence(tab);
        if (e?.mediaId === id && e.capture?.key) keys.add(e.capture.key);
        const tr = await track(page);
        return tr?.item === id ? bilingual(tr) : null;
      }, 60000, 300);
      clearInterval(watchStale);
      const all = segmentsOf(await mediaEvents()).filter((x) => x.at >= tC);
      const segs = all.filter((x) => keys.has(x.key));
      const late = all.filter((x) => !keys.has(x.key)).map((x) => ({ key: x.key, ms: x.at - tC, text: x.event.text.slice(0, 50) }));
      const evEnd = await evidence(tab);
      const audioAt = capC?.mse.streams.find((x) => x.streamId === capC.capture.streamId);
      const row = { url, dur: it.dur, mediaId: evC?.mediaId, navSeq: evC?.navSeq, captureMs: capC ? Date.now() - tC : null, audioWhenCaptureOpened: audioAt && { chunks: audioAt.chunks, kb: Math.round(audioAt.bytes / 1024), firstTimeS: audioAt.firstTimeS, lastTimeS: audioAt.lastTimeS }, captures: keys.size, lastPageLate: late, firstSentenceMs: segs[0] ? segs[0].at - tC : null, sentence: segs[0]?.event.text ?? null, bilingualMs: trC ? Date.now() - tC : null, onTrack: trC?.active, drawn: trC && { on: trC.drawn, transparent: trC.transparent }, codec: evEnd?.mse.audio?.codec, history: ((await shell.state(tab))?.history || []).filter((h) => h.at >= tC).map((h) => `${h.at - tC}ms ${h.state}${h.detail ? ' ' + JSON.stringify(h.detail) : ''}`).slice(0, 12), cachedBefore, stale: [...stale] };
      for (const x of segs) oldTexts.add(x.event.text);
      step(name, !!evC && !!capC && !!trC && !cachedBefore && !stale.size, JSON.stringify(row));
      if (trC) row.shot = await shootLive(shot, id);
      else await dump(tab);
      return row;
    }
    numbers.videoPage = await videoPage('(c) a video page (30 s or more): the media id from the URL, tier 2, real sentences bilingual on the track', pickPage(false, 30, 300), '3-video-page');
    // Short videos get all their audio appended at once, before any capture opens.
    const short = pickPage(false, 6, 20);
    if (short) numbers.shortVideoPage = await videoPage('(c) a short video page (20 s or less, audio appended at once): the same', short, '3-short-video-page');
    else console.log(`  [S8] no short video (6–20 s) left in the item data (${items.size} items): skipped`);

    // ---- (d) captions allowed: tier 1 ----
    listen.block = false;
    const pd = pickPage(true, 10, 300);
    if (!pd) step('(d) a video page with English captions in the item data', false, `none among ${items.size}`);
    else {
      const [id, it] = pd;
      seen.add(id);
      const url = `https://www.tiktok.com/@${it.author}/video/${id}`;
      const tD = Date.now();
      const vttBefore = vtt.length;
      await cdp.send('Page.navigate', { url }, page);
      await until(async () => (await evidence(tab))?.mediaId === id, 30000);
      await walls(page, 'video page with captions');
      const sub = await until(async () => {
        const q = await query(tab);
        return q?.subtitles?.find((s) => s.mediaId === id && s.cueCount > 0) || null;
      }, 30000, 300);
      const site1 = await stateIs(tab, 'captions', 20000);
      const trD = await until(async () => {
        const tr = await track(page);
        return tr?.item === id && tr.active.some((t) => t.includes('\n[译]')) ? tr : null;
      }, 40000, 300);
      const want = it.subs.map((s) => s.file);
      const reqs = vtt.slice(vttBefore).map((r) => ({ file: r.file.slice(0, 8), mine: want.includes(r.file), type: r.type, host: r.host, ct: r.ct, bytes: r.bytes, head: r.head, failed: r.failed }));
      const layer = await evaluate(page, `(() => { const els = [...document.querySelectorAll('[class*="DivCaptionContainer"]')]; const rule = [...document.querySelectorAll('style')].some((s) => s.textContent.includes('DivCaptionContainer')); return { layers: els.length, display: els.map((e) => getComputedStyle(e).display), rule }; })()`);
      numbers.siteCaptions = { url, dur: it.dur, itemSubs: it.subs.map((s) => `${s.lang}/${s.source}/${s.file?.slice(0, 8)}@${s.host}`), requests: reqs, subtitle: sub && { format: sub.format, lang: sub.lang, kind: sub.kind, cueCount: sub.cueCount, via: sub.via, mediaId: sub.mediaId }, tierMs: site1 ? Date.now() - tD : null, onTrack: trD?.active, drawn: trD && { on: trD.drawn, transparent: trD.transparent }, layer };
      step('(d) the player’s WebVTT file is copied and claimed by its item', !!sub && sub.format === 'vtt' && reqs.some((r) => r.mine), JSON.stringify({ subtitle: numbers.siteCaptions.subtitle, requests: reqs, itemSubs: numbers.siteCaptions.itemSubs }));
      step('(d) tier 1: both lines on the track, the caption layer hidden', site1?.run?.tier === 1 && !!trD && layer?.rule && layer.display.every((d) => d === 'none'), `state ${site1?.state} tier ${site1?.run?.tier}; ${JSON.stringify(trD?.active)}; layer ${JSON.stringify(layer)}`);
      if (trD) numbers.siteShot = await shootLive('4-site-captions', id);
      else await dump(tab);

      // The feed with captions allowed: tier 1 on the first video and after ArrowDown.
      await cdp.send('Page.navigate', { url: FEED }, page);
      const feedRows = [];
      for (let i = 0; i < 3; i++) {
        const e0 = await until(async () => {
          const e = await evidence(tab);
          return e?.url === FEED && e.mediaId && e.primaryElId ? e : null;
        }, 30000);
        const tS = Date.now();
        const id2 = e0?.mediaId;
        const hasSubs = !!items.get(id2)?.subs.some((s) => s.file);
        const t1r = await until(async () => {
          const s = await shell.state(tab);
          const tr = await track(page);
          return s?.run && tr?.item === id2 && tr.active.some((t) => t.includes('\n[译]')) ? { tier: s.run.tier, active: tr.active } : null;
        }, hasSubs ? 20000 : 8000, 200);
        const q = await query(tab);
        const stNow = await shell.state(tab);
        const evNow = await evidence(tab);
        const mNow = evNow?.mediaId === id2 ? evNow.media.find((x) => x.elId === evNow.primaryElId) : null;
        feedRows.push({ item: id2, hasSubs, dur: mNow?.duration ?? null, block: stNow?.block ?? null, tier: t1r?.tier ?? stNow?.run?.tier ?? null, ms: t1r ? Date.now() - (feedRows.length ? feedRows.at(-1).keyAt : tS) : null, subtitles: (q?.subtitles || []).map((s) => `${s.mediaId === id2 ? 'mine' : s.mediaId}:${s.cueCount}`) });
        // On the first video in tier 1, the player's own captions on (its CC button, once its
        // controls are drawn): its layer gets text, our rule keeps it hidden.
        if (!numbers.captionButton && feedRows.at(-1).tier === 1) {
          const button = await until(() => evaluate(page, `(() => { const b = document.querySelector('[data-e2e="cinema-playback-control-captions"]'); if (!b) return null; const was = b.getAttribute('aria-pressed'); if (was !== 'true') b.click(); return { was, availability: b.getAttribute('data-caption-availability') }; })()`), 15000, 500);
          const layerOn = await until(() => evaluate(page, `(() => { const b = document.querySelector('[data-e2e="cinema-playback-control-captions"]'); const els = [...document.querySelectorAll('[class*="DivCaptionContainer"]')]; const text = els.map((e) => e.textContent).join(' ').trim(); return b && b.getAttribute('aria-pressed') === 'true' && text ? { pressed: true, text: text.slice(0, 60), display: els.map((e) => getComputedStyle(e).display) } : null; })()`), 10000, 300);
          numbers.captionButton = { item: id2, button, layer: layerOn };
          step('(d) the player’s CC button on: its caption layer has text, ours keeps it hidden', !!button && !!layerOn && layerOn.display.every((d) => d === 'none'), JSON.stringify(numbers.captionButton));
        }
        if (i === 2) break;
        const tKey = Date.now();
        feedRows.at(-1).keyAt = tKey;
        await dismissTip();
        await pressDown();
        if (!(await until(async () => (await evidence(tab))?.mediaId !== id2, 3000, 100))) await pressDown();
        await until(async () => (await evidence(tab))?.mediaId !== id2, 5000, 100);
      }
      if (!numbers.captionButton) console.log('  [S8] no feed video reached tier 1: the CC button was not tried');
      numbers.feedTier1 = feedRows.map((row) => ({ item: row.item, hasSubs: row.hasSubs, dur: row.dur, block: row.block, tier: row.tier, ms: row.ms, subtitles: row.subtitles }));
      // Videos of 5 s or less get no captions by design (sound effects).
      const withSubs = feedRows.filter((r) => r.hasSubs && !(r.dur <= 5));
      step('(d) the feed: videos with captions get tier 1, also after ArrowDown (prefetched files claimed by their items)', withSubs.length > 0 && withSubs.every((r) => r.tier === 1), JSON.stringify(numbers.feedTier1));
    }

    // ---- (e) prefs ----
    await shell.setPrefs({ targetLang: 'zh', siteOff: { tiktok: true } });
    const off = await stateIs(tab, 'off', 10000);
    const [badgeOff, titleOff] = (await shell.badge(tab)) || [];
    const evOff = await evidence(tab);
    step('(e) site switched off: stopped, badge says off', !!off && !evOff?.capture?.on && badgeOff === 'off', `${off?.state}; badge ${badgeOff} · ${titleOff}`);
    await shell.setPrefs({ targetLang: 'zh', siteOff: {} });
    const onAgain = await until(async () => {
      const s = await shell.state(tab);
      return s && s.state !== 'off' ? s : null;
    }, 15000);
    step('(e) switched on again: it runs again', !!onAgain && onAgain.state !== 'off', `${onAgain?.state} ${JSON.stringify(onAgain?.run)}`);

    numbers.siteExceptions = shell.pageExceptions.site;
    step('no exceptions from our scripts on the pages, none in extension contexts', shell.pageExceptions.ours.length === 0 && shell.extProblems.length === 0, [...shell.pageExceptions.ours, ...shell.extProblems].join(' || '));
    step('no captcha or login wall met (none worked around)', numbers.walls.length === 0, JSON.stringify(numbers.walls));
    console.log(`\n  numbers: ${JSON.stringify(numbers, null, 1)}`);
    console.log(`  screenshots:\n    ${shell.shots.join('\n    ')}`);
  } finally {
    await shell.close();
  }
  return summary();
}

run(main);
