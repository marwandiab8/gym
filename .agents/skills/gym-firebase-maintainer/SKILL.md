---
name: gym-firebase-maintainer
description: Use when working on this GYM codebase: a Firebase Hosting + Firestore + Cloud Functions workout tracker with AI routine generation, local draft recovery, workout summaries, PR tracking, and cached last-set history. Use this skill for feature work, bug fixes, reviews, analytics changes, Firestore rules/indexes work, or any task that touches workout finalization, summaries, PR logic, or the AI callable.
---

# Gym Firebase Maintainer

## Overview

This repo is a single-product Firebase app:

- `public/` is the client. `public/app.js` owns auth, workout drafting/finalization, templates, PRs, analytics, search, and AI routine UX.
- `functions/index.js` owns the Firestore trigger that maintains `workout_summaries` and `exercise_last_sets`, plus the callable AI routine generator.
- `functions/lib/setScoring.js` and `public/js/setScoring.js` must stay behaviorally aligned.

Read [references/architecture.md](references/architecture.md) before changing data flow, analytics, PR logic, or Firestore documents.

## Workflow

1. Start with the smallest relevant surface:
   - Client flow: `public/app.js`
   - Function / derived data flow: `functions/index.js`
   - Shared scoring / chart semantics: `functions/lib/setScoring.js` and `public/js/setScoring.js`
   - Security or query-shape changes: `firestore.rules`, `firestore.indexes.json`, `firebase.json`
2. Preserve these invariants:
   - Final workouts are the source of truth.
   - `workout_summaries` and `exercise_last_sets` are derived data, written only by Functions.
   - PRs are client-maintained documents in `users/{uid}/prs`.
   - Shared scoring logic must stay in sync across client and Functions.
3. When changing Firestore query shape, check whether a composite index is required and update `firestore.indexes.json`.
4. When changing any summary, last-set, PR, or analytics behavior, test both:
   - Freshly finalized workouts
   - Existing historical workouts already stored in Firestore
5. If a change touches set scoring or AI parsing, run `npm test` from the repo root.

## Review Focus

When reviewing this repo, prioritize:

- Stale derived data between `workouts`, `workout_summaries`, `exercise_last_sets`, and `prs`
- Divergence between `functions/lib/setScoring.js` and `public/js/setScoring.js`
- Analytics using `updatedAtMs` when `date` is the intended workout date
- Client-only mutations that should survive deletes, edits, or replay from persisted data
- Firestore rules and index mismatches with live query shapes

## File Map

- `public/app.js`: main product logic, large and stateful
- `public/js/setScoring.js`: client scoring + chart helpers
- `functions/index.js`: callable AI function and Firestore trigger
- `functions/lib/aiRoutine.js`: AI response parsing and validation
- `functions/lib/setScoring.js`: server scoring helpers
- `functions/test/*.test.js`: current regression coverage

## Validation

- `npm test`
- `npm run lint`

Prefer adding or updating focused tests when changing parsing or scoring behavior.
