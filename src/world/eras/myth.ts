import { smoothstep } from '@/state/altitude';
import { MYTH_THOUGHTS } from '@/thoughts/myth-content';
import type { Era, EraBuild, EraPalette, Structure, VehicleProfile } from '@/world/eras';
import { ERA_POPULATION } from '@/world/eras/population';
import { buildFacade, type FacadeStyle } from '@/world/facade';
import { LAYER_Y } from '@/world/ground';
import { avenueCorridors, buildBlocks, buildLots, type Lot, type LotProfile, type LotUse } from '@/world/lots';
import { buildRoadGraph, type RoadGraph } from '@/world/roads';
import { buildRoofscape, type RoofStyle } from '@/world/roofscape';
import { range, type Rng } from '@/world/seed';
import { buildStreetscape, type StreetStyle } from '@/world/streetscape';
import type { TerrainSpec } from '@/world/terrain';

/**
 * Wyrmrest: the same land, long before anybody wrote a date on it.
 *
 * This replaces the two eras that were planned and never built, 1500 Fields
 * and 1930 Colonial, on the owner's call. It is the one place in Zenith that
 * is not history, and the rule it is built to is the same as every other
 * era's: the magic is in the nouns. Nobody here is awed by their own world.
 * A wyrm asleep under the hill is a fact of the local geography, the way a
 * river is, and the people walking to market are thinking about the rent.
 *
 * What makes it read as this and not as the citadel:
 *
 * - **The wall is not straight.** It is a closed curve with a slow wobble in
 *   it, following the ground rather than a surveyor's line, with drum towers
 *   at intervals and three gates. A square wall is an imperial one; this is a
 *   wall built by people who put it where the digging was easiest.
 * - **The roofs are steep.** `pitch` is more than double the tropical 0.34,
 *   which is most of what separates a northern town from a southern one: the
 *   same house plan under the two roofs reads as two different climates.
 * - **The keep stands apart and looks down.** Square, tall, on the high
 *   ground north of the market, with its own small wall.
 * - **Timber, thatch and slate**, and one dark green for the wood that comes
 *   right up to the walls, because the wood is where the things live.
 */

const MYTH = {
  /**
   * The wall's mean radius, as a share of the settlement. Smaller than the
   * citadel's square: a town of this age huddles.
   */
  wallShare: 0.54,
  /**
   * How much the wall wanders, as a share of its radius, at three and five
   * lobes. Two wavenumbers rather than one, or it reads as an egg.
   */
  wobble3: 0.085,
  wobble5: 0.045,
  wallThicknessM: 3.4,
  wallHeightM: 9,
  /** Sampled this many times round. Each pair of samples is one wall block. */
  wallSegments: 96,
  /** A drum tower every this many segments. */
  towerEvery: 8,
  towerRadiusM: 4.6,
  towerHeightM: 13.5,
  /** Half-width of a gateway, in radians of the wall. */
  gateHalfAngle: 0.075,
  gateTowerHeightM: 15,
  /** The three gates, in radians. South, north-east, north-west. */
  gateAngles: [Math.PI / 2, -Math.PI / 6, Math.PI + Math.PI / 6],
  /**
   * How far a track runs beyond its gate before the country takes over. The
   * grid the road builder makes covers the whole disc, which outside a walled
   * town is a chequerboard of lanes through empty fields: nothing this age
   * surveyed the countryside. Three tracks out of three gates, and the rest
   * of the land has nothing on it.
   */
  approachM: 95,
  /** The keep, north of the middle, on its own ground. */
  keep: { x: 0, z: -78, baseM: 26, heightM: 34, turretM: 7.5, turretHeightM: 44 },
  /** The market square, which is where the streets are aiming. */
  marketM: 46,
} as const;

const STONE = { wall: 0x8c8a82, shade: 0x77756e, keep: 0x9a978d, base: 0x6f6d66 } as const;
const TIMBER = { dark: 0x4a3a2a, mid: 0x6b5540, pale: 0xa08a6a } as const;
const THATCH = [0xa8956a, 0x94815a, 0xb8a478] as const;
const SLATE = [0x5c6068, 0x4e525a, 0x6a6e76] as const;
/**
 * The wyrm. Earth colours, not dragon colours: it has been lying there long
 * enough to have turf on it, and if it were green and scaly you would see a
 * monster where you are meant to see a hill.
 */
const WYRM = { hide: 0x5e6a48, hideDark: 0x4d5a3d, plate: 0x6b6352, wing: 0x55603f } as const;

const PALETTE: EraPalette = {
  /** Beaten earth and mud between the houses, not paving. */
  townGround: 0x8a7c62,
  land: 0x6f8a4e,
  water: 0x3c6480,
  road: 0x7e7159,
  pavement: 0x8c8068,
  roof: 0x7a6a52,
  /** The wood. Darker and colder than any of the other eras' planting. */
  canopy: 0x3d6638,
  trunk: 0x3d3228,
  /** Torchlight, and a colder second light in the windows of the keep. */
  lampOn: 0xffa64d,
  /**
   * Trees everywhere, inside the walls and out. The wood is not scenery here,
   * it is the thing the wall is for.
   */
  courtyardChance: 0.55,
  canopyScale: 1.35,
  canopyRound: 0x4a7440,
  roundShare: 0.42,
  bush: 0x557a44,
  bushesPerTree: 1.15,
  lamps: true,
  /**
   * Firelight, not lighting. A handful of windows and they flicker warm: the
   * town after dark is mostly dark, which is the point of a wall and a gate
   * that shuts.
   */
  windowsLit: 0.16,
  windowGlow: 0.62,
  windowTint: [1.0, 0.72, 0.42],
  building: {
    // Lime-washed daub over a timber frame, in the greys and creams a wet
    // northern climate actually produces.
    home: [0xcfc4ac, 0xbdb29c, 0xded3bb, 0xa89c86, 0xc6bba4],
    work: [0xb0a894, 0x9e9684, 0xc0b8a2],
    market: [0xc8bb9e, 0xb6a98e, 0xd4c7aa],
    // The temple is stone where everything else is timber, so it reads as the
    // only thing in town built to outlast the people who built it.
    temple: [0x9a978d, 0x86837a],
    park: [0x000000],
    water: [0x000000],
  },
  clothes: [0x8c6b4a, 0x6b7a52, 0xa89878, 0x5e5240, 0x94764e, 0x7a6a8c, 0xb0a288, 0x6a5240],
};

/** Ox carts. Slow, few, and the only wheels in the world. */
const VEHICLES: VehicleProfile = {
  major: {
    lengthM: 3.2,
    heightM: 1.6,
    widthM: 1.5,
    speedMS: { min: 1.4, max: 2.2 },
    colours: [0x6b5540, 0x7c6248, 0x5a4634],
  },
  minor: {
    lengthM: 2.1,
    heightM: 1.2,
    widthM: 1.1,
    speedMS: { min: 1.2, max: 1.8 },
    colours: [0x8a7454, 0x6f5a42],
  },
  minorShare: 0.62,
  density: 0.55,
};

const ROOF_STYLE: RoofStyle = {
  tile: [...THATCH, ...SLATE],
  grandTile: SLATE,
  deck: [0x6a6055],
  clutter: [0x7a6a52],
  /** Everything is pitched. There is no such thing as a flat roof here. */
  pitchedShare: 1,
  pitchedMaxM: 200,
  /**
   * Steep. A roof at 0.34 sheds a monsoon; a roof at 0.78 sheds snow and
   * gives you an attic, and it is the single strongest signal of where and
   * when this town is.
   */
  pitch: 0.78,
  /** Half the houses have grown a lean-to, because nothing here was planned. */
  wingShare: 0.5,
  crowns: false,
  crownTint: SLATE,
  chimney: { share: 0.62, colours: [0x6f6d66, 0x7d7a70, 0x5f5d57] },
  deckTop: { share: 0, colours: [0x6a6055] },
  ledge: { everyM: 100, thicknessM: 0.1, overhangM: 0, colours: [0x000000] },
};

const STREET_STYLE: StreetStyle = {
  wallShare: 0.42,
  wallHeightM: 1.1,
  wallColours: [0x6f6d66, 0x5f5d57, TIMBER.mid],
  /** Carts left standing, not parked vehicles. */
  parkedShare: 0.2,
  parked: { lengthM: 2.6, widthM: 1.4, heightM: 1.1, colours: [0x6b5540, 0x7c6248] },
  poleShare: 0.4,
  poleColour: TIMBER.dark,
  furniture: {
    share: 0.5,
    stepM: 12,
    benchColours: [TIMBER.mid, TIMBER.dark, 0x7c6248],
    planterColours: [0x6f6d66, 0x7d7a70],
    plantColours: [0x3a6238, 0x46663a],
    bollardColour: TIMBER.dark,
  },
};

/**
 * Half-timbering. The ribs are the frame showing through the daub, so they run
 * one storey and the ground floor is a dark timber sill.
 */
const FACADE_STYLE: FacadeStyle = {
  balcony: {
    share: 0.28,
    everyM: 3,
    perFloor: 1,
    depthM: 0.8,
    railM: 0.7,
    colours: [TIMBER.mid, TIMBER.dark],
    railColours: [TIMBER.dark, 0x3a2e22],
  },
  pilaster: {
    fromM: 3,
    share: 0.82,
    widthM: 0.26,
    depthM: 0.16,
    spacingM: 2.2,
    maxHeightM: 3.4,
    colours: [TIMBER.dark, TIMBER.mid, 0x3a2e22],
  },
  shopfront: {
    share: 0.44,
    heightM: 2.4,
    canopyDepthM: 1.4,
    colours: [TIMBER.dark, 0x3a2e22, TIMBER.mid],
    canopyColours: [0x8c6b4a, 0x6b7a52, 0xa89878],
  },
};

const MYTH_LOTS: LotProfile = {
  /** Small plots everywhere. Nobody here has a site big enough to be grand. */
  lotsPerBlock: () => ({ min: 7, max: 15 }),
  maxAspect: 2.6,
  minLotSideM: 3.2,
  splitFloorM: 7,
  setbackM: 0.8,
  parkChance: (d) => 0.08 + 0.24 * smoothstep(0.45, 1, d),
  weights: (d) => {
    const middle = 1 - smoothstep(0.1, 0.5, d);
    return {
      work: 0.1 + 0.16 * middle,
      home: 0.56,
      market: 0.06 + 0.2 * middle,
      temple: 0.03,
      park: 0.12,
    };
  },
  heightFor: (rng, use, d) => {
    if (use === 'park') return 0;
    const middle = 1 - smoothstep(0.15, 0.6, d);
    // Two and three storeys in the middle, one and two at the edge. Nothing
    // in this town is tall except the keep and the temple.
    if (use === 'temple') return range(rng, 9, 14);
    if (use === 'work') return range(rng, 4, 7) + 3 * middle;
    if (use === 'market') return range(rng, 3.5, 6) + 2 * middle;
    return range(rng, 3.5, 7) + 4 * middle;
  },
  style: () => 'low',
};

/** The wall's radius at an angle: a circle with a slow wobble in it. */
function wallRadius(angle: number, meanM: number): number {
  return (
    meanM *
    (1 + MYTH.wobble3 * Math.sin(3 * angle + 0.7) + MYTH.wobble5 * Math.sin(5 * angle - 1.9))
  );
}

function insideWall(x: number, z: number, meanM: number): boolean {
  return Math.hypot(x, z) < wallRadius(Math.atan2(z, x), meanM);
}

/** How far this angle is from the nearest gate, in radians. */
function angleToGate(angle: number): number {
  let best = Math.PI;
  for (const gate of MYTH.gateAngles) {
    let d = Math.abs(angle - gate) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < best) best = d;
  }
  return best;
}

/**
 * Drops any lane that crosses the wall away from a gate, then keeps only the
 * piece still reachable from the middle. Without the second step a hamlet
 * outside the wall keeps its lanes and the walkers teleport into it.
 */
function cutAtWall(graph: RoadGraph, meanM: number): RoadGraph {
  // Where each gate stands, so the tracks outside can be measured from it.
  const gates = MYTH.gateAngles.map((angle) => {
    const r = wallRadius(angle, meanM);
    return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
  });
  const nearAGate = (x: number, z: number): boolean =>
    gates.some((gate) => Math.hypot(x - gate.x, z - gate.z) < MYTH.approachM);

  const edges = graph.edges.filter((edge) => {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) return false;
    const inA = insideWall(a.x, a.z, meanM);
    const inB = insideWall(b.x, b.z, meanM);
    if (inA && inB) return true;
    if (!inA && !inB) {
      // Outside: only the short track running on from a gate survives, and
      // only if it runs away from the town rather than across it. Without the
      // angle test the whole square of grid around each gate was kept, which
      // read as the foundations of a village that is not there.
      if (!nearAGate(a.x, a.z) || !nearAGate(b.x, b.z)) return false;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      return angleToGate(Math.atan2(mz, mx)) < MYTH.gateHalfAngle * 2;
    }
    // Crossing: allowed only through a gateway.
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    return angleToGate(Math.atan2(mz, mx)) < MYTH.gateHalfAngle;
  });

  const adjacency: number[][] = graph.nodes.map(() => []);
  edges.forEach((edge, index) => {
    adjacency[edge.a]?.push(index);
    adjacency[edge.b]?.push(index);
  });
  return { nodes: graph.nodes, edges, adjacency };
}

/** The curtain wall: blocks round the curve, drum towers, and three gateways. */
function wallStructures(meanM: number): Structure[] {
  const out: Structure[] = [];
  const step = (Math.PI * 2) / MYTH.wallSegments;
  for (let i = 0; i < MYTH.wallSegments; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    const mid = (a0 + a1) / 2;
    const onGate = angleToGate(mid) < MYTH.gateHalfAngle;
    const r0 = wallRadius(a0, meanM);
    const r1 = wallRadius(a1, meanM);
    const x0 = Math.cos(a0) * r0;
    const z0 = Math.sin(a0) * r0;
    const x1 = Math.cos(a1) * r1;
    const z1 = Math.sin(a1) * r1;
    const spanM = Math.hypot(x1 - x0, z1 - z0);

    if (!onGate) {
      out.push({
        kind: 'box',
        x: (x0 + x1) / 2,
        y: 0,
        z: (z0 + z1) / 2,
        // A shade long, so consecutive blocks overlap round the curve rather
        // than leaving a wedge of daylight at every joint.
        wM: spanM * 1.12,
        hM: MYTH.wallHeightM,
        dM: MYTH.wallThicknessM,
        rotY: -Math.atan2(z1 - z0, x1 - x0),
        colour: i % 2 === 0 ? STONE.wall : STONE.shade,
      });
    }

    if (i % MYTH.towerEvery === 0) {
      const r = wallRadius(a0, meanM);
      const tx = Math.cos(a0) * r;
      const tz = Math.sin(a0) * r;
      const tall = onGate ? MYTH.gateTowerHeightM : MYTH.towerHeightM;
      out.push({
        kind: 'box',
        x: tx,
        y: 0,
        z: tz,
        wM: MYTH.towerRadiusM * 2,
        hM: tall,
        dM: MYTH.towerRadiusM * 2,
        rotY: a0,
        colour: STONE.wall,
      });
      // A conical cap, which is what makes a drum tower read as one from
      // above rather than as a post.
      out.push({
        kind: 'roof',
        x: tx,
        y: tall,
        z: tz,
        wM: MYTH.towerRadiusM * 2.5,
        hM: MYTH.towerRadiusM * 1.9,
        dM: MYTH.towerRadiusM * 2.5,
        rotY: a0,
        colour: SLATE[i % SLATE.length] ?? SLATE[0],
      });
    }
  }

  // A pair of gate towers either side of each gateway, taller than the rest.
  for (const gate of MYTH.gateAngles) {
    for (const side of [-1, 1]) {
      const a = gate + side * MYTH.gateHalfAngle;
      const r = wallRadius(a, meanM);
      const gx = Math.cos(a) * r;
      const gz = Math.sin(a) * r;
      out.push({
        kind: 'box',
        x: gx,
        y: 0,
        z: gz,
        wM: 6.4,
        hM: MYTH.gateTowerHeightM,
        dM: 6.4,
        rotY: a,
        colour: STONE.wall,
      });
      out.push({
        kind: 'roof',
        x: gx,
        y: MYTH.gateTowerHeightM,
        z: gz,
        wM: 8,
        hM: 6.5,
        dM: 8,
        rotY: a,
        colour: SLATE[1] ?? SLATE[0],
      });
    }
  }
  return out;
}

/**
 * The dragon the town is named for, asleep on the plain outside the wall.
 *
 * It is landscape, not a creature: geometry laid down once, costing nothing
 * per frame, and it reads only from height. What you see from the roof band
 * is a long low ridge with a bend in it, which anyone would take for a hill.
 * From the satellite band the bend resolves into coils, the ridge into a
 * spine of plates, the rounded end into a head lying along the ground, and
 * the two long banks either side of the shoulders into folded wings.
 *
 * The wings are what make it a dragon rather than a worm, and folded is the
 * only way to draw them here: a spread wing is a creature in flight, and this
 * one has not moved in a very long time. Folded, each is a spar lying back
 * along the body with the membrane pulled in behind it, which from overhead
 * is a long triangle with a straight leading edge. Four legs tucked under,
 * for the same reason.
 *
 * That is the whole trick and the reason it is built this way round. A
 * monster you are told about is set dressing. One you work out for yourself,
 * from a shape you had already stopped looking at, is the thing the place is
 * named after. So nothing here is announced: no glow, no markers, and the
 * town simply ignores it, because you do not point at the hill you grew up
 * beside.
 */
function wyrmStructures(rng: Rng, cityRadiusM: number): Structure[] {
  const out: Structure[] = [];
  // West of the town, out on the open plain between the wall and the
  // mountains. It was first laid to the south-west and its tail ran into the
  // sea, which reads as a drowned animal rather than a sleeping one.
  const centreX = -cityRadiusM * 1.12;
  const centreZ = -cityRadiusM * 0.1;
  const segments = 46;

  const at = (t: number): { x: number; z: number; radiusM: number } => {
    // One and a bit turns of a loosening spiral, tapering to the tail.
    const angle = -2.1 + t * 4.4;
    const coilM = cityRadiusM * (0.1 + 0.2 * t);
    return {
      x: centreX + Math.cos(angle) * coilM,
      z: centreZ + Math.sin(angle) * coilM,
      // Thickest a third of the way along, as a body is.
      radiusM: cityRadiusM * 0.062 * (0.4 + Math.sin(Math.min(1, t * 1.5) * Math.PI) * 0.9),
    };
  };

  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const here = at(t);
    const next = at(Math.min(1, t + 1 / (segments - 1)));
    const spanM = Math.max(1, Math.hypot(next.x - here.x, next.z - here.z));
    const rotY = -Math.atan2(next.z - here.z, next.x - here.x);
    // The body, buried to most of its depth: what shows is a bank of earth
    // with something under it. At half buried, and banded in two colours, it
    // read as a segmented caterpillar lying on a lawn. The banding is gone
    // and only the top fifth of it is above ground now.
    out.push({
      kind: 'box',
      x: here.x,
      y: -here.radiusM * 0.98,
      z: here.z,
      // Long enough that consecutive segments overlap round the curve, or
      // the turn opens a wedge of daylight at every joint.
      wM: spanM * 1.5,
      hM: here.radiusM * 1.42,
      dM: here.radiusM * 2,
      rotY,
      colour: WYRM.hide,
    });
    // The spine. Plates down the back, smaller towards the tail, and it is
    // these that stop the whole thing reading as a hedge.
    if (i % 3 === 0 && t > 0.04 && t < 0.9) {
      out.push({
        kind: 'gable',
        x: here.x,
        y: here.radiusM * 0.4,
        z: here.z,
        wM: here.radiusM * 0.34,
        hM: here.radiusM * (0.62 - t * 0.34),
        dM: here.radiusM * 0.8,
        rotY: rotY + Math.PI / 2,
        colour: WYRM.plate,
      });
    }
  }

  // Wings, folded back along the shoulders. The spar is the straight bone at
  // the leading edge; the membrane is the triangle behind it.
  const shoulder = at(0.14);
  const shoulderNext = at(0.2);
  const along = Math.atan2(shoulderNext.z - shoulder.z, shoulderNext.x - shoulder.x);
  for (const side of [-1, 1]) {
    // Swept back from the shoulder, not straight out: a folded wing lies
    // along the animal, and the angle is what says it is folded.
    const sweep = along + side * 0.44;
    // A folded wing is a thing lying against the animal, not a sail. At 7.5
    // times the body radius, spread wide and held clear of the ground, the
    // pair read as two planks somebody had left there.
    const spanM = shoulder.radiusM * 4.2;
    const midX = shoulder.x + Math.cos(sweep) * spanM * 0.5;
    const midZ = shoulder.z + Math.sin(sweep) * spanM * 0.5;
    // The membrane: a low flat triangle, thin enough to read as skin.
    out.push({
      kind: 'gable',
      x: midX,
      y: -shoulder.radiusM * 0.45,
      z: midZ,
      wM: spanM,
      hM: shoulder.radiusM * 0.95,
      dM: shoulder.radiusM * 1.5,
      rotY: -sweep,
      colour: WYRM.wing,
    });
    // The spar along its leading edge, raised, which is the hard line that
    // stops the whole thing reading as another bank of earth.
    const edgeX = midX - Math.sin(sweep) * side * shoulder.radiusM * 0.72;
    const edgeZ = midZ + Math.cos(sweep) * side * shoulder.radiusM * 0.72;
    out.push({
      kind: 'box',
      x: edgeX,
      y: -shoulder.radiusM * 0.08,
      z: edgeZ,
      wM: spanM * 0.96,
      hM: shoulder.radiusM * 0.26,
      dM: shoulder.radiusM * 0.2,
      rotY: -sweep,
      colour: WYRM.plate,
    });
  }

  // Four legs, tucked in against the body and mostly buried.
  for (const t of [0.19, 0.42]) {
    const hip = at(t);
    const hipNext = at(t + 0.05);
    const facingHip = Math.atan2(hipNext.z - hip.z, hipNext.x - hip.x);
    for (const side of [-1, 1]) {
      out.push({
        kind: 'box',
        x: hip.x - Math.sin(facingHip) * side * hip.radiusM * 1.5,
        y: -hip.radiusM * 0.75,
        z: hip.z + Math.cos(facingHip) * side * hip.radiusM * 1.5,
        wM: hip.radiusM * 1.9,
        hM: hip.radiusM * 1.1,
        dM: hip.radiusM * 1.25,
        rotY: -facingHip,
        colour: WYRM.hideDark,
      });
    }
  }

  // The head, lying along the ground at the outer end of the coil.
  const head = at(0);
  const brow = at(0.045);
  const facing = Math.atan2(head.z - brow.z, head.x - brow.x);
  const hx = head.x + Math.cos(facing) * head.radiusM * 2.4;
  const hz = head.z + Math.sin(facing) * head.radiusM * 2.4;
  out.push({
    kind: 'box',
    x: hx,
    y: -head.radiusM * 0.82,
    z: hz,
    wM: head.radiusM * 4.6,
    hM: head.radiusM * 1.7,
    dM: head.radiusM * 2.6,
    rotY: -facing,
    colour: WYRM.hideDark,
  });
  // The jaw, a shade longer and lower, so the head has a muzzle.
  out.push({
    kind: 'box',
    x: hx + Math.cos(facing) * head.radiusM * 1.9,
    y: -head.radiusM * 0.9,
    z: hz + Math.sin(facing) * head.radiusM * 1.9,
    wM: head.radiusM * 2.4,
    hM: head.radiusM * 1.05,
    dM: head.radiusM * 1.7,
    rotY: -facing,
    colour: WYRM.hide,
  });
  // Two horns, which is the detail that settles what it is.
  for (const side of [-1, 1]) {
    out.push({
      kind: 'gable',
      x: hx - Math.cos(facing) * head.radiusM * 0.9 - Math.sin(facing) * side * head.radiusM * 0.85,
      y: head.radiusM * 0.25,
      z: hz - Math.sin(facing) * head.radiusM * 0.9 + Math.cos(facing) * side * head.radiusM * 0.85,
      wM: head.radiusM * 0.45,
      hM: head.radiusM * 1.25,
      dM: head.radiusM * 0.45,
      rotY: -facing,
      colour: WYRM.plate,
    });
  }

  // A few broken standing stones along the coil. People have been coming out
  // here to leave things for a very long time.
  for (let i = 0; i < 9; i++) {
    const t = range(rng, 0.1, 0.95);
    const spot = at(t);
    const away = range(rng, 1.7, 3.1) * spot.radiusM;
    const angle = range(rng, 0, Math.PI * 2);
    out.push({
      kind: 'box',
      x: spot.x + Math.cos(angle) * away,
      y: 0,
      z: spot.z + Math.sin(angle) * away,
      wM: range(rng, 0.7, 1.5),
      hM: range(rng, 1.8, 3.6),
      dM: range(rng, 0.6, 1.2),
      rotY: range(rng, 0, Math.PI),
      colour: STONE.base,
    });
  }
  return out;
}

/** The keep: a square tower with four turrets, on a raised plinth. */
function keepStructures(): Structure[] {
  const k = MYTH.keep;
  const out: Structure[] = [];
  out.push({
    kind: 'flat',
    x: k.x,
    y: LAYER_Y.road + 0.06,
    z: k.z,
    wM: k.baseM * 2.1,
    hM: 1,
    dM: k.baseM * 2.1,
    rotY: 0,
    colour: STONE.base,
  });
  // The motte: a low bank, so the keep stands above the roofs around it.
  out.push({
    kind: 'box',
    x: k.x,
    y: 0,
    z: k.z,
    wM: k.baseM * 1.5,
    hM: 3.5,
    dM: k.baseM * 1.5,
    rotY: 0,
    colour: STONE.base,
  });
  out.push({
    kind: 'box',
    x: k.x,
    y: 3.5,
    z: k.z,
    wM: k.baseM,
    hM: k.heightM,
    dM: k.baseM,
    rotY: 0,
    colour: STONE.keep,
  });
  // Four turrets, one at each corner, each with its own cap. This is the
  // silhouette people mean when they say castle.
  const off = k.baseM / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tx = k.x + sx * off;
      const tz = k.z + sz * off;
      out.push({
        kind: 'box',
        x: tx,
        y: 3.5,
        z: tz,
        wM: k.turretM,
        hM: k.turretHeightM,
        dM: k.turretM,
        rotY: 0,
        colour: STONE.keep,
      });
      out.push({
        kind: 'roof',
        x: tx,
        y: 3.5 + k.turretHeightM,
        z: tz,
        wM: k.turretM * 1.35,
        hM: k.turretM * 1.9,
        dM: k.turretM * 1.35,
        rotY: 0,
        colour: SLATE[0] ?? 0x5c6068,
      });
    }
  }
  return out;
}

function* build(rng: Rng, terrain: TerrainSpec): EraBuild {
  const meanM = terrain.cityRadiusM * MYTH.wallShare;
  // Short blocks and narrow lanes: a town you can cross on foot in a minute.
  const shape = { pitchM: 34, streetWidthM: 6.5, avenueCount: 0, ringWidthM: 8 };
  const grid = buildRoadGraph(rng, terrain, shape);
  yield;
  const roads = cutAtWall(grid, meanM);
  yield;

  const keepClear = MYTH.keep.baseM * 1.3;
  const blocks = buildBlocks(terrain, shape).filter((block) => {
    if (!insideWall(block.x, block.z, meanM)) return false;
    // Nothing stands on the wall, in the market square, or on the keep.
    if (Math.hypot(block.x, block.z) > wallRadius(Math.atan2(block.z, block.x), meanM) - 9) {
      return false;
    }
    if (Math.max(Math.abs(block.x), Math.abs(block.z - MYTH.keep.z)) < keepClear) return false;
    return Math.hypot(block.x, block.z) > MYTH.marketM * 0.62;
  });
  yield;

  const lots = buildLots(rng, terrain, blocks, avenueCorridors(roads), MYTH_LOTS, terrain.cityRadiusM);

  // The temple, on the square, and the guild hall facing it. Lots rather than
  // scenery, so people walk to them and think their thoughts inside them.
  const placed: Lot[] = [];
  const add = (x: number, z: number, wM: number, dM: number, heightM: number, use: LotUse): void => {
    placed.push({ id: lots.length + placed.length, x, z, wM, dM, use, heightM, style: 'low', jitter: rng() });
  };
  add(-MYTH.marketM * 0.62, 8, 17, 26, 13, 'temple');
  add(MYTH.marketM * 0.66, 2, 20, 15, 9, 'work');
  add(0, MYTH.marketM * 0.7, 26, 11, 7, 'market');
  const all = [...lots, ...placed].map((lot, index) => ({ ...lot, id: index }));
  yield;

  const structures: Structure[] = [];
  // The square itself: beaten earth, kept clear.
  structures.push({
    kind: 'flat',
    x: 0,
    y: LAYER_Y.road + 0.04,
    z: 0,
    wM: MYTH.marketM,
    hM: 1,
    dM: MYTH.marketM * 0.8,
    rotY: 0,
    colour: 0x7a6e58,
  });
  structures.push(...wallStructures(meanM));
  yield;
  structures.push(...keepStructures());
  yield;
  structures.push(...wyrmStructures(rng, terrain.cityRadiusM));
  yield;

  structures.push(...buildRoofscape(rng, all, ROOF_STYLE));
  yield;
  structures.push(...buildStreetscape(rng, roads, all, STREET_STYLE));
  yield;
  structures.push(...buildFacade(rng, all, FACADE_STYLE));

  return { roads, lots: all, structures, cityRadiusM: terrain.cityRadiusM };
}

export const MYTH_ERA: Era = {
  id: 'myth',
  year: 'long ago',
  name: 'Wyrmrest',
  palette: PALETTE,
  lots: MYTH_LOTS,
  vehicles: VEHICLES,
  thoughts: MYTH_THOUGHTS,
  population: { people: ERA_POPULATION, vehicles: 150 },
  monsters: true,
  interior: {
    wall: 0xc4b89e,
    floor: 0x6b5540,
    core: 0x7d7a70,
    furniture: [TIMBER.mid, TIMBER.dark, 0x8c6b4a, 0x6f6d66, 0xa89878],
  },
  build,
};
