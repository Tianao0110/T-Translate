// The adapter for a page's host; both content-script worlds pick the same one.

import { youtube } from './youtube.js';
import { bilibili } from './bilibili.js';
import { tiktok } from './tiktok.js';
import { generic } from './generic.js';

const SITES = [youtube, bilibili, tiktok];

export function siteFor(hostname) {
  const host = String(hostname || '').toLowerCase();
  return SITES.find((s) => s.test(host)) || generic;
}

export { youtube, bilibili, tiktok, generic };
