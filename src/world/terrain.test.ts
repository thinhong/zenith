import { describe, expect, it } from 'vitest';
import { mulberry32 } from './seed';
import {
  buildTerrain,
  centrelinePoint,
  isBuildable,
  TERRAIN,
  waterDepthAt,
  type TerrainSpec,
} from './terrain';

function terrainOfKind(kind: 'river' | 'coast'): TerrainSpec {
  for (let seed = 1; seed < 200; seed++) {
    const t = buildTerrain(mulberry32(seed));
    if (t.water.kind === kind) return t;
  }
  throw new Error(`no seed produced a ${kind}`);
}

describe('buildTerrain', () => {
  it('is deterministic for the same seed', () => {
    const a = buildTerrain(mulberry32(7));
    const b = buildTerrain(mulberry32(7));
    expect(a).toEqual(b);
  });

  it('gives a different world for a different seed', () => {
    const a = buildTerrain(mulberry32(7));
    const b = buildTerrain(mulberry32(8));
    expect(a).not.toEqual(b);
  });

  it('produces both a river and a coast across seeds', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) kinds.add(buildTerrain(mulberry32(seed)).water.kind);
    expect(kinds).toEqual(new Set(['river', 'coast']));
  });

  it('keeps every mountain in the ring and out of the water', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const t = buildTerrain(mulberry32(seed));
      expect(t.mountains.length).toBeGreaterThan(20);
      for (const m of t.mountains) {
        const r = Math.hypot(m.x, m.z);
        expect(r).toBeGreaterThanOrEqual(TERRAIN.mountainInnerM - 1);
        expect(r).toBeLessThanOrEqual(TERRAIN.mountainOuterM + 1);
        expect(waterDepthAt(t.water, m.x, m.z)).toBeLessThanOrEqual(-m.radiusM * 0.4);
      }
    }
  });
});

describe('waterDepthAt', () => {
  it('is wet on a river centreline and dry well away from it', () => {
    const t = terrainOfKind('river');
    for (let i = 0; i < t.water.offsetsM.length; i += 4) {
      const p = centrelinePoint(t.water, i);
      expect(waterDepthAt(t.water, p.x, p.z)).toBeGreaterThan(0);
      const dry = {
        x: p.x + t.water.nrmX * (t.water.halfWidthM + 300),
        z: p.z + t.water.nrmZ * (t.water.halfWidthM + 300),
      };
      expect(waterDepthAt(t.water, dry.x, dry.z)).toBeLessThan(0);
    }
  });

  it('puts a coast on exactly one side of the shoreline', () => {
    const t = terrainOfKind('coast');
    const p = centrelinePoint(t.water, Math.floor(t.water.offsetsM.length / 2));
    const wet = { x: p.x + t.water.nrmX * 400, z: p.z + t.water.nrmZ * 400 };
    const dry = { x: p.x - t.water.nrmX * 400, z: p.z - t.water.nrmZ * 400 };
    expect(waterDepthAt(t.water, wet.x, wet.z)).toBeGreaterThan(0);
    expect(waterDepthAt(t.water, dry.x, dry.z)).toBeLessThan(0);
  });
});

describe('isBuildable', () => {
  it('rejects anything outside the city radius', () => {
    const t = buildTerrain(mulberry32(3));
    expect(isBuildable(t, t.cityRadiusM + 10, 0)).toBe(false);
  });

  it('rejects the water and its margin', () => {
    const t = terrainOfKind('river');
    const p = centrelinePoint(t.water, Math.floor(t.water.offsetsM.length / 2));
    if (Math.hypot(p.x, p.z) < t.cityRadiusM) expect(isBuildable(t, p.x, p.z)).toBe(false);
  });

  it('leaves most of the city buildable', () => {
    const t = buildTerrain(mulberry32(1));
    let ok = 0;
    let total = 0;
    for (let x = -1000; x <= 1000; x += 100)
      for (let z = -1000; z <= 1000; z += 100) {
        total++;
        if (isBuildable(t, x, z)) ok++;
      }
    expect(ok / total).toBeGreaterThan(0.5);
  });
});
