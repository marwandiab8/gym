# Architecture Notes

## Runtime Shape

- Hosting serves a static client from `public/`.
- Firebase Auth uses Google sign-in.
- Firestore stores user-owned workout data plus read-only catalog collections.
- Cloud Functions maintain derived workout documents and proxy AI routine generation.

## Important Collections

- `users/{uid}/workouts`
  - Source of truth for draft and final workouts.
  - Drafts are autosaved from the client and mirrored to localStorage.
- `users/{uid}/workout_summaries`
  - Derived by `onWorkoutFinalize`.
  - Used for recent workouts, counts, and chart sampling.
- `users/{uid}/exercise_last_sets`
  - Derived by `onWorkoutFinalize`.
  - Used to prefill "Copy Last".
- `users/{uid}/prs`
  - Written by the client when finishing a workout.
  - Not currently recomputed by backend triggers.
- `users/{uid}/templates`
  - Saved workout templates.
- `users/{uid}/custom_exercises`
  - Per-user exercises created from search misses or AI matching.
- `catalog_*`
  - Signed-in readable reference data.

## Coupled Logic

- `functions/lib/setScoring.js` and `public/js/setScoring.js` are parallel implementations.
- `buildExerciseSummaries()` shapes what analytics sees from summaries.
- `fetchLastFinalSetsForExerciseSafe()` falls back to raw workout scans when cached last sets are missing.

## Known Sharp Edges

- PR state is updated on workout completion in the client, not by a trigger.
- Analytics and recent-workout display use helper logic in `workoutDisplayMeta()`, so date semantics are easy to regress.
- `exercise_last_sets` is based on a capped scan of recent final workouts in the function trigger.
- `public/app.js` is monolithic; changes in one area often affect autosave, analytics, and modal rendering.

## Queries That Matter

- Final workouts by `status + updatedAtMs`
- Final workouts by `status + date`
- Recent summaries by `updatedAtMs`
- Summary window reads by `date`

Any change to those query shapes may require updating `firestore.indexes.json`.
