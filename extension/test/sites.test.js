// Site adapters: YouTube media ids (watch, shorts, embed, live), timedtext
// recognition and its language / kind / video, navigation events, hiding the
// player's caption layer, the page-world player actions over a fake player;
// Bilibili media ids (BV with its part, av, bangumi), subtitle bodies and
// lists, the list's entries, navigation and its subtitle layer; TikTok media
// ids (video page URL, else the player wrapper), subtitle files claimed by
// item data, navigation and its caption layer; the generic adapter's URL +
// duration fingerprint and navigation.

import { describe, it, expect, vi } from 'vitest';
import { siteFor, youtube, bilibili, tiktok, generic } from '../src/content/sites/index.js';

describe('siteFor', () => {
  it('youtube.com and its subdomains get the YouTube adapter, others the generic one', () => {
    expect(siteFor('www.youtube.com')).toBe(youtube);
    expect(siteFor('m.youtube.com')).toBe(youtube);
    expect(siteFor('YOUTUBE.COM')).toBe(youtube);
    expect(siteFor('notyoutube.com')).toBe(generic);
  });

  it('bilibili.com and its subdomains get the Bilibili adapter, live rooms the generic one', () => {
    expect(siteFor('www.bilibili.com')).toBe(bilibili);
    expect(siteFor('m.bilibili.com')).toBe(bilibili);
    expect(siteFor('bilibili.com')).toBe(bilibili);
    expect(siteFor('live.bilibili.com')).toBe(generic);
    expect(siteFor('notbilibili.com')).toBe(generic);
  });

  it('tiktok.com and its subdomains get the TikTok adapter, its CDNs do not', () => {
    expect(siteFor('www.tiktok.com')).toBe(tiktok);
    expect(siteFor('m.tiktok.com')).toBe(tiktok);
    expect(siteFor('tiktok.com')).toBe(tiktok);
    expect(siteFor('nottiktok.com')).toBe(generic);
    expect(siteFor('v16-webapp-prime.tiktokcdn.com')).toBe(generic);
  });
});

describe('YouTube', () => {
  it('media id from watch, shorts, embed and live URLs', () => {
    expect(youtube.mediaId('https://www.youtube.com/watch?v=UF8uR6Z6KLc&t=30s')).toBe('UF8uR6Z6KLc');
    expect(youtube.mediaId('https://m.youtube.com/watch?app=desktop&v=UF8uR6Z6KLc')).toBe('UF8uR6Z6KLc');
    expect(youtube.mediaId('https://www.youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk');
    expect(youtube.mediaId('https://www.youtube.com/embed/UF8uR6Z6KLc?autoplay=1')).toBe('UF8uR6Z6KLc');
    expect(youtube.mediaId('https://www.youtube.com/live/UF8uR6Z6KLc')).toBe('UF8uR6Z6KLc');
    expect(youtube.mediaId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(youtube.mediaId('https://www.youtube.com/')).toBeNull();
    expect(youtube.mediaId('https://www.youtube.com/@stanford')).toBeNull();
    expect(youtube.mediaId('https://evil.example/watch?v=UF8uR6Z6KLc')).toBeNull();
  });

  it('timedtext requests and what they carry', () => {
    const url = 'https://www.youtube.com/api/timedtext?v=UF8uR6Z6KLc&caps=asr&kind=asr&lang=en&fmt=json3&pot=XYZ&c=WEB';
    expect(youtube.isSubtitleRequest(url)).toBe(true);
    expect(youtube.subtitleInfo(url)).toEqual({ lang: 'en', kind: 'asr', mediaId: 'UF8uR6Z6KLc' });
    expect(youtube.subtitleInfo(`${url}&tlang=zh-Hans`)).toMatchObject({ lang: 'zh-Hans' });
    expect(youtube.isSubtitleRequest('https://www.youtube.com/api/stats/watchtime?v=x')).toBe(false);
    expect(youtube.isSubtitleRequest('https://example.com/api/timedtext?v=x')).toBe(false);
    expect(youtube.subtitleInfo('https://example.com/a.vtt')).toEqual({});
  });

  it('navigation: yt-navigate-finish and popstate, unsubscribable', () => {
    const fn = vi.fn();
    const off = youtube.watchNavigation({ doc: document, win: window }, fn);
    document.dispatchEvent(new Event('yt-navigate-finish'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    off();
    document.dispatchEvent(new Event('yt-navigate-finish'));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('hides the caption layer with one style element and shows it again', () => {
    expect(youtube.hideSiteCaptions(document, true)).toBe(true);
    youtube.hideSiteCaptions(document, true);
    const styles = [...document.querySelectorAll('style')].filter((s) => s.textContent.includes('.ytp-caption-window-container'));
    expect(styles).toHaveLength(1);
    expect(youtube.hideSiteCaptions(document, false)).toBe(false);
    expect([...document.querySelectorAll('style')].some((s) => s.textContent.includes('ytp-caption'))).toBe(false);
  });

  describe('page-world player actions', () => {
    function mountPlayer(api) {
      const el = document.createElement('div');
      el.id = 'movie_player';
      Object.assign(el, api);
      document.body.append(el);
      return el;
    }

    it('yt-reload reloads the current video at the current time', () => {
      const p = mountPlayer({ getVideoData: () => ({ video_id: 'UF8uR6Z6KLc' }), getCurrentTime: () => 42.5, loadVideoById: vi.fn() });
      expect(youtube.mainActions['yt-reload']({ doc: document })).toEqual({ videoId: 'UF8uR6Z6KLc', at: 42.5 });
      expect(p.loadVideoById).toHaveBeenCalledWith('UF8uR6Z6KLc', 42.5);
      p.remove();
      expect(() => youtube.mainActions['yt-reload']({ doc: document })).toThrow(expect.objectContaining({ code: 'no-player' }));
    });

    it('yt-captions-on: turns captions on, else re-picks the track, else off and on, else the button', async () => {
      let on = false;
      const list = [{ languageCode: 'ar', kind: '' }, { languageCode: 'en', kind: '' }];
      const response = { captions: { playerCaptionsTracklistRenderer: { defaultAudioTrackIndex: 0, audioTracks: [{ defaultCaptionTrackIndex: 2 }], captionTracks: [{ languageCode: 'ar' }, { languageCode: 'en', kind: 'asr' }, { languageCode: 'en' }] } } };
      const p = mountPlayer({
        isSubtitlesOn: () => on,
        toggleSubtitlesOn: vi.fn(() => (on = true)),
        toggleSubtitles: vi.fn(() => (on = !on)),
        getOption: (mod, key) => (key === 'tracklist' ? list : null),
        getPlayerResponse: () => response,
        setOption: vi.fn(),
      });
      const button = document.createElement('button');
      button.className = 'ytp-subtitles-button';
      button.setAttribute('aria-pressed', 'false');
      button.onclick = vi.fn();
      document.body.append(button);

      // Off: the player API turns them on.
      const first = await youtube.mainActions['yt-captions-on']({ doc: document, waitSubtitle: async () => true });
      expect(first).toEqual({ method: 'api-toggle', tried: ['api-toggle:ran'], on: true });

      // On already, nothing fetched: the default track (English, not the first listed) is set again, then off and on.
      const answers = [false, true];
      const second = await youtube.mainActions['yt-captions-on']({ doc: document, waitSubtitle: async () => answers.shift() });
      expect(second).toEqual({ method: 'api-retoggle', tried: ['api-toggle:skipped', 'api-track:ran', 'api-retoggle:ran'], on: true });
      expect(p.setOption).toHaveBeenCalledWith('captions', 'track', { languageCode: 'en', kind: '' });
      expect(p.toggleSubtitles).toHaveBeenCalledTimes(1);

      // Nothing works without the API: the button, if not pressed.
      on = false;
      for (const k of ['toggleSubtitlesOn', 'toggleSubtitles', 'setOption', 'isSubtitlesOn']) delete p[k];
      const third = await youtube.mainActions['yt-captions-on']({ doc: document, waitSubtitle: async () => true });
      expect(third.method).toBe('button');
      expect(button.onclick).toHaveBeenCalledTimes(1);
      p.remove();
      button.remove();
    });
  });
});

describe('Bilibili', () => {
  it('media id from BV (with its part), av and bangumi URLs', () => {
    expect(bilibili.mediaId('https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333.1007')).toBe('BV1GJ411x7h7');
    expect(bilibili.mediaId('https://www.bilibili.com/video/BV1GJ411x7h7?p=1')).toBe('BV1GJ411x7h7');
    expect(bilibili.mediaId('https://www.bilibili.com/video/BV1GJ411x7h7?p=3&vd_source=x')).toBe('BV1GJ411x7h7:p3');
    expect(bilibili.mediaId('https://www.bilibili.com/video/BV1GJ411x7h7?p=abc')).toBe('BV1GJ411x7h7');
    expect(bilibili.mediaId('https://m.bilibili.com/video/BV1GJ411x7h7')).toBe('BV1GJ411x7h7');
    expect(bilibili.mediaId('https://www.bilibili.com/video/av170001')).toBe('av170001');
    expect(bilibili.mediaId('https://www.bilibili.com/video/AV170001/?p=2')).toBe('av170001:p2');
    expect(bilibili.mediaId('https://www.bilibili.com/bangumi/play/ep123456')).toBe('ep123456');
    expect(bilibili.mediaId('https://www.bilibili.com/bangumi/play/ss4321?from=x')).toBe('ss4321');
    expect(bilibili.mediaId('https://www.bilibili.com/zh-Hans/video/BV1Xx411c7cH/?p=2')).toBe('BV1Xx411c7cH:p2');
    expect(bilibili.mediaId('https://www.bilibili.com/en/video/av170001')).toBe('av170001');
    expect(bilibili.mediaId('https://www.bilibili.com/zh-Hant/bangumi/play/ep99')).toBe('ep99');
    expect(bilibili.mediaId('https://www.bilibili.com/space/video/BV1Xx411c7cH')).toBeNull();
    expect(bilibili.mediaId('https://www.bilibili.com/video/BV1GJ411x7')).toBeNull();
    expect(bilibili.mediaId('https://www.bilibili.com/video/BV1GJ411x7h7x')).toBeNull();
    expect(bilibili.mediaId('https://www.bilibili.com/')).toBeNull();
    expect(bilibili.mediaId('https://space.bilibili.com/123')).toBeNull();
    expect(bilibili.mediaId('https://live.bilibili.com/video/BV1GJ411x7h7')).toBeNull();
    expect(bilibili.mediaId('https://evil.example/video/BV1GJ411x7h7')).toBeNull();
    expect(bilibili.mediaId('not a url')).toBeNull();
  });

  it('subtitle bodies on hdslb.com and the player API lists', () => {
    const ai = 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/12345abc?auth_key=1-2-3';
    const human = 'https://i0.hdslb.com/bfs/subtitle/a1b2c3.json';
    const list = 'https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=2&w_rid=x&wts=3';
    expect(bilibili.isSubtitleRequest(ai)).toBe(true);
    expect(bilibili.isSubtitleRequest(human)).toBe(true);
    expect(bilibili.isSubtitleRequest(list)).toBe(true);
    expect(bilibili.isSubtitleRequest('https://api.bilibili.com/x/player/v2?cid=2')).toBe(true);
    expect(bilibili.isSubtitleRequest('https://i0.hdslb.com/bfs/archive/cover.jpg')).toBe(false);
    expect(bilibili.isSubtitleRequest('https://api.bilibili.com/x/player/wbi/playurl?cid=2')).toBe(false);
    expect(bilibili.isSubtitleRequest('https://evil.example/bfs/subtitle/a.json')).toBe(false);
    expect(bilibili.isSubtitleRequest('https://api.bilibili.com.evil.example/x/player/v2')).toBe(false);
    expect(bilibili.subtitleInfo(ai)).toEqual({ lang: '', kind: 'asr', mediaId: null });
    expect(bilibili.subtitleInfo(human)).toEqual({ lang: '', kind: '', mediaId: null });
    expect(bilibili.subtitleInfo(list)).toEqual({ list: true });
    expect(bilibili.subtitleInfo('https://www.bilibili.com/')).toEqual({});
    expect(bilibili.subtitleInfo('nope')).toEqual({});
  });

  it('lists a player API response’s subtitles; bad input lists nothing', () => {
    const res = {
      code: 0,
      data: {
        subtitle: {
          subtitles: [
            { lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1', ai_type: 1, ai_status: 2 },
            { lan: 'en-US', lan_doc: 'English', subtitle_url: 'https://i0.hdslb.com/bfs/subtitle/2.json', ai_type: 0 },
            { lan: 'ja', subtitle_url: '' },
            null,
          ],
        },
      },
    };
    expect(bilibili.listSubtitles(JSON.stringify(res))).toEqual([
      { lang: 'ai-zh', url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1', ai: true },
      { lang: 'en-US', url: 'https://i0.hdslb.com/bfs/subtitle/2.json', ai: false },
    ]);
    expect(bilibili.listSubtitles(res)).toHaveLength(2);
    expect(bilibili.listSubtitles({ data: { subtitle: { subtitles: [{ lan: 'zh', subtitle_url: '//x/1', ai_type: 2 }] } } })[0].ai).toBe(true);
    for (const bad of ['', 'not json', '{}', '{"data":{"subtitle":{"subtitles":3}}}', 'null', null]) expect(bilibili.listSubtitles(bad)).toEqual([]);
    expect(bilibili.listSubtitles(JSON.stringify({ code: 0, data: { need_login_subtitle: true, subtitle: { subtitles: [] } } }))).toEqual([]);
  });

  it('navigation: popstate and same-document navigations (part switches)', () => {
    const fn = vi.fn();
    const nav = new EventTarget();
    const win = Object.assign(new EventTarget(), { navigation: nav });
    const off = bilibili.watchNavigation({ doc: document, win }, fn);
    win.dispatchEvent(new Event('popstate'));
    nav.dispatchEvent(new Event('currententrychange'));
    off();
    nav.dispatchEvent(new Event('currententrychange'));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('hides the player’s subtitle layer with one style element and shows it again', () => {
    const wrap = document.createElement('div');
    wrap.className = 'bpx-player-subtitle-wrap';
    document.body.append(wrap);
    expect(bilibili.hideSiteCaptions(document, true)).toBe(true);
    bilibili.hideSiteCaptions(document, true);
    const styles = [...document.querySelectorAll('style')].filter((s) => s.textContent.includes('.bpx-player-subtitle-wrap'));
    expect(styles).toHaveLength(1);
    expect(getComputedStyle(wrap).display).toBe('none');
    expect(bilibili.hideSiteCaptions(document, false)).toBe(false);
    expect([...document.querySelectorAll('style')].some((s) => s.textContent.includes('bpx-player'))).toBe(false);
    expect(getComputedStyle(wrap).display).not.toBe('none');
    expect(bilibili.mainActions).toEqual({});
    wrap.remove();
  });
});

describe('TikTok', () => {
  // URL shapes from a real page (2026-11-10): subtitle files end in a 32-hex
  // id, video files in an o… id; both say mime_type=video_mp4.
  const vttUrl = (file, host = 'v16-webapp.tiktok.com', sig = '12031373c9c7d41547b0b6a63a0318b3') => `https://${host}/${sig}/6af607bd/video/tos/alisg/tos-alisg-pv-0037/${file}/?a=1988&bti=ODszNWYuMDE6&bt=1863&mime_type=video_mp4&rc=x`;
  const VIDEO_FILE = 'https://v16-webapp-prime.tiktok.com/video/tos/alisg/tos-alisg-ve-0068c800-sg/oIfxEZFERcrf31S2vgHtpIqQQAzqhoDwR/?a=1988&bt=1863&mime_type=video_mp4';
  const LIST = 'https://www.tiktok.com/api/recommend/item_list/?WebIdLastTime=1&aid=1988&count=9';
  const item = (id, subs, captions = []) => ({ id, author: { uniqueId: 'u' }, video: { duration: 30, subtitleInfos: subs, claInfo: { captionInfos: captions } } });
  const sub = (file, lang = 'eng-US', source = 'ASR') => ({ Format: 'webvtt', LanguageCodeName: lang, Source: source, Url: vttUrl(file) });

  it('media id from a video page URL, else from the player wrapper around the video', () => {
    const wrap = document.createElement('div');
    wrap.id = 'xgwrapper-0-7696986447479311648';
    const v = document.createElement('video');
    wrap.append(document.createElement('div'));
    wrap.firstChild.append(v);
    expect(tiktok.mediaId('https://www.tiktok.com/@verified_nate/video/7656927541181123861?is_from_webapp=1', v)).toBe('7656927541181123861');
    expect(tiktok.mediaId('https://www.tiktok.com/foryou', v)).toBe('7696986447479311648');
    expect(tiktok.mediaId('https://www.tiktok.com/foryou', document.createElement('video'))).toBeNull();
    expect(tiktok.mediaId('https://www.tiktok.com/foryou', null)).toBeNull();
    expect(tiktok.mediaId('https://www.tiktok.com/@verified_nate', null)).toBeNull();
    expect(tiktok.mediaId('https://evil.example/@u/video/7656927541181123861', v)).toBeNull();
    expect(tiktok.feed).toBe(true);
  });

  it('subtitle files and item requests are copied; video files and other APIs are not', () => {
    expect(tiktok.isSubtitleRequest(vttUrl('99485768101742f3a80e82681727af79'))).toBe(true);
    expect(tiktok.isSubtitleRequest(vttUrl('99485768101742f3a80e82681727af79', 'v19-webapp.tiktokcdn-us.com'))).toBe(true);
    expect(tiktok.isSubtitleRequest(VIDEO_FILE)).toBe(false);
    expect(tiktok.isSubtitleRequest(LIST)).toBe(true);
    expect(tiktok.isSubtitleRequest('https://www.tiktok.com/api/prefetch/explore/item_list/?aid=1988')).toBe(true);
    expect(tiktok.isSubtitleRequest('https://www.tiktok.com/api/item/detail/?itemId=1')).toBe(true);
    expect(tiktok.isSubtitleRequest('https://www.tiktok.com/api/comment/list/?aweme_id=1')).toBe(false);
    expect(tiktok.isSubtitleRequest('https://evil.example/x/video/tos/a/b/99485768101742f3a80e82681727af79/')).toBe(false);
    expect(tiktok.subtitleInfo(LIST)).toEqual({ catalog: true });
    expect(tiktok.subtitleInfo(VIDEO_FILE)).toEqual({});
  });

  it('a subtitle file is a stray until item data claims it; then its item, language and kind', () => {
    const [a, b, c] = ['a1'.repeat(16), 'b2'.repeat(16), 'c3'.repeat(16)];
    expect(tiktok.subtitleInfo(vttUrl(a))).toEqual({ stray: true });
    tiktok.readCatalog(JSON.stringify({ itemList: [item('7656927541181123861', [sub(a)]), item('7683631118070926610', [sub(b, 'urd-PK', 'MT')], [{ language: 'urd-PK', url: vttUrl(b), urlList: [vttUrl(b, 'v19-webapp.tiktok.com')] }])] }));
    expect(tiktok.subtitleInfo(vttUrl(a))).toEqual({ lang: 'en-US', kind: 'asr', mediaId: '7656927541181123861' });
    // Another host and signature, the same file.
    expect(tiktok.subtitleInfo(vttUrl(a, 'v19-webapp.tiktok.com', 'f'.repeat(32)))).toEqual({ lang: 'en-US', kind: 'asr', mediaId: '7656927541181123861' });
    expect(tiktok.subtitleInfo(vttUrl(b, 'v19-webapp.tiktok.com'))).toEqual({ lang: 'ur-PK', kind: '', mediaId: '7683631118070926610' });
    expect(tiktok.subtitleInfo(vttUrl(c))).toEqual({ stray: true });
    tiktok.readCatalog('{not json');
    tiktok.readCatalog(JSON.stringify({ itemList: [{ id: 'x', video: { subtitleInfos: [sub(c)] } }, { id: '123', video: null }] }));
    expect(tiktok.subtitleInfo(vttUrl(c))).toEqual({ stray: true });
  });

  it('the video page’s own data claims its subtitle file', () => {
    const file = 'd4'.repeat(16);
    const script = document.createElement('script');
    script.id = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
    script.type = 'application/json';
    script.textContent = JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: item('7704437998909164823', [sub(file)]) } } } });
    document.body.append(script);
    tiktok.readPage(document);
    expect(tiktok.subtitleInfo(vttUrl(file))).toMatchObject({ mediaId: '7704437998909164823', lang: 'en-US' });
    script.remove();
    expect(() => tiktok.readPage(document)).not.toThrow();
  });

  it('navigation: popstate and same-document navigations', () => {
    const fn = vi.fn();
    const nav = new EventTarget();
    const win = Object.assign(new EventTarget(), { navigation: nav });
    const off = tiktok.watchNavigation({ doc: document, win }, fn);
    win.dispatchEvent(new Event('popstate'));
    nav.dispatchEvent(new Event('currententrychange'));
    off();
    nav.dispatchEvent(new Event('currententrychange'));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('hides the player’s caption layer with one style element and shows it again', () => {
    const layer = document.createElement('div');
    layer.className = 'css-pfus7k-7937d88b--DivCaptionContainer e1nv076w0';
    document.body.append(layer);
    expect(tiktok.hideSiteCaptions(document, true)).toBe(true);
    tiktok.hideSiteCaptions(document, true);
    expect([...document.querySelectorAll('style')].filter((s) => s.textContent.includes('DivCaptionContainer'))).toHaveLength(1);
    expect(getComputedStyle(layer).display).toBe('none');
    expect(tiktok.hideSiteCaptions(document, false)).toBe(false);
    expect(getComputedStyle(layer).display).not.toBe('none');
    expect(tiktok.mainActions).toEqual({});
    layer.remove();
  });
});

describe('generic', () => {
  it('fingerprints the page URL (without the hash) with the media duration; subtitle files by extension', () => {
    const a = generic.mediaId('https://video.example.com/watch/1#t=5', { duration: 600.4 });
    expect(a).toMatch(/^[0-9a-z]+-600$/);
    expect(generic.mediaId('https://video.example.com/watch/1', { duration: 600.2 })).toBe(a);
    expect(generic.mediaId('https://video.example.com/watch/2', { duration: 600 })).not.toBe(a);
    expect(generic.mediaId('https://video.example.com/watch/1', { duration: NaN })).toMatch(/-0$/);
    expect(generic.isSubtitleRequest('https://x/subs/a.VTT?sig=1')).toBe(true);
    for (const f of ['a.srt', 'a.ttml', 'a.dfxp']) expect(generic.isSubtitleRequest(`https://x/${f}`), f).toBe(true);
    expect(generic.isSubtitleRequest('https://x/a.vtt.mp4')).toBe(false);
    expect(generic.isSubtitleRequest('https://x/watch?file=a.vtt')).toBe(false);
    expect(generic.isSubtitleRequest('not a url')).toBe(false);
    expect(generic.subtitleInfo('https://x/a.vtt')).toEqual({ lang: '', kind: '', mediaId: null });
    expect(generic.hideSiteCaptions(document, true)).toBe(false);
  });

  it('navigation: popstate and same-document navigations', () => {
    const fn = vi.fn();
    const nav = new EventTarget();
    const win = Object.assign(new EventTarget(), { navigation: nav });
    const off = generic.watchNavigation({ win }, fn);
    win.dispatchEvent(new Event('popstate'));
    nav.dispatchEvent(new Event('currententrychange'));
    off();
    nav.dispatchEvent(new Event('currententrychange'));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('the player bars the caption overlay stays above (controlsTop)', () => {
  const box = (el, top, height, left = 0, width = 800) => {
    el.getBoundingClientRect = () => ({ top, bottom: top + height, left, right: left + width, width, height, x: left, y: top });
    return el;
  };
  const el = (tag, cls, ...kids) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.append(...kids);
    return e;
  };
  const mount = (root) => {
    document.body.replaceChildren(root);
    return root;
  };

  it('YouTube: the control bar with its progress bar while shown, nothing once faded out', () => {
    const video = box(el('video'), 0, 450);
    const progress = box(el('div', 'ytp-progress-bar-container'), 388, 6);
    const bar = box(el('div', 'ytp-chrome-bottom', progress), 391, 59);
    mount(el('div', 'html5-video-player', el('div', 'html5-video-container', video), bar));
    expect(youtube.controlsTop(video)).toBe(388);
    bar.style.opacity = '0';
    expect(youtube.controlsTop(video)).toBeNull();
    expect(youtube.controlsTop(box(el('video'), 0, 450))).toBeNull(); // no player around it
  });

  it('Bilibili: the control bar and the highlight graph, unless the player marks them hidden', () => {
    const video = box(el('video'), 0, 438);
    const pbp = box(el('div', 'bpx-player-pbp show'), 355, 28);
    const player = mount(el('div', 'bpx-player-container', video, box(el('div', 'bpx-player-control-wrap'), 383, 55), pbp));
    player.setAttribute('data-ctrl-hidden', 'false');
    expect(bilibili.controlsTop(video)).toBe(355);
    pbp.className = 'bpx-player-pbp';
    expect(bilibili.controlsTop(video)).toBe(383);
    player.setAttribute('data-ctrl-hidden', 'true');
    expect(bilibili.controlsTop(video)).toBeNull();
  });

  it('TikTok: the description and the dimmed playback bar over the lower video; other items and the upper half do not count', () => {
    const video = box(el('video'), 16, 769, 460, 577);
    let inner = video;
    for (let i = 0; i < 5; i++) inner = el('div', '', inner);
    const chrome = box(el('div', 'css-1-DivPlaybackChrome e1'), 721, 64, 452, 590);
    chrome.style.opacity = '0.28';
    mount(
      el(
        'div',
        'item',
        inner,
        box(el('div', 'css-2-DivDescriptionLayer e2'), 601, 120, 452, 590),
        chrome,
        box(el('div', 'css-3-DivDescriptionLayer e3'), 1201, 120, 452, 590), // the next video's
        box(el('div', 'css-4-DivDescriptionLayer e4'), 100, 60, 452, 590)
      )
    );
    expect(tiktok.controlsTop(video)).toBe(601);
  });

  it('the generic adapter has none', () => {
    expect(generic.controlsTop).toBeUndefined();
  });
});
