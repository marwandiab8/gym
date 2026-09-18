const test = require("node:test");
const assert = require("node:assert/strict");
const { mapWorkoutSummaryToTimeLeft, validDateId } = require("../timeLeftGym/mappers");

test("maps workout summary to a Time Left workout item", () => {
  const item = mapWorkoutSummaryToTimeLeft({
    workoutId: "w1",
    routineName: "Push Day",
    date: "2028-07-25",
    unit: "lb",
    focus: ["Chest", "Shoulders"],
    notes: "Felt strong.",
    updatedAtMs: Date.parse("2028-07-25T19:30:00.000Z"),
    exerciseCount: 2,
    exerciseSummaries: [
      { exerciseId: "bench", name: "Bench Press", bestWeight: 225, bestReps: 5, bestVolume: 1125 },
      { exerciseId: "press", name: "Shoulder Press", bestWeight: 95, bestReps: 8, bestVolume: 760 },
    ],
    exerciseSetDetails: [
      {
        exerciseId: "bench",
        sets: [
          { weight: "95", reps: "5", rpe: "8" },
          { weight: "100", reps: "3", rpe: "9" },
        ],
      },
      {
        exerciseId: "press",
        sets: [
          { weight: "75", reps: "8", rpe: "7" },
        ],
      },
    ],
  }, {
    sourceDocumentPath: "users/u1/workout_summaries/w1",
    sourceFirebaseProjectId: "gym-k2",
    sourceProjectId: "gym-k2",
    uid: "u1",
    workoutId: "w1",
  });

  assert.equal(item.sourceApp, "GYM-K2");
  assert.equal(item.category, "workout");
  assert.equal(item.dateId, "2028-07-25");
  assert.equal(item.sourceDocumentPath, "users/u1/workout_summaries/w1");
  assert.equal(item.sourceFirebaseProjectId, "gym-k2");
  assert.equal(item.sourceProjectId, "gym-k2");
  assert.equal(item.visibility, "ownerOnly");
  assert.equal(item.metadata.exerciseSummaries.length, 2);
  assert.equal(item.metadata.exerciseSummaries[0].sets.length, 2);
  assert.equal(item.metadata.exerciseSummaries[1].sets.length, 1);
  assert.match(item.summary, /Bench Press/);
  assert.match(item.description, /Bench Press/);
  assert.match(item.description, /95 lb.*5 reps/);
  assert.match(item.description, /100 lb.*3 reps/);
  assert.match(item.description, /Felt strong/);
  assert.equal(item.capturedAt, "2028-07-25T19:30:00.000Z");
  assert.equal(item.originalCreatedAt, "2028-07-25T19:30:00.000Z");
});

test("omits invalid date ids", () => {
  assert.equal(validDateId("2028-7-25"), "");
  assert.equal(validDateId("2028-07-25"), "2028-07-25");
});

test("date correction keeps the stable Time Left identity and updates the calendar date", () => {
  const options = {
    sourceDocumentPath: "users/u1/workout_summaries/w1",
    uid: "u1",
    workoutId: "w1",
  };
  const original = mapWorkoutSummaryToTimeLeft({
    workoutId: "w1",
    routineName: "Workout",
    date: "2026-08-10",
    dateKey: "2026-08-10",
    updatedAtMs: 1,
    exerciseSummaries: [],
  }, options);
  const corrected = mapWorkoutSummaryToTimeLeft({
    workoutId: "w1",
    routineName: "Workout",
    date: "2026-08-11",
    dateKey: "2026-08-11",
    updatedAtMs: 1,
    exerciseSummaries: [],
  }, options);

  assert.equal(corrected.sourceDocumentId, original.sourceDocumentId);
  assert.equal(corrected.sourceDocumentPath, original.sourceDocumentPath);
  assert.equal(original.dateId, "2026-08-10");
  assert.equal(corrected.dateId, "2026-08-11");
  assert.equal(corrected.metadata.date, "2026-08-11");
});
