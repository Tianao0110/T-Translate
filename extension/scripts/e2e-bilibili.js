// Bilibili on real pages, hands off: the real companion server and listen
// engine in a sandbox Electron, the built extension in Chrome (shell in
// lib/e2e-shell.js), nothing commanded from outside. Read through the
// extension's own messages and the page over CDP.
//
//   (a) a long public video: the evidence says bilibili, the BV id, a video,
//       hooks in place; the audio is an MSE audio/mp4 stream (not forwarded:
//       fMP4 / AAC is S7) with its init segment seen at document_start;
//       numbers for S7 (mime, append sizes and pace, the .m4s range requests)
//   (b) the player's subtitle list request is copied (signed out it lists
//       nothing: need_login_subtitle is recorded); the player's subtitle
//       layer the hide rule targets is on the page
//   (c) the orchestrator ends at tier 3: the prompt state and the notice bar
//   (d) a multi-part video: switching to part 2 is a navigation with the
//       :p2 media id and a new subtitle list
//   (e) a subtitle list we serve on a bilibili.com URL (CDP Fetch, like the
//       DRM page in e2e-auto.js): the agent fetches the human-made body from
//       hdslb.com, tier 1 starts, the track shows both lines and the
//       player's subtitle layer is hidden
//
//   npx electron extension/scripts/e2e-bilibili.js --packs <installed asr-models dir> [--browser <exe>] [--out <screenshots dir>] [--headed] [--video <BV>] [--multi <BV with parts>]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not
// copied. The sandbox is left in place for the recycle bin.
/* eslint-disable no-console */

const { arg, sleep, checklist, run } = require('../../scripts/lib/electron-smoke');
const { startShell } = require('./lib/e2e-shell');

const { step, summary } = checklist();
const VIDEO = arg('--video') || 'BV18GW76hEdg';
const MULTI = arg('--multi') || 'BV1Xx411c7cH';
const FAKE = 'BV1tcE2e0001';
const FAKE_PAGE = `https://www.bilibili.com/video/${FAKE}/`;
const FAKE_LIST = 'https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=2&tc=e2e';
const FAKE_AI = 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/tc-e2e-ai';
const FAKE_HUMAN = 'https://i0.hdslb.com/bfs/subtitle/tc-e2e-human.json';
const AUDIO_M4S = /-302\d\d\.m4s/;

const FAKE_BODY = JSON.stringify({ type: 'subtitle', lang: 'en-US', body: Array.from({ length: 60 }, (_, i) => ({ from: i * 2, to: i * 2 + 1.9, sid: i + 1, location: 2, content: `Line ${i + 1} of the served subtitles` })) });
const FAKE_LIST_BODY = JSON.stringify({
  code: 0,
  data: {
    bvid: FAKE,
    need_login_subtitle: false,
    subtitle: {
      subtitles: [
        { lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: `//${FAKE_AI.slice(8)}`, ai_type: 1, ai_status: 2 },
        { lan: 'en-US', lan_doc: 'English', subtitle_url: `//${FAKE_HUMAN.slice(8)}`, ai_type: 0, ai_status: 0 },
      ],
    },
  },
});
// A playing canvas video, a subtitle layer like the player's and the player's list request (XHR, as Bilibili does).
const FAKE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>T-Caption Bilibili test</title>
<style>body{margin:0;background:#222;font:14px system-ui}#wrap{position:relative;width:960px;height:540px;margin:20px}video{display:block;width:100%;height:100%;background:#000}.bpx-player-subtitle-wrap{position:absolute;left:0;right:0;bottom:40px;text-align:center;color:#ff0;font-size:24px}</style></head>
<body><div id="wrap"><video id="v" autoplay></video><div class="bpx-player-subtitle-wrap">site subtitle layer</div></div>
<script>
  const c = Object.assign(document.createElement('canvas'), { width: 960, height: 540 });
  const g = c.getContext('2d');
  let n = 0;
  setInterval(() => { g.fillStyle = n++ % 2 ? '#345' : '#453'; g.fillRect(0, 0, 960, 540); }, 500);
  const v = document.getElementById('v');
  v.srcObject = c.captureStream(30);
  v.play().catch(() => {});
  setTimeout(() => { const x = new XMLHttpRequest(); x.open('GET', ${JSON.stringify(FAKE_LIST)}); x.withCredentials = true; x.send(); }, 1500);
</script></body></html>`;

async function main() {
  const shell = await startShell({ name: 'tt-caption-bili', step, version: 'e2e-s6-bili', shotPrefix: 't-caption-s6' });
  if (!shell) return 2;
  const { cdp, evaluate, open, until, evidence, query, tabIdOf, stateIs, shoot, dump, trackInfo } = shell;
  const numbers = {};

  try {
    // The real videos speak Chinese; English is the target.
    await shell.setPrefs({ targetLang: 'en' });

    // ---- (a) a long public video ----
    const { sessionId: page1 } = await open('about:blank');
    shell.pages.add(page1);
    await cdp.send('Network.enable', {}, page1);
    const net = { lists: [], m4s: [], subtitleBodies: [] };
    const byId = new Map();
    cdp.listen((m) => {
      if (m.sessionId !== page1) return;
      if (m.method === 'Network.requestWillBeSent') {
        const u = m.params.request.url;
        if (/api\.bilibili\.com\/x\/player\/(wbi\/)?v2/.test(u)) byId.set(m.params.requestId, { kind: 'list', url: u, type: m.params.type });
        else if (/\.m4s(\?|$)/.test(u)) byId.set(m.params.requestId, { kind: 'm4s', audio: AUDIO_M4S.test(u), type: m.params.type, range: m.params.request.headers.Range || m.params.request.headers.range || null, at: Date.now() });
        else if (/hdslb\.com\/bfs\/(ai_)?subtitle\//.test(u)) byId.set(m.params.requestId, { kind: 'body', url: u, type: m.params.type });
      }
      if (m.method === 'Network.responseReceived' && byId.has(m.params.requestId)) {
        const r = byId.get(m.params.requestId);
        r.status = m.params.response.status;
        r.acao = m.params.response.headers['access-control-allow-origin'] ?? m.params.response.headers['Access-Control-Allow-Origin'] ?? null;
      }
      if (m.method === 'Network.loadingFinished' && byId.has(m.params.requestId)) {
        const r = byId.get(m.params.requestId);
        r.bytes = m.params.encodedDataLength;
        if (r.kind === 'list') {
          cdp.send('Network.getResponseBody', { requestId: m.params.requestId }, page1).then(
            ({ body }) => {
              try {
                const j = JSON.parse(body);
                r.code = j.code;
                r.needLogin = j.data?.need_login_subtitle ?? null;
                r.subtitles = j.data?.subtitle?.subtitles?.length ?? null;
              } catch {}
            },
            () => {}
          );
          net.lists.push(r);
        } else if (r.kind === 'm4s') net.m4s.push(r);
        else net.subtitleBodies.push(r);
      }
    });
    const tOpen = Date.now();
    await cdp.send('Page.navigate', { url: `https://www.bilibili.com/video/${VIDEO}/` }, page1);
    const tab1 = await until(() => tabIdOf('https://www.bilibili.com/'), 15000);
    const ev1 = await until(async () => {
      const ev = await evidence(tab1);
      return ev?.primaryElId && ev.mse.streams.some((s) => s.kind === 'audio') ? ev : null;
    }, 45000);
    const media1 = ev1?.media.find((x) => x.elId === ev1.primaryElId);
    numbers.page = { url: ev1?.url, mediaId: ev1?.mediaId, navSeq: ev1?.navSeq, video: media1 && { state: media1.state, duration: media1.duration, w: media1.width, h: media1.height, src: media1.src.slice(0, 20) } };
    step('(a) evidence: site bilibili, the BV id, a video, hooks in place', ev1?.site === 'bilibili' && ev1.mediaId === VIDEO && !!media1 && ev1.hooks?.main === 'ok' && ev1.hooks?.xhr === 'ok' && ev1.hooks?.mse === 'ok', `${JSON.stringify(numbers.page)}; hooks ${JSON.stringify(ev1?.hooks)}`);
    if (!ev1) await dump(tab1);

    // Twenty seconds of appends: the pace and sizes S7 will deal with.
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const ev = await evidence(tab1);
      const a = ev?.mse.streams.find((s) => s.kind === 'audio' && s.alive);
      const m = ev?.media.find((x) => x.elId === ev.primaryElId);
      if (a) samples.push({ t: Date.now() - tOpen, chunks: a.chunks, bytes: a.bytes, ct: m?.currentTime ?? null, buf: m?.bufferedEndS ?? null });
      await sleep(1000);
    }
    const evA = await evidence(tab1);
    const audio = evA?.mse.streams.filter((s) => s.kind === 'audio');
    const a0 = audio?.find((s) => s.alive) || audio?.[0];
    const first = samples[0];
    const last = samples.at(-1);
    numbers.audio = a0 && {
      mime: a0.mime,
      codec: a0.codec,
      forward: a0.forward,
      init: a0.init,
      inits: a0.inits,
      chunks: a0.chunks,
      bytes: a0.bytes,
      avgChunk: a0.chunks ? Math.round(a0.bytes / a0.chunks) : null,
      streams: audio.length,
      video: evA.mse.streams.filter((s) => s.kind === 'video').map((s) => s.mime),
      paceLast20s: first && last ? { chunks: last.chunks - first.chunks, bytes: last.bytes - first.bytes, seconds: Math.round((last.t - first.t) / 1000) } : null,
      ahead: last && last.buf !== null && last.ct !== null ? Math.round((last.buf - last.ct) * 10) / 10 : null,
    };
    step('(a) MSE audio is audio/mp4, not forwarded, init segment seen', !!a0 && /^audio\/mp4/.test(a0.mime) && a0.forward === false && a0.inits >= 1, JSON.stringify(numbers.audio));
    const audioReqs = net.m4s.filter((r) => r.audio);
    numbers.m4s = {
      audioRequests: audioReqs.length,
      videoRequests: net.m4s.length - audioReqs.length,
      audioTypes: [...new Set(audioReqs.map((r) => r.type))],
      audioRanges: audioReqs.slice(0, 6).map((r) => `${r.range || 'no range'} → ${r.bytes} B`),
    };
    console.log(`  [S7] samples: ${samples.map((s) => `${Math.round(s.t / 1000)}s ${s.chunks}ch ct=${s.ct?.toFixed?.(1)} buf=${s.buf?.toFixed?.(1)}`).join(' | ')}`);
    console.log(`  [S7] m4s: ${JSON.stringify(numbers.m4s)}`);

    // ---- (b) subtitle list and layer ----
    const q1 = await until(async () => {
      const q = await query(tab1);
      return q?.lists?.length ? q : null;
    }, 20000);
    await sleep(500);
    const list1 = net.lists[0];
    numbers.list = { agent: q1?.lists, network: net.lists.map((l) => ({ type: l.type, status: l.status, needLogin: l.needLogin, subtitles: l.subtitles, acao: l.acao })) };
    numbers.need_login = list1?.needLogin ?? null;
    step('(b) the player’s subtitle list (XHR) is copied to the agent', !!q1 && q1.lists[0].url === 'https://api.bilibili.com/x/player/wbi/v2', JSON.stringify(numbers.list));
    const layer = await evaluate(page1, `(() => { const a = document.querySelector('.bpx-player-subtitle-wrap'); const b = document.querySelector('.bilibili-player-video-subtitle'); return { bpx: !!a, old: !!b }; })()`);
    step('(b) the player’s subtitle layer the hide rule targets is on the page', layer?.bpx || layer?.old, JSON.stringify(layer));

    // ---- (c) tier 3 ----
    const prompt = await stateIs(tab1, 'prompt', 30000);
    const bar = await until(() => evaluate(page1, `(() => { const h = document.querySelector('.tc-nt-host'); const b = h && h.shadowRoot.querySelector('.tc-nt-bar'); if (!b || b.hidden) return null; return { text: h.shadowRoot.querySelector('.tc-nt-text').textContent, button: h.shadowRoot.querySelector('.tc-nt-btn').textContent }; })()`), 10000);
    const why = prompt?.history?.findLast?.((h) => h.state === 'prompt')?.detail?.why ?? null;
    step('(c) the orchestrator ends at tier 3: prompt state and the notice bar', !!prompt && !!bar, `state ${prompt?.state} (${why}); ${JSON.stringify(bar)}; ${Date.now() - tOpen} ms after opening`);
    if (!prompt || !bar) await dump(tab1);
    if (bar) await shoot(page1, '1-bilibili-prompt');
    const [badge1, title1] = (await shell.badge(tab1)) || [];
    numbers.promptBadge = `${badge1} · ${title1}`;

    // ---- (d) a multi-part video ----
    net.lists.length = 0;
    await cdp.send('Page.navigate', { url: `https://www.bilibili.com/video/${MULTI}/` }, page1);
    const evM = await until(async () => {
      const ev = await evidence(tab1);
      return ev?.mediaId === MULTI && ev.primaryElId ? ev : null;
    }, 30000);
    const parts = await until(() => evaluate(page1, `(() => { const n = window.__INITIAL_STATE__?.videoData?.pages?.length; return n ? n : null; })()`), 10000);
    await until(async () => (await query(tab1))?.lists?.length, 15000);
    const navBefore = evM?.navSeq ?? null;
    // The part list's second entry, clicked in the page; the list answers clicks
    // only some seconds after it shows, so click again until the URL moves.
    let clicks = 0;
    const clicked = await until(async () => {
      const r = await evaluate(page1, `(() => {
        if (/[?&]p=2(&|$)/.test(location.search)) return { moved: true };
        const items = [...document.querySelectorAll('.video-pod__item, #multi_page .list-box li')];
        const el = items[1] && (items[1].querySelector('.title') || items[1]);
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { items: items.length, cls: String(el.className) };
      })()`);
      if (r && !r.moved) clicks++;
      return r?.moved ? { clicks, url: await evaluate(page1, 'location.href') } : null;
    }, 30000, 2500);
    const evP2 = await until(async () => {
      const ev = await evidence(tab1);
      return ev?.mediaId === `${MULTI}:p2` ? ev : null;
    }, 15000);
    const q2 = await until(async () => {
      const q = await query(tab1);
      return q?.navSeq > navBefore && q.lists?.length ? q : null;
    }, 15000);
    numbers.multi = { parts, clicked, before: { navSeq: navBefore, mediaId: evM?.mediaId }, after: evP2 && { navSeq: evP2.navSeq, mediaId: evP2.mediaId, url: evP2.url }, listsAfter: q2?.lists?.length ?? 0, listCids: net.lists.map((l) => (l.url.match(/[?&]cid=(\d+)/) || [])[1]) };
    step('(d) part 2 is a navigation with the :p2 media id and a new subtitle list', parts > 1 && !!evP2 && evP2.navSeq > navBefore && !!q2, JSON.stringify(numbers.multi));
    if (!evP2) {
      const qd = await query(tab1);
      const evd = await evidence(tab1);
      console.log(`  [d] page ${await evaluate(page1, 'location.href')}; agent ${qd?.url} navSeq ${qd?.navSeq} mediaId ${qd?.mediaId}; worker ${evd?.url} navSeq ${evd?.navSeq} mediaId ${evd?.mediaId}`);
    }
    if (evP2) await shoot(page1, '2-bilibili-part2');

    // ---- (e) a list we serve ----
    await cdp.send('Page.navigate', { url: 'about:blank' }, page1);
    // The served subtitles are English: a Chinese target gets them translated.
    await shell.setPrefs({ targetLang: 'zh' });
    const { sessionId: page2 } = await open('about:blank');
    shell.pages.add(page2);
    await cdp.send('Network.enable', {}, page2);
    await cdp.send('Network.setBypassServiceWorker', { bypass: true }, page2);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${FAKE_PAGE}*` }, { urlPattern: '*tc=e2e*' }, { urlPattern: '*hdslb.com/bfs/*tc-e2e*' }] }, page2);
    const served = [];
    const unlisten = cdp.listen((m) => {
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== page2) return;
      const { url } = m.params.request;
      const reply = (type, body, extra = []) => cdp.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: type }, ...extra], body: Buffer.from(body).toString('base64') }, page2).catch(() => {});
      served.push({ url, credentials: m.params.request.headers.Cookie ? 'cookie' : 'none', origin: m.params.request.headers.Origin || null });
      if (url.startsWith(FAKE_PAGE)) reply('text/html; charset=utf-8', FAKE_HTML);
      else if (url.includes('tc=e2e')) reply('application/json', FAKE_LIST_BODY, [{ name: 'access-control-allow-origin', value: 'https://www.bilibili.com' }, { name: 'access-control-allow-credentials', value: 'true' }]);
      else reply('application/json', FAKE_BODY, [{ name: 'access-control-allow-origin', value: '*' }]);
    });
    await cdp.send('Page.navigate', { url: FAKE_PAGE }, page2);
    const tab2 = await until(() => tabIdOf(FAKE_PAGE), 10000);
    const captions = await stateIs(tab2, 'captions', 30000);
    const q3 = await query(tab2);
    const sub = (await evidence(tab2))?.subtitles?.[0];
    numbers.served = { requests: served.map((s) => `${s.url.replace(/^https:\/\//, '').slice(0, 60)} (${s.origin || 'no origin'})`), lists: q3?.lists, subtitle: sub && { url: sub.url, format: sub.format, lang: sub.lang, kind: sub.kind, cueCount: sub.cueCount, via: sub.via } };
    step('(e) the served list leads to one fetch of the human-made body; bcc cues reach the worker', sub?.url === FAKE_HUMAN && sub.format === 'bcc' && sub.cueCount === 60 && sub.lang === 'en-US' && served.filter((s) => s.url.includes('tc-e2e-')).length === 1, JSON.stringify(numbers.served));
    const active2 = await until(async () => {
      const r = await trackInfo(page2);
      return r && r.active.some((t) => t.includes('\n[译]')) ? r : null;
    }, 30000, 300);
    const hidden = await evaluate(page2, `getComputedStyle(document.querySelector('.bpx-player-subtitle-wrap')).display`);
    step('(e) tier 1: both lines on the track, the player’s subtitle layer hidden', !!captions && captions.run?.tier === 1 && !!active2 && hidden === 'none', `state ${captions?.state} tier ${captions?.run?.tier}; ${JSON.stringify(active2?.active)}; layer ${hidden}`);
    if (!active2) await dump(tab2);
    if (active2) {
      const clip = await evaluate(page2, `(() => { const r = document.querySelector('video').getBoundingClientRect(); return { x: r.left, y: r.top + r.height * 0.6, width: r.width, height: r.height * 0.4 }; })()`);
      // The first cue got its translation while on screen; a later one had it before it showed.
      numbers.firstCueShot = (await trackInfo(page2))?.active;
      await shoot(page2, '3-bilibili-first-cue-zoom', clip);
      const later = await until(async () => {
        const r = await trackInfo(page2);
        return r && r.active.some((t) => /^Line ([3-9]|\d\d) /.test(t) && t.includes('\n[译]')) ? r : null;
      }, 15000, 200);
      numbers.laterCueShot = later?.active;
      await shoot(page2, '4-bilibili-site-captions');
      await shoot(page2, '5-bilibili-later-cue-zoom', clip);
    }
    unlisten();

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
