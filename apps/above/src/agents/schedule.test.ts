import { describe, expect, it } from 'vitest';
import {
  desiredUse,
  pickRole,
  roleAt,
  roleIndex,
  ROLE_SHARE,
  ROLES,
  type Destination,
  type Role,
} from './schedule';

const VALID: readonly Destination[] = ['home', 'work', 'market', 'park', 'temple'];

/** Share of the population heading for `use` at this hour, ignoring offsets. */
function shareWanting(use: Destination, hour: number): number {
  let total = 0;
  for (const role of ROLES) if (desiredUse(role, hour) === use) total += ROLE_SHARE[role];
  return total;
}

describe('desiredUse', () => {
  it('returns a real destination for every role at every hour', () => {
    for (const role of ROLES) {
      for (let h = 0; h < 24; h += 0.25) expect(VALID).toContain(desiredUse(role, h));
    }
  });

  it('wraps hours outside 0..24', () => {
    for (const role of ROLES) {
      expect(desiredUse(role, 25)).toBe(desiredUse(role, 1));
      expect(desiredUse(role, -1)).toBe(desiredUse(role, 23));
    }
  });

  it('sends office workers to work by day and home at night', () => {
    expect(desiredUse('office', 12)).toBe('work');
    expect(desiredUse('office', 3)).toBe('home');
  });

  it('keeps night workers up while everyone else is asleep', () => {
    expect(desiredUse('night', 2)).toBe('work');
    expect(desiredUse('night', 23)).toBe('work');
    expect(desiredUse('night', 10)).toBe('home');
  });

  it('empties the homes in the morning and fills them again at night', () => {
    expect(shareWanting('home', 4)).toBeGreaterThan(0.7);
    expect(shareWanting('home', 12)).toBeLessThan(0.3);
    expect(shareWanting('home', 22)).toBeGreaterThan(0.5);
  });

  it('gives a morning wave towards work and an evening wave away from it', () => {
    expect(shareWanting('work', 6)).toBeLessThan(shareWanting('work', 9));
    expect(shareWanting('work', 19)).toBeLessThan(shareWanting('work', 14));
  });
});

describe('pickRole', () => {
  it('covers every role and clamps out-of-range rolls', () => {
    const seen = new Set<Role>();
    for (let r = 0; r < 1; r += 0.001) seen.add(pickRole(r));
    expect(seen).toEqual(new Set(ROLES));
    expect(ROLES).toContain(pickRole(-1));
    expect(ROLES).toContain(pickRole(2));
  });

  it('follows the shares to within a percent', () => {
    const counts = new Map<Role, number>();
    const samples = 100000;
    for (let i = 0; i < samples; i++) {
      const role = pickRole(i / samples);
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    for (const role of ROLES) {
      expect((counts.get(role) ?? 0) / samples).toBeCloseTo(ROLE_SHARE[role], 2);
    }
  });
});

describe('role indexing', () => {
  it('round-trips through the typed-array byte', () => {
    for (const role of ROLES) expect(roleAt(roleIndex(role))).toBe(role);
    expect(roleAt(99)).toBe('office');
  });
});
