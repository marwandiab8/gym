// AI coach: what the analyzeWorkout function tells the model about your training, and how its answer is checked.
//
// The facts are worked out here, not by the model: each exercise's sets, volume and estimated 1-rep max, its
// timing (from when its sets were logged), its heart rate (users/{uid}/workoutHeartRate/{workoutId}), the last
// time you did it, and the days between workouts. The model only interprets them, as a coach.
//
// Timing comes from when sets were logged, not from a stopwatch: an exercise's first and last logged set
// (firstEditTime / lastEditTime). "Minutes per set" is the time from one logged set to the next, on average -
// rest plus the set itself; "gap from previous" runs from the previous exercise's last logged set to this
// one's first (rest, setting up, and its first set). Sets have no times of their own.
const { isCompletedSet, parseReps, parseWeight } = require("./setScoring");

const TIME_ZONE = "America/Toronto";
const DAY_MS = 24 * 60 * 60 * 1000;
const EPLEY_REP_CAP = 15; // as public/js/prRecords.js estimateOneRepMax
const RECENT_DAYS = 28;
const MAX_SESSIONS_LISTED = 8;
const QUESTION_MAX_LENGTH = 500;

/** Epley estimated 1-rep max (reps above 15 counted as 15), as public/js/prRecords.js. */
function estimateOneRepMax(weight, reps) {
  const w = Number(weight) || 0;
  const r = Math.min(Number(reps) || 0, EPLEY_REP_CAP);
  if (w <= 0 || r <= 0) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}

/** Epoch ms from a Firestore Timestamp, { seconds }, Date, number or numeric/ISO string; null when unknown. */
function toMs(value) {
  if (value == null || value === "") return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "object" && Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function localParts(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms))
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
}
const localDate = (ms) => { const p = localParts(ms); return `${p.year}-${p.month}-${p.day}`; };
const localTime = (ms) => { const p = localParts(ms); return `${p.hour}:${p.minute}`; };
const weekday = (ms) => localParts(ms).weekday;
const round1 = (n) => Math.round(n * 10) / 10;
const minutesBetween = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? round1((b - a) / 60000) : null);
const clip = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** When a workout started (ms): its start time, else its date. */
function workoutStartMs(w) {
  return toMs(w && w.startedAt) ?? toMs(w && w.date) ?? toMs(w && w.dateKey);
}

/** The sets that were done: [{ weight, reps, rpe }]. */
function doneSets(ex) {
  return (Array.isArray(ex && ex.sets) ? ex.sets : []).filter(isCompletedSet).map((s) => {
    const rpe = Number(String(s.rpe ?? "").trim());
    return { weight: parseWeight(s.weight), reps: parseReps(s.reps), rpe: Number.isFinite(rpe) && rpe > 0 ? rpe : null };
  });
}

const setText = (s) => `${s.weight > 0 ? `${s.weight}x${s.reps}` : `bodyweight x${s.reps}`}${s.rpe ? ` RPE ${s.rpe}` : ""}`;

/** Best set by estimated 1-rep max (by reps for bodyweight work): { text, e1rm } or null. */
function bestSet(sets) {
  let best = null;
  for (const s of sets) {
    const score = s.weight > 0 ? estimateOneRepMax(s.weight, s.reps) : s.reps / 1000;
    if (!best || score > best.score) best = { score, s };
  }
  if (!best) return null;
  return { text: setText(best.s), e1rm: best.s.weight > 0 ? round1(best.score) : null };
}

const exerciseKey = (ex) => String((ex && (ex.exerciseId || ex.name)) || "").toLowerCase();

/** The heart rate for exercise index i from a workoutHeartRate doc: { avg, max, min, minutesRecorded, perMinute }. */
function exerciseHeartRate(hrDoc, i) {
  const hr = (Array.isArray(hrDoc && hrDoc.exercises) ? hrDoc.exercises : []).find((e) => Number(e && e.i) === i);
  if (!hr) return null;
  return {
    avg: hr.avg ?? null,
    max: hr.max ?? null,
    min: hr.min ?? null,
    minutesRecorded: hr.minutes ?? null,
    perMinute: (Array.isArray(hr.series) ? hr.series : []).map((p) => Number(p && p.b)).filter(Number.isFinite),
  };
}

function sessionHeartRate(hrDoc) {
  if (!hrDoc || !Number.isFinite(Number(hrDoc.avg))) return null;
  return { avg: hrDoc.avg, max: hrDoc.max ?? null, min: hrDoc.min ?? null, minutesRecorded: hrDoc.minutes ?? null };
}

/** The last time each exercise was done before `beforeMs`, from older workouts (newest first). */
function lastTimeLookup(history, beforeMs) {
  const older = history
    .filter((w) => (workoutStartMs(w) ?? 0) < beforeMs)
    .sort((a, b) => (workoutStartMs(b) ?? 0) - (workoutStartMs(a) ?? 0));
  return (ex) => {
    const key = exerciseKey(ex);
    for (const w of older) {
      const match = (w.exercises || []).find((e) => exerciseKey(e) === key);
      const sets = match ? doneSets(match) : [];
      if (!sets.length) continue;
      const startMs = workoutStartMs(w);
      const best = bestSet(sets);
      return { date: localDate(startMs), daysAgo: Math.round((beforeMs - startMs) / DAY_MS), sets: sets.map(setText), bestSet: best.text, bestE1rm: best.e1rm };
    }
    return null;
  };
}

/** Everything about one workout the coach looks at. */
function workoutFacts(w, hrDoc, { lastTime = () => null } = {}) {
  const startMs = workoutStartMs(w);
  const endMs = toMs(w.finishedAt);
  const exercises = [];
  let setCount = 0;
  let volume = 0;
  let prevLast = null;
  (Array.isArray(w.exercises) ? w.exercises : []).forEach((ex, i) => {
    const sets = doneSets(ex);
    const first = toMs(ex.firstEditTime) ?? toMs(ex.addedAt);
    const last = toMs(ex.lastEditTime) ?? first;
    if (sets.length) {
      const exVolume = sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
      const best = bestSet(sets);
      setCount += sets.length;
      volume += exVolume;
      exercises.push({
        order: exercises.length + 1,
        name: clip(ex.name, 80) || "Exercise",
        note: clip(ex.exerciseNote, 200) || undefined,
        sets: sets.map(setText),
        totalReps: sets.reduce((sum, s) => sum + s.reps, 0),
        volume: Math.round(exVolume),
        bestSet: best.text,
        bestE1rm: best.e1rm,
        timing: {
          firstSetLoggedAt: Number.isFinite(first) ? localTime(first) : null,
          minutesFirstToLastSet: sets.length > 1 ? minutesBetween(first, last) : null,
          minutesPerSet: sets.length > 1 && Number.isFinite(first) && Number.isFinite(last) && last > first ? round1((last - first) / 60000 / (sets.length - 1)) : null,
          minutesFromPreviousExercise: prevLast != null ? minutesBetween(prevLast, first) : null,
        },
        heartRate: exerciseHeartRate(hrDoc, i),
        lastTime: lastTime(ex),
      });
    }
    if (Number.isFinite(last)) prevLast = last;
  });
  return {
    date: Number.isFinite(startMs) ? localDate(startMs) : clip(w.dateKey, 10) || null,
    weekday: Number.isFinite(startMs) ? weekday(startMs) : null,
    started: Number.isFinite(startMs) ? localTime(startMs) : null,
    finished: Number.isFinite(endMs) ? localTime(endMs) : null,
    durationMin: Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? Math.round((endMs - startMs) / 60000) : null,
    routine: clip(w.routineName, 80) || "Custom Workout",
    focus: Array.isArray(w.focus) ? w.focus.map((f) => clip(f, 40)).filter(Boolean) : [],
    notes: clip(w.notes, 400) || undefined,
    unit: w.unit === "kg" ? "kg" : "lb",
    exerciseCount: exercises.length,
    setCount,
    totalVolume: Math.round(volume),
    heartRate: sessionHeartRate(hrDoc),
    exercises,
  };
}

/** A short line about a workout, for lists of sessions. */
function sessionSummary(w, hrDoc) {
  const f = workoutFacts(w, hrDoc);
  return {
    date: f.date,
    weekday: f.weekday,
    routine: f.routine,
    focus: f.focus,
    durationMin: f.durationMin,
    sets: f.setCount,
    volume: f.totalVolume,
    heartRate: f.heartRate ? { avg: f.heartRate.avg, max: f.heartRate.max } : null,
    exercises: f.exercises.map((e) => ({ name: e.name, sets: e.sets.length, bestSet: e.bestSet, bestE1rm: e.bestE1rm })),
  };
}

const highestHr = (hrDocs) => {
  const maxes = hrDocs.map((d) => Number(d && d.max)).filter(Number.isFinite);
  return maxes.length ? Math.max(...maxes) : null;
};

/**
 * The facts for "analyze this workout": the workout, how each exercise compares with last time, and the days
 * between it and the workouts around it. `history`: other finished workouts; `hrById`: workoutId -> HR doc.
 */
function buildWorkoutAnalysisFacts({ target, history = [], hrById = {} }) {
  const startMs = workoutStartMs(target) ?? Date.now();
  const others = history.filter((w) => w && w.id !== target.id && Number.isFinite(workoutStartMs(w)));
  const before = others.filter((w) => workoutStartMs(w) < startMs).sort((a, b) => workoutStartMs(b) - workoutStartMs(a));
  const previous = before[0] || null;
  const countSince = (days) => before.filter((w) => startMs - workoutStartMs(w) <= days * DAY_MS).length;
  return {
    kind: "single workout",
    workout: workoutFacts(target, hrById[target.id], { lastTime: lastTimeLookup(others, startMs) }),
    betweenWorkouts: {
      daysSincePreviousWorkout: previous ? round1((startMs - workoutStartMs(previous)) / DAY_MS) : null,
      previousWorkout: previous ? { date: localDate(workoutStartMs(previous)), routine: clip(previous.routineName, 80) || "Custom Workout", focus: previous.focus || [] } : null,
      workoutsInPrevious7Days: countSince(7),
      workoutsInPrevious28Days: countSince(28),
      recentSessions: before.slice(0, MAX_SESSIONS_LISTED).map((w) => sessionSummary(w, hrById[w.id])),
    },
    highestHeartRateSeenInWorkouts: highestHr(Object.values(hrById)),
  };
}

/** The facts for "analyze my last 4 weeks": every session, the gaps between them, and how each lift moved. */
function buildRecentAnalysisFacts({ workouts = [], hrById = {}, nowMs = Date.now() }) {
  const since = nowMs - RECENT_DAYS * DAY_MS;
  const sessions = workouts
    .filter((w) => Number.isFinite(workoutStartMs(w)) && workoutStartMs(w) >= since && workoutStartMs(w) <= nowMs)
    .sort((a, b) => workoutStartMs(a) - workoutStartMs(b));
  const gaps = [];
  for (let i = 1; i < sessions.length; i++) gaps.push(round1((workoutStartMs(sessions[i]) - workoutStartMs(sessions[i - 1])) / DAY_MS));
  const perWeek = [0, 0, 0, 0];
  for (const w of sessions) perWeek[Math.min(3, Math.floor((nowMs - workoutStartMs(w)) / (7 * DAY_MS)))] += 1;

  const lifts = new Map();
  for (const w of sessions) {
    for (const ex of w.exercises || []) {
      const sets = doneSets(ex);
      if (!sets.length) continue;
      const key = exerciseKey(ex);
      const best = bestSet(sets);
      const lift = lifts.get(key) || { name: clip(ex.name, 80), sessions: [] };
      lift.sessions.push({ date: localDate(workoutStartMs(w)), bestSet: best.text, bestE1rm: best.e1rm, sets: sets.length });
      lifts.set(key, lift);
    }
  }
  const liftTrends = [...lifts.values()]
    .filter((l) => l.sessions.length >= 2)
    .map((l) => {
      const first = l.sessions[0];
      const last = l.sessions[l.sessions.length - 1];
      const change = first.bestE1rm && last.bestE1rm ? Math.round(((last.bestE1rm - first.bestE1rm) / first.bestE1rm) * 1000) / 10 : null;
      return { name: l.name, timesDone: l.sessions.length, first, last, e1rmChangePercent: change };
    });
  const latest = sessions[sessions.length - 1];
  return {
    kind: "last 4 weeks",
    period: { from: localDate(since), to: localDate(nowMs), days: RECENT_DAYS },
    workoutCount: sessions.length,
    workoutsPerWeek: { thisWeek: perWeek[0], lastWeek: perWeek[1], twoWeeksAgo: perWeek[2], threeWeeksAgo: perWeek[3] },
    daysBetweenWorkouts: gaps,
    daysSinceLastWorkout: latest ? round1((nowMs - workoutStartMs(latest)) / DAY_MS) : null,
    sessions: sessions.map((w) => sessionSummary(w, hrById[w.id])),
    liftTrends,
    highestHeartRateSeenInWorkouts: highestHr(Object.values(hrById)),
  };
}

const REPORT_SHAPE = `{
  "headline": "one sentence: your verdict",
  "rating": 7,
  "summary": "2-4 sentences: the big picture",
  "strengths": ["what was genuinely good, with the numbers"],
  "critique": [{ "area": "short label", "detail": "what is holding them back and why, with the numbers" }],
  "heartRate": "effort and intensity read from the heart rate, exercise by exercise where it tells you something",
  "pacing": "rest and timing within the session: minutes per set, gaps between exercises, session length",
  "recovery": "the time between workouts, frequency and recovery",
  "recommendations": [{ "title": "short action", "detail": "exactly what to do: loads, reps, sets, rest, order, days" }],
  "nextSession": "a concrete plan for the next session"
}`;

const COACH_SYSTEM_PROMPT = [
  "You are an elite strength and conditioning coach: 20 years coaching lifters from beginners to competitive athletes,",
  "CSCS-certified, fluent in hypertrophy and strength research (volume landmarks, proximity to failure, rest-interval",
  "studies, progressive overload, recovery). You coach like the best coaches do: direct, specific and encouraging,",
  "never vague. You praise what is genuinely good, call out what is holding the athlete back, and always say exactly",
  "what to change.",
  "",
  "You are given one athlete's logged training data as JSON. Analyze it and critique it:",
  "- Performance: sets, reps, loads and RPE against the last time they did each exercise (progression, stalls, drops),",
  "  volume per muscle group, exercise selection and order.",
  "- Heart rate (beats per minute from their Apple Watch, about one reading per minute): what it says about effort and",
  "  intensity on each exercise, whether it came back down between sets (perMinute is that exercise's readings in order),",
  "  and anything unusual. Compare with their highest heart rate seen in workouts rather than an age formula.",
  "- Timing: minutesPerSet is the average time from one logged set to the next (the rest plus the set itself);",
  "  minutesFromPreviousExercise is the time from the previous exercise's last set to this one's first (rest, setting up",
  "  and the first set). These come from when sets were logged in the app, so treat them as close, not exact. Judge the",
  "  rest against the goal of each lift (heavy compounds typically 2-5 minutes, hypertrophy work 1-2 minutes).",
  "- Between workouts: days between sessions, frequency, and whether each muscle group gets enough recovery and",
  "  enough frequency.",
  "",
  "Rules: use only the numbers in the data and quote them; never invent sets, weights or readings. If something is",
  "missing (no heart rate, a single set, no history), say so briefly and work with what is there. Weights are in the",
  "unit given. Keep safety first: point out signs of overreaching or a risky jump in load, but do not diagnose medical",
  "conditions; if the heart rate looks abnormal (very high at rest, or not coming down at all), suggest checking with",
  "a doctor. If the athlete asks a question, answer it directly in the summary and the recommendations.",
  "",
  `Reply with only a JSON object in exactly this shape (rating is a whole number 1-10 for the quality of the training;`,
  `2-5 strengths, 2-5 critique items, 3-6 recommendations; no markdown):`,
  REPORT_SHAPE,
].join("\n");

/** The user message: the facts, and the athlete's question if any. */
function coachUserMessage(facts, question) {
  const q = clip(question, QUESTION_MAX_LENGTH);
  return `${q ? `The athlete asks: ${q}\n\n` : ""}Training data (${facts.kind}):\n${JSON.stringify(facts)}`;
}

const text = (value, max) => String(value ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const textList = (value, maxItems, maxLen) => (Array.isArray(value) ? value : []).map((v) => text(v, maxLen)).filter(Boolean).slice(0, maxItems);

/**
 * The OpenAI Responses API request for a GPT-6 model (a reasoning model: no temperature; max_output_tokens covers
 * its reasoning as well as the reply, and OpenAI suggests leaving 25,000 for both).
 */
function responsesRequest({ model, system, user, effort = "medium", maxOutputTokens = 25000 }) {
  return {
    model,
    input: [
      { role: "developer", content: system },
      { role: "user", content: user },
    ],
    reasoning: { effort },
    max_output_tokens: maxOutputTokens,
  };
}

/**
 * The reply text of a Responses API answer: the output_text parts of its message items. { text, status,
 * incompleteReason }; an answer cut short (status "incomplete") may have no text at all.
 */
function responsesOutputText(apiData) {
  const parts = [];
  for (const item of Array.isArray(apiData && apiData.output) ? apiData.output : []) {
    if (!item || item.type !== "message") continue;
    for (const c of Array.isArray(item.content) ? item.content : []) {
      if (c && c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return {
    text: parts.join("").trim(),
    status: String((apiData && apiData.status) || ""),
    incompleteReason: (apiData && apiData.incomplete_details && apiData.incomplete_details.reason) || null,
  };
}

/** A JSON object in a reply: the whole reply, or the part from its first "{" to its last "}" (fences, a stray line). */
function parseJsonObject(raw) {
  const body = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  for (const candidate of [body, body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // try the next candidate
    }
  }
  return null;
}

/** The model's reply, checked and trimmed; null when it isn't a usable report. */
function normalizeCoachReport(raw) {
  const data = typeof raw === "string" ? parseJsonObject(raw) : raw;
  if (!data || typeof data !== "object") return null;
  const rating = Math.round(Number(data.rating));
  const report = {
    headline: text(data.headline, 240),
    rating: Number.isFinite(rating) && rating >= 1 && rating <= 10 ? rating : null,
    summary: text(data.summary, 1500),
    strengths: textList(data.strengths, 6, 400),
    critique: (Array.isArray(data.critique) ? data.critique : [])
      .map((c) => (c && typeof c === "object" ? { area: text(c.area, 80), detail: text(c.detail, 700) } : { area: "", detail: text(c, 700) }))
      .filter((c) => c.detail)
      .slice(0, 6),
    heartRate: text(data.heartRate, 1500),
    pacing: text(data.pacing, 1500),
    recovery: text(data.recovery, 1500),
    recommendations: (Array.isArray(data.recommendations) ? data.recommendations : [])
      .map((r) => (r && typeof r === "object" ? { title: text(r.title, 120), detail: text(r.detail, 700) } : { title: "", detail: text(r, 700) }))
      .filter((r) => r.title || r.detail)
      .slice(0, 8),
    nextSession: text(data.nextSession, 1500),
  };
  if (!report.headline && !report.summary) return null;
  if (!report.recommendations.length) return null;
  return report;
}

/**
 * Asks the coach: `primary` (a GPT-6 model) through the Responses API; if OpenAI refuses that request or its answer
 * can't be used, `fallback` through Chat Completions (the coach's first model). { report, model } with the model that
 * answered, or null when neither could.
 */
async function askCoach({ apiKey, user, primary, fallback, fetchImpl = fetch, log = console }) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify(responsesRequest({ model: primary, system: COACH_SYSTEM_PROMPT, user })),
    });
    if (response.ok) {
      const apiData = await response.json();
      const out = responsesOutputText(apiData);
      const report = normalizeCoachReport(out.text);
      if (report) return { report, model: primary };
      log.error("Coach answer not usable; asking the fallback model", {
        model: primary,
        status: out.status,
        incompleteReason: out.incompleteReason,
        textLength: out.text.length,
        reasoningTokens: (apiData && apiData.usage && apiData.usage.output_tokens_details && apiData.usage.output_tokens_details.reasoning_tokens) ?? null,
      });
    } else {
      const errorBody = await response.text();
      log.error("OpenAI Responses API failed (coach); asking the fallback model", { model: primary, status: response.status, bodyPreview: errorBody.slice(0, 300) });
    }
  } catch (error) {
    log.error("OpenAI Responses API request failed (coach); asking the fallback model", { model: primary, message: (error && error.message) || String(error) });
  }

  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: fallback,
      temperature: 0.4,
      max_tokens: 2200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: COACH_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    log.error("OpenAI API failed (coach fallback)", { model: fallback, status: response.status, bodyPreview: errorBody.slice(0, 160) });
    return null;
  }
  const apiData = await response.json();
  const choice = apiData && Array.isArray(apiData.choices) ? apiData.choices[0] : null;
  const report = normalizeCoachReport((choice && choice.message && choice.message.content) || "");
  if (!report) log.error("Coach fallback reply was not a usable report", { model: fallback, finishReason: (choice && choice.finish_reason) || null });
  return report ? { report, model: fallback } : null;
}

module.exports = {
  COACH_SYSTEM_PROMPT,
  QUESTION_MAX_LENGTH,
  RECENT_DAYS,
  askCoach,
  buildRecentAnalysisFacts,
  buildWorkoutAnalysisFacts,
  coachUserMessage,
  estimateOneRepMax,
  normalizeCoachReport,
  responsesOutputText,
  responsesRequest,
  toMs,
  workoutFacts,
};
