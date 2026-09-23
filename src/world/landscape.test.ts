import { describe, expect, it } from 'vitest';
import {
  buildForest,
  buildLandscapeGrid,
  createNoise2D,
  FOREST,
  gridHeightAt,
  LANDSCAPE,
  landscapeHeight,
  ridged,
  sampleGrid,
} from '@/world/landscape';
import { mulberry32 } from '@/world/seed';
import { buildTerrain, TERRAIN, waterDepthAt } from '@/world/terrain';

const terrain = buildTerrain(mulberry32(1));
const noise = createNoise2D(mulberry32(9));

describe('createNoise2D', () => {
  it('stays in a sane range', () => {
    for (let i = 0; i < 4000; i++) {
      const v = noise(i * 0.37, i * 0.11);
      expect(v).toBeGreaterThan(-1.6);
      expect(v).toBeLessThan(1.6);
    }
  });

  it('is continuous: a small step gives a small change', () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 0.73;
      expect(Math.abs(noise(x, 3.1) - noise(x + 0.001, 3.1))).toBeLessThan(0.02);
    }
  });

  it('is the same for the same seed', () => {
    const again = createNoise2D(mulberry32(9));
    for (let i = 0; i < 50; i++) expect(again(i * 1.3, i * 0.7)).toBe(noise(i * 1.3, i * 0.7));
  });
});

describe('ridged', () => {
  it('stays in [0, 1]', () => {
    for (let i = 0; i < 2000; i++) {
      const v = ridged(noise, i * 0.13, i * 0.07, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('landscapeHeight', () => {
  it('is flat across the plain, where everything outside the town stands', () => {
    const plainM = TERRAIN.mountainInnerM * LANDSCAPE.plainShare;
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * Math.PI * 2;
      for (const r of [0, 200, TERRAIN.cityRadiusM, plainM - 1]) {
        expect(landscapeHeight(terrain, noise, Math.cos(a) * r, Math.sin(a) * r)).toBe(0);
      }
    }
  });

  it('never rises out of the water or along its shore', () => {
    for (let i = 0; i < 4000; i++) {
      const x = (i % 80) * 60 - 2400;
      const z = Math.floor(i / 80) * 60 - 1500;
      if (waterDepthAt(terrain.water, x, z) > -LANDSCAPE.shoreFlatM) {
        expect(landscapeHeight(terrain, noise, x, z)).toBe(0);
      }
    }
  });

  it('settles back to flat at the outer edge, so it meets the land without a cliff', () => {
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const r = LANDSCAPE.outerM;
      expect(landscapeHeight(terrain, noise, Math.cos(a) * r, Math.sin(a) * r)).toBeCloseTo(0, 6);
    }
  });

  it('keeps the high peaks back behind the valley', () => {
    // The nearest peaks are shoulders on purpose (LANDSCAPE.nearStature), and
    // the height is saved for the range behind them: the other way round, a
    // 400 m peak at the edge of the plain stood the ring up as a wall.
    const near: number[] = [];
    const far: number[] = [];
    for (const m of terrain.mountains) {
      const r = Math.hypot(m.x, m.z);
      const h = landscapeHeight(terrain, noise, m.x, m.z);
      if (r < 1000) near.push(h);
      else if (r > 1250) far.push(h);
    }
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
    expect(near.length).toBeGreaterThan(5);
    expect(far.length).toBeGreaterThan(5);
    expect(mean(far)).toBeGreaterThan(200);
    expect(mean(far)).toBeGreaterThan(mean(near) * 2.5);
  });

  it('rises out of the valley gently, not as a wall', () => {
    // Round the whole rim, the first 200 m past the plain, in 10 m steps.
    const plainM = TERRAIN.mountainInnerM * LANDSCAPE.plainShare;
    let steepest = 0;
    let sum = 0;
    let steps = 0;
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * Math.PI * 2;
      for (let r = plainM; r < plainM + 200; r += 10) {
        const h0 = landscapeHeight(terrain, noise, Math.cos(a) * r, Math.sin(a) * r);
        const h1 = landscapeHeight(terrain, noise, Math.cos(a) * (r + 10), Math.sin(a) * (r + 10));
        const slope = Math.abs(h1 - h0) / 10;
        steepest = Math.max(steepest, slope);
        sum += slope;
        steps++;
      }
    }
    expect(sum / steps).toBeLessThan(0.3);
    expect(steepest).toBeLessThan(1.3);
  });

  it('is never below the ground', () => {
    for (let i = 0; i < 3000; i++) {
      const a = i * 0.91;
      const r = 700 + (i % 60) * 30;
      expect(landscapeHeight(terrain, noise, Math.cos(a) * r, Math.sin(a) * r)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('buildLandscapeGrid', () => {
  const grid = buildLandscapeGrid(terrain, mulberry32(9));

  it('has a vertex for every index and nothing that is not a number', () => {
    // Plain loops and one assertion each: an expect per value is four hundred
    // thousand calls and runs out the clock.
    const vertices = grid.positions.length / 3;
    let highestIndex = 0;
    for (const i of grid.index) if (i > highestIndex) highestIndex = i;
    expect(highestIndex).toBeLessThan(vertices);
    expect(grid.positions.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('builds quickly enough not to hold up the first frame', () => {
    const started = performance.now();
    buildLandscapeGrid(terrain, mulberry32(9));
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('faces up, so it is lit from the sky and not from under the ground', () => {
    // On the flat inner rings every triangle must point straight up. A grid
    // wound the other way still draws; it just goes black.
    let checked = 0;
    for (let t = 0; t < grid.index.length; t += 3) {
      const [ia, ib, ic] = [grid.index[t] ?? 0, grid.index[t + 1] ?? 0, grid.index[t + 2] ?? 0];
      const p = (k: number): [number, number, number] => [
        grid.positions[k * 3] ?? 0,
        grid.positions[k * 3 + 1] ?? 0,
        grid.positions[k * 3 + 2] ?? 0,
      ];
      const a = p(ia);
      const b = p(ib);
      const c = p(ic);
      if (Math.abs(a[1]) + Math.abs(b[1]) + Math.abs(c[1]) > 0) continue;
      const ux = b[0] - a[0];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vz = c[2] - a[2];
      // y of the cross product, with the triangle flat in the ground plane.
      expect(uz * vx - ux * vz).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('closes the ring without a seam', () => {
    const A = LANDSCAPE.around;
    for (let j = 0; j <= LANDSCAPE.outwards; j += 10) {
      const first = (j * (A + 1)) * 3 + 1;
      const last = (j * (A + 1) + A) * 3 + 1;
      expect(grid.positions[last]).toBe(grid.positions[first]);
    }
  });

  it('reports the highest point, for the snow line', () => {
    let highest = 0;
    for (let k = 1; k < grid.positions.length; k += 3) highest = Math.max(highest, grid.positions[k] ?? 0);
    expect(grid.maxHeightM).toBe(highest);
    expect(grid.maxHeightM).toBeGreaterThan(200);
  });
});

describe('sampleGrid', () => {
  const grid = buildLandscapeGrid(terrain, mulberry32(9));
  const A = LANDSCAPE.around;

  it('lands exactly on the mesh at its own vertices', () => {
    let worst = 0;
    for (let j = 1; j < LANDSCAPE.outwards; j += 7) {
      for (let i = 0; i < A; i += 13) {
        const k = (j * (A + 1) + i) * 3;
        const x = grid.positions[k] ?? 0;
        const z = grid.positions[k + 2] ?? 0;
        worst = Math.max(worst, Math.abs(gridHeightAt(grid, x, z) - (grid.positions[k + 1] ?? 0)));
      }
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('stays between the corners of the cell it falls in', () => {
    for (let n = 0; n < 2000; n++) {
      const a = n * 2.399;
      const r = grid.innerM + 5 + (n % 97) * 22;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = gridHeightAt(grid, x, z);
      expect(h).toBeGreaterThanOrEqual(-1e-3);
      expect(h).toBeLessThanOrEqual(grid.maxHeightM + 1e-3);
    }
  });

  it('is flat and level off the mesh', () => {
    expect(sampleGrid(grid, 0, 0)).toEqual({ heightM: 0, slope: 0 });
    expect(sampleGrid(grid, LANDSCAPE.outerM + 10, 0)).toEqual({ heightM: 0, slope: 0 });
  });
});

describe('buildForest', () => {
  const grid = buildLandscapeGrid(terrain, mulberry32(9));
  const started = performance.now();
  const trees = buildForest(terrain, grid, mulberry32(3));
  const tookMs = performance.now() - started;

  it('plants enough to read as woods, quickly', () => {
    expect(trees.length).toBeGreaterThan(4000);
    expect(trees.length).toBeLessThan(30000);
    expect(tookMs).toBeLessThan(600);
  });

  it('stands every tree on the mesh, sunk a little, and none on the plain', () => {
    let worst = 0;
    for (const tree of trees) {
      worst = Math.max(worst, Math.abs(tree.y + FOREST.sinkM - gridHeightAt(grid, tree.x, tree.z)));
      expect(Math.hypot(tree.x, tree.z)).toBeGreaterThanOrEqual(FOREST.fromM - 1e-6);
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('keeps off cliffs, out of the snow and back from the water', () => {
    for (const tree of trees) {
      const ground = sampleGrid(grid, tree.x, tree.z);
      expect(ground.slope).toBeLessThanOrEqual(FOREST.maxSlope);
      expect(ground.heightM).toBeLessThanOrEqual(grid.maxHeightM * FOREST.treeLine);
      expect(waterDepthAt(terrain.water, tree.x, tree.z)).toBeLessThanOrEqual(-FOREST.shoreM);
    }
  });

  it('is the same every time for the same seed', () => {
    expect(buildForest(terrain, grid, mulberry32(3))).toEqual(trees);
  });
});
