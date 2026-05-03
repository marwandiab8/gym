/**
 * Best-set scoring (volume) shared with client `public/js/setScoring.js`.
 * Keep behavior in sync when changing PR or summary logic.
 */

function parseReps(v) {
  return parseInt(String(v ?? ""), 10) || 0;
}

function parseWeight(v) {
  return Number(v) || 0;
}

/** Volume = weight × reps when weight > 0; otherwise rep count (bodyweight / unloaded). */
function prSetVolume(set) {
  const w = parseWeight(set.weight);
  const r = parseReps(set.reps);
  if (w > 0) return w * r;
  return r;
}

function pickBestSetForPR(validSets) {
  if (!validSets.length) return null;
  return validSets.reduce((a, b) => {
    const va = prSetVolume(a);
    const vb = prSetVolume(b);
    if (vb > va) return b;
    if (vb < va) return a;
    const wa = parseWeight(a.weight);
    const wb = parseWeight(b.weight);
    if (wb !== wa) return wb > wa ? b : a;
    return parseReps(b.reps) > parseReps(a.reps) ? b : a;
  });
}

/** Sets with at least one rep, or positive weight with reps (reps required for loaded volume). */
function filterScorableSets(sets) {
  return (Array.isArray(sets) ? sets : [])
    .map((raw) => ({ weight: parseWeight(raw?.weight), reps: parseReps(raw?.reps) }))
    .filter((s) => s.reps > 0);
}

function isNewPRBeatsCurrent(best, current) {
  const bestVol = prSetVolume(best);
  const curVol = prSetVolume({ weight: current.weight ?? 0, reps: current.reps ?? 0 });
  if (bestVol > curVol) return true;
  if (bestVol < curVol) return false;
  if (parseWeight(best.weight) > parseWeight(current.weight)) return true;
  if (parseWeight(best.weight) < parseWeight(current.weight)) return false;
  return parseReps(best.reps) > parseReps(current.reps);
}

function buildExerciseSummaries(workout) {
  return (workout?.exercises || [])
    .filter((exercise) => typeof exercise?.exerciseId === "string" && exercise.exerciseId.trim() !== "")
    .map((exercise) => {
      const valid = filterScorableSets(exercise.sets);
      const best = pickBestSetForPR(valid);
      if (!best) {
        return {
          exerciseId: exercise.exerciseId,
          name: String(exercise.name || "Exercise"),
          bestVolume: 0,
          bestWeight: 0,
          bestReps: 0,
          maxWeight: 0,
          maxReps: 0,
        };
      }
      const vol = prSetVolume(best);
      return {
        exerciseId: exercise.exerciseId,
        name: String(exercise.name || "Exercise"),
        bestVolume: vol,
        bestWeight: best.weight,
        bestReps: best.reps,
        maxWeight: best.weight,
        maxReps: best.reps,
      };
    });
}

module.exports = {
  parseReps,
  parseWeight,
  prSetVolume,
  pickBestSetForPR,
  filterScorableSets,
  isNewPRBeatsCurrent,
  buildExerciseSummaries,
};
