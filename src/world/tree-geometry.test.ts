import type { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  broadleafFar,
  broadleafNear,
  coniferFar,
  coniferNear,
  shrubGeometry,
  slenderFar,
  slenderNear,
} from '@/world/tree-geometry';

const MODELS: [string, () => BufferGeometry, number][] = [
  ['broadleaf, near', broadleafNear, 1600],
  ['broadleaf, far', broadleafFar, 240],
  ['slender, near', slenderNear, 1000],
  ['slender, far', slenderFar, 240],
  ['conifer, near', coniferNear, 640],
  ['conifer, far', coniferFar, 110],
  ['shrub', shrubGeometry, 60],
];

function box(geometry: BufferGeometry): { min: number[]; max: number[] } {
  const position = geometry.getAttribute('position');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.count; i++) {
    const p = [position.getX(i), position.getY(i), position.getZ(i)];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] ?? 0, p[k] ?? 0);
      max[k] = Math.max(max[k] ?? 0, p[k] ?? 0);
    }
  }
  return { min, max };
}

describe('tree models', () => {
  for (const [name, make, budget] of MODELS) {
    const geometry = make();
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const shade = geometry.getAttribute('color');
    const bark = geometry.getAttribute('bark');
    const index = geometry.getIndex();

    it(`${name}: has what the tree material reads, and stays inside its budget`, () => {
      expect(index).not.toBeNull();
      if (!index) return;
      expect(normal.count).toBe(position.count);
      expect(shade.count).toBe(position.count);
      expect(bark.count).toBe(position.count);
      for (let i = 0; i < index.count; i++) expect(index.getX(i)).toBeLessThan(position.count);
      expect(index.count / 3).toBeLessThanOrEqual(budget);
      for (let i = 0; i < shade.count; i++) {
        expect(shade.getX(i)).toBeGreaterThan(0.25);
        expect(shade.getX(i)).toBeLessThan(1.35);
      }
    });

    it(`${name}: fits the box an instance scales, standing on the ground`, () => {
      const { min, max } = box(geometry);
      expect(min[1]).toBeGreaterThanOrEqual(-1e-6);
      expect(max[1]).toBeLessThanOrEqual(1.02);
      for (const k of [0, 2]) {
        expect(min[k]).toBeGreaterThan(-0.6);
        expect(max[k]).toBeLessThan(0.6);
      }
    });

    it(`${name}: every face is wound to face out`, () => {
      // A face wound the wrong way is culled from the side it should be seen
      // from, and the tree has a hole in it that only shows when you move.
      // Wood has true normals, so each of its faces must agree with them.
      // Leaves lean their normals toward the whole crown's on purpose, and
      // the inside of a clump faces the middle of the tree, so for them the
      // test is that nearly all agree: a clump wound inside out agrees on none.
      if (!index) return;
      let wood = 0;
      let woodWrong = 0;
      let leaves = 0;
      let leavesWrong = 0;
      for (let i = 0; i < index.count; i += 3) {
        const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        const u = [position.getX(b) - position.getX(a), position.getY(b) - position.getY(a), position.getZ(b) - position.getZ(a)];
        const v = [position.getX(c) - position.getX(a), position.getY(c) - position.getY(a), position.getZ(c) - position.getZ(a)];
        const face = [
          (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
          (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
          (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
        ];
        let along = 0;
        for (const vertex of [a, b, c]) {
          along += (face[0] ?? 0) * normal.getX(vertex) + (face[1] ?? 0) * normal.getY(vertex) + (face[2] ?? 0) * normal.getZ(vertex);
        }
        if (bark.getX(a) > 0.5) {
          wood++;
          if (along <= 0) woodWrong++;
        } else {
          leaves++;
          if (along <= 0) leavesWrong++;
        }
      }
      expect(woodWrong).toBe(0);
      if (leaves > 0) expect(leavesWrong / leaves).toBeLessThan(0.15);
      expect(wood + leaves).toBe(index.count / 3);
    });
  }

  it('draws the far tree the same size and shape as the near one', () => {
    for (const [near, far] of [
      [broadleafNear(), broadleafFar()],
      [slenderNear(), slenderFar()],
      [coniferNear(), coniferFar()],
    ] as const) {
      // How far out and how high: which way the far one's branch tips point is
      // its own business, and a tier of five tips is narrower on some sides.
      const reach = (geometry: BufferGeometry): number => {
        const position = geometry.getAttribute('position');
        let most = 0;
        for (let i = 0; i < position.count; i++) most = Math.max(most, Math.hypot(position.getX(i), position.getZ(i)));
        return most;
      };
      expect(Math.abs(reach(near) - reach(far))).toBeLessThan(0.06);
      expect(Math.abs((box(near).max[1] ?? 0) - (box(far).max[1] ?? 0))).toBeLessThan(0.06);
    }
  });

  it('has wood in the trunk and leaves in the crown', () => {
    const geometry = broadleafNear();
    const position = geometry.getAttribute('position');
    const bark = geometry.getAttribute('bark');
    let wood = 0;
    let leaves = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < 0.3) expect(bark.getX(i)).toBe(1);
      if (bark.getX(i) > 0.5) wood++;
      else leaves++;
    }
    expect(wood).toBeGreaterThan(100);
    expect(leaves).toBeGreaterThan(wood);
  });
});
