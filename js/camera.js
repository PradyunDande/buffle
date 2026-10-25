/* Camera, pose model, and the per-frame tracking loop. */

import { BONES, MODEL_URL, VISION_URL } from "./config.js";
import { joint, processJack, processPlank, processPunch, processPushup, processSquat } from "./exercises.js";
import { beginCountdown } from "./game.js";
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
    if (!online()) beginCountdown(state.session);
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
// Players are placed by their hips, or by their shoulders when the hips are out of frame.
function bodyPoint(landmarks) {
  for (const [l, r] of [[23, 24], [11, 12]]) {
    const a = joint(landmarks, l), b = joint(landmarks, r);
    if (a && b) return { x: 1 - (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return null;
}
function assignPlayers(result, now) {
  const poses = result.landmarks || [];
  const candidates = poses.map((landmarks, i) => ({ landmarks, world: result.worldLandmarks?.[i], point: bodyPoint(landmarks) }))
    .filter((x) => x.point);
  if (solo()) return candidates.length ? [candidates[0], null] : [null, null];
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
    // Skeletons use the theme's player colors.
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue(index ? "--ui-alt" : "--ui-accent").trim();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = Math.max(3, canvas.width / 280);
    ctx.lineCap = "round";
    for (const [a, b] of BONES) {
      if (!joint(landmarks, a) || !joint(landmarks, b)) continue;
      ctx.beginPath(); ctx.moveTo(landmarks[a].x * canvas.width, landmarks[a].y * canvas.height);
      ctx.lineTo(landmarks[b].x * canvas.width, landmarks[b].y * canvas.height); ctx.stroke();
    }
    for (const i of [11,12,13,14,15,16,23,24,25,26,27,28]) {
      const p = joint(landmarks, i); if (!p) continue;
      ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(3, canvas.width / 200), 0, Math.PI * 2); ctx.fill();
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
function poseLoop(now) {
  if (state.screen !== "game" || !state.stream || !state.landmarker) { state.raf = 0; return; }
  const video = $("camera");
  if (video.readyState >= 2 && video.videoWidth && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    try {
      const result = state.landmarker.detectForVideo(video, now);
      const assigned = assignPlayers(result, now);
      const needed = solo() ? 1 : 2;
      const detected = assigned.filter(Boolean).length;
      $("waiting").hidden = solo() || detected >= needed;
      if (!solo() && detected < 2) $("waiting").textContent = "Waiting for P2…";
      if (detected < needed) {
        // Discard a half-finished movement while scoring is paused. Otherwise
        // someone returning to frame could complete a rep they did not do.
        state.trackers.forEach((t) => { resetMotion(t); t.visibility = 0; });
      }
      const aspect = video.videoWidth / video.videoHeight;
      assigned.forEach((entry, index) => {
        if (!entry) return;
        const t = state.trackers[index];
        t.x = entry.point.x; t.y = entry.point.y; t.seenAt = now;
        // A missing teammate pauses camera scoring.
        // Each player is tracked on their own move, and not while switching to it.
        if (state.status !== "playing" || detected < needed || now < t.readyAt) return;
        if (t.exercise === "squats") processSquat(index, entry.landmarks, aspect, now);
        else if (t.exercise === "jacks") processJack(index, entry.landmarks, now);
        else if (t.exercise === "plank") processPlank(index, entry.landmarks, aspect, now);
        else if (t.exercise === "punches") processPunch(index, entry.landmarks, entry.world, aspect, now);
        else if (t.exercise === "pushups") processPushup(index, entry.landmarks, aspect, now);
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
