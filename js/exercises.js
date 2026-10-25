/* Rep detection: joint-angle math and a state machine per exercise. */

import { PLANK_TICK } from "./config.js";
import { recordRep } from "./game.js";
import { settings, state } from "./state.js";

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
function bestSide(landmarks, left, right) {
  const score = (side) => side.reduce((sum, i) => sum + (landmarks[i]?.visibility ?? 0), 0);
  const chosen = score(left) >= score(right) ? left : right;
  return chosen.every((i) => joint(landmarks, i)) ? chosen.map((i) => landmarks[i]) : null;
}
function torsoLean(shoulder, hip, aspect) {
  return Math.atan2(Math.abs(shoulder.x - hip.x) * aspect, Math.abs(shoulder.y - hip.y)) * 180 / Math.PI;
}

// Squats use the knee angle when a leg is visible. Without legs, depth is how far
// the shoulders drop below standing height, in shoulder widths, so it works at
// any distance. Each rep keeps the method it started with.
export function processSquat(index, landmarks, aspect, now) {
  const t = state.trackers[index];
  const leg = bestSide(landmarks, [23,25,27], [24,26,28]);
  const torso = shoulderDrop(t, landmarks, aspect);
  if (t.phase === "UP") {
    const method = leg ? "legs" : torso ? "torso" : null;
    if (method !== t.method) { t.angles = []; t.method = method; t.unit = method === "torso" ? "×" : "°"; }
  }
  if (t.method === "legs" && leg) squatByKnee(t, index, landmarks, leg, aspect, now);
  else if (t.method === "torso" && torso) squatByShoulders(t, index, landmarks, torso, aspect, now);
  else t.visibility = 0;
}
function squatByKnee(t, index, landmarks, [hip, knee, ankle], aspect, now) {
  t.visibility = minimumVisibility(hip, knee, ankle);
  const value = smooth(t, angle(hip, knee, ankle, aspect));
  const shoulder = joint(landmarks, hip === landmarks[23] ? 11 : 12);
  const lean = shoulder ? torsoLean(shoulder, hip, aspect) : 0;
  const down = 120 + settings.sensitivity;
  const up = 160 - settings.sensitivity * .25;
  if (t.phase === "UP" && value < down) { t.phase = "DOWN"; t.minAngle = value; t.maxLean = lean; }
  else if (t.phase === "DOWN") {
    t.minAngle = Math.min(t.minAngle, value);
    t.maxLean = Math.max(t.maxLean, lean);
    if (value > up) {
      t.phase = "UP";
      const quality = t.maxLean > 45 ? "bad" : t.minAngle < 100 + settings.sensitivity * .5 ? "clean" : "ok";
      if (now - t.lastRepAt >= 400) recordRep(index, quality);
    }
  }
}
function squatByShoulders(t, index, landmarks, { depth, visibility }, aspect, now) {
  t.visibility = visibility;
  const value = smooth(t, depth);
  const hip = joint(landmarks, 23) || joint(landmarks, 24);
  const shoulder = hip && joint(landmarks, hip === landmarks[23] ? 11 : 12);
  const lean = shoulder ? torsoLean(shoulder, hip, aspect) : 0;
  const down = .45 - settings.sensitivity * .01;
  if (t.phase === "UP" && value > down) { t.phase = "DOWN"; t.maxDepth = value; t.maxLean = lean; }
  else if (t.phase === "DOWN") {
    t.maxDepth = Math.max(t.maxDepth, value);
    t.maxLean = Math.max(t.maxLean, lean);
    if (value < .2) {
      t.phase = "UP";
      const quality = t.maxLean > 45 ? "bad" : t.maxDepth > .8 - settings.sensitivity * .01 ? "clean" : "ok";
      if (now - t.lastRepAt >= 400) recordRep(index, quality);
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
export function processPushup(index, landmarks, aspect, now) {
  const t = state.trackers[index];
  const arm = bestSide(landmarks, [11,13,15], [12,14,16]);
  if (!arm) { t.visibility = 0; return; }
  const [shoulder, elbow, wrist] = arm;
  t.visibility = minimumVisibility(...arm);
  const value = smooth(t, angle(shoulder, elbow, wrist, aspect));
  t.unit = "°";
  // Check the body line against the ankle, or the knee if the feet are out of
  // frame. With neither in view, form is judged on depth alone.
  const left = shoulder === landmarks[11];
  const hip = joint(landmarks, left ? 23 : 24);
  const ankle = joint(landmarks, left ? 27 : 28);
  const knee = joint(landmarks, left ? 25 : 26);
  const straight = !hip ? true : ankle ? angle(shoulder, hip, ankle, aspect) > 155 : knee ? angle(shoulder, hip, knee, aspect) > 150 : true;
  if (t.phase === "UP" && value < 90 + settings.sensitivity) {
    t.phase = "DOWN"; t.minAngle = value; t.straight = straight;
  } else if (t.phase === "DOWN") {
    t.minAngle = Math.min(t.minAngle, value);
    t.straight &&= straight;
    if (value > 155 - settings.sensitivity * .25) {
      t.phase = "UP";
      const quality = t.minAngle < 80 + settings.sensitivity * .5 && t.straight ? "clean" : "ok";
      if (now - t.lastRepAt >= 400) recordRep(index, quality);
    }
  }
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
export function holdsPose(pose, landmarks, aspect) {
  const points = [0, 11, 12, 13, 14, 15, 16].map((i) => joint(landmarks, i));
  if (points.some((p) => !p)) return false;
  const [nose, ls, rs, le, re, lw, rw] = points;
  const width = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
  if (width < .05) return false;
  const slack = settings.sensitivity * .01;
  const apart = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y) / width;
  const above = (a, b, by) => (b.y - a.y) / width > by;
  const level = (a, b, within) => Math.abs(a.y - b.y) / width < within;
  switch (pose) {
    case "handsUp": return above(lw, nose, .5 - slack) && above(rw, nose, .5 - slack);
    case "tPose": return level(lw, ls, .5 + slack) && level(rw, rs, .5 + slack) && level(le, ls, .4 + slack) && level(re, rs, .4 + slack)
      && apart(lw, rw) > 2.6 - slack * 2;
    case "flex": return level(le, ls, .5 + slack) && level(re, rs, .5 + slack) && above(lw, le, .4 - slack) && above(rw, re, .4 - slack)
      && apart(le, re) > 1.6 - slack;
    case "headTouch": return apart(lw, nose) < 1 + slack && apart(rw, nose) < 1 + slack && above(lw, ls, .3) && above(rw, rs, .3);
    default: return false;
  }
}

// A plank scores one tick per PLANK_TICK held with the body near horizontal.
// The tick's quality comes from the most the hips sagged or piked during it.
export function processPlank(index, landmarks, aspect, now) {
  const t = state.trackers[index];
  const body = bestSide(landmarks, [11,23,27], [12,24,28]);
  if (!body) { t.visibility = 0; t.holdStart = 0; return; }
  const [shoulder, hip, ankle] = body;
  t.visibility = minimumVisibility(...body);
  const value = smooth(t, angle(shoulder, hip, ankle, aspect));
  t.unit = "°";
  const tilt = Math.atan2(Math.abs(shoulder.y - ankle.y), Math.abs(shoulder.x - ankle.x) * aspect) * 180 / Math.PI;
  if (tilt > 35 || value < 145 - settings.sensitivity) { t.phase = "UP"; t.holdStart = 0; return; }
  if (!t.holdStart) { t.phase = "HOLD"; t.holdStart = now; t.holdMin = value; return; }
  t.holdMin = Math.min(t.holdMin, value);
  if (now - t.holdStart < PLANK_TICK) return;
  const quality = t.holdMin > 165 - settings.sensitivity * .5 ? "clean" : t.holdMin > 155 - settings.sensitivity * .5 ? "ok" : "bad";
  t.holdStart = now;
  t.holdMin = value;
  recordRep(index, quality);
}
