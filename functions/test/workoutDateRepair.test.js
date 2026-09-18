const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildDateRepairPlan,
  prDateRepairPatch,
  resolveWorkoutDateFields,
  selectDateRepairCandidates,
} = require("../lib/workoutDateRepair");

test("finalization date fields must be consistent", () => {
  assert.deepEqual(resolveWorkoutDateFields("2026-08-11", "2026-08-11"), { date: "2026-08-11", dateKey: "2026-08-11" });
  assert.throws(() => resolveWorkoutDateFields("2026-08-10", "2026-08-11"), /must be the same/);
  assert.throws(() => resolveWorkoutDateFields("2026-02-30", "2026-02-30"), /valid calendar date/);
});

test("candidate selection uses date, finalization window, and exercise identity", () => {
  const records = [
    { id: "target", status: "final", date: "2026-08-10", finalizedAtMs: 1000, exercises: [{ exerciseId: "bench" }, { exerciseId: "row" }] },
    { id: "wrong-time", status: "final", date: "2026-08-10", finalizedAtMs: 500, exercises: [{ exerciseId: "bench" }] },
    { id: "wrong-exercise", status: "final", date: "2026-08-10", finalizedAtMs: 1000, exercises: [{ exerciseId: "squat" }] },
  ];
  const candidates = selectDateRepairCandidates(records, { originalDate: "2026-08-10", finalizedAfterMs: 900, finalizedBeforeMs: 1100, exerciseIds: ["bench"] });
  assert.deepEqual(candidates.map((row) => row.id), ["target"]);
});

test("date repair is guarded, minimal, and preserves scoring fields", () => {
  const workout = { status: "final", date: "2026-08-10", dateKey: "2026-08-10", finalizationId: "f1", finalizedAtMs: 1234, updatedAtMs: 1200, exercises: [{ exerciseId: "bench", sets: [{ weight: "225", reps: "8" }] }] };
  const plan = buildDateRepairPlan({ workoutId: "w1", workout, expectedOriginalDate: "2026-08-10", newDate: "2026-08-11", expectedFinalizationId: "f1", expectedFinalizedAtMs: 1234 });
  assert.deepEqual(plan.workoutPatch, { date: "2026-08-11", dateKey: "2026-08-11" });
  assert.equal(workout.updatedAtMs, 1200);
  assert.deepEqual(workout.exercises[0].sets, [{ weight: "225", reps: "8" }]);
  assert.throws(() => buildDateRepairPlan({ workoutId: "w1", workout, expectedOriginalDate: "2026-08-09", newDate: "2026-08-11", expectedFinalizationId: "f1", expectedFinalizedAtMs: 1234 }), /expected original/);
});

test("only PR metadata sourced from the corrected workout moves dates", () => {
  assert.deepEqual(prDateRepairPatch({ sourceWorkoutId: "w1", date: "2026-08-10" }, "w1", "2026-08-11"), { date: "2026-08-11", sourceWorkoutDate: "2026-08-11" });
  assert.equal(prDateRepairPatch({ sourceWorkoutId: "w2" }, "w1", "2026-08-11"), null);
});

test("owner callable rebuilds date-owned derived records without changing audit timestamps", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../index.js"), "utf8");
  const callable = source.slice(
    source.indexOf("exports.correctFinalizedWorkoutDate"),
    source.indexOf("exports.createWorkoutDraft")
  );

  assert.match(callable, /const uid = context\.auth\?\.uid/);
  assert.match(callable, /runTransaction/);
  assert.match(callable, /candidates\.length !== 1/);
  assert.match(callable, /buildWorkoutSummaryRecord/);
  assert.match(callable, /plan\.receiptPatch/);
  assert.match(callable, /prDateRepairPatch/);
  assert.match(callable, /syncLastSetsForExercises/);
  assert.doesNotMatch(callable, /updatedAtMs\s*:/);
  assert.doesNotMatch(callable, /finishedAt\s*:/);
  assert.doesNotMatch(callable, /finalizedAtMs\s*:\s*(?:Date\.now|nowMs)/);
});
