/* Rep detection: joint-angle math and a state machine per exercise.

   The camera sits on the floor, tilted up at the player, and the feet may be out
   of frame, as can the head and raised hands. Facing the camera from that low,
   steep view, flat 2D angles are distorted, so punches take joint angles from
   MediaPipe's 3D world landmarks, and squats and jumping jacks are judged from
   the hips, knees, and shoulders, which stay in frame. Floor moves (push-ups,
   planks) work side-on, where the flat image shows the true angles and is
   steadier than the 3D estimate, or facing the camera, where only the 3D
   estimate shows how the body lies. */

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
// The angle at the middle joint as the camera image shows it.
function flatAngle(landmarks, [a, b, c], aspect) {
  return angle(landmarks[a], landmarks[b], landmarks[c], aspect);
}

// Squats are read from the thighs: the hips and knees stay in frame of a floor
// camera through the whole squat, while the head, shoulders, and feet can leave
// it. Standing, the knees sit well below the hips in the image. Squatting, the
// thighs come level and point at the camera, so the knees rise to the hips' height
// or, closer to a low camera, above it. `rise` is the knees' height below the hips
// as a percentage of standing: 100 standing, about 0 or less at parallel. With no
// hips or knees in view, squats fall back to how far the shoulders drop below
// standing height, in shoulder widths. Each rep keeps the method it started with.
// Depth alone sets the quality: a tilted-up camera can't judge forward lean.
export function processSquat(index, landmarks, aspect, now) {
  const t = state.trackers[index];
  const thighs = thighDrop(t, landmarks);
  const torso = shoulderDrop(t, landmarks, aspect);
  if (t.phase === "UP") {
    const method = thighs ? "thighs" : torso ? "torso" : null;
    if (method !== t.method) { t.angles = []; t.method = method; t.unit = method === "torso" ? "×" : "%"; }
  }
  if (t.method === "thighs" && thighs) {
    t.visibility = thighs.visibility;
    squatRep(t, index, smooth(t, thighs.rise), 55, 85, 20, now);
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
// The knees' height below the hips, averaged over the sides in view, as a
// percentage of standing. Standing follows the longest recent thighs, fading
// slowly while standing so stepping toward or away from the camera is absorbed.
function thighDrop(t, landmarks) {
  const sides = [[23, 25], [24, 26]].map(([h, k]) => [joint(landmarks, h), joint(landmarks, k)]).filter(([h, k]) => h && k);
  if (!sides.length) return null;
  const length = sides.reduce((sum, [hip, knee]) => sum + knee.y - hip.y, 0) / sides.length;
  if (t.phase === "UP") t.topThigh = Math.max(length, (t.topThigh ?? 0) * .998);
  if (t.topThigh < .03) return null;
  return { rise: 100 * length / t.topThigh, visibility: Math.min(...sides.flat().map((p) => p.visibility ?? 1)) };
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

// Jumping jacks need the arms to go up overhead and back below the shoulders.
// Judged from the shoulders, since a floor camera often cuts off the head and the
// raised hands: an arm is up when its wrist is high above the shoulder, its elbow
// is above it, or its hand has left the top of the frame. When the feet are
// visible they must also spread and close.
export function processJack(index, landmarks, aspect, now) {
  const t = state.trackers[index];
  const ls = joint(landmarks, 11), rs = joint(landmarks, 12);
  if (!ls || !rs) { t.visibility = 0; return; }
  const width = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
  if (width < .05) return;
  const la = joint(landmarks, 27), ra = joint(landmarks, 28);
  const feet = la && ra;
  t.visibility = minimumVisibility(ls, rs, ...(feet ? [la, ra] : []));
  const slack = settings.sensitivity * .01;
  // How high each arm is: 2 overhead, 1 raised, 0 neither, -1 down by the side.
  const arm = ([shoulder, elbowId, wristId]) => {
    const elbow = joint(landmarks, elbowId), wrist = joint(landmarks, wristId);
    const lift = (p) => (shoulder.y - p.y) / width;
    // A hand above the frame comes back with low visibility and a y below 0.
    const offTop = !wrist && landmarks[wristId]?.y < 0 && (!elbow || lift(elbow) > 0);
    if (offTop || (wrist && lift(wrist) > 1.2 - slack) || (elbow && lift(elbow) > .6 - slack)) return 2;
    if ((wrist && lift(wrist) > .7 - slack) || (elbow && lift(elbow) > .3 - slack)) return 1;
    if (wrist ? lift(wrist) < 0 : elbow && lift(elbow) < -.3) return -1;
    return 0;
  };
  const arms = [arm([ls, 13, 15]), arm([rs, 14, 16])];
  const shoulderWidth = Math.abs(ls.x - rs.x);
  const feetRatio = feet && shoulderWidth > .02 ? Math.abs(la.x - ra.x) / shoulderWidth : null;
  const armsHigh = arms.every((a) => a >= 1);
  const armsDown = arms.every((a) => a === -1);
  const feetApart = feetRatio === null || feetRatio > 1.55 - slack;
  const feetTogether = feetRatio === null || feetRatio < 1.35;
  const wide = arms.every((a) => a === 2) && (feetRatio === null || feetRatio > 1.9);
  t.angle = feetRatio;
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
// Push-ups and planks work side-on to the floor camera or facing it. Side-on,
// the flat image shows the true angles: the elbow bend, and body straightness to
// the ankle, or the knee if the feet are out of frame. Facing the camera, the
// body runs away from it and the image hides both, so a push-up is read from the
// elbows rising level with the shoulders, and the body's line from the 3D world
// landmarks. Each rep keeps the view it started in.
export function processPushup(index, landmarks, world, aspect, now) {
  const t = state.trackers[index];
  if (t.phase === "UP") {
    const method = facingCamera(landmarks, aspect) ? "front" : "side";
    if (method !== t.method) { t.angles = []; t.method = method; t.topReach = t.topShoulderY = null; }
  }
  if (t.method === "front") frontPushup(t, index, landmarks, world, aspect, now);
  else sidePushup(t, index, landmarks, aspect, now);
}
function sidePushup(t, index, landmarks, aspect, now) {
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
  pushupRep(t, index, value, level, straight, [90, 155, 80], now);
}
// Facing the camera, `reach` is how far the elbows sit below the shoulders, in
// shoulder widths: most of an upper arm at the top, about zero at the bottom. It
// is scored as a percentage of the top. A rep also needs the body lying away from
// the camera and the shoulders to have dropped, so raising the arms while
// standing never scores one.
function frontPushup(t, index, landmarks, world, aspect, now) {
  const ls = joint(landmarks, 11), rs = joint(landmarks, 12);
  const elbows = [13, 14].map((i) => joint(landmarks, i)).filter(Boolean);
  const body = bodyLine(world);
  if (!ls || !rs || !elbows.length || !body) { if (!pushupBelowFrame(index, now)) t.visibility = 0; return; }
  const width = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
  if (width < .05) return;
  t.visibility = minimumVisibility(ls, rs, ...elbows);
  const shoulderY = (ls.y + rs.y) / 2;
  const reach = (elbows.reduce((sum, elbow) => sum + elbow.y, 0) / elbows.length - shoulderY) / width;
  // The top follows the highest recent shoulders and lowest elbows, drifting slowly
  // so shifting toward or away from the camera is absorbed.
  if (t.phase === "UP") {
    t.topReach = Math.max(reach, (t.topReach ?? reach) - .002);
    t.topShoulderY = Math.min(shoulderY, (t.topShoulderY ?? shoulderY) + .002);
    t.lowShoulderY = shoulderY;
  } else t.lowShoulderY = Math.max(t.lowShoulderY, shoulderY);
  // Elbows not yet below the shoulders: the arms aren't holding the body up.
  if (t.phase === "UP" && t.topReach < .3) { t.angle = null; return; }
  const value = smooth(t, 100 * reach / t.topReach);
  t.unit = "%";
  const straight = body.line > 150;
  const lying = body.away > .45 - settings.sensitivity * .01;
  const dropped = (t.lowShoulderY - t.topShoulderY) / width > .15;
  Object.assign(t, { belowFrame: false, armSeenAt: now, lastShoulderY: shoulderY, lastStraight: straight });
  pushupRep(t, index, value, lying && (t.phase === "UP" || dropped), straight, [45, 80, 15], now);
}
// `value` falls as the player lowers: a rep goes below `down` and back above `up`,
// and is clean if it got below `clean` with the body straight throughout. The body
// must be `level` to start a rep and to score it.
function pushupRep(t, index, value, level, straight, [down, up, clean], now) {
  if (t.phase === "UP" && value < down + settings.sensitivity && level) {
    t.phase = "DOWN"; t.minAngle = value; t.straight = straight;
  } else if (t.phase === "DOWN") {
    t.minAngle = Math.min(t.minAngle, value);
    t.straight &&= straight;
    if (value > up - settings.sensitivity * .25) {
      t.phase = "UP";
      const quality = t.minAngle < clean + settings.sensitivity * .5 && t.straight ? "clean" : "ok";
      if (level && now - t.lastRepAt >= 400) recordRep(index, quality);
    }
  }
}
// Facing the camera, both shoulders show a full shoulder width apart; side-on they
// nearly overlap. The upper arm, which shows most of its length either way while
// the arms hold the body up, is the yardstick.
function facingCamera(landmarks, aspect) {
  const ls = joint(landmarks, 11), rs = joint(landmarks, 12);
  const le = joint(landmarks, 13), re = joint(landmarks, 14);
  if (!ls || !rs || !(le || re)) return false;
  const apart = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  return apart(ls, rs) > Math.max(le ? apart(ls, le) : 0, re ? apart(rs, re) : 0) * .8;
}
// The body's line from the 3D world landmarks: `away` is how much the torso points
// away from the camera, near 1 lying down facing it and 0 or below standing up,
// however the camera is tilted; `line` is the shoulder–hip–knee angle.
function bodyLine(world) {
  if (![11, 12, 23, 24, 25, 26].every((i) => world?.[i])) return null;
  const mid = (a, b) => ({ x: (world[a].x + world[b].x) / 2, y: (world[a].y + world[b].y) / 2, z: (world[a].z + world[b].z) / 2 });
  const shoulder = mid(11, 12), hip = mid(23, 24), knee = mid(25, 26);
  const length = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y, hip.z - shoulder.z);
  if (!length) return null;
  return { away: (hip.z - shoulder.z) / length, line: angle3(shoulder, hip, knee) };
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
  // Counts as full depth: an elbow angle of 60°, or facing the camera, elbows nearly level with the shoulders.
  const deep = t.method === "front" ? 10 : 60;
  Object.assign(t, { belowFrame: true, belowSince: now, phase: "DOWN", minAngle: Math.min(t.phase === "DOWN" ? t.minAngle : 180, deep), lowShoulderY: 1 });
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
// Side-on, that's the flat shoulder–hip–ankle (or knee) angle; facing the camera,
// the 3D one, with the torso lying away from the camera and the elbows under the
// shoulders.
export function processPlank(index, landmarks, world, aspect, now) {
  const t = state.trackers[index];
  const method = facingCamera(landmarks, aspect) ? "front" : "side";
  if (method !== t.method) { t.angles = []; t.method = method; t.holdStart = 0; }
  const value = method === "front" ? frontPlank(t, landmarks, world, aspect) : sidePlank(t, landmarks, aspect);
  if (value === null) { t.phase = "UP"; t.holdStart = 0; return; }
  if (!t.holdStart) { t.phase = "HOLD"; t.holdStart = now; t.holdMin = value; return; }
  t.holdMin = Math.min(t.holdMin, value);
  if (now - t.holdStart < PLANK_TICK) return;
  const quality = t.holdMin > 165 - settings.sensitivity * .5 ? "clean" : t.holdMin > 155 - settings.sensitivity * .5 ? "ok" : "bad";
  t.holdStart = now;
  t.holdMin = value;
  recordRep(index, quality);
}
// Each returns the body's angle while it's in a plank, or null.
function sidePlank(t, landmarks, aspect) {
  const body = bestSide(landmarks, [11,23,27], [12,24,28]) || bestSide(landmarks, [11,23,25], [12,24,26]);
  if (!body) { t.visibility = 0; return null; }
  const [shoulder, , end] = body.map((i) => landmarks[i]);
  t.visibility = minimumVisibility(...body.map((i) => landmarks[i]));
  const value = smooth(t, flatAngle(landmarks, body, aspect));
  t.unit = "°";
  // Side-on to a floor camera, a body lying along the floor runs across the frame.
  const tilt = Math.atan2(Math.abs(shoulder.y - end.y), Math.abs(shoulder.x - end.x) * aspect) * 180 / Math.PI;
  return tilt > 45 || value < 145 - settings.sensitivity ? null : value;
}
function frontPlank(t, landmarks, world, aspect) {
  const ls = joint(landmarks, 11), rs = joint(landmarks, 12);
  const elbows = [13, 14].map((i) => joint(landmarks, i)).filter(Boolean);
  const body = bodyLine(world);
  if (!ls || !rs || !elbows.length || !body) { t.visibility = 0; return null; }
  const width = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
  t.visibility = minimumVisibility(ls, rs, ...elbows);
  const value = smooth(t, body.line);
  t.unit = "°";
  // Elbows below the shoulders hold the body up; on all fours the hips bend near 90°.
  const reach = (elbows.reduce((sum, elbow) => sum + elbow.y, 0) / elbows.length - (ls.y + rs.y) / 2) / width;
  const lying = body.away > .45 - settings.sensitivity * .01;
  return width < .05 || !lying || reach < .2 || value < 135 - settings.sensitivity ? null : value;
}
