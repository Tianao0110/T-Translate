// The adapter for a page's host; both content-script worlds pick the same one.

import { youtube } from './youtube.js';
import { generic } from './generic.js';

const SITES = [youtube];

export function siteFor(hostname) {
  const host = String(hostname || '').toLowerCase();
  return SITES.find((s) => s.test(host)) || generic;
}

export { youtube, generic };
