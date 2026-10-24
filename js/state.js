/* Shared game state, saved settings and story progress, and scoring helpers. */

import { BOSSES, HEARTS, ROPE } from "./config.js";

export const settings = loadSettings();
export const progress = loadProgress();
export const state = {
  screen: "menu", mode: "story", exercise: "squats", bossIndex: 0, advance: false,
  status: "idle", session: 0, stream: null, landmarker: null,
  modelPromise: null, raf: 0, tick: 0, countdownTimer: 0, transitionTimer: 0, alertTimer: 0,
  lastVideoTime: -1, lastFrameAt: 0, fps: 0, keyboardOnly: false,
  trackers: [newTracker(), newTracker()],
  combo: 0, bestCombo: 0, frenzyUntil: 0, cleanEvents: 0, repEvents: 0,
  lastEvents: [null, null], endAt: 0, duration: 0, lastTickAt: 0,
  bossHp: 0, bossMax: 0, phase: 0, hearts: HEARTS, attack: null, nextAttackAt: 0, parries: 0,
  scores: [0, 0], cameraToken: 0, cameraBusy: false,
  party: null, roster: [], myIndex: 0, partyReps: [], remoteStreams: new Map(),
  audio: null, toastTimer: 0
};
// In a remote party each device tracks one person; the host keeps score for everyone.
export const solo = () => state.mode === "story" || state.mode === "party";
export const teamMode = () => state.mode === "coop" || state.mode === "party";
export const isHost = () => state.mode === "party" && Boolean(state.party?.isHost);
export const isGuest = () => state.mode === "party" && Boolean(state.party) && !state.party.isHost;
export const playerCount = () => state.mode === "party" ? Math.max(1, state.roster.length) : state.mode === "coop" ? 2 : 1;
export const boss = () => BOSSES[state.bossIndex];

export function newTracker() {
  return { x: null, y: null, seenAt: 0, phase: "UP", angles: [], angle: null,
    visibility: 0, minAngle: 180, maxLean: 0, cleanJack: false, straight: false,
    holdStart: 0, holdMin: 180, streak: 0,
    form: "—", reps: 0, lastRepAt: -Infinity, lastEventAt: 0 };
}
// Drop any half-finished movement, keeping the player's position for assignment.
export function resetMotion(t) {
  t.phase = "UP"; t.angles = []; t.angle = null; t.minAngle = 180; t.maxLean = 0;
  t.cleanJack = false; t.straight = false; t.holdStart = 0; t.holdMin = 180;
}

function loadSettings() {
  const defaults = { sound: true, effects: true, debug: false, sensitivity: 0, swapped: false, name: "" };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem("baffle-settings") || "{}") }; }
  catch { return defaults; }
}
export function saveSettings() {
  try { localStorage.setItem("baffle-settings", JSON.stringify(settings)); } catch { /* Storage is optional. */ }
}
function loadProgress() {
  try { return { cleared: 0, ...JSON.parse(localStorage.getItem("baffle-progress") || "{}") }; }
  catch { return { cleared: 0 }; }
}
export function saveProgress() {
  try { localStorage.setItem("baffle-progress", JSON.stringify(progress)); } catch { /* Storage is optional. */ }
}

export function number(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
export function scoreText(n) { return Math.round(n * 10) / 10; }
export function comboMultiplier() { return state.combo >= 6 ? 2 : state.combo >= 4 ? 1.5 : state.combo >= 2 ? 1.2 : 1; }
export function streakMultiplier(streak) { return streak >= 6 ? 2 : streak >= 4 ? 1.5 : streak >= 2 ? 1.2 : 1; }
export function isFrenzy(now = performance.now()) { return now < state.frenzyUntil; }
export function rope() { return Math.max(-1, Math.min(1, (state.scores[0] - state.scores[1]) / ROPE)); }
