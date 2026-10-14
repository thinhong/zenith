import { describe, expect, it } from 'vitest';
import { forwardTarget } from './forward';

describe('forwardTarget', () => {
  it('leaves a plain visit on the chooser', () => {
    expect(forwardTarget('')).toBeNull();
    expect(forwardTarget('?')).toBeNull();
  });

  it('sends an old link to Above with its query untouched', () => {
    expect(forwardTarget('?seed=7')).toBe('above/?seed=7');
    expect(forwardTarget('?era=citadel&hour=21&pause=1')).toBe('above/?era=citadel&hour=21&pause=1');
    expect(forwardTarget('?at=-33,54&alt=40')).toBe('above/?at=-33,54&alt=40');
    expect(forwardTarget('?day=1&scene=3')).toBe('above/?day=1&scene=3');
  });

  it('ignores parameters that are not Above settings', () => {
    expect(forwardTarget('?fbclid=abc')).toBeNull();
    expect(forwardTarget('?utm_source=mail&ref=x')).toBeNull();
  });

  it('keeps everything else that came with a forwarded link', () => {
    expect(forwardTarget('?utm_source=mail&seed=3')).toBe('above/?utm_source=mail&seed=3');
  });
});
