import { Color, DirectionalLight, Fog, HemisphereLight, SRGBColorSpace, Scene } from 'three';
import { DETAIL, detailFactor, fogRange } from '@/state/altitude';
import type { ViewState } from '@/core/camera';
import { advanceClock, createClock, type Clock } from '@/state/clock';
import { createBuildings } from '@/world/buildings';
import { createGround } from '@/world/ground';
import { avenueCorridors, buildBlocks, buildLots, type Lot } from '@/world/lots';
import { createProps } from '@/world/props';
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
  lots: readonly Lot[];
  update: (dtS: number, elapsedS: number, view: ViewState) => void;
  /** One line for the debug HUD. */
  info: () => string;
}

export interface WorldOptions {
  seed: number;
  /** Pin the clock instead of running it (debug, see state/settings.ts). */
  fixedHour: number | null;
}

/**
 * The sun is directional, so this distance only decides where its shadow camera
 * sits. Close enough to keep the depth range tight, far enough to clear the
 * tallest tower.
 */
const SUN_DISTANCE_M = 1400;

/**
 * Shadows are expensive and invisible from altitude, so one small, sharp map
 * follows the viewer and switches off above the roof band (PLAN.md 5).
 */
const SHADOW = { mapSize: 1024, extentM: 280, nearM: 200, farM: 2800 } as const;

export function createWorld({ seed, fixedHour }: WorldOptions): World {
  const rng = mulberry32(seed);
  const terrain = buildTerrain(rng);
  const roads = buildRoadGraph(rng, terrain);
  const lots = buildLots(rng, terrain, buildBlocks(terrain), avenueCorridors(roads));

  const scene = new Scene();
  const background = new Color();
  const fog = new Fog(background, 1000, 6000);
  scene.background = background;
  scene.fog = fog;

  // A hemisphere light rather than a flat ambient: the vertical faces of a
  // tower need sky light from above, or a city at noon reads as a black mass.
  const ambient = new HemisphereLight(0xffffff, 0xffffff, 0.6);
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
  sun.shadow.camera.left = -SHADOW.extentM;
  sun.shadow.camera.right = SHADOW.extentM;
  sun.shadow.camera.top = SHADOW.extentM;
  sun.shadow.camera.bottom = -SHADOW.extentM;
  sun.shadow.camera.near = SHADOW.nearM;
  sun.shadow.camera.far = SHADOW.farM;
  sun.shadow.bias = -0.0009;
  // Not pitch black in shadow: bounced light fills a real street.
  sun.shadow.intensity = 0.75;
  const buildings = createBuildings(lots);
  const props = createProps(rng, terrain, roads, lots);
  scene.add(
    ambient,
    sun,
    sun.target,
    createGround(terrain),
    createRoadMesh(roads),
    buildings.group,
    props.group,
  );
  castAndReceive(scene);

  // Hysteresis: crossing the threshold rebuilds shaders, so do not let a small
  // wobble at 300 m toggle it every frame.
  let shadowsOn = false;

  const clock = createClock(fixedHour ?? undefined);
  clock.paused = fixedHour !== null;

  return {
    scene,
    clock,
    terrain,
    roads,
    lots,
    update: (dtS, _elapsedS, view) => {
      const altitudeM = view.altitudeM;
      advanceClock(clock, dtS);
      const sky = skyAt(clock.hourOfDay);

      applyRgb(background, sky.sky);
      applyRgb(fog.color, sky.fog);
      const range = fogRange(altitudeM);
      fog.near = range.nearM;
      fog.far = range.farM;

      sun.target.position.set(view.targetX, 0, view.targetZ);
      sun.target.updateMatrixWorld();
      sun.position.set(
        view.targetX + sky.sunDir.x * SUN_DISTANCE_M,
        sky.sunDir.y * SUN_DISTANCE_M,
        view.targetZ + sky.sunDir.z * SUN_DISTANCE_M,
      );

      if (shadowsOn && altitudeM > DETAIL.shadowMaxM + DETAIL.shadowHysteresisM) shadowsOn = false;
      else if (!shadowsOn && altitudeM < DETAIL.shadowMaxM - DETAIL.shadowHysteresisM) shadowsOn = true;
      sun.castShadow = shadowsOn;
      applyRgb(sun.color, sky.sunColor);
      sun.intensity = sky.sunIntensity;
      applyRgb(ambient.color, sky.ambientColor);
      applyRgb(ambient.groundColor, sky.bounceColor);
      ambient.intensity = sky.ambientIntensity;

      buildings.setNight(sky.nightFactor);
      buildings.setDetail(detailFactor(DETAIL.windows, altitudeM));
      props.setNight(sky.nightFactor);
      props.setDetail(detailFactor(DETAIL.props, altitudeM));
    },
    info: () =>
      `seed: ${seed}  water: ${terrain.water.kind}\n` +
      `roads: ${roads.edges.length}  buildings: ${buildings.count}\n` +
      `trees: ${props.treeCount}  lamps: ${props.lampCount}\n` +
      `hour: ${formatHour(clock.hourOfDay)}${clock.paused ? ' (paused)' : ''}`,
  };
}

/** Everything in the world casts and receives; the light decides when it matters. */
function castAndReceive(scene: Scene): void {
  scene.traverse((object) => {
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

function applyRgb(target: Color, rgb: Rgb): void {
  target.setRGB(rgb.r, rgb.g, rgb.b, SRGBColorSpace);
}

function formatHour(hourOfDay: number): string {
  const h = Math.floor(hourOfDay);
  const m = Math.floor((hourOfDay - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
