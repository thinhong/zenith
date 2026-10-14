import type { EraTree, Structure } from '@/world/eras';
import { rotYAlong } from '@/world/geometry2d';
import { LAYER_Y } from '@/world/ground';
import { range, type Rng } from '@/world/seed';
import { LANDSCAPE } from '@/world/landscape';
import { centrelinePoint, TERRAIN, type TerrainSpec } from '@/world/terrain';

/**
 * The edge of the water, for an era that goes down to it (2300). Pure:
 * terrain in, structures and trees out (AGENTS.md 3).
 *
 * A few timber jetties run out over the still water from the edge of town,
 * each with a small roof at its end to sit under. Out past the last houses a
 * single broad tree stands alone near the water here and there: the picture
 * the owner brought for this era was a lake in mist with one tree on a grass
 * point, and a single tree is what makes a shore read as a place.
 */
export interface WatersideStyle {
  deck: readonly number[];
  post: number;
  roof: readonly number[];
  soffit: readonly number[];
  /** The lone trees' leaves. */
  leaves: number;
}

export const WATERSIDE = {
  /** Jetties: how many at most, how far from the middle of town (as shares of the settlement), and how far apart. */
  jetties: 3,
  jettyFrom: 0.35,
  jettyTo: 1.05,
  jettyApartM: 150,
  /** Along a coast; along a river they are shorter, as a share of its half-width. */
  jettyM: [30, 44] as const,
  riverShare: 0.45,
  deckM: 2.2,
  deckY: 0.32,
  deckH: 0.24,
  postEveryM: 4,
  /** The shelter at the end. */
  shelterM: 5,
  shelterY: 3,
  /** Lone trees: how many, where (as shares of the settlement), and how far in from the water. */
  lone: 3,
  loneFrom: 1.2,
  loneTo: 1.75,
  loneInM: [9, 16] as const,
  loneApartM: 260,
} as const;

function pick(colours: readonly number[], roll: number): number {
  const index = Math.min(colours.length - 1, Math.max(0, Math.floor(roll * colours.length)));
  return colours[index] ?? 0x808080;
}

export interface Waterside {
  structures: Structure[];
  trees: EraTree[];
}

/** Points along the edge of the water, each with the way out over it. */
function shoreline(terrain: TerrainSpec): { x: number; z: number; outX: number; outZ: number; reachM: number }[] {
  const water = terrain.water;
  const out: { x: number; z: number; outX: number; outZ: number; reachM: number }[] = [];
  for (let i = 0; i < water.offsetsM.length; i++) {
    const c = centrelinePoint(water, i);
    if (water.kind === 'coast') {
      // The water lies on the positive side of the line.
      out.push({ x: c.x, z: c.z, outX: water.nrmX, outZ: water.nrmZ, reachM: WATERSIDE.jettyM[1] });
    } else {
      for (const side of [-1, 1]) {
        out.push({
          x: c.x + water.nrmX * water.halfWidthM * side,
          z: c.z + water.nrmZ * water.halfWidthM * side,
          outX: -water.nrmX * side,
          outZ: -water.nrmZ * side,
          reachM: water.halfWidthM * WATERSIDE.riverShare,
        });
      }
    }
  }
  return out;
}

export function buildWaterside(rng: Rng, terrain: TerrainSpec, style: WatersideStyle): Waterside {
  const structures: Structure[] = [];
  const trees: EraTree[] = [];
  const shore = shoreline(terrain);
  const R = terrain.cityRadiusM;

  // --- jetties --------------------------------------------------------------------
  const sites = shore.filter((p) => {
    const r = Math.hypot(p.x, p.z);
    return r > R * WATERSIDE.jettyFrom && r < R * WATERSIDE.jettyTo;
  });
  const chosen: typeof sites = [];
  for (let tries = 0; tries < 40 && chosen.length < WATERSIDE.jetties && sites.length > 0; tries++) {
    const site = sites[Math.floor(rng() * sites.length)];
    if (!site) continue;
    if (chosen.some((c) => Math.hypot(c.x - site.x, c.z - site.z) < WATERSIDE.jettyApartM)) continue;
    chosen.push(site);
  }
  for (const site of chosen) {
    const lengthM = Math.min(site.reachM, range(rng, WATERSIDE.jettyM[0], WATERSIDE.jettyM[1]));
    if (lengthM < 8) continue;
    // From a little way up the bank, out over the water.
    const startBack = 4;
    const total = lengthM + startBack;
    const rotY = rotYAlong(site.outX, site.outZ);
    const mid = total / 2 - startBack;
    const y = LAYER_Y.water + WATERSIDE.deckY - WATERSIDE.deckH;
    const colour = pick(style.deck, rng());
    structures.push({
      kind: 'box',
      x: site.x + site.outX * mid,
      y,
      z: site.z + site.outZ * mid,
      wM: total,
      hM: WATERSIDE.deckH,
      dM: WATERSIDE.deckM,
      rotY,
      colour,
    });
    // Posts down into the water, along both edges.
    const sideX = -site.outZ;
    const sideZ = site.outX;
    for (let t = 2; t < lengthM; t += WATERSIDE.postEveryM) {
      for (const side of [-1, 1]) {
        structures.push({
          kind: 'box',
          x: site.x + site.outX * t + sideX * side * (WATERSIDE.deckM / 2 - 0.1),
          y: 0,
          z: site.z + site.outZ * t + sideZ * side * (WATERSIDE.deckM / 2 - 0.1),
          wM: 0.16,
          hM: y,
          dM: 0.16,
          rotY,
          colour: style.post,
        });
      }
    }
    // A platform and a roof over it at the end.
    const endX = site.x + site.outX * (lengthM - WATERSIDE.shelterM / 2);
    const endZ = site.z + site.outZ * (lengthM - WATERSIDE.shelterM / 2);
    const s = WATERSIDE.shelterM;
    structures.push({ kind: 'box', x: endX, y, z: endZ, wM: s, hM: WATERSIDE.deckH, dM: s, rotY, colour });
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      structures.push({
        kind: 'box',
        x: endX + site.outX * a * (s / 2 - 0.2) + sideX * b * (s / 2 - 0.2),
        y: 0,
        z: endZ + site.outZ * a * (s / 2 - 0.2) + sideZ * b * (s / 2 - 0.2),
        wM: 0.14,
        hM: WATERSIDE.shelterY,
        dM: 0.14,
        rotY,
        colour: style.post,
      });
    }
    structures.push({ kind: 'box', x: endX, y: WATERSIDE.shelterY, z: endZ, wM: s + 1.2, hM: 0.24, dM: s + 1.2, rotY, colour: pick(style.roof, rng()) });
    structures.push({ kind: 'box', x: endX, y: WATERSIDE.shelterY - 0.06, z: endZ, wM: s + 1.14, hM: 0.06, dM: s + 1.14, rotY, colour: pick(style.soffit, rng()) });
  }

  // --- lone trees -----------------------------------------------------------------
  // On the plain: past it the land climbs, and a tree planted at the plain's
  // height out there would stand buried in the hillside.
  const plainM = TERRAIN.mountainInnerM * LANDSCAPE.plainShare - 25;
  const meadows = shore.filter((p) => {
    const r = Math.hypot(p.x, p.z);
    return r > R * WATERSIDE.loneFrom && r < Math.min(R * WATERSIDE.loneTo, plainM);
  });
  const lone: { x: number; z: number }[] = [];
  for (let tries = 0; tries < 40 && lone.length < WATERSIDE.lone && meadows.length > 0; tries++) {
    const site = meadows[Math.floor(rng() * meadows.length)];
    if (!site) continue;
    const inM = range(rng, WATERSIDE.loneInM[0], WATERSIDE.loneInM[1]);
    const x = site.x - site.outX * inM;
    const z = site.z - site.outZ * inM;
    if (lone.some((t) => Math.hypot(t.x - x, t.z - z) < WATERSIDE.loneApartM)) continue;
    lone.push({ x, z });
    trees.push({ x, z, radiusM: range(rng, 5, 6.2), heightM: range(rng, 10, 12.5), stems: false, colour: style.leaves });
  }
  return { structures, trees };
}
