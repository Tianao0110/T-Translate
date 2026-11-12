// Line controls, caption timing and a dropped subtitle file on a real
// YouTube page, hands off (shell in lib/e2e-shell.js). Captions run by
// themselves first (tier 2, as in e2e-auto.js), drawn as a track:
//
//   (a) the shortcut keys: six commands, the four line keys bound by default
//   (b) next twice, previous, repeat: each lands on a line's start and keeps
//       playing (previous goes back one line, repeat stays on it)
//   (c) pause per line (the pref, as the popup sets it): the video stops just
//       after a line ends, again after the next; off, it plays through
//   (d) caption timing: +2 s moves the track's lines 2 s later with a line on
//       the video saying so; back to 0
//   (e) an SRT file dropped on the video (CDP drag events carrying the file):
//       its lines become the captions (tier 1), translated
//
//   npx electron extension/scripts/e2e-study.js --packs <installed asr-models dir> [--browser <exe>] [--out <screenshots dir>] [--headed] [--video <id>]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not
// copied. The sandbox is left in place for the recycle bin.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { arg, checklist, run, sleep } = require('../../scripts/lib/electron-smoke');
const { startShell } = require('./lib/e2e-shell');

const { step, summary } = checklist();
const VIDEO = arg('--video') || 'UF8uR6Z6KLc';
const PAUSE_SLACK_S = 0.35;

const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

async function main() {
  const shell = await startShell({ name: 'tt-caption-study', step, version: 'e2e-study', shotPrefix: 't-caption-study' });
  if (!shell) return 2;
  const { cdp, evaluate, open, until, stateIs, dump, trackInfo, ext, shoot } = shell;
  const numbers = {};
  const prefs = { targetLang: 'zh' };
  const setPrefs = (patch) => shell.setPrefs(Object.assign(prefs, patch));

  try {
    await setPrefs({});

    // ---- (a) the shortcut keys ----
    const commands = await evaluate(shell.opt, `chrome.commands.getAll().then((cs) => cs.filter((c) => c.name !== '_execute_action').map((c) => ({ name: c.name, shortcut: c.shortcut || '' })))`);
    numbers.commands = commands;
    const keyOf = (name) => commands?.find((c) => c.name === name)?.shortcut ?? null;
    step('(a) six shortcut commands; previous / next / repeat / pause per line bound by default, earlier / later left for the user', commands?.length === 6 && ['prev-sentence', 'next-sentence', 'repeat-sentence', 'toggle-auto-pause'].every((n) => keyOf(n)) && keyOf('subs-earlier') === '' && keyOf('subs-later') === '', JSON.stringify(commands));

    // ---- captions on their own ----
    const { sessionId: page } = await open('about:blank');
    shell.pages.add(page);
    await cdp.send('Page.navigate', { url: `https://www.youtube.com/watch?v=${VIDEO}` }, page);
    const tab = await until(() => shell.tabIdOf('https://www.youtube.com/watch'), 15000);
    await until(() => evaluate(page, `!document.querySelector('#movie_player.ad-showing') && !!document.querySelector('#movie_player')`), 90000, 500);
    const captions = await stateIs(tab, 'captions', 60000);
    const running = await until(async () => {
      const r = await trackInfo(page);
      return r && r.active.some((t) => t.includes('\n')) && r.cues >= 4 ? r : null;
    }, 90000, 300);
    step('captions run by themselves', !!captions && !!running, `tier ${captions?.run?.tier}; ${running?.cues} cues; ${JSON.stringify(running?.active)}`);
    if (!running) {
      await dump(tab);
      return summary();
    }
    const command = async (c) => (await ext('tab/command', { tabId: tab, command: c }))?.result ?? null;
    const cueList = async () => ((await command({ cmd: 'cues', op: 'list' }))?.cues || []).map((c) => ({ start: c.start, end: c.end })).sort((a, b) => a.start - b.start);
    const video = () => evaluate(page, `(() => { const v = document.querySelector('video'); return { t: v.currentTime, paused: v.paused }; })()`);

    // ---- (b) line jumps ----
    const jumps = [];
    for (const action of ['next', 'next', 'prev', 'repeat']) {
      const before = await video();
      const r = await command({ cmd: 'sentence', action });
      await sleep(400);
      const after = await video();
      const starts = (await cueList()).map((c) => c.start);
      jumps.push({ action, before: before.t, at: r?.at, after: after.t, playing: !after.paused, isStart: starts.some((s) => Math.abs(s - r?.at) < 0.01) });
    }
    numbers.jumps = jumps;
    const [next1, next2, prev, rep] = jumps;
    step('(b) next twice, previous, repeat: each on a line’s start, playing; previous one line back, repeat stays', jumps.every((j) => j.isStart && j.playing && j.after >= j.at - 0.05 && j.after < j.at + 1.5) && next1.at > next1.before && next2.at > next1.at && prev.at === next1.at && rep.at === prev.at, JSON.stringify(jumps));

    // ---- (c) pause per line ----
    await setPrefs({ autoPause: true });
    const stops = [];
    for (let i = 0; i < 2; i++) {
      const stopped = await until(async () => {
        const v = await video();
        return v.paused ? v : null;
      }, 20000, 50);
      const ends = (await cueList()).map((c) => c.end);
      const end = stopped ? ends.filter((e) => e <= stopped.t + 0.01).sort((a, b) => b - a)[0] : null;
      stops.push({ t: stopped?.t ?? null, end: end ?? null, late: stopped && end !== undefined ? Math.round((stopped.t - end) * 1000) / 1000 : null });
      await evaluate(page, `document.querySelector('video').play().then(() => true)`);
    }
    await setPrefs({ autoPause: false });
    await sleep(500);
    const t0 = await video();
    await sleep(6000);
    const t1 = await video();
    numbers.stops = stops;
    numbers.playsThrough = { from: t0.t, to: t1.t, paused: t1.paused };
    step('(c) pause per line: stops just after a line ends, twice; off, it plays through', stops.every((s) => s.late !== null && s.late >= 0 && s.late <= PAUSE_SLACK_S) && !t1.paused && t1.t - t0.t > 5, `${JSON.stringify(stops)}; then ${t0.t.toFixed(2)} → ${t1.t.toFixed(2)} ${t1.paused ? 'paused' : 'playing'}`);

    // ---- (d) caption timing ----
    const trackStarts = () => evaluate(page, `(() => { const v = document.querySelector('video'); const t = Array.from(v.textTracks).find((x) => x.label === 'T-Caption'); return Array.from(t.cues).slice(0, 4).map((c) => c.startTime); })()`);
    const plain = await trackStarts();
    const shifted = await command({ cmd: 'offset', value: 2, announce: true });
    const later = await until(async () => {
      const s = await trackStarts();
      return s.length && Math.abs(s[0] - plain[0] - 2) < 0.01 ? s : null;
    }, 3000, 100);
    const flash = await evaluate(page, `document.querySelector('.tc-nt-host')?.shadowRoot?.querySelector('.tc-nt-text')?.textContent ?? null`);
    await shoot(page, 'timing-flash');
    const reset = await command({ cmd: 'offset', value: 0 });
    const back = await until(async () => {
      const s = await trackStarts();
      return s.length && Math.abs(s[0] - plain[0]) < 0.01 ? s : null;
    }, 3000, 100);
    numbers.timing = { plain, later, flash, reset };
    step('(d) caption timing +2 s moves the track’s lines with a line on the video; 0 puts them back', shifted?.offset === 2 && !!later && later.every((s, i) => Math.abs(s - plain[i] - 2) < 0.01) && /2/.test(flash || '') && reset?.offset === 0 && !!back, JSON.stringify(numbers.timing));

    // ---- (e) a dropped subtitle file ----
    const now = (await video()).t;
    const lines = [];
    for (let i = 0, s = Math.floor(now); i < 60; i++, s += 3) lines.push(`${i + 1}\n${srtTime(s)} --> ${srtTime(s + 2.5)}\nDropped line ${i + 1}\n`);
    const file = path.join(shell.box.dir, 'dropped.srt');
    fs.writeFileSync(file, lines.join('\n'));
    const box = await evaluate(page, `(() => { const r = document.querySelector('video').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: box.x, y: box.y, data }, page);
    const dropped = await until(async () => {
      const ev = await shell.evidence(tab);
      return ev?.subtitles?.find((s) => s.url === 'local-file:dropped.srt') || null;
    }, 5000, 200);
    const site = await until(async () => {
      const s = await shell.state(tab);
      return s?.state === 'captions' && s.run?.tier === 1 ? s : null;
    }, 20000, 300);
    const shown = await until(async () => {
      const r = await trackInfo(page);
      return r && r.active.some((t) => t.startsWith('Dropped line') && t.includes('\n[译] Dropped line')) ? r : null;
    }, 20000, 300);
    numbers.drop = { file: path.basename(file), evidence: dropped, tier: site?.run?.tier ?? null, active: shown?.active ?? null };
    await shoot(page, 'dropped-file');
    step('(e) an SRT file dropped on the video becomes the captions (tier 1), translated', !!dropped && dropped.cueCount === 60 && !!site && !!shown, JSON.stringify(numbers.drop));
    if (!site || !shown) await dump(tab);

    step('no exceptions from our scripts on the page, none in extension contexts', shell.pageExceptions.ours.length === 0 && shell.extProblems.length === 0, [...shell.pageExceptions.ours, ...shell.extProblems].join(' || '));
    console.log(`\n  numbers: ${JSON.stringify(numbers, null, 1)}`);
    console.log(`  screenshots:\n    ${shell.shots.join('\n    ')}`);
  } finally {
    await shell.close();
  }
  return summary();
}

run(main);
