const functions = require("firebase-functions");
const admin = require("firebase-admin");
const {
  buildExerciseSummaries,
  completedExerciseSetRows,
  filterScorableSets,
  pickBestSetForPR,
  isNewPRBeatsCurrent,
} = require("./lib/setScoring");
const {
  normalizePrompt,
  isStructuredObject,
  extractJsonCandidate,
  normalizeAiExercises,
} = require("./lib/aiRoutine");
const {
  buildDateRepairPlan,
  normalizeDateKey,
  prDateRepairPatch,
  resolveWorkoutDateFields,
  selectDateRepairCandidates,
  timestampToMs,
} = require("./lib/workoutDateRepair");

admin.initializeApp();

// Gen1 callable + Secret Manager (same name as before). Do not use v2 onCall here:
// Firebase cannot upgrade an existing Gen1 function to Gen2 in place.
// Secret: ./scripts/set-openai-secret.sh → OPENAI_API_KEY, read as process.env.OPENAI_API_KEY.

const AI_MODEL = "gpt-4.1-mini";
const AI_REGION = "us-central1";
const AI_PROMPT_MIN_LENGTH = 8;
const AI_PROMPT_MAX_LENGTH = 600;
const AI_RATE_WINDOW_MS = 60 * 60 * 1000;
const AI_MAX_REQUESTS_PER_WINDOW = 12;
const AI_COOLDOWN_MS = 30 * 1000;
const EXERCISE_LAST_SETS_LIMIT = 60;
const WORKOUT_STATUSES = {
  DRAFT: "draft",
  FINAL: "final",
  ARCHIVED: "archived",
};
const MAX_WORKOUT_EXERCISES = 50;
const MAX_EXERCISE_SETS = 25;
const INTEGRITY_SCAN_LIMIT = 80;

async function enforceAiRateLimit(uid) {
  const now = Date.now();
  const rateRef = admin.firestore().collection("_ai_rate_limits").doc(uid);

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const state = snap.exists
      ? snap.data()
      : { windowStartedAtMs: now, requestCount: 0, lastRequestAtMs: 0 };

    if ((Number(state.lastRequestAtMs) || 0) + AI_COOLDOWN_MS > now) {
      const retryAfterSec = Math.ceil((((Number(state.lastRequestAtMs) || 0) + AI_COOLDOWN_MS) - now) / 1000);
      throw new functions.https.HttpsError("resource-exhausted", `Please wait ${retryAfterSec}s before generating another routine.`);
    }

    const withinWindow = (Number(state.windowStartedAtMs) || 0) + AI_RATE_WINDOW_MS > now;
    const requestCount = withinWindow ? Number(state.requestCount || 0) : 0;
    if (requestCount >= AI_MAX_REQUESTS_PER_WINDOW) {
      throw new functions.https.HttpsError("resource-exhausted", "Hourly AI generation limit reached. Please try again later.");
    }

    tx.set(rateRef, {
      windowStartedAtMs: withinWindow ? Number(state.windowStartedAtMs || now) : now,
      requestCount: requestCount + 1,
      lastRequestAtMs: now,
    }, { merge: true });
  });
}

function normalizeUnit(value) {
  return value === "kg" ? "kg" : "lb";
}

function clampString(value, maxLen, fallback = "") {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, maxLen) : fallback;
}

function normalizeStringList(value, maxItems, maxLen = 40) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => clampString(item, maxLen))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function sanitizeSet(raw) {
  return {
    weight: raw?.weight == null ? "" : String(raw.weight).slice(0, 24),
    reps: raw?.reps == null ? "" : String(raw.reps).slice(0, 24),
    rpe: raw?.rpe == null ? "" : String(raw.rpe).slice(0, 24),
  };
}

function sanitizeExercise(raw, fallbackAddedAt) {
  return {
    exerciseId: clampString(raw?.exerciseId, 120),
    name: clampString(raw?.name, 120, "Exercise"),
    exerciseNote: clampString(raw?.exerciseNote, 500),
    sets: (Array.isArray(raw?.sets) ? raw.sets : []).slice(0, MAX_EXERCISE_SETS).map(sanitizeSet),
    addedAt: Number(raw?.addedAt) || fallbackAddedAt,
    firstEditTime: Number(raw?.firstEditTime) || null,
    lastEditTime: Number(raw?.lastEditTime) || null,
  };
}

function buildFinalExercisesForStorage(rawExercises, fallbackAddedAt) {
  const sanitized = (Array.isArray(rawExercises) ? rawExercises : [])
    .slice(0, MAX_WORKOUT_EXERCISES)
    .map((exercise) => sanitizeExercise(exercise, fallbackAddedAt))
    .filter((exercise) => exercise.exerciseId);

  const finalized = [];
  sanitized.forEach((exercise) => {
    const validSets = exercise.sets.filter((set) => {
      const reps = parseInt(String(set.reps ?? ""), 10) || 0;
      const weight = String(set.weight ?? "").trim();
      return reps > 0 || weight !== "";
    });
    if (validSets.length) finalized.push({ ...exercise, sets: validSets });
  });

  finalized.sort((a, b) => {
    const timeA = a.firstEditTime || a.addedAt || 0;
    const timeB = b.firstEditTime || b.addedAt || 0;
    return timeA - timeB;
  });
  return finalized;
}

function buildWorkoutSummaryRecord(workoutId, workout) {
  const workoutDate = normalizeDateKey(workout.date);
  const workoutDateKey = normalizeDateKey(workout.dateKey || workout.date);
  return {
    workoutId,
    routineName: String(workout.routineName || "Custom Workout"),
    date: workoutDate || null,
    dateKey: workoutDateKey || workoutDate || null,
    unit: typeof workout.unit === "string" ? workout.unit : "lb",
    focus: Array.isArray(workout.focus) ? workout.focus.filter((item) => typeof item === "string").slice(0, 8) : [],
    notes: typeof workout.notes === "string" ? workout.notes : "",
    updatedAtMs: Number(workout.updatedAtMs) || Date.now(),
    exerciseCount: Array.isArray(workout.exercises) ? workout.exercises.length : 0,
    exerciseSummaries: buildExerciseSummaries(workout),
    archivedAtMs: Number(workout.archivedAtMs) || null,
    finalizationId: typeof workout.finalizationId === "string" ? workout.finalizationId : null,
  };
}

function sanitizeFinalizeRequest(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid finalize payload.");
  }
  const workoutId = clampString(data.workoutId, 120);
  let dateFields;
  try {
    dateFields = resolveWorkoutDateFields(data.date, data.dateKey || data.date);
  } catch (_) {
    dateFields = null;
  }
  if (!workoutId || !dateFields) {
    throw new functions.https.HttpsError("invalid-argument", "Workout id and date are required.");
  }
  const finalizationId = clampString(data.finalizationId, 120) || `finalize_${workoutId}`;
  const sanitized = {
    workoutId,
    finalizationId,
    ...dateFields,
    unit: normalizeUnit(data.unit),
    routineName: clampString(data.routineName, 80, "Custom Workout"),
    focus: normalizeStringList(data.focus, 8, 40),
    templateId: clampString(data.templateId, 120) || null,
    notes: clampString(data.notes, 2000),
  };
  sanitized.exercises = buildFinalExercisesForStorage(data.exercises, Date.now());
  if (!sanitized.exercises.length) {
    throw new functions.https.HttpsError("invalid-argument", "Add reps or weight to at least one set before finishing.");
  }
  return sanitized;
}

function sanitizeDraftRequest(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid draft payload.");
  }
  let dateFields;
  try {
    dateFields = resolveWorkoutDateFields(data.date, data.dateKey || data.date);
  } catch (_) {
    dateFields = null;
  }
  if (!dateFields) {
    throw new functions.https.HttpsError("invalid-argument", "Draft date is required.");
  }
  return {
    ...dateFields,
    unit: normalizeUnit(data.unit),
    exercises: Array.isArray(data.exercises) ? data.exercises.slice(0, MAX_WORKOUT_EXERCISES) : [],
    routineName: clampString(data.routineName, 80, "Custom Workout"),
    focus: normalizeStringList(data.focus, 8, 40),
    templateId: clampString(data.templateId, 120) || null,
    notes: clampString(data.notes, 2000),
  };
}

function sanitizeDateRepairPreviewRequest(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid date-repair preview payload.");
  }
  const originalDate = normalizeDateKey(data.originalDate);
  const newDate = normalizeDateKey(data.newDate);
  if (!originalDate || !newDate || originalDate === newDate) {
    throw new functions.https.HttpsError("invalid-argument", "Distinct original and corrected dates are required.");
  }
  const finalizedAfterMs = Math.max(0, Number(data.finalizedAfterMs) || 0);
  const finalizedBeforeMs = Math.max(finalizedAfterMs, Number(data.finalizedBeforeMs) || Number.MAX_SAFE_INTEGER);
  return {
    originalDate,
    newDate,
    finalizedAfterMs,
    finalizedBeforeMs,
    exerciseIds: [...new Set((Array.isArray(data.exerciseIds) ? data.exerciseIds : [])
      .map((exerciseId) => clampString(exerciseId, 120))
      .filter(Boolean))].slice(0, MAX_WORKOUT_EXERCISES),
  };
}

function sanitizeDateRepairRequest(data) {
  const preview = sanitizeDateRepairPreviewRequest(data);
  const workoutId = clampString(data.workoutId, 120);
  const expectedFinalizationId = clampString(data.expectedFinalizationId, 120);
  const expectedFinalizedAtMs = Number(data.expectedFinalizedAtMs);
  if (!workoutId || !expectedFinalizationId || !Number.isFinite(expectedFinalizedAtMs) || expectedFinalizedAtMs <= 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Workout id, finalization id, and finalization timestamp are required."
    );
  }
  return { ...preview, workoutId, expectedFinalizationId, expectedFinalizedAtMs };
}

function collectExerciseIds(workout) {
  return [...new Set((workout?.exercises || [])
    .map((exercise) => exercise?.exerciseId)
    .filter((exerciseId) => typeof exerciseId === "string" && exerciseId.trim() !== ""))];
}

function isArchivedWorkout(workout) {
  return workout?.status === WORKOUT_STATUSES.ARCHIVED;
}

function isFinalWorkout(workout) {
  return workout?.status === WORKOUT_STATUSES.FINAL && !isArchivedWorkout(workout);
}

async function syncWorkoutSummary(uid, workoutId, workout) {
  const summaryRef = admin.firestore().doc(`users/${uid}/workout_summaries/${workoutId}`);
  if (!workout || !isFinalWorkout(workout)) {
    await summaryRef.delete().catch(() => null);
    return;
  }

  await summaryRef.set(buildWorkoutSummaryRecord(workoutId, workout), { merge: true });
}

async function syncLastSetsForExercises(uid, exerciseIds) {
  if (!exerciseIds.length) return;
  const latestByExerciseId = new Map();
  let cursor = null;
  while (latestByExerciseId.size < exerciseIds.length) {
    let workoutsQuery = admin.firestore()
      .collection(`users/${uid}/workouts`)
      .where("status", "==", WORKOUT_STATUSES.FINAL)
      .orderBy("updatedAtMs", "desc")
      .limit(EXERCISE_LAST_SETS_LIMIT);
    if (cursor) workoutsQuery = workoutsQuery.startAfter(cursor);
    const workoutsSnap = await workoutsQuery.get();
    if (workoutsSnap.empty) break;

    for (const workoutDoc of workoutsSnap.docs) {
      const workout = workoutDoc.data();
      for (const exercise of workout.exercises || []) {
        const exerciseId = exercise?.exerciseId;
        if (!exerciseIds.includes(exerciseId) || latestByExerciseId.has(exerciseId)) continue;
        const completedSets = completedExerciseSetRows(exercise);
        if (completedSets.length) {
          latestByExerciseId.set(exerciseId, {
            sets: completedSets,
            exerciseNote: clampString(exercise.exerciseNote, 500),
            sourceWorkoutId: workoutDoc.id,
            sourceWorkoutDate: typeof workout.date === "string" ? workout.date : null,
            sourceExerciseCompleted: true,
            unit: normalizeUnit(workout.unit),
            updatedAtMs: Number(workout.updatedAtMs) || Date.now(),
            exerciseName: String(exercise.name || "Exercise"),
          });
        }
      }
      if (latestByExerciseId.size === exerciseIds.length) break;
    }
    if (workoutsSnap.size < EXERCISE_LAST_SETS_LIMIT) break;
    cursor = workoutsSnap.docs[workoutsSnap.docs.length - 1];
  }

  const batch = admin.firestore().batch();
  exerciseIds.forEach((exerciseId) => {
    const ref = admin.firestore().doc(`users/${uid}/exercise_last_sets/${exerciseId}`);
    if (latestByExerciseId.has(exerciseId)) {
      batch.set(ref, latestByExerciseId.get(exerciseId), { merge: true });
    } else {
      batch.delete(ref);
    }
  });
  await batch.commit();
}

async function syncPrsForWorkoutInTransaction(tx, uid, workoutId, workout, finalizationId, nowMs) {
  const candidates = [];
  for (const exercise of workout.exercises || []) {
    const validSets = filterScorableSets(exercise.sets);
    if (!validSets.length) continue;
    const best = pickBestSetForPR(validSets);
    if (!best) continue;

    const prRef = admin.firestore().doc(`users/${uid}/prs/${exercise.exerciseId}`);
    candidates.push({ exercise, best, prRef });
  }

  // Firestore transactions require all reads before all writes. Read every PR
  // candidate first, then queue the winning PR updates.
  const currentPrs = [];
  for (const candidate of candidates) {
    currentPrs.push(await tx.get(candidate.prRef));
  }

  const prUpdates = [];
  candidates.forEach((candidate, index) => {
    const { exercise, best, prRef } = candidate;
    const prSnap = currentPrs[index];
    const current = prSnap.exists ? prSnap.data() : { weight: 0, reps: 0 };
    if (!isNewPRBeatsCurrent(best, current)) return;

    const prPayload = {
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.name,
      weight: best.weight,
      reps: best.reps,
      unit: workout.unit,
      date: workout.date,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      sourceWorkoutId: workoutId,
      sourceWorkoutDate: workout.date,
      sourceWorkoutUpdatedAtMs: nowMs,
      finalizationId,
    };
    tx.set(prRef, prPayload, { merge: true });
    prUpdates.push({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.name,
      weight: best.weight,
      reps: best.reps,
      date: workout.date,
    });
  });
  return prUpdates;
}

async function verifyFinalizedWorkout(uid, workoutId, finalizationId) {
  const workoutRef = admin.firestore().doc(`users/${uid}/workouts/${workoutId}`);
  const receiptRef = admin.firestore().doc(`users/${uid}/workout_receipts/${workoutId}`);
  const [workoutSnap, receiptSnap] = await Promise.all([workoutRef.get(), receiptRef.get()]);
  if (!workoutSnap.exists) {
    throw new functions.https.HttpsError("internal", "Workout verification failed: workout missing after finalize.");
  }
  const workout = workoutSnap.data();
  if (!isFinalWorkout(workout) || String(workout.finalizationId || "") !== String(finalizationId || "")) {
    throw new functions.https.HttpsError("internal", "Workout verification failed after finalize.");
  }
  if (!receiptSnap.exists) {
    throw new functions.https.HttpsError("internal", "Workout verification failed: receipt missing after finalize.");
  }
  return { workoutSnap, receiptSnap };
}

async function runIntegrityCheckAndRepair(uid) {
  const workoutsRef = admin.firestore().collection(`users/${uid}/workouts`);
  const summariesRef = admin.firestore().collection(`users/${uid}/workout_summaries`);
  const prsRef = admin.firestore().collection(`users/${uid}/prs`);
  const reportRef = admin.firestore().doc(`users/${uid}/integrity_reports/latest`);

  const [workoutsSnap, summariesSnap, prsSnap] = await Promise.all([
    workoutsRef.where("status", "==", WORKOUT_STATUSES.FINAL).orderBy("updatedAtMs", "desc").limit(INTEGRITY_SCAN_LIMIT).get(),
    summariesRef.orderBy("updatedAtMs", "desc").limit(INTEGRITY_SCAN_LIMIT).get(),
    prsRef.limit(400).get(),
  ]);

  const finalWorkouts = new Map();
  workoutsSnap.docs.forEach((docSnap) => {
    finalWorkouts.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });
  const summaries = new Map();
  summariesSnap.docs.forEach((docSnap) => {
    summaries.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });

  const issues = [];
  let repairsApplied = 0;

  for (const [workoutId, workout] of finalWorkouts.entries()) {
    const summary = summaries.get(workoutId);
    if (!summary) {
      issues.push({ type: "missing_summary", workoutId, date: workout.date || null });
      await syncWorkoutSummary(uid, workoutId, workout);
      repairsApplied += 1;
      continue;
    }
    if (summary.date !== workout.date || Number(summary.updatedAtMs || 0) !== Number(workout.updatedAtMs || 0)) {
      issues.push({ type: "stale_summary", workoutId, date: workout.date || null });
      await syncWorkoutSummary(uid, workoutId, workout);
      repairsApplied += 1;
    }
  }

  for (const [summaryId] of summaries.entries()) {
    if (!finalWorkouts.has(summaryId)) {
      issues.push({ type: "orphan_summary", workoutId: summaryId });
      await summariesRef.doc(summaryId).delete().catch(() => null);
      repairsApplied += 1;
    }
  }

  for (const prDoc of prsSnap.docs) {
    const pr = prDoc.data();
    const sourceWorkoutId = typeof pr.sourceWorkoutId === "string" ? pr.sourceWorkoutId : "";
    if (!sourceWorkoutId) {
      issues.push({ type: "pr_missing_source", prId: prDoc.id, exerciseName: pr.exerciseName || prDoc.id });
      continue;
    }
    const workout = finalWorkouts.get(sourceWorkoutId) || null;
    if (!workout) {
      issues.push({ type: "orphan_pr", prId: prDoc.id, sourceWorkoutId, exerciseName: pr.exerciseName || prDoc.id });
      continue;
    }
    const expectedDate = workout.date || null;
    if (pr.date !== expectedDate || pr.sourceWorkoutDate !== expectedDate) {
      issues.push({ type: "stale_pr_metadata", prId: prDoc.id, sourceWorkoutId, expectedDate });
      await prsRef.doc(prDoc.id).set({
        date: expectedDate,
        sourceWorkoutDate: expectedDate,
        sourceWorkoutUpdatedAtMs: Number(workout.updatedAtMs) || Date.now(),
      }, { merge: true });
      repairsApplied += 1;
    }
  }

  const report = {
    checkedAtMs: Date.now(),
    issueCount: issues.length,
    repairsApplied,
    issues: issues.slice(0, 50),
  };
  await reportRef.set(report, { merge: true });
  return report;
}

exports.onWorkoutFinalize = functions.firestore
  .document("users/{uid}/workouts/{workoutId}")
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    const { uid, workoutId } = context.params;
    const beforeWasFinal = isFinalWorkout(before);
    const afterIsFinal = isFinalWorkout(after);

    if (!beforeWasFinal && !afterIsFinal) {
      return null;
    }

    if (afterIsFinal || beforeWasFinal) {
      await syncWorkoutSummary(uid, workoutId, after);
    }

    const affectedExerciseIds = [...new Set([
      ...collectExerciseIds(before),
      ...collectExerciseIds(after),
    ])];

    try {
      await syncLastSetsForExercises(uid, affectedExerciseIds);
    } catch (error) {
      console.error("Last-sets sync failed", { uid, workoutId, message: error?.message || String(error) });
    }

    if (afterIsFinal) {
      console.log("Workout finalized for user:", uid);
    }
    return null;
  });

exports.finalizeWorkout = functions
  .runWith({
    timeoutSeconds: 60,
    memory: "256MB",
  })
  .region(AI_REGION)
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError("unauthenticated", "You must be signed in.");
    }

    const payload = sanitizeFinalizeRequest(data);
    const nowMs = Date.now();
    const workoutRef = admin.firestore().doc(`users/${uid}/workouts/${payload.workoutId}`);
    const summaryRef = admin.firestore().doc(`users/${uid}/workout_summaries/${payload.workoutId}`);
    const receiptRef = admin.firestore().doc(`users/${uid}/workout_receipts/${payload.workoutId}`);

    const txResult = await admin.firestore().runTransaction(async (tx) => {
      const workoutSnap = await tx.get(workoutRef);
      if (!workoutSnap.exists) {
        throw new functions.https.HttpsError("failed-precondition", "Draft workout is missing.");
      }
      const existing = workoutSnap.data() || {};
      if (existing.status === WORKOUT_STATUSES.ARCHIVED) {
        throw new functions.https.HttpsError("failed-precondition", "Archived workouts cannot be finalized.");
      }

      if (existing.status === WORKOUT_STATUSES.FINAL && String(existing.finalizationId || "") === payload.finalizationId) {
        const receiptSnap = await tx.get(receiptRef);
        return {
          workout: existing,
          prUpdates: Array.isArray(receiptSnap.data()?.prUpdates) ? receiptSnap.data().prUpdates : [],
          alreadyFinalized: true,
        };
      }
      if (existing.status === WORKOUT_STATUSES.FINAL) {
        throw new functions.https.HttpsError("failed-precondition", "Workout is already finalized.");
      }

      const finalizedWorkout = {
        status: WORKOUT_STATUSES.FINAL,
        date: payload.date,
        dateKey: payload.dateKey,
        unit: payload.unit,
        exercises: payload.exercises,
        updatedAtMs: nowMs,
        routineName: payload.routineName,
        focus: payload.focus,
        templateId: payload.templateId,
        notes: payload.notes,
        finalizationId: payload.finalizationId,
        finalizedAtMs: nowMs,
        finalizedByUid: uid,
        archivedAtMs: null,
        archivedByUid: null,
        startedAt: existing.startedAt || admin.firestore.FieldValue.serverTimestamp(),
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      let prUpdates = [];
      let prSyncError = null;
      try {
        prUpdates = await syncPrsForWorkoutInTransaction(
          tx,
          uid,
          payload.workoutId,
          finalizedWorkout,
          payload.finalizationId,
          nowMs
        );
      } catch (error) {
        prSyncError = String(error?.message || error);
        console.error("PR sync failed during finalize transaction", {
          uid,
          workoutId: payload.workoutId,
          message: prSyncError,
        });
      }
      tx.set(workoutRef, finalizedWorkout, { merge: true });
      tx.set(summaryRef, buildWorkoutSummaryRecord(payload.workoutId, finalizedWorkout), { merge: true });
      tx.set(receiptRef, {
        workoutId: payload.workoutId,
        workoutDate: payload.date,
        workoutDateKey: payload.dateKey,
        routineName: payload.routineName,
        status: WORKOUT_STATUSES.FINAL,
        finalizationId: payload.finalizationId,
        finalizedAtMs: nowMs,
        verified: false,
        prUpdates,
        prSyncError,
      }, { merge: true });

      return { workout: finalizedWorkout, prUpdates, alreadyFinalized: false, prSyncError };
    });

    let verificationWarning = txResult.prSyncError || "";
    try {
      await verifyFinalizedWorkout(uid, payload.workoutId, payload.finalizationId);
    } catch (error) {
      verificationWarning = verificationWarning || String(error?.message || error);
    }
    await receiptRef.set({
      verified: !verificationWarning,
      verifiedAtMs: Date.now(),
      verificationError: verificationWarning || null,
      verificationFailedAtMs: verificationWarning ? Date.now() : null,
    }, { merge: true }).catch(() => null);

    return {
      ok: true,
      workoutId: payload.workoutId,
      workoutDate: txResult.workout.date,
      finalizationId: payload.finalizationId,
      prUpdates: txResult.prUpdates,
      alreadyFinalized: txResult.alreadyFinalized,
      verificationWarning: verificationWarning || null,
    };
  });

exports.archiveWorkout = functions
  .runWith({
    timeoutSeconds: 60,
    memory: "256MB",
  })
  .region(AI_REGION)
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError("unauthenticated", "You must be signed in.");
    }
    const workoutId = clampString(data?.workoutId, 120);
    if (!workoutId) {
      throw new functions.https.HttpsError("invalid-argument", "Workout id is required.");
    }

    const nowMs = Date.now();
    const workoutRef = admin.firestore().doc(`users/${uid}/workouts/${workoutId}`);
    const summaryRef = admin.firestore().doc(`users/${uid}/workout_summaries/${workoutId}`);
    const receiptRef = admin.firestore().doc(`users/${uid}/workout_receipts/${workoutId}`);

    const archivedWorkout = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(workoutRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", "Workout not found.");
      }
      const workout = snap.data() || {};
      if (workout.status === WORKOUT_STATUSES.ARCHIVED) {
        return workout;
      }
      if (workout.status !== WORKOUT_STATUSES.FINAL) {
        throw new functions.https.HttpsError("failed-precondition", "Only finalized workouts can be archived.");
      }

      const next = {
        status: WORKOUT_STATUSES.ARCHIVED,
        archivedAtMs: nowMs,
        archivedByUid: uid,
        updatedAtMs: nowMs,
      };
      tx.set(workoutRef, next, { merge: true });
      tx.delete(summaryRef);
      tx.set(receiptRef, {
        archivedAtMs: nowMs,
        status: WORKOUT_STATUSES.ARCHIVED,
      }, { merge: true });
      return { ...workout, ...next };
    });

    await syncLastSetsForExercises(uid, collectExerciseIds(archivedWorkout)).catch((error) => {
      console.error("Archiving workout last-set sync failed", {
        uid,
        workoutId,
        message: error?.message || String(error),
      });
    });
    const report = await runIntegrityCheckAndRepair(uid).catch(() => ({ issueCount: 0, repairsApplied: 0 }));
    return {
      ok: true,
      workoutId,
      archivedAtMs: nowMs,
      integrityIssueCount: Number(report.issueCount) || 0,
    };
  });

exports.runWorkoutIntegrityCheck = functions
  .runWith({
    timeoutSeconds: 60,
    memory: "256MB",
  })
  .region(AI_REGION)
  .https.onCall(async (_data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError("unauthenticated", "You must be signed in.");
    }
    const report = await runIntegrityCheckAndRepair(uid);
    return { ok: true, report };
  });

exports.previewWorkoutDateCorrection = functions
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .region(AI_REGION)
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError("unauthenticated", "You must be signed in.");
    }
    const criteria = sanitizeDateRepairPreviewRequest(data);
    const snap = await admin.firestore()
      .collection(`users/${uid}/workouts`)
      .where("status", "==", WORKOUT_STATUSES.FINAL)
      .where("date", "==", criteria.originalDate)
      .limit(30)
      .get();
    const records = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    const candidates = selectDateRepairCandidates(records, criteria).map((workout) => ({
      workoutId: workout.id,
      date: workout.date,
      dateKey: workout.dateKey || workout.date,
      routineName: clampString(workout.routineName, 80, "Custom Workout"),
      startedAtMs: timestampToMs(workout.startedAt),
      finishedAtMs: timestampToMs(workout.finishedAt),
      finalizedAtMs: Number(workout.finalizedAtMs) || 0,
      updatedAtMs: Number(workout.updatedAtMs) || 0,
      finalizationId: clampString(workout.finalizationId, 120),
      exercises: (Array.isArray(workout.exercises) ? workout.exercises : []).map((exercise) => ({
        exerciseId: clampString(exercise?.exerciseId, 120),
        name: clampString(exercise?.name, 120, "Exercise"),
        sets: (Array.isArray(exercise?.sets) ? exercise.sets : []).map(sanitizeSet),
      })),
    }));
    return {
      ok: true,
      originalDate: criteria.originalDate,
      newDate: criteria.newDate,
      candidateCount: candidates.length,
      candidates,
    };
  });

exports.correctFinalizedWorkoutDate = functions
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .region(AI_REGION)
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError("unauthenticated", "You must be signed in.");
    }
    const payload = sanitizeDateRepairRequest(data);
    const repairDocumentId = `date_${payload.workoutId}_${payload.originalDate}_${payload.newDate}`
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 300);
    const workoutRef = admin.firestore().doc(`users/${uid}/workouts/${payload.workoutId}`);
    const summaryRef = admin.firestore().doc(`users/${uid}/workout_summaries/${payload.workoutId}`);
    const receiptRef = admin.firestore().doc(`users/${uid}/workout_receipts/${payload.workoutId}`);
    const repairRef = admin.firestore().doc(`users/${uid}/workout_date_repairs/${repairDocumentId}`);

    const existingRepair = await repairRef.get();
    if (!existingRepair.exists || existingRepair.data()?.status !== "applied") {
      const candidateSnap = await admin.firestore()
        .collection(`users/${uid}/workouts`)
        .where("status", "==", WORKOUT_STATUSES.FINAL)
        .where("date", "==", payload.originalDate)
        .limit(30)
        .get();
      const candidates = selectDateRepairCandidates(
        candidateSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
        payload
      );
      if (candidates.length !== 1 || candidates[0].id !== payload.workoutId) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Date correction requires exactly one matching workout; found ${candidates.length}. Run the preview again.`
        );
      }
    }

    const result = await admin.firestore().runTransaction(async (tx) => {
      const repairSnap = await tx.get(repairRef);
      if (repairSnap.exists && repairSnap.data()?.status === "applied") {
        return {
          alreadyApplied: true,
          exerciseIds: Array.isArray(repairSnap.data()?.exerciseIds) ? repairSnap.data().exerciseIds : [],
        };
      }

      const workoutSnap = await tx.get(workoutRef);
      if (!workoutSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Workout not found.");
      }
      const workout = workoutSnap.data() || {};
      let plan;
      try {
        plan = buildDateRepairPlan({
          workoutId: payload.workoutId,
          workout,
          expectedOriginalDate: payload.originalDate,
          newDate: payload.newDate,
          expectedFinalizationId: payload.expectedFinalizationId,
          expectedFinalizedAtMs: payload.expectedFinalizedAtMs,
        });
      } catch (error) {
        throw new functions.https.HttpsError("failed-precondition", error.message);
      }

      const exerciseIds = collectExerciseIds(workout);
      const summarySnap = await tx.get(summaryRef);
      const receiptSnap = await tx.get(receiptRef);
      const prRows = [];
      for (const exerciseId of exerciseIds) {
        const ref = admin.firestore().doc(`users/${uid}/prs/${exerciseId}`);
        prRows.push({ exerciseId, ref, snap: await tx.get(ref) });
      }

      const correctedWorkout = { ...workout, ...plan.workoutPatch };
      const originalPrs = [];
      const updatedPrIds = [];
      for (const row of prRows) {
        const currentPr = row.snap.exists ? row.snap.data() || {} : null;
        const patch = prDateRepairPatch(currentPr, payload.workoutId, payload.newDate);
        originalPrs.push({
          exerciseId: row.exerciseId,
          existed: row.snap.exists,
          date: currentPr?.date || null,
          sourceWorkoutDate: currentPr?.sourceWorkoutDate || null,
          sourceWorkoutId: currentPr?.sourceWorkoutId || null,
        });
        if (patch) {
          tx.set(row.ref, patch, { merge: true });
          updatedPrIds.push(row.exerciseId);
        }
      }

      tx.set(workoutRef, plan.workoutPatch, { merge: true });
      tx.set(summaryRef, buildWorkoutSummaryRecord(payload.workoutId, correctedWorkout), { merge: true });
      if (receiptSnap.exists) tx.set(receiptRef, plan.receiptPatch, { merge: true });
      tx.set(repairRef, {
        status: "applied",
        workoutId: payload.workoutId,
        ownerUid: uid,
        originalDate: payload.originalDate,
        newDate: payload.newDate,
        finalizationId: payload.expectedFinalizationId,
        finalizedAtMs: payload.expectedFinalizedAtMs,
        exerciseIds,
        updatedPrIds,
        originalValues: {
          workout: { date: workout.date || null, dateKey: workout.dateKey || null },
          summary: {
            existed: summarySnap.exists,
            date: summarySnap.data()?.date || null,
            dateKey: summarySnap.data()?.dateKey || null,
          },
          receipt: {
            existed: receiptSnap.exists,
            workoutDate: receiptSnap.data()?.workoutDate || null,
            workoutDateKey: receiptSnap.data()?.workoutDateKey || null,
          },
          prs: originalPrs,
        },
        appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { alreadyApplied: false, exerciseIds, updatedPrIds };
    });

    let derivedDataWarning = null;
    try {
      // Also run on an idempotent retry so a prior post-transaction sync failure
      // can heal without rewriting the finalized workout again.
      await syncLastSetsForExercises(uid, result.exerciseIds);
    } catch (error) {
      derivedDataWarning = String(error?.message || error);
      console.error("Date-correction last-set sync failed", {
        uid,
        workoutId: payload.workoutId,
        message: derivedDataWarning,
      });
    }
    return {
      ok: true,
      alreadyApplied: result.alreadyApplied,
      workoutId: payload.workoutId,
      originalDate: payload.originalDate,
      newDate: payload.newDate,
      updatedPrIds: result.updatedPrIds || [],
      derivedDataWarning,
    };
  });

exports.createWorkoutDraft = functions
  .runWith({
    timeoutSeconds: 60,
    memory: "256MB",
  })
  .region(AI_REGION)
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError("unauthenticated", "You must be signed in.");
    }
    const payload = sanitizeDraftRequest(data);
    const nowMs = Date.now();
    const workoutRef = admin.firestore().collection(`users/${uid}/workouts`).doc();
    await workoutRef.set({
      status: WORKOUT_STATUSES.DRAFT,
      date: payload.date,
      dateKey: payload.dateKey,
      unit: payload.unit,
      exercises: payload.exercises,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      routineName: payload.routineName,
      focus: payload.focus,
      templateId: payload.templateId,
      notes: payload.notes,
      finalizationId: null,
      finalizedAtMs: null,
      finalizedByUid: null,
      archivedAtMs: null,
      archivedByUid: null,
    }, { merge: true });
    return {
      ok: true,
      workoutId: workoutRef.id,
      updatedAtMs: nowMs,
    };
  });

exports.generateAiRoutine = functions
  .runWith({
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 60,
    memory: "256MB",
  })
  .region(AI_REGION)
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError("unauthenticated", "You must be signed in.");
    }

    if (!isStructuredObject(data) || !Object.keys(data).every((key) => key === "prompt")) {
      console.warn("AI request rejected: invalid shape", { uid });
      return { ok: false, exercises: [], error: "Invalid request payload." };
    }

    const prompt = normalizePrompt(data.prompt);
    if (prompt.length < AI_PROMPT_MIN_LENGTH) {
      console.warn("AI request rejected: prompt too short", { uid, promptLength: prompt.length });
      return { ok: false, exercises: [], error: "Describe the workout you want in a bit more detail." };
    }
    if (prompt.length > AI_PROMPT_MAX_LENGTH) {
      console.warn("AI request rejected: prompt too long", { uid, promptLength: prompt.length });
      return { ok: false, exercises: [], error: `Prompt is too long. Keep it under ${AI_PROMPT_MAX_LENGTH} characters.` };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("AI request rejected: missing OPENAI_API_KEY secret", { uid });
      throw new functions.https.HttpsError("failed-precondition", "OPENAI_API_KEY secret is not configured.");
    }

    await enforceAiRateLimit(uid);

    console.log("AI routine generation requested", {
      uid,
      promptLength: prompt.length,
    });

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          temperature: 0.5,
          max_tokens: 700,
          messages: [
            {
              role: "system",
              content:
                "You are an elite strength and conditioning coach. " +
                "Return only valid JSON in the exact shape " +
                "{\"exercises\":[{\"name\":\"Barbell Back Squat\",\"sets\":4,\"reps\":\"5-8\"}]}. " +
                "Do not include markdown. Use 2-12 exercises, avoid duplicate movement patterns, " +
                "sequence compound lifts first, and use realistic rep ranges.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("OpenAI API failed", {
          uid,
          status: response.status,
          statusText: response.statusText,
          bodyPreview: errorBody.slice(0, 160),
        });
        return { ok: false, exercises: [], error: "AI generation failed upstream. Please try again." };
      }

      const apiData = await response.json();
      const rawContent = apiData?.choices?.[0]?.message?.content || "";
      const parsed = extractJsonCandidate(rawContent);
      const exercises = normalizeAiExercises(parsed);
      console.warn("AI routine generation succeeded", {
        svc: "generateAiRoutine",
        kind: "success",
        uid,
        count: exercises.length,
        promptLen: prompt.length,
      });

      return {
        ok: true,
        exercises,
        error: null,
        meta: {
          model: AI_MODEL,
          generatedAtMs: Date.now(),
        },
      };
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error("AI generation failed", {
        uid,
        message: error?.message || String(error),
        promptLength: prompt.length,
      });
      return {
        ok: false,
        exercises: [],
        error: "Could not generate a routine right now. Please try again in a moment.",
      };
    }
  });

Object.assign(exports, require("./timeLeftGym/triggers"));
