/**
 * AI routine parsing (shared tests). Used by `functions/index.js`.
 */

const AI_MAX_EXERCISES = 12;

function normalizePrompt(rawPrompt) {
  if (typeof rawPrompt !== "string") return "";
  return rawPrompt.replace(/\s+/g, " ").trim();
}

function isStructuredObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stripMarkdownFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonCandidate(text) {
  const cleaned = stripMarkdownFence(text);
  const candidates = [cleaned];
  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    candidates.push(cleaned.slice(arrayStart, arrayEnd + 1));
  }
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.push(cleaned.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // Try the next candidate.
    }
  }
  throw new Error("Model output did not contain valid JSON.");
}

function normalizeExercise(rawExercise) {
  if (!isStructuredObject(rawExercise)) {
    throw new Error("Each exercise must be an object.");
  }
  const name = String(rawExercise.name || "").replace(/\s+/g, " ").trim();
  const reps = String(rawExercise.reps || "").replace(/\s+/g, " ").trim();
  const sets = Number.parseInt(String(rawExercise.sets || ""), 10);

  if (!name || name.length > 80) {
    throw new Error("Exercise name is missing or too long.");
  }
  if (!reps || reps.length > 24) {
    throw new Error("Exercise reps are missing or too long.");
  }
  if (!Number.isInteger(sets) || sets < 1 || sets > 8) {
    throw new Error("Exercise sets must be an integer between 1 and 8.");
  }

  return { name, sets, reps };
}

function normalizeAiExercises(rawPayload) {
  const rawExercises = Array.isArray(rawPayload)
    ? rawPayload
    : Array.isArray(rawPayload?.exercises)
      ? rawPayload.exercises
      : null;

  if (!rawExercises || rawExercises.length === 0 || rawExercises.length > AI_MAX_EXERCISES) {
    throw new Error("Model output must include 1-12 exercises.");
  }

  return rawExercises.map(normalizeExercise);
}

module.exports = {
  AI_MAX_EXERCISES,
  normalizePrompt,
  isStructuredObject,
  stripMarkdownFence,
  extractJsonCandidate,
  normalizeExercise,
  normalizeAiExercises,
};
