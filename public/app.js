import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, addDoc, getDoc, getDocs, query, where, onSnapshot, serverTimestamp, deleteDoc, updateDoc, limit, orderBy, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  pickBestSetForPR,
  filterScorableSets,
  isNewPRBeatsCurrent,
  chartPeakFromSummary,
  chartPeakFromRawExercise,
} from "./js/setScoring.js";

const firebaseConfig = { 
  apiKey: "AIzaSyBXKNG9Aoc_a6yRBJYinEl8ec-i_5YwHhI",
  authDomain: "gym-k2.firebaseapp.com",
  projectId: "gym-k2",
  storageBucket: "gym-k2.firebasestorage.app",
  messagingSenderId: "356873632895",
  appId: "1:356873632895:web:e7368bf53ba1ead14c534a" 
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

const els = {
  activeWorkoutBadge: document.getElementById("activeWorkoutBadge"),
  mobileMenuBtn: document.getElementById("mobileMenuBtn"),
  mobileNavPanel: document.getElementById("mobileNavPanel"),
  aiErrorBanner: document.getElementById("aiErrorBanner"),
  userLabel: document.getElementById("userLabel"), signInBtn: document.getElementById("loginBtn"), signOutBtn: document.getElementById("logoutBtn"), searchInput: document.getElementById("searchInput"), searchBtn: document.getElementById("searchBtn"), searchResults: document.getElementById("searchResults"), dateInput: document.getElementById("dateInput"), unitSelect: document.getElementById("unitSelect"), startWorkoutBtn: document.getElementById("startWorkoutBtn"), finishWorkoutBtn: document.getElementById("finishWorkoutBtn"), resumeDraftBtn: document.getElementById("resumeDraftBtn"), saveTemplateBtn: document.getElementById("saveTemplateBtn"), updateTemplateBtn: document.getElementById("updateTemplateBtn"), templatesList: document.getElementById("templatesList"), saveStatus: document.getElementById("saveStatus"), workoutExercises: document.getElementById("workoutExercises"), prsList: document.getElementById("prsList"), analyticsContent: document.getElementById("analyticsContent"), recentWorkouts: document.getElementById("recentWorkouts"),
  workoutModal: document.getElementById("workoutModal"), modalTitle: document.getElementById("modalTitle"), modalContent: document.getElementById("modalContent"), closeModalBtn: document.getElementById("closeModalBtn"), deleteWorkoutBtn: document.getElementById("deleteWorkoutBtn"),
  toggleTimerBtn: document.getElementById("toggleTimerBtn"), restTimerWidget: document.getElementById("restTimerWidget"), timerDisplay: document.getElementById("timerDisplay"), timerAddBtn: document.getElementById("timerAddBtn"), timerPlayPauseBtn: document.getElementById("timerPlayPauseBtn"), timerStopBtn: document.getElementById("timerStopBtn"), timerCloseBtn: document.getElementById("timerCloseBtn"),
  chartExerciseSelect: document.getElementById("chartExerciseSelect"),
  templateModal: document.getElementById("templateModal"), closeTemplateModalBtn: document.getElementById("closeTemplateModalBtn"), editTemplateName: document.getElementById("editTemplateName"), editTemplateExercises: document.getElementById("editTemplateExercises"), saveTemplateChangesBtn: document.getElementById("saveTemplateChangesBtn"), deleteTemplateModalBtn: document.getElementById("deleteTemplateModalBtn"),
  aiModal: document.getElementById("aiModal"), openAiModalBtn: document.getElementById("openAiModalBtn"), closeAiModalBtn: document.getElementById("closeAiModalBtn"), aiPromptInput: document.getElementById("aiPromptInput"), generateAiBtn: document.getElementById("generateAiBtn"),
  workoutNotesWrap: document.getElementById("workoutNotesWrap"), workoutNotesInput: document.getElementById("workoutNotesInput"),
  draftRecoveryDialog: document.getElementById("draftRecoveryDialog"), draftRecoveryText: document.getElementById("draftRecoveryText"), draftRecoveryResume: document.getElementById("draftRecoveryResume"), draftRecoveryDiscard: document.getElementById("draftRecoveryDiscard"),
};

let currentUser = null; let activeWorkoutRef = null; let autosaveTimer = null; let saveIndicatorTimer = null; let draftRecoveryShownThisSession = false;
const LOCAL_DRAFT_KEY_PREFIX = "k2_gym_workout_draft_v1:";
const AUTOSAVE_DEBOUNCE_MS = 800;
const AI_PROMPT_MAX_LENGTH = 600;
// routineName, focus, notes — all persisted on the draft document + mirrored in localStorage
const workoutState = { exercises: [], templateId: null, routineName: "Custom Workout", focus: [], notes: "" };

// NEW: Helper to safely format dates in your local timezone, ignoring UTC
function toLocalISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function todayISO() { 
  return toLocalISODate(new Date()); 
}
if (els.dateInput) els.dateInput.value = todayISO();
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function formatTimeDisplay(ms) { return !ms ? "" : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function setStatus(msg, type = "info") { if (els.saveStatus) { els.saveStatus.innerHTML = `<span class="${type === 'error' ? 'text-red-400' : 'text-emerald-400'}">${escapeHtml(msg)}</span>`; setTimeout(() => { els.saveStatus.innerHTML = ""; }, 3000); } }

/** Autosave line next to timer: supports saving / saved / offline (offline stays until next success). */
function setSaveIndicator(msg, kind = "saved", clearAfterMs = 2200) {
  if (!els.saveStatus) return;
  if (saveIndicatorTimer) { clearTimeout(saveIndicatorTimer); saveIndicatorTimer = null; }
  const cls = kind === "error" ? "text-red-400" : kind === "offline" ? "text-orange-400" : kind === "saving" ? "text-amber-300" : "text-emerald-400";
  els.saveStatus.innerHTML = `<span class="${cls}">${escapeHtml(msg)}</span>`;
  if (clearAfterMs > 0 && kind !== "offline") saveIndicatorTimer = setTimeout(() => { els.saveStatus.innerHTML = ""; }, clearAfterMs);
}

function setActiveBadge() {
  if (els.activeWorkoutBadge) { els.activeWorkoutBadge.classList.toggle("hidden", !activeWorkoutRef); els.activeWorkoutBadge.textContent = activeWorkoutRef ? "IN PROGRESS" : ""; }
  if (els.saveTemplateBtn) els.saveTemplateBtn.classList.toggle("hidden", !activeWorkoutRef);
  if (els.updateTemplateBtn) els.updateTemplateBtn.classList.toggle("hidden", !(activeWorkoutRef && workoutState.templateId));
  els.workoutNotesWrap?.classList.toggle("hidden", !activeWorkoutRef);
}

function setAuthUI() {
  const signedIn = !!currentUser;
  els.signInBtn?.classList.toggle("hidden", signedIn);
  els.signOutBtn?.classList.toggle("hidden", !signedIn);
  if (els.startWorkoutBtn) els.startWorkoutBtn.disabled = !signedIn || !!activeWorkoutRef;
  if (els.finishWorkoutBtn) els.finishWorkoutBtn.disabled = !signedIn || !activeWorkoutRef;
}

function syncFocusUI() {
  document.querySelectorAll('input[name="workoutFocus"]').forEach(cb => { cb.checked = workoutState.focus.includes(cb.value); });
}

function resetWorkoutState(options = {}) {
  const clearLocal = options.clearLocal !== false;
  if (clearLocal) clearLocalDraft();
  activeWorkoutRef = null;
  workoutState.exercises = [];
  workoutState.templateId = null;
  workoutState.routineName = "Custom Workout";
  workoutState.focus = [];
  workoutState.notes = "";
  if (els.workoutNotesInput) els.workoutNotesInput.value = "";
  syncFocusUI();
  if (els.resumeDraftBtn) els.resumeDraftBtn.disabled = true;
  setActiveBadge();
  renderWorkoutBuilder();
}

// ==================== DRAFT & AUTOSAVE (Firestore + localStorage) ====================
function localDraftStorageKey(uid) {
  return uid ? `${LOCAL_DRAFT_KEY_PREFIX}${uid}` : null;
}

function clearLocalDraftForUid(uid) {
  const k = localDraftStorageKey(uid);
  if (!k) return;
  try { localStorage.removeItem(k); } catch (_) { /* quota / private mode */ }
}

function clearLocalDraft() {
  clearLocalDraftForUid(currentUser?.uid);
}

/** Snapshot for local backup (same device, survives refresh / offline). */
function buildLocalDraftSnapshot() {
  if (!activeWorkoutRef || !currentUser) return null;
  return {
    workoutId: activeWorkoutRef.id,
    updatedAtMs: Date.now(),
    exercises: JSON.parse(JSON.stringify(workoutState.exercises)),
    routineName: workoutState.routineName,
    focus: [...workoutState.focus],
    templateId: workoutState.templateId,
    date: els.dateInput?.value || todayISO(),
    unit: els.unitSelect?.value || "lb",
    notes: workoutState.notes || "",
  };
}

function writeLocalDraftSnapshot() {
  const k = localDraftStorageKey(currentUser?.uid);
  if (!k || !activeWorkoutRef) return;
  try {
    localStorage.setItem(k, JSON.stringify(buildLocalDraftSnapshot()));
  } catch (_) { /* quota */ }
}

function readLocalDraftSnapshot() {
  const k = localDraftStorageKey(currentUser?.uid);
  if (!k) return null;
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function fetchSortedDraftWorkouts() {
  if (!currentUser) return [];
  const q = query(collection(db, "users", currentUser.uid, "workouts"), where("status", "==", "draft"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
}

/** Creates a new draft document in Firestore (empty or with exercises); returns the DocumentReference. */
async function createWorkoutDraftInFirestore(initial = {}) {
  const docRef = await addDoc(collection(db, "users", currentUser.uid, "workouts"), {
    status: "draft",
    date: initial.date ?? els.dateInput?.value ?? todayISO(),
    unit: initial.unit ?? els.unitSelect?.value ?? "lb",
    exercises: initial.exercises ?? [],
    startedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
    routineName: initial.routineName ?? "Custom Workout",
    focus: initial.focus ?? [],
    templateId: initial.templateId ?? null,
    notes: initial.notes ?? "",
  });
  return doc(db, "users", currentUser.uid, "workouts", docRef.id);
}

/** Persists local snapshot first, then Firestore. On network failure, local copy still has latest edits. */
async function saveWorkoutDraft() {
  if (!activeWorkoutRef || !currentUser) return;
  writeLocalDraftSnapshot();
  setSaveIndicator("Saving…", "saving", 0);
  const payload = {
    status: "draft",
    exercises: workoutState.exercises,
    routineName: workoutState.routineName,
    focus: workoutState.focus,
    templateId: workoutState.templateId,
    date: els.dateInput?.value || todayISO(),
    unit: els.unitSelect?.value || "lb",
    notes: workoutState.notes || "",
    updatedAtMs: Date.now(),
  };
  try {
    await setDoc(activeWorkoutRef, payload, { merge: true });
    setSaveIndicator("Saved", "saved", 2200);
  } catch (e) {
    console.error("Draft cloud save failed", e);
    setSaveIndicator("Offline — draft saved on this device; will sync when you are back online", "offline", 0);
  }
}

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { saveWorkoutDraft().catch(() => {}); }, AUTOSAVE_DEBOUNCE_MS);
}

/** Apply in-memory state + UI from a draft row (Firestore shape). Re-merges local backup after cloud read so offline edits win when newer. */
async function loadWorkoutDraft(draftRow) {
  if (!currentUser || !draftRow?.id) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid, "workouts", draftRow.id));
  if (!snap.exists() || snap.data().status !== "draft") {
    setStatus("Draft no longer available.", "error");
    clearLocalDraft();
    await updateResumeDraftButtonState();
    return;
  }
  const cloud = { id: snap.id, ...snap.data() };
  const d = mergeLocalDraftIfNewer(cloud, readLocalDraftSnapshot());
  activeWorkoutRef = doc(db, "users", currentUser.uid, "workouts", d.id);
  workoutState.exercises = normalizeWorkoutExercisesArray(d.exercises);
  workoutState.templateId = d.templateId || null;
  workoutState.routineName = d.routineName || "Custom Workout";
  workoutState.focus = d.focus || [];
  workoutState.notes = d.notes || "";
  if (els.dateInput) els.dateInput.value = d.date || todayISO();
  if (els.unitSelect) els.unitSelect.value = d.unit || "lb";
  if (els.workoutNotesInput) els.workoutNotesInput.value = workoutState.notes;
  syncFocusUI();
  setActiveBadge();
  setAuthUI();
  renderWorkoutBuilder();
  await saveWorkoutDraft();
  await updateResumeDraftButtonState();
  setStatus("Workout resumed", "info");
}

/** Merge Firestore draft with newer local snapshot when IDs match (e.g. offline edits). */
function mergeLocalDraftIfNewer(cloudDraft, localSnap) {
  if (!localSnap || localSnap.workoutId !== cloudDraft.id) return cloudDraft;
  if ((localSnap.updatedAtMs || 0) <= (cloudDraft.updatedAtMs || 0)) return cloudDraft;
  return {
    ...cloudDraft,
    exercises: normalizeWorkoutExercisesArray(localSnap.exercises),
    routineName: localSnap.routineName,
    focus: localSnap.focus,
    templateId: localSnap.templateId,
    notes: localSnap.notes,
    date: localSnap.date,
    unit: localSnap.unit,
    updatedAtMs: localSnap.updatedAtMs,
  };
}

async function resolveDraftRowForResume() {
  const cloudList = await fetchSortedDraftWorkouts();
  const localSnap = readLocalDraftSnapshot();
  if (cloudList.length === 0) {
    if (!localSnap?.workoutId) return null;
    const s = await getDoc(doc(db, "users", currentUser.uid, "workouts", localSnap.workoutId));
    if (!s.exists() || s.data().status !== "draft") {
      clearLocalDraft();
      return null;
    }
    return mergeLocalDraftIfNewer({ id: s.id, ...s.data() }, localSnap);
  }
  let best = cloudList[0];
  best = mergeLocalDraftIfNewer(best, localSnap);
  return best;
}

async function updateResumeDraftButtonState() {
  if (!els.resumeDraftBtn) return;
  if (!currentUser) {
    els.resumeDraftBtn.disabled = true;
    return;
  }
  if (activeWorkoutRef) {
    els.resumeDraftBtn.disabled = true;
    return;
  }
  try {
    const cloudList = await fetchSortedDraftWorkouts();
    const localSnap = readLocalDraftSnapshot();
    els.resumeDraftBtn.disabled = cloudList.length === 0 && !(localSnap && localSnap.workoutId);
  } catch (_) {
    els.resumeDraftBtn.disabled = true;
  }
}

/** Delete only the targeted draft workout doc and clear the matching local backup. */
async function discardWorkoutDraft(workoutId = activeWorkoutRef?.id || null) {
  if (!currentUser || !workoutId) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "workouts", workoutId));
  const localSnap = readLocalDraftSnapshot();
  if (localSnap?.workoutId === workoutId) clearLocalDraft();
  if (activeWorkoutRef?.id === workoutId) {
    resetWorkoutState({ clearLocal: false });
    setAuthUI();
    setSaveIndicator("", "saved", 1);
  }
  setStatus("Draft discarded", "info");
}

/** Finish: same document becomes `final` — no duplicate completed rows. */
async function completeWorkoutFromDraft() {
  if (!activeWorkoutRef) return;
  if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
  const finalExercises = [];
  workoutState.exercises.forEach((ex) => {
    const validSets = ex.sets.filter((s) => {
      const r = parseInt(String(s.reps ?? ""), 10) || 0;
      const w = String(s.weight ?? "").trim();
      return r > 0 || w !== "";
    });
    if (validSets.length > 0) finalExercises.push({ ...ex, sets: validSets });
  });
  if (finalExercises.length === 0) {
    return setStatus("Add reps (or weight + reps) to at least one set to finish.", "error");
  }
  finalExercises.sort((a, b) => {
    const timeA = a.firstEditTime || a.addedAt || 0;
    const timeB = b.firstEditTime || b.addedAt || 0;
    return timeA - timeB;
  });
  if (els.finishWorkoutBtn) els.finishWorkoutBtn.disabled = true;
  setStatus("Finishing...", "info");
  try {
    await setDoc(activeWorkoutRef, {
      status: "final",
      finishedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      exercises: finalExercises,
      routineName: workoutState.routineName,
      focus: workoutState.focus,
      date: els.dateInput?.value || todayISO(),
      unit: els.unitSelect?.value || "lb",
      notes: workoutState.notes || "",
    }, { merge: true });
    invalidateFinalSetsCache();
    resetWorkoutAnalyticsCaches();
    await updatePRsAfterWorkout(finalExercises);
    clearLocalDraft();
    resetWorkoutState({ clearLocal: false });
    setStatus("Workout finished & PRs updated! 🎉", "info");
    setAuthUI();
    await updateResumeDraftButtonState();
    await loadAnalytics();
    await populateDropdowns();
    scheduleAnalyticsRefresh();
  } catch (e) {
    console.error(e);
    setStatus("Finish failed", "error");
  } finally {
    if (els.finishWorkoutBtn) els.finishWorkoutBtn.disabled = false;
  }
}

async function resumeLatestDraft() {
  if (!currentUser) return;
  try {
    els.draftRecoveryDialog?.close();
    const row = await resolveDraftRowForResume();
    if (!row) { setStatus("No draft to resume.", "error"); return; }
    await loadWorkoutDraft(row);
  } catch (e) {
    console.error(e);
    setStatus("Failed to resume draft", "error");
  }
}

async function offerDraftRecoveryIfNeeded() {
  if (!currentUser || activeWorkoutRef || draftRecoveryShownThisSession) return;
  await updateResumeDraftButtonState();
  const cloudList = await fetchSortedDraftWorkouts();
  const localSnap = readLocalDraftSnapshot();
  if (cloudList.length === 0 && !(localSnap && localSnap.workoutId)) return;
  draftRecoveryShownThisSession = true;
  const preview = cloudList[0];
  const parts = [];
  if (preview) {
    parts.push(`Last saved: ${new Date(preview.updatedAtMs || Date.now()).toLocaleString()}`);
    parts.push(`${(preview.exercises || []).length} exercise(s) in cloud draft.`);
  }
  if (localSnap && localSnap.workoutId) parts.push("A backup exists on this device (used if it is newer).");
  if (els.draftRecoveryText) els.draftRecoveryText.textContent = parts.join(" ");
  els.draftRecoveryDialog?.showModal();
}

// Focus + session fields trigger debounced save
document.querySelectorAll('input[name="workoutFocus"]').forEach(cb => {
  cb.addEventListener("change", () => {
    workoutState.focus = Array.from(document.querySelectorAll('input[name="workoutFocus"]:checked')).map(el => el.value);
    scheduleAutosave();
  });
});
els.dateInput?.addEventListener("change", () => scheduleAutosave());
els.unitSelect?.addEventListener("change", () => scheduleAutosave());
els.workoutNotesInput?.addEventListener("input", () => {
  workoutState.notes = els.workoutNotesInput.value;
  scheduleAutosave();
});

els.resumeDraftBtn?.addEventListener("click", () => resumeLatestDraft());
els.draftRecoveryResume?.addEventListener("click", () => resumeLatestDraft());
els.draftRecoveryDiscard?.addEventListener("click", async () => {
  try {
    els.draftRecoveryDiscard.disabled = true;
    const row = await resolveDraftRowForResume();
    if (!row?.id) {
      clearLocalDraft();
      els.draftRecoveryDialog?.close();
      await updateResumeDraftButtonState();
      return;
    }
    await discardWorkoutDraft(row.id);
    els.draftRecoveryDialog?.close();
    await updateResumeDraftButtonState();
  } catch (e) {
    console.error(e);
    setStatus("Could not discard draft", "error");
  } finally {
    els.draftRecoveryDiscard.disabled = false;
  }
});

window.addEventListener("online", () => {
  if (activeWorkoutRef && currentUser) saveWorkoutDraft().catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && activeWorkoutRef) {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    writeLocalDraftSnapshot();
    saveWorkoutDraft().catch(() => {});
  }
});

// ==================== FAVORITE EXERCISES (Firestore user doc + localStorage backup) ====================
const FAVORITE_LS_PREFIX = "k2_favorite_exercise_ids_v1:";
let favoriteExerciseIdSet = new Set();
let favoritePersistTimer = null;

function readLocalFavoriteIds(uid) {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(FAVORITE_LS_PREFIX + uid);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(id => typeof id === "string") : [];
  } catch (_) {
    return [];
  }
}

function writeLocalFavoriteIds(uid, ids) {
  if (!uid) return;
  try {
    localStorage.setItem(FAVORITE_LS_PREFIX + uid, JSON.stringify([...ids]));
  } catch (_) { /* quota */ }
}

/** Merge cloud + local id lists (union), persist both when cloud was missing entries. */
async function initFavoriteExercisesForUser() {
  if (!currentUser) {
    favoriteExerciseIdSet = new Set();
    return;
  }
  const localIds = readLocalFavoriteIds(currentUser.uid);
  let cloudIds = [];
  try {
    const u = await getDoc(doc(db, "users", currentUser.uid));
    if (u.exists() && Array.isArray(u.data().favoriteExerciseIds)) {
      cloudIds = u.data().favoriteExerciseIds.filter(id => typeof id === "string");
    }
  } catch (_) { /* offline */ }
  const merged = [...new Set([...cloudIds, ...localIds])];
  favoriteExerciseIdSet = new Set(merged);
  writeLocalFavoriteIds(currentUser.uid, merged);
  if (merged.length !== cloudIds.length || merged.some((id, i) => id !== cloudIds[i])) {
    try {
      await setDoc(doc(db, "users", currentUser.uid), { favoriteExerciseIds: merged }, { merge: true });
    } catch (_) { /* offline: local backup only */ }
  }
}

function scheduleFavoritePersist() {
  if (!currentUser) return;
  if (favoritePersistTimer) clearTimeout(favoritePersistTimer);
  favoritePersistTimer = setTimeout(async () => {
    favoritePersistTimer = null;
    const ids = [...favoriteExerciseIdSet];
    writeLocalFavoriteIds(currentUser.uid, ids);
    try {
      await setDoc(doc(db, "users", currentUser.uid), { favoriteExerciseIds: ids }, { merge: true });
    } catch (e) {
      console.error("Favorite sync failed", e);
    }
  }, 500);
}

function toggleFavoriteExercise(exerciseId) {
  if (!exerciseId) return;
  if (favoriteExerciseIdSet.has(exerciseId)) favoriteExerciseIdSet.delete(exerciseId);
  else favoriteExerciseIdSet.add(exerciseId);
  scheduleFavoritePersist();
}

function isExerciseFavorite(exerciseId) {
  return favoriteExerciseIdSet.has(exerciseId);
}

/** Ensure each exercise row has exerciseNote for older saved workouts. */
function normalizeWorkoutExercisesArray(arr) {
  return (arr || []).map(ex => ({ ...ex, exerciseNote: ex.exerciseNote != null ? String(ex.exerciseNote) : "" }));
}

window.addEventListener("beforeunload", () => {
  if (activeWorkoutRef && currentUser) {
    try { localStorage.setItem(localDraftStorageKey(currentUser.uid), JSON.stringify(buildLocalDraftSnapshot())); } catch (_) { /* ignore */ }
  }
});

// ==================== AUTH ====================
els.signInBtn?.addEventListener("click", async () => { try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { console.error("FIREBASE AUTH ERROR:", e); setStatus("Sign-in failed.", "error"); } });
els.signOutBtn?.addEventListener("click", () => signOut(auth));

async function runBootstrapStep(label, task) {
  try {
    return await task();
  } catch (e) {
    console.error(`Bootstrap step failed: ${label}`, e);
    return null;
  }
}

onAuthStateChanged(auth, async (user) => {
  const prevUser = currentUser;
  currentUser = user || null;
  invalidateFinalSetsCache();
  if (els.userLabel) els.userLabel.textContent = currentUser ? currentUser.displayName || currentUser.email : "";
  if (prevUser && !currentUser) clearLocalDraftForUid(prevUser.uid);
  draftRecoveryShownThisSession = false;
  if (!currentUser) {
    favoriteExerciseIdSet = new Set();
    resetWorkoutAnalyticsCaches();
    resetWorkoutState({ clearLocal: false });
    setAuthUI();
    if (els.templatesList) els.templatesList.innerHTML = `<div class="text-zinc-500 text-sm">Sign in to see routines.</div>`;
    return;
  }
  await runBootstrapStep("lastSeen", () =>
    setDoc(doc(db, "users", currentUser.uid), { lastSeen: serverTimestamp() }, { merge: true })
  );
  await runBootstrapStep("favorites", () => initFavoriteExercisesForUser());
  runBootstrapStep("prs listener", async () => listenToPRs());
  runBootstrapStep("analytics", () => loadAnalytics());
  runBootstrapStep("templates", () => loadTemplates());
  setAuthUI();
  setActiveBadge();
  renderWorkoutBuilder();
  await runBootstrapStep("dropdowns", () => populateDropdowns());
  await runBootstrapStep("resume button", () => updateResumeDraftButtonState());
  await runBootstrapStep("draft recovery", () => offerDraftRecoveryIfNeeded());
  if (els.searchInput && !normalizeSearchText(els.searchInput.value)) {
    await runBootstrapStep("search bootstrap", () => searchExercises(""));
  }
});

// ==================== SEARCH & EXERCISES ====================
// Old behavior used Firestore `keywords array-contains <entire query>` plus prefix range on custom names.
// That only matched when a keyword entry equaled the full typed string (no typos / singular-plural / partial phrases).
// We score the full catalog in memory (cached after first load) with normalized text, per-token matching, plural
// hints, Levenshtein fuzzy scores, and a small alias map—then sort by relevance.

/** Lowercase, trim, collapse whitespace, strip most punctuation for comparison */
function normalizeSearchText(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokenize(s) {
  return normalizeSearchText(s).split(/\s+/).filter(Boolean);
}

/** Common abbreviations → extra terms scored against the exercise (no DB changes). */
const SEARCH_ALIAS_EXPANSIONS = {
  rdl: "romanian deadlift",
  ohp: "overhead press",
  bb: "barbell",
  db: "dumbbell",
  kb: "kettlebell",
  tbar: "t bar",
  cgbp: "close grip bench",
};

function expandQueryWithAliases(normalizedQuery) {
  const parts = [normalizedQuery];
  for (const tok of searchTokenize(normalizedQuery)) {
    if (SEARCH_ALIAS_EXPANSIONS[tok]) parts.push(SEARCH_ALIAS_EXPANSIONS[tok]);
  }
  return normalizeSearchText(parts.join(" "));
}

/** Classic Levenshtein distance; word lengths stay small so this stays cheap */
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

/** Singular/plural-style variants for a token (lightweight English heuristics) */
function morphVariants(tok) {
  const out = new Set([tok]);
  if (tok.length >= 4 && tok.endsWith("ies")) out.add(tok.slice(0, -3) + "y");
  if (tok.length >= 4 && tok.endsWith("es") && !tok.endsWith("ses")) {
    out.add(tok.slice(0, -2));
    out.add(tok.slice(0, -1));
  }
  if (tok.length >= 3 && tok.endsWith("s") && !tok.endsWith("ss")) out.add(tok.slice(0, -1));
  if (tok.length >= 3 && !tok.endsWith("s")) out.add(tok + "s");
  return [...out];
}

function scoreQueryTokenAgainstWord(qt, w) {
  if (!qt || !w) return 0;
  if (qt.length === 1) return w === qt ? 5200 : 0;
  if (w === qt) return 10000;
  if (w.startsWith(qt)) return 8800;
  if (w.includes(qt)) return 7600;
  const variants = new Set([...morphVariants(qt), ...morphVariants(w)]);
  for (const v of variants) {
    if (v === w || w === v) return 9200;
    if (w.startsWith(v) || v.startsWith(w)) return 8400;
    if (w.includes(v) || v.includes(w)) return 7200;
  }
  const d = levenshtein(qt, w);
  const maxL = Math.max(qt.length, w.length);
  if (maxL <= 5 && d === 1) return 6800;
  if (maxL <= 10 && d <= 2) return 5600 - d * 180;
  if (maxL <= 16 && d <= 3) return 4000 - d * 220;
  return 0;
}

/** One query token vs. all distinct words in the exercise + substring in full haystack */
function bestScoreForQueryToken(qt, wordSet, haystack) {
  let best = 0;
  const alias = SEARCH_ALIAS_EXPANSIONS[qt];
  if (alias) {
    const subTokens = searchTokenize(alias);
    const subScores = subTokens.map(st => {
      let s = 0;
      for (const w of wordSet) s = Math.max(s, scoreQueryTokenAgainstWord(st, w));
      if (haystack.includes(st)) s = Math.max(s, 8000);
      return s;
    });
    if (subScores.length) {
      const combined = Math.min(...subScores) * 0.35 + (subScores.reduce((a, b) => a + b, 0) / subScores.length) * 0.65;
      best = Math.max(best, combined);
    }
  }
  for (const w of wordSet) best = Math.max(best, scoreQueryTokenAgainstWord(qt, w));
  if (haystack.includes(qt)) best = Math.max(best, 8600);
  return best;
}

/**
 * Full-string bonuses (exact / prefix / contains) plus per-token scores.
 * Each token must clear a floor (min score) or the row is dropped—reduces unrelated hits.
 */
function scoreExerciseAgainstQuery(expandedQueryNorm, exerciseName, keywordList) {
  const nameNorm = normalizeSearchText(exerciseName);
  const kwFlat = (keywordList || []).map(k => normalizeSearchText(String(k))).join(" ");
  const haystack = `${nameNorm} ${kwFlat}`;
  const words = new Set(searchTokenize(`${nameNorm} ${kwFlat}`));
  const qTokens = searchTokenize(expandedQueryNorm);
  if (!qTokens.length) return 0;

  let score = 0;
  if (nameNorm === expandedQueryNorm) score += 200000;
  else if (nameNorm.startsWith(expandedQueryNorm)) score += 120000;
  else if (nameNorm.includes(expandedQueryNorm)) score += 90000;

  const tokenScores = qTokens.map(qt => bestScoreForQueryToken(qt, words, haystack));
  const minTok = Math.min(...tokenScores);
  const avgTok = tokenScores.reduce((a, b) => a + b, 0) / tokenScores.length;
  if (minTok < 2000) return 0;
  score += avgTok * 10 + minTok * 5;
  score -= nameNorm.length * 0.15;
  return score;
}

const CATALOG_KEYWORD_HIT_LIMIT = 80;
const CATALOG_FALLBACK_LIMIT = 140;
const CUSTOM_EXERCISE_CAP = 200;

/**
 * Bounded catalog reads: keyword intersection when possible, otherwise a capped scan.
 * Avoids loading the entire `catalog_exercises` collection into the browser.
 */
async function fetchCatalogDocsForSearch(expandedNorm) {
  const tokens = searchTokenize(expandedNorm).slice(0, 10);
  const byId = new Map();
  if (tokens.length) {
    try {
      const qKw = query(
        collection(db, "catalog_exercises"),
        where("keywords", "array-contains-any", tokens),
        limit(CATALOG_KEYWORD_HIT_LIMIT)
      );
      const snap = await getDocs(qKw);
      snap.forEach((d) => byId.set(d.id, d));
    } catch (_) {
      /* Missing index or field — fall back below */
    }
  }
  if (byId.size < 12) {
    const qFb = query(collection(db, "catalog_exercises"), limit(CATALOG_FALLBACK_LIMIT));
    const snap2 = await getDocs(qFb);
    snap2.forEach((d) => byId.set(d.id, d));
  }
  return [...byId.values()];
}

/** Final scores combine token scores × weighting + substring bonuses (~30k for the weakest match that still passes per-token floor). */
const SEARCH_MIN_SCORE = 30000;

/** Map exercise id → display meta for favorites strip (no duplicate exercise rows). */
async function buildExerciseMetaMap() {
  const map = new Map();
  const customSnap = await getDocs(
    query(collection(db, "users", currentUser.uid, "custom_exercises"), limit(CUSTOM_EXERCISE_CAP))
  );
  customSnap.forEach((d) => {
    map.set(d.id, { name: d.data().name, subtitle: "Custom Exercise", isCustom: true });
  });
  const favCatalogIds = [...favoriteExerciseIdSet].filter((id) => !map.has(id)).slice(0, 50);
  await Promise.all(
    favCatalogIds.map(async (id) => {
      try {
        const s = await getDoc(doc(db, "catalog_exercises", id));
        if (!s.exists()) return;
        const data = s.data();
        map.set(s.id, { name: data.name, subtitle: (data.equipmentNames || []).join(", "), isCustom: false });
      } catch (_) { /* offline */ }
    })
  );
  return map;
}

/** When search box is empty: show starred exercises at top (still one row per id). */
async function renderFavoritesSectionOnly() {
  if (!els.searchResults || !currentUser) return;
  els.searchResults.innerHTML = "";
  if (favoriteExerciseIdSet.size === 0) {
    els.searchResults.innerHTML = `<div class="text-zinc-500">Type to search the exercise library.</div>`;
    return;
  }
  const metaMap = await buildExerciseMetaMap();
  const head = document.createElement("div");
  head.className = "text-xs font-bold text-amber-400/90 uppercase tracking-wider mb-3 flex items-center gap-2";
  head.innerHTML = `<i class="fa-solid fa-star"></i> Favorites`;
  els.searchResults.appendChild(head);
  let n = 0;
  for (const id of favoriteExerciseIdSet) {
    const m = metaMap.get(id);
    if (m) {
      renderSearchItem(id, m.name, m.subtitle, m.isCustom);
      n++;
    }
  }
  if (n === 0) {
    els.searchResults.innerHTML = `<div class="text-zinc-500">Favorite exercises are loading or IDs are outdated — try a search.</div>`;
    return;
  }
  const hint = document.createElement("div");
  hint.className = "text-zinc-500 text-xs mt-4 pt-4 border-t border-zinc-800";
  hint.textContent = "Type above to search the full library.";
  els.searchResults.appendChild(hint);
}

els.searchBtn?.addEventListener("click", () => searchExercises(els.searchInput.value));
els.searchInput?.addEventListener("keydown", e => e.key === "Enter" && searchExercises(els.searchInput.value));

async function searchExercises(term) {
  if (!els.searchResults || !currentUser) return;
  els.searchResults.innerHTML = `<div class="text-zinc-500">Searching...</div>`;
  const t = normalizeSearchText(term);
  if (!t) {
    await renderFavoritesSectionOnly();
    return;
  }

  try {
    const expanded = expandQueryWithAliases(t);
    const [catalogDocs, customSnap] = await Promise.all([
      fetchCatalogDocsForSearch(expanded),
      getDocs(query(collection(db, "users", currentUser.uid, "custom_exercises"), limit(CUSTOM_EXERCISE_CAP))),
    ]);
    const ranked = [];
    catalogDocs.forEach((d) => {
      const data = d.data();
      const sc = scoreExerciseAgainstQuery(expanded, data.name, data.keywords || []);
      if (sc >= SEARCH_MIN_SCORE) {
        ranked.push({
          id: d.id,
          name: data.name,
          subtitle: (data.equipmentNames || []).join(", "),
          isCustom: false,
          score: sc,
        });
      }
    });
    customSnap.forEach(d => {
      const data = d.data();
      const sc = scoreExerciseAgainstQuery(expanded, data.name, [data.nameLower || "", data.name || ""]);
      if (sc >= SEARCH_MIN_SCORE) {
        ranked.push({
          id: d.id,
          name: data.name,
          subtitle: "Custom Exercise",
          isCustom: true,
          score: sc,
        });
      }
    });
    ranked.sort((a, b) => {
      const fa = favoriteExerciseIdSet.has(a.id) ? 1 : 0;
      const fb = favoriteExerciseIdSet.has(b.id) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return b.score - a.score;
    });
    const top = ranked.slice(0, 40);
    els.searchResults.innerHTML = "";

    if (top.length === 0) {
      els.searchResults.innerHTML = `
        <div class="text-zinc-400 text-sm mb-3">No exercises found. Create a personal exercise!</div>
        <button id="addCustomExBtn" class="w-full bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/50 py-3 rounded-xl font-medium transition-colors">
          + Save Custom: "${escapeHtml(term)}"
        </button>
      `;
      document.getElementById("addCustomExBtn").onclick = async () => {
        try {
          const newRef = await addDoc(collection(db, "users", currentUser.uid, "custom_exercises"), { name: term, nameLower: t, createdAt: serverTimestamp() });
          addExerciseToWorkout(newRef.id, term);
          els.searchResults.innerHTML = `<div class="text-emerald-400 text-sm">Saved to personal library!</div>`; els.searchInput.value = "";
        } catch(e) { setStatus("Failed to save custom exercise.", "error"); }
      };
      return;
    }
    top.forEach(row => renderSearchItem(row.id, row.name, row.subtitle, row.isCustom));
  } catch (e) { els.searchResults.innerHTML = `<div class="text-red-400">Search failed.</div>`; }
}

function renderSearchItem(id, name, subtitle, isCustom) {
    const div = document.createElement("div");
    div.className = "flex justify-between items-center gap-2 p-4 bg-zinc-800 rounded-xl hover:bg-zinc-700 border border-zinc-700 transition-colors";
    const fav = isExerciseFavorite(id);
    const starCls = fav ? "text-amber-400" : "text-zinc-500";
    const starSolid = fav ? "fa-solid" : "fa-regular";
    let html = `<button type="button" class="fav-star shrink-0 w-9 h-9 rounded-lg border border-zinc-600 hover:bg-zinc-900 flex items-center justify-center ${starCls}" title="${fav ? "Remove from favorites" : "Add to favorites"}"><i class="fa-star ${starSolid}"></i></button>`;
    html += `<div class="cursor-pointer flex-1 min-w-0" onclick="window.triggerAdd('${id}', '${name.replace(/'/g, "\\'")}')"><div class="font-medium text-zinc-100">${escapeHtml(name)}</div><div class="text-xs text-zinc-400">${escapeHtml(subtitle)}</div></div>`;
    if (isCustom) html += `<button class="deleteCustomBtn text-zinc-500 hover:text-red-500 px-3 py-1 transition-colors" data-id="${id}"><i class="fa-solid fa-trash"></i></button>`;
    div.innerHTML = html;
    div.querySelector(".fav-star").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavoriteExercise(id);
      searchExercises(els.searchInput.value);
    });
    if (isCustom) {
        div.querySelector(".deleteCustomBtn").onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Delete custom exercise "${name}"?`)) {
              favoriteExerciseIdSet.delete(id);
              writeLocalFavoriteIds(currentUser.uid, [...favoriteExerciseIdSet]);
              try { await setDoc(doc(db, "users", currentUser.uid), { favoriteExerciseIds: [...favoriteExerciseIdSet] }, { merge: true }); } catch (_) {}
              await deleteDoc(doc(db, "users", currentUser.uid, "custom_exercises", id));
              searchExercises(els.searchInput.value);
            }
        };
    }
    els.searchResults.appendChild(div);
}

window.triggerAdd = function(id, name) { addExerciseToWorkout(id, name); };

function addExerciseToWorkout(id, name) {
  if (!activeWorkoutRef) return setStatus("Start a workout first!", "error");
  if (workoutState.exercises.some(e => e.exerciseId === id)) return setStatus("Already added");
  const exerciseEntry = { exerciseId: id, name, exerciseNote: "", sets: [{weight:"", reps:"", rpe:""}], lastSets: [], addedAt: Date.now(), firstEditTime: null, lastEditTime: null };
  workoutState.exercises.push(exerciseEntry);
  renderWorkoutBuilder(); populateDropdowns(); scheduleAutosave();
  fetchLastFinalSetsForExerciseSafe(id).then(ls => {
    if (!workoutState.exercises.includes(exerciseEntry)) return;
    exerciseEntry.lastSets = ls;
    renderWorkoutBuilder();
    scheduleAutosave();
  });
}

async function findOrCreateExerciseId(name) {
    if (!currentUser) return null;
    const t = normalizeSearchText(name);
    const cQ = query(collection(db, "users", currentUser.uid, "custom_exercises"), where("nameLower", "==", t));
    const cS = await getDocs(cQ);
    if (!cS.empty) return { id: cS.docs[0].id, name: cS.docs[0].data().name };
    const expanded = expandQueryWithAliases(t);
    const catDocs = await fetchCatalogDocsForSearch(expanded);
    let best = null;
    let bestScore = -1;
    catDocs.forEach((docSnap) => {
      const data = docSnap.data();
      const sc = scoreExerciseAgainstQuery(expanded, data.name, data.keywords || []);
      if (sc > bestScore) {
        bestScore = sc;
        best = { id: docSnap.id, name: data.name };
      }
    });
    const FIND_OR_CREATE_MIN_SCORE = 30000;
    if (best && bestScore >= FIND_OR_CREATE_MIN_SCORE) return best;
    const newRef = await addDoc(collection(db, "users", currentUser.uid, "custom_exercises"), { name: name.trim(), nameLower: t, createdAt: serverTimestamp() });
    return { id: newRef.id, name: name.trim() };
}

/** Clears cached “last sets” reads and chart workout sample after workout/PR changes. */
function invalidateFinalSetsCache() {
  chartWorkoutsSample = [];
  chartWorkoutsLoadPromise = null;
}

async function fetchLastFinalSetsForExerciseSafe(exerciseId) {
  if (!currentUser || !exerciseId) return [];
  try {
    const r = await getDoc(doc(db, "users", currentUser.uid, "exercise_last_sets", exerciseId));
    if (r.exists()) {
      const sets = r.data()?.sets;
      if (Array.isArray(sets) && sets.length) return sets;
    }
  } catch (_) { /* offline */ }
  try {
    const q = query(
      collection(db, "users", currentUser.uid, "workouts"),
      where("status", "==", "final"),
      orderBy("updatedAtMs", "desc"),
      limit(45)
    );
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const w = d.data();
      for (const ex of w.exercises || []) {
        if (ex.exerciseId === exerciseId && ex?.sets?.length) return ex.sets;
      }
    }
  } catch (_) { /* missing composite index until deployed */ }
  return [];
}

// ==================== SECURE AI GENERATOR ====================
function clearAiError() {
  if (!els.aiErrorBanner) return;
  els.aiErrorBanner.textContent = "";
  els.aiErrorBanner.classList.add("hidden");
}

function showAiError(msg) {
  const text = msg || "Something went wrong.";
  if (els.aiErrorBanner) {
    els.aiErrorBanner.textContent = text;
    els.aiErrorBanner.classList.remove("hidden");
  } else {
    alert(text);
  }
}

els.openAiModalBtn?.addEventListener("click", () => {
  if (!currentUser) return alert("Please sign in to use the AI Generator.");
  if (activeWorkoutRef && !confirm("You have an active workout in progress. Overwrite it with a new AI routine?")) return;
  clearAiError();
  els.aiModal?.showModal();
});
els.closeAiModalBtn?.addEventListener("click", () => els.aiModal?.close());

els.generateAiBtn?.addEventListener("click", async () => {
  const prompt = (els.aiPromptInput?.value || "").trim();
  if (!prompt) {
    showAiError("Enter a workout prompt first.");
    return;
  }
  if (prompt.length > AI_PROMPT_MAX_LENGTH) {
    showAiError(`Keep the prompt under ${AI_PROMPT_MAX_LENGTH} characters.`);
    return;
  }
  clearAiError();
  try {
    els.generateAiBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Generating...`;
    els.generateAiBtn.disabled = true;
    const generateRoutine = httpsCallable(functions, "generateAiRoutine");
    const response = await generateRoutine({ prompt });
    const payload = response.data;
    if (!payload || typeof payload !== "object") {
      showAiError("Unexpected response from the server. Try again later.");
      return;
    }
    if (!payload.ok || !Array.isArray(payload.exercises) || payload.exercises.length === 0) {
      showAiError(payload.error || "We could not build a routine from that prompt.");
      return;
    }
    const aiExercises = payload.exercises;
    els.generateAiBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading Exercises...`;
    const targetWorkoutRef = activeWorkoutRef || await createWorkoutDraftInFirestore({
      exercises: [],
      date: todayISO(),
      unit: els.unitSelect?.value || "lb",
    });
    const newExercises = [];
    for (const aiEx of aiExercises) {
      const dbMatch = await findOrCreateExerciseId(aiEx.name);
      const generatedSets = [];
      const numSets = Number(aiEx.sets) || 3;
      for (let i = 0; i < numSets; i++) generatedSets.push({ weight: "", reps: String(aiEx.reps || "10"), rpe: "" });
      newExercises.push({
        exerciseId: dbMatch.id,
        name: dbMatch.name,
        exerciseNote: "",
        sets: generatedSets,
        lastSets: await fetchLastFinalSetsForExerciseSafe(dbMatch.id),
        addedAt: Date.now(),
        firstEditTime: null,
        lastEditTime: null,
      });
    }
    activeWorkoutRef = targetWorkoutRef;
    workoutState.exercises = newExercises;
    workoutState.templateId = null;
    workoutState.routineName = "AI Generated Routine";
    workoutState.focus = [];
    workoutState.notes = "";
    if (els.workoutNotesInput) els.workoutNotesInput.value = "";
    syncFocusUI();
    await saveWorkoutDraft();
    els.aiModal?.close();
    if (els.aiPromptInput) els.aiPromptInput.value = "";
    clearAiError();
    setActiveBadge();
    setAuthUI();
    renderWorkoutBuilder();
    await updateResumeDraftButtonState();
    setStatus("AI routine generated", "info");
  } catch (e) {
    console.error("AI Generation Error", e);
    const msg = e?.message || "Failed to generate AI routine.";
    showAiError(/resource-exhausted|too-many-requests|unauthenticated|invalid-argument/i.test(String(e?.code || msg)) ? msg : `${msg} If this persists, confirm the function is deployed and configured.`);
  } finally {
    els.generateAiBtn.innerHTML = `Generate Routine`;
    els.generateAiBtn.disabled = false;
  }
});

// ==================== TEMPLATES ====================
let currentEditTemplateId = null; let currentEditTemplateExercises = [];
async function loadTemplates() {
    if (!currentUser || !els.templatesList) return;
    try {
        const q = query(collection(db, "users", currentUser.uid, "templates"), limit(100));
        const snap = await getDocs(q);
        els.templatesList.innerHTML = "";
        if(snap.empty) { els.templatesList.innerHTML = `<div class="text-zinc-500 text-sm">No routines saved yet.</div>`; return; }
        snap.forEach(d => {
            const template = d.data(); const div = document.createElement("div"); div.className = "bg-zinc-800 p-4 rounded-xl border border-zinc-700 flex justify-between items-center hover:border-indigo-500/50 transition-colors group";
            div.innerHTML = `<div class="flex-1 pr-4"><div class="font-bold text-zinc-100 group-hover:text-indigo-400 transition-colors">${escapeHtml(template.name)}</div><div class="text-xs text-zinc-400 mt-1">${(template.exercises || []).map(e => e.name).join(", ").substring(0, 40)}...</div></div><div class="flex items-center gap-2"><button class="editTemplateBtn text-zinc-400 hover:text-white px-3 py-2 rounded-lg bg-zinc-700/50 hover:bg-zinc-700 transition-colors border border-zinc-700"><i class="fa-solid fa-pen"></i></button><button class="startTemplateBtn bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-indigo-900/20 transition-colors">Start</button></div>`;
            div.querySelector(".startTemplateBtn").onclick = () => startWorkoutFromTemplate(d.id, template); div.querySelector(".editTemplateBtn").onclick = () => openTemplateEditModal(d.id, template);
            els.templatesList.appendChild(div);
        });
    } catch (e) {}
}

function openTemplateEditModal(id, template) { currentEditTemplateId = id; els.editTemplateName.value = template.name; currentEditTemplateExercises = [...(template.exercises || [])]; renderEditTemplateExercises(); els.templateModal.showModal(); }
function renderEditTemplateExercises() {
    els.editTemplateExercises.innerHTML = ""; if (currentEditTemplateExercises.length === 0) { els.editTemplateExercises.innerHTML = `<div class="text-zinc-500 text-sm">No exercises.</div>`; return; }
    currentEditTemplateExercises.forEach((ex, idx) => {
        const div = document.createElement("div"); div.className = "flex justify-between items-center bg-zinc-800 border border-zinc-700 p-3 rounded-lg";
        div.innerHTML = `<span class="text-sm font-medium text-zinc-200">${escapeHtml(ex.name)}</span><button class="text-red-400 hover:text-red-300 px-3 py-1 bg-red-400/10 rounded border border-red-400/20"><i class="fa-solid fa-minus"></i></button>`;
        div.querySelector("button").onclick = () => { currentEditTemplateExercises.splice(idx, 1); renderEditTemplateExercises(); }; els.editTemplateExercises.appendChild(div);
    });
}
els.saveTemplateChangesBtn?.addEventListener("click", async () => {
    if (!currentEditTemplateId || !currentUser) return; const newName = els.editTemplateName.value.trim(); if (!newName) return alert("Name cannot be empty.");
    try { els.saveTemplateChangesBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`; els.saveTemplateChangesBtn.disabled = true; await updateDoc(doc(db, "users", currentUser.uid, "templates", currentEditTemplateId), { name: newName, exercises: currentEditTemplateExercises }); els.templateModal.close(); loadTemplates(); setStatus("Routine updated", "info"); } catch (e) { alert("Failed to save changes."); } finally { els.saveTemplateChangesBtn.innerHTML = `Save Changes`; els.saveTemplateChangesBtn.disabled = false; }
});
els.deleteTemplateModalBtn?.addEventListener("click", async () => {
    if (!currentEditTemplateId || !currentUser) return;
    if (confirm("Permanently delete this routine?")) {
        try { els.deleteTemplateModalBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`; els.deleteTemplateModalBtn.disabled = true; await deleteDoc(doc(db, "users", currentUser.uid, "templates", currentEditTemplateId)); els.templateModal.close(); loadTemplates(); setStatus("Routine deleted", "info"); } catch (e) { alert("Failed to delete."); } finally { els.deleteTemplateModalBtn.innerHTML = `<i class="fa-solid fa-trash"></i>`; els.deleteTemplateModalBtn.disabled = false; }
    }
});
els.closeTemplateModalBtn?.addEventListener("click", () => els.templateModal.close());

els.saveTemplateBtn?.addEventListener("click", async () => {
    if (!currentUser || !activeWorkoutRef || workoutState.exercises.length === 0) return setStatus("Add exercises to save a routine.", "error");
    const name = prompt("Name your routine (e.g., 'Leg Day', 'Upper Body'):"); if (!name || !name.trim()) return;
    try { const templateExercises = workoutState.exercises.map(ex => ({ exerciseId: ex.exerciseId, name: ex.name })); const docRef = await addDoc(collection(db, "users", currentUser.uid, "templates"), { name: name.trim(), exercises: templateExercises, createdAt: serverTimestamp() }); workoutState.templateId = docRef.id; setActiveBadge(); setStatus("Routine saved successfully!", "info"); loadTemplates(); } catch(e) { setStatus("Failed to save routine.", "error"); }
});

els.updateTemplateBtn?.addEventListener("click", async () => {
    if (!currentUser || !activeWorkoutRef || !workoutState.templateId) return;
    try { els.updateTemplateBtn.disabled = true; els.updateTemplateBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating...`; const templateExercises = workoutState.exercises.map(ex => ({ exerciseId: ex.exerciseId, name: ex.name })); await updateDoc(doc(db, "users", currentUser.uid, "templates", workoutState.templateId), { exercises: templateExercises }); setStatus("Routine updated!", "info"); loadTemplates(); } catch(e) { setStatus("Failed to update routine.", "error"); } finally { els.updateTemplateBtn.disabled = false; els.updateTemplateBtn.innerHTML = `Update Routine`; }
});

async function startWorkoutFromTemplate(templateId, template) {
    if (!currentUser) return;
    if (activeWorkoutRef && !confirm("You have an active workout. Discard it and start this routine?")) return;
    try {
        setStatus("Starting Routine...");
        if (els.startWorkoutBtn) els.startWorkoutBtn.disabled = true;
        if (activeWorkoutRef) { await deleteDoc(activeWorkoutRef); clearLocalDraft(); }
        const newExercises = template.exercises.map(ex => ({ exerciseId: ex.exerciseId, name: ex.name, exerciseNote: "", sets: [{weight: "", reps: "", rpe: ""}], lastSets: [], addedAt: Date.now(), firstEditTime: null, lastEditTime: null }));
        activeWorkoutRef = await createWorkoutDraftInFirestore({
          exercises: newExercises,
          templateId,
          routineName: template.name,
          date: els.dateInput?.value || todayISO(),
          unit: els.unitSelect?.value || "lb",
        });
        workoutState.exercises = newExercises;
        workoutState.templateId = templateId;
        workoutState.routineName = template.name;
        workoutState.focus = [];
        workoutState.notes = "";
        if (els.workoutNotesInput) els.workoutNotesInput.value = "";
        syncFocusUI();
        setActiveBadge();
        setAuthUI();
        renderWorkoutBuilder();
        await Promise.all(
          workoutState.exercises.map(async (ex) => {
            ex.lastSets = await fetchLastFinalSetsForExerciseSafe(ex.exerciseId);
          })
        );
        renderWorkoutBuilder();
        await saveWorkoutDraft();
        await updateResumeDraftButtonState();
        setStatus("Routine started ✓");
    } catch (e) { setStatus("Failed to start routine.", "error"); } finally { if (els.startWorkoutBtn) els.startWorkoutBtn.disabled = false; }
}

// ==================== WORKOUT FLOW & UI ====================
els.startWorkoutBtn?.addEventListener("click", async () => {
  if (!currentUser || activeWorkoutRef) return;
  try {
    setStatus("Starting...");
    els.startWorkoutBtn.disabled = true;
    activeWorkoutRef = await createWorkoutDraftInFirestore({
      exercises: [],
      date: els.dateInput?.value || todayISO(),
      unit: els.unitSelect?.value || "lb",
      routineName: "Custom Workout",
    });
    workoutState.exercises = [];
    workoutState.templateId = null;
    workoutState.routineName = "Custom Workout";
    workoutState.focus = [];
    workoutState.notes = "";
    if (els.workoutNotesInput) els.workoutNotesInput.value = "";
    syncFocusUI();
    await saveWorkoutDraft();
    setActiveBadge();
    setAuthUI();
    renderWorkoutBuilder();
    await updateResumeDraftButtonState();
    setStatus("Workout started ✓");
  } catch (e) {
    setStatus("Failed to start workout.", "error");
  } finally {
    if (els.startWorkoutBtn) els.startWorkoutBtn.disabled = false;
  }
});

els.finishWorkoutBtn?.addEventListener("click", () => completeWorkoutFromDraft());

function renderWorkoutBuilder() {
  if (!els.workoutExercises) return; els.workoutExercises.innerHTML = "";
  if (!currentUser) { els.workoutExercises.innerHTML = `<div class="text-zinc-500 text-center py-8">Sign in to start a workout.</div>`; return; }
  if (!activeWorkoutRef) { els.workoutExercises.innerHTML = `<div class="text-zinc-500 text-center py-8">Select a routine above or start an empty workout.</div>`; return; }
  if (!workoutState.exercises.length) { els.workoutExercises.innerHTML = `<div class="text-zinc-500 text-center py-8">Search and add an exercise to begin tracking.</div>`; return; }

  workoutState.exercises.forEach((ex, exIndex) => {
    const card = document.createElement("div"); card.className = "bg-zinc-900 border border-zinc-700 rounded-2xl p-5 mb-4";
    function trackTime() { if (!ex.firstEditTime) ex.firstEditTime = Date.now(); ex.lastEditTime = Date.now(); }
    const setsHtml = ex.sets.map((s, idx) => {
      const last = ex.lastSets?.[idx] || null; const phW = last ? `Last: ${last.weight}` : "0"; const phR = last ? `Last: ${last.reps}` : "0";
      return `
        <div class="flex items-end gap-3 bg-zinc-800 p-4 rounded-xl border border-zinc-700 mb-3" data-idx="${idx}">
          <div class="flex-1"><label class="block text-xs text-zinc-400 mb-1">Set ${idx + 1} - Weight</label><input class="w w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500" type="number" step="0.5" value="${escapeHtml(s.weight)}" placeholder="${escapeHtml(phW)}"></div>
          <div class="flex-1"><label class="block text-xs text-zinc-400 mb-1">Reps</label><input class="r w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500" type="text" value="${escapeHtml(s.reps)}" placeholder="${escapeHtml(phR)}"></div>
          <div class="flex-1 hidden md:block"><label class="block text-xs text-zinc-400 mb-1">RPE</label><input class="p w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500" type="number" step="0.5" value="${escapeHtml(s.rpe)}" placeholder="-"></div>
          <button class="rem px-3 py-2 text-red-400 hover:text-red-300 transition-colors"><i class="fa-solid fa-trash"></i></button>
        </div>`;
    }).join("");
    if (ex.exerciseNote == null) ex.exerciseNote = "";
    const favOn = isExerciseFavorite(ex.exerciseId);
    card.innerHTML = `<div class="flex justify-between items-start gap-2 mb-2">
      <div class="font-bold text-xl text-emerald-400 flex-1 min-w-0">${escapeHtml(ex.name)}</div>
      <button type="button" class="ex-fav-toggle shrink-0 w-10 h-10 rounded-lg border border-zinc-600 hover:bg-zinc-800 text-amber-400 flex items-center justify-center" title="${favOn ? "Remove from favorites" : "Add to favorites"}" aria-label="Favorite"><i class="fa-star ${favOn ? "fa-solid" : "fa-regular"}"></i></button>
    </div>
    <label class="block text-xs text-zinc-500 mb-1">Notes</label>
    <textarea class="exercise-note-input w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 resize-y min-h-[60px] mb-4" rows="2" placeholder="Add note for this exercise">${escapeHtml(ex.exerciseNote)}</textarea>
    <div class="flex gap-2 mb-4"><button class="addSet bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-4 py-2 rounded-lg text-sm border border-zinc-600">+ Add Set</button><button class="copyLast bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-4 py-2 rounded-lg text-sm border border-zinc-600">Copy Last</button><button class="removeExercise text-red-400 hover:text-red-300 px-4 py-2 text-sm ml-auto">Remove</button></div><div>${setsHtml}</div>`;
    card.querySelector(".ex-fav-toggle").addEventListener("click", (e) => {
      e.preventDefault();
      toggleFavoriteExercise(ex.exerciseId);
      renderWorkoutBuilder();
    });
    card.querySelector(".exercise-note-input").addEventListener("input", (e) => {
      ex.exerciseNote = e.target.value;
      trackTime();
      scheduleAutosave();
    });
    card.querySelector(".addSet").addEventListener("click", () => { ex.sets.push({ weight: "", reps: "", rpe: "" }); trackTime(); renderWorkoutBuilder(); scheduleAutosave(); });
    card.querySelector(".copyLast").addEventListener("click", () => { if (!ex.lastSets?.length) return setStatus("No previous sets found"); ex.sets = ex.lastSets.map(s => ({ weight: s.weight, reps: s.reps, rpe: "" })); trackTime(); renderWorkoutBuilder(); scheduleAutosave(); });
    card.querySelector(".removeExercise").addEventListener("click", () => { workoutState.exercises.splice(exIndex, 1); renderWorkoutBuilder(); scheduleAutosave(); });
    card.querySelectorAll("[data-idx]").forEach(row => {
      const idx = Number(row.dataset.idx);
      row.querySelector(".w").addEventListener("input", e => { ex.sets[idx].weight = e.target.value; trackTime(); scheduleAutosave(); });
      row.querySelector(".r").addEventListener("input", e => { ex.sets[idx].reps = e.target.value; trackTime(); scheduleAutosave(); });
      row.querySelector(".p").addEventListener("input", e => { ex.sets[idx].rpe = e.target.value; trackTime(); scheduleAutosave(); });
      row.querySelector(".rem").addEventListener("click", () => { ex.sets.splice(idx, 1); if (!ex.sets.length) ex.sets.push({ weight: "", reps: "", rpe: "" }); trackTime(); renderWorkoutBuilder(); scheduleAutosave(); });
    });
    els.workoutExercises.appendChild(card);
  });
}

// ==================== PRS, ANALYTICS & CHARTS ====================
async function updatePRsAfterWorkout(completedExercises) {
  await Promise.all(completedExercises.map(async (ex) => {
    if (!ex.sets.length) return;

    const validSets = filterScorableSets(ex.sets);
    if (!validSets.length) return;

    const best = pickBestSetForPR(validSets);
    if (!best) return;

    const prRef = doc(db, "users", currentUser.uid, "prs", ex.exerciseId);
    const prSnap = await getDoc(prRef);
    const current = prSnap.exists() ? prSnap.data() : { weight: 0, reps: 0 };

    if (isNewPRBeatsCurrent(best, current)) {
      await setDoc(prRef, {
        exerciseId: ex.exerciseId,
        exerciseName: ex.name,
        weight: best.weight,
        reps: best.reps,
        unit: els.unitSelect?.value || "lb",
        date: todayISO(),
        timestamp: serverTimestamp(),
      });
    }
  }));
}

let unsubPRs = null;
function listenToPRs() {
  if (unsubPRs) {
    unsubPRs();
    unsubPRs = null;
  }
  if (!currentUser || !els.prsList) return;
  const q = query(collection(db, "users", currentUser.uid, "prs"), limit(500));
  unsubPRs = onSnapshot(q, (snap) => {
    if (!els.prsList) return;
    els.prsList.innerHTML = "";
    if (snap.empty) {
      els.prsList.innerHTML = `<div class="text-zinc-500 col-span-full rounded-xl border border-dashed border-zinc-800 py-10 px-4 text-center text-sm leading-relaxed">No PRs yet. Finish a workout with at least one set that has reps (and weight for loaded lifts) to record bests by volume.</div>`;
      return;
    }
    snap.forEach(d => {
      const pr = d.data(); const div = document.createElement("div"); div.className = "bg-zinc-800 p-5 rounded-2xl flex justify-between items-center border border-zinc-700 group";
      div.innerHTML = `<div class="flex-1"><div class="font-bold text-lg text-zinc-100">${escapeHtml(pr.exerciseName)}</div><div class="text-xs text-zinc-400">${escapeHtml(pr.date || "N/A")}</div></div><div class="text-right text-yellow-500 font-black text-2xl tracking-tighter mr-4">${pr.weight}<span class="text-sm font-medium text-yellow-600 ml-1">× ${pr.reps}</span></div><button class="deletePrBtn text-zinc-600 hover:text-red-500 transition-colors p-2 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100" title="Delete PR"><i class="fa-solid fa-trash"></i></button>`;
      div.querySelector(".deletePrBtn").onclick = async () => { if (confirm(`Delete your PR for ${pr.exerciseName}?`)) { try { await deleteDoc(doc(db, "users", currentUser.uid, "prs", pr.exerciseId)); populateDropdowns(); setStatus("PR deleted.", "info"); } catch (e) { alert("Failed to delete PR."); } } };
      els.prsList.appendChild(div);
    });
  });
}

let analyticsWindowWorkouts = [];
let chartWorkoutsSample = [];
let chartWorkoutsLoadPromise = null;

function workoutSummariesCollection() {
  return collection(db, "users", currentUser.uid, "workout_summaries");
}

async function loadChartWorkoutsSample() {
  if (!currentUser) return [];
  if (chartWorkoutsSample.length) return chartWorkoutsSample;
  if (!chartWorkoutsLoadPromise) {
    chartWorkoutsLoadPromise = (async () => {
      try {
        const summarySnap = await getDocs(
          query(workoutSummariesCollection(), orderBy("updatedAtMs", "desc"), limit(120))
        );
        chartWorkoutsSample = summarySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (chartWorkoutsSample.length === 0) {
          const fallbackSnap = await getDocs(
            query(
              collection(db, "users", currentUser.uid, "workouts"),
              where("status", "==", "final"),
              orderBy("updatedAtMs", "desc"),
              limit(60)
            )
          );
          chartWorkoutsSample = fallbackSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
      } catch (e) {
        console.warn("Chart workout sample query failed", e);
        chartWorkoutsSample = [];
      } finally {
        chartWorkoutsLoadPromise = null;
      }
      return chartWorkoutsSample;
    })();
  }
  return chartWorkoutsLoadPromise;
}

function resetWorkoutAnalyticsCaches() {
  analyticsWindowWorkouts = [];
  chartWorkoutsSample = [];
  chartWorkoutsLoadPromise = null;
}

function scheduleAnalyticsRefresh(delayMs = 1500) {
  window.setTimeout(() => {
    resetWorkoutAnalyticsCaches();
    loadAnalytics().catch(() => {});
  }, delayMs);
}

/** Canonical order for heatmap segments (matches legend). */
const HEAT_FOCUS_ORDER = ["Legs", "Chest", "Shoulders", "Back"];
/** Tailwind-equivalent single-cell classes (1 category only). */
const HEAT_SINGLE_CLASS = {
  Legs: "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]",
  Chest: "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]",
  Shoulders: "bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]",
  Back: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]",
  _none: "bg-zinc-400 shadow-[0_0_8px_rgba(161,161,170,0.5)]",
};
/** Hex for multi-segment CSS gradients (same hues as legend). */
const HEAT_HEX = { Legs: "#3b82f6", Chest: "#f97316", Shoulders: "#a855f7", Back: "#10b981" };

/** Unique focus categories for a calendar day across all finished workouts; max 4; repeats in same category count once. */
function uniqueHeatFocusesForDay(dayWorkouts) {
  const seen = new Set();
  (dayWorkouts || []).forEach((w) => {
    (w.focus || []).forEach((f) => {
      if (HEAT_FOCUS_ORDER.includes(f)) seen.add(f);
    });
  });
  return HEAT_FOCUS_ORDER.filter((f) => seen.has(f)).slice(0, 4);
}

/**
 * Build background for one heatmap cell: 1 = solid Tailwind class; 2 = diagonal split TL–BR;
 * 3 = three 120° conic wedges; 4 = four 90° quadrants (conic from center).
 */
function heatmapCellVisual(focuses, hasWorkout) {
  if (!hasWorkout) return { kind: "rest", className: "bg-zinc-800", style: null };
  const n = focuses.length;
  if (n === 0) return { kind: "single", className: HEAT_SINGLE_CLASS._none, style: null };
  if (n === 1) return { kind: "single", className: HEAT_SINGLE_CLASS[focuses[0]] || HEAT_SINGLE_CLASS._none, style: null };
  const hex = focuses.map((f) => HEAT_HEX[f]);
  if (n === 2) {
    return {
      kind: "split",
      className: "shadow-[0_0_6px_rgba(0,0,0,0.35)]",
      style: `background:linear-gradient(135deg,${hex[0]} 50%,${hex[1]} 50%)`,
    };
  }
  if (n === 3) {
    return {
      kind: "split",
      className: "shadow-[0_0_6px_rgba(0,0,0,0.35)]",
      style: `background:conic-gradient(from 0deg at 50% 50%,${hex[0]} 0deg 120deg,${hex[1]} 120deg 240deg,${hex[2]} 240deg 360deg)`,
    };
  }
  return {
    kind: "split",
    className: "shadow-[0_0_6px_rgba(0,0,0,0.35)]",
    style: `background:conic-gradient(from 0deg at 50% 50%,${hex[0]} 0deg 90deg,${hex[1]} 90deg 180deg,${hex[2]} 180deg 270deg,${hex[3]} 270deg 360deg)`,
  };
}

function workoutDisplayMeta(w) {
  let displayDate = w.date;
  let timeString = "";
  let dDate = w.date;
  if (w.updatedAtMs) {
    const dObj = new Date(w.updatedAtMs);
    displayDate = dObj.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    timeString = dObj.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    dDate = toLocalISODate(dObj);
  } else if (displayDate && String(displayDate).length > 10 && !String(displayDate).includes("-")) {
    const dObj = new Date(Number(displayDate));
    displayDate = dObj.toLocaleDateString();
    timeString = dObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    dDate = toLocalISODate(dObj);
  }
  return { displayDate, timeString, dDate };
}

async function loadAnalytics() {
  if (!currentUser || !els.analyticsContent || !els.recentWorkouts) return;
  try {
    const summariesCol = workoutSummariesCollection();
    const workoutsCol = collection(db, "users", currentUser.uid, "workouts");
    let totalWorkoutsDisplay = "0";
    try {
      const countSnap = await getCountFromServer(summariesCol);
      const summaryCount = Number(countSnap.data().count || 0);
      totalWorkoutsDisplay = String(summaryCount);
      if (summaryCount === 0) {
        const fallbackCountSnap = await getCountFromServer(
          query(workoutsCol, where("status", "==", "final"))
        );
        totalWorkoutsDisplay = String(fallbackCountSnap.data().count || 0);
      }
    } catch (e) {
      console.warn("Workout summary count aggregation failed; using capped read fallback.", e);
      const approx = await getDocs(query(workoutsCol, where("status", "==", "final"), limit(500)));
      totalWorkoutsDisplay = approx.size >= 500 ? "500+" : String(approx.size);
    }

    const today = new Date();
    const minD = new Date(today);
    minD.setDate(minD.getDate() - 89);
    const minDateStr = toLocalISODate(minD);

    let snapWindow;
    try {
      snapWindow = await getDocs(query(summariesCol, where("date", ">=", minDateStr), limit(180)));
    } catch (e) {
      console.warn("Analytics summary date-window query failed", e);
      snapWindow = null;
    }
    analyticsWindowWorkouts = snapWindow ? snapWindow.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    if (analyticsWindowWorkouts.length === 0) {
      const fallbackWindow = await getDocs(
        query(workoutsCol, where("status", "==", "final"), where("date", ">=", minDateStr), limit(120))
      );
      analyticsWindowWorkouts = fallbackWindow.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    let recentList = [];
    try {
      const snapRecent = await getDocs(
        query(summariesCol, orderBy("updatedAtMs", "desc"), limit(8))
      );
      recentList = snapRecent.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      recentList = [];
    }
    if (recentList.length === 0) {
      recentList = [...analyticsWindowWorkouts].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0)).slice(0, 8);
    }

    els.recentWorkouts.innerHTML = "";
    const workoutsByDate = {};

    analyticsWindowWorkouts.forEach((w) => {
      const { dDate } = workoutDisplayMeta(w);
      if (!workoutsByDate[dDate]) workoutsByDate[dDate] = [];
      workoutsByDate[dDate].push(w);
    });

    recentList.slice(0, 5).forEach((w) => {
      const { displayDate, timeString } = workoutDisplayMeta(w);
      const fullDateStr = timeString ? `${displayDate} at ${timeString}` : displayDate;
      const div = document.createElement("div");
      div.className =
        "bg-zinc-800 p-4 rounded-xl flex justify-between items-center border border-zinc-700 cursor-pointer hover:border-emerald-500/50 transition-colors";
      const exerciseCount = Number(w.exerciseCount || (w.exercises || []).length || 0);
      div.innerHTML = `<div><div class="font-medium text-zinc-200">${displayDate} <span class="text-zinc-500 text-xs ml-1">${timeString}</span></div><div class="text-xs text-zinc-500">${exerciseCount} exercises</div></div><div class="text-right text-emerald-400 font-bold">${escapeHtml(w.routineName || "Custom Workout")}</div>`;
      div.onclick = () => openWorkoutDetailsFromSummary(w, fullDateStr);
      els.recentWorkouts.appendChild(div);
    });

    // Generate Unified Analytics & Heatmap Layout
    let heatHtml = `<div id="heatmapGrid" class="flex flex-wrap gap-1.5 justify-center mt-5 mb-3">`;
    for (let i = 89; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i); const dateStr = toLocalISODate(d);
        const dayWorkouts = workoutsByDate[dateStr] || [];
        const uniqueFocuses = uniqueHeatFocusesForDay(dayWorkouts);
        const routineNames = dayWorkouts.map(w => w.routineName || "Custom Workout").join(" + ");
        const vis = heatmapCellVisual(uniqueFocuses, dayWorkouts.length > 0);
        const baseCell = "w-4 h-4 rounded-sm cursor-pointer hover:ring-2 hover:ring-zinc-400 transition-all overflow-hidden shrink-0";
        const tip = dayWorkouts.length
          ? (uniqueFocuses.length ? `${dateStr} — ${uniqueFocuses.join(", ")}` : `${dateStr} — workout (no focus selected)`)
          : dateStr;
        const styleAttr = vis.kind === "split" && vis.style ? ` style="${escapeHtml(vis.style)}"` : "";
        heatHtml += `<div class="${baseCell} ${vis.className}" data-date="${dateStr}" data-routines="${escapeHtml(routineNames)}" data-focus="${escapeHtml(uniqueFocuses.join(", "))}" title="${escapeHtml(tip)}"${styleAttr}></div>`;
    }
    heatHtml += `</div>`;

    els.analyticsContent.innerHTML = `
      <div class="col-span-1 md:col-span-2 flex flex-col md:flex-row items-center gap-6 p-2">
          <div class="text-center md:border-r border-zinc-700 md:pr-8">
              <div class="text-5xl font-black text-white">${escapeHtml(totalWorkoutsDisplay)}</div>
              <div class="text-xs text-zinc-400 mt-2 tracking-widest uppercase">Total Workouts</div>
          </div>
          <div class="flex-1 w-full text-center">
              <div class="text-sm font-medium text-zinc-300">90-Day Workout Focus</div>
              ${heatHtml}
              <div class="text-xs text-zinc-500 flex justify-center gap-4 flex-wrap">
                  <span class="flex items-center gap-1"><div class="w-2 h-2 rounded-sm bg-blue-500"></div> Legs</span>
                  <span class="flex items-center gap-1"><div class="w-2 h-2 rounded-sm bg-orange-500"></div> Chest</span>
                  <span class="flex items-center gap-1"><div class="w-2 h-2 rounded-sm bg-purple-500"></div> Shoulders</span>
                  <span class="flex items-center gap-1"><div class="w-2 h-2 rounded-sm bg-emerald-500"></div> Back</span>
              </div>
              <div id="newHeatSelectedDateDisplay" class="mt-4 text-sm hidden px-4 py-2 bg-zinc-800/80 rounded-lg border border-zinc-700"></div>
          </div>
      </div>
    `;

    // Click listener for the new heatmap (closest: multi-color cells use same outer div as gradient)
    const newGrid = els.analyticsContent.querySelector("#heatmapGrid");
    newGrid?.addEventListener("click", (e) => {
        const cell = e.target.closest("[data-date]");
        if (!cell) return;
        const dateClicked = cell.getAttribute("data-date");
        const routines = cell.getAttribute("data-routines");
        const focusList = cell.getAttribute("data-focus");
        const dObj = new Date(dateClicked + "T12:00:00");
        const displayDate = dObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

        const displayBox = document.getElementById("newHeatSelectedDateDisplay");
        displayBox.classList.remove("hidden");
        if (routines) {
          const focusHtml = focusList
            ? `<span class="text-zinc-500 ml-2">(${escapeHtml(focusList)})</span>`
            : "";
          displayBox.innerHTML = `<span class="text-zinc-400">${displayDate}:</span> <span class="font-bold text-white ml-2">${escapeHtml(routines)}</span>${focusHtml}`;
        } else {
          displayBox.innerHTML = `<span class="text-zinc-400">${displayDate}:</span> <span class="text-zinc-500 ml-2">Rest Day</span>`;
        }
    });

    if (recentList.length === 0) els.recentWorkouts.innerHTML = "<div class='text-zinc-500'>No recent workouts</div>";
  } catch (e) { console.error("Analytics error", e); }
}

let currentModalWorkoutId = null;
async function openWorkoutDetailsFromSummary(summary, displayDate) {
  if (!currentUser || !summary?.id) return;
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid, "workouts", summary.id));
    if (!snap.exists()) {
      setStatus("Workout details are no longer available.", "error");
      return;
    }
    showWorkoutDetailsModal({ id: snap.id, ...snap.data() }, displayDate);
  } catch (e) {
    console.error("Workout details load failed", e);
    setStatus("Could not load workout details.", "error");
  }
}

function showWorkoutDetailsModal(workout, displayDate) {
    currentModalWorkoutId = workout.id; els.modalTitle.textContent = `Workout Details`;
    let contentHtml = `<div class="text-sm text-zinc-400 mb-6 pb-4 border-b border-zinc-800">${displayDate} <br/>Routine: <span class="font-bold text-emerald-400">${escapeHtml(workout.routineName || 'Custom Workout')}</span></div>`;
    (workout.exercises || []).forEach(ex => {
        let timeHtml = ""; let tStart = ex.firstEditTime || ex.addedAt; let tEnd = ex.lastEditTime || ex.firstEditTime || ex.addedAt;
        if (tStart && tEnd && Math.abs(tEnd - tStart) > 60000) { timeHtml = `<span class="text-xs text-zinc-500 font-normal ml-auto bg-zinc-800 px-2 py-1 rounded"><i class="fa-regular fa-clock mr-1"></i> ${formatTimeDisplay(tStart)} - ${formatTimeDisplay(tEnd)}</span>`; } else if (tStart) { timeHtml = `<span class="text-xs text-zinc-500 font-normal ml-auto bg-zinc-800 px-2 py-1 rounded"><i class="fa-regular fa-clock mr-1"></i> ${formatTimeDisplay(tStart)}</span>`; }
        const exNote = (ex.exerciseNote && String(ex.exerciseNote).trim()) ? `<div class="text-sm text-zinc-400 mb-3 pl-1 border-l-2 border-emerald-500/50 py-1"><span class="text-zinc-500 text-xs uppercase tracking-wide mr-2">Notes</span>${escapeHtml(ex.exerciseNote)}</div>` : "";
        contentHtml += `<div class="mb-6"><div class="font-bold text-lg text-zinc-100 mb-3 flex items-center gap-2">${escapeHtml(ex.name)} ${timeHtml}</div>${exNote}`;
        const validSets = (ex.sets || []).filter(s => s.weight && s.weight.toString().trim() !== "");
        if(validSets.length === 0) { contentHtml += `<div class="text-sm text-zinc-500">No valid sets recorded.</div>`; } else { validSets.forEach((s, i) => { contentHtml += `<div class="flex gap-4 text-sm bg-zinc-900 p-2 rounded-lg mb-1 border border-zinc-800"><div class="text-zinc-500 w-12">Set ${i+1}</div><div class="font-medium">${s.weight} ${workout.unit || 'lb'}</div><div class="font-medium text-emerald-400">× ${s.reps} reps</div></div>`; }); }
        contentHtml += `</div>`;
    });
    els.modalContent.innerHTML = contentHtml; els.workoutModal.showModal();
}
els.deleteWorkoutBtn?.addEventListener("click", async () => {
    if (!currentModalWorkoutId || !currentUser) return;
    if (confirm("Permanently delete this workout? This will remove it from your analytics and charts.")) {
        try { els.deleteWorkoutBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Deleting...`; els.deleteWorkoutBtn.disabled = true; await deleteDoc(doc(db, "users", currentUser.uid, "workouts", currentModalWorkoutId)); invalidateFinalSetsCache(); resetWorkoutAnalyticsCaches(); els.workoutModal.close(); await loadAnalytics(); await populateDropdowns(); scheduleAnalyticsRefresh(); setStatus("Workout deleted", "info"); } 
        catch (e) { alert("Failed to delete the workout."); } finally { els.deleteWorkoutBtn.innerHTML = `<i class="fa-solid fa-trash mr-1"></i> Delete Workout`; els.deleteWorkoutBtn.disabled = false; }
    }
});
els.closeModalBtn?.addEventListener("click", () => els.workoutModal.close());

// ==================== REST TIMER ====================
// Source of truth while running: wall-clock end time (timerEndAt). setInterval only refreshes the UI ~1s; iOS throttles timers in background, so we recompute remaining time from Date.now() on resume (visibility/pageshow/focus) and from each tick.
// Persisted so switching apps / locking the screen does not lose the scheduled end time.
const TIMER_STORAGE_KEY = "k2_rest_timer_state_v2";
const TIMER_DEFAULT_SECONDS = 120;

let timerSeconds = TIMER_DEFAULT_SECONDS;
let timerEndAt = null;
let isTimerRunning = false;
let timerInterval = null;
let alarmSound = null;

function playTimerAlarm() {
  try {
    if (!alarmSound) {
      alarmSound = new Audio("/rest-timer-finished.wav");
      alarmSound.preload = "auto";
    }
    alarmSound.currentTime = 0;
    alarmSound.play().catch(() => {});
  } catch (_) {
    // Never let alarm setup interfere with the rest of app startup/runtime.
  }
}

function shouldShowTimerWidget(state) {
  if (!state || typeof state !== "object") return false;
  if (state.running) return true;
  if (state.completed) return true;
  return typeof state.remainingSec === "number" && state.remainingSec !== TIMER_DEFAULT_SECONDS;
}

function getPersistedTimerState() {
  if (isTimerRunning && timerEndAt != null) {
    return { running: true, endAt: timerEndAt, completed: false };
  }
  return {
    running: false,
    endAt: null,
    remainingSec: timerSeconds,
    completed: timerSeconds <= 0,
  };
}

function persistTimerState() {
  try {
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(getPersistedTimerState()));
  } catch (_) { /* storage unavailable */ }
}

function syncSecondsFromEndTime() {
    if (timerEndAt == null) return;
    timerSeconds = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
}

function resetTimerVisuals() {
  if (!els.timerDisplay) return;
  els.timerDisplay.classList.remove("text-red-500", "animate-pulse");
  els.timerDisplay.classList.add("text-emerald-400");
}

function showTimerCompletedVisuals() {
  if (!els.timerDisplay) return;
  els.timerDisplay.classList.remove("text-emerald-400");
  els.timerDisplay.classList.add("text-red-500", "animate-pulse");
}

function updateTimerDisplay() {
  if (!els.timerDisplay) return;
  const m = Math.floor(timerSeconds / 60).toString().padStart(2, "0");
  const s = (timerSeconds % 60).toString().padStart(2, "0");
  els.timerDisplay.textContent = `${m}:${s}`;
}

function setTimerUiPaused() {
    if (!els.timerPlayPauseBtn) return;
    els.timerPlayPauseBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
    els.timerPlayPauseBtn.classList.replace("bg-amber-600", "bg-emerald-600");
    els.timerPlayPauseBtn.classList.replace("hover:bg-amber-500", "hover:bg-emerald-500");
}

function setTimerUiRunning() {
    if (!els.timerPlayPauseBtn) return;
    els.timerPlayPauseBtn.innerHTML = `<i class="fa-solid fa-pause"></i>`;
    els.timerPlayPauseBtn.classList.replace("bg-emerald-600", "bg-amber-600");
    els.timerPlayPauseBtn.classList.replace("hover:bg-emerald-500", "hover:bg-amber-500");
}

function clearTimerTick() {
    if (timerInterval != null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function applyRestCompleteUi(playAlarm) {
    clearTimerTick();
    isTimerRunning = false;
    timerEndAt = null;
    timerSeconds = 0;
    setTimerUiPaused();
    showTimerCompletedVisuals();
    updateTimerDisplay();
    if (playAlarm) {
        playTimerAlarm();
        if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
    }
    persistTimerState();
}

function onTimerFinished() {
    if (!isTimerRunning) return;
    applyRestCompleteUi(true);
}

function startTimerTick() {
    clearTimerTick();
    timerInterval = setInterval(() => {
        syncSecondsFromEndTime();
        updateTimerDisplay();
        if (timerSeconds <= 0) {
            onTimerFinished();
        }
    }, 1000);
}

function recalcAfterForeground() {
    if (!isTimerRunning || timerEndAt == null) return;
    syncSecondsFromEndTime();
    updateTimerDisplay();
    if (timerSeconds <= 0) {
        onTimerFinished();
    }
}

function applyTimerStateSnapshot(state, options = {}) {
  const { playAlarmIfExpired = false, revealWidget = false } = options;
  if (!els.timerDisplay || !els.timerPlayPauseBtn) return;

  if (state?.running && typeof state.endAt === "number") {
    if (Date.now() >= state.endAt) {
      applyRestCompleteUi(playAlarmIfExpired);
    } else {
      timerEndAt = state.endAt;
      isTimerRunning = true;
      syncSecondsFromEndTime();
      setTimerUiRunning();
      resetTimerVisuals();
      updateTimerDisplay();
      startTimerTick();
    }
  } else {
    clearTimerTick();
    isTimerRunning = false;
    timerEndAt = null;
    timerSeconds = typeof state?.remainingSec === "number"
      ? Math.max(0, Math.floor(state.remainingSec))
      : TIMER_DEFAULT_SECONDS;
    setTimerUiPaused();
    if (state?.completed || timerSeconds <= 0) showTimerCompletedVisuals();
    else resetTimerVisuals();
    updateTimerDisplay();
  }

  if (revealWidget && shouldShowTimerWidget(state)) {
    els.restTimerWidget?.classList.remove("hidden");
  }
}

function restoreTimerFromStorage() {
    if (!els.timerDisplay || !els.timerPlayPauseBtn) return;
    try {
        const raw = localStorage.getItem(TIMER_STORAGE_KEY);
        if (!raw) {
          applyTimerStateSnapshot({ running: false, remainingSec: TIMER_DEFAULT_SECONDS, completed: false });
          return;
        }
        applyTimerStateSnapshot(JSON.parse(raw), { playAlarmIfExpired: false, revealWidget: true });
    } catch (_) {
      applyTimerStateSnapshot({ running: false, remainingSec: TIMER_DEFAULT_SECONDS, completed: false });
    }
}

restoreTimerFromStorage();

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recalcAfterForeground();
});
window.addEventListener("pageshow", () => recalcAfterForeground());
window.addEventListener("pagehide", () => {
    syncSecondsFromEndTime();
    persistTimerState();
});
window.addEventListener("focus", () => recalcAfterForeground());
window.addEventListener("blur", () => {
    syncSecondsFromEndTime();
    persistTimerState();
});
window.addEventListener("storage", (event) => {
  if (event.key !== TIMER_STORAGE_KEY) return;
  if (!event.newValue) {
    applyTimerStateSnapshot({ running: false, remainingSec: TIMER_DEFAULT_SECONDS, completed: false });
    return;
  }
  try {
    applyTimerStateSnapshot(JSON.parse(event.newValue), { playAlarmIfExpired: false, revealWidget: true });
  } catch (_) {
    // Ignore malformed timer state from another tab.
  }
});

els.toggleTimerBtn?.addEventListener("click", () => {
  els.restTimerWidget?.classList.toggle("hidden");
  if (!els.restTimerWidget?.classList.contains("hidden") && timerSeconds <= 0) {
    timerSeconds = TIMER_DEFAULT_SECONDS;
    timerEndAt = null;
    resetTimerVisuals();
    updateTimerDisplay();
    persistTimerState();
  }
});
els.timerPlayPauseBtn?.addEventListener("click", () => {
    if (isTimerRunning) {
        syncSecondsFromEndTime();
        timerEndAt = null;
        clearTimerTick();
        isTimerRunning = false;
        setTimerUiPaused();
        persistTimerState();
    } else {
        if (timerSeconds <= 0) { timerSeconds = TIMER_DEFAULT_SECONDS; resetTimerVisuals(); }
        timerEndAt = Date.now() + timerSeconds * 1000;
        isTimerRunning = true;
        setTimerUiRunning();
        startTimerTick();
        persistTimerState();
    }
});
els.timerAddBtn?.addEventListener("click", () => {
    if (isTimerRunning && timerEndAt != null) {
        timerEndAt += 15000;
        syncSecondsFromEndTime();
    } else {
        timerSeconds += 15;
    }
    resetTimerVisuals();
    updateTimerDisplay();
    persistTimerState();
});
els.timerStopBtn?.addEventListener("click", () => {
    clearTimerTick();
    isTimerRunning = false;
    timerEndAt = null;
    timerSeconds = TIMER_DEFAULT_SECONDS;
    setTimerUiPaused();
    resetTimerVisuals();
    updateTimerDisplay();
    persistTimerState();
});
els.timerCloseBtn?.addEventListener("click", () => {
  els.restTimerWidget?.classList.add("hidden");
});

// ==================== CHARTS ====================
let myChart = null;

async function refreshProgressChartIfPresent() {
  const canvas = document.getElementById("progressChart");
  if (!canvas || !els.chartExerciseSelect) return;
  await loadChartWorkoutsSample();
  if (els.chartExerciseSelect.value) updateProgressChart(els.chartExerciseSelect.value);
}

async function populateDropdowns() {
  if (!currentUser) return;
  try {
    const q = query(collection(db, "users", currentUser.uid, "prs"), limit(400));
    const snap = await getDocs(q);
    let options = `<option value="">${snap.empty ? "No PRs yet — finish a workout first" : "Select an exercise…"}</option>`;
    snap.forEach(d => { options += `<option value="${d.data().exerciseId}">${escapeHtml(d.data().exerciseName)}</option>`; });
    if (els.chartExerciseSelect) els.chartExerciseSelect.innerHTML = options;
    await refreshProgressChartIfPresent();
  } catch (e) { console.error("Dropdown populate error", e); }
}

function setProgressChartEmpty(visible, message = "") {
  const empty = document.getElementById("progressChartEmpty");
  if (empty) {
    empty.textContent = message;
    empty.classList.toggle("hidden", !visible);
  }
}

function updateProgressChart(exerciseId) {
    const canvas = document.getElementById("progressChart");
    if (!canvas || !els.chartExerciseSelect) return;
    if (!exerciseId) {
      if (myChart) { myChart.destroy(); myChart = null; }
      setProgressChartEmpty(true, "Select an exercise to see best set volume over time (weight × reps; bodyweight counts reps).");
      return;
    }
    if (chartWorkoutsSample.length === 0) {
      if (myChart) { myChart.destroy(); myChart = null; }
      setProgressChartEmpty(true, "No workouts loaded yet. Sign in and complete a session, then return to Progress.");
      return;
    }
    const dataPoints = [];
    chartWorkoutsSample.forEach((w) => {
        let displayDate = w.date; if (displayDate && String(displayDate).length > 10 && !String(displayDate).includes("-")) displayDate = toLocalISODate(new Date(Number(displayDate)));
        const summaryMatch = (w.exerciseSummaries || []).find((e) => e.exerciseId === exerciseId);
        const fromSummary = chartPeakFromSummary(summaryMatch);
        if (fromSummary && fromSummary.volume > 0) {
            dataPoints.push({ date: displayDate, volume: fromSummary.volume });
            return;
        }
        const rawExercise = (w.exercises || []).find((e) => e.exerciseId === exerciseId);
        const fromRaw = chartPeakFromRawExercise(rawExercise);
        if (fromRaw && fromRaw.volume > 0) {
            dataPoints.push({ date: displayDate, volume: fromRaw.volume });
        }
    });
    dataPoints.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (dataPoints.length === 0) {
      if (myChart) {
        myChart.destroy();
        myChart = null;
      }
      setProgressChartEmpty(true, "No volume history for this exercise in these workouts. Finish more logged sessions or pick another lift.");
      return;
    }
    setProgressChartEmpty(false);
    const labels = dataPoints.map(dp => dp.date); const volumes = dataPoints.map(dp => dp.volume);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (myChart) myChart.destroy();
    if (typeof Chart === "undefined") return;
    myChart = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Best set volume (weight × reps; reps only if no load)', data: volumes, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 3, pointBackgroundColor: '#10b981', pointBorderColor: '#fff', pointRadius: 5, fill: true, tension: 0.3 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { title: { display: true, text: 'Volume', color: '#71717a' }, grid: { color: '#27272a' }, ticks: { color: '#a1a1aa' } }, x: { grid: { display: false }, ticks: { color: '#a1a1aa' } } } }
    });
}
els.chartExerciseSelect?.addEventListener("change", async (e) => {
  await loadChartWorkoutsSample();
  updateProgressChart(e.target.value);
});

els.mobileMenuBtn?.addEventListener("click", () => {
  if (!els.mobileNavPanel) return;
  els.mobileNavPanel.classList.toggle("hidden");
  const open = !els.mobileNavPanel.classList.contains("hidden");
  els.mobileMenuBtn?.setAttribute("aria-expanded", open ? "true" : "false");
});
document.querySelectorAll("[data-mobile-nav-link]").forEach((link) => {
  link.addEventListener("click", () => {
    els.mobileNavPanel?.classList.add("hidden");
    els.mobileMenuBtn?.setAttribute("aria-expanded", "false");
  });
});
