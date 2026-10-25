/* Camera, pose model, and the per-frame tracking loop. */

import { BONES, MODEL_URL, VISION_URL } from "./config.js";
import { holdsPose, joint, processJack, processPlank, processPunch, processPushup, processSquat, pushupBelowFrame } from "./exercises.js";
import { filterPose, newPoseFilter } from "./filter.js";
import { beginCountdown, trackPose } from "./game.js";
import { online, resetMotion, settings, solo, state } from "./state.js";
import { $ } from "./ui.js";
import { publishStream } from "./voice.js";

export function stopMedia() {
  state.cameraToken++;
  state.cameraBusy = false;
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
  publishStream();
  $("camera").srcObject = null;
  $("skeleton").getContext("2d").clearRect(0, 0, $("skeleton").width, $("skeleton").height);
}

export function ensurePoseLoop() {
  if (state.stream && state.landmarker && !state.raf) state.raf = requestAnimationFrame(poseLoop);
}

async function loadModel() {
  if (state.landmarker) return state.landmarker;
  if (!state.modelPromise) {
    state.modelPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import(`${VISION_URL}/vision_bundle.mjs`);
      const vision = await FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
      const options = { baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" }, runningMode: "VIDEO", numPoses: 2,
        minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5 };
      try { return await PoseLandmarker.createFromOptions(vision, options); }
      catch (gpuError) {
        console.warn("GPU pose detection unavailable; using CPU.", gpuError);
        return await PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" } });
      }
    })().then((model) => { state.landmarker = model; return model; }).catch((error) => { state.modelPromise = null; throw error; });
  }
  return state.modelPromise;
}

// Stopping the media invalidates the token, which cancels a camera that is still starting.
export async function prepareCamera() {
  const token = ++state.cameraToken;
  const current = () => token === state.cameraToken;
  state.cameraBusy = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires localhost or HTTPS and a supported browser.");
    // Party cameras are also streamed to every player, so they use a lighter resolution.
    const size = online() ? { width: { ideal: 640 }, height: { ideal: 480 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", ...size } });
    if (!current()) { stream.getTracks().forEach((track) => track.stop()); return; }
    state.stream = stream;
    publishStream();
    const video = $("camera");
    video.srcObject = stream;
    await video.play();
    if (!current()) return;
    $("camera-placeholder").textContent = "Loading pose tracker…";
    await loadModel();
    if (!current()) return;
    $("camera-placeholder").hidden = true;
    state.lastVideoTime = -1;
    state.cameraBusy = false;
    ensurePoseLoop();
    if (!online()) startFraming();
  } catch (error) {
    if (!current()) return;
    const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
    $("error-title").textContent = denied ? "Camera permission denied" : (state.stream ? "Pose model failed to load" : "Camera unavailable");
    $("error-text").textContent = denied ? "Allow camera access in your browser, then retry." :
      state.stream ? "The pose model could not load. Check the connection to the model and CDN, then retry." :
      error?.message || "The camera could not start.";
    $("game-error").hidden = false;
    $("camera-placeholder").textContent = denied ? "Camera permission denied" : "Camera or model unavailable";
    stopMedia();
  }
}

// The video and canvas are both mirrored in CSS. Assignments use mirrored x,
// then choose the permutation nearest the previous player positions.
// Players are placed by their hips, or by their shoulders when the hips are out of
// frame. Side-on, as in a plank or push-up, the far hip and shoulder are hidden,
// so one visible side is enough.
function bodyPoint(landmarks) {
  for (const pair of [[23, 24], [11, 12]]) {
    const seen = pair.map((i) => joint(landmarks, i)).filter(Boolean);
    if (seen.length) return { x: 1 - seen.reduce((sum, p) => sum + p.x, 0) / seen.length, y: seen.reduce((sum, p) => sum + p.y, 0) / seen.length };
  }
  return null;
}
function assignPlayers(result, now) {
  const poses = result.landmarks || [];
  const candidates = poses.map((landmarks, i) => ({ landmarks, world: result.worldLandmarks?.[i], point: bodyPoint(landmarks) }))
    .filter((x) => x.point);
  if (solo()) return [soloPlayer(candidates, now), null];
  if (candidates.length >= 2) {
    const pair = candidates.slice(0, 2);
    const [a, b] = state.trackers;
    if (a.x !== null && b.x !== null && now - a.seenAt < 1800 && now - b.seenAt < 1800) {
      const direct = Math.abs(pair[0].point.x - a.x) + Math.abs(pair[1].point.x - b.x);
      const crossed = Math.abs(pair[1].point.x - a.x) + Math.abs(pair[0].point.x - b.x);
      if (crossed < direct) pair.reverse();
    } else {
      pair.sort((x, y) => x.point.x - y.point.x);
      if (settings.swapped) pair.reverse();
    }
    return pair;
  }
  if (candidates.length === 1) {
    const p = candidates[0];
    const [a, b] = state.trackers;
    const index = a.x !== null && b.x !== null ? (Math.abs(p.point.x - a.x) <= Math.abs(p.point.x - b.x) ? 0 : 1)
      : settings.swapped ? 1 : 0;
    return index === 0 ? [p, null] : [null, p];
  }
  return [null, null];
}
// Solo, stay on the person already being tracked: the model doesn't keep its
// people in a steady order, so someone walking behind the player could otherwise
// take over mid-rep. With nobody tracked recently, take the largest body in view,
// the one nearest the camera.
function soloPlayer(candidates, now) {
  if (candidates.length < 2) return candidates[0] ?? null;
  const t = state.trackers[0];
  if (t.x !== null && now - t.seenAt < 1800) {
    const distance = (c) => Math.hypot(c.point.x - t.x, c.point.y - t.y);
    return candidates.reduce((best, c) => distance(c) < distance(best) ? c : best);
  }
  const size = ({ landmarks }) => {
    const seen = landmarks.filter((p) => (p.visibility ?? 1) >= .5);
    if (!seen.length) return 0;
    const xs = seen.map((p) => p.x), ys = seen.map((p) => p.y);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  };
  return candidates.reduce((best, c) => size(c) > size(best) ? c : best);
}
export function positionLabels() {
  for (let i = 0; i < 2; i++) {
    const label = $(`p${i + 1}-label`);
    label.hidden = online() || (i === 1 && solo());
    // A party host can have a single tracker.
    const p = state.trackers[i];
    if (label.hidden || !p) continue;
    label.style.left = `${((p.x ?? (i ? .72 : .25)) * 100).toFixed(1)}%`;
    label.style.top = `${Math.max(5, ((p.y ?? .45) - .3) * 100).toFixed(1)}%`;
  }
}
function drawSkeleton(assigned) {
  const canvas = $("skeleton"), video = $("camera");
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  assigned.forEach((entry, index) => {
    if (!entry) return;
    const landmarks = entry.landmarks;
    // Skeletons use the theme's player colors, over a dark outline so they stand out
    // from the video and from each other.
    const color = getComputedStyle(document.documentElement).getPropertyValue(index ? "--ui-alt" : "--ui-accent").trim();
    const width = Math.max(3, canvas.width / 280), radius = Math.max(3, canvas.width / 200), edge = Math.max(2, width * .6);
    ctx.lineCap = "round";
    for (const [stroke, grow] of [["#000", edge], [color, 0]]) {
      ctx.strokeStyle = ctx.fillStyle = stroke;
      ctx.lineWidth = width + grow * 2;
      for (const [a, b] of BONES) {
        if (!joint(landmarks, a) || !joint(landmarks, b)) continue;
        ctx.beginPath(); ctx.moveTo(landmarks[a].x * canvas.width, landmarks[a].y * canvas.height);
        ctx.lineTo(landmarks[b].x * canvas.width, landmarks[b].y * canvas.height); ctx.stroke();
      }
      for (const i of [11,12,13,14,15,16,23,24,25,26,27,28]) {
        const p = joint(landmarks, i); if (!p) continue;
        ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, radius + grow, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
}
export function updateDebug() {
  const box = $("debug");
  box.hidden = !settings.debug;
  if (!settings.debug) return;
  box.textContent = state.trackers.slice(0, solo() ? 1 : 2).map((p, i) =>
    `P${i + 1} ${p.exercise ?? "—"}: ${p.angle === null ? "—" : p.angle.toFixed(p.unit === "×" ? 2 : 1)}${p.unit}${p.method ? ` (${p.method})` : ""} | ${p.phase} | vis ${p.visibility.toFixed(2)} | ${p.form}`
  ).join("\n") + `\nFPS: ${state.fps.toFixed(1)}`;
}
// Before a local match, the camera should be on the floor, tilted up, with every
// player in view from head to knees; the feet can be out of frame. The countdown
// starts once everyone has been in frame for a second, or on Start anyway. Online, the same
// card guides each player in the lobby while the host decides when to start.
export function startFraming() {
  state.status = "framing";
  state.framedSince = 0;
  showFraming(true);
}
export function showFraming(canSkip) {
  $("framing").hidden = false;
  $("framing-skip").hidden = !canSkip;
  $("framing-status").textContent = "Step in front of the camera";
}
export function skipFraming() {
  if (state.status !== "framing") return;
  $("framing").hidden = true;
  state.status = "loading";
  beginCountdown(state.session);
}
function checkFraming(assigned, needed, now) {
  const who = (i) => needed > 1 ? `P${i + 1}: ` : "";
  let problem = null;
  for (let i = 0; i < needed && !problem; i++) {
    const entry = assigned[i];
    if (!entry) problem = i ? "Waiting for P2 to step in" : "Step in front of the camera";
    else if (!joint(entry.landmarks, 25) || !joint(entry.landmarks, 26)) problem = `${who(i)}Step back until your legs are in frame`;
    else if (!joint(entry.landmarks, 0)) problem = `${who(i)}Tilt the camera up until your head is in frame`;
  }
  if (problem) {
    state.framedSince = 0;
    $("framing").hidden = false;
    $("framing-status").textContent = problem;
    return;
  }
  state.framedSince ||= now;
  $("framing-status").textContent = "Perfect, hold still…";
  if (now - state.framedSince < 1000) return;
  if (state.status === "framing") skipFraming();
  else $("framing").hidden = true;
}

// Each local player's landmark filter, kept across fights; it restarts itself after a gap.
const filters = [newPoseFilter(), newPoseFilter()];

function poseLoop(now) {
  if (state.screen !== "game" || !state.stream || !state.landmarker) { state.raf = 0; return; }
  const video = $("camera");
  if (video.readyState >= 2 && video.videoWidth && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    try {
      const result = state.landmarker.detectForVideo(video, now);
      const assigned = assignPlayers(result, now)
        .map((entry, i) => entry && { ...entry, ...filterPose(filters[i], entry.landmarks, entry.world, now) });
      const needed = solo() ? 1 : 2;
      // A player who dipped below the frame at the bottom of a push-up still counts as there.
      const hidden = state.trackers.slice(0, needed).filter((t, i) => !assigned[i] && pushupBelowFrame(i, now)).length;
      const detected = assigned.filter(Boolean).length + hidden;
      $("waiting").hidden = solo() || detected >= needed || state.status !== "playing";
      if (!solo() && detected < 2) $("waiting").textContent = "Waiting for P2…";
      if (state.status === "framing" || state.status === "lobby") checkFraming(assigned, needed, now);
      if (detected < needed) {
        // Discard a half-finished movement while scoring is paused. Otherwise
        // someone returning to frame could complete a rep they did not do.
        state.trackers.forEach((t) => { resetMotion(t); t.visibility = 0; t.belowFrame = false; });
      }
      const aspect = video.videoWidth / video.videoHeight;
      assigned.forEach((entry, index) => {
        if (!entry) return;
        const t = state.trackers[index];
        t.x = entry.point.x; t.y = entry.point.y; t.seenAt = now;
        // A missing teammate pauses camera scoring.
        if (state.status !== "playing" || detected < needed) return;
        // A frozen player is only watched for the pose they were called to strike.
        if (t.pose) { trackPose(index, holdsPose(t.pose, entry.landmarks, aspect, t, now), now); return; }
        if (t.exercise === "squats") processSquat(index, entry.landmarks, aspect, now);
        else if (t.exercise === "jacks") processJack(index, entry.landmarks, aspect, now);
        else if (t.exercise === "plank") processPlank(index, entry.landmarks, entry.world, aspect, now);
        else if (t.exercise === "punches") processPunch(index, entry.landmarks, entry.world, aspect, now);
        else if (t.exercise === "pushups") processPushup(index, entry.landmarks, entry.world, aspect, now);
      });
      drawSkeleton(assigned);
      positionLabels();
      if (state.lastFrameAt) state.fps = state.fps * .8 + (1000 / (now - state.lastFrameAt)) * .2;
      state.lastFrameAt = now;
      updateDebug();
    } catch (error) {
      // Stop repeated detection errors; the player can retry the camera.
      $("error-title").textContent = "Pose tracking stopped";
      $("error-text").textContent = error?.message || "The pose tracker could not process the camera.";
      $("game-error").hidden = false;
      stopMedia();
      return;
    }
  }
  state.raf = requestAnimationFrame(poseLoop);
}
