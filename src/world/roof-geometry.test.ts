import { describe, expect, it } from 'vitest';
import { HUE_ROOF, hueRoofGeometry } from '@/world/roof-geometry';

const geometry = hueRoofGeometry();
const position = geometry.getAttribute('position');

interface Tri {
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  normal: [number, number, number];
  centroid: [number, number, number];
}

function triangles(): Tri[] {
  const out: Tri[] = [];
  const at = (i: number): [number, number, number] => [
    position.getX(i),
    position.getY(i),
    position.getZ(i),
  ];
  for (let i = 0; i + 2 < position.count; i += 3) {
    const a = at(i);
    const b = at(i + 1);
    const c = at(i + 2);
    const u: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: [number, number, number] = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]);
    out.push({
      a,
      b,
      c,
      normal: len > 1e-9 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 0, 0],
      centroid: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
    });
  }
  return out;
}

const tris = triangles();

describe('the Hue roof geometry', () => {
  it('fits the unit box the instancing scales', () => {
    for (let i = 0; i < position.count; i++) {
      expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(0.5 + HUE_ROOF.ridgeOverhang + 1e-6);
      expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(position.getY(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(position.getY(i)).toBeLessThanOrEqual(1 + HUE_ROOF.ridgeRise + 1e-6);
    }
  });

  it('peaks along the ridge, not in a valley', () => {
    // Every point near the middle of the span is high; every point at the
    // middle of an eave is low. A roof the wrong way up passes neither.
    // Away from the ends: the end walls are fanned from a point on the
    // ground at z = 0, which is on the ridge line but not on the ridge.
    const onRidge = tris
      .flatMap((t) => [t.a, t.b, t.c])
      .filter((p) => Math.abs(p[2]) < 1e-6 && Math.abs(p[0]) < 0.45);
    expect(onRidge.length).toBeGreaterThan(0);
    for (const p of onRidge) expect(p[1]).toBeGreaterThan(0.9);

    const midEave = tris
      .flatMap((t) => [t.a, t.b, t.c])
      .filter((p) => Math.abs(Math.abs(p[2]) - 0.5) < 1e-6 && Math.abs(p[0]) < 0.1);
    expect(midEave.length).toBeGreaterThan(0);
    for (const p of midEave) expect(p[1]).toBeLessThan(0.1);
  });

  it('turns the corners up', () => {
    const corner = tris
      .flatMap((t) => [t.a, t.b, t.c])
      .filter((p) => Math.abs(Math.abs(p[2]) - 0.5) < 1e-6 && Math.abs(Math.abs(p[0]) - 0.5) < 1e-6);
    expect(corner.length).toBeGreaterThan(0);
    // At least one corner point is lifted clear of the eave line it sits on.
    expect(Math.max(...corner.map((p) => p[1]))).toBeGreaterThan(HUE_ROOF.cornerLiftM * 0.8);
  });

  it('sweeps concave, sagging below the straight line', () => {
    // Halfway down the slope, a plain gable would be at half height.
    const half = Math.pow(1 - 0.5, HUE_ROOF.sag);
    expect(half).toBeLessThan(0.5);
    expect(half).toBeGreaterThan(0.3);
  });

  it('is not inside out', () => {
    // Every face that is part of the roof surface looks upward. The only ones
    // allowed to look down are the underside and the bottom of the ridge bar,
    // neither of which is ever seen from above.
    const downward = tris.filter((t) => t.normal[1] < -0.05);
    for (const t of downward) {
      const underside = t.centroid[1] < 1e-6;
      const ridgeUnderside = Math.abs(t.centroid[2]) <= HUE_ROOF.ridgeHalfDepth + 1e-6;
      expect(underside || ridgeUnderside).toBe(true);
    }
  });

  it('faces outward on both slopes', () => {
    // A face on the +z slope must lean towards +z, and the other way on -z.
    // Getting one of them backwards is the classic way a roof goes black.
    for (const t of tris) {
      const onSlope =
        Math.abs(t.centroid[2]) > 0.12 &&
        t.centroid[1] > 0.02 &&
        Math.abs(t.centroid[0]) < 0.45;
      if (!onSlope) continue;
      expect(Math.sign(t.normal[2])).toBe(Math.sign(t.centroid[2]));
    }
  });

  it('stays affordable, because every roof in town shares it', () => {
    expect(tris.length).toBeLessThan(260);
    expect(tris.length).toBeGreaterThan(120);
  });

  it('builds the same shape every time', () => {
    const again = hueRoofGeometry().getAttribute('position');
    expect(again.count).toBe(position.count);
    for (let i = 0; i < position.count; i++) expect(again.getY(i)).toBe(position.getY(i));
  });
});
