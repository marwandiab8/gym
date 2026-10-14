const test = require("node:test");
const assert = require("node:assert/strict");

const {
  COACH_SYSTEM_PROMPT,
  buildRecentAnalysisFacts,
  buildWorkoutAnalysisFacts,
  coachUserMessage,
  estimateOneRepMax,
  normalizeCoachReport,
  workoutFacts,
} = require("../lib/coachAnalysis");

const at = (iso) => Date.parse(iso);
const MIN = 60000;

// Fri Oct 9 2026, 18:00 Toronto: bench (3 sets over 8 min), an exercise with nothing done, rows 5 min later.
const START = at("2026-10-09T18:00:00-04:00");
const workout = {
  id: "w2",
  status: "final",
  routineName: "Push",
  focus: ["Chest"],
  notes: "felt strong",
  unit: "lb",
  startedAt: { seconds: START / 1000 },
  finishedAt: { seconds: (START + 50 * MIN) / 1000 },
  exercises: [
    {
      exerciseId: "bench",
      name: "Bench Press",
      firstEditTime: String(START + 6 * MIN),
      lastEditTime: String(START + 14 * MIN),
      sets: [{ weight: "185", reps: "8", rpe: "7" }, { weight: "205", reps: "5", rpe: "9" }, { weight: "205", reps: "4", rpe: "" }],
    },
    { exerciseId: "fly", name: "Cable Fly", firstEditTime: String(START + 15 * MIN), lastEditTime: String(START + 15 * MIN), sets: [{ weight: "", reps: "", rpe: "" }] },
    {
      exerciseId: "row",
      name: "Seated Row",
      firstEditTime: String(START + 20 * MIN),
      lastEditTime: String(START + 23 * MIN),
      sets: [{ weight: "120", reps: "12", rpe: "" }, { weight: "120", reps: "10", rpe: "" }],
    },
  ],
};
const hr = {
  avg: 118, max: 162, min: 88, minutes: 48,
  exercises: [
    { i: 0, avg: 131, max: 162, min: 101, minutes: 10, series: [{ m: 0, b: 104 }, { m: 1, b: 150 }, { m: 3, b: 112 }] },
    { i: 2, avg: 120, max: 141, min: 100, minutes: 5, series: [{ m: 0, b: 110 }, { m: 2, b: 141 }] },
  ],
};
const lastWeek = {
  id: "w1",
  status: "final",
  routineName: "Push",
  focus: ["Chest"],
  unit: "lb",
  startedAt: { seconds: (START - 4 * 24 * 60 * MIN) / 1000 },
  finishedAt: { seconds: (START - 4 * 24 * 60 * MIN + 45 * MIN) / 1000 },
  exercises: [{ exerciseId: "bench", name: "Bench Press", sets: [{ weight: "185", reps: "8" }, { weight: "195", reps: "5" }] }],
};

test("a workout's facts: sets, best set, timing from logged sets, and each exercise's own heart rate", () => {
  const f = workoutFacts(workout, hr);
  assert.equal(f.date, "2026-10-09");
  assert.equal(f.weekday, "Fri");
  assert.equal(f.started, "18:00");
  assert.equal(f.finished, "18:50");
  assert.equal(f.durationMin, 50);
  assert.equal(f.exerciseCount, 2, "an exercise with nothing done is left out");
  assert.equal(f.setCount, 5);
  assert.equal(f.totalVolume, 185 * 8 + 205 * 5 + 205 * 4 + 120 * 12 + 120 * 10);
  assert.deepEqual(f.heartRate, { avg: 118, max: 162, min: 88, minutesRecorded: 48 });

  const [bench, row] = f.exercises;
  assert.deepEqual(bench.sets, ["185x8 RPE 7", "205x5 RPE 9", "205x4"]);
  assert.equal(bench.bestSet, "205x5 RPE 9", "best by estimated 1-rep max: 205x5 (239) beats 185x8 (234)");
  assert.equal(bench.bestE1rm, Math.round(estimateOneRepMax(205, 5) * 10) / 10);
  assert.deepEqual(bench.timing, { firstSetLoggedAt: "18:06", minutesFirstToLastSet: 8, minutesPerSet: 4, minutesFromPreviousExercise: null });
  assert.deepEqual(bench.heartRate, { avg: 131, max: 162, min: 101, minutesRecorded: 10, perMinute: [104, 150, 112] });

  assert.equal(row.order, 2);
  assert.equal(row.timing.minutesPerSet, 3);
  assert.equal(row.timing.minutesFromPreviousExercise, 5, "from the last logged set before it (the fly was opened at 18:15)");
  assert.equal(row.heartRate.avg, 120, "heart rate is matched by the exercise's place in the workout, not its place in the list");
});

test("single workout: compared with last time, and the days between workouts", () => {
  const f = buildWorkoutAnalysisFacts({ target: workout, history: [workout, lastWeek], hrById: { w2: hr, w1: { avg: 110, max: 171 } } });
  assert.equal(f.kind, "single workout");
  const bench = f.workout.exercises[0];
  assert.deepEqual(bench.lastTime, { date: "2026-10-05", daysAgo: 4, sets: ["185x8", "195x5"], bestSet: "185x8", bestE1rm: Math.round(estimateOneRepMax(185, 8) * 10) / 10 });
  assert.equal(f.workout.exercises[1].lastTime, null, "rows weren't done before");
  assert.equal(f.betweenWorkouts.daysSincePreviousWorkout, 4);
  assert.equal(f.betweenWorkouts.workoutsInPrevious7Days, 1);
  assert.deepEqual(f.betweenWorkouts.previousWorkout, { date: "2026-10-05", routine: "Push", focus: ["Chest"] });
  assert.equal(f.betweenWorkouts.recentSessions.length, 1);
  assert.equal(f.highestHeartRateSeenInWorkouts, 171);
});

test("last 4 weeks: sessions, gaps, sessions per week, and how each lift moved", () => {
  const nowMs = START + 2 * 24 * 60 * MIN;
  const old = { ...lastWeek, id: "old", startedAt: { seconds: (START - 40 * 24 * 60 * MIN) / 1000 } };
  const f = buildRecentAnalysisFacts({ workouts: [workout, lastWeek, old], hrById: { w2: hr }, nowMs });
  assert.equal(f.workoutCount, 2, "only the last 28 days");
  assert.deepEqual(f.daysBetweenWorkouts, [4]);
  assert.equal(f.daysSinceLastWorkout, 2);
  assert.deepEqual(f.workoutsPerWeek, { thisWeek: 2, lastWeek: 0, twoWeeksAgo: 0, threeWeeksAgo: 0 });
  assert.equal(f.sessions[0].date, "2026-10-05", "oldest first");
  const bench = f.liftTrends.find((l) => l.name === "Bench Press");
  assert.equal(bench.timesDone, 2);
  assert.equal(bench.e1rmChangePercent, 2.1, "best set 185x8 (234.3) last time, 205x5 (239.2) now");
  assert.equal(f.highestHeartRateSeenInWorkouts, 162);
});

test("the coach is told the data, the athlete's question, and the reply shape", () => {
  const msg = coachUserMessage({ kind: "single workout", workout: { date: "2026-10-09" } }, "  Is my rest   too long? ");
  assert.match(msg, /^The athlete asks: Is my rest too long\?\n\nTraining data \(single workout\):\n\{"kind":"single workout"/);
  assert.doesNotMatch(coachUserMessage({ kind: "last 4 weeks" }, ""), /athlete asks/);
  assert.match(COACH_SYSTEM_PROMPT, /"recommendations"/);
  assert.match(COACH_SYSTEM_PROMPT, /minutesPerSet/);
});

test("the coach's reply is checked and trimmed", () => {
  const good = {
    headline: "Solid push day, but your bench back-off sets fell apart.",
    rating: 7.4,
    summary: "Good volume.",
    strengths: ["Bench 185x8 at RPE 7", "", 5],
    critique: [{ area: "Bench", detail: "205x4 after 205x5: 4 min rest wasn't enough." }, "plain text item", { area: "x", detail: "" }],
    heartRate: "Peaked at 162.",
    pacing: "4 min per set on bench.",
    recovery: "4 days since the last push day.",
    recommendations: [{ title: "Rest 4-5 min on top sets", detail: "Keep 205 for 3x5." }],
    nextSession: "Bench 205x5x3.",
  };
  const r = normalizeCoachReport(JSON.stringify(good));
  assert.equal(r.rating, 7);
  assert.deepEqual(r.strengths, ["Bench 185x8 at RPE 7", "5"]);
  assert.deepEqual(r.critique.map((c) => c.area), ["Bench", ""]);
  assert.equal(r.recommendations.length, 1);

  assert.equal(normalizeCoachReport("```json\n" + JSON.stringify(good) + "\n```").headline, good.headline, "a fenced reply is read too");
  assert.equal(normalizeCoachReport({ ...good, rating: 14 }).rating, null);
  assert.equal(normalizeCoachReport({ ...good, recommendations: [] }), null, "no recommendations: not a report");
  assert.equal(normalizeCoachReport({ ...good, headline: "", summary: "" }), null);
  assert.equal(normalizeCoachReport("not json"), null);
});

test("the estimated 1-rep max is the same as the app's", async () => {
  const app = await import("../../public/js/prRecords.js");
  for (const [w, r] of [[185, 8], [205, 1], [100, 30], [0, 10], [50, 0]]) {
    assert.equal(estimateOneRepMax(w, r), app.estimateOneRepMax(w, r), `${w}x${r}`);
  }
});
