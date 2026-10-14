import { describe, expect, it } from 'vitest';
import { SHOTS } from './script';
import { bodyAt, PLACES, SEATS, type Segment } from './stage';
import { totalDuration } from './timeline';

describe('the film', () => {
  it('runs for about eighty seconds', () => {
    const total = totalDuration(SHOTS);
    expect(total).toBeGreaterThan(65);
    expect(total).toBeLessThan(95);
    expect(new Set(SHOTS.map((s) => s.id)).size).toBe(SHOTS.length);
  });

  it('opens from black and closes to black, so the loop into the next life is a fade', () => {
    expect(SHOTS[0]?.fadeInS).toBeGreaterThan(0);
    expect(SHOTS[SHOTS.length - 1]?.fadeOutS).toBeGreaterThan(0);
  });

  it('never makes her younger within a life', () => {
    let last = 0;
    for (const shot of SHOTS) {
      expect(shot.age[0]).toBeGreaterThanOrEqual(last);
      expect(shot.age[1]).toBeGreaterThanOrEqual(shot.age[0]);
      last = shot.age[1];
    }
  });

  it('lets time run only forward', () => {
    let lastYear = -1;
    for (const shot of SHOTS) {
      expect(shot.year[0]).toBeGreaterThanOrEqual(lastYear);
      expect(shot.hour[1]).toBeGreaterThanOrEqual(shot.hour[0]);
      lastYear = shot.year[1];
    }
  });

  it('frames the young and the old close-up the same way, which is the cut', () => {
    const young = SHOTS.find((s) => s.id === 'young');
    const old = SHOTS.find((s) => s.id === 'old');
    expect(young?.camera).toEqual(old?.camera);
    expect((old?.age[0] ?? 0) - (young?.age[0] ?? 0)).toBeGreaterThan(40);
  });

  it('follows the light on one unbroken path across its shots, then shows the empty room', () => {
    const souls = SHOTS.filter((s) => s.soul === true);
    expect(souls.length).toBeGreaterThan(0);
    let pathS = 0;
    for (const shot of souls) {
      expect(shot.soulOffsetS ?? 0).toBeCloseTo(pathS);
      pathS += shot.durationS;
    }
    const lastSoul = souls[souls.length - 1];
    if (!lastSoul) throw new Error('no soul shot');
    const indices = souls.map((s) => SHOTS.indexOf(s));
    indices.forEach((index, k) => {
      if (k > 0) expect(index).toBe((indices[k - 1] ?? -2) + 1);
    });
    expect(SHOTS[SHOTS.indexOf(lastSoul) + 1]?.empty).toBe(true);
  });

  for (const shot of SHOTS) {
    it(`keeps shot "${shot.id}" in order and inside its own length`, () => {
      let last = -1;
      for (const seg of shot.body) {
        expect(seg.atS).toBeGreaterThan(last);
        expect(seg.atS).toBeLessThan(shot.durationS);
        last = seg.atS;
      }
      for (const key of [...shot.face, ...shot.gaze]) expect(key.atS).toBeLessThanOrEqual(shot.durationS);
    });

    it(`joins each move in shot "${shot.id}" to where she already is`, () => {
      const body = shot.body;
      body.forEach((seg: Segment, i) => {
        const before = body[i - 1];
        if (!before) return;
        if (seg.kind === 'walk' || seg.kind === 'turn') {
          const was = bodyAt(body, seg.atS - 1e-6, shot.durationS);
          expect(was.x).toBeCloseTo(PLACES[seg.from].x, 2);
          expect(was.z).toBeCloseTo(PLACES[seg.from].z, 2);
        }
        if (seg.kind === 'sitDown') {
          expect(before.kind).toBe('walk');
          const front = seg.seat === 'desk' ? PLACES.deskFront : PLACES.armchairFront;
          if (before.kind === 'walk') expect(PLACES[before.to]).toBe(front);
        }
        if (seg.kind === 'standUp') expect(before).toEqual({ kind: 'sit', atS: before.atS, seat: seg.seat });
        if (seg.kind === 'sit') expect(SEATS[seg.seat]).toBeDefined();
      });
    });

    it(`walks at a pace a person of that age can in shot "${shot.id}"`, () => {
      shot.body.forEach((seg, i) => {
        if (seg.kind !== 'walk') return;
        const next = shot.body[i + 1];
        const walkS = (next?.atS ?? shot.durationS) - seg.atS - 0.9;
        const metres = Math.hypot(PLACES[seg.to].x - PLACES[seg.from].x, PLACES[seg.to].z - PLACES[seg.from].z);
        const speed = metres / walkS;
        expect(speed).toBeLessThan(shot.age[0] > 60 ? 0.9 : 1.4);
        expect(speed).toBeGreaterThan(0.2);
      });
    });
  }
});
