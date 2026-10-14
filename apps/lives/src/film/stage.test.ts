import { describe, expect, it } from 'vitest';
import { bodyAt, faceAt, gazeAt, PLACES, ROOM, SEATS, turnSize, type Segment } from './stage';

describe('the room layout', () => {
  it('keeps every place and seat inside the walls', () => {
    for (const p of [...Object.values(PLACES), ...Object.values(SEATS)]) {
      expect(Math.abs(p.x)).toBeLessThan(ROOM.halfWidthM - 0.3);
      // A child at the window stands close to it, so the margin is a little under a foot.
      expect(p.z).toBeGreaterThan(ROOM.backZ + 0.25);
      expect(p.z).toBeLessThan(ROOM.frontZ);
    }
  });

  it('puts the window spot in front of the window, facing it', () => {
    expect(Math.abs(PLACES.window.x - ROOM.window.x)).toBeLessThan(0.3);
    expect(Math.cos(PLACES.window.yaw)).toBeLessThan(-0.9);
  });
});

describe('bodyAt', () => {
  const walk: Segment[] = [
    { kind: 'stand', atS: 0, place: 'window' },
    { kind: 'walk', atS: 1, from: 'window', to: 'deskFront' },
    { kind: 'sitDown', atS: 5.6, seat: 'desk' },
    { kind: 'sit', atS: 7, seat: 'desk' },
  ];

  it('stands at the place before the walk starts', () => {
    const b = bodyAt(walk, 0.5, 8);
    expect(b.x).toBe(PLACES.window.x);
    expect(b.walk).toBe(0);
    expect(b.sit).toBe(0);
  });

  it('walks from one place to the other and arrives facing the way the place faces', () => {
    const start = bodyAt(walk, 1, 8);
    expect(start.x).toBeCloseTo(PLACES.window.x);
    const end = bodyAt(walk, 5.599, 8);
    expect(end.x).toBeCloseTo(PLACES.deskFront.x, 2);
    expect(end.z).toBeCloseTo(PLACES.deskFront.z, 2);
    expect(Math.cos(end.yaw - PLACES.deskFront.yaw)).toBeGreaterThan(0.99);
  });

  it('is fully in stride halfway, heading for the goal, and never walks backwards', () => {
    const mid = bodyAt(walk, 3.3, 8);
    expect(mid.walk).toBeGreaterThan(0.9);
    const dx = PLACES.deskFront.x - PLACES.window.x;
    const dz = PLACES.deskFront.z - PLACES.window.z;
    expect(Math.sin(mid.yaw) * dx + Math.cos(mid.yaw) * dz).toBeGreaterThan(0);
    let last = -1;
    for (let t = 1; t < 5.6; t += 0.05) {
      const walked = bodyAt(walk, t, 8).travelledM;
      expect(walked).toBeGreaterThanOrEqual(last - 1e-9);
      last = walked;
    }
  });

  it('sits down on the seat and stays there', () => {
    expect(bodyAt(walk, 5.6, 8).sit).toBeCloseTo(0);
    const seated = bodyAt(walk, 7.5, 8);
    expect(seated.sit).toBe(1);
    expect(seated.x).toBe(SEATS.desk.x);
    expect(seated.seat).toBe('desk');
  });

  it('stands up again, back to the front of the seat', () => {
    const up: Segment[] = [
      { kind: 'sit', atS: 0, seat: 'desk' },
      { kind: 'standUp', atS: 1, seat: 'desk' },
      { kind: 'stand', atS: 3, place: 'deskFront' },
    ];
    expect(bodyAt(up, 1, 5).sit).toBeCloseTo(1);
    expect(bodyAt(up, 2.999, 5).sit).toBeCloseTo(0, 3);
    expect(bodyAt(up, 2.999, 5).x).toBeCloseTo(PLACES.deskFront.x, 2);
  });
});

describe('a turn on the spot', () => {
  it('turns round the short way and ends facing the new way', () => {
    const turn: Segment[] = [
      { kind: 'stand', atS: 0, place: 'window' },
      { kind: 'turn', atS: 1, from: 'window', to: 'windowTurned' },
      { kind: 'stand', atS: 2.5, place: 'windowTurned' },
    ];
    const end = bodyAt(turn, 2.499, 4);
    expect(Math.cos(end.yaw - PLACES.windowTurned.yaw)).toBeGreaterThan(0.999);
    expect(end.x).toBeCloseTo(PLACES.window.x);
    let last = bodyAt(turn, 1, 4).yaw;
    for (let t = 1; t < 2.5; t += 0.05) {
      const yaw = bodyAt(turn, t, 4).yaw;
      expect(turnSize(last, yaw)).toBeLessThan(0.3);
      last = yaw;
    }
  });
});

describe('turnSize', () => {
  it('always turns the short way round', () => {
    expect(turnSize(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(turnSize(0, Math.PI * 1.5)).toBeCloseTo(Math.PI * 0.5);
  });
});

describe('faceAt', () => {
  it('eases between keys and holds after the last', () => {
    const keys = [{ atS: 0, happy: 0 }, { atS: 2, happy: 1 }];
    expect(faceAt(keys, 0).happy).toBe(0);
    expect(faceAt(keys, 1).happy).toBeCloseTo(0.5);
    expect(faceAt(keys, 5).happy).toBe(1);
    expect(faceAt(keys, 1).closed).toBe(0);
  });
});

describe('gazeAt', () => {
  it('turns from the old target to the new one', () => {
    const keys = [
      { atS: 0, at: [0, 1, 0] as const },
      { atS: 2, at: 'camera' as const },
    ];
    const g = gazeAt(keys, 2.3, 0.6);
    expect(g.from).toEqual([0, 1, 0]);
    expect(g.to).toBe('camera');
    expect(g.k).toBeGreaterThan(0);
    expect(g.k).toBeLessThan(1);
    expect(gazeAt(keys, 9, 0.6).k).toBe(1);
  });
});
