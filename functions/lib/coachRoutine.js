// "Make it a routine": the coach's next-session plan (a paragraph in a coach report) turned into a routine the app can
// save - each exercise from the athlete's own list, with a target weight and reps for every working set. Used by the
// coachNextSessionRoutine function in index.js; the app saves the result in users/{uid}/templates.

const MAX_PLAN_EXERCISES = 12;
const MAX_PLAN_SETS = 10;
const MAX_KNOWN_EXERCISES = 200;

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const nameKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const ROUTINE_PLAN_SYSTEM_PROMPT = [
  "You turn a strength coach's plan for the athlete's next session into a workout routine for their training app.",
  "You get the plan (a paragraph), the weight unit, and the exercises the athlete has logged before (id and name).",
  "",
  "Reply with only a JSON object in exactly this shape (no markdown):",
  '{"name":"Legs - coach plan","note":"Rest 3-5 min on squats and hack squats, 1-2 min on the rest.",',
  '"exercises":[{"id":"wger_1627","name":"Barbell squat","sets":[{"weight":"45","reps":"15"},{"weight":"225","reps":"6"}],"note":"Stop 1-2 reps short"}]}',
  "",
  "Rules:",
  "- Every exercise in the plan, in the plan's order, nothing added. Use the id and the name exactly as they are in the",
  "  athlete's list when the plan means that exercise (match by meaning: 'leg curl' -> their 'Lying Leg Curls',",
  "  'hanging leg raises' -> 'Hanging Leg Raises'); id \"\" and a plain name for one they have never logged.",
  "- sets: one entry per set the plan gives, in order, warm-ups included when the plan lists them. weight: the number",
  "  only, in the given unit, as text (\"225\"); \"\" for bodyweight or when the plan gives no weight. reps: a number or",
  "  a range as text (\"6\", \"8-10\"); \"\" when the plan gives none. '2 sets of 6 at 225' is two entries; '3 sets'",
  "  with no numbers is three entries with weight \"\" and reps \"\".",
  "- note per exercise: a few words the plan says about it (\"don't force reps\", \"seat 6\"), or \"\".",
  "- name: a short routine name (up to 40 characters) for the session, e.g. 'Legs - coach plan'.",
  "- note: the plan's general advice (rest, effort) in up to 2 sentences, or \"\".",
  "- Use only what the plan says; never invent loads or reps.",
].join("\n");

/** The exercises the athlete has logged, newest workouts first: [{ id, name }], one per id, at most 200. */
function knownExercisesFromWorkouts(workouts) {
  const seen = new Map();
  for (const w of Array.isArray(workouts) ? workouts : []) {
    for (const ex of Array.isArray(w && w.exercises) ? w.exercises : []) {
      const id = clip(ex && ex.exerciseId, 120);
      if (id && !seen.has(id)) seen.set(id, clip(ex.name, 80) || "Exercise");
    }
  }
  return [...seen.entries()].slice(0, MAX_KNOWN_EXERCISES).map(([id, name]) => ({ id, name }));
}

/** The user message: the plan, the unit, and their exercises. */
function routinePlanUserMessage({ text, unit, exercises }) {
  return JSON.stringify({ plan: clip(text, 1500), unit: unit === "kg" ? "kg" : "lb", athleteExercises: exercises || [] });
}

const loadText = (v) => {
  const t = clip(v, 12).replace(/\s*(lb|lbs|kg)$/i, "");
  return /^\d+(\.\d+)?$/.test(t) ? t : "";
};
const repsText = (v) => {
  const t = clip(v, 12).replace(/\s*reps?$/i, "");
  return /^\d+(\s*-\s*\d+)?$/.test(t) ? t.replace(/\s+/g, "") : "";
};

/** The model's reply checked: { name, note, exercises: [{ exerciseId, name, sets: [{ weight, reps }], note }] }, or null. */
function normalizeRoutinePlan(raw) {
  let data = raw;
  if (typeof raw === "string") {
    const body = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    try {
      data = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
    } catch (_) {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const exercises = (Array.isArray(data.exercises) ? data.exercises : [])
    .map((ex) => {
      if (!ex || typeof ex !== "object") return null;
      const name = clip(ex.name, 80);
      // Every set the plan gives counts, even with no numbers ("3 leg-curl sets"): it's still a set to do.
      const given = (Array.isArray(ex.sets) ? ex.sets : [])
        .map((s) => (s && typeof s === "object" ? { weight: loadText(s.weight), reps: repsText(s.reps) } : { weight: "", reps: "" }))
        .slice(0, MAX_PLAN_SETS);
      const sets = given.length ? given : [{ weight: "", reps: "" }];
      const id = clip(ex.id ?? ex.exerciseId, 120);
      return name ? { exerciseId: /^[A-Za-z0-9_-]+$/.test(id) ? id : "", name, sets, note: clip(ex.note, 160) } : null;
    })
    .filter(Boolean)
    .slice(0, MAX_PLAN_EXERCISES);
  if (!exercises.length) return null;
  return { name: clip(data.name, 40) || "Coach plan", note: clip(data.note, 300), exercises };
}

/**
 * Each planned exercise tied to one the athlete has logged: by the id the model gave (only if it really is theirs),
 * else by the same name (letters and digits only, any case). Matched exercises take their name from the athlete's
 * list; the rest keep exerciseId "" (the app makes them as the athlete's own exercises when it saves the routine).
 */
function resolvePlanExercises(plan, known) {
  if (!plan) return null;
  const byId = new Map((known || []).map((k) => [k.id, k.name]));
  const byName = new Map((known || []).map((k) => [nameKey(k.name), k.id]));
  return {
    ...plan,
    exercises: plan.exercises.map((ex) => {
      const id = byId.has(ex.exerciseId) ? ex.exerciseId : byName.get(nameKey(ex.name)) || "";
      return { ...ex, exerciseId: id, name: id ? byId.get(id) : ex.name };
    }),
  };
}

module.exports = {
  MAX_PLAN_EXERCISES,
  ROUTINE_PLAN_SYSTEM_PROMPT,
  knownExercisesFromWorkouts,
  normalizeRoutinePlan,
  resolvePlanExercises,
  routinePlanUserMessage,
};
