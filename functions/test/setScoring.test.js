const test = require("node:test");
const assert = require("node:assert/strict");
const {
  prSetVolume,
  pickBestSetForPR,
  filterScorableSets,
  isNewPRBeatsCurrent,
  buildExerciseSummaries,
} = require("../lib/setScoring");

test("prSetVolume uses product when weight > 0", () => {
  assert.equal(prSetVolume({ weight: 100, reps: 5 }), 500);
});

test("prSetVolume uses reps when weight is 0 (bodyweight)", () => {
  assert.equal(prSetVolume({ weight: 0, reps: 15 }), 15);
});

test("pickBestSetForPR prefers higher volume", () => {
  const sets = [
    { weight: 100, reps: 5 },
    { weight: 90, reps: 10 },
  ];
  const best = pickBestSetForPR(sets);
  assert.deepEqual(best, { weight: 90, reps: 10 });
});

test("pickBestSetForPR tie-breaks on weight then reps when volume ties", () => {
  const sets = [
    { weight: 40, reps: 10 },
    { weight: 50, reps: 8 },
  ];
  assert.deepEqual(pickBestSetForPR(sets), { weight: 50, reps: 8 });
});

test("isNewPRBeatsCurrent compares volume", () => {
  assert.equal(isNewPRBeatsCurrent({ weight: 10, reps: 10 }, { weight: 100, reps: 1 }), false);
  assert.equal(isNewPRBeatsCurrent({ weight: 20, reps: 6 }, { weight: 100, reps: 1 }), true);
});

test("buildExerciseSummaries picks one best set per exercise", () => {
  const workout = {
    exercises: [
      {
        exerciseId: "ex1",
        name: "Squat",
        sets: [
          { weight: 100, reps: 5 },
          { weight: 95, reps: 8 },
        ],
      },
    ],
  };
  const rows = buildExerciseSummaries(workout);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bestVolume, 760);
  assert.equal(rows[0].bestWeight, 95);
  assert.equal(rows[0].bestReps, 8);
  assert.equal(rows[0].maxWeight, 95);
  assert.equal(rows[0].maxReps, 8);
});

test("filterScorableSets drops zero-rep rows", () => {
  const sets = [{ weight: 100, reps: 0 }, { weight: 0, reps: 12 }];
  const v = filterScorableSets(sets);
  assert.equal(v.length, 1);
  assert.deepEqual(v[0], { weight: 0, reps: 12 });
});
