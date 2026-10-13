#!/usr/bin/env node
// Links each exercise in a user's history to its ExerciseDB match (Claude's first guess, which the user then
// checks or changes on exercise-links.html):
// users/{uid}/exercise_links/{exerciseId} = { name, exdbId (or null: no match), exdbName, matchedBy, sessions },
// matchedBy "match" (a clear match), "close" (the nearest ExerciseDB has) or "none".
// The original exercise and its workout history are never touched: the link only adds ExerciseDB's
// animation, muscles and steps alongside, and keeps the exercise findable in search under its own name.
// Usage: node scripts/link-exercises.cjs <links.json: { uid, links: [{ id, name, exdbId|null, exdbName|null, kind, sessions }] }> [--write]
// An exercise the user has already checked (matchedBy "you") is left alone.
const fs = require("fs");
const path = require("path");

const [, , source, flag] = process.argv;
const plan = JSON.parse(fs.readFileSync(source, "utf8"));
if (!plan.uid || !Array.isArray(plan.links)) throw new Error("expected { uid, links: [...] }");
const linked = plan.links.filter((l) => l.exdbId).length;
console.log(`${plan.links.length} exercises: ${linked} linked to ExerciseDB, ${plan.links.length - linked} kept as they are`);
if (flag !== "--write") {
  console.log("dry run (pass --write)");
  process.exit(0);
}
const admin = require(path.resolve(__dirname, "../functions/node_modules/firebase-admin"));
const db = admin.initializeApp({ projectId: "gym-k2" }).firestore();
(async () => {
  const col = db.collection("users").doc(plan.uid).collection("exercise_links");
  const checked = new Set((await col.where("matchedBy", "==", "you").get()).docs.map((d) => d.id));
  const batch = db.batch();
  let written = 0;
  for (const l of plan.links) {
    if (checked.has(l.id)) continue;
    batch.set(col.doc(l.id), {
      name: String(l.name).trim().slice(0, 120),
      exdbId: l.exdbId || null,
      exdbName: l.exdbName || null,
      matchedBy: ["match", "close", "none"].includes(l.kind) ? l.kind : l.exdbId ? "match" : "none",
      sessions: Number.isInteger(l.sessions) ? l.sessions : 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    written += 1;
  }
  await batch.commit();
  console.log(`wrote ${written} links (${checked.size} you had already checked were left alone)`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
