const test = require("node:test");
const assert = require("node:assert/strict");
const {
  knownExercisesFromWorkouts,
  normalizeRoutinePlan,
  resolvePlanExercises,
  routinePlanUserMessage,
  ROUTINE_PLAN_SYSTEM_PROMPT,
} = require("../lib/coachRoutine");

const workouts = [
  { exercises: [{ exerciseId: "wger_1627", name: "Barbell squat" }, { exerciseId: "wger_1414", name: "Hack Squats" }, { exerciseId: "own123", name: "Single Leg calf HAWK" }, { exerciseId: "wger_283", name: "Hanging Leg Raises" }] },
  { exercises: [{ exerciseId: "wger_1627", name: "Barbell Squat (old name)" }, { exerciseId: "wger_117", name: "Lying Leg Curls" }, { name: "no id" }] },
];

test("the athlete's exercises: one per id, newest name, nothing without an id", () => {
  assert.deepEqual(knownExercisesFromWorkouts(workouts), [
    { id: "wger_1627", name: "Barbell squat" },
    { id: "wger_1414", name: "Hack Squats" },
    { id: "own123", name: "Single Leg calf HAWK" },
    { id: "wger_283", name: "Hanging Leg Raises" },
    { id: "wger_117", name: "Lying Leg Curls" },
  ]);
  assert.deepEqual(knownExercisesFromWorkouts(null), []);
});

test("the request carries the plan, the unit and the exercise list", () => {
  const msg = JSON.parse(routinePlanUserMessage({ text: "Squat 225 for 2 x 6.", unit: "lb", exercises: [{ id: "a", name: "Squat" }] }));
  assert.deepEqual(msg, { plan: "Squat 225 for 2 x 6.", unit: "lb", athleteExercises: [{ id: "a", name: "Squat" }] });
  assert.equal(JSON.parse(routinePlanUserMessage({ text: "x", unit: "stones" })).unit, "lb");
  assert.match(ROUTINE_PLAN_SYSTEM_PROMPT, /never invent loads/);
});

test("the model's routine is checked: numbers only, every set kept in order, exercises without a name dropped", () => {
  const plan = normalizeRoutinePlan("```json\n" + JSON.stringify({
    name: "Legs - coach plan for the next lower-body session, a long name",
    note: "Rest 3-5 minutes on heavy compounds.",
    exercises: [
      { id: "wger_1627", name: "Barbell squat", sets: [{ weight: "45", reps: "15" }, { weight: "135 lb", reps: "10 reps" }, { weight: "225", reps: "6" }, { weight: "225", reps: "6" }], note: "" },
      { id: "wger_1414", name: "Hack Squats", sets: [{ weight: "540", reps: "9" }, { weight: "540", reps: "9" }, { weight: "270", reps: "14" }], note: "don't force reps" },
      { id: "", name: "Leg curl", sets: [{ weight: "", reps: "8-10" }, { weight: "", reps: "8 - 10" }, { weight: "heavy", reps: "lots" }] },
      { id: "wger_283", name: "Hanging Leg Raises", sets: [{ weight: "", reps: "27" }] },
      { id: "x", name: "Leg curl machine", sets: [] },
      { id: "y", name: "", sets: [{ weight: "100", reps: "10" }] },
      { id: "bad id!", name: "Calf raise", sets: [{ weight: "270", reps: "17" }] },
    ],
  }) + "\n```");
  assert.equal(plan.name, "Legs - coach plan for the next lower-bod");
  assert.equal(plan.note, "Rest 3-5 minutes on heavy compounds.");
  assert.deepEqual(plan.exercises.map((e) => e.name), ["Barbell squat", "Hack Squats", "Leg curl", "Hanging Leg Raises", "Leg curl machine", "Calf raise"]);
  assert.deepEqual(plan.exercises[0].sets, [{ weight: "45", reps: "15" }, { weight: "135", reps: "10" }, { weight: "225", reps: "6" }, { weight: "225", reps: "6" }]);
  assert.deepEqual(plan.exercises[2].sets, [{ weight: "", reps: "8-10" }, { weight: "", reps: "8-10" }, { weight: "", reps: "" }], "ranges kept; words dropped, the set kept");
  assert.deepEqual(plan.exercises[4].sets, [{ weight: "", reps: "" }], "an exercise with no sets given: one set");
  assert.equal(plan.exercises[1].note, "don't force reps");
  assert.equal(plan.exercises[5].exerciseId, "", "an id that isn't one is dropped");
  assert.equal(normalizeRoutinePlan("not json"), null);
  assert.equal(normalizeRoutinePlan({ exercises: [] }), null);
});

test("planned exercises are tied to the athlete's own, by id or by name", () => {
  const known = knownExercisesFromWorkouts(workouts);
  const plan = resolvePlanExercises({ name: "Legs", note: "", exercises: [
    { exerciseId: "wger_1627", name: "Squat", sets: [{ weight: "225", reps: "6" }], note: "" },
    { exerciseId: "made_up", name: "lying leg curls", sets: [{ weight: "", reps: "10" }], note: "" },
    { exerciseId: "", name: "Hanging leg raises", sets: [{ weight: "", reps: "27" }], note: "" },
    { exerciseId: "", name: "Nordic curl", sets: [{ weight: "", reps: "5" }], note: "" },
  ] }, known);
  assert.deepEqual(plan.exercises.map((e) => [e.exerciseId, e.name]), [
    ["wger_1627", "Barbell squat"],
    ["wger_117", "Lying Leg Curls"],
    ["wger_283", "Hanging Leg Raises"],
    ["", "Nordic curl"],
  ]);
  assert.equal(resolvePlanExercises(null, known), null);
});
