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

export function processSquat(index, landmarks, aspect, now) {
  const t = state.trackers[index];
  const leg = bestSide(landmarks, [23,25,27], [24,26,28]);
  if (!leg) { t.visibility = 0; return; }
  const [hip, knee, ankle] = leg;
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
export function processJack(index, landmarks, now) {
  const t = state.trackers[index];
  const needed = [0,11,12,15,16,27,28].map((i) => joint(landmarks, i));
  if (needed.some((p) => !p)) { t.visibility = 0; return; }
  const [nose, ls, rs, lw, rw, la, ra] = needed;
  t.visibility = minimumVisibility(...needed);
  const shoulderWidth = Math.abs(ls.x - rs.x);
  if (shoulderWidth < .02) return;
  const feetRatio = Math.abs(la.x - ra.x) / shoulderWidth;
  const armsHigh = lw.y < nose.y && rw.y < nose.y;
  const fullyHigh = lw.y < nose.y - .07 && rw.y < nose.y - .07;
  const armsDown = lw.y > ls.y && rw.y > rs.y;
  const feetTogether = feetRatio < 1.35;
  t.angle = feetRatio;
  if (t.phase === "UP" && armsHigh && feetRatio > 1.55 - settings.sensitivity * .01) {
    t.phase = "DOWN";
    t.cleanJack = fullyHigh && feetRatio > 1.9;
  } else if (t.phase === "DOWN") {
    t.cleanJack ||= fullyHigh && feetRatio > 1.9;
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
  const left = shoulder === landmarks[11];
  const hip = joint(landmarks, left ? 23 : 24);
  const ankle = joint(landmarks, left ? 27 : 28);
  const straight = hip && ankle && angle(shoulder, hip, ankle, aspect) > 155;
  if (t.phase === "UP" && value < 90 + settings.sensitivity) {
    t.phase = "DOWN"; t.minAngle = value; t.straight = Boolean(straight);
  } else if (t.phase === "DOWN") {
    t.minAngle = Math.min(t.minAngle, value);
    t.straight &&= Boolean(straight);
    if (value > 155 - settings.sensitivity * .25) {
      t.phase = "UP";
      const quality = t.minAngle < 80 + settings.sensitivity * .5 && t.straight ? "clean" : "ok";
      if (now - t.lastRepAt >= 400) recordRep(index, quality);
    }
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
