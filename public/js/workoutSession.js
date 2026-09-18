export function isCalendarDateKey(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(year, month, 0).getDate() : 0;
  return day >= 1 && day <= daysInMonth;
}

export function localCalendarDateKey(date = new Date(), timeZone) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const options = { year: "numeric", month: "2-digit", day: "2-digit" };
  if (timeZone) options.timeZone = timeZone;
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function resolveNewWorkoutDate({ selectedDate, manuallySelected = false, now = new Date(), timeZone } = {}) {
  const currentDate = localCalendarDateKey(now, timeZone);
  return manuallySelected && isCalendarDateKey(selectedDate) ? selectedDate : currentDate;
}

export function needsWorkoutDateConfirmation({
  selectedDate,
  currentDate,
  confirmedSelectedDate = null,
  confirmedCurrentDate = null,
} = {}) {
  if (!isCalendarDateKey(selectedDate) || !isCalendarDateKey(currentDate)) return true;
  if (selectedDate === currentDate) return false;
  return confirmedSelectedDate !== selectedDate || confirmedCurrentDate !== currentDate;
}

export function applyDraftDateChoice(draft, choice, currentDate) {
  const source = draft && typeof draft === "object" ? draft : {};
  if (choice === "cancel") return { draft: source, selectedDate: source.date || source.dateKey || "", cancelled: true };
  const originalDate = isCalendarDateKey(source.dateKey) ? source.dateKey : source.date;
  const selectedDate = choice === "move" ? currentDate : originalDate;
  if (!isCalendarDateKey(selectedDate)) throw new Error("A valid workout date is required.");
  return {
    draft: choice === "move" ? { ...source, date: selectedDate, dateKey: selectedDate } : source,
    selectedDate,
    cancelled: false,
  };
}

export function formatCalendarDate(dateKey, options = {}) {
  if (!isCalendarDateKey(dateKey)) return String(dateKey || "Unknown date");
  const [year, month, day] = dateKey.split("-").map(Number);
  const localNoon = new Date(year, month - 1, day, 12, 0, 0);
  return localNoon.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(options.includeYear === false ? {} : { year: "numeric" }),
  });
}

function workoutDateKey(workout) {
  if (isCalendarDateKey(workout?.dateKey)) return workout.dateKey;
  return isCalendarDateKey(workout?.date) ? workout.date : "";
}

function defaultIsCompletedSet(set) {
  return (parseInt(String(set?.reps ?? ""), 10) || 0) > 0;
}

function completedHistoricalSets(sets, isCompletedSet = defaultIsCompletedSet) {
  return (Array.isArray(sets) ? sets : [])
    .filter((set) => isCompletedSet(set))
    .map((set) => ({
      weight: set?.weight == null ? "" : String(set.weight),
      reps: set?.reps == null ? "" : String(set.reps),
      rpe: set?.rpe == null ? "" : String(set.rpe),
    }));
}

function defaultCompletedExerciseSets(exercise, isCompletedSet = defaultIsCompletedSet) {
  const sets = completedHistoricalSets(exercise?.sets, isCompletedSet);
  const hasInteractionTracking = exercise && (
    Object.prototype.hasOwnProperty.call(exercise, "firstEditTime") ||
    Object.prototype.hasOwnProperty.call(exercise, "lastEditTime")
  );
  if (hasInteractionTracking && !Number(exercise.firstEditTime) && !Number(exercise.lastEditTime)) return [];
  return sets;
}

export function normalizeCachedExerciseSessions(sessions, limit = 5, isCompletedSet = defaultIsCompletedSet) {
  const seenWorkoutIds = new Set();
  return (Array.isArray(sessions) ? sessions : [])
    .map((session) => {
      const sets = completedHistoricalSets(session?.sets, isCompletedSet);
      if (!sets.length) return null;
      return {
        workoutId: String(session?.workoutId || ""),
        date: workoutDateKey(session),
        updatedAtMs: Number(session?.updatedAtMs) || 0,
        unit: session?.unit === "kg" ? "kg" : "lb",
        exerciseNote: String(session?.exerciseNote || "").slice(0, 500),
        sets,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const updatedDiff = b.updatedAtMs - a.updatedAtMs;
      if (updatedDiff) return updatedDiff;
      const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
      return dateDiff;
    })
    .filter((session) => {
      const key = session.workoutId || `${session.date}:${session.updatedAtMs}`;
      if (seenWorkoutIds.has(key)) return false;
      seenWorkoutIds.add(key);
      return true;
    })
    .slice(0, Math.max(1, Math.min(5, Number(limit) || 5)));
}

export function selectPreviousExerciseSessions(
  workouts,
  exerciseId,
  currentWorkoutId = null,
  limit = 5,
  isCompletedSet = defaultIsCompletedSet,
  selectCompletedExerciseSets = null
) {
  if (!exerciseId) return [];
  const sessions = (Array.isArray(workouts) ? workouts : [])
    .filter((workout) => workout?.status === "final" && workout.id !== currentWorkoutId)
    .map((workout) => {
      const exercise = (Array.isArray(workout.exercises) ? workout.exercises : [])
        .find((row) => row?.exerciseId === exerciseId);
      const selectedSets = selectCompletedExerciseSets
        ? selectCompletedExerciseSets(exercise)
        : defaultCompletedExerciseSets(exercise, isCompletedSet);
      const sets = completedHistoricalSets(selectedSets, isCompletedSet);
      if (!exercise || !sets.length) return null;
      return {
        workoutId: workout.id,
        date: workoutDateKey(workout),
        updatedAtMs: Number(workout.updatedAtMs) || 0,
        unit: workout.unit === "kg" ? "kg" : "lb",
        exerciseNote: String(exercise.exerciseNote || "").slice(0, 500),
        sets,
      };
    })
    .filter(Boolean);
  return normalizeCachedExerciseSessions(sessions, limit, isCompletedSet);
}

export function previousSetPlaceholder(previousSets, setIndex, field) {
  const previousSet = Array.isArray(previousSets) ? previousSets[setIndex] : null;
  if (!previousSet || (field !== "weight" && field !== "reps")) return "";
  const raw = String(previousSet[field] ?? "").trim();
  const value = field === "weight" && raw === "" ? "0" : raw;
  return value === "" ? "" : `Last: ${value}`;
}

function direction(current, previous) {
  if (current > previous) return "increased";
  if (current < previous) return "decreased";
  return "same";
}

export function compareSetPerformance(currentSet, previousSet, scoreFn) {
  if (!previousSet) return { comparable: false, reason: "no-previous-set" };
  const currentWeightRaw = String(currentSet?.weight ?? "").trim();
  const currentReps = parseInt(String(currentSet?.reps ?? ""), 10) || 0;
  if (!currentWeightRaw && currentReps <= 0) return { comparable: false, reason: "current-set-incomplete" };
  const currentWeight = Number(currentSet?.weight) || 0;
  const previousWeight = Number(previousSet?.weight) || 0;
  const previousReps = parseInt(String(previousSet?.reps ?? ""), 10) || 0;
  const currentScore = Number(scoreFn(currentSet)) || 0;
  const previousScore = Number(scoreFn(previousSet)) || 0;
  return {
    comparable: true,
    weight: direction(currentWeight, previousWeight),
    reps: direction(currentReps, previousReps),
    score: direction(currentScore, previousScore),
    currentScore,
    previousScore,
  };
}

export function progressStateMessage(status, sessionCount = 0) {
  if (status === "loading") return "Loading previous performance…";
  if (status === "offline") return sessionCount > 0
    ? "Offline — showing cached previous performance."
    : "Offline — previous performance is unavailable.";
  if (status === "error") return "Previous performance could not be loaded.";
  if (status === "ready" && sessionCount === 0) return "No previous workout recorded for this exercise";
  return "";
}

/** A draft is worth keeping/offering when the user authored anything: exercises, focus, notes, a routine or a name. */
export function draftHasMeaningfulProgress(draft) {
  if (!draft || typeof draft !== "object") return false;
  const exercises = Array.isArray(draft.exercises) ? draft.exercises : [];
  if (exercises.length > 0) return true;
  if (Array.isArray(draft.focus) && draft.focus.length > 0) return true;
  if (typeof draft.notes === "string" && draft.notes.trim()) return true;
  if (typeof draft.templateId === "string" && draft.templateId.trim()) return true;
  const routineName = String(draft.routineName || "").trim();
  if (routineName && routineName !== "Custom Workout") return true;
  return false;
}

/** Number of sets with a rep count or a weight entered, across all exercises. */
export function countLoggedSets(exercises) {
  return (Array.isArray(exercises) ? exercises : []).reduce((total, exercise) => (
    total + (Array.isArray(exercise?.sets) ? exercise.sets : []).filter((set) => (
      (parseInt(String(set?.reps ?? ""), 10) || 0) > 0 || String(set?.weight ?? "").trim() !== ""
    )).length
  ), 0);
}

/**
 * Ids of drafts that hold nothing the user authored (see draftHasMeaningfulProgress) and have sat untouched
 * long enough that they cannot be a workout just started on another device. Safe to delete without asking.
 */
export function selectEmptyStaleDraftIds(drafts, { activeId = null, nowMs = Date.now(), minAgeMs = 60 * 60 * 1000 } = {}) {
  return (Array.isArray(drafts) ? drafts : [])
    .filter((draft) => (
      draft?.id &&
      draft.status === "draft" &&
      draft.id !== activeId &&
      !draftHasMeaningfulProgress(draft) &&
      nowMs - (Number(draft.updatedAtMs) || 0) >= minAgeMs
    ))
    .map((draft) => draft.id);
}

/**
 * Chooses the previous sessions to show for an exercise.
 * `history` is { sessions, complete } from the finalized-workout scan; `complete` is false when the scan stopped
 * at its page cap, in which case older sessions are unknown and the derived last-sets cache fills the gap.
 */
export function resolveExerciseSessions({
  history = null,
  derivedSessions = [],
  cachedSessions = [],
  historyUnavailable = false,
  limit = 5,
  isCompletedSet = defaultIsCompletedSet,
} = {}) {
  const sessions = Array.isArray(history?.sessions) ? history.sessions : [];
  if (historyUnavailable) {
    return normalizeCachedExerciseSessions([...sessions, ...derivedSessions, ...cachedSessions], limit, isCompletedSet);
  }
  if (history?.complete || sessions.length >= limit) return sessions;
  return normalizeCachedExerciseSessions([...sessions, ...derivedSessions], limit, isCompletedSet);
}
