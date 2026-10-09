const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function loadClientModule(relativePath) {
  const source = fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const workout = (id, date, exercises, extra = {}) => ({ id, date, unit: "lb", status: "final", exercises, ...extra });
const ex = (exerciseId, name, sets) => ({ exerciseId, name, sets: sets.map(([weight, reps]) => ({ weight, reps })) });

test("estimated 1-rep max: Epley, with reps above 15 counted as 15", async () => {
  const { estimateOneRepMax } = await loadClientModule("../../public/js/prRecords.js");
  assert.equal(estimateOneRepMax(100, 1), 100);
  assert.equal(Math.round(estimateOneRepMax(100, 10)), 133);
  assert.equal(estimateOneRepMax(100, 50), estimateOneRepMax(100, 15), "a 50-rep set can't pass for a heavy single");
  assert.equal(estimateOneRepMax(0, 12), 0);
});

test("muscle group from the exercise name, else the focus it was trained under", async () => {
  const { muscleGroupFor } = await loadClientModule("../../public/js/prRecords.js");
  assert.equal(muscleGroupFor("Leg Curls (sitting)"), "Legs");
  assert.equal(muscleGroupFor("Biceps Curls With Dumbbell", { Back: 6 }), "Arms");
  assert.equal(muscleGroupFor("Hanging Leg Raises"), "Core");
  assert.equal(muscleGroupFor("Pec deck rear delt fly"), "Shoulders");
  assert.equal(muscleGroupFor("Dips"), "Chest");
  assert.equal(muscleGroupFor("Lat Pull Down (Leaning Back)"), "Back");
  assert.equal(muscleGroupFor("Smith Press", { Shoulders: 14, Chest: 1 }), "Shoulders");
  assert.equal(muscleGroupFor("Mystery machine", { chest: 2, Back: 1 }), "Chest");
  assert.equal(muscleGroupFor("Mystery machine", { "Arms only": 1 }), "Arms");
  assert.equal(muscleGroupFor("Mystery machine"), "Other");
});

test("PRs: the first session is the starting point; then heavier weight, or a stronger set by at least 1%", async () => {
  const { buildPrRecords } = await loadClientModule("../../public/js/prRecords.js");
  const workouts = [
    workout("w3", "2026-09-10", [ex("sq", "Hack Squats", [[200, 10], [220, 8]])]),
    workout("w1", "2026-09-01", [ex("sq", "Hack Squats", [[45, 50], [200, 8]])]),
    workout("w2", "2026-09-05", [ex("sq", "Hack Squats", [[200, 10]])]),
    workout("w4", "2026-09-14", [ex("sq", "Hack Squats", [[220, 8], [215, 9]])]), // 215x9 is only +0.3%: not a PR
    workout("w5", "2026-09-20", [ex("sq", "Hack Squats", [[100, 0], [150, 0]])]), // no completed sets
  ];
  const { exercises, feed } = buildPrRecords(workouts, { today: "2026-09-21" });
  assert.equal(exercises.length, 1);
  const sq = exercises[0];
  assert.equal(sq.sessionCount, 4);
  assert.deepEqual(sq.prs.map((p) => [p.date, p.kind, `${p.set.weight}x${p.set.reps}`, `${p.previous.weight}x${p.previous.reps}`]), [
    ["2026-09-05", "strength", "200x10", "200x8"],
    ["2026-09-10", "heaviest", "220x8", "200x10"],
  ]);
  assert.equal(sq.prs[1].gain, 20);
  assert.deepEqual([sq.heaviest.weight, sq.heaviest.reps, sq.heaviest.date], [220, 8, "2026-09-10"]);
  assert.deepEqual([sq.best.weight, sq.best.reps, sq.best.estimatedMax], [215, 9, 279.5], "still the best set, just not by enough to call a PR");
  assert.deepEqual(sq.recordSets.map((s) => `${s.weight}x${s.reps}`), ["220x8", "215x9", "200x10", "45x50"]);
  assert.deepEqual(sq.sessions.map((s) => s.pr), [null, "strength", "heaviest", null]);
  assert.equal(sq.sessionsSincePr, 1);
  assert.equal(sq.status, "new", "a PR in the last 14 days");
  assert.equal(feed[0].date, "2026-09-10", "newest PR first");
});

test("bodyweight exercises: PRs are reps; kg is compared in lb; an exercise logged twice in a workout is one session", async () => {
  const { buildPrRecords } = await loadClientModule("../../public/js/prRecords.js");
  const workouts = [
    workout("a", "2026-08-01", [ex("pu", "Pull-ups", [[0, 8], [0, 7]])]),
    workout("b", "2026-08-03", [ex("pu", "Pull-ups", [[0, 8]]), ex("pu", "Pull-ups", [[0, 10]])]),
    workout("c", "2026-08-05", [ex("pu", "Pull-ups", [[0, 9], [10, 6]])]),
    workout("k1", "2026-08-01", [ex("bp", "Bench press", [[100, 5]])], { unit: "kg" }),
    workout("k2", "2026-08-08", [ex("bp", "Bench press", [[225, 5]])]), // 225 lb ≈ 102 kg: heavier
  ];
  const { exercises } = buildPrRecords(workouts, { today: "2026-08-10" });
  const pu = exercises.find((e) => e.id === "pu");
  assert.equal(pu.bodyweight, true);
  assert.equal(pu.sessionCount, 3);
  assert.deepEqual(pu.prs.map((p) => [p.kind, p.set.reps, p.previous.reps, p.gain]), [["reps", 10, 8, 2]]);
  assert.equal(pu.best, null);
  assert.deepEqual([pu.mostReps.reps, pu.heaviest.weight], [10, 10], "added weight is still shown");
  assert.deepEqual(pu.recordSets, []);
  const bp = exercises.find((e) => e.id === "bp");
  assert.deepEqual(bp.prs.map((p) => [p.kind, p.set.weight, p.set.unit, p.previous.weight, p.previous.unit]), [["heaviest", 225, "lb", 100, "kg"]]);
});

test("status: baseline after one session, stalled after 5 sessions without a PR, resting after 45 days away", async () => {
  const { buildPrRecords } = await loadClientModule("../../public/js/prRecords.js");
  const same = (n, start) => Array.from({ length: n }, (_, i) => workout(`s${start}${i}`, `2026-0${start}-${String(10 + i).padStart(2, "0")}`, [ex(`x${start}`, `Row ${start}`, [[100, 10]])]));
  const workouts = [
    ...same(6, 9), // 6 sessions, Sept: 5 without a PR
    ...same(3, 6), // June: long ago
    workout("one", "2026-09-30", [ex("once", "Cable Fly", [[30, 12]])]),
  ];
  const { exercises, summary } = buildPrRecords(workouts, { today: "2026-10-01" });
  const status = Object.fromEntries(exercises.map((e) => [e.name, e.status]));
  assert.deepEqual(status, { "Row 6": "resting", "Row 9": "stalled", "Cable Fly": "baseline" });
  assert.equal(exercises.find((e) => e.name === "Row 9").sessionsSincePr, 5);
  assert.equal(summary.stalled, 1);
  assert.equal(summary.prsLast30, 0);
  assert.equal(summary.trainedLast30, 2);
});

test("summary: PRs in the last 30 days against the 30 before, and the biggest jump in estimated max", async () => {
  const { buildPrRecords } = await loadClientModule("../../public/js/prRecords.js");
  const workouts = [
    workout("1", "2026-08-01", [ex("a", "Leg Press", [[300, 10]]), ex("b", "Chest Press", [[100, 10]])]),
    workout("2", "2026-08-20", [ex("a", "Leg Press", [[320, 10]])]),
    workout("3", "2026-09-25", [ex("a", "Leg Press", [[340, 10]]), ex("b", "Chest Press", [[130, 10]])]),
  ];
  const { summary } = buildPrRecords(workouts, { today: "2026-10-01" });
  assert.equal(summary.prsLast30, 2);
  assert.equal(summary.prsPrevious30, 1);
  assert.equal(summary.improvedLast30, 2);
  assert.deepEqual([summary.biggestJump.name, summary.biggestJump.pct], ["Chest Press", 30]);
  assert.equal(summary.lastPr.date, "2026-09-25");
});
