const test = require("node:test");
const assert = require("node:assert/strict");
const { bucketByMinute, daysBetween, heartRateSamples, minuteOf, msOfMinute, parseHaeDate, summarizeWorkout } = require("../lib/heartRate");

test("Health Auto Export dates, with and without a zone", () => {
  assert.equal(new Date(parseHaeDate("2026-10-09 05:12:00 -0400")).toISOString(), "2026-10-09T09:12:00.000Z");
  assert.equal(new Date(parseHaeDate("2026-10-09T05:12:30-04:00")).toISOString(), "2026-10-09T09:12:30.000Z");
  assert.equal(parseHaeDate("not a date"), null);
  assert.equal(parseHaeDate(""), null);
});

test("readings come from the Heart Rate metric (aggregated or raw) and from Watch workouts", () => {
  const body = {
    data: {
      metrics: [
        { name: "heart_rate", units: "count/min", data: [{ date: "2026-10-09 05:12:00 -0400", Min: 88, Avg: 101, Max: 120 }, { date: "2026-10-09 05:13:00 -0400", qty: 130 }] },
        { name: "step_count", data: [{ date: "2026-10-09 05:00:00 -0400", qty: 900 }] },
        { name: "Heart Rate", data: [{ date: "2026-10-09 05:14:00 -0400", Avg: 999 }] }, // impossible bpm: dropped
      ],
      workouts: [{ name: "Traditional Strength Training", heartRateData: [{ date: "2026-10-09 05:15:00 -0400", Min: 110, Avg: 125, Max: 140 }] }],
    },
  };
  const s = heartRateSamples(body);
  assert.deepEqual(s.map((x) => [x.min, x.avg, x.max]), [[88, 101, 120], [130, 130, 130], [110, 125, 140]]);
  assert.deepEqual(heartRateSamples({}), []);
});

test("readings are filed by Toronto day and minute, several in one minute merged", () => {
  const at = (iso) => Date.parse(iso);
  const b = bucketByMinute([
    { ms: at("2026-10-09T09:12:05Z"), min: 90, avg: 100, max: 110 },
    { ms: at("2026-10-09T09:12:40Z"), min: 95, avg: 110, max: 125 },
    { ms: at("2026-10-10T03:59:00Z"), min: 60, avg: 61, max: 62 }, // 23:59 on the 9th in Toronto
  ]);
  assert.deepEqual(b, { "2026-10-09": { "05:12": [90, 105, 125], "23:59": [60, 61, 62] } });
  assert.deepEqual(minuteOf(at("2026-01-15T14:30:00Z")), { day: "2026-01-15", hm: "09:30" }, "winter: UTC-5");
  assert.equal(new Date(msOfMinute("2026-01-15", "09:30")).toISOString(), "2026-01-15T14:30:00.000Z");
  assert.equal(new Date(msOfMinute("2026-10-09", "05:12")).toISOString(), "2026-10-09T09:12:00.000Z");
});

test("a workout's summary uses only the minutes inside it", () => {
  const day = { "05:00": [70, 72, 75], "05:05": [100, 110, 125], "05:06": [105, 130, 160], "05:07": [100, 120, 140], "06:30": [60, 65, 70] };
  const start = Date.parse("2026-10-09T09:04:30Z"); // 05:04:30
  const end = Date.parse("2026-10-09T09:20:00Z");
  const s = summarizeWorkout({ "2026-10-09": day }, start, end);
  assert.deepEqual(s, { avg: 120, max: 160, min: 100, minutes: 3, series: [{ m: 1, b: 110 }, { m: 2, b: 130 }, { m: 3, b: 120 }] });
  assert.equal(summarizeWorkout({ "2026-10-09": { "05:05": [1, 100, 1] } }, start, end), null, "fewer than 3 minutes: no record");
  assert.equal(summarizeWorkout({}, start, end), null);
  assert.deepEqual(daysBetween(Date.parse("2026-10-09T03:30:00Z"), Date.parse("2026-10-09T04:30:00Z")), ["2026-10-08", "2026-10-09"], "a workout across midnight reads both days");
});

test("a long workout's graph is thinned to at most 90 points", () => {
  const day = {};
  const start = Date.parse("2026-10-09T09:00:00Z");
  for (let i = 0; i < 180; i += 1) {
    const { hm } = minuteOf(start + i * 60000);
    day[hm] = [100, 100 + (i % 10), 120];
  }
  const s = summarizeWorkout({ "2026-10-09": day }, start, start + 180 * 60000);
  assert.equal(s.minutes, 180);
  assert.equal(s.series.length, 90);
  assert.equal(s.series[1].m, 2, "two minutes per point");
  assert.ok(s.series.every((p) => !Array.isArray(p)), "no lists inside lists (Firestore refuses them)");
});
