/* Game data: exercises, scoring constants, and the boss roster. */

export const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
export const VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
export const NAMES = { squats: "Squats", jacks: "Jumping Jacks", pushups: "Push-ups", plank: "Plank" };
export const TIPS = {
  squats: "Keep your full body in frame.", jacks: "Keep your full body in frame.",
  pushups: "Turn sideways and keep your full body in frame.", plank: "Get down sideways to the camera and hold a straight line."
};
export const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
export const points = { clean: 2, ok: 1, bad: 0.5 };
export const feedback = { clean: "CLEAN", ok: "OK", bad: "SLOPPY" };
export const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
export const HEARTS = 3, PARRY_WINDOW = 2500, PLANK_TICK = 1200, ROPE = 25, DUEL_TIME = 45000;

// Each boss is a story chapter. Phases rotate exercises as its health drops.
// Sprites are 16×16 pixel maps; set `image` to a PNG path to use generated art instead.
export const BOSSES = [
  { id: "wolf", name: "The Big Bad Wolf", taunt: "I'll huff, and I'll puff…", attack: "The Wolf huffs and puffs",
    story: "Reach Grandmother's cottage before the Wolf does.", victory: "Grandmother is safe. The forest path opens.",
    phases: ["squats", "jacks"], hp: 24, time: 75, attackEvery: 11000,
    palette: { G: "#3b3f4a", g: "#7d8696", Y: "#f3c351", K: "#120d0a", W: "#f4ecdc", R: "#c2453a" },
    sprite: ["................","..GG........GG..",".GgG........GgG.",".GggG......GggG.",".GgggGGGGGGgggG.","..GggggggggggG..","..GgYYggggYYgG..","..GgYKggggKYgG..","..GggggggggggG..","...GgggWWgggG...","...GggWKKWggG...","....GgWWWWgG....","....GWRWWRWG....",".....GWWWWG.....","......GGGG......","................"] },
  { id: "troll", name: "The Bridge Troll", taunt: "None shall cross my bridge!", attack: "The Troll swings his club",
    story: "Cross the old stone bridge into the enchanted wood.", victory: "The bridge is yours. The wood lies ahead.",
    phases: ["squats", "jacks", "squats"], hp: 32, time: 90, attackEvery: 10000,
    palette: { H: "#2f4a24", g: "#6b9a45", E: "#557c37", K: "#120d0a", W: "#f4ecdc", N: "#4c7232", T: "#efe3c2", b: "#6b4428" },
    sprite: ["................","....HHHHHHHH....","...HggggggggH...","..HggggggggggH..",".EHgKKggggKKgHE.",".EHgKWggggWKgHE.","..HggggNNggggH..","..HgggNNNNgggH..","..HgTggggggTgH..","..HgTTTTTTTTgH..","...HggggggggH...","..HHHggggggHHH..",".HgggHHHHHHgggH.",".Hgg.HbbbbH.ggH.",".HH..HbbbbH..HH.","................"] },
  { id: "witch", name: "The Wicked Witch", taunt: "Into the oven with you!", attack: "The Witch hurls a curse",
    story: "Free Hansel and Gretel from the gingerbread house.", victory: "The children are free. The tower looms.",
    phases: ["jacks", "squats", "plank"], hp: 40, time: 90, attackEvery: 9000,
    palette: { P: "#4b2a63", Y: "#e8bb59", k: "#1a1210", f: "#88b04b", K: "#120d0a", N: "#5f7f2f", R: "#8e2b2b" },
    sprite: [".......PP.......","......PPPP......",".....PPPPPP.....","....PPPPPPPP....","..PPPPPPPPPPPP..",".PPPPYYYYYYPPPP.","....kffffffk....","...kffKffKffk...","...kfffNNfffk...","...kffffNfffk...","....kfRRRRfk....",".....kffffk.....","....PPPPPPPP....","...PPPPPPPPPP...","..PPPPPPPPPPPP..","................"] },
  { id: "dragon", name: "The Tower Dragon", taunt: "The kingdom burns tonight.", attack: "The Dragon breathes fire",
    story: "Storm the tower and save the kingdom.", victory: "The kingdom is saved.",
    phases: ["squats", "jacks", "plank", "squats"], hp: 50, time: 120, attackEvery: 8000,
    palette: { H: "#efe3c2", R: "#b8382c", r: "#7e2219", Y: "#f3c351", K: "#120d0a", W: "#6a3a7a", O: "#f39b2f" },
    sprite: ["..H..........H..","..HH........HH..","...RR......RR...","...RRRRRRRRRR...","..RRRRRRRRRRRR..","..RRYKRRRRKYRR..",".WRRRRRRRRRRRRW.","WWRRRRRRRRRRRRWW","WW.RRRrrrrRRR.WW","W..RRrHrrHrRR..W","...RRrrrrrrRR...","....RRrOOrRR....","....RRROORRR....",".....RRRRRR.....","......RRRR......","................"] }
];
