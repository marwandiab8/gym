const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.resolve(__dirname, "../../public");
const standalonePages = ["progress.html", "prs.html", "settings.html"];

function navigationLinks(html, label) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((match) => ({
      href: match[1],
      label: match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    }))
    .filter((link) => link.label === label);
}

test("standalone page navigation uses the canonical home and recent routes", () => {
  for (const page of standalonePages) {
    const html = fs.readFileSync(path.join(publicDir, page), "utf8");
    const analyticsLinks = navigationLinks(html, "Analytics");
    const workoutLinks = navigationLinks(html, "Workouts");

    assert.equal(analyticsLinks.length, 2, `${page} should have desktop and mobile Analytics links`);
    assert.deepEqual(analyticsLinks.map((link) => link.href), ["index.html", "index.html"]);
    assert.equal(workoutLinks.length, 2, `${page} should have desktop and mobile Workouts links`);
    assert.deepEqual(workoutLinks.map((link) => link.href), ["index.html#recent", "index.html#recent"]);
    assert.doesNotMatch(html, /href="index\.html#(?:analyticsContent|recentWorkouts)"/);
  }
});
