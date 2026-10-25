/* Shared game state, saved settings, and scoring helpers. */

import { BOSSES, DIFFICULTIES, HEARTS, ROPE } from "./config.js";

export const settings = loadSettings();
export const state = {
  screen: "menu", mode: "solo", bossIndex: 0,
  difficulty: Object.hasOwn(DIFFICULTIES, settings.difficulty) ? settings.difficulty : "normal",
  status: "idle", session: 0, stream: null, landmarker: null,
  modelPromise: null, raf: 0, tick: 0, countdownTimer: 0, lobbyTimer: 0, alertTimer: 0,
  lastVideoTime: -1, lastFrameAt: 0, fps: 0, keyboardOnly: false,
  trackers: [newTracker(), newTracker()],
  combo: 0, bestCombo: 0, frenzyUntil: 0, cleanEvents: 0, repEvents: 0,
  lastEvents: [null, null], endAt: 0, duration: 0, lastTickAt: 0,
  bossHp: 0, bossMax: 0, hearts: HEARTS, attack: null, nextAttackAt: 0, parries: 0,
  scores: [0, 0], cameraToken: 0, cameraBusy: false,
  party: null, searching: false, roster: [], myIndex: 0,
  mic: null, micBusy: false, micMuted: false, micError: false, remoteAudio: new Map(), partyReps: [], partyMoves: [], remoteStreams: new Map(),
  audio: null, toastTimer: 0
};
// Online (a remote party or a matchmade 1v1), each device tracks one person and the
// host keeps score for everyone.
export const online = () => Boolean(state.party);
export const solo = () => state.mode === "solo" || online();
export const teamMode = () => state.mode === "coop" || state.mode === "party";
export const isHost = () => online() && state.party.isHost;
export const isGuest = () => online() && !state.party.isHost;
export const playerCount = () => online() ? Math.max(1, state.roster.length) : state.mode === "coop" || state.mode === "duel" ? 2 : 1;
export const boss = () => BOSSES[state.bossIndex];
export const difficulty = () => DIFFICULTIES[state.difficulty];
export const activeTrackers = () => state.trackers.slice(0, playerCount());
// The players this device's camera tracks: one in a party, otherwise everyone.
export const localTrackers = () => online() ? state.trackers.slice(0, 1) : activeTrackers();
// What the monster calls each player: their party name, or the names from the setup screen.
export function playerName(index) {
  if (online()) return state.roster[index]?.name || "Adventurer";
  return (index === 0 ? settings.name : settings.name2) || (state.mode === "solo" ? "Hero" : `Player ${index + 1}`);
}

export function newTracker() {
  // `exercise` is this player's current move; reps are ignored until `readyAt`.
  return { x: null, y: null, seenAt: 0, phase: "UP", angles: [], angle: null, exercise: null, readyAt: 0, switchAt: 0,
    visibility: 0, minAngle: 180, maxLean: 0, cleanJack: false, straight: false,
    holdStart: 0, holdMin: 180, streak: 0, method: null, unit: "°", topY: null, maxDepth: 0, arms: newArms(),
    form: "—", reps: 0, lastRepAt: -Infinity, lastEventAt: 0 };
}
function newArms() { return [{ phase: "GUARD", max: 0 }, { phase: "GUARD", max: 0 }]; }
// Drop any half-finished movement, keeping the player's position for assignment.
export function resetMotion(t) {
  t.phase = "UP"; t.angles = []; t.angle = null; t.minAngle = 180; t.maxLean = 0;
  t.cleanJack = false; t.straight = false; t.holdStart = 0; t.holdMin = 180;
  t.method = null; t.topY = null; t.maxDepth = 0; t.arms = newArms();
}

function loadSettings() {
  const defaults = { sound: true, effects: true, debug: false, sensitivity: 0, swapped: false, name: "", name2: "", players: 1, difficulty: "normal" };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem("buffle-settings") || "{}") }; }
  catch { return defaults; }
}
export function saveSettings() {
  try { localStorage.setItem("buffle-settings", JSON.stringify(settings)); } catch { /* Storage is optional. */ }
}


export function number(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
export function scoreText(n) { return Math.round(n * 10) / 10; }
export function comboMultiplier() { return state.combo >= 6 ? 2 : state.combo >= 4 ? 1.5 : state.combo >= 2 ? 1.2 : 1; }
export function streakMultiplier(streak) { return streak >= 6 ? 2 : streak >= 4 ? 1.5 : streak >= 2 ? 1.2 : 1; }
export function isFrenzy(now = performance.now()) { return now < state.frenzyUntil; }
export function rope() { return Math.max(-1, Math.min(1, (state.scores[0] - state.scores[1]) / ROPE)); }
