const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function loadClientModule(relativePath) {
  const source = fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("new workouts use the current local calendar date without UTC shifting", async () => {
  const { localCalendarDateKey, resolveNewWorkoutDate } = await loadClientModule("../../public/js/workoutSession.js");
  const instant = new Date("2026-08-12T01:30:00.000Z");
  assert.equal(localCalendarDateKey(instant, "America/New_York"), "2026-08-11");
  assert.equal(resolveNewWorkoutDate({ selectedDate: "2026-08-10", manuallySelected: false, now: instant, timeZone: "America/New_York" }), "2026-08-11");
  assert.equal(resolveNewWorkoutDate({ selectedDate: "2026-08-10", manuallySelected: true, now: instant, timeZone: "America/New_York" }), "2026-08-10");
});

test("same-day drafts resume without confirmation and overnight drafts require it", async () => {
  const { needsWorkoutDateConfirmation } = await loadClientModule("../../public/js/workoutSession.js");
  assert.equal(needsWorkoutDateConfirmation({ selectedDate: "2026-08-11", currentDate: "2026-08-11" }), false);
  assert.equal(needsWorkoutDateConfirmation({ selectedDate: "2026-08-10", currentDate: "2026-08-11" }), true);
  assert.equal(needsWorkoutDateConfirmation({ selectedDate: "2026-08-10", currentDate: "2026-08-11", confirmedSelectedDate: "2026-08-10", confirmedCurrentDate: "2026-08-11" }), false);
  assert.equal(needsWorkoutDateConfirmation({ selectedDate: "2026-08-10", currentDate: "2026-08-12", confirmedSelectedDate: "2026-08-10", confirmedCurrentDate: "2026-08-11" }), true);
});

test("draft date choices preserve workout contents", async () => {
  const { applyDraftDateChoice } = await loadClientModule("../../public/js/workoutSession.js");
  const draft = { id: "w1", date: "2026-08-10", exercises: [{ exerciseId: "bench", sets: [{ weight: "225", reps: "8" }] }], notes: "Keep me" };
  const moved = applyDraftDateChoice(draft, "move", "2026-08-11");
  assert.equal(moved.selectedDate, "2026-08-11");
  assert.equal(moved.draft.dateKey, "2026-08-11");
  assert.deepEqual(moved.draft.exercises, draft.exercises);
  assert.equal(moved.draft.notes, "Keep me");
  const kept = applyDraftDateChoice(draft, "keep", "2026-08-11");
  assert.equal(kept.selectedDate, "2026-08-10");
  assert.strictEqual(kept.draft, draft);
  assert.equal(applyDraftDateChoice(draft, "cancel", "2026-08-11").cancelled, true);
});

test("exercise history includes only prior finalized workouts with matching canonical ids", async () => {
  const { selectPreviousExerciseSessions } = await loadClientModule("../../public/js/workoutSession.js");
  const sessions = selectPreviousExerciseSessions([
    { id: "draft", status: "draft", date: "2026-08-11", exercises: [{ exerciseId: "bench", sets: [{ weight: "250", reps: "5" }] }] },
    { id: "current", status: "final", date: "2026-08-11", exercises: [{ exerciseId: "bench", sets: [{ weight: "245", reps: "5" }] }] },
    { id: "old2", status: "final", date: "2026-08-04", unit: "lb", exercises: [{ exerciseId: "bench", sets: [{ weight: "225", reps: "8" }, { weight: "225", reps: "7" }] }] },
    { id: "old1", status: "final", date: "2026-07-28", exercises: [{ exerciseId: "bench-other", sets: [{ weight: "225", reps: "8" }] }] },
  ], "bench", "current");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].workoutId, "old2");
  assert.equal(sessions[0].sets.length, 2);
});

test("exercise history skips later workouts without genuine completed sets", async () => {
  const {
    normalizeCachedExerciseSessions,
    previousSetPlaceholder,
    selectPreviousExerciseSessions,
  } = await loadClientModule("../../public/js/workoutSession.js");
  const workouts = [
    { id: "draft", status: "draft", date: "2026-08-11", exercises: [{ exerciseId: "curl", sets: [{ weight: "80", reps: "20" }] }] },
    { id: "skipped-other", status: "final", date: "2026-08-10", exercises: [{ exerciseId: "squat", sets: [{ weight: "225", reps: "5" }] }] },
    { id: "routine-untouched", status: "final", date: "2026-08-09", exercises: [{ exerciseId: "curl", firstEditTime: null, lastEditTime: null, sets: [{ weight: "0", reps: "10", rpe: "" }] }] },
    { id: "zero-reps", status: "final", date: "2026-08-08", exercises: [{ exerciseId: "curl", sets: [{ weight: "30", reps: "0" }] }] },
    { id: "wrong-id", status: "final", date: "2026-08-07", exercises: [{ exerciseId: "curl-machine", name: "Dumbbell Bicep Curl", sets: [{ weight: "50", reps: "10" }] }] },
    { id: "last-real", status: "final", date: "2026-08-06", unit: "lb", exercises: [{ exerciseId: "curl", sets: [{ weight: "0", reps: "12" }, { weight: "25", reps: "10" }, { weight: "25", reps: "0" }] }] },
    { id: "older-real", status: "final", date: "2026-08-01", unit: "lb", exercises: [{ exerciseId: "curl", sets: [{ weight: "20", reps: "10" }] }] },
  ];

  const sessions = selectPreviousExerciseSessions(workouts, "curl");
  assert.deepEqual(sessions.map((session) => session.workoutId), ["last-real", "older-real"]);
  assert.deepEqual(sessions[0].sets, [
    { weight: "0", reps: "12", rpe: "" },
    { weight: "25", reps: "10", rpe: "" },
  ]);
  assert.equal(previousSetPlaceholder(sessions[0].sets, 0, "weight"), "Last: 0");
  assert.equal(previousSetPlaceholder(sessions[0].sets, 0, "reps"), "Last: 12");

  const refreshed = normalizeCachedExerciseSessions(JSON.parse(JSON.stringify(sessions)));
  assert.deepEqual(refreshed, sessions);
});

test("immediately previous completed exercise wins and placeholders match by visible set index only", async () => {
  const { previousSetPlaceholder, selectPreviousExerciseSessions } = await loadClientModule("../../public/js/workoutSession.js");
  const sessions = selectPreviousExerciseSessions([
    { id: "latest", status: "final", date: "2026-08-10", exercises: [{ exerciseId: "curl", sets: [{ weight: "30", reps: "10" }, { weight: "25", reps: "12" }] }] },
    { id: "older", status: "final", date: "2026-08-03", exercises: [{ exerciseId: "curl", sets: [{ weight: "20", reps: "15" }] }] },
  ], "curl");
  const currentSets = [{ weight: "", reps: "" }, { weight: "", reps: "" }, { weight: "", reps: "" }];
  const before = JSON.parse(JSON.stringify(currentSets));

  assert.equal(sessions[0].workoutId, "latest");
  assert.equal(previousSetPlaceholder(sessions[0].sets, 0, "weight"), "Last: 30");
  assert.equal(previousSetPlaceholder(sessions[0].sets, 1, "reps"), "Last: 12");
  assert.equal(previousSetPlaceholder(sessions[0].sets, 2, "weight"), "");
  assert.deepEqual(currentSets, before, "reference placeholders must not become entered set values");
});

test("set comparisons use the supplied canonical score and expose safe states", async () => {
  const { compareSetPerformance, progressStateMessage } = await loadClientModule("../../public/js/workoutSession.js");
  const { prSetVolume } = await loadClientModule("../../public/js/setScoring.js");
  const comparison = compareSetPerformance({ weight: "230", reps: "8" }, { weight: "225", reps: "8" }, prSetVolume);
  assert.deepEqual({ weight: comparison.weight, reps: comparison.reps, score: comparison.score }, { weight: "increased", reps: "same", score: "increased" });
  assert.equal(compareSetPerformance({ weight: "", reps: "" }, { weight: "225", reps: "8" }, prSetVolume).reason, "current-set-incomplete");
  assert.match(progressStateMessage("loading"), /Loading/);
  assert.match(progressStateMessage("offline", 0), /Offline/);
  assert.match(progressStateMessage("error"), /could not be loaded/);
  assert.match(progressStateMessage("ready", 0), /No previous workout/);
});

test("active workout UI wires date confirmation and in-card progress without UTC slicing", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../public/app.js"), "utf8");
  const html = fs.readFileSync(path.resolve(__dirname, "../../public/index.html"), "utf8");

  assert.doesNotMatch(appSource, /toISOString\(\)\.split\(["']T["']\)/);
  assert.match(appSource, /confirmActiveWorkoutDate\("finalize"\)/);
  assert.match(appSource, /recheckWorkoutDateAfterReturn/);
  assert.match(appSource, /where\("status", "==", "final"\)/);
  assert.match(appSource, /constraints\.push\(startAfter\(cursor\)\)/);
  assert.match(appSource, /updateExerciseSetPlaceholders/);
  assert.match(appSource, /readLocalExerciseProgress/);
  assert.match(appSource, /writeLocalExerciseProgress/);
  assert.match(appSource, /exercise\.lastSets = progress\.sessions\?\.\[0\]\?\.sets \|\| \[\]/);
  assert.match(appSource, /value="\$\{escapeHtml\(s\.weight\)\}" placeholder="\$\{escapeHtml\(phW\)\}"/);
  assert.match(appSource, /compareSetPerformance\(exercise\.sets\[setIndex\], previousSet, prSetVolume\)/);
  assert.match(html, /id="workoutDateDialog"/);
  assert.match(html, />Move workout to today</);
  assert.match(html, />Cancel and preserve draft</);
});

test("a finished workout cannot be reverted to a draft by a late autosave", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../public/app.js"), "utf8");
  const rules = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");

  const saveDraft = appSource.match(/async function saveWorkoutDraft\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(saveDraft, /isFinishingWorkout \|\| isDiscardingWorkout\) return/, "autosave must be skipped while finishing or discarding");
  assert.match(saveDraft, /setDoc\(draftRef,/, "autosave must write to the ref captured at call time");
  assert.match(appSource, /waitForPendingWrites\(db\)/, "in-flight draft writes must settle before finalize");
  assert.match(appSource, /already finalized/i, "an already-finalized error must clear stale draft state");

  assert.match(rules, /allow update: if isOwner\(userId\) && validWorkout\(request\.resource\.data\) &&\s*\(resource\.data\.status == "draft" \|\| request\.resource\.data\.status == resource\.data\.status\)/);
  assert.match(rules, /allow delete: if isOwner\(userId\) && resource\.data\.status == "draft"/);
});

test("workout details show bodyweight sets that have reps but no weight", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../public/app.js"), "utf8");
  assert.doesNotMatch(appSource, /filter\(s => s\.weight && s\.weight\.toString\(\)\.trim\(\) !== ""\)/);
});

test("only empty, stale, non-active drafts are selected for automatic cleanup", async () => {
  const { selectEmptyStaleDraftIds, draftHasMeaningfulProgress, countLoggedSets } = await loadClientModule("../../public/js/workoutSession.js");
  const nowMs = 10 * 60 * 60 * 1000;
  const old = nowMs - 2 * 60 * 60 * 1000;
  const blank = { status: "draft", exercises: [], focus: [], notes: "", templateId: null, routineName: "Custom Workout" };
  const drafts = [
    { id: "blank-old", updatedAtMs: old, ...blank },
    { id: "blank-recent", updatedAtMs: nowMs - 60 * 1000, ...blank },
    { id: "blank-active", updatedAtMs: old, ...blank },
    { id: "has-exercise", updatedAtMs: old, ...blank, exercises: [{ exerciseId: "squat", sets: [] }] },
    { id: "has-notes", updatedAtMs: old, ...blank, notes: "felt strong" },
    { id: "has-routine", updatedAtMs: old, ...blank, routineName: "Leg Day" },
    { id: "has-template", updatedAtMs: old, ...blank, templateId: "t1" },
    { id: "has-focus", updatedAtMs: old, ...blank, focus: ["Legs"] },
    { id: "final-one", updatedAtMs: old, ...blank, status: "final" },
    { updatedAtMs: old, ...blank },
  ];
  assert.deepEqual(selectEmptyStaleDraftIds(drafts, { activeId: "blank-active", nowMs }), ["blank-old"]);
  assert.equal(draftHasMeaningfulProgress(blank), false);
  assert.equal(draftHasMeaningfulProgress({ ...blank, exercises: [{}] }), true);
  assert.equal(countLoggedSets([
    { sets: [{ weight: "135", reps: "5" }, { weight: "", reps: "" }, { weight: "", reps: "12" }, { weight: "20", reps: "" }] },
    { sets: [{ weight: "", reps: "" }] },
    null,
  ]), 3);
});

test("draft cleanup is wired: one draft at a time, in-app discard, safe discard of the active workout", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../public/app.js"), "utf8");
  const html = fs.readFileSync(path.resolve(__dirname, "../../public/index.html"), "utf8");

  assert.match(html, /id="discardWorkoutBtn"/);
  assert.match(appSource, /runBootstrapStep\("draft cleanup", \(\) => purgeEmptyStaleDrafts\(\)\)/);
  // every way of starting a workout must stop when an unfinished draft already exists
  const guardCalls = appSource.match(/if \(await blockStartIfUnfinishedDraft\(\)\) return;/g) || [];
  assert.equal(guardCalls.length, 3, "blank start, routine start and AI routine start must all be guarded");
  // deleting the active workout must not be undone by a late autosave
  const discard = appSource.match(/async function discardWorkoutDraft\([\s\S]*?\n\}/)[0];
  assert.match(discard, /isDiscardingWorkout = true/);
  assert.match(discard, /finally \{\s*isDiscardingWorkout = false;/);
  assert.match(appSource, /isFinishingWorkout \|\| isDiscardingWorkout\) return;/);
  // discarding a draft with logged sets asks first, and the prompt moves on to the next draft
  assert.match(appSource, /Permanently delete the unfinished workout/);
  assert.match(appSource, /if \(next\.best\) showDraftRecoveryDialog\(next\.best, next\.count\)/);
});
