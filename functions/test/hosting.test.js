const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.resolve(__dirname, "../../public");
const read = (file) => fs.readFileSync(path.join(publicDir, file), "utf8");
const pages = ["index.html", "progress.html", "prs.html", "settings.html"];

function shippedFiles(dir = publicDir, base = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const rel = path.posix.join(base, entry.name);
    return entry.isDirectory() ? shippedFiles(path.join(dir, entry.name), rel) : [rel];
  });
}

test("pages use the prebuilt stylesheet instead of compiling Tailwind in the browser", () => {
  for (const page of pages) {
    const html = read(page);
    assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config/, `${page} must not load the Tailwind Play CDN`);
    // tailwind.css comes after styles.css so the cascade matches what the runtime compiler used to produce
    assert.ok(html.indexOf('href="styles.css"') !== -1 && html.indexOf('href="styles.css"') < html.indexOf('href="tailwind.css"'), `${page}: tailwind.css must follow styles.css`);
  }
  assert.ok(fs.statSync(path.join(publicDir, "tailwind.css")).size > 10000, "public/tailwind.css must be built (npm run build:assets)");
});

test("Chart.js is only loaded on the page that draws a chart", () => {
  for (const page of pages) {
    const loadsChart = /cdn\.jsdelivr\.net\/npm\/chart\.js/.test(read(page));
    assert.equal(loadsChart, page === "progress.html", `${page}: chart.js should ${page === "progress.html" ? "" : "not "}be loaded`);
  }
  assert.match(read("progress.html"), /chart\.js" defer>/);
  assert.ok(!/new Chart\(/.test(read("index.html")), "index.html must not draw charts itself");
});

test("every page starts its downloads early and registers the service worker", () => {
  const appUrl = read("index.html").match(/src="(app\.js\?v=[^"]+)"/)[1];
  for (const page of pages) {
    const html = read(page);
    for (const href of [appUrl, "js/setScoring.js", "js/workoutSession.js", "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"]) {
      assert.ok(html.includes(`<link rel="modulepreload" href="${href}" />`), `${page} should modulepreload ${href}`);
    }
    assert.match(html, /navigator\.serviceWorker\.register\("\/sw\.js"\)/, `${page} registers the service worker`);
  }
  // modulepreload URLs must match what app.js really imports, or the hint is wasted
  const app = read("app.js");
  for (const mod of ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js", "firebase-functions.js"]) {
    assert.ok(app.includes(`https://www.gstatic.com/firebasejs/10.12.5/${mod}`), `app.js imports ${mod}`);
  }
});

test("service worker only answers app files and pinned libraries, never live data", () => {
  const sw = read("sw.js");
  // data and auth hosts must not appear anywhere in the worker, so nothing can ever be cached from them
  assert.doesNotMatch(sw, /firestore\.googleapis|identitytoolkit|securetoken|cloudfunctions|apis\.google\.com/);
  assert.match(sw, /request\.method !== "GET"/);
  assert.match(sw, /request\.headers\.has\("range"\)/);
  assert.match(sw, /Anything else \(Firestore, Auth, Cloud Functions/);
  // the worker script itself is never served from its own cache, or updates could never be found
  assert.match(sw, /url\.pathname === "\/sw\.js"\) return/);
  // an unstamped worker would never update
  assert.doesNotMatch(sw, /const BUILD_ID = "dev"/, "run `npm run build:assets` to stamp public/sw.js");
});

test("service worker precache lists exactly the files that ship", () => {
  const sw = read("sw.js");
  const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  const shipped = shippedFiles().filter((file) => file !== "sw.js").map((file) => `/${file}`).sort();
  assert.deepEqual([...precache].sort(), shipped, "sw.js is out of date: run `npm run build:assets`");
});

test("app reloads onto a new version only when no workout is in progress", () => {
  const app = read("app.js");
  const block = app.match(/navigator\.serviceWorker\.addEventListener\("controllerchange"[\s\S]*?\}\);/)[0];
  assert.match(block, /!hadController/, "the first install must not trigger a reload");
  assert.match(block, /activeWorkoutRef \|\| isFinishingWorkout \|\| isDiscardingWorkout/);
});

test("hosting rebuilds assets before every deploy and never caches the worker or html", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../firebase.json"), "utf8"));
  assert.deepEqual(config.hosting.predeploy, ["node scripts/build-assets.mjs"]);
  const header = (source) => config.hosting.headers.find((rule) => rule.source === source)?.headers[0].value;
  assert.match(header("/sw.js"), /no-store/);
  assert.match(header("**/*.html"), /max-age=0/);
});
