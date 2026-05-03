const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePrompt,
  extractJsonCandidate,
  normalizeAiExercises,
  normalizeExercise,
} = require("../lib/aiRoutine");

test("normalizePrompt trims whitespace", () => {
  assert.equal(normalizePrompt("  hi  \n there  "), "hi there");
});

test("extractJsonCandidate parses fenced JSON", () => {
  const out = extractJsonCandidate('```json\n[{"name":"A","sets":3,"reps":"5"}]\n```');
  assert.ok(Array.isArray(out));
  assert.equal(out[0].name, "A");
});

test("normalizeAiExercises accepts wrapper object", () => {
  const rows = normalizeAiExercises({
    exercises: [{ name: "Squat", sets: 3, reps: "5" }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Squat");
});

test("normalizeExercise rejects bad sets count", () => {
  assert.throws(() => normalizeExercise({ name: "X", sets: 9, reps: "5" }), /1 and 8/);
});
