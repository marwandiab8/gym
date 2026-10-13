#!/usr/bin/env node
// Loads ExerciseDB (free V1: https://oss.exercisedb.dev, non-commercial use with credit) into the app:
//   - Firestore `exercisedb/exdb_{id}`: name, muscles, equipment, steps and the animation's URL, for the
//     exercise card (tap an exercise's name);
//   - public/data/exercisedb-index.json: id, name, equipment, muscles and body parts, for search and the
//     machine-photo picker (shipped with the app and cached by the service worker).
// Usage: node scripts/import-exercisedb.cjs <exercisedb.json from the API> [--write]
// Without --write it only builds the index file and reports what it would write to Firestore.
const fs = require("fs");
const path = require("path");

const [, , source, flag] = process.argv;
if (!source) {
  console.error("Usage: node scripts/import-exercisedb.cjs <exercisedb.json> [--write]");
  process.exit(1);
}
const titleCase = (s) => String(s || "").trim().replace(/\b([a-z])/g, (c) => c.toUpperCase());
const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

const items = JSON.parse(fs.readFileSync(source, "utf8"))
  .filter((e) => e && e.exerciseId && e.name)
  .map((e) => ({
    id: `exdb_${e.exerciseId}`,
    name: titleCase(e.name),
    doc: {
      exdbId: String(e.exerciseId),
      name: String(e.name).trim(),
      nameLower: String(e.name).trim().toLowerCase(),
      gifUrl: String(e.gifUrl || ""),
      bodyParts: list(e.bodyParts),
      targetMuscles: list(e.targetMuscles),
      secondaryMuscles: list(e.secondaryMuscles),
      equipments: list(e.equipments),
      instructions: list(e.instructions).map((step) => step.replace(/^Step:\s*\d+\s*/i, "")),
      source: "exercisedb-v1",
    },
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const index = items.map((x) => ({ id: x.id, name: x.name, equipment: x.doc.equipments, target: x.doc.targetMuscles, bodyParts: x.doc.bodyParts }));
const indexPath = path.resolve(__dirname, "../public/data/exercisedb-index.json");
fs.writeFileSync(indexPath, JSON.stringify(index));
console.log(`index: ${index.length} exercises, ${fs.statSync(indexPath).size} bytes -> ${path.relative(process.cwd(), indexPath)}`);

if (flag !== "--write") {
  console.log(`dry run: would write ${items.length} docs to exercisedb/ (pass --write)`);
  process.exit(0);
}
const admin = require(path.resolve(__dirname, "../functions/node_modules/firebase-admin"));
const db = admin.initializeApp({ projectId: "gym-k2" }).firestore();
(async () => {
  for (let i = 0; i < items.length; i += 400) {
    const batch = db.batch();
    for (const x of items.slice(i, i + 400)) {
      batch.set(db.collection("exercisedb").doc(x.id), { ...x.doc, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }
  console.log(`wrote ${items.length} docs to exercisedb/`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
