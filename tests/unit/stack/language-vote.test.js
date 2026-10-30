// The vote over detector answers: two must agree on a language ELD knows,
// one alone must be sure, and CLD3 / franc only fill in what ELD and
// fastText cannot place.

import { describe, it, expect } from 'vitest';
import {
  voteFirst, voteFillers, fromEld, fromFastText, fromCld3, fromFranc,
} from '../../../src/stack/language-vote.js';

const eld = (code, reliable = true) => ({ code, reliable });
const ft = (code, score) => ({ code, score });
const cld = (code, score, reliable = true) => ({ code, score, reliable });
const franc = (code, margin) => ({ code, margin });

describe('voteFirst (ELD + fastText)', () => {
  it('takes a language both name', () => {
    expect(voteFirst(eld('fr'), ft('fr', 0.3))).toBe('fr');
  });

  it('leaves a disagreement on languages ELD knows undecided', () => {
    expect(voteFirst(eld('nl'), ft('de', 0.95))).toBeNull();
  });

  it('lets fastText alone place a language ELD does not know', () => {
    expect(voteFirst(eld('nl'), ft('af', 0.8))).toBe('af');
    expect(voteFirst(eld('ms'), ft('id', 0.6))).toBeNull();
  });

  it('ignores an unreliable ELD answer', () => {
    expect(voteFirst(eld('fr', false), ft('fr', 0.9))).toBeNull();
  });

  it('falls back to the one detector that loaded', () => {
    expect(voteFirst(eld('fr'), null)).toBe('fr');
    expect(voteFirst(null, ft('fr', 0.9))).toBe('fr');
    expect(voteFirst(null, ft('fr', 0.5))).toBeNull();
  });
});

describe('voteFillers (CLD3 + franc)', () => {
  it('takes a sure filler on a language only it knows', () => {
    expect(voteFillers(ft('la', 0.2), cld('zu', 0.97), null)).toBe('zu');
    expect(voteFillers(ft('la', 0.2), null, franc('ha', 0.2))).toBe('ha');
  });

  it('does not let one filler alone place a language ELD or fastText knows', () => {
    expect(voteFillers(ft(null, 0.1), cld('en', 0.99), franc('id', 0.5))).toBeNull();
  });

  it('takes two of three on a language ELD does not know', () => {
    expect(voteFillers(ft('sw', 0.3), cld('sw', 0.5, false), franc('sw', 0.01))).toBe('sw');
    expect(voteFillers(ft('sw', 0.3), cld('sw', 0.5), null)).toBe('sw');
  });

  it('never votes a language ELD knows', () => {
    expect(voteFillers(ft('en', 0.4), cld('en', 0.5), null)).toBeNull();
  });

  it('stays undecided without a majority', () => {
    expect(voteFillers(ft('sw', 0.3), cld('so', 0.6), franc('ln', 0.05))).toBeNull();
  });
});

describe('labels to catalogue codes', () => {
  it('maps aliases and Kurdish by its letters', () => {
    expect(fromEld('ku')).toBe('ckb');
    expect(fromFastText('jv', 'x')).toBe('jw');
    expect(fromFastText('ku', 'Ez ji te hez dikim')).toBe('ku');
    expect(fromFastText('ku', 'خۆشم دەوێیت')).toBe('ckb');
    expect(fromCld3('fil', 'x')).toBe('tl');
    expect(fromCld3('iw', 'x')).toBe('he');
    expect(fromFranc('swh')).toBe('sw');
  });

  it('drops labels outside the catalogue', () => {
    expect(fromFastText('sh', 'x')).toBeNull();
    expect(fromCld3('zh-Latn', 'x')).toBeNull();
    expect(fromFranc('und')).toBeNull();
    expect(fromFranc('eng')).toBeNull();
  });
});
