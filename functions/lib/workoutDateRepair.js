function normalizeDateKey(value) {
  const trimmed = String(value || "").trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(year, month, 0).getDate() : 0;
  return day >= 1 && day <= daysInMonth ? trimmed : "";
}

function resolveWorkoutDateFields(date, dateKey = date) {
  const normalizedDate = normalizeDateKey(date);
  const normalizedDateKey = normalizeDateKey(dateKey || date);
  if (!normalizedDate || !normalizedDateKey || normalizedDate !== normalizedDateKey) {
    throw new Error("Workout date and date key must be the same valid calendar date.");
  }
  return { date: normalizedDate, dateKey: normalizedDateKey };
}

function timestampToMs(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function normalizedExerciseIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean))]
    .sort();
}

function selectDateRepairCandidates(records, criteria = {}) {
  const originalDate = normalizeDateKey(criteria.originalDate);
  const expectedExerciseIds = normalizedExerciseIds(criteria.exerciseIds);
  const finalizedAfterMs = Number(criteria.finalizedAfterMs) || 0;
  const finalizedBeforeMs = Number(criteria.finalizedBeforeMs) || Number.MAX_SAFE_INTEGER;
  return (Array.isArray(records) ? records : []).filter((record) => {
    if (record?.status !== "final" || normalizeDateKey(record.date) !== originalDate) return false;
    const finalizedAtMs = Number(record.finalizedAtMs) || timestampToMs(record.finishedAt);
    if (finalizedAtMs < finalizedAfterMs || finalizedAtMs > finalizedBeforeMs) return false;
    if (expectedExerciseIds.length) {
      const actual = normalizedExerciseIds((record.exercises || []).map((exercise) => exercise?.exerciseId));
      if (expectedExerciseIds.some((exerciseId) => !actual.includes(exerciseId))) return false;
    }
    return true;
  });
}

function buildDateRepairPlan({ workoutId, workout, expectedOriginalDate, newDate, expectedFinalizationId, expectedFinalizedAtMs }) {
  if (!workoutId || workout?.status !== "final") throw new Error("Only a finalized workout can be date-corrected.");
  const original = resolveWorkoutDateFields(workout.date, workout.dateKey || workout.date);
  const target = resolveWorkoutDateFields(newDate, newDate);
  if (original.date !== normalizeDateKey(expectedOriginalDate)) throw new Error("Workout date no longer matches the expected original date.");
  if (!expectedFinalizationId || String(workout.finalizationId || "") !== String(expectedFinalizationId)) {
    throw new Error("Workout finalization identity does not match.");
  }
  if (!Number.isFinite(Number(expectedFinalizedAtMs)) || Number(workout.finalizedAtMs || 0) !== Number(expectedFinalizedAtMs)) {
    throw new Error("Workout finalization timestamp does not match.");
  }
  if (original.date === target.date) throw new Error("The corrected date must differ from the original date.");
  return {
    workoutPatch: target,
    receiptPatch: { workoutDate: target.date, workoutDateKey: target.dateKey },
    original,
    target,
  };
}

function prDateRepairPatch(pr, workoutId, newDate) {
  if (!pr || pr.sourceWorkoutId !== workoutId) return null;
  const target = resolveWorkoutDateFields(newDate, newDate);
  return { date: target.date, sourceWorkoutDate: target.dateKey };
}

module.exports = {
  buildDateRepairPlan,
  normalizeDateKey,
  prDateRepairPatch,
  resolveWorkoutDateFields,
  selectDateRepairCandidates,
  timestampToMs,
};
