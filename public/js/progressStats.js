/**
 * Progress over a period (the last N weeks, or all time) for the Progress page, compared with the period before.
 *
 *  - strength: for each lift, its level now (best of its last 3 sessions) against its level when the period began
 *    (best of the 3 sessions before it; or, for a lift that is new in the period, its first 3 sessions in it), using
 *    the estimated 1-rep max from prRecords.js (reps for bodyweight lifts). The headline is the median change of
 *    the loaded lifts, so one machine swap can't swing it.
 *  - consistency: workouts, sets, volume (lb lifted, weight × reps) and workout length per week, and a streak of
 *    weeks in a row with 3+ workouts.
 *  - balance: direct sets per week for each muscle group (each exercise counts for its own group only).
 * Weeks start on Monday. Pure functions; the page draws the charts.
 */

import { PR_GROUPS, daysBetweenKeys } from "./prRecords.js";

const KG_TO_LB = 2.20462;
const LEVEL_SESSIONS = 3;
const STALE_START_DAYS = 84; // a lift last done more than 12 weeks before the period has no "before" level
const STREAK_MIN_WORKOUTS = 3;
const MIN_MINUTES = 10;
const MAX_MINUTES = 240;

export function addDaysKey(key, days) {
  const [y, m, d] = String(key).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** The Monday of a date's week. */
export function weekStartKey(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  return addDaysKey(key, -weekday);
}

const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : Number(v) || 0);

function workoutDateKey(workout) {
  const key = workout?.dateKey || workout?.date;
  return typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const levelOf = (sessions) => (sessions.length ? Math.max(...sessions.slice(-LEVEL_SESSIONS).map((s) => s.score)) : null);

/**
 * buildProgress(workouts, prRecords, { today, weeks, completedSets })
 *   prRecords: the result of buildPrRecords for the same workouts (for groups and per-session scores)
 *   weeks:     the period length in weeks, or null for all time
 */
export function buildProgress(workouts, prRecords, { today, weeks = 12, completedSets = (ex) => ex?.sets || [] } = {}) {
  const exercises = prRecords?.exercises || [];
  const byId = new Map(exercises.map((ex) => [ex.id, ex]));
  const dated = (Array.isArray(workouts) ? workouts : [])
    .map((w) => ({ w, date: workoutDateKey(w) }))
    .filter((x) => x.date && (!today || x.date <= today))
    .sort((a, b) => a.date.localeCompare(b.date));
  const end = today || (dated.length ? dated[dated.length - 1].date : "");
  if (!dated.length || !end) return null;

  const thisWeek = weekStartKey(end);
  const firstWeek = weekStartKey(dated[0].date);
  const start = weeks ? addDaysKey(thisWeek, -7 * (weeks - 1)) : firstWeek;
  const elapsedWeeks = (daysBetweenKeys(start, end) + 1) / 7;
  // The period before, as far as there is history for it: compared per week, and only when it covers at least
  // half a period.
  let previousStart = null;
  let previousWeeks = 0;
  if (weeks) {
    const from = addDaysKey(start, -7 * weeks);
    previousStart = from < firstWeek ? firstWeek : from;
    previousWeeks = daysBetweenKeys(previousStart, start) / 7;
    if (previousWeeks < weeks / 2) {
      previousStart = null;
      previousWeeks = 0;
    }
  }

  // Per workout: sets, volume, minutes, and sets per muscle group.
  const rows = dated.map(({ w, date }) => {
    const unit = w.unit === "kg" ? "kg" : "lb";
    let sets = 0;
    let volume = 0;
    const byGroup = {};
    for (const ex of Array.isArray(w.exercises) ? w.exercises : []) {
      const done = (completedSets(ex) || []).filter((s) => (parseInt(String(s?.reps ?? ""), 10) || 0) > 0);
      if (!done.length) continue;
      const group = byId.get(ex.exerciseId)?.group || "Other";
      sets += done.length;
      byGroup[group] = (byGroup[group] || 0) + done.length;
      for (const s of done) {
        const weight = Number(s.weight) || 0;
        volume += (unit === "kg" ? weight * KG_TO_LB : weight) * (parseInt(String(s.reps), 10) || 0);
      }
    }
    const minutes = (toMs(w.finishedAt) - toMs(w.startedAt)) / 60000;
    return { date, week: weekStartKey(date), sets, volume, byGroup, minutes: minutes >= MIN_MINUTES && minutes <= MAX_MINUTES ? minutes : null };
  }).filter((r) => r.sets > 0);

  const inRange = (r, from, to) => r.date >= from && r.date <= to;
  const current = rows.filter((r) => inRange(r, start, end));
  const previous = previousStart ? rows.filter((r) => inRange(r, previousStart, addDaysKey(start, -1))) : [];
  const totals = (list, weekCount) => {
    const minutes = list.map((r) => r.minutes).filter((m) => m != null);
    const sets = list.reduce((n, r) => n + r.sets, 0);
    const volume = list.reduce((n, r) => n + r.volume, 0);
    return {
      weeks: weekCount,
      workouts: list.length,
      sets,
      volume: Math.round(volume),
      perWeek: list.length / weekCount,
      setsPerWeek: sets / weekCount,
      volumePerWeek: Math.round(volume / weekCount),
      setsPerWorkout: list.length ? sets / list.length : 0,
      averageMinutes: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
    };
  };

  // Week by week.
  const weekly = [];
  for (let wk = start; wk <= thisWeek; wk = addDaysKey(wk, 7)) {
    const list = current.filter((r) => r.week === wk);
    const byGroup = {};
    for (const r of list) for (const [g, n] of Object.entries(r.byGroup)) byGroup[g] = (byGroup[g] || 0) + n;
    weekly.push({ week: wk, workouts: list.length, sets: list.reduce((n, r) => n + r.sets, 0), volume: Math.round(list.reduce((n, r) => n + r.volume, 0)), byGroup });
  }

  // Streak: weeks in a row with 3+ workouts, counting back from this week (this week counts once it gets there,
  // so an unfinished week doesn't break the streak).
  const perWeek = new Map();
  for (const r of rows) perWeek.set(r.week, (perWeek.get(r.week) || 0) + 1);
  let streak = 0;
  let wk = (perWeek.get(thisWeek) || 0) >= STREAK_MIN_WORKOUTS ? thisWeek : addDaysKey(thisWeek, -7);
  while ((perWeek.get(wk) || 0) >= STREAK_MIN_WORKOUTS) {
    streak += 1;
    wk = addDaysKey(wk, -7);
  }

  // Muscle balance: direct sets per week, now and before; when each group was last trained.
  const groupSets = (list) => {
    const out = {};
    for (const r of list) for (const [g, n] of Object.entries(r.byGroup)) out[g] = (out[g] || 0) + n;
    return out;
  };
  const nowSets = groupSets(current);
  const beforeSets = groupSets(previous);
  const lastTrained = {};
  for (const r of rows) for (const g of Object.keys(r.byGroup)) if (!lastTrained[g] || r.date > lastTrained[g]) lastTrained[g] = r.date;
  const groups = PR_GROUPS.filter((g) => nowSets[g] || beforeSets[g] || lastTrained[g]).map((g) => ({
    group: g,
    setsPerWeek: (nowSets[g] || 0) / elapsedWeeks,
    previousSetsPerWeek: previousStart ? (beforeSets[g] || 0) / previousWeeks : null,
    lastTrained: lastTrained[g] || null,
    daysSince: lastTrained[g] ? daysBetweenKeys(lastTrained[g], end) : null,
  }));

  // Strength: each lift's level now against its level when the period began.
  const lifts = [];
  for (const ex of exercises) {
    const during = ex.sessions.filter((s) => s.date >= start && s.date <= end);
    if (!during.length) continue;
    const before = ex.sessions.filter((s) => s.date < start);
    let from = null;
    let fromLabel = "";
    if (before.length && daysBetweenKeys(before[before.length - 1].date, start) <= STALE_START_DAYS) {
      from = levelOf(before);
      fromLabel = "before";
    } else if (during.length >= LEVEL_SESSIONS + 2) {
      from = Math.max(...during.slice(0, LEVEL_SESSIONS).map((s) => s.score));
      fromLabel = "first sessions";
    }
    const now = levelOf(during);
    lifts.push({
      id: ex.id,
      name: ex.name,
      group: ex.group,
      bodyweight: ex.bodyweight,
      unit: ex.unit,
      sessions: during.length,
      from,
      fromLabel,
      now,
      change: from ? (now - from) / from : null,
      trend: during.map((s) => s.score),
      prs: ex.prs.filter((p) => p.date >= start && p.date <= end).length,
    });
  }
  lifts.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  const measured = lifts.filter((l) => l.change != null && !l.bodyweight);
  const strength = {
    change: median(measured.map((l) => l.change)),
    lifts: measured.length,
    up: measured.filter((l) => l.change >= 0.01).length,
    down: measured.filter((l) => l.change <= -0.01).length,
  };

  return {
    range: { start, end, weeks, previousStart, previousWeeks, elapsedWeeks },
    current: totals(current, elapsedWeeks),
    previous: previousStart ? totals(previous, previousWeeks) : null,
    streak: { weeks: streak, minWorkouts: STREAK_MIN_WORKOUTS },
    weekly,
    groups,
    strength,
    lifts,
  };
}
