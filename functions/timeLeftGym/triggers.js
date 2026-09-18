const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { readConfig } = require("./config");
const { sendTimeLeftGymItem } = require("./ingestionClient");
const { mapWorkoutSummaryToTimeLeft } = require("./mappers");
const { allSetSummaries } = require("../lib/setScoring");

function normalizeId(value) {
  const trimmed = String(value || "").trim();
  return trimmed;
}

function summarizeSetsFromWorkout(workout = {}) {
  if (!Array.isArray(workout.exercises)) {
    return [];
  }
  return workout.exercises
    .filter((exercise) => typeof exercise?.exerciseId === "string" && exercise.exerciseId.trim() !== "")
    .map((exercise) => ({
      exerciseId: normalizeId(exercise.exerciseId),
      sets: allSetSummaries(exercise.sets),
    }))
    .filter((detail) => detail.sets.length > 0);
}

function snapshotData(snapshot) {
  return snapshot && snapshot.exists ? snapshot.data() || {} : null;
}

exports.syncGymWorkoutSummaryToTimeLeft = functions
  .runWith({
    timeoutSeconds: 60,
    memory: "256MB",
    secrets: ["TIME_LEFT_INGESTION_TOKEN"],
  })
  .firestore
  .document("users/{uid}/workout_summaries/{workoutId}")
  .onWrite(async (change, context) => {
    const { uid, workoutId } = context.params;
    const config = readConfig();
    if (!config.ownerUid || uid !== config.ownerUid) {
      console.log("Skipping GYM-K2 Time Left sync for non-configured user", { uid, workoutId });
      return null;
    }

    const before = snapshotData(change.before);
    const after = snapshotData(change.after);
    const source = after || before;
    if (!source) return null;
    const workoutSnap = await admin.firestore().doc(`users/${uid}/workouts/${workoutId}`).get();
    const workout = workoutSnap.exists ? workoutSnap.data() || {} : {};
    const exerciseSetDetails = summarizeSetsFromWorkout(workout);

    const item = mapWorkoutSummaryToTimeLeft(source, {
      sourceDocumentPath: `users/${uid}/workout_summaries/${workoutId}`,
      sourceFirebaseProjectId: config.sourceFirebaseProjectId,
      sourceProjectId: config.sourceProjectId,
      syncStatus: after ? "active" : "deletedFromSource",
      uid,
      workoutId,
      exerciseSetDetails,
    });

    const result = await sendTimeLeftGymItem(item);
    console.log("GYM-K2 Time Left sync attempted", {
      ok: !(result && result.ok === false),
      status: result && result.status ? result.status : null,
      dateId: item.dateId || null,
      sourceDocumentPath: item.sourceDocumentPath,
      sourceProjectId: item.sourceProjectId,
      workoutId,
    });
    return result;
  });

function assertBackfillAuth(req) {
  const header = String(req.get("authorization") || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1].trim() !== String(process.env.TIME_LEFT_INGESTION_TOKEN || "").trim()) {
    const error = new Error("Forbidden.");
    error.status = 403;
    throw error;
  }
}

exports.backfillGymWorkoutsToTimeLeft = functions
  .runWith({
    timeoutSeconds: 540,
    memory: "512MB",
    secrets: ["TIME_LEFT_INGESTION_TOKEN"],
  })
  .https.onRequest(async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).set("Allow", "POST").json({ ok: false, error: "Use POST." });
      return;
    }

    try {
      assertBackfillAuth(req);
      const config = readConfig();
      if (!config.ownerUid) {
        res.status(500).json({ ok: false, error: "GYM_TIME_LEFT_OWNER_UID is not configured." });
        return;
      }

      const limit = Math.max(1, Math.min(1000, Number(req.query.limit || req.body?.limit || 500) || 500));
      const snap = await admin.firestore()
        .collection(`users/${config.ownerUid}/workout_summaries`)
        .limit(limit)
        .get();

      const result = {
        ok: true,
        source: "workout_summaries",
        scanned: snap.size,
        sent: 0,
        failed: 0,
        failures: [],
      };

      for (const doc of snap.docs) {
        const workoutSnap = await admin.firestore().doc(`users/${config.ownerUid}/workouts/${doc.id}`).get();
        const workout = workoutSnap.exists ? workoutSnap.data() || {} : {};
        const exerciseSetDetails = summarizeSetsFromWorkout(workout);
        const item = mapWorkoutSummaryToTimeLeft(doc.data() || {}, {
          sourceDocumentPath: `users/${config.ownerUid}/workout_summaries/${doc.id}`,
          sourceFirebaseProjectId: config.sourceFirebaseProjectId,
          sourceProjectId: config.sourceProjectId,
          syncStatus: "active",
          uid: config.ownerUid,
          workoutId: doc.id,
          exerciseSetDetails,
        });
        const ingestResult = await sendTimeLeftGymItem(item);
        if (ingestResult && ingestResult.ok === false) {
          result.failed += 1;
          result.failures.push({
            workoutId: doc.id,
            dateId: item.dateId || null,
            status: ingestResult.status || null,
            error: String(ingestResult.error || "failed").slice(0, 200),
          });
        } else {
          result.sent += 1;
        }
      }

      res.json(result);
    } catch (error) {
      console.warn("GYM-K2 Time Left backfill failed", {
        status: error.status || null,
        message: String(error.message || error).slice(0, 300),
      });
      res.status(error.status || 500).json({ ok: false, error: error.message || "Backfill failed." });
    }
  });
