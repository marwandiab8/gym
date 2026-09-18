#!/usr/bin/env node
// Builds the files the browser needs before hosting is deployed. Runs automatically via firebase.json
// (hosting.predeploy), or by hand with `npm run build:assets`.
//   1. public/tailwind.css  - Tailwind compiled ahead of time, so phones do not compile CSS on every launch
//   2. public/sw.js         - stamped with a hash of every shipped file so browsers pick up new versions
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

const tailwind = spawnSync(
  "npx",
  ["--no-install", "tailwindcss", "-c", "tailwind.config.js", "-i", "src/tailwind.css", "-o", "public/tailwind.css", "--minify"],
  { cwd: root, encoding: "utf8" }
);
if (tailwind.status !== 0) {
  console.error(tailwind.stderr || tailwind.stdout);
  console.error("\nTailwind build failed. If tailwindcss is missing, run `npm install` in the project root first.");
  process.exit(1);
}

function listFiles(dir, base = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const rel = path.posix.join(base, entry.name);
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel];
  });
}

const shipped = listFiles(publicDir).filter((file) => file !== "sw.js").sort();
const hash = createHash("sha256");
for (const file of shipped) hash.update(file).update("\0").update(fs.readFileSync(path.join(publicDir, file)));
const buildId = hash.digest("hex").slice(0, 12);

const swPath = path.join(publicDir, "sw.js");
const sw = fs.readFileSync(swPath, "utf8");
const stamp = `// BEGIN STAMP\nconst BUILD_ID = ${JSON.stringify(buildId)};\nconst PRECACHE = ${JSON.stringify(shipped.map((file) => `/${file}`), null, 2)};\n// END STAMP`;
const stamped = sw.replace(/\/\/ BEGIN STAMP[\s\S]*?\/\/ END STAMP/, stamp);
if (stamped === sw && !sw.includes(stamp)) throw new Error("Could not find the BEGIN/END STAMP markers in public/sw.js");
if (stamped !== sw) fs.writeFileSync(swPath, stamped);

console.log(`build-assets: tailwind.css ${fs.statSync(path.join(publicDir, "tailwind.css")).size} bytes; service worker build ${buildId} (${shipped.length} files)`);
