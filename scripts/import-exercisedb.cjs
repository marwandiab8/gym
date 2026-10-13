#!/usr/bin/env node
// Loads ExerciseDB (free V1: https://oss.exercisedb.dev, non-commercial use with credit) into the app:
//   - Firestore `exercisedb/exdb_{id}`: name, muscles, equipment, steps and the animation's URL, for the
//     exercise card (tap an exercise's name);
//   - public/data/exercisedb-index.json: id, name, equipment, muscles and body parts, for search and the
//     machine-photo picker (shipped with the app and cached by the service worker).
// Usage: node scripts/import-exercisedb.cjs <exercisedb.json from the API> [--check-gifs] [--write]
// Without --write it only builds the index file and reports what it would write to Firestore.
// Some exercises have no animation on ExerciseDB's server (most are a second copy of an exercise listed
// twice). --check-gifs asks the server for each animation, one at a time, and keeps the answers in
// <exercisedb.json>.gifs.json for the next run. In the index, a copy without an animation points at its
// twin (`sameAs`), and an exercise with no animation at all is marked `noGif`.
const fs = require("fs");
const path = require("path");

const [, , source, ...flags] = process.argv;
if (!source) {
  console.error("Usage: node scripts/import-exercisedb.cjs <exercisedb.json> [--check-gifs] [--write]");
  process.exit(1);
}
const WRITE = flags.includes("--write");
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

// exerciseId -> true (animation there) / false (not found); missing: not checked.
const gifsPath = `${source}.gifs.json`;
const gifs = fs.existsSync(gifsPath) ? JSON.parse(fs.readFileSync(gifsPath, "utf8")) : {};

async function checkGifs() {
  const todo = items.filter((x) => !(x.doc.exdbId in gifs) && x.doc.gifUrl);
  for (const [i, x] of todo.entries()) {
    const res = await fetch(x.doc.gifUrl, { method: "HEAD" });
    if (res.status === 200 || res.status === 404) gifs[x.doc.exdbId] = res.status === 200;
    else console.warn(`${x.doc.exdbId}: HTTP ${res.status}, not recorded`);
    if (i % 50 === 49) fs.writeFileSync(gifsPath, JSON.stringify(gifs));
    await new Promise((r) => setTimeout(r, 250));
  }
  fs.writeFileSync(gifsPath, JSON.stringify(gifs));
}

function writeIndex() {
  const hasGif = (x) => x.doc.gifUrl && gifs[x.doc.exdbId] !== false;
  const withGif = new Map();
  for (const x of items) if (hasGif(x) && !withGif.has(x.name.toLowerCase())) withGif.set(x.name.toLowerCase(), x.id);
  let twins = 0;
  let none = 0;
  const index = items.map((x) => {
    if (hasGif(x)) return { id: x.id, name: x.name, equipment: x.doc.equipments, target: x.doc.targetMuscles, bodyParts: x.doc.bodyParts };
    const twin = withGif.get(x.name.toLowerCase());
    if (twin) {
      twins += 1;
      return { id: x.id, sameAs: twin };
    }
    none += 1;
    x.doc.gifUrl = "";
    return { id: x.id, name: x.name, equipment: x.doc.equipments, target: x.doc.targetMuscles, bodyParts: x.doc.bodyParts, noGif: true };
  });
  const indexPath = path.resolve(__dirname, "../public/data/exercisedb-index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index));
  console.log(`index: ${index.length - twins} exercises (${none} without an animation) + ${twins} copies pointing at their twin, ${fs.statSync(indexPath).size} bytes -> ${path.relative(process.cwd(), indexPath)}`);
}

async function writeFirestore() {
  const admin = require(path.resolve(__dirname, "../functions/node_modules/firebase-admin"));
  const db = admin.initializeApp({ projectId: "gym-k2" }).firestore();
  for (let i = 0; i < items.length; i += 400) {
    const batch = db.batch();
    for (const x of items.slice(i, i + 400)) {
      batch.set(db.collection("exercisedb").doc(x.id), { ...x.doc, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }
  console.log(`wrote ${items.length} docs to exercisedb/`);
}

(async () => {
  if (flags.includes("--check-gifs")) await checkGifs();
  const unchecked = items.filter((x) => x.doc.gifUrl && !(x.doc.exdbId in gifs)).length;
  if (unchecked) console.log(`${unchecked} animations not checked (pass --check-gifs)`);
  writeIndex();
  if (WRITE) await writeFirestore();
  else console.log(`dry run: would write ${items.length} docs to exercisedb/ (pass --write)`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
