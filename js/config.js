/* Game data: exercises, scoring constants, and the boss roster. */

export const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
export const VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
export const NAMES = { squats: "Squats", jacks: "Jumping Jacks", pushups: "Push-ups", plank: "Straight-Arm Plank", punches: "Punches" };
// Tips assume the camera is on the floor, tilted up, with the whole body in frame.
export const TIPS = {
  squats: "Face the camera and sit down low, thighs toward the floor.",
  jacks: "Face the camera: hands all the way up, feet out wide.",
  pushups: "Face the camera or turn sideways, body straight from head to heels.",
  plank: "Arms straight under your shoulders, body in a straight line. Face the camera or turn sideways.",
  punches: "Face the camera, guard up, and punch toward it at chest height."
};
// Damage per rep relative to a squat. Punches come fast, so each is worth less.
export const REP_VALUE = { squats: 1, jacks: 1, pushups: 1.5, plank: 1, punches: .25 };
// The shortest time between two camera reps from one player.
export const REP_GAP = { punches: 200 };
// How long the full-screen "SWITCH TO" callout stays up; reps count right away.
export const SWITCH_CALLOUT = 2000;
export const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
export const points = { clean: 2, ok: 1, bad: 0.5 };
export const feedback = { clean: "CLEAN", ok: "OK", bad: "SLOPPY" };
export const HEARTS = 5, PLANK_TICK = 1200, ROPE = 25, DUEL_TIME = 45000;

// Difficulty sets the fight: `hp` is per player, and the boss calls a random move
// from `moves` for each player on their own timer of `switchEvery` [min, max] ms.
// Every boss attack costs a heart. `attackEvery` is set so a team at a typical pace
// loses about one heart on Easy, two on Normal, and three or four on Hard; only on
// Hard can a slow team run out of hearts (at 90 s) before the clock does.
// `poseEvery` [min, max] ms is how often each player is frozen for Strike a Pose.
// `level` is only for show, on the boss's status panel.
export const DIFFICULTIES = {
  easy: { name: "Easy", blurb: "Standing moves only, with slow switches.", hp: 24, time: 90, attackEvery: 40000, level: 15,
    switchEvery: [14000, 20000], poseEvery: [35000, 50000], moves: ["squats", "punches", "jacks"] },
  normal: { name: "Normal", blurb: "Adds push-ups, and the boss switches faster.", hp: 36, time: 90, attackEvery: 28000, level: 30,
    switchEvery: [10000, 15000], poseEvery: [25000, 40000], moves: ["squats", "punches", "jacks", "pushups"] },
  hard: { name: "Hard", blurb: "Every move, straight-arm planks included, at a fast pace.", hp: 50, time: 100, attackEvery: 18000, level: 50,
    switchEvery: [8000, 12000], poseEvery: [18000, 30000], moves: ["squats", "punches", "jacks", "pushups", "plank"] }
};

// Strike a Pose: now and then the boss freezes one player, who can't deal damage
// until they hold the called pose for POSE_HOLD ms. The spell wears off after
// POSE_TIMEOUT ms so a pose the camera can't see never leaves anyone stuck.
export const POSES = {
  tPose: { name: "T-Pose", hint: "Arms straight out to the sides" },
  flex: { name: "Flex", hint: "Elbows out at shoulder height, fists up" },
  headTouch: { name: "Hands on Head", hint: "Both hands on top of your head" },
  sixSeven: { name: "6-7", hint: "Palms up in front of you, bounce your hands up and down in turn" }
};
export const POSE_HOLD = 600, POSE_TIMEOUT = 12000;
// What the monster says when it freezes someone: `{name}` is the player, `{pose}` the pose.
export const POSE_LINES = ["Freeze, {name}! Strike a pose: {pose}!", "{name}, you're under my spell! {pose}, now!", "Not so fast, {name}. {pose}!"];

// What a monster tells a player to do when it calls a new move, filling `{command}` in its lines.
export const COMMANDS = {
  squats: "start doing squats", jacks: "start doing jumping jacks", pushups: "drop and give me push-ups",
  plank: "hold a straight-arm plank", punches: "start throwing punches"
};

// Each fight draws one of these monsters at random; it sets the look and the lines.
// `lines` are what it says when it calls a new move: `{name}` is the player.
// Sprites are full-body pixel maps, any size, drawn with a dark outline added around
// them; "." is empty. `attackFx` picks the projectile its attack throws (see ATTACK_FX
// in ui.js), and `ground` colors the patch of ground it stands on.
// Set `image` to a PNG path to use generated art instead of the pixel map.
export const BOSSES = [
  { id: "wolf", name: "The Big Bad Wolf", taunt: "I'll huff, and I'll puff…", attack: "The Wolf huffs and puffs",
    victory: "Grandmother is safe, and the forest path is clear.",
    lines: ["{name}, {command}!", "Little pig {name}… {command}, or I'll blow your house down!", "Huff, puff! {name}, {command}!"],
    attackFx: "wind", ground: "#88b04b",
    palette: { d: "#2e323b", G: "#4a505c", g: "#7d8696", h: "#a9b2c0", W: "#f4ecdc", w: "#c9bfae", Y: "#f3c351", K: "#120d0a", R: "#c2453a", r: "#7e2219", B: "#6b4428", b: "#4a2e1b" },
    sprite: [
      "................................",
      ".....d....................d.....",
      ".....dd..................dd.....",
      "....dGGd................dGGd....",
      "....dGrGd...dddddddd...dGrGd....",
      "....dGrrGdddGGGGGGGGdddGrrGd....",
      "....dGGGGGGGGggggggGGGGGGGGd....",
      "...dGGgKKgggggghhggggggKKgGGd...",
      "...dGgggKKgggghhhhggggKKgggGd...",
      "...dGggYYKggggghhgggggKYYggGd...",
      "....dGgggggggWWWWWWgggggggGd....",
      "....dGGgggWWWWWWWWWWWWgggGGd....",
      ".....dGgWWWWWWKKKKWWWWWWgGd.....",
      ".....dGWWWWWWWKKKKWWWWWWWGd.....",
      "....dGWKWWWWWWWWWWWWWWWWKWGd....",
      "....dGWKKKKKKKKKKKKKKKKKKWGd....",
      "...dGGWWKRRRRRRRRRRRRRRKWWGGd...",
      "..dGdGGgWWKKKKKKKKKKKKWWgGGdGd..",
      ".dGd.dGGgWWWWWWWWWWWWWWgGGd.dGd.",
      "..d..dGGGgwwwwwwwwwwwwgGGGd..d..",
      "....dGGGGGwwwwwwwwwwwwGGGGGd....",
      "...dGGgdGGgwwwwwwwwwwgGGdgGGd...",
      "..dGGgd.dGGwwwwwwwwwwGGd.dgGGd..",
      ".dGgd...dGGwwwwwwwwwwGGd...dgGd.",
      ".dGd....dGGgwwwwwwwwgGGd....dGd.",
      "WdWd....dGGgwwwwwwwwgGGd....dWdW",
      "W.W.....dBBBBBBBBBBBBBBd.....W.W",
      "........dBbBBBBBBBBBBbBd........",
      "........dBBBbBB..BBbBBBd........",
      "........dGGgGd....dGgGGd........",
      ".......dGGggGd....dGggGGd.......",
      "......dWdWdGd......dGdWdWd......"
    ] },
  { id: "troll", name: "The Bridge Troll", taunt: "None shall cross my bridge!", attack: "The Troll swings his club",
    victory: "The bridge is yours to cross.",
    lines: ["{name}, {command}!", "Troll toll! {name}, {command}!", "No crossing for you, {name}, until you {command}!"],
    attackFx: "rock", ground: "#a8936a",
    palette: { H: "#2f4a24", g: "#6b9a45", l: "#8fbf5f", E: "#557c37", K: "#120d0a", W: "#f4ecdc", N: "#4c7232", T: "#efe3c2", b: "#6b4428", B: "#4a2e1b" },
    sprite: [
      "....................................",
      "..............................BBBB..",
      ".............................BbbbbB.",
      "............................BbbBbbbB",
      "............................BbbbbBbB",
      "..............HHHHHHHH......BbBbbbbB",
      ".............HggggggggH......BbbbbB.",
      "..........EE.HggllllggH.EE....BbbB..",
      "..........EgEHgKKllKKgHEgE....BbbB..",
      "...........EEHgWKggKWgHEE......bB...",
      "............HggggNNggggH.......bB...",
      ".............HgggNNgggH........bB...",
      "......HHHHHHHHgTKKKKTgHHHHHH...bB...",
      "....HHgggggggHggKKKKggHggggg...bB...",
      "...HggllllgggggHHHHHHgggggll...bB...",
      "..Hgglllgggggggggggggggggggg...bB...",
      ".Hggllgggggggggllllllggggggg...bB...",
      ".HgglgggHgggggllllllllgggggH...bB...",
      ".HggggggHHggggllllllllggggHH...bB...",
      ".HgggggH.HggggllllllllggggH....bB...",
      ".HgggggH.HgggggllggllgggggH....bB...",
      ".HgggggH.HBBBBBBBBBBBBBBBBH....bB...",
      ".HggggH..HbbbbbbbbbbbbbbbbH....bB...",
      "HgggggH..HbbbbbbbbbbbbbbbbH..HgggggH",
      "HlgggggH.HbbbbBbbbbbbBbbbbH.HggggglH",
      "HggKggKH.HgbbbbbbbbbbbbbbgH.HKggKggH",
      ".HHHHHH..HgbbbbBbbbbBbbbbgH..HHHHHH.",
      "........HggHbbbbbbbbbbbbHggH........",
      "........HgggH..........HgggH........",
      ".......HggggH..........HggggH.......",
      ".......HgggggH........HgggggH.......",
      "......HHHHHHHH........HHHHHHHH......"
    ] },
  { id: "witch", name: "The Wicked Witch", taunt: "Into the oven with you!", attack: "The Witch hurls a curse",
    victory: "Hansel and Gretel are free.",
    lines: ["{name}, {command}!", "Hee hee hee! {name}, {command}!", "Into the cauldron unless you {command}, {name}!"],
    attackFx: "curse", ground: "#8c7ca4",
    palette: { P: "#3a2050", p: "#5b3a7a", q: "#7e58a0", Y: "#e8bb59", f: "#88b04b", F: "#5f7f2f", K: "#120d0a", W: "#f4ecdc", R: "#8e2b2b", H: "#1a1210", b: "#6b4428", y: "#d9b44a", N: "#4c6a2a" },
    sprite: [
      "................................",
      "...............PP...............",
      "..............PPPP..............",
      ".............PPppPP.............",
      ".............PppppP.............",
      "............PPppppPP............",
      "............PppqqppP............",
      "...........PPppppppPP...........",
      "...........YYYYYYYYYY...........",
      "......PPPPPPPPPPPPPPPPPPPP......",
      "....PPPPPPPPPPPPPPPPPPPPPPPP....",
      ".......HHffffffffffffffHH.......",
      "..b...HHfKKffffffffffKKfHH......",
      "..b...HHfWKffffffffffKWfHH......",
      "..b..HHHffffffFFFFffffffHHH.....",
      "..b..HHHfffffFFFFFFNffffHHH.....",
      "..b.HHH.ffRRRFFFFFFRRRff.HHH....",
      "..b.HH...fRRRRRRRRRRRRf...HH....",
      "..b.HH....ffffffffffff....HH....",
      "..bHH...pPPPPPPPPPPPPPPp...HH...",
      "..b...PPPPpPPPPPPPPPPpPPPP......",
      "..b..PPPppPPPPPPPPPPPPppPPP.....",
      "..b.PPpppPPPPqPPPPqPPPPpppPP....",
      "..bPPpPPPPPPPqPPPPqPPPPPPPpPP...",
      "..fffPPPPPPPPqPPPPqPPPPPPPPfff..",
      "..b...PPPPPPPqPPPPqPPPPPPPPPff..",
      ".yyy..PPPPPPPqPPPPqPPPPPPPPP....",
      "yyyyy.PPPPPPPqPPPPqPPPPPPPPPP...",
      "yyyyyyPPPPPPPqPPPPqPPPPPPPPPPP..",
      "yYyYyyPPPPPPPqPPPPqPPPPPPPPPPPP.",
      "yyyyyyPPPPPPPPPPPPPPPPPPPPPPPPP.",
      "y.y.y.KKK..............KKKK....."
    ] },
  { id: "dragon", name: "The Tower Dragon", taunt: "The kingdom burns tonight.", attack: "The Dragon breathes fire",
    victory: "The kingdom is saved.",
    lines: ["{name}, {command}!", "Kneel, {name}! Now {command}!", "Hear me, {name}: {command}, or burn!"],
    attackFx: "fire", ground: "#c08a5c",
    palette: { R: "#b8382c", r: "#7e2219", L: "#e0604a", Y: "#f3c351", y: "#c98f2a", H: "#efe3c2", K: "#120d0a", W: "#6a3a7a", w: "#4a2458", E: "#f3c351" },
    sprite: [
      "........................................",
      "W.............H..........H.............W",
      "Ww............HH........HH............wW",
      "WwWw...........HRRRRRRRRH...........wWwW",
      "WwwWw.........rRRRRRRRRRRr.........wWwwW",
      "WwwwWw........rRLLRRRRLLRr........wWwwwW",
      "WwwwwWw......rRREKRRRRKERRr......wWwwwwW",
      "WwwwwwWw.....rRRRRRRRRRRRRr.....wWwwwwwW",
      "WwwwwwwWw.....rRRRrrrrRRRr.....wWwwwwwwW",
      "WwwwwwwwWw....rRRRKrrKRRRr....wWwwwwwwwW",
      "WwwwwwwwwWw....rRRrrrrRRr....wWwwwwwwwwW",
      "WwwwwwwwwwWw...rRHrrrrHRr...wWwwwwwwwwwW",
      "WwwwwwwwwwwWr..rRRRRRRRRr..rWwwwwwwwwwwW",
      ".WwwwwwwwwwWrRRRRRYYYYRRRRRrWwwwwwwwwwW.",
      "..WwwwwwwwwwRRRRRYYYYYYRRRRRwwwwwwwwwW..",
      "...WwwwwwwrRRRRRYYyYYyYYRRRRRrwwwwwwW...",
      "....WwwwwRRRRRRRYYYYYYYYRRRRRRRwwwwW....",
      ".....WwwRLRRRRRRYyYYYYyYRRRRRRLRwwW.....",
      "......WRLRRRrRRRYYYYYYYYRRRrRR.......rr.",
      ".......RRRr.rRRRYYyYYyYYRRRr.r......rRRr",
      "......HRHr..rRRRYYYYYYYYRRRr.........Rr.",
      ".......H....rRRRYyYYYYyYRRRr.........Rr.",
      "............rRRRRYYYYYYRRRRr........rR..",
      "...........rRRRRRRYYYYRRRRRRr......rRr..",
      "...........rRRRRRRRRRRRRRRRRr.....rRr...",
      "..........rRRRrrRRRRRRRRrrRRRr..rrRr....",
      "..........rRRRRRr......rRRRRRrrRRr......",
      "..........rRRRRRr......rRRRRRr..........",
      ".........rRRRRRRr......rRRRRRRr.........",
      ".........rRRRRRRRr....rRRRRRRRr.........",
      "........HrHrHRRRr......rRRRHrHrH........",
      "........................................"
    ] }
];

