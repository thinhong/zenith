import { Color, type PerspectiveCamera, Vector3 } from 'three';
import type { Actor } from '@/character/actor';
import { blendFrames, cycleLength, sitPose, standPose, walkPose } from '@/character/poses';
import type { Post } from '@/core/post';
import { clamp01, easeInOut, lerp, lerp3, smoothstep, type Vec3 } from '@/film/ease';
import { SHOTS, type Shot } from '@/film/script';
import { bodyAt, faceAt, gazeAt, MARKS, ROOM, SEATS, type BodyState, type GazeTarget } from '@/film/stage';
import { darkness, locate } from '@/film/timeline';
import { lookAt } from '@/life/age';
import { paletteFor } from '@/life/lives';
import { seasonAt, skyAt } from '@/life/sky';
import type { Room } from '@/room/room';
import type { SoulLight } from '@/soul/light';
import { soulAt } from '@/soul/path';

/**
 * Plays the film. Everything it decides comes from the pure modules: which
 * shot (film/timeline), where she is (film/stage), how old she looks
 * (life/age), the light and the season (life/sky), the pose
 * (character/poses) and the light that leaves her (soul/path). This file only
 * hands the answers to the camera, the room, the model and the picture.
 *
 * The order inside a frame matters: the body is posed, then the hands are put
 * where they belong, then the head turns to what she looks at, and only then
 * does the model copy its pose to the skin. Anything done after that copy
 * shows a frame late, or not at all.
 */
export interface Director {
  /** Moves the film to `timeS` and sets up everything on screen for it. */
  show: (timeS: number, dtS: number) => void;
  info: () => string;
}

export interface DirectorParts {
  camera: PerspectiveCamera;
  actor: Actor;
  room: Room;
  soul: SoulLight;
  post: Post;
  firstLife: number;
  reducedMotion: boolean;
  /** A camera placed by hand, for looking at the set (settings `?view=`). */
  view: { pos: readonly [number, number, number]; look: readonly [number, number, number]; fovDeg: number } | null;
}

const BREATH_S = 4.2;
const SWAY_S = 9.5;

/** How far a thigh swings in a step: long when young, short when old. */
function strideFor(pace: number): number {
  return lerp(0.2, 0.38, clamp01((pace - 0.55) / 0.45));
}

export function createDirector(parts: DirectorParts): Director {
  const { camera, actor, room, soul, post } = parts;
  const head = new Vector3();
  const chest = new Vector3();
  const aim = new Vector3();
  const target = new Vector3();
  const from = new Vector3();
  const soulPos = new Vector3();
  const hand = new Vector3();
  const pole = new Vector3();
  const grade = new Color();
  const night = new Color(0.9, 0.96, 1.1);
  let last = '';
  let lastCut = '';

  const point = (at: GazeTarget | null, out: Vector3): Vector3 | null => {
    if (at === null) return null;
    if (at === 'camera') return out.copy(camera.position);
    return out.set(at[0], at[1], at[2]);
  };

  const gazeTarget = (shot: Shot, localS: number, hour: number): Vector3 | null => {
    if (shot.deskHeadFollowsDay === true) {
      // In the time-lapse she looks up to the window in the evening of each day.
      const evening = Math.sin(((hour % 24) / 24) * Math.PI * 2 - 1.2) > 0.35;
      return point(evening ? MARKS.window : MARKS.desk, target);
    }
    const g = gazeAt(shot.gaze, localS, 0.7);
    const to = point(g.to, target);
    if (!to) return null;
    const was = point(g.from, from);
    if (!was || g.k >= 1) return to;
    return was.lerp(to, g.k);
  };

  /**
   * A point beside, above or ahead of her, in metres, turned the way she faces.
   * In her own frame she faces +z and her left is +x.
   */
  const around = (body: BodyState, left: number, up: number, ahead: number, out: Vector3): Vector3 => {
    const s = Math.sin(body.yaw);
    const c = Math.cos(body.yaw);
    return out.set(body.x + left * c + ahead * s, up, body.z - left * s + ahead * c);
  };
  const aroundDir = (body: BodyState, left: number, up: number, ahead: number, out: Vector3): Vector3 => {
    const s = Math.sin(body.yaw);
    const c = Math.cos(body.yaw);
    return out.set(left * c + ahead * s, up, -left * s + ahead * c).normalize();
  };

  /** Where her hands rest: on the desk, in her lap, on the window sill. */
  const placeHands = (shot: Shot, body: BodyState, timeS: number, writing: boolean): void => {
    if (body.seat !== null && body.sit > 0.05) {
      const w = smoothstep(0.35, 1, body.sit);
      if (SEATS[body.seat].kind === 'desk') {
        const wx = writing ? Math.sin(timeS * 7.1) * 0.012 : 0;
        const wz = writing ? Math.cos(timeS * 5.3) * 0.01 : 0;
        actor.reach('left', around(body, 0.14, ROOM.desk.heightM + 0.035, 0.46, hand), aroundDir(body, 0.9, -0.6, -0.35, pole), w);
        actor.reach('right', around(body, -0.07 + wx, ROOM.desk.heightM + 0.035, 0.44 + wz, hand), aroundDir(body, -0.9, -0.6, -0.35, pole), w);
      } else {
        actor.reach('left', around(body, 0.1, 0.6, 0.3, hand), aroundDir(body, 1, -0.3, -0.7, pole), w);
        actor.reach('right', around(body, -0.1, 0.6, 0.3, hand), aroundDir(body, -1, -0.3, -0.7, pole), w);
      }
      return;
    }
    if (shot.id === 'child') {
      // Both hands on the sill while she faces the window; they come away as she turns.
      const facing = Math.max(0, -Math.cos(body.yaw)) ** 4;
      const sillY = ROOM.window.sillM + 0.03;
      const sillZ = ROOM.backZ + 0.13;
      actor.reach('left', hand.set(body.x - 0.09, sillY, sillZ), aroundDir(body, 0.7, -1, -0.2, pole), facing);
      actor.reach('right', hand.set(body.x + 0.09, sillY, sillZ), aroundDir(body, -0.7, -1, -0.2, pole), facing);
    }
  };

  return {
    show: (timeS, dtS) => {
      const placed = locate(SHOTS, timeS);
      const { shot, localS, progress } = placed;
      last = `${shot.id} ${localS.toFixed(1)}s  t=${timeS.toFixed(1)}  life ${parts.firstLife + placed.life}`;

      const age = lerp(shot.age[0], shot.age[1], progress);
      const look = lookAt(age);
      const hour = lerp(shot.hour[0], shot.hour[1], progress);
      const year = lerp(shot.year[0], shot.year[1], progress);
      const sky = shot.lampOff === true ? { ...skyAt(hour), lamp: 0 } : skyAt(hour);
      const season = seasonAt(year);
      // The tree outside is a sapling in her childhood and full grown by her old age.
      const growth = smoothstep(4, 70, age);
      room.update({ sky, season, growth, wind: shot.wind, hour }, timeS);

      // --- where the camera stands --------------------------------------------
      const k = shot.camera.to ? easeInOut(progress) : 0;
      const end = shot.camera.to ?? shot.camera.from;
      const pos = lerp3(shot.camera.from.pos, end.pos, k);
      const lookPoint = lerp3(shot.camera.from.look, end.look, k);
      const drift = parts.reducedMotion ? 0 : shot.camera.drift;
      camera.position.set(
        pos[0] + drift * Math.sin(timeS * 0.31),
        pos[1] + drift * Math.sin(timeS * 0.23 + 1),
        pos[2] + drift * Math.sin(timeS * 0.17 + 2),
      );
      camera.fov = lerp(shot.camera.from.fovDeg, end.fovDeg, k);

      // --- the person -----------------------------------------------------------
      actor.setVisible(shot.empty !== true);
      const body = bodyAt(shot.body, localS, shot.durationS);
      actor.root.position.set(body.x, 0, body.z);
      actor.root.rotation.y = body.yaw;
      const still = shot.still === true;
      const breath = still ? 0 : Math.sin((timeS / BREATH_S) * Math.PI * 2);
      const sway = still ? 0 : Math.sin((timeS / SWAY_S) * Math.PI * 2);
      const stand = standPose({ breath, sway, stoop: look.stoop });
      const stride = strideFor(look.pace);
      const walk = walkPose({ phase: body.travelledM / cycleLength(stride), stride, stoop: look.stoop });
      let frame = blendFrames(stand, walk, body.walk);
      const lookingDown = shot.deskHeadFollowsDay === true || shot.gaze.at(-1)?.at === MARKS.desk;
      if (body.seat !== null && body.sit > 0) {
        const seat = SEATS[body.seat];
        const seated = sitPose({
          kind: seat.kind,
          seatM: seat.heightM,
          legs: actor.legs,
          breath,
          stoop: look.stoop,
          write: 0,
          headUp: 1,
        });
        frame = blendFrames(frame, seated, body.sit);
      }
      actor.pose(frame);
      placeHands(shot, body, timeS, lookingDown && !still);
      const gazeWeight = 1 - body.walk * 0.55;
      actor.gaze(shot.empty === true ? null : gazeTarget(shot, localS, hour), gazeWeight);
      actor.face(faceAt(shot.face, localS), timeS, look.pace, still);
      actor.look(look, paletteFor(parts.firstLife + placed.life));
      actor.wind(shot.wind, timeS);
      const cut = `${placed.life}:${placed.index}`;
      if (cut !== lastCut) {
        lastCut = cut;
        actor.update(0);
        actor.resetPhysics();
      }
      actor.update(dtS);

      // --- the light that leaves her ------------------------------------------------
      const soulS = localS + (shot.soulOffsetS ?? 0);
      if (shot.soul === true) {
        actor.chestWorld(chest);
        const s = soulAt([chest.x, chest.y + 0.05, chest.z], soulS);
        soulPos.set(s.pos[0], s.pos[1], s.pos[2]);
        // It lights the room only once it has risen clear of her, or it blinds her.
        soul.place(soulPos, s.glow, smoothstep(0.2, 0.55, soulPos.y - chest.y));
      } else {
        soul.hide();
      }

      // --- where the camera looks -----------------------------------------------
      aim.set(lookPoint[0], lookPoint[1], lookPoint[2]);
      if (shot.camera.followSoul === true) {
        // The lens leaves her and follows the light once it has risen.
        aim.lerp(soulPos, smoothstep(1.2, 4.0, soulS));
      }
      aim.x += drift * 0.5 * Math.sin(timeS * 0.27 + 3);
      aim.y += drift * 0.5 * Math.sin(timeS * 0.19 + 4);
      if (parts.view) {
        camera.position.set(parts.view.pos[0], parts.view.pos[1], parts.view.pos[2]);
        aim.set(parts.view.look[0], parts.view.look[1], parts.view.look[2]);
        camera.fov = parts.view.fovDeg;
      }
      camera.lookAt(aim);
      camera.updateProjectionMatrix();

      // --- the picture -----------------------------------------------------------
      let focusM: number;
      let spreadM: number;
      if ((shot.focus === 'face' || shot.focus === 'soul') && shot.empty !== true) {
        actor.headWorld(head);
        // Focus moves from her face to the light as it rises.
        const onSoul = shot.focus === 'soul' ? smoothstep(0.8, 3.0, soulS) : 0;
        focusM = lerp(camera.position.distanceTo(head), camera.position.distanceTo(soulPos), onSoul);
        spreadM = Math.max(0.35, focusM * 0.6);
      } else {
        const f: Vec3 = typeof shot.focus === 'string' ? MARKS.window : shot.focus;
        focusM = camera.position.distanceTo(head.set(f[0], f[1], f[2]));
        spreadM = Math.max(1.2, focusM * 1.1);
      }
      post.setFocus(focusM, spreadM);

      const warmth = clamp01((sky.sunColour[0] - sky.sunColour[2]) * 2.2) * Math.min(1, sky.sun);
      grade.setRGB(1.02 + warmth * 0.06, 1.0 - warmth * 0.01, 0.97 - warmth * 0.08);
      grade.lerp(night, sky.night * 0.8);
      post.setGrade(grade);
      post.setDarkness(darkness(placed));
    },
    info: () => last,
  };
}
