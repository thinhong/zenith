import { AmbientLight, Color, DirectionalLight, Fog, SRGBColorSpace, Scene } from 'three';
import { fogRange } from '@/state/altitude';
import { advanceClock, createClock, type Clock } from '@/state/clock';
import { createGround } from '@/world/ground';
import { createRoadMesh } from '@/world/road-mesh';
import { buildRoadGraph, type RoadGraph } from '@/world/roads';
import { mulberry32 } from '@/world/seed';
import { skyAt, type Rgb } from '@/world/sky';
import { buildTerrain, type TerrainSpec } from '@/world/terrain';

/**
 * Assembles one world from a seed and keeps it in step with altitude and the
 * day clock. Systems never talk to each other; they all read the same two
 * inputs (PLAN.md 4.1).
 */
export interface World {
  scene: Scene;
  clock: Clock;
  terrain: TerrainSpec;
  roads: RoadGraph;
  update: (dtS: number, elapsedS: number, altitudeM: number) => void;
  /** One line for the debug HUD. */
  info: () => string;
}

export interface WorldOptions {
  seed: number;
  /** Pin the clock instead of running it (debug, see state/settings.ts). */
  fixedHour: number | null;
}

/** The sun is directional, so this only has to sit outside the world. */
const SUN_DISTANCE_M = 6000;

export function createWorld({ seed, fixedHour }: WorldOptions): World {
  const rng = mulberry32(seed);
  const terrain = buildTerrain(rng);
  const roads = buildRoadGraph(rng, terrain);

  const scene = new Scene();
  const background = new Color();
  const fog = new Fog(background, 1000, 6000);
  scene.background = background;
  scene.fog = fog;

  const ambient = new AmbientLight(0xffffff, 0.6);
  const sun = new DirectionalLight(0xffffff, 1.2);
  scene.add(ambient, sun, createGround(terrain), createRoadMesh(roads));

  const clock = createClock(fixedHour ?? undefined);
  clock.paused = fixedHour !== null;

  return {
    scene,
    clock,
    terrain,
    roads,
    update: (dtS, _elapsedS, altitudeM) => {
      advanceClock(clock, dtS);
      const sky = skyAt(clock.hourOfDay);

      applyRgb(background, sky.sky);
      applyRgb(fog.color, sky.fog);
      const range = fogRange(altitudeM);
      fog.near = range.nearM;
      fog.far = range.farM;

      sun.position.set(
        sky.sunDir.x * SUN_DISTANCE_M,
        sky.sunDir.y * SUN_DISTANCE_M,
        sky.sunDir.z * SUN_DISTANCE_M,
      );
      applyRgb(sun.color, sky.sunColor);
      sun.intensity = sky.sunIntensity;
      applyRgb(ambient.color, sky.ambientColor);
      ambient.intensity = sky.ambientIntensity;
    },
    info: () =>
      `seed: ${seed}  water: ${terrain.water.kind}  roads: ${roads.edges.length}\n` +
      `hour: ${formatHour(clock.hourOfDay)}${clock.paused ? ' (paused)' : ''}`,
  };
}

function applyRgb(target: Color, rgb: Rgb): void {
  target.setRGB(rgb.r, rgb.g, rgb.b, SRGBColorSpace);
}

function formatHour(hourOfDay: number): string {
  const h = Math.floor(hourOfDay);
  const m = Math.floor((hourOfDay - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
