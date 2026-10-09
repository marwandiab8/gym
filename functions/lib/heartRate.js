// Heart rate from Apple Health (sent by the Health Auto Export app) beside each workout.
//
// The phone posts Health Auto Export's JSON to the healthHeartRate function. Its heart-rate readings - the
// "Heart Rate" metric, and the per-minute readings inside any Apple Watch workout - are filed by minute in
// users/{uid}/heartRateDays/{YYYY-MM-DD} ({ m: { "HH:MM": [min, avg, max] } }, Toronto time), and every gym
// workout whose time they cover gets a summary in users/{uid}/workoutHeartRate/{workoutId}: average, max,
// min, how many minutes had a reading, and a series for the graph. Nothing is needed from the workout
// itself beyond its start and finish times, so it works whether or not a workout was started on the Watch.

const TIME_ZONE = "America/Toronto";
const MAX_SERIES_POINTS = 90;
const MIN_MINUTES = 3; // fewer readings than this in a workout isn't a heart-rate record worth showing

/**
 * A Health Auto Export date ("2026-10-09 05:12:00 -0400", or ISO) as epoch ms, or null.
 */
function parseHaeDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const zone = m[3] ? (m[3] === "Z" ? "Z" : m[3].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "";
    const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

const bpm = (v) => {
  const n = Number(v && typeof v === "object" ? v.qty : v);
  return Number.isFinite(n) && n >= 25 && n <= 250 ? n : null;
};

/**
 * Every heart-rate reading in a Health Auto Export body: [{ ms, min, avg, max }]. Accepts the Heart Rate
 * metric (aggregated: Min/Avg/Max; or raw: qty) and the heartRateData inside workouts.
 */
function heartRateSamples(body) {
  const data = body && typeof body === "object" ? body.data || body : {};
  const out = [];
  const add = (point) => {
    const ms = parseHaeDate(point && (point.date || point.startDate || point.start));
    if (ms == null) return;
    const avg = bpm(point.Avg ?? point.avg ?? point.qty);
    const min = bpm(point.Min ?? point.min) ?? avg;
    const max = bpm(point.Max ?? point.max) ?? avg;
    if (avg == null && max == null) return;
    out.push({ ms, min: min ?? max, avg: avg ?? max, max: max ?? avg });
  };
  for (const metric of Array.isArray(data.metrics) ? data.metrics : []) {
    const name = String(metric && metric.name || "").toLowerCase().replace(/\s+/g, "_");
    if (name !== "heart_rate") continue;
    for (const point of Array.isArray(metric.data) ? metric.data : []) add(point);
  }
  for (const w of Array.isArray(data.workouts) ? data.workouts : []) {
    for (const point of Array.isArray(w && w.heartRateData) ? w.heartRateData : []) add(point);
  }
  return out;
}

/** The Toronto day and minute of a time: { day: "YYYY-MM-DD", hm: "HH:MM" }. */
function minuteOf(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms))
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}` };
}

/** The time (ms) of a day's minute in Toronto. */
function msOfMinute(day, hm) {
  // Toronto is UTC-4 or UTC-5: try both and keep the one that maps back to the same minute.
  for (const offset of ["-04:00", "-05:00"]) {
    const ms = Date.parse(`${day}T${hm}:00${offset}`);
    const back = minuteOf(ms);
    if (back.day === day && back.hm === hm) return ms;
  }
  return Date.parse(`${day}T${hm}:00-05:00`);
}

/**
 * Readings filed by day and minute: { day: { "HH:MM": [min, avg, max] } }. Several readings in one minute
 * become one: the lowest low, the mean of the averages, the highest high (whole bpm).
 */
function bucketByMinute(samples) {
  const acc = new Map();
  for (const s of samples) {
    const { day, hm } = minuteOf(s.ms);
    if (!acc.has(day)) acc.set(day, new Map());
    const m = acc.get(day);
    const b = m.get(hm) || { min: Infinity, max: -Infinity, sum: 0, n: 0 };
    b.min = Math.min(b.min, s.min);
    b.max = Math.max(b.max, s.max);
    b.sum += s.avg;
    b.n += 1;
    m.set(hm, b);
  }
  const out = {};
  for (const [day, m] of acc) {
    out[day] = {};
    for (const [hm, b] of m) out[day][hm] = [Math.round(b.min), Math.round(b.sum / b.n), Math.round(b.max)];
  }
  return out;
}

/** The days a time window touches (Toronto), oldest first. */
function daysBetween(startMs, endMs) {
  const days = [];
  for (let t = startMs; t <= endMs + 864e5; t += 864e5) {
    const d = minuteOf(Math.min(t, endMs)).day;
    if (!days.includes(d)) days.push(d);
    if (t >= endMs) break;
  }
  const last = minuteOf(endMs).day;
  if (!days.includes(last)) days.push(last);
  return days;
}

/**
 * A workout's heart-rate summary from the minute readings of its days ({ day: { hm: [min,avg,max] } }):
 * { avg, max, min, minutes, series: [{ m: minutesFromStart, b: bpm }, ...] (at most 90 points - a list of
 * maps, since Firestore can't store a list of lists) }, or null when
 * fewer than 3 minutes of the workout had a reading.
 */
function summarizeWorkout(dayMinutes, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const rows = [];
  for (const day of daysBetween(startMs, endMs)) {
    const m = dayMinutes[day] || {};
    for (const [hm, v] of Object.entries(m)) {
      const ms = msOfMinute(day, hm);
      // A minute counts when it overlaps the workout: it starts after (start - 1 min) and before the finish.
      if (ms > startMs - 60000 && ms < endMs) rows.push({ ms, min: v[0], avg: v[1], max: v[2] });
    }
  }
  if (rows.length < MIN_MINUTES) return null;
  rows.sort((a, b) => a.ms - b.ms);
  const avg = Math.round(rows.reduce((s, r) => s + r.avg, 0) / rows.length);
  // The graph: one point per minute, or the mean of each run of minutes when the workout is long.
  const step = Math.ceil(rows.length / MAX_SERIES_POINTS);
  const series = [];
  for (let i = 0; i < rows.length; i += step) {
    const chunk = rows.slice(i, i + step);
    series.push({ m: Math.max(0, Math.round((chunk[0].ms - startMs) / 60000)), b: Math.round(chunk.reduce((s, r) => s + r.avg, 0) / chunk.length) });
  }
  return {
    avg,
    max: Math.max(...rows.map((r) => r.max)),
    min: Math.min(...rows.map((r) => r.min)),
    minutes: rows.length,
    series,
  };
}

module.exports = { MIN_MINUTES, bucketByMinute, daysBetween, heartRateSamples, minuteOf, msOfMinute, parseHaeDate, summarizeWorkout };
