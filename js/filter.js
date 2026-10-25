/* One Euro filter for pose landmarks (Casiez, Roussel & Vogel, 2012). It smooths
   hard while a point is still and hardly at all while it moves fast, so jitter
   drops without lagging quick reps like punches. */

// Cutoffs are in hertz. `beta` sets how fast the cutoff rises with speed, in the
// points' own units per second: image coordinates span 0–1 of the frame, world
// coordinates are meters, about three times larger for the same body.
const IMAGE = { minCutoff: 1, beta: 20 }, WORLD = { minCutoff: 1, beta: 7 };
const SPEED_CUTOFF = 1;
// A longer gap starts the filter over, so a player coming back into view isn't
// blended with where they were.
const RESET_AFTER = 500;

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

// One player's filter state, carried from frame to frame.
export function newPoseFilter() { return { at: -Infinity, image: [], world: [] }; }

// Returns filtered copies of a frame's image and world landmarks. Visibility is
// passed through unchanged.
export function filterPose(filter, landmarks, world, now) {
  const dt = (now - filter.at) / 1000;
  const fresh = !(dt > 0 && dt * 1000 <= RESET_AFTER);
  filter.at = now;
  return {
    landmarks: filterPoints(landmarks, filter.image, dt, fresh, IMAGE),
    world: filterPoints(world, filter.world, dt, fresh, WORLD)
  };
}
function filterPoints(points, store, dt, fresh, params) {
  return points?.map((point, i) => {
    const kept = store[i] ??= {};
    const out = { ...point };
    for (const axis of ["x", "y", "z"]) {
      if (typeof point[axis] !== "number") continue;
      if (fresh || !kept[axis]) kept[axis] = { value: point[axis], speed: 0 };
      else out[axis] = step(kept[axis], point[axis], dt, params);
    }
    return out;
  });
}
function step(s, value, dt, { minCutoff, beta }) {
  s.speed += alpha(SPEED_CUTOFF, dt) * ((value - s.value) / dt - s.speed);
  s.value += alpha(minCutoff + beta * Math.abs(s.speed), dt) * (value - s.value);
  return s.value;
}
