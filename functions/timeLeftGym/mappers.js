function compactObject(source) {
  return Object.fromEntries(Object.entries(source || {}).filter(([, value]) => value !== undefined));
}

function text(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validDateId(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function isoFromMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatExerciseSetRows(exercise, unit = "lb", fallbackExerciseId = "") {
  const exerciseName = text(exercise?.name || exercise?.exerciseName || fallbackExerciseId || "Exercise", 120);
  const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
  const lines = [`${exerciseName}`];
  if (!sets.length) {
    lines.push("  - no sets recorded");
    return lines;
  }
  for (const set of sets) {
    const weight = text(set?.weight, 40) || "0";
    const reps = text(set?.reps, 24) || "0";
    const rpe = text(set?.rpe, 16);
    const parts = [];
    if (weight) parts.push(`${weight} ${unit}`.trim());
    if (reps) parts.push(`${reps} reps`);
    if (rpe) parts.push(`RPE ${rpe}`);
    lines.push(`  - ${parts.length ? parts.join(" · ") : "set"}`);
  }
  return lines;
}

function buildFullDescription(summary, mappedExercises) {
  const routineName = text(summary.routineName || "Workout", 180);
  const focus = Array.isArray(summary.focus) && summary.focus.length ? summary.focus.join(", ") : "";
  const unit = text(summary.unit || "lb", 16);
  const notes = String(summary.notes || "").trim();
  const header = [
    `Routine: ${routineName}`,
    focus ? `Focus: ${text(focus, 160)}` : null,
    `Date: ${summary.dateKey || summary.date || "unknown"}`,
  ].filter(Boolean);
  const noteBlock = notes ? `\nNotes:\n${notes}` : "";
  const exerciseLines = mappedExercises.flatMap((exercise) => formatExerciseSetRows(
    exercise,
    unit,
    String(exercise?.exerciseId || "")
  ));
  const detailHeader = mappedExercises.length
    ? "\nWorkout details:\n"
    : "\nNo exercises were recorded.";
  return `${header.join("\n")}${noteBlock}${detailHeader}${exerciseLines.map((line) => line).join("\n")}`.trim();
}

function summaryLine(summary) {
  const count = Number(summary.exerciseCount || 0);
  const focus = Array.isArray(summary.focus) && summary.focus.length ? ` (${summary.focus.join(", ")})` : "";
  const topExercises = (summary.exerciseSummaries || [])
    .slice(0, 4)
    .map((exercise) => text(exercise.name || exercise.exerciseName || "Exercise", 80))
    .filter(Boolean)
    .join(", ");
  const base = `${count || (summary.exerciseSummaries || []).length || 0} exercise${count === 1 ? "" : "s"}${focus}`;
  return topExercises ? `${base}: ${topExercises}` : base;
}

function mapWorkoutSummaryToTimeLeft(summary, options = {}) {
  const workoutId = text(options.workoutId || summary.workoutId || "", 120);
  const dateId = validDateId(summary.dateKey || summary.date);
  const updatedIso = isoFromMs(summary.updatedAtMs);
  const exerciseSummaries = Array.isArray(summary.exerciseSummaries)
    ? summary.exerciseSummaries.slice(0, 50)
    : [];
  const fallbackFromSummary = Array.isArray(summary.exerciseSetDetails)
    ? summary.exerciseSetDetails.reduce((result, detail) => {
      const id = text(detail?.exerciseId, 120);
      if (!id) return result;
      result[id] = Array.isArray(detail.sets) ? detail.sets.slice(0, 50) : [];
      return result;
    }, {})
    : {};
  const fallbackFromOptions = Array.isArray(options.exerciseSetDetails)
    ? options.exerciseSetDetails.reduce((result, detail) => {
      const id = text(detail?.exerciseId, 120);
      if (!id) return result;
      result[id] = Array.isArray(detail.sets) ? detail.sets.slice(0, 50) : [];
      return result;
    }, {})
    : {};
  const mappedExercises = exerciseSummaries.map((exercise) => {
    if (!exercise || typeof exercise !== "object") return exercise;
    const sourceSets = Array.isArray(exercise.sets)
      ? exercise.sets
      : fallbackFromOptions[exercise.exerciseId] || fallbackFromSummary[exercise.exerciseId] || [];
    return {
      ...exercise,
      sets: sourceSets.slice(0, 50),
    };
  });

  return compactObject({
    dateId: dateId || undefined,
    sourceApp: "GYM-K2",
    category: "workout",
    title: text(summary.routineName || "Workout", 180),
    summary: summaryLine({ ...summary, exerciseSummaries }),
    description: buildFullDescription({ ...summary }, mappedExercises),
    sourceFirebaseProjectId: options.sourceFirebaseProjectId || "gym-k2",
    sourceProjectName: "GYM-K2",
    sourceProjectId: options.sourceProjectId || "gym-k2",
    sourceCollection: "workout_summaries",
    sourceDocumentId: workoutId,
    sourceDocumentPath: options.sourceDocumentPath || `users/${options.uid || ""}/workout_summaries/${workoutId}`,
    sourceStoragePath: null,
    sourceUrl: "",
    fileUrl: null,
    thumbnailUrl: null,
    contentType: null,
    fileName: null,
    fileSize: null,
    originalCreatedAt: updatedIso,
    originalUpdatedAt: updatedIso,
    capturedAt: updatedIso || new Date().toISOString(),
    visibility: "ownerOnly",
    syncStatus: options.syncStatus || "active",
    metadata: compactObject({
      uid: options.uid || null,
      workoutId,
      routineName: summary.routineName || null,
      date: summary.dateKey || summary.date || null,
      unit: summary.unit || null,
      focus: Array.isArray(summary.focus) ? summary.focus.slice(0, 8) : [],
      notes: summary.notes || null,
      exerciseCount: Number(summary.exerciseCount || exerciseSummaries.length || 0),
      exerciseSummaries: mappedExercises,
      allSetCount: mappedExercises.reduce((total, exercise) => total + (Array.isArray(exercise.sets) ? exercise.sets.length : 0), 0),
      archivedAtMs: Number(summary.archivedAtMs) || null,
      finalizationId: summary.finalizationId || null,
      source: "GYM-K2",
    }),
  });
}

module.exports = {
  mapWorkoutSummaryToTimeLeft,
  validDateId,
};
