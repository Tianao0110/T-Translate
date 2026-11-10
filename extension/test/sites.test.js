// Site adapters: YouTube media ids (watch, shorts, embed, live), timedtext
// recognition and its language / kind / video, navigation events, hiding the
// player's caption layer, the page-world player actions over a fake player;
// the generic adapter's URL + duration fingerprint and navigation.

import { describe, it, expect, vi } from 'vitest';
import { siteFor, youtube, generic } from '../src/content/sites/index.js';

describe('siteFor', () => {
  it('youtube.com and its subdomains get the YouTube adapter, others the generic one', () => {
    expect(siteFor('www.youtube.com')).toBe(youtube);
    expect(siteFor('m.youtube.com')).toBe(youtube);
    expect(siteFor('YOUTUBE.COM')).toBe(youtube);
    expect(siteFor('notyoutube.com')).toBe(generic);
    expect(siteFor('www.bilibili.com')).toBe(generic);
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

describe('generic', () => {
  it('fingerprints the page URL (without the hash) with the media duration', () => {
    const a = generic.mediaId('https://video.example.com/watch/1#t=5', { duration: 600.4 });
    expect(a).toMatch(/^[0-9a-z]+-600$/);
    expect(generic.mediaId('https://video.example.com/watch/1', { duration: 600.2 })).toBe(a);
    expect(generic.mediaId('https://video.example.com/watch/2', { duration: 600 })).not.toBe(a);
    expect(generic.mediaId('https://video.example.com/watch/1', { duration: NaN })).toMatch(/-0$/);
    expect(generic.isSubtitleRequest('https://x/a.vtt')).toBe(false);
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
