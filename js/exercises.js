/* Rep detection: joint-angle math and a state machine per exercise.

   The camera sits on the floor, tilted up at the player, and the feet may be out
   of frame. Facing the camera from that low, steep view, flat 2D angles are
   distorted, so standing moves (squats, punches) take joint angles from
   MediaPipe's 3D world landmarks. Floor moves (push-ups, planks) are done side-on,
   where the flat image shows the true angles and is steadier than the 3D
   estimate, which is unreliable for a body lying down. */

import { PLANK_TICK } from "./config.js";
import { recordRep } from "./game.js";
import { resetMotion, settings, state } from "./state.js";

const visible = (p) => p && (p.visibility ?? 1) >= .5;
export function joint(landmarks, index) { const p = landmarks[index]; return visible(p) ? p : null; }
function minimumVisibility(...landmarks) { return Math.min(...landmarks.map((p) => p?.visibility ?? 0)); }
function angle(a, b, c, aspect = 1) {
  const ax = (a.x - b.x) * aspect, ay = a.y - b.y;
  const cx = (c.x - b.x) * aspect, cy = c.y - b.y;
  const cosine = (ax * cx + ay * cy) / (Math.hypot(ax, ay) * Math.hypot(cx, cy));
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}
function angle3(a, b, c) {
  const u = [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)];
  const v = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)];
  const cosine = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}
function smooth(tracker, value) {
  tracker.angles.push(value);
  if (tracker.angles.length > 5) tracker.angles.shift();
  tracker.angle = tracker.angles.reduce((sum, n) => sum + n, 0) / tracker.angles.length;
  return tracker.angle;
}
// The better-seen side's landmark ids, or null if any of them is out of view.
function bestSide(landmarks, left, right) {
  const score = (side) => side.reduce((sum, i) => sum + (landmarks[i]?.visibility ?? 0), 0);
  const chosen = score(left) >= score(right) ? left : right;
  return chosen.every((i) => joint(landmarks, i)) ? chosen : null;
}
// The angle at the middle joint, in 3D when world landmarks are available.
function jointAngle(landmarks, world, [a, b, c], aspect) {
  if (world?.[a] && world[b] && world[c]) return angle3(world[a], world[b], world[c]);
  return flatAngle(landmarks, [a, b, c], aspect);
}
// The angle at the middle joint as the camera image shows it.
function flatAngle(landmarks, [a, b, c], aspect) {
  return angle(landmarks[a], landmarks[b], landmarks[c], aspect);
}

// Squats use the 3D knee angle when the whole leg is visible. With the feet out
// of frame they use the 3D hip angle (shoulder–hip–knee), which closes just as
// clearly in a squat; with no legs at all, how far the shoulders drop below
// standing height, in shoulder widths. Each rep keeps the method it started with.
// Depth alone sets the quality: a tilted-up camera can't judge forward lean.
export function processSquat(index, landmarks, world, aspect, now) {
  const t = state.trackers[index];
  const leg = bestSide(landmarks, [23,25,27], [24,26,28]);
  const hips = bestSide(landmarks, [11,23,25], [12,24,26]);
  const torso = shoulderDrop(t, landmarks, aspect);
  if (t.phase === "UP") {
    const method = leg ? "legs" : hips ? "hips" : torso ? "torso" : null;
    if (method !== t.method) { t.angles = []; t.method = method; t.unit = method === "torso" ? "×" : "°"; }
  }
  if (t.method === "legs" && leg) {
    t.visibility = minimumVisibility(...leg.map((i) => landmarks[i]));
    squatRep(t, index, smooth(t, jointAngle(landmarks, world, leg, aspect)), 120, 160, 100, now);
  } else if (t.method === "hips" && hips) {
    t.visibility = minimumVisibility(...hips.map((i) => landmarks[i]));
    squatRep(t, index, smooth(t, jointAngle(landmarks, world, hips, aspect)), 135, 160, 105, now);
  } else if (t.method === "torso" && torso) {
    t.visibility = torso.visibility;
    // Measured the other way round: depth grows as the player goes down.
    squatRep(t, index, -smooth(t, torso.depth), -.45, -.2, -.8, now);
  } else t.visibility = 0;
}
// `value` falls as the player squats: down below `down`, back up above `up`,
// and clean if it got below `clean`. Sensitivity eases all three.
function squatRep(t, index, value, down, up, clean, now) {
  const ease = settings.sensitivity * (down > 0 ? 1 : .01);
  if (t.phase === "UP" && value < down + ease) { t.phase = "DOWN"; t.minAngle = value; }
  else if (t.phase === "DOWN") {
    t.minAngle = Math.min(t.minAngle, value);
    if (value > up - ease * .25) {
      t.phase = "UP";
      if (now - t.lastRepAt >= 400) recordRep(index, t.minAngle < clean + ease * .5 ? "clean" : "ok");
    }
  }
}
// Standing height follows the highest recent shoulder position, drifting down
// slowly while standing so stepping toward or away from the camera is absorbed.
function shoulderDrop(t, landmarks, aspect) {
  const ls = joint(landmarks, 11), rs = joint(landmarks, 12);
  if (!ls || !rs) return null;
  const width = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
  if (width < .05) return null;
  const y = (ls.y + rs.y) / 2;
  if (t.phase === "UP") t.topY = t.topY === null ? y : Math.min(y, t.topY + .0005);
  return { depth: (y - t.topY) / width, visibility: minimumVisibility(ls, rs) };
}

// Jumping jacks need the hands to go above the head and back below the
// shoulders. When the feet are visible they must also spread and close.
export function processJack(index, landmarks, now) {
  const t = state.trackers[index];
  const upper = [0,11,12,15,16].map((i) => joint(landmarks, i));
  if (upper.some((p) => !p)) { t.visibility = 0; return; }
  const [nose, ls, rs, lw, rw] = upper;
  const la = joint(landmarks, 27), ra = joint(landmarks, 28);
  const feet = la && ra;
  t.visibility = minimumVisibility(...upper, ...(feet ? [la, ra] : []));
  const shoulderWidth = Math.abs(ls.x - rs.x);
  if (shoulderWidth < .02) return;
  const feetRatio = feet ? Math.abs(la.x - ra.x) / shoulderWidth : null;
  const armsHigh = lw.y < nose.y && rw.y < nose.y;
  const fullyHigh = lw.y < nose.y - .07 && rw.y < nose.y - .07;
  const armsDown = lw.y > ls.y && rw.y > rs.y;
  const feetApart = !feet || feetRatio > 1.55 - settings.sensitivity * .01;
  const feetTogether = !feet || feetRatio < 1.35;
  const wide = fullyHigh && (!feet || feetRatio > 1.9);
  t.angle = feet ? feetRatio : null;
  t.unit = "×";
  if (t.phase === "UP" && armsHigh && feetApart) {
    t.phase = "DOWN";
    t.cleanJack = wide;
  } else if (t.phase === "DOWN") {
    t.cleanJack ||= wide;
    if (armsDown && feetTogether) {
      t.phase = "UP";
      if (now - t.lastRepAt >= 400) recordRep(index, t.cleanJack ? "clean" : "ok");
    }
  }
}
// Push-ups and planks are done side-on to the floor camera, so they use the flat
// image angles. Body straightness runs to the ankle, or the knee if the feet are
// out of frame.
export function processPushup(index, landmarks, aspect, now) {
  const t = state.trackers[index];
  const arm = bestSide(landmarks, [11,13,15], [12,14,16]);
  if (!arm) { if (!pushupBelowFrame(index, now)) t.visibility = 0; return; }
  t.visibility = minimumVisibility(...arm.map((i) => landmarks[i]));
  const value = smooth(t, flatAngle(landmarks, arm, aspect));
  t.unit = "°";
  // With neither the ankle nor the knee in view, form is judged on depth alone.
  const left = arm[0] === 11;
  const [hip, knee, ankle] = left ? [23, 25, 27] : [24, 26, 28];
  const line = (end) => flatAngle(landmarks, [arm[0], hip, end], aspect);
  const straight = !joint(landmarks, hip) ? true : joint(landmarks, ankle) ? line(ankle) > 155 : joint(landmarks, knee) ? line(knee) > 150 : true;
  // Only a body that's roughly level is doing a push-up; standing up never scores one.
  const shoulder = landmarks[arm[0]], hipPoint = joint(landmarks, hip);
  const level = !hipPoint || Math.atan2(Math.abs(shoulder.y - hipPoint.y), Math.abs(shoulder.x - hipPoint.x) * aspect) * 180 / Math.PI < 50;
  Object.assign(t, { belowFrame: false, armSeenAt: now, lastShoulderY: shoulder.y, lastStraight: straight });
  if (t.phase === "UP" && value < 90 + settings.sensitivity && level) {
    t.phase = "DOWN"; t.minAngle = value; t.straight = straight;
  } else if (t.phase === "DOWN") {
    t.minAngle = Math.min(t.minAngle, value);
    t.straight &&= straight;
    if (value > 155 - settings.sensitivity * .25) {
      t.phase = "UP";
      const quality = t.minAngle < 80 + settings.sensitivity * .5 && t.straight ? "clean" : "ok";
      if (level && now - t.lastRepAt >= 400) recordRep(index, quality);
    }
  }
}
// From a floor camera, the bottom of a push-up can dip below the frame. A player
// last seen low in the frame who then drops out of view is taken to be at the
// bottom of the rep, for up to three seconds; rising back into view with
// straight arms finishes it. Returns whether the player counts as still there.
export function pushupBelowFrame(index, now) {
  const t = state.trackers[index];
  if (t?.exercise !== "pushups" || state.status !== "playing") return false;
  if (t.belowFrame) {
    if (now - t.belowSince <= 3000) return true;
    resetMotion(t);
    t.belowFrame = false;
    return false;
  }
  if (!(now - (t.armSeenAt ?? -Infinity) < 500 && t.lastShoulderY > .6)) return false;
  if (t.phase === "UP") t.straight = t.lastStraight ?? true;
  Object.assign(t, { belowFrame: true, belowSince: now, phase: "DOWN", minAngle: Math.min(t.phase === "DOWN" ? t.minAngle : 180, 60) });
  return true;
}
// Each arm scores a punch when it goes from bent to straight and back. Elbow
// angles use MediaPipe's 3D world landmarks, so a punch thrown straight at the
// camera still reads as straight. Arms hanging at the sides never count.
export function processPunch(index, landmarks, world, aspect, now) {
  const t = state.trackers[index];
  const ls = joint(landmarks, 11), rs = joint(landmarks, 12);
  if (!ls || !rs) { t.visibility = 0; return; }
  const width = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
  const extend = 145 - settings.sensitivity;
  let best = null;
  t.visibility = 0;
  [[11,13,15], [12,14,16]].forEach((ids, side) => {
    const arm = ids.map((i) => joint(landmarks, i));
    const guard = t.arms[side];
    if (arm.some((p) => !p)) { guard.phase = "GUARD"; return; }
    t.visibility = Math.max(t.visibility, minimumVisibility(...arm));
    const [shoulder, elbow, wrist] = world ? ids.map((i) => world[i]) : arm.map((p) => ({ x: p.x * aspect, y: p.y, z: (p.z ?? 0) * aspect }));
    const bend = angle3(shoulder, elbow, wrist);
    best = Math.max(best ?? 0, bend);
    const raised = arm[2].y < arm[0].y + width * .9;
    if (guard.phase === "GUARD" && bend > extend && raised) { guard.phase = "OUT"; guard.max = bend; }
    else if (guard.phase === "OUT") {
      guard.max = Math.max(guard.max, bend);
      if (bend < 110) {
        guard.phase = "GUARD";
        recordRep(index, guard.max > 160 - settings.sensitivity * .5 ? "clean" : "ok");
      }
    }
  });
  t.angle = best;
  t.unit = "°";
  t.phase = t.arms.map((arm) => arm.phase === "OUT" ? "OUT" : "IN").join("/");
}
// Strike a Pose: whether the upper body matches the called pose. Distances are in
// shoulder widths, so they hold at any distance from the camera; the poses are
// symmetric, so the mirrored camera doesn't matter.
// Poses are judged from the shoulders and elbows, since a floor camera often cuts
// off the head of someone standing, and any hand raised above it. The wrists are
// checked only when the camera can see them.
export function holdsPose(pose, landmarks, aspect) {
  const [ls, rs, le, re] = [11, 12, 13, 14].map((i) => joint(landmarks, i));
  if (!ls || !rs || !le || !re) return false;
  const lw = joint(landmarks, 15), rw = joint(landmarks, 16), wrists = lw && rw;
  const width = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
  if (width < .05) return false;
  const slack = settings.sensitivity * .01;
  const apart = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y) / width;
  const above = (a, b, by) => (b.y - a.y) / width > by;
  const level = (a, b, within) => Math.abs(a.y - b.y) / width < within;
  const lift = (elbow, shoulder) => (shoulder.y - elbow.y) / width;
  switch (pose) {
    // Upper arms pointing up, hands (if seen) higher still.
    case "handsUp": return lift(le, ls) > .6 - slack * .5 && lift(re, rs) > .6 - slack * .5
      && (!lw || above(lw, le, .2)) && (!rw || above(rw, re, .2));
    // Arms level with the shoulders all the way out; the hands have to be seen to tell it from a flex.
    case "tPose": return wrists && level(lw, ls, .5 + slack) && level(rw, rs, .5 + slack) && level(le, ls, .4 + slack) && level(re, rs, .4 + slack)
      && apart(lw, rw) > 2.6 - slack * 2;
    // Elbows out at shoulder height with the fists up, not out to the sides.
    case "flex": return level(le, ls, .3 + slack * .5) && level(re, rs, .3 + slack * .5) && apart(le, re) > 1.6 - slack
      && (!lw || above(lw, le, .4 - slack)) && (!rw || above(rw, re, .4 - slack)) && (!wrists || apart(lw, rw) > apart(le, re) * .7);
    // Elbows raised and spread wide, hands (if seen) meeting over the middle.
    case "headTouch": return lift(le, ls) > .15 && lift(re, rs) > .15 && lift(le, ls) < .65 + slack && lift(re, rs) < .65 + slack
      && apart(le, re) > 1.5 - slack && (!wrists || (apart(lw, rw) < apart(le, re) * .7 && above(lw, ls, .3) && above(rw, rs, .3)));
    default: return false;
  }
}

// A plank scores one tick per PLANK_TICK held with the body near horizontal.
// The tick's quality comes from the most the hips sagged or piked during it.
export function processPlank(index, landmarks, aspect, now) {
  const t = state.trackers[index];
  const body = bestSide(landmarks, [11,23,27], [12,24,28]) || bestSide(landmarks, [11,23,25], [12,24,26]);
  if (!body) { t.visibility = 0; t.holdStart = 0; return; }
  const [shoulder, , end] = body.map((i) => landmarks[i]);
  t.visibility = minimumVisibility(...body.map((i) => landmarks[i]));
  const value = smooth(t, flatAngle(landmarks, body, aspect));
  t.unit = "°";
  // Side-on to a floor camera, a body lying along the floor runs across the frame.
  const tilt = Math.atan2(Math.abs(shoulder.y - end.y), Math.abs(shoulder.x - end.x) * aspect) * 180 / Math.PI;
  if (tilt > 45 || value < 145 - settings.sensitivity) { t.phase = "UP"; t.holdStart = 0; return; }
  if (!t.holdStart) { t.phase = "HOLD"; t.holdStart = now; t.holdMin = value; return; }
  t.holdMin = Math.min(t.holdMin, value);
  if (now - t.holdStart < PLANK_TICK) return;
  const quality = t.holdMin > 165 - settings.sensitivity * .5 ? "clean" : t.holdMin > 155 - settings.sensitivity * .5 ? "ok" : "bad";
  t.holdStart = now;
  t.holdMin = value;
  recordRep(index, quality);
}
