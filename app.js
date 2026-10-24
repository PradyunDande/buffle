/* OMuscle: a single-page, client-side co-op exercise arcade. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
  const VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
  const NAMES = { squats: "Squats", jacks: "Jumping Jacks", pushups: "Push-ups" };
  const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
  const points = { clean: 2, ok: 1, bad: 0.5 };
  const feedback = { clean: "CLEAN", ok: "OK", bad: "SLOPPY" };

  const settings = loadSettings();
  const state = {
    screen: "menu", mode: "party", exercise: "squats", round: 1,
    status: "idle", session: 0, stream: null, landmarker: null,
    modelPromise: null, raf: 0, tick: 0, countdownTimer: 0,
    lastVideoTime: -1, lastFrameAt: 0, fps: 0, keyboardOnly: false,
    trackers: [newTracker(), newTracker()],
    score: 0, target: 40, combo: 0, bestCombo: 0,
    frenzyUntil: 0, cleanEvents: 0, repEvents: 0,
    lastEvents: [null, null], endAt: 0,
    audio: null, toastTimer: 0
  };

  function newTracker() {
    return { x: null, y: null, seenAt: 0, phase: "UP", angles: [], angle: null,
      visibility: 0, minAngle: 180, maxLean: 0, cleanJack: false, straight: false,
      form: "—", reps: 0, lastRepAt: -Infinity, lastEventAt: 0 };
  }

  function loadSettings() {
    const defaults = { sound: true, effects: true, debug: false, sensitivity: 0, swapped: false };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem("omuscle-settings") || "{}") }; }
    catch { return defaults; }
  }
  function saveSettings() {
    try { localStorage.setItem("omuscle-settings", JSON.stringify(settings)); } catch { /* Storage is optional. */ }
  }

  function show(id) {
    document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
    state.screen = id;
    window.scrollTo(0, 0);
  }
  function toast(message) {
    const box = $("toast");
    box.textContent = message;
    box.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { box.hidden = true; }, 2800);
  }
  function number(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
  function scoreText(n) { return Math.round(n * 10) / 10; }
  function comboMultiplier() { return state.combo >= 6 ? 2 : state.combo >= 4 ? 1.5 : state.combo >= 2 ? 1.2 : 1; }
  function isFrenzy(now = performance.now()) { return now < state.frenzyUntil; }

  // Audio is created only after a user gesture; every sound is synthesized locally.
  function sound(kind) {
    if (!settings.sound) return;
    try {
      state.audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (state.audio.state === "suspended") state.audio.resume();
      const notes = kind === "victory" ? [[523,0],[659,.13],[784,.26],[1047,.4]]
        : kind === "sync" ? [[520,0],[780,.08],[1040,.16]] : [[330,0]];
      for (const [frequency, delay] of notes) {
        const oscillator = state.audio.createOscillator();
        const gain = state.audio.createGain();
        oscillator.type = kind === "hit" ? "triangle" : "square";
        oscillator.frequency.setValueAtTime(frequency, state.audio.currentTime + delay);
        gain.gain.setValueAtTime(0.0001, state.audio.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.06, state.audio.currentTime + delay + .01);
        gain.gain.exponentialRampToValueAtTime(0.0001, state.audio.currentTime + delay + .18);
        oscillator.connect(gain).connect(state.audio.destination);
        oscillator.start(state.audio.currentTime + delay);
        oscillator.stop(state.audio.currentTime + delay + .2);
      }
    } catch { /* Sound must never interrupt play. */ }
  }

  function confetti() {
    if (!settings.effects) return;
    const layer = $("effects");
    for (let i = 0; i < 22; i++) {
      const bit = document.createElement("span");
      bit.className = "confetti";
      bit.style.left = `${40 + Math.random() * 20}vw`;
      bit.style.top = `${18 + Math.random() * 12}vh`;
      bit.style.background = ["#f3c351", "#d4563b", "#fff1c4", "#9462a6"][i % 4];
      bit.style.setProperty("--dx", `${(Math.random() - .5) * 450}px`);
      bit.style.setProperty("--dy", `${100 + Math.random() * 280}px`);
      layer.append(bit);
      setTimeout(() => bit.remove(), 1300);
    }
    const bat = document.createElement("span");
    bat.className = "bat";
    bat.textContent = "🦇";
    layer.append(bat);
    setTimeout(() => bat.remove(), 1400);
  }
  function flashAndShake(kind) {
    if (!settings.effects) return;
    const stage = $("stage");
    stage.classList.remove(kind);
    void stage.offsetWidth;
    stage.classList.add(kind);
    setTimeout(() => stage.classList.remove(kind), 600);
  }
  function floatText(index, text, className = "") {
    const stage = $("stage");
    const item = document.createElement("span");
    const player = state.trackers[index];
    item.className = `floating ${className}`;
    item.textContent = text;
    item.style.left = `${((player.x ?? (index ? .7 : .25)) * 100).toFixed(1)}%`;
    item.style.top = `${Math.max(10, ((player.y ?? .5) * 100) - 20).toFixed(1)}%`;
    stage.append(item);
    setTimeout(() => item.remove(), 1250);
  }

  function updateHud() {
    $("team-score").textContent = number(scoreText(state.score));
    $("target-label").textContent = `${number(scoreText(state.score))} / ${state.target}`;
    $("progress-fill").style.width = `${Math.min(100, state.score / state.target * 100)}%`;
    $("combo-value").innerHTML = `${state.combo} <small>×${comboMultiplier().toFixed(1)}</small>`;
    $("p1-reps").textContent = number(state.trackers[0].reps);
    $("p2-reps").textContent = number(state.trackers[1].reps);
    $("frenzy-banner").hidden = !isFrenzy();
  }

  function recordRep(index, quality, amount = 1, fromCamera = true) {
    if (state.status !== "playing") return;
    const now = performance.now();
    const player = state.trackers[index];
    if (fromCamera && now - player.lastRepAt < 400) return;
    player.lastRepAt = now;
    player.lastEventAt = now;
    player.reps += amount;
    player.form = quality.toUpperCase();
    state.repEvents++;
    if (quality === "clean") state.cleanEvents++;

    // Rep points use the combo that was active as this rep began.
    const earned = points[quality] * comboMultiplier() * (isFrenzy(now) ? 2 : 1);
    state.score = scoreText(state.score + earned);
    floatText(index, `${feedback[quality]} +${number(scoreText(earned))}`, quality === "bad" ? "bad" : "");
    if (quality === "bad") flashAndShake("shake");
    sound("hit");

    const other = state.lastEvents[1 - index];
    const event = { at: now, paired: false };
    state.lastEvents[index] = event;
    if (state.mode === "party" && other && !other.paired && now - other.at <= 700) {
      event.paired = other.paired = true;
      state.combo++;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      if (state.combo % 5 === 0) state.frenzyUntil = now + 5000;
      const bonus = 3 * (isFrenzy(now) ? 2 : 1);
      state.score = scoreText(state.score + bonus);
      floatText(index, `SYNC! +${bonus}`, "sync");
      confetti();
      flashAndShake("flash");
      sound("sync");
    }
    updateHud();
    if (state.score >= state.target) finishRound(true);
  }

  function resetRound() {
    state.trackers = [newTracker(), newTracker()];
    state.score = 0; state.combo = 0; state.bestCombo = 0;
    state.frenzyUntil = 0; state.cleanEvents = 0; state.repEvents = 0;
    state.lastEvents = [null, null]; state.endAt = 0;
    state.target = (state.mode === "solo" ? 20 : 40) + (state.round - 1) * (state.mode === "solo" ? 5 : 10);
    state.lastVideoTime = -1;
    state.lastFrameAt = 0;
    $("time-value").textContent = "45";
    $("mode-label").textContent = state.mode === "solo" ? "SOLO PRACTICE" : "LOCAL PARTY";
    $("game-title").textContent = NAMES[state.exercise];
    $("p2-score").hidden = state.mode === "solo";
    $("p2-label").hidden = state.mode === "solo";
    $("pose-tip").textContent = state.exercise === "pushups" ? "Turn sideways and keep your full body in frame." : "Keep your full body in frame.";
    $("waiting").hidden = true;
    $("camera-placeholder").hidden = false;
    $("camera-placeholder").textContent = "Preparing the camera…";
    $("game-error").hidden = true;
    $("countdown").hidden = true;
    updateHud();
    positionLabels();
  }

  function stopMedia() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    $("camera").srcObject = null;
    $("skeleton").getContext("2d").clearRect(0, 0, $("skeleton").width, $("skeleton").height);
  }
  function stopRound() {
    state.session++;
    clearInterval(state.tick);
    clearInterval(state.countdownTimer);
    state.tick = state.countdownTimer = 0;
    stopMedia();
    state.status = "idle";
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

  async function prepareCamera(session) {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires localhost or HTTPS and a supported browser.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (session !== state.session || state.keyboardOnly || state.status !== "loading") { stream.getTracks().forEach((track) => track.stop()); return; }
      state.stream = stream;
      const video = $("camera");
      video.srcObject = stream;
      await video.play();
      if (session !== state.session || state.keyboardOnly || state.status !== "loading") return;
      $("camera-placeholder").textContent = "Loading pose tracker…";
      await loadModel();
      if (session !== state.session || state.keyboardOnly || state.status !== "loading") return;
      $("camera-placeholder").hidden = true;
      state.keyboardOnly = false;
      state.lastVideoTime = -1;
      state.raf = requestAnimationFrame(poseLoop);
      beginCountdown(session);
    } catch (error) {
      if (session !== state.session || state.keyboardOnly) return;
      const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
      $("error-title").textContent = denied ? "Camera permission denied" : (state.stream ? "Pose model failed to load" : "Camera unavailable");
      $("error-text").textContent = denied ? "Allow camera access in your browser, then retry. You can also play using the test hotkeys." :
        state.stream ? "The pose model could not load. Check the connection to the model and CDN, then retry." :
        `${error?.message || "The camera could not start."} You can play using the test hotkeys.`;
      $("game-error").hidden = false;
      $("camera-placeholder").textContent = denied ? "Camera permission denied" : "Camera or model unavailable";
      stopMedia();
    }
  }

  function beginCountdown(session) {
    if (session !== state.session || state.status !== "loading") return;
    state.status = "countdown";
    $("game-error").hidden = true;
    const box = $("countdown");
    box.hidden = false;
    let count = 3;
    box.textContent = String(count);
    state.countdownTimer = setInterval(() => {
      if (session !== state.session) { clearInterval(state.countdownTimer); return; }
      count--;
      if (count > 0) { box.textContent = String(count); sound("hit"); return; }
      if (count === 0) { box.textContent = "GO!"; sound("sync"); startClock(session); return; }
      box.hidden = true;
      clearInterval(state.countdownTimer);
      state.countdownTimer = 0;
    }, 1000);
  }
  function startClock(session) {
    if (session !== state.session || state.status !== "countdown") return;
    state.status = "playing";
    state.endAt = performance.now() + 45000;
    state.tick = setInterval(() => {
      if (session !== state.session) return;
      const now = performance.now();
      $("time-value").textContent = String(Math.max(0, Math.ceil((state.endAt - now) / 1000)));
      if (state.combo && state.mode === "party" && state.trackers.some((p) => now - p.lastEventAt > 4000)) {
        state.combo = 0;
        state.lastEvents = [null, null];
      }
      updateHud();
      if (now >= state.endAt) finishRound(false);
    }, 100);
  }

  function startGame() {
    stopRound();
    resetRound();
    show("game");
    state.status = "loading";
    state.keyboardOnly = false;
    const session = state.session;
    prepareCamera(session);
  }
  function finishRound(won) {
    if (state.status !== "playing") return;
    const result = { score: state.score, reps: state.trackers.reduce((sum, p) => sum + p.reps, 0),
      clean: state.repEvents ? Math.round(state.cleanEvents / state.repEvents * 100) : 0, best: state.bestCombo };
    stopRound();
    $("results-title").textContent = won ? "Victory!" : "Better luck next time";
    $("result-message").textContent = won ? "Your team conquered the court." : "The court awaits your comeback.";
    const rating = won ? "Gold" : result.score >= state.target / 2 ? "Silver" : "Bronze";
    $("rating").textContent = rating.toUpperCase();
    $("rating").className = `rating ${rating.toLowerCase()}`;
    $("result-score").textContent = number(scoreText(result.score));
    $("result-reps").textContent = number(result.reps);
    $("result-clean").textContent = `${result.clean}%`;
    $("result-combo").textContent = String(result.best);
    show("results");
    if (won) { sound("victory"); confetti(); }
  }

  const visible = (p) => p && (p.visibility ?? 1) >= .5;
  function joint(landmarks, index) { const p = landmarks[index]; return visible(p) ? p : null; }
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

  function processSquat(index, landmarks, aspect, now) {
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
  function processJack(index, landmarks, now) {
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
  function processPushup(index, landmarks, aspect, now) {
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

  // The video and canvas are both mirrored in CSS. Assignments use mirrored x,
  // then choose the permutation nearest the previous player positions.
  function hipMidpoint(landmarks) {
    const a = joint(landmarks, 23), b = joint(landmarks, 24);
    if (!a || !b) return null;
    return { x: 1 - (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  function assignPlayers(poses, now) {
    const candidates = poses.map((landmarks) => ({ landmarks, point: hipMidpoint(landmarks) })).filter((x) => x.point);
    if (state.mode === "solo") return candidates.length ? [candidates[0], null] : [null, null];
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
  function positionLabels() {
    for (let i = 0; i < 2; i++) {
      const p = state.trackers[i];
      const label = $(`p${i + 1}-label`);
      label.style.left = `${((p.x ?? (i ? .72 : .25)) * 100).toFixed(1)}%`;
      label.style.top = `${Math.max(5, ((p.y ?? .45) - .3) * 100).toFixed(1)}%`;
      label.hidden = i === 1 && state.mode === "solo";
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
      ctx.strokeStyle = index ? "#f07558" : "#f7cc66";
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
  function updateDebug() {
    const box = $("debug");
    box.hidden = !settings.debug;
    if (!settings.debug) return;
    box.textContent = state.trackers.slice(0, state.mode === "solo" ? 1 : 2).map((p, i) =>
      `P${i + 1}: ${p.angle === null ? "—" : p.angle.toFixed(1)}${state.exercise === "jacks" ? "×" : "°"} | ${p.phase} | vis ${p.visibility.toFixed(2)} | ${p.form}`
    ).join("\n") + `\nFPS: ${state.fps.toFixed(1)}`;
  }
  function poseLoop(now) {
    if (state.screen !== "game" || !state.stream || !state.landmarker) return;
    const video = $("camera");
    if (video.readyState >= 2 && video.videoWidth && video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      try {
        const result = state.landmarker.detectForVideo(video, now);
        const assigned = assignPlayers(result.landmarks || [], now);
        const needed = state.mode === "solo" ? 1 : 2;
        const detected = assigned.filter(Boolean).length;
        $("waiting").hidden = state.mode === "solo" || detected >= needed;
        if (state.mode === "party" && detected < 2) $("waiting").textContent = "Waiting for P2…";
        if (detected < needed) {
          // Discard a half-finished movement while scoring is paused. Otherwise
          // someone returning to frame could complete a rep they did not do.
          state.trackers.forEach((t) => { t.phase = "UP"; t.angles = []; t.angle = null; t.visibility = 0; });
        }
        const aspect = video.videoWidth / video.videoHeight;
        assigned.forEach((entry, index) => {
          if (!entry) return;
          const t = state.trackers[index];
          t.x = entry.point.x; t.y = entry.point.y; t.seenAt = now;
          // A missing teammate pauses camera scoring; hotkeys still work for testing.
          if (state.status !== "playing" || detected < needed) return;
          if (state.exercise === "squats") processSquat(index, entry.landmarks, aspect, now);
          else if (state.exercise === "jacks") processJack(index, entry.landmarks, now);
          else processPushup(index, entry.landmarks, aspect, now);
        });
        drawSkeleton(assigned);
        positionLabels();
        if (state.lastFrameAt) state.fps = state.fps * .8 + (1000 / (now - state.lastFrameAt)) * .2;
        state.lastFrameAt = now;
        updateDebug();
      } catch (error) {
        // Stop repeated detection errors and let the player finish with hotkeys.
        $("error-title").textContent = "Pose tracking stopped";
        $("error-text").textContent = error?.message || "The pose tracker could not process the camera.";
        $("game-error").hidden = false;
        stopMedia();
        return;
      }
    }
    state.raf = requestAnimationFrame(poseLoop);
  }

  $("party-button").addEventListener("click", () => { state.mode = "party"; state.round = 1; show("exercise"); });
  $("solo-button").addEventListener("click", () => { state.mode = "solo"; state.round = 1; show("exercise"); });
  $("how-button").addEventListener("click", () => show("how"));
  $("settings-button").addEventListener("click", () => show("settings"));
  $("brand").addEventListener("click", () => { if (state.screen === "game") stopRound(); show("menu"); });
  document.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => show(button.dataset.screen)));
  document.querySelectorAll("[data-exercise]").forEach((button) => button.addEventListener("click", () => { state.exercise = button.dataset.exercise; startGame(); }));
  $("leave-button").addEventListener("click", () => { stopRound(); show("menu"); });
  $("menu-button").addEventListener("click", () => { state.round = 1; show("menu"); });
  $("again-button").addEventListener("click", () => { state.round++; startGame(); });
  $("retry-button").addEventListener("click", () => {
    stopMedia(); state.status = "loading";
    $("game-error").hidden = true;
    $("camera-placeholder").hidden = false;
    $("camera-placeholder").textContent = "Preparing the camera…";
    prepareCamera(state.session);
  });
  function useHotkeys() {
    if (state.status !== "loading") return;
    stopMedia(); state.keyboardOnly = true;
    $("game-error").hidden = true;
    $("camera-placeholder").textContent = "Hotkey mode — press 1 / 2 or Q / W";
    $("waiting").hidden = true;
    beginCountdown(state.session);
  }
  $("keyboard-button").addEventListener("click", useHotkeys);
  $("keyboard-shortcut").addEventListener("click", useHotkeys);

  for (const [id, key] of [["sound-toggle","sound"],["effects-toggle","effects"],["debug-toggle","debug"]]) {
    $(id).checked = settings[key];
    $(id).addEventListener("change", (event) => { settings[key] = event.target.checked; saveSettings(); updateDebug(); });
  }
  $("sensitivity").value = settings.sensitivity;
  function sensitivityName() { $("sensitivity-name").textContent = settings.sensitivity < -5 ? "Strict" : settings.sensitivity > 5 ? "Forgiving" : "Normal"; }
  sensitivityName();
  $("sensitivity").addEventListener("input", (event) => { settings.sensitivity = Number(event.target.value); sensitivityName(); saveSettings(); });
  $("swap-button").addEventListener("click", () => {
    settings.swapped = !settings.swapped;
    state.trackers.reverse();
    state.lastEvents.reverse();
    saveSettings(); positionLabels();
    toast(`P1 / P2 ${settings.swapped ? "swapped" : "restored"}`);
  });
  window.addEventListener("keydown", (event) => {
    if (state.screen !== "game" || state.status !== "playing" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const match = { "1": [0,"clean",1], "2": [1,"clean",1], q: [0,"ok",.5], w: [1,"ok",.5] }[key];
    if (!match || (state.mode === "solo" && match[0] === 1)) return;
    event.preventDefault();
    recordRep(...match, false);
  });
})();
