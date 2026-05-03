/**
 * Best-set scoring — keep in sync with `functions/lib/setScoring.js`.
 */

export function parseReps(v) {
  return parseInt(String(v ?? ""), 10) || 0;
}

export function parseWeight(v) {
  return Number(v) || 0;
}

/** Volume = weight × reps when weight > 0; otherwise rep count (bodyweight / unloaded). */
export function prSetVolume(set) {
  const w = parseWeight(set.weight);
  const r = parseReps(set.reps);
  if (w > 0) return w * r;
  return r;
}

export function pickBestSetForPR(validSets) {
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

export function filterScorableSets(sets) {
  return (Array.isArray(sets) ? sets : [])
    .map((raw) => ({ weight: parseWeight(raw?.weight), reps: parseReps(raw?.reps) }))
    .filter((s) => s.reps > 0);
}

/** Peak metric for charts from a summary row (new or legacy). */
export function chartPeakFromSummary(summaryMatch) {
  if (!summaryMatch) return null;
  if (summaryMatch.bestVolume != null && (summaryMatch.bestWeight != null || summaryMatch.bestReps != null)) {
    const vol = Number(summaryMatch.bestVolume) || 0;
    const w = Number(summaryMatch.bestWeight) || 0;
    const r = Number(summaryMatch.bestReps) || 0;
    if (vol <= 0 && r <= 0) return null;
    return { volume: vol, weight: w, reps: r };
  }
  const mw = Number(summaryMatch.maxWeight) || 0;
  const mr = Number(summaryMatch.maxReps) || 0;
  if (mw <= 0 && mr <= 0) return null;
  if (mw > 0 && mr > 0) return { volume: mw * mr, weight: mw, reps: mr };
  if (mr > 0) return { volume: mr, weight: 0, reps: mr };
  return { volume: 0, weight: mw, reps: 0 };
}

/** Peak from raw workout exercise (fallback when summary missing). */
export function isNewPRBeatsCurrent(best, current) {
  const bestVol = prSetVolume(best);
  const curVol = prSetVolume({ weight: current.weight ?? 0, reps: current.reps ?? 0 });
  if (bestVol > curVol) return true;
  if (bestVol < curVol) return false;
  if (parseWeight(best.weight) > parseWeight(current.weight)) return true;
  if (parseWeight(best.weight) < parseWeight(current.weight)) return false;
  return parseReps(best.reps) > parseReps(current.reps);
}

export function chartPeakFromRawExercise(rawExercise) {
  if (!rawExercise?.sets?.length) return null;
  const valid = filterScorableSets(rawExercise.sets);
  const best = pickBestSetForPR(valid);
  if (!best) return null;
  return { volume: prSetVolume(best), weight: best.weight, reps: best.reps };
}
