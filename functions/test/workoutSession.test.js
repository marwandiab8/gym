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

test("exercise history uses the derived last session when the capped scan could not reach it", async () => {
  const { resolveExerciseSessions } = await loadClientModule("../../public/js/workoutSession.js");
  const session = (workoutId, updatedAtMs) => ({
    workoutId, date: "2026-01-01", updatedAtMs, unit: "lb", exerciseNote: "", sets: [{ weight: "100", reps: "5", rpe: "" }],
  });
  const derived = [session("old-workout", 1)];

  // scan finished and found nothing: a genuinely new exercise, nothing to invent
  assert.deepEqual(resolveExerciseSessions({ history: { sessions: [], complete: true }, derivedSessions: derived }), []);
  // scan hit its page cap before finding anything: fall back to the derived last session
  assert.deepEqual(
    resolveExerciseSessions({ history: { sessions: [], complete: false }, derivedSessions: derived }).map((s) => s.workoutId),
    ["old-workout"]
  );
  // capped scan that already found the same session does not duplicate it
  assert.deepEqual(
    resolveExerciseSessions({ history: { sessions: [session("old-workout", 1)], complete: false }, derivedSessions: derived }).map((s) => s.workoutId),
    ["old-workout"]
  );
  // a full set of sessions is returned untouched
  const five = [5, 4, 3, 2, 1].map((n) => session(`w${n}`, n));
  assert.equal(resolveExerciseSessions({ history: { sessions: five, complete: false }, derivedSessions: derived }).length, 5);
  // offline/error still merges everything, including the on-device cache
  assert.deepEqual(
    resolveExerciseSessions({ history: null, derivedSessions: derived, cachedSessions: [session("cached", 2)], historyUnavailable: true }).map((s) => s.workoutId),
    ["cached", "old-workout"]
  );
});

test("exercise history scan is capped and shared between exercise cards", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../public/app.js"), "utf8");
  assert.match(appSource, /const FINAL_HISTORY_MAX_PAGES = \d+;/);
  const fetchProgress = appSource.match(/async function fetchExerciseProgress\([\s\S]*?\n\}/)[0];
  assert.match(fetchProgress, /for \(let index = 0; index < FINAL_HISTORY_MAX_PAGES; index\+\+\)/);
  assert.match(fetchProgress, /loadFinalHistoryPage\(index\)/);
  assert.doesNotMatch(fetchProgress, /while \(true\)/, "the history scan must not be unbounded");
  assert.doesNotMatch(fetchProgress, /getDocs\(query\(\s*collection\(db, "users", currentUser\.uid, "workouts"\)/, "cards must share pages, not query on their own");
  // finishing a workout must drop the shared pages so the new workout shows up as history
  const invalidate = appSource.match(/function invalidateFinalSetsCache\([\s\S]*?\n\}/)[0];
  assert.match(invalidate, /finalHistoryPages = \{ uid: null, pages: \[\] \}/);
  // a failed page read must not be cached
  assert.match(appSource, /delete state\.pages\[index\]/);
});

test("a brand-new exercise (no history, no cached last sets) does not crash the progress load", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../public/app.js"), "utf8");
  const fetchProgress = appSource.match(/async function fetchExerciseProgress\([\s\S]*?\n\}/)[0];
  // `lastData?.x === latestSession?.y` is true when both are null/undefined, then `lastData.exerciseNote` throws
  assert.doesNotMatch(fetchProgress, /lastData\?\.sourceWorkoutId === latestSession\?\.workoutId/);
  assert.match(fetchProgress, /lastData && latestSession && lastData\.sourceWorkoutId === latestSession\.workoutId/);
});

test("PRs are written only by Functions: no client PR writer or client PR write rule remains", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../public/app.js"), "utf8");
  const rules = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");

  assert.doesNotMatch(appSource, /updatePRsAfterWorkout/);
  assert.doesNotMatch(appSource, /pickBestSetForPR/, "unused import must not come back");
  // the app may still read and delete PRs, but must not write them
  assert.doesNotMatch(appSource, /(setDoc|updateDoc|addDoc)\(\s*(prRef|doc\(db, "users", currentUser\.uid, "prs")/);

  const prsRules = rules.match(/match \/prs\/\{prId\} \{[\s\S]*?\n      \}/)[0];
  assert.match(prsRules, /allow read: if isOwner\(userId\)/);
  assert.match(prsRules, /allow delete: if isOwner\(userId\)/);
  assert.doesNotMatch(prsRules, /allow (create|update|write)/);
  assert.doesNotMatch(rules, /validPr|isWeight/, "helpers for the removed PR client rule must go with it");
});

test("date correction request targets exactly one saved workout and is accepted by the server-side checks", async () => {
  const { buildDateCorrectionRequest } = await loadClientModule("../../public/js/workoutSession.js");
  const { selectDateRepairCandidates, buildDateRepairPlan } = require("../lib/workoutDateRepair");

  const shoulders = {
    id: "shoulders-1", status: "final", date: "2026-09-14", dateKey: "2026-09-14", routineName: "Shoulders",
    finalizationId: "shoulders-1_111", finalizedAtMs: 1_700_000_222_000,
    exercises: [{ exerciseId: "ohp" }, { exerciseId: "lateral-raise" }],
  };
  const legs = {
    id: "legs-1", status: "final", date: "2026-09-14", dateKey: "2026-09-14", routineName: "Legs",
    finalizationId: "legs-1_999", finalizedAtMs: 1_700_000_111_000,
    exercises: [{ exerciseId: "squat" }, { exerciseId: "rdl" }],
  };

  const request = buildDateCorrectionRequest(shoulders, " 2026-09-15 ", { todayKey: "2026-09-18" });
  assert.equal(request.workoutId, "shoulders-1");
  assert.equal(request.originalDate, "2026-09-14");
  assert.equal(request.newDate, "2026-09-15");
  assert.deepEqual(request.exerciseIds, ["ohp", "lateral-raise"]);

  // two workouts share the wrong date; the request must single out the shoulders workout only
  const candidates = selectDateRepairCandidates([legs, shoulders], request);
  assert.deepEqual(candidates.map((w) => w.id), ["shoulders-1"]);

  // and the server's own repair plan accepts it and changes only the date fields
  const plan = buildDateRepairPlan({
    workoutId: request.workoutId, workout: shoulders, expectedOriginalDate: request.originalDate, newDate: request.newDate,
    expectedFinalizationId: request.expectedFinalizationId, expectedFinalizedAtMs: request.expectedFinalizedAtMs,
  });
  assert.deepEqual(plan.workoutPatch, { date: "2026-09-15", dateKey: "2026-09-15" });

  const rejects = (workout, newDate, opts, pattern) =>
    assert.throws(() => buildDateCorrectionRequest(workout, newDate, opts), pattern);
  rejects({ ...shoulders, status: "draft" }, "2026-09-15", {}, /saved workout/);
  rejects(shoulders, "15/09/2026", {}, /YYYY-MM-DD/);
  rejects(shoulders, "2026-02-30", {}, /YYYY-MM-DD/);
  rejects(shoulders, "2026-09-14", {}, /already/);
  rejects(shoulders, "2026-09-25", { todayKey: "2026-09-18" }, /future/);
  rejects({ ...shoulders, finalizationId: "" }, "2026-09-15", {}, /older version/);
  rejects({ ...shoulders, finalizedAtMs: 0 }, "2026-09-15", {}, /older version/);
});

test("workout details popup can change a saved workout's date and remove it through the server functions", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../public/app.js"), "utf8");
  const html = fs.readFileSync(path.resolve(__dirname, "../../public/index.html"), "utf8");
  assert.match(html, /id="editWorkoutDateBtn"/);
  assert.match(html, /id="removeWorkoutBtn"/);
  // preview must run and be verified before the change is applied
  const handler = appSource.match(/els\.editWorkoutDateBtn\?\.addEventListener\("click"[\s\S]*?\n\}\);/)[0];
  assert.ok(handler.indexOf("previewWorkoutDateCorrection") < handler.indexOf("correctFinalizedWorkoutDate"));
  assert.match(handler, /matches\.length !== 1 \|\| matches\[0\]\.workoutId !== workout\.id/);
  assert.match(handler, /confirm\(/);
  assert.match(appSource, /httpsCallable\(functions, "archiveWorkout"\)/);
  // only saved workouts can use these buttons
  assert.match(appSource, /els\.editWorkoutDateBtn\.disabled = !isSavedWorkout/);
  assert.match(appSource, /els\.removeWorkoutBtn\.disabled = !isSavedWorkout/);
  // caches derived from workouts are dropped afterwards
  assert.match(appSource, /async function refreshAfterSavedWorkoutChange[\s\S]*invalidateFinalSetsCache\(exerciseIds\)[\s\S]*resetWorkoutAnalyticsCaches\(\)/);
});

test("moveListItem moves one item and never changes the input or the ends", async () => {
  const { moveListItem } = await loadClientModule("../../public/js/workoutSession.js");
  const list = ["squat", "rdl", "press", "row"];
  assert.deepEqual(moveListItem(list, 2, -1), ["squat", "press", "rdl", "row"]);
  assert.deepEqual(moveListItem(list, 0, 1), ["rdl", "squat", "press", "row"]);
  assert.deepEqual(moveListItem(list, 0, -1), list, "moving the first item up does nothing");
  assert.deepEqual(moveListItem(list, 3, 1), list, "moving the last item down does nothing");
  assert.deepEqual(moveListItem(list, 9, -1), list);
  assert.deepEqual(list, ["squat", "rdl", "press", "row"], "input is not mutated");
  assert.deepEqual(moveListItem(null, 0, 1), []);
});

test("routines list is stable, keeps the user's order, and only rewrites what changed", async () => {
  const { sortRoutines, moveRoutine } = await loadClientModule("../../public/js/workoutSession.js");
  // never arranged: oldest first, then name (used to follow random document ids)
  const legacy = [
    { id: "z9", name: "Upper", createdAtMs: 300 },
    { id: "a1", name: "Legs", createdAtMs: 100 },
    { id: "m5", name: "Push", createdAtMs: 200 },
    { id: "pending", name: "Just saved", createdAtMs: 0 },
  ];
  assert.deepEqual(sortRoutines(legacy).map((r) => r.id), ["a1", "m5", "z9", "pending"]);

  // arranged routines come first in their order; a newly created one goes after them
  const arranged = [
    { id: "a1", name: "Legs", order: 1, createdAtMs: 100 },
    { id: "z9", name: "Upper", order: 0, createdAtMs: 300 },
    { id: "new", name: "Arms", createdAtMs: 400 },
  ];
  assert.deepEqual(sortRoutines(arranged).map((r) => r.id), ["z9", "a1", "new"]);

  // first move on a never-arranged list numbers everything once, in the new order
  const first = moveRoutine(sortRoutines(legacy), "z9", -1);
  assert.deepEqual(first.routines.map((r) => r.id), ["a1", "z9", "m5", "pending"]);
  assert.deepEqual(first.routines.map((r) => r.order), [0, 1, 2, 3]);
  assert.equal(first.updates.length, 4);

  // once arranged, a swap rewrites only the two routines that changed places
  const second = moveRoutine(first.routines, "m5", -1);
  assert.deepEqual(second.routines.map((r) => r.id), ["a1", "m5", "z9", "pending"]);
  assert.deepEqual(second.updates, [{ id: "m5", order: 1 }, { id: "z9", order: 2 }]);

  // impossible moves change nothing and write nothing
  assert.deepEqual(moveRoutine(second.routines, "a1", -1).updates, []);
  assert.deepEqual(moveRoutine(second.routines, "pending", 1).updates, []);
  assert.deepEqual(moveRoutine(second.routines, "does-not-exist", 1).updates, []);
});

test("routines and exercises can be reordered in the UI, and the order is saved", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../public/app.js"), "utf8");
  const rules = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");

  // routine list: sorted on load, moved through a batch write of `order`
  assert.match(appSource, /loadedTemplates = sortRoutines\(/);
  assert.match(appSource, /writeBatch\(db\)/);
  assert.match(appSource, /batch\.update\(doc\(db, "users", currentUser\.uid, "templates", templateId\), \{ order \}\)/);
  assert.match(appSource, /class="moveTemplateUp/);
  assert.match(appSource, /class="moveTemplateDown/);
  // failed save is reverted, not silently kept
  assert.match(appSource, /loadedTemplates = previous;/);
  // exercises inside the Edit Routine screen and the active workout
  assert.match(appSource, /currentEditTemplateExercises = moveListItem\(currentEditTemplateExercises, idx, -1\)/);
  assert.match(appSource, /workoutState\.exercises = moveListItem\(workoutState\.exercises, exIndex, delta\); renderWorkoutBuilder\(\); scheduleAutosave\(\);/);
  // the saved routine keeps whatever order the exercises are in when it is saved
  assert.match(appSource, /const templateExercises = workoutState\.exercises\.map\(ex => \(\{ exerciseId: ex\.exerciseId, name: ex\.name \}\)\)/);
  // rules accept an integer order on routines
  assert.match(rules, /hasOnly\(\["name", "exercises", "createdAt", "order"\]\)/);
  assert.match(rules, /data\.order is int/);
});
