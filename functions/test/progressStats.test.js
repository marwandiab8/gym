const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// progressStats.js imports ./prRecords.js: load that first and point the import at it.
async function loadModules() {
  const url = (src) => `data:text/javascript;base64,${Buffer.from(src).toString("base64")}`;
  const read = (file) => fs.readFileSync(path.resolve(__dirname, "../../public/js", file), "utf8");
  const prUrl = url(read("prRecords.js"));
  const pr = await import(prUrl);
  const progress = await import(url(read("progressStats.js").replace('"./prRecords.js"', JSON.stringify(prUrl))));
  return { ...pr, ...progress };
}

const at = (date, hm) => Date.parse(`${date}T${hm}:00Z`);
const workout = (date, exercises, { unit = "lb", minutes = 60 } = {}) => ({
  id: `${date}-${exercises.map((e) => e[0]).join("")}`,
  date,
  unit,
  startedAt: { toMillis: () => at(date, "10:00") },
  finishedAt: { toMillis: () => at(date, "10:00") + minutes * 60000 },
  exercises: exercises.map(([exerciseId, name, sets]) => ({ exerciseId, name, sets: sets.map(([weight, reps]) => ({ weight, reps })) })),
});

test("weeks start on Monday", async () => {
  const { weekStartKey, addDaysKey } = await loadModules();
  assert.equal(weekStartKey("2026-10-09"), "2026-10-05", "Friday");
  assert.equal(weekStartKey("2026-10-05"), "2026-10-05", "Monday");
  assert.equal(weekStartKey("2026-10-11"), "2026-10-05", "Sunday");
  assert.equal(addDaysKey("2026-02-28", 1), "2026-03-01");
});

test("progress over two weeks against the two before: per week, streak, muscle sets, strength", async () => {
  const { buildPrRecords, buildProgress } = await loadModules();
  const squat = (w) => ["sq", "Hack Squats", [[w, 10], [w, 8]]];
  const row = (w) => ["row", "T-Bar row", [[w, 10]]];
  const pull = (r) => ["pu", "Pull-ups", [[0, r]]];
  const workouts = [
    // previous period: weeks of Sep 14 and Sep 21
    workout("2026-09-14", [squat(200), row(100)]),
    workout("2026-09-16", [squat(200), pull(8)]),
    workout("2026-09-18", [squat(210), row(100)]),
    workout("2026-09-22", [squat(210), pull(8)]),
    // this period: weeks of Sep 28 and Oct 5
    workout("2026-09-28", [squat(220), row(110)]),
    workout("2026-09-30", [squat(220), pull(9)], { minutes: 5 }), // too short to be a real duration
    workout("2026-10-02", [squat(230), row(100)]),
    workout("2026-10-06", [squat(231), pull(10)], { minutes: 90 }),
    workout("2026-10-07", [["bp", "Bench press", [[100, 5]]]], { unit: "kg" }),
  ];
  const records = buildPrRecords(workouts, { today: "2026-10-09" });
  const p = buildProgress(workouts, records, { today: "2026-10-09", weeks: 2 });
  assert.deepEqual([p.range.start, p.range.previousStart, p.range.previousWeeks], ["2026-09-28", "2026-09-14", 2]);
  assert.deepEqual([p.current.workouts, p.current.sets, p.previous.workouts, p.previous.sets], [5, 13, 4, 12]);
  assert.equal(p.current.volume, 220 * 18 + 110 * 10 + 220 * 18 + 230 * 18 + 100 * 10 + 231 * 18 + Math.round(100 * 2.20462 * 5), "kg counted in lb; bodyweight sets add nothing");
  assert.equal(p.current.averageMinutes, 68, "60, 60, 90, 60: the 5-minute one is left out");
  assert.equal(p.previous.perWeek, 2);
  assert.deepEqual(p.weekly.map((w) => [w.week, w.workouts, w.sets, w.byGroup.Legs]), [["2026-09-28", 3, 9, 6], ["2026-10-05", 2, 4, 2]]);
  assert.equal(p.streak.weeks, 1, "this week has 2 so far (not counted, not a break); Sep 28 had 3; Sep 21 had 1");
  const legs = p.groups.find((g) => g.group === "Legs");
  assert.deepEqual([legs.setsPerWeek.toFixed(2), legs.previousSetsPerWeek, legs.daysSince], [(8 / (12 / 7)).toFixed(2), 4, 3]);
  assert.deepEqual(p.groups.map((g) => g.group), ["Legs", "Chest", "Back"]);
  const lift = (id) => p.lifts.find((l) => l.id === id);
  assert.deepEqual([Math.round(lift("sq").from), Math.round(lift("sq").now), lift("sq").change.toFixed(3), lift("sq").fromLabel], [280, 308, "0.100", "before"]);
  assert.equal(lift("pu").change, 0.25, "bodyweight: reps");
  assert.equal(lift("bp").change, null, "one session, nothing to compare");
  assert.deepEqual([p.strength.change.toFixed(3), p.strength.lifts, p.strength.up, p.strength.down], ["0.100", 2, 2, 0], "bodyweight lifts stay out of the headline");

  const longer = buildProgress(workouts, records, { today: "2026-10-09", weeks: 4 });
  assert.equal(longer.previous, null, "no history before the period: nothing to compare with");
  assert.deepEqual([longer.range.start, longer.current.workouts], ["2026-09-14", 9]);
  const all = buildProgress(workouts, records, { today: "2026-10-09", weeks: null });
  assert.deepEqual([all.range.start, all.previous, all.weekly.length], ["2026-09-14", null, 4]);
  assert.equal(buildProgress([], records, { today: "2026-10-09" }), null);
});
