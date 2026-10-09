/**
 * Personal records for the PRs page, worked out from finished workouts.
 *
 * Every exercise gets:
 *  - its heaviest set (most weight; most reps at that weight breaks ties),
 *  - its best set by estimated 1-rep max (Epley, reps above 15 counted as 15, so a 50-rep warm-up can't beat a
 *    real working set),
 *  - its record sets: the sets nothing has beaten yet, i.e. no other set had both as much weight and as many reps,
 *  - a history of PRs. The first session of an exercise is its starting point, not a PR. After that a session is a
 *    PR when it lifts a new heaviest weight ("heaviest"), or a set whose estimated 1-rep max is at least 1% higher
 *    than the best so far ("strength"),
 *    or, for bodyweight exercises, more reps in one set than ever ("reps").
 * Weights in kg are compared in lb; each set keeps the unit it was logged in for display.
 */

export const PR_GROUPS = ["Legs", "Chest", "Back", "Shoulders", "Arms", "Core", "Other"];

const KG_TO_LB = 2.20462;
const EPLEY_REP_CAP = 15;
const NEW_PR_DAYS = 14;
const RESTING_DAYS = 45;
const STALLED_SESSIONS = 5;
const TREND_POINTS = 20;
const STRENGTH_PR_MIN_GAIN = 1.01; // a "stronger set" has to beat the best estimated 1-rep max by 1%: Epley is an estimate

// Name keywords first, in this order (so "Leg Curls" is Legs, not Arms); then the workouts' focus.
const GROUP_KEYWORDS = [
  ["Core", /crunch|abdominal|\babs\b|plank|leg raise|back extens|roman chair|sit-?up/i],
  ["Legs", /leg curl|leg ext|leg press|squat|calf|lunge|glute|hip thrust|hamstring|dead ?lift|\bhack/i],
  ["Arms", /tricep|bicep|curl|pushdown|supinat|skull ?crusher|forearm/i],
  ["Shoulders", /shoulder|lateral|delt|face ?pull|overhead|shrug|\brear\b|raise/i],
  ["Back", /\brow\b|pull|\blats?\b|\bchin|\btraps?\b|trapez/i],
  ["Chest", /chest|bench|\bfly\b|\bpec|\bdips?\b|incline/i],
];

/** The muscle group for an exercise: from its name, else the focus it was most often trained under. */
export function muscleGroupFor(name, focusCounts = {}) {
  for (const [group, pattern] of GROUP_KEYWORDS) if (pattern.test(String(name || ""))) return group;
  let best = "Other";
  let bestCount = 0;
  for (const [focus, count] of Object.entries(focusCounts)) {
    const group = PR_GROUPS.find((g) => g.toLowerCase() === String(focus).trim().toLowerCase()) ||
      (/arm/i.test(focus) ? "Arms" : null);
    if (group && count > bestCount) {
      best = group;
      bestCount = count;
    }
  }
  return best;
}

/** Estimated 1-rep max (Epley), with reps above 15 counted as 15. */
export function estimateOneRepMax(weight, reps) {
  const w = Number(weight) || 0;
  const r = Math.min(Number(reps) || 0, EPLEY_REP_CAP);
  if (w <= 0 || r <= 0) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Whole days from date key a to date key b (YYYY-MM-DD). */
export function daysBetweenKeys(a, b) {
  const parse = (key) => {
    const [y, m, d] = String(key).split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  return Math.round((parse(b) - parse(a)) / 864e5);
}

function workoutDateKey(workout) {
  const key = workout?.dateKey || workout?.date;
  return typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

function cleanSet(raw, unit) {
  const reps = parseInt(String(raw?.reps ?? ""), 10) || 0;
  const weight = Number(raw?.weight) || 0;
  if (reps <= 0) return null;
  return { weight, reps, unit, lb: unit === "kg" ? weight * KG_TO_LB : weight };
}

const shortSet = (s) => (s ? { weight: s.weight, reps: s.reps, unit: s.unit } : null);

/**
 * Records for every exercise in a list of finished workouts.
 *   completedSets(exercise) -> the sets that count (the app's completedExerciseSetRows)
 *   today                   -> today's date key (YYYY-MM-DD)
 * Returns { exercises, feed (every PR, newest first), summary }.
 */
export function buildPrRecords(workouts, { completedSets = (ex) => ex?.sets || [], today } = {}) {
  const ordered = (Array.isArray(workouts) ? workouts : [])
    .map((w) => ({ w, date: workoutDateKey(w) }))
    .filter((x) => x.date)
    .sort((a, b) => a.date.localeCompare(b.date) || (Number(a.w.updatedAtMs) || 0) - (Number(b.w.updatedAtMs) || 0));
  const todayKey = today || (ordered.length ? ordered[ordered.length - 1].date : "");

  // Each exercise's sessions, oldest first (an exercise logged twice in one workout is one session).
  const byId = new Map();
  for (const { w, date } of ordered) {
    const unit = w.unit === "kg" ? "kg" : "lb";
    const perWorkout = new Map();
    for (const ex of Array.isArray(w.exercises) ? w.exercises : []) {
      const id = ex?.exerciseId;
      if (!id) continue;
      const sets = (completedSets(ex) || []).map((s) => cleanSet(s, unit)).filter(Boolean);
      if (!sets.length) continue;
      if (!perWorkout.has(id)) perWorkout.set(id, { name: ex.name, sets: [] });
      perWorkout.get(id).sets.push(...sets);
    }
    for (const [id, { name, sets }] of perWorkout) {
      if (!byId.has(id)) byId.set(id, { id, name, focus: {}, sessions: [] });
      const rec = byId.get(id);
      rec.name = name || rec.name;
      for (const f of Array.isArray(w.focus) ? w.focus : []) rec.focus[f] = (rec.focus[f] || 0) + 1;
      rec.sessions.push({ date, workoutId: w.id || w.workoutId || "", unit, sets });
    }
  }

  const exercises = [...byId.values()].map((rec) => describeExercise(rec, todayKey));
  const feed = exercises
    .flatMap((ex) => ex.prs)
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  return { exercises, feed, summary: summarize(exercises, feed, todayKey) };
}

function describeExercise(rec, todayKey) {
  const allSets = rec.sessions.flatMap((s) => s.sets.map((set) => ({ ...set, date: s.date })));
  const bodyweight = allSets.filter((s) => s.lb <= 0).length * 2 >= allSets.length;
  const score = (set) => (bodyweight ? set.reps : estimateOneRepMax(set.lb, set.reps));

  let heaviest = null; // { set, date }
  let best = null; // { set, date, score }
  let mostReps = null; // { set, date }
  const prs = [];
  let lastPrIndex = 0;
  const sessions = rec.sessions.map((session, index) => {
    const top = session.sets.reduce((a, b) => (b.lb > a.lb || (b.lb === a.lb && b.reps > a.reps) ? b : a));
    const strongest = session.sets.reduce((a, b) => (score(b) > score(a) || (score(b) === score(a) && b.lb > a.lb) ? b : a));
    const repsTop = session.sets.reduce((a, b) => (b.reps > a.reps || (b.reps === a.reps && b.lb > a.lb) ? b : a));
    const sessionScore = round1(score(strongest));
    let pr = null;
    if (index > 0) {
      if (bodyweight) {
        if (repsTop.reps > mostReps.set.reps) {
          pr = { kind: "reps", set: repsTop, previous: mostReps, gain: repsTop.reps - mostReps.set.reps };
        }
      } else if (top.lb > heaviest.set.lb + 1e-9) {
        pr = { kind: "heaviest", set: top, previous: heaviest, gain: round1(top.lb - heaviest.set.lb) };
      } else if (sessionScore >= best.score * STRENGTH_PR_MIN_GAIN) {
        pr = { kind: "strength", set: strongest, previous: best, gain: round1(sessionScore - best.score) };
      }
    }
    if (!heaviest || top.lb > heaviest.set.lb || (top.lb === heaviest.set.lb && top.reps > heaviest.set.reps)) heaviest = { set: top, date: session.date };
    if (!best || sessionScore > best.score) best = { set: strongest, date: session.date, score: sessionScore };
    if (!mostReps || repsTop.reps > mostReps.set.reps) mostReps = { set: repsTop, date: session.date };
    if (pr) {
      lastPrIndex = index;
      prs.push({
        exerciseId: rec.id,
        name: rec.name,
        date: session.date,
        workoutId: session.workoutId,
        kind: pr.kind,
        set: shortSet(pr.set),
        previous: { ...shortSet(pr.previous.set), date: pr.previous.date },
        gain: pr.gain,
        estimatedMax: bodyweight ? null : sessionScore,
      });
    }
    return { date: session.date, workoutId: session.workoutId, sets: session.sets.map(shortSet), score: sessionScore, pr: pr ? pr.kind : null };
  });

  const lastPr = prs.length ? prs[prs.length - 1] : null;
  const firstDate = sessions[0].date;
  const lastDate = sessions[sessions.length - 1].date;
  const daysSinceLast = todayKey ? daysBetweenKeys(lastDate, todayKey) : 0;
  const sessionsSincePr = sessions.length - 1 - lastPrIndex;
  let status = "steady";
  if (sessions.length === 1) status = "baseline";
  else if (lastPr && todayKey && daysBetweenKeys(lastPr.date, todayKey) <= NEW_PR_DAYS) status = "new";
  else if (daysSinceLast > RESTING_DAYS) status = "resting";
  else if (sessionsSincePr >= STALLED_SESSIONS) status = "stalled";

  return {
    id: rec.id,
    name: rec.name,
    group: muscleGroupFor(rec.name, rec.focus),
    bodyweight,
    unit: sessions[sessions.length - 1].sets[0]?.unit || "lb",
    sessionCount: sessions.length,
    firstDate,
    lastDate,
    daysSinceLast,
    heaviest: heaviest && heaviest.set.lb > 0 ? { ...shortSet(heaviest.set), date: heaviest.date } : null,
    best: best && !bodyweight ? { ...shortSet(best.set), estimatedMax: best.score, date: best.date } : null,
    mostReps: mostReps ? { ...shortSet(mostReps.set), date: mostReps.date } : null,
    recordSets: bodyweight ? [] : recordSets(allSets),
    prs,
    lastPr,
    sessionsSincePr,
    status,
    sessions,
    trend: sessions.slice(-TREND_POINTS).map((s) => s.score),
  };
}

/** The unbeaten sets: no other set had at least as much weight and at least as many reps. Heaviest first, at most 8. */
function recordSets(allSets) {
  const sorted = [...allSets].sort((a, b) => b.lb - a.lb || b.reps - a.reps || a.date.localeCompare(b.date));
  const out = [];
  let maxReps = 0;
  for (const s of sorted) {
    if (s.lb <= 0) break;
    if (s.reps > maxReps) {
      out.push({ ...shortSet(s), date: s.date });
      maxReps = s.reps;
    }
  }
  return out.slice(0, 8);
}

function summarize(exercises, feed, todayKey) {
  const ago = (date) => (todayKey ? daysBetweenKeys(date, todayKey) : Infinity);
  const recent = feed.filter((p) => ago(p.date) < 30);
  const before = feed.filter((p) => ago(p.date) >= 30 && ago(p.date) < 60);
  const trainedRecently = exercises.filter((ex) => ex.sessions.some((s) => ago(s.date) < 30));
  let biggestJump = null;
  for (const ex of exercises) {
    if (ex.bodyweight) continue;
    const old = ex.sessions.filter((s) => ago(s.date) >= 30);
    const now = ex.sessions.filter((s) => ago(s.date) < 30);
    if (!old.length || !now.length) continue;
    const was = Math.max(...old.map((s) => s.score));
    const is = Math.max(...now.map((s) => s.score));
    const pct = was > 0 ? Math.round(((is - was) / was) * 100) : 0;
    if (pct > 0 && (!biggestJump || pct > biggestJump.pct)) biggestJump = { exerciseId: ex.id, name: ex.name, pct, from: was, to: is };
  }
  return {
    prsLast30: recent.length,
    prsPrevious30: before.length,
    improvedLast30: new Set(recent.map((p) => p.exerciseId)).size,
    trainedLast30: trainedRecently.length,
    stalled: exercises.filter((ex) => ex.status === "stalled").length,
    biggestJump,
    lastPr: feed[0] || null,
  };
}
