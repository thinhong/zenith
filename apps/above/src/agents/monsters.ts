import { Group, InstancedMesh } from 'three';
import type { ViewState } from '@/core/camera';
import { HUNT, IDLE, stepEngagement, strikePhase, type Engagement, type HuntRules } from '@/agents/hunt';
import { beastGeometry, heroGeometry, impGeometry } from '@/agents/monster-shapes';
import { AGENTS, drawRadius } from '@/state/altitude';
import type { RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';
import {
  attachInstanceColors,
  createTintedInstanceMaterial,
  markColorsChanged,
  markDynamic,
  paletteToLinear,
  writeInstanceMatrix,
} from '@/world/instanced';

/**
 * What lives in Wyrmrest besides the people.
 *
 * Three kinds, and the split is by where they are rather than by what they
 * are, because where a thing is is the only part of it a viewer can read from
 * four hundred metres:
 *
 * - **Imps** in the town, on the lanes, going about whatever imps go about.
 *   They use the road graph, walking node to node, so they never cross a wall
 *   or stand in somebody's parlour.
 * - **Beasts** on the plain outside the wall, wandering the open ground
 *   between the town and the mountains. They are why the wall is there.
 * - **Heroes** out on the same ground, looking for them.
 *
 * A hero who finds a beast closes on it, fights it for a few seconds, and the
 * beast breaks off and runs. The rules are in `hunt.ts`, pure and tested;
 * this file owns the positions and the meshes.
 *
 * Small pools, in the hundreds rather than the thousands, so none of this is
 * time-sliced and none of it needs a spatial index. The whole update is a few
 * hundred iterations and a pairing pass over the heroes.
 */

export const MONSTERS = {
  /**
   * How many of each, in an era that has them.
   *
   * The first try had 46 beasts and 26 heroes spread over a ring of more
   * than a square kilometre, which is one creature every hundred metres:
   * from the roof band the open ground looked empty and the hunt never
   * happened in shot. They are cheap, being a few hundred instances against
   * twelve thousand people, so there are enough of them to meet.
   */
  imps: 220,
  beasts: 110,
  heroes: 64,
  /** Metres per second. A beast is quick; a hero in armour is not. */
  impSpeed: { min: 0.9, max: 1.6 },
  beastSpeed: { min: 1.6, max: 2.6 },
  heroSpeed: { min: 1.3, max: 1.9 },
  /** How much faster a thing moves when it is chasing or running. */
  urgency: 1.7,
  /**
   * How tall each is. A beast has to be plainly bigger than a person or the
   * whole business reads as two people having an argument.
   */
  heightM: { imp: 1.2, beast: 2.4, hero: 1.85 },
  /**
   * The band of open ground the beasts and heroes use, as shares of the
   * settlement radius. Outside the wall, inside the mountains.
   */
  wildInner: 0.68,
  wildOuter: 1.08,
  /** How close a wanderer has to get before it picks somewhere new. */
  arriveM: 3,
  /** Above this altitude they are not drawn: the same rule the people follow. */
  maxAltitudeM: AGENTS.figuresMaxM,
} as const;

const RULES: HuntRules = {
  senseM: 46,
  engageM: 3.4,
  loseInterestM: 90,
  fightS: 5.5,
  fleeS: 4.5,
};

/** Imps are a sickly green, beasts a dark hide, heroes bright enough to find. */
const TINTS = {
  imp: [0x7a9a4a, 0x6b8c42, 0x8aa855, 0x5f7f3c],
  beast: [0x6b5a4a, 0x5a4a3c, 0x7a6752, 0x4f4236],
  hero: [0xc8563c, 0x3f6aa8, 0xc8a13c, 0x7a4aa8, 0xb84a72],
} as const;

export interface MonsterStats {
  imps: number;
  beasts: number;
  heroes: number;
  /** How many pairs are fighting right now. */
  fights: number;
  drawn: number;
  updateMs: number;
}

export interface Monsters {
  group: Group;
  stats: MonsterStats;
  update: (dtS: number, view: ViewState) => void;
}

export interface MonsterOptions {
  rng: Rng;
  graph: RoadGraph;
  cityRadiusM: number;
}

interface Wanderer {
  x: number;
  z: number;
  heading: number;
  speedMS: number;
  targetX: number;
  targetZ: number;
  tint: number;
  /** Road node it is walking to. Imps only. */
  node: number;
}

export function createMonsters(options: MonsterOptions): Monsters {
  const { rng, graph, cityRadiusM } = options;
  const group = new Group();
  group.name = 'monsters';

  const innerM = cityRadiusM * MONSTERS.wildInner;
  const outerM = cityRadiusM * MONSTERS.wildOuter;

  /** A point on the open ground outside the wall. */
  const wildSpot = (): { x: number; z: number } => {
    const angle = range(rng, 0, Math.PI * 2);
    const r = range(rng, innerM, outerM);
    return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
  };

  const imps: Wanderer[] = [];
  for (let i = 0; i < MONSTERS.imps; i++) {
    const node = Math.floor(rng() * graph.nodes.length);
    const at = graph.nodes[node];
    if (!at) continue;
    imps.push({
      x: at.x,
      z: at.z,
      heading: range(rng, 0, Math.PI * 2),
      speedMS: range(rng, MONSTERS.impSpeed.min, MONSTERS.impSpeed.max),
      targetX: at.x,
      targetZ: at.z,
      tint: Math.floor(rng() * TINTS.imp.length),
      node,
    });
  }

  const makeWild = (count: number, speed: { min: number; max: number }, tints: number): Wanderer[] => {
    const out: Wanderer[] = [];
    for (let i = 0; i < count; i++) {
      const at = wildSpot();
      const to = wildSpot();
      out.push({
        x: at.x,
        z: at.z,
        heading: range(rng, 0, Math.PI * 2),
        speedMS: range(rng, speed.min, speed.max),
        targetX: to.x,
        targetZ: to.z,
        tint: Math.floor(rng() * tints),
        node: -1,
      });
    }
    return out;
  };

  const beasts = makeWild(MONSTERS.beasts, MONSTERS.beastSpeed, TINTS.beast.length);
  const heroes = makeWild(MONSTERS.heroes, MONSTERS.heroSpeed, TINTS.hero.length);

  /** Which beast each hero is dealing with, and how far through it they are. */
  const quarry = new Int32Array(heroes.length).fill(-1);
  const engagements: Engagement[] = heroes.map(() => IDLE);

  const mesh = (geometry: ReturnType<typeof impGeometry>, capacity: number, name: string) => {
    const made = new InstancedMesh(geometry, createTintedInstanceMaterial(), capacity);
    made.name = name;
    made.count = 0;
    made.frustumCulled = false;
    made.castShadow = true;
    made.receiveShadow = true;
    markDynamic(made);
    const colours = attachInstanceColors(made, capacity);
    group.add(made);
    return { made, colours, matrices: made.instanceMatrix.array as Float32Array };
  };

  const impMesh = mesh(impGeometry(), Math.max(1, imps.length), 'monster-imps');
  const beastMesh = mesh(beastGeometry(), Math.max(1, beasts.length), 'monster-beasts');
  const heroMesh = mesh(heroGeometry(), Math.max(1, heroes.length), 'monster-heroes');

  const palettes = {
    imp: paletteToLinear(TINTS.imp),
    beast: paletteToLinear(TINTS.beast),
    hero: paletteToLinear(TINTS.hero),
  };

  const stats: MonsterStats = {
    imps: imps.length,
    beasts: beasts.length,
    heroes: heroes.length,
    fights: 0,
    drawn: 0,
    updateMs: 0,
  };

  /** Moves one wanderer towards its target and reports whether it arrived. */
  function walk(who: Wanderer, dtS: number, speedScale: number): boolean {
    const dx = who.targetX - who.x;
    const dz = who.targetZ - who.z;
    const gap = Math.hypot(dx, dz);
    if (gap < MONSTERS.arriveM) return true;
    const step = Math.min(gap, who.speedMS * speedScale * dtS);
    who.x += (dx / gap) * step;
    who.z += (dz / gap) * step;
    who.heading = Math.atan2(dz, dx);
    return false;
  }

  function updateImps(dtS: number): void {
    for (const imp of imps) {
      if (!walk(imp, dtS, 1)) continue;
      // Somewhere else on the lanes. Following an edge from where it stands
      // is what keeps it on the roads without any pathfinding at all.
      const touching = graph.adjacency[imp.node];
      if (!touching || touching.length === 0) continue;
      const edge = graph.edges[touching[Math.floor(rng() * touching.length)] ?? -1];
      if (!edge) continue;
      const next = edge.a === imp.node ? edge.b : edge.a;
      const at = graph.nodes[next];
      if (!at) continue;
      imp.node = next;
      imp.targetX = at.x;
      imp.targetZ = at.z;
    }
  }

  function updateHunt(dtS: number): void {
    stats.fights = 0;
    for (let h = 0; h < heroes.length; h++) {
      const hero = heroes[h];
      if (!hero) continue;
      let state = engagements[h] ?? IDLE;
      let target = quarry[h] ?? -1;

      // Nothing in hand: look for the nearest beast that is not already busy.
      if (state.hero === HUNT.roam && state.beast === HUNT.roam) {
        target = -1;
        let bestD = RULES.senseM;
        for (let b = 0; b < beasts.length; b++) {
          const beast = beasts[b];
          if (!beast) continue;
          const d = Math.hypot(beast.x - hero.x, beast.z - hero.z);
          if (d < bestD) {
            bestD = d;
            target = b;
          }
        }
      }

      const beast = target >= 0 ? beasts[target] : undefined;
      const distanceM = beast ? Math.hypot(beast.x - hero.x, beast.z - hero.z) : Infinity;
      state = stepEngagement(state, distanceM, dtS, RULES, beast !== undefined);
      engagements[h] = state;
      quarry[h] = state.hero === HUNT.roam && state.beast === HUNT.roam ? -1 : target;

      if (!beast) {
        if (walk(hero, dtS, 1)) {
          const to = wildSpot();
          hero.targetX = to.x;
          hero.targetZ = to.z;
        }
        continue;
      }

      if (state.hero === HUNT.hunt) {
        hero.targetX = beast.x;
        hero.targetZ = beast.z;
        walk(hero, dtS, MONSTERS.urgency);
        // The beast keeps wandering: it has not noticed yet. That half second
        // of the hero closing on something oblivious is the whole chase.
        if (walk(beast, dtS, 1)) {
          const to = wildSpot();
          beast.targetX = to.x;
          beast.targetZ = to.z;
        }
      } else if (state.hero === HUNT.fight) {
        stats.fights++;
        // Locked together, facing each other, lunging on the strike clock.
        const phase = strikePhase(state, RULES);
        const angle = Math.atan2(beast.z - hero.z, beast.x - hero.x);
        const reach = 0.5 + phase * 0.7;
        const midX = (hero.x + beast.x) / 2;
        const midZ = (hero.z + beast.z) / 2;
        hero.x = midX - Math.cos(angle) * reach;
        hero.z = midZ - Math.sin(angle) * reach;
        beast.x = midX + Math.cos(angle) * reach;
        beast.z = midZ + Math.sin(angle) * reach;
        hero.heading = angle;
        beast.heading = angle + Math.PI;
      } else if (state.beast === HUNT.flee) {
        // Straight away from the hero, as fast as it can.
        const away = Math.atan2(beast.z - hero.z, beast.x - hero.x);
        beast.targetX = beast.x + Math.cos(away) * 120;
        beast.targetZ = beast.z + Math.sin(away) * 120;
        walk(beast, dtS, MONSTERS.urgency);
        if (walk(hero, dtS, 1)) {
          const to = wildSpot();
          hero.targetX = to.x;
          hero.targetZ = to.z;
        }
      }
    }

    // Whatever nobody is dealing with goes on wandering.
    const busy = new Set<number>();
    for (let h = 0; h < heroes.length; h++) {
      const target = quarry[h] ?? -1;
      if (target >= 0) busy.add(target);
    }
    for (let b = 0; b < beasts.length; b++) {
      if (busy.has(b)) continue;
      const beast = beasts[b];
      if (!beast) continue;
      if (walk(beast, dtS, 1)) {
        const to = wildSpot();
        beast.targetX = to.x;
        beast.targetZ = to.z;
      }
    }
  }

  /** Writes whichever of a list are near enough to be worth drawing. */
  function draw(
    target: { made: InstancedMesh; colours: Float32Array; matrices: Float32Array },
    list: readonly Wanderer[],
    palette: Float32Array,
    scale: number,
    view: ViewState,
    radiusSquared: number,
  ): number {
    let slot = 0;
    for (const who of list) {
      const dx = who.x - view.targetX;
      const dz = who.z - view.targetZ;
      if (dx * dx + dz * dz > radiusSquared) continue;
      // Local +x is the front, so the heading is negated (see instanced.ts).
      writeInstanceMatrix(target.matrices, slot, who.x, 0, who.z, -who.heading, scale, scale, scale);
      const source = who.tint * 3;
      target.colours[slot * 3] = palette[source] ?? 0.5;
      target.colours[slot * 3 + 1] = palette[source + 1] ?? 0.5;
      target.colours[slot * 3 + 2] = palette[source + 2] ?? 0.5;
      slot++;
    }
    target.made.count = slot;
    target.made.instanceMatrix.needsUpdate = true;
    markColorsChanged(target.made);
    return slot;
  }

  return {
    group,
    stats,
    update: (dtS, view) => {
      const started = performance.now();
      updateImps(dtS);
      updateHunt(dtS);

      const show = view.altitudeM < MONSTERS.maxAltitudeM;
      impMesh.made.visible = show;
      beastMesh.made.visible = show;
      heroMesh.made.visible = show;
      if (!show) {
        stats.drawn = 0;
        stats.updateMs = performance.now() - started;
        return;
      }

      const radius = drawRadius(view.altitudeM);
      const radiusSquared = radius * radius;
      stats.drawn =
        draw(impMesh, imps, palettes.imp, MONSTERS.heightM.imp, view, radiusSquared) +
        draw(beastMesh, beasts, palettes.beast, MONSTERS.heightM.beast, view, radiusSquared) +
        draw(heroMesh, heroes, palettes.hero, MONSTERS.heightM.hero, view, radiusSquared);
      stats.updateMs = performance.now() - started;
    },
  };
}
