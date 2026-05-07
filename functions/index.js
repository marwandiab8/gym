const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { buildExerciseSummaries } = require("./lib/setScoring");
const {
  normalizePrompt,
  isStructuredObject,
  extractJsonCandidate,
  normalizeAiExercises,
} = require("./lib/aiRoutine");

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

function collectExerciseIds(workout) {
  return [...new Set((workout?.exercises || [])
    .map((exercise) => exercise?.exerciseId)
    .filter((exerciseId) => typeof exerciseId === "string" && exerciseId.trim() !== ""))];
}

function isFinalWorkout(workout) {
  return workout?.status === "final";
}

async function syncWorkoutSummary(uid, workoutId, workout) {
  const summaryRef = admin.firestore().doc(`users/${uid}/workout_summaries/${workoutId}`);
  if (!workout || workout.status !== "final") {
    await summaryRef.delete().catch(() => null);
    return;
  }

  await summaryRef.set({
    workoutId,
    routineName: String(workout.routineName || "Custom Workout"),
    date: typeof workout.date === "string" ? workout.date : null,
    unit: typeof workout.unit === "string" ? workout.unit : "lb",
    focus: Array.isArray(workout.focus) ? workout.focus.filter((item) => typeof item === "string").slice(0, 8) : [],
    notes: typeof workout.notes === "string" ? workout.notes : "",
    updatedAtMs: Number(workout.updatedAtMs) || Date.now(),
    exerciseCount: Array.isArray(workout.exercises) ? workout.exercises.length : 0,
    exerciseSummaries: buildExerciseSummaries(workout),
  }, { merge: true });
}

async function syncLastSetsForExercises(uid, exerciseIds) {
  if (!exerciseIds.length) return;

  const workoutsSnap = await admin.firestore()
    .collection(`users/${uid}/workouts`)
    .where("status", "==", "final")
    .orderBy("updatedAtMs", "desc")
    .limit(EXERCISE_LAST_SETS_LIMIT)
    .get();

  const latestByExerciseId = new Map();
  for (const workoutDoc of workoutsSnap.docs) {
    const workout = workoutDoc.data();
    for (const exercise of workout.exercises || []) {
      const exerciseId = exercise?.exerciseId;
      if (!exerciseIds.includes(exerciseId) || latestByExerciseId.has(exerciseId)) continue;
      if (Array.isArray(exercise.sets) && exercise.sets.length) {
        latestByExerciseId.set(exerciseId, {
          sets: exercise.sets,
          sourceWorkoutId: workoutDoc.id,
          updatedAtMs: Number(workout.updatedAtMs) || Date.now(),
          exerciseName: String(exercise.name || "Exercise"),
        });
      }
    }
    if (latestByExerciseId.size === exerciseIds.length) break;
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
      return { ok: false, exercises: [], error: "Describe the workout you want in a bit more detail." };
    }
    if (prompt.length > AI_PROMPT_MAX_LENGTH) {
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
      });
      return {
        ok: false,
        exercises: [],
        error: "Could not generate a routine right now. Please try again in a moment.",
      };
    }
  });
