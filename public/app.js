import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, addDoc, getDoc, getDocs, query, where, onSnapshot, serverTimestamp, deleteDoc, updateDoc, writeBatch, limit, orderBy, getCountFromServer, startAfter, waitForPendingWrites } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  completedExerciseSetRows,
  filterScorableSets,
  isCompletedSet,
  isNewPRBeatsCurrent,
  prSetVolume,
  chartPeakFromSummary,
  chartPeakFromRawExercise,
} from "./js/setScoring.js";
import {
  applyDraftDateChoice,
  buildDateCorrectionRequest,
  compareSetPerformance,
  countLoggedSets,
  draftHasMeaningfulProgress,
  formatCalendarDate,
  localCalendarDateKey,
  moveListItem,
  moveRoutine,
  needsWorkoutDateConfirmation,
  normalizeCachedExerciseSessions,
  previousSetPlaceholder,
  progressStateMessage,
  resolveExerciseSessions,
  resolveNewWorkoutDate,
  selectEmptyStaleDraftIds,
  sortRoutines,
  selectPreviousExerciseSessions,
} from "./js/workoutSession.js";

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
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const els = {
  activeWorkoutBadge: document.getElementById("activeWorkoutBadge"),
  mobileMenuBtn: document.getElementById("mobileMenuBtn"),
  mobileNavPanel: document.getElementById("mobileNavPanel"),
  aiErrorBanner: document.getElementById("aiErrorBanner"),
  homeView: document.getElementById("homeView"),
  recentView: document.getElementById("recentView"),
  routinesView: document.getElementById("routinesView"),
  userLabel: document.getElementById("userLabel"), signInBtn: document.getElementById("loginBtn"), signOutBtn: document.getElementById("logoutBtn"), searchInput: document.getElementById("searchInput"), searchBtn: document.getElementById("searchBtn"), createCustomExerciseBtn: document.getElementById("createCustomExerciseBtn"), searchResults: document.getElementById("searchResults"), dateInput: document.getElementById("dateInput"), unitSelect: document.getElementById("unitSelect"), startWorkoutBtn: document.getElementById("startWorkoutBtn"), finishWorkoutBtn: document.getElementById("finishWorkoutBtn"), resumeDraftBtn: document.getElementById("resumeDraftBtn"), discardWorkoutBtn: document.getElementById("discardWorkoutBtn"), saveTemplateBtn: document.getElementById("saveTemplateBtn"), updateTemplateBtn: document.getElementById("updateTemplateBtn"), templatesList: document.getElementById("templatesList"), saveStatus: document.getElementById("saveStatus"), workoutExercises: document.getElementById("workoutExercises"), prsList: document.getElementById("prsList"), analyticsContent: document.getElementById("analyticsContent"), recentWorkouts: document.getElementById("recentWorkouts"), recentWorkoutsPreview: document.getElementById("recentWorkoutsPreview"), loadMoreWorkoutsBtn: document.getElementById("loadMoreWorkoutsBtn"),
  workoutModal: document.getElementById("workoutModal"), modalTitle: document.getElementById("modalTitle"), modalContent: document.getElementById("modalContent"), closeModalBtn: document.getElementById("closeModalBtn"),
  toggleTimerBtn: document.getElementById("toggleTimerBtn"), restTimerWidget: document.getElementById("restTimerWidget"), timerDisplay: document.getElementById("timerDisplay"), timerAddBtn: document.getElementById("timerAddBtn"), timerPlayPauseBtn: document.getElementById("timerPlayPauseBtn"), timerStopBtn: document.getElementById("timerStopBtn"), timerCloseBtn: document.getElementById("timerCloseBtn"),
  chartExerciseSelect: document.getElementById("chartExerciseSelect"),
  templateModal: document.getElementById("templateModal"), closeTemplateModalBtn: document.getElementById("closeTemplateModalBtn"), editTemplateName: document.getElementById("editTemplateName"), editTemplateExercises: document.getElementById("editTemplateExercises"), saveTemplateChangesBtn: document.getElementById("saveTemplateChangesBtn"), deleteTemplateModalBtn: document.getElementById("deleteTemplateModalBtn"),
  aiModal: document.getElementById("aiModal"), openAiModalBtn: document.getElementById("openAiModalBtn"), openAiModalBtnRoutines: document.getElementById("openAiModalBtnRoutines"), closeAiModalBtn: document.getElementById("closeAiModalBtn"), aiPromptInput: document.getElementById("aiPromptInput"), generateAiBtn: document.getElementById("generateAiBtn"), aiPreviewWrap: document.getElementById("aiPreviewWrap"), aiPreviewList: document.getElementById("aiPreviewList"), aiPreviewActions: document.getElementById("aiPreviewActions"), applyAiPreviewBtn: document.getElementById("applyAiPreviewBtn"), discardAiPreviewBtn: document.getElementById("discardAiPreviewBtn"),
  workoutNotesWrap: document.getElementById("workoutNotesWrap"), workoutNotesInput: document.getElementById("workoutNotesInput"),
  draftRecoveryDialog: document.getElementById("draftRecoveryDialog"), draftRecoveryText: document.getElementById("draftRecoveryText"), draftRecoveryResume: document.getElementById("draftRecoveryResume"), draftRecoveryDiscard: document.getElementById("draftRecoveryDiscard"),
  workoutDateDialog: document.getElementById("workoutDateDialog"), workoutDateDialogTitle: document.getElementById("workoutDateDialogTitle"), workoutDateDialogText: document.getElementById("workoutDateDialogText"), workoutDateMoveBtn: document.getElementById("workoutDateMoveBtn"), workoutDateKeepBtn: document.getElementById("workoutDateKeepBtn"), workoutDateCancelBtn: document.getElementById("workoutDateCancelBtn"),
  editWorkoutNameBtn: document.getElementById("editWorkoutNameBtn"),
  editWorkoutDateBtn: document.getElementById("editWorkoutDateBtn"),
  removeWorkoutBtn: document.getElementById("removeWorkoutBtn"),
  editWorkoutFocusBtn: document.getElementById("editWorkoutFocusBtn"),
  themeColorInput: document.getElementById("themeColorInput"),
  themeColorValue: document.getElementById("themeColorValue"),
  themePreviewSwatch: document.getElementById("themePreviewSwatch"),
  themeResetBtn: document.getElementById("themeResetBtn"),
};

let currentUser = null; let activeWorkoutRef = null; let autosaveTimer = null; let saveIndicatorTimer = null; let draftRecoveryShownThisSession = false;
let pendingAiRoutine = null;
let dateInputManuallySelected = false;
let workoutDateConfirmation = null;
let pendingWorkoutDateDecision = null;
const LOCAL_DRAFT_KEY_PREFIX = "k2_gym_workout_draft_v1:";
const EXERCISE_PROGRESS_CACHE_KEY_PREFIX = "k2_gym_exercise_progress_v1:";
const AUTOSAVE_DEBOUNCE_MS = 800;
const AI_PROMPT_MAX_LENGTH = 600;
const WORKOUT_FOCUS_OPTIONS = ["Legs", "Chest", "Shoulders", "Back"];
const INTEGRITY_CHECK_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const INTEGRITY_CHECK_KEY_PREFIX = "k2_integrity_check_v1:";
const APP_THEME_STORAGE_KEY = "k2_app_theme_v1";
const DEFAULT_APP_THEME_COLOR = "#34d399";
// Small chevron buttons used to reorder routines and exercises.
const MOVE_BTN_CLASS = "w-8 h-7 rounded-md border border-zinc-600 text-zinc-300 hover:bg-zinc-700 flex items-center justify-center text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent";
// routineName, focus, notes — all persisted on the draft document + mirrored in localStorage
const workoutState = { exercises: [], templateId: null, routineName: "Custom Workout", focus: [], notes: "" };
let currentRoute = "home";
let isFinishingWorkout = false;
let isDiscardingWorkout = false;
const exerciseProgressCache = new Map();
// Shared newest-first pages of finalized workouts used to build per-exercise history (see loadFinalHistoryPage).
let finalHistoryPages = { uid: null, pages: [] };
const exerciseProgressLoadsStarted = new WeakSet();

function routeFromHash() {
  const hash = String(window.location.hash || "").replace(/^#/, "").toLowerCase();
  if (hash === "recent") return "recent";
  if (hash === "routines") return "routines";
  return "home";
}

function setRouteView(route) {
  currentRoute = route;
  els.homeView?.classList.toggle("hidden", route !== "home");
  els.recentView?.classList.toggle("hidden", route !== "recent");
  els.routinesView?.classList.toggle("hidden", route !== "routines");
  if (route === "recent" && currentUser) {
    ensureRecentWorkoutsPageLoaded().catch((e) => {
      console.error("Recent workouts route load failed", e);
      renderRecentWorkoutsError("Could not load workouts.");
    });
  }
  if (route === "routines" && currentUser) {
    loadTemplates().catch((e) => console.error("Routines route load failed", e));
  }
}

function handleRouteChange() {
  setRouteView(routeFromHash());
}

window.addEventListener("hashchange", handleRouteChange);
handleRouteChange();

function normalizeThemeHex(value) {
  const hex = String(value || "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : DEFAULT_APP_THEME_COLOR;
}

function hexToRgb(hex) {
  const normalized = normalizeThemeHex(hex).slice(1);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function mixHex(baseHex, targetHex, weight) {
  const base = hexToRgb(baseHex);
  const target = hexToRgb(targetHex);
  const blend = (from, to) => Math.round(from + (to - from) * weight);
  const parts = [blend(base.r, target.r), blend(base.g, target.g), blend(base.b, target.b)]
    .map((part) => part.toString(16).padStart(2, "0"));
  return `#${parts.join("")}`;
}

function applyThemeColor(themeColor) {
  const accent = normalizeThemeHex(themeColor);
  const { r, g, b } = hexToRgb(accent);
  const root = document.documentElement;
  root.style.setProperty("--app-accent", accent);
  root.style.setProperty("--app-accent-hover", mixHex(accent, "#ffffff", 0.12));
  root.style.setProperty("--app-accent-soft-bg", `rgba(${r}, ${g}, ${b}, 0.14)`);
  root.style.setProperty("--app-accent-soft-bg-strong", `rgba(${r}, ${g}, ${b}, 0.24)`);
  root.style.setProperty("--app-accent-soft-border", `rgba(${r}, ${g}, ${b}, 0.45)`);
  root.style.setProperty("--app-accent-shadow", `rgba(${r}, ${g}, ${b}, 0.22)`);
  root.style.setProperty("--app-accent-text-hover", mixHex(accent, "#ffffff", 0.22));
  root.style.setProperty("--app-accent-ring", `rgba(${r}, ${g}, ${b}, 0.34)`);
  root.dataset.appThemeColor = accent;
  return accent;
}

function getStoredThemeColor() {
  try {
    return normalizeThemeHex(localStorage.getItem(APP_THEME_STORAGE_KEY));
  } catch (_) {
    return DEFAULT_APP_THEME_COLOR;
  }
}

function persistThemeColor(themeColor) {
  const accent = applyThemeColor(themeColor);
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, accent);
  } catch (_) {
    // Ignore storage failures and still keep the current page themed.
  }
  return accent;
}

function updateThemeSettingsUi() {
  const accent = getStoredThemeColor();
  if (els.themeColorInput) els.themeColorInput.value = accent;
  if (els.themeColorValue) els.themeColorValue.textContent = accent.toUpperCase();
  if (els.themePreviewSwatch) els.themePreviewSwatch.style.backgroundColor = accent;
  document.querySelectorAll("[data-theme-color]").forEach((button) => {
    const isActive = normalizeThemeHex(button.dataset.themeColor) === accent;
    button.classList.toggle("is-active", isActive);
  });
}

function initThemeSettingsPage() {
  if (!els.themeColorInput) return;
  updateThemeSettingsUi();
  els.themeColorInput.addEventListener("input", (event) => {
    const accent = persistThemeColor(event.target.value);
    if (els.themeColorValue) els.themeColorValue.textContent = accent.toUpperCase();
    if (els.themePreviewSwatch) els.themePreviewSwatch.style.backgroundColor = accent;
    updateThemeSettingsUi();
  });
  document.querySelectorAll("[data-theme-color]").forEach((button) => {
    button.addEventListener("click", () => {
      persistThemeColor(button.dataset.themeColor);
      updateThemeSettingsUi();
    });
  });
  els.themeResetBtn?.addEventListener("click", () => {
    persistThemeColor(DEFAULT_APP_THEME_COLOR);
    updateThemeSettingsUi();
  });
}

applyThemeColor(getStoredThemeColor());

// NEW: Helper to safely format dates in your local timezone, ignoring UTC
function toLocalISODate(d) {
  return localCalendarDateKey(d);
}

function todayISO() { 
  return toLocalISODate(new Date()); 
}
if (els.dateInput) els.dateInput.value = todayISO();

function selectedWorkoutDate() {
  return els.dateInput?.value || todayISO();
}

function setWorkoutDateInput(dateKey, options = {}) {
  if (els.dateInput && dateKey) els.dateInput.value = dateKey;
  dateInputManuallySelected = options.manuallySelected === true;
}

function markWorkoutDateConfirmed(selectedDate, currentDate = todayISO()) {
  workoutDateConfirmation = {
    workoutId: activeWorkoutRef?.id || null,
    selectedDate,
    currentDate,
  };
}

function clearWorkoutDateConfirmation() {
  workoutDateConfirmation = null;
}

function dateConfirmationNeeded(selectedDate = selectedWorkoutDate(), currentDate = todayISO()) {
  return needsWorkoutDateConfirmation({
    selectedDate,
    currentDate,
    confirmedSelectedDate: workoutDateConfirmation?.workoutId === activeWorkoutRef?.id
      ? workoutDateConfirmation.selectedDate
      : null,
    confirmedCurrentDate: workoutDateConfirmation?.workoutId === activeWorkoutRef?.id
      ? workoutDateConfirmation.currentDate
      : null,
  });
}

function resolveDateForNewWorkout() {
  const date = resolveNewWorkoutDate({
    selectedDate: els.dateInput?.value,
    manuallySelected: dateInputManuallySelected,
    now: new Date(),
  });
  setWorkoutDateInput(date, { manuallySelected: dateInputManuallySelected });
  clearWorkoutDateConfirmation();
  return date;
}

function requestWorkoutDateDecision(selectedDate, currentDate, reason = "resume") {
  if (selectedDate === currentDate) return Promise.resolve("keep");
  if (pendingWorkoutDateDecision) return pendingWorkoutDateDecision;
  const originalLabel = formatCalendarDate(selectedDate);
  const currentLabel = formatCalendarDate(currentDate);
  if (!els.workoutDateDialog) {
    if (confirm(`This workout is dated ${originalLabel}. Move it to ${currentLabel}?`)) return Promise.resolve("move");
    if (confirm(`Keep this workout on ${originalLabel}? Select Cancel to leave the draft unchanged.`)) return Promise.resolve("keep");
    return Promise.resolve("cancel");
  }

  if (els.workoutDateDialogTitle) {
    els.workoutDateDialogTitle.textContent = reason === "resume" ? "Choose workout date" : "Confirm workout date";
  }
  if (els.workoutDateDialogText) {
    els.workoutDateDialogText.textContent = reason === "resume"
      ? `This unfinished workout is dated ${originalLabel}. Your current local date is ${currentLabel}. Choose the intended calendar date before continuing.`
      : `This workout is dated ${originalLabel}, but your current local date is ${currentLabel}. Confirm the intended calendar date before saving.`;
  }
  if (els.workoutDateMoveBtn) els.workoutDateMoveBtn.textContent = "Move workout to today";
  if (els.workoutDateKeepBtn) els.workoutDateKeepBtn.textContent = `Keep ${formatCalendarDate(selectedDate, { includeYear: false })}`;

  pendingWorkoutDateDecision = new Promise((resolve) => {
    const finish = (choice) => {
      els.workoutDateMoveBtn?.removeEventListener("click", move);
      els.workoutDateKeepBtn?.removeEventListener("click", keep);
      els.workoutDateCancelBtn?.removeEventListener("click", cancel);
      els.workoutDateDialog?.removeEventListener("cancel", cancelEvent);
      if (els.workoutDateDialog?.open) els.workoutDateDialog.close();
      pendingWorkoutDateDecision = null;
      resolve(choice);
    };
    const move = () => finish("move");
    const keep = () => finish("keep");
    const cancel = () => finish("cancel");
    const cancelEvent = (event) => { event.preventDefault(); finish("cancel"); };
    els.workoutDateMoveBtn?.addEventListener("click", move);
    els.workoutDateKeepBtn?.addEventListener("click", keep);
    els.workoutDateCancelBtn?.addEventListener("click", cancel);
    els.workoutDateDialog?.addEventListener("cancel", cancelEvent);
    els.workoutDateDialog.showModal();
  });
  return pendingWorkoutDateDecision;
}

async function persistActiveWorkoutDateOnly(dateKey) {
  if (!activeWorkoutRef || !currentUser) return;
  setWorkoutDateInput(dateKey, { manuallySelected: true });
  writeLocalDraftSnapshot();
  try {
    await updateDoc(activeWorkoutRef, { date: dateKey, dateKey });
    setSaveIndicator("Workout date updated", "saved", 2200);
  } catch (error) {
    console.warn("Workout date update will retry with draft sync", error);
    setSaveIndicator("Offline — date choice saved on this device", "offline", 0);
  }
}

async function confirmActiveWorkoutDate(reason = "finalize") {
  if (!activeWorkoutRef) return false;
  const selectedDate = selectedWorkoutDate();
  const currentDate = todayISO();
  if (!dateConfirmationNeeded(selectedDate, currentDate)) return true;
  const choice = await requestWorkoutDateDecision(selectedDate, currentDate, reason);
  if (choice === "cancel") return false;
  const chosenDate = choice === "move" ? currentDate : selectedDate;
  if (choice === "move") await persistActiveWorkoutDateOnly(chosenDate);
  markWorkoutDateConfirmed(chosenDate, currentDate);
  return true;
}

async function recheckWorkoutDateAfterReturn() {
  const currentDate = todayISO();
  if (!activeWorkoutRef) {
    if (!dateInputManuallySelected && els.dateInput?.value !== currentDate) {
      setWorkoutDateInput(currentDate, { manuallySelected: false });
    }
    return;
  }
  if (dateConfirmationNeeded(selectedWorkoutDate(), currentDate)) {
    await confirmActiveWorkoutDate("focus");
  }
}

function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function formatTimeDisplay(ms) { return !ms ? "" : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function setStatus(msg, type = "info") {
  if (!els.saveStatus) return;
  els.saveStatus.innerHTML = `<span class="${type === 'error' ? 'text-red-400' : 'text-emerald-400'}">${escapeHtml(msg)}</span>`;
  window.setTimeout(() => { els.saveStatus.innerHTML = ""; }, type === "error" ? 8000 : 3000);
}

function setFinishButtonState({ disabled = false, label = "Finish & Save" } = {}) {
  if (!els.finishWorkoutBtn) return;
  els.finishWorkoutBtn.disabled = disabled;
  els.finishWorkoutBtn.textContent = label;
}

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
  if (els.discardWorkoutBtn) els.discardWorkoutBtn.classList.toggle("hidden", !activeWorkoutRef);
  if (els.updateTemplateBtn) els.updateTemplateBtn.classList.toggle("hidden", !(activeWorkoutRef && workoutState.templateId));
  els.workoutNotesWrap?.classList.toggle("hidden", !activeWorkoutRef);
}

function setAuthUI() {
  const signedIn = !!currentUser;
  els.signInBtn?.classList.toggle("hidden", signedIn);
  els.signOutBtn?.classList.toggle("hidden", !signedIn);
  if (els.startWorkoutBtn) els.startWorkoutBtn.disabled = !signedIn || !!activeWorkoutRef;
  if (els.finishWorkoutBtn) els.finishWorkoutBtn.disabled = isFinishingWorkout || !signedIn || !activeWorkoutRef;
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
  clearWorkoutDateConfirmation();
  dateInputManuallySelected = false;
  setWorkoutDateInput(todayISO(), { manuallySelected: false });
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

function integrityCheckStorageKey(uid) {
  return uid ? `${INTEGRITY_CHECK_KEY_PREFIX}${uid}` : null;
}

function markIntegrityCheckRun(uid) {
  const key = integrityCheckStorageKey(uid);
  if (!key) return;
  try { localStorage.setItem(key, String(Date.now())); } catch (_) { /* storage unavailable */ }
}

function shouldRunIntegrityCheck(uid) {
  const key = integrityCheckStorageKey(uid);
  if (!key) return false;
  try {
    const last = Number(localStorage.getItem(key) || 0);
    return !last || (Date.now() - last) >= INTEGRITY_CHECK_COOLDOWN_MS;
  } catch (_) {
    return true;
  }
}

async function runIntegrityCheckIfDue(force = false) {
  if (!currentUser) return null;
  if (!force && !shouldRunIntegrityCheck(currentUser.uid)) return null;
  try {
    const runWorkoutIntegrityCheck = httpsCallable(functions, "runWorkoutIntegrityCheck");
    const response = await runWorkoutIntegrityCheck({});
    markIntegrityCheckRun(currentUser.uid);
    return response?.data?.report || null;
  } catch (e) {
    console.warn("Integrity check failed", e);
    return null;
  }
}

/** Snapshot for local backup (same device, survives refresh / offline). */
function buildLocalDraftSnapshot() {
  if (!activeWorkoutRef || !currentUser) return null;
  return {
    workoutId: activeWorkoutRef.id,
    updatedAtMs: Date.now(),
    exercises: workoutState.exercises.map(({ progress: _progress, ...exercise }) =>
      JSON.parse(JSON.stringify(exercise))
    ),
    routineName: workoutState.routineName,
    focus: [...workoutState.focus],
    templateId: workoutState.templateId,
    date: selectedWorkoutDate(),
    dateKey: selectedWorkoutDate(),
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
  const intendedDate = initial.dateKey ?? initial.date ?? selectedWorkoutDate();
  const payload = {
    date: intendedDate,
    dateKey: intendedDate,
    unit: initial.unit ?? els.unitSelect?.value ?? "lb",
    exercises: initial.exercises ?? [],
    routineName: initial.routineName ?? "Custom Workout",
    focus: initial.focus ?? [],
    templateId: initial.templateId ?? null,
    notes: initial.notes ?? "",
  };
  try {
    const createWorkoutDraft = httpsCallable(functions, "createWorkoutDraft");
    const response = await createWorkoutDraft(payload);
    const workoutId = response?.data?.workoutId;
    if (!workoutId) throw new Error("Draft creation did not return a workout id.");
    return doc(db, "users", currentUser.uid, "workouts", workoutId);
  } catch (e) {
    const code = String(e?.code || "");
    const message = String(e?.message || "");
    const shouldFallback =
      code === "functions/not-found" ||
      code === "functions/unimplemented" ||
      code === "functions/internal" ||
      /createworkoutdraft/i.test(message) ||
      /not found/i.test(message) ||
      /unimplemented/i.test(message);
    if (!shouldFallback) throw e;
    console.warn("Falling back to client-side draft creation", { code, message });
    const docRef = await addDoc(collection(db, "users", currentUser.uid, "workouts"), {
      status: "draft",
      ...payload,
      startedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      finalizationId: null,
      finalizedAtMs: null,
      finalizedByUid: null,
      archivedAtMs: null,
      archivedByUid: null,
    });
    return doc(db, "users", currentUser.uid, "workouts", docRef.id);
  }
}

function sanitizeDraftExercisesForStorage(exercises) {
  return (Array.isArray(exercises) ? exercises : []).slice(0, 50).map((exercise, exerciseIndex) => ({
    exerciseId: String(exercise?.exerciseId || "").slice(0, 120),
    name: String(exercise?.name || "Exercise").slice(0, 120),
    exerciseNote: String(exercise?.exerciseNote || "").slice(0, 500),
    sets: (Array.isArray(exercise?.sets) ? exercise.sets : []).slice(0, 25).map((set) => ({
      weight: set?.weight == null ? "" : String(set.weight).slice(0, 24),
      reps: set?.reps == null ? "" : String(set.reps).slice(0, 24),
      rpe: set?.rpe == null ? "" : String(set.rpe).slice(0, 24),
    })),
    addedAt: Number(exercise?.addedAt) || (Date.now() + exerciseIndex),
    firstEditTime: Number(exercise?.firstEditTime) || null,
    lastEditTime: Number(exercise?.lastEditTime) || null,
  })).filter((exercise) => exercise.exerciseId);
}

/** Persists local snapshot first, then Firestore. On network failure, local copy still has latest edits. */
async function saveWorkoutDraft() {
  // Never write status:"draft" while finishing: a late draft write landing after finalizeWorkout
  // would turn the saved workout back into a draft (and re-trigger the resume prompt).
  if (!activeWorkoutRef || !currentUser || isFinishingWorkout || isDiscardingWorkout) return;
  const draftRef = activeWorkoutRef;
  writeLocalDraftSnapshot();
  setSaveIndicator("Saving…", "saving", 0);
  const payload = {
    status: "draft",
    exercises: sanitizeDraftExercisesForStorage(workoutState.exercises),
    routineName: workoutState.routineName,
    focus: workoutState.focus,
    templateId: workoutState.templateId,
    date: selectedWorkoutDate(),
    dateKey: selectedWorkoutDate(),
    unit: els.unitSelect?.value || "lb",
    notes: workoutState.notes || "",
    updatedAtMs: Date.now(),
  };
  try {
    await setDoc(draftRef, payload, { merge: true });
    if (activeWorkoutRef === draftRef) setSaveIndicator("Saved", "saved", 2200);
  } catch (e) {
    console.error("Draft cloud save failed", e);
    // The workout was finished or replaced while this write was in flight; the error is moot.
    if (activeWorkoutRef !== draftRef) return;
    const code = String(e?.code || "");
    if (code === "permission-denied" || code === "functions/permission-denied") {
      setSaveIndicator("Save failed — permission denied", "error", 5000);
      return;
    }
    if (code === "invalid-argument") {
      setSaveIndicator("Save failed — invalid workout data", "error", 5000);
      return;
    }
    setSaveIndicator("Offline — draft saved on this device; will sync when you are back online", "offline", 0);
  }
}

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { saveWorkoutDraft().catch(() => {}); }, AUTOSAVE_DEBOUNCE_MS);
}

/** Apply in-memory state + UI from a draft row (Firestore shape). Re-merges local backup after cloud read so offline edits win when newer. */
async function loadWorkoutDraft(draftRow, options = {}) {
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
  const restoredDate = options.dateOverride || d.dateKey || d.date || todayISO();
  setWorkoutDateInput(restoredDate, { manuallySelected: true });
  if (options.confirmedCurrentDate) markWorkoutDateConfirmed(restoredDate, options.confirmedCurrentDate);
  if (els.unitSelect) els.unitSelect.value = d.unit || "lb";
  if (els.workoutNotesInput) els.workoutNotesInput.value = workoutState.notes;
  syncFocusUI();
  setActiveBadge();
  setAuthUI();
  renderWorkoutBuilder();
  if (options.dateChoice === "move") await persistActiveWorkoutDateOnly(restoredDate);
  else await saveWorkoutDraft();
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
    dateKey: localSnap.dateKey || localSnap.date,
    unit: localSnap.unit,
    updatedAtMs: localSnap.updatedAtMs,
  };
}

/** The newest unfinished draft (merged with a newer local backup) and how many unfinished drafts exist. */
async function resolveUnfinishedDrafts() {
  const cloudList = await fetchSortedDraftWorkouts();
  const localSnap = readLocalDraftSnapshot();
  const meaningfulCloudList = cloudList.filter(draftHasMeaningfulProgress);
  const meaningfulLocalSnap = draftHasMeaningfulProgress(localSnap) ? localSnap : null;
  if (meaningfulCloudList.length === 0) {
    if (!meaningfulLocalSnap?.workoutId) return { best: null, count: 0 };
    const s = await getDoc(doc(db, "users", currentUser.uid, "workouts", localSnap.workoutId));
    if (!s.exists() || s.data().status !== "draft") {
      clearLocalDraft();
      return { best: null, count: 0 };
    }
    return { best: mergeLocalDraftIfNewer({ id: s.id, ...s.data() }, meaningfulLocalSnap), count: 1 };
  }
  let best = meaningfulCloudList[0];
  best = mergeLocalDraftIfNewer(best, meaningfulLocalSnap);
  if (!draftHasMeaningfulProgress(best)) return { best: null, count: 0 };
  return { best, count: meaningfulCloudList.length };
}

async function resolveDraftRowForResume() {
  return (await resolveUnfinishedDrafts()).best;
}

/**
 * Deletes drafts that hold nothing the user authored (started, then abandoned) so they stop piling up.
 * Never touches a draft with exercises, notes, focus or a routine, and skips recent ones and the active workout.
 */
async function purgeEmptyStaleDrafts() {
  if (!currentUser) return 0;
  const uid = currentUser.uid;
  const ids = selectEmptyStaleDraftIds(await fetchSortedDraftWorkouts(), { activeId: activeWorkoutRef?.id || null });
  await Promise.all(ids.map((id) =>
    deleteDoc(doc(db, "users", uid, "workouts", id)).catch((e) => console.warn("Could not remove empty draft", id, e))
  ));
  return ids.length;
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
    const row = await resolveDraftRowForResume();
    els.resumeDraftBtn.disabled = !row;
  } catch (_) {
    els.resumeDraftBtn.disabled = true;
  }
}

/** Delete only the targeted draft workout doc and clear the matching local backup. */
async function discardWorkoutDraft(workoutId = activeWorkoutRef?.id || null) {
  if (!currentUser || !workoutId) return;
  if (activeWorkoutRef?.id === workoutId) {
    // Stop pending or late autosaves from re-creating the document while it is being deleted.
    isDiscardingWorkout = true;
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
  }
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "workouts", workoutId));
    const localSnap = readLocalDraftSnapshot();
    if (localSnap?.workoutId === workoutId) clearLocalDraft();
    if (activeWorkoutRef?.id === workoutId) {
      resetWorkoutState({ clearLocal: false });
      setAuthUI();
      setSaveIndicator("", "saved", 1);
    }
  } finally {
    isDiscardingWorkout = false;
  }
  setStatus("Draft discarded", "info");
}

/** Finish: same document becomes `final` — no duplicate completed rows. */
async function completeWorkoutFromDraft() {
  if (isFinishingWorkout || isDiscardingWorkout) return;
  if (!currentUser) {
    setStatus("Sign in before saving a workout.", "error");
    return;
  }
  if (!activeWorkoutRef) {
    setStatus("Start or resume a workout before finishing.", "error");
    return;
  }
  if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
  const finalExercises = [];
  workoutState.exercises.forEach((ex) => {
    const validSets = ex.sets.filter((s) => {
      const r = parseInt(String(s.reps ?? ""), 10) || 0;
      const w = String(s.weight ?? "").trim();
      return r > 0 || w !== "";
    });
    if (validSets.length > 0) {
      const { progress: _progress, ...finalExercise } = ex;
      finalExercises.push({ ...finalExercise, sets: validSets });
    }
  });
  if (finalExercises.length === 0) {
    return setStatus("Add reps (or weight + reps) to at least one set to finish.", "error");
  }
  finalExercises.sort((a, b) => {
    const timeA = a.firstEditTime || a.addedAt || 0;
    const timeB = b.firstEditTime || b.addedAt || 0;
    return timeA - timeB;
  });
  setFinishButtonState({ disabled: true, label: "Saving..." });
  setStatus("Finishing...", "info");
  isFinishingWorkout = true;
  try {
    if (!await confirmActiveWorkoutDate("finalize")) {
      setStatus("Workout not saved. Your draft is preserved.", "info");
      return;
    }
    writeLocalDraftSnapshot();
    // Let any autosave already sent reach the server before finalizing so it cannot land afterwards.
    // Bounded: offline, pending writes never ack and finalize will fail on its own anyway.
    await Promise.race([waitForPendingWrites(db), new Promise((resolve) => setTimeout(resolve, 5000))]).catch(() => {});
    const finalizedDate = selectedWorkoutDate();
    const finalizeWorkout = httpsCallable(functions, "finalizeWorkout");
    const finalizationId = `${activeWorkoutRef.id}_${Date.now()}`;
    const response = await finalizeWorkout({
      workoutId: activeWorkoutRef.id,
      finalizationId,
      exercises: finalExercises,
      routineName: workoutState.routineName,
      focus: workoutState.focus,
      date: finalizedDate,
      dateKey: finalizedDate,
      unit: els.unitSelect?.value || "lb",
      notes: workoutState.notes || "",
      templateId: workoutState.templateId,
    });
    if (!response?.data?.ok) throw new Error("Finalize did not return success.");
    invalidateFinalSetsCache(finalExercises.map((exercise) => exercise.exerciseId));
    resetWorkoutAnalyticsCaches();
    clearLocalDraft();
    resetWorkoutState({ clearLocal: false });
    const savedDate = response.data.workoutDate || finalizedDate;
    const verificationWarning = String(response?.data?.verificationWarning || "").trim();
    setStatus(
      verificationWarning
        ? `Workout saved for ${savedDate}. Verification warning recorded.`
        : `Workout verified and saved for ${savedDate}.`,
      "info"
    );
    setAuthUI();
    updateResumeDraftButtonState().catch(() => {});
    loadAnalytics().catch(() => {});
    populateDropdowns().catch(() => {});
    refreshRecentWorkoutsPage({ reset: true, renderLoading: false }).catch(() => {});
    scheduleAnalyticsRefresh();
  } catch (e) {
    console.error("Finish workout failed", e);
    const code = String(e?.code || "").replace(/^functions\//, "");
    const message = String(e?.message || "").trim();
    if (code === "failed-precondition" && /already finalized/i.test(message)) {
      // An earlier attempt went through but its response was lost. The workout is saved; drop the
      // stale draft state so it is not autosaved back to draft or offered for resume.
      clearLocalDraft();
      resetWorkoutState({ clearLocal: false });
      resetWorkoutAnalyticsCaches();
      setStatus("This workout was already saved by an earlier attempt.", "info");
      refreshRecentWorkoutsPage({ reset: true, renderLoading: false }).catch(() => {});
      loadAnalytics().catch(() => {});
      return;
    }
    setStatus(message || (code ? `Finish failed: ${code}` : "Finish failed"), "error");
  } finally {
    isFinishingWorkout = false;
    setFinishButtonState({ disabled: false, label: "Finish & Save" });
    setAuthUI();
  }
}

async function resumeLatestDraft() {
  if (!currentUser) return;
  try {
    els.draftRecoveryDialog?.close();
    const row = await resolveDraftRowForResume();
    if (!row) { setStatus("No draft to resume.", "error"); return; }
    const originalDate = row.dateKey || row.date || todayISO();
    const currentDate = todayISO();
    let choice = "keep";
    if (originalDate !== currentDate) choice = await requestWorkoutDateDecision(originalDate, currentDate, "resume");
    const resolution = applyDraftDateChoice(row, choice, currentDate);
    if (resolution.cancelled) {
      setStatus("Draft preserved. Resume it when you are ready.", "info");
      return;
    }
    await loadWorkoutDraft(resolution.draft, {
      dateOverride: resolution.selectedDate,
      dateChoice: choice,
      confirmedCurrentDate: currentDate,
    });
  } catch (e) {
    console.error(e);
    setStatus("Failed to resume draft", "error");
  }
}

function showDraftRecoveryDialog(row, count = 1, intro = "") {
  draftRecoveryShownThisSession = true;
  const localSnap = readLocalDraftSnapshot();
  const parts = [];
  if (intro) parts.push(intro);
  if (count > 1) parts.push(`You have ${count} unfinished workouts. This is the most recent.`);
  parts.push(`Last saved: ${new Date(row.updatedAtMs || Date.now()).toLocaleString()}`);
  parts.push(`Workout date: ${formatCalendarDate(row.dateKey || row.date)}.`);
  parts.push(`${(row.exercises || []).length} exercise(s), ${countLoggedSets(row.exercises)} logged set(s).`);
  if (draftHasMeaningfulProgress(localSnap) && localSnap?.workoutId === row.id) parts.push("A backup exists on this device (used if it is newer).");
  if (els.draftRecoveryText) els.draftRecoveryText.textContent = parts.join(" ");
  if (els.draftRecoveryDialog && !els.draftRecoveryDialog.open) els.draftRecoveryDialog.showModal();
}

async function offerDraftRecoveryIfNeeded() {
  if (!currentUser || activeWorkoutRef || draftRecoveryShownThisSession) return;
  const uidAtStart = currentUser.uid;
  await updateResumeDraftButtonState();
  const { best: row, count } = await resolveUnfinishedDrafts();
  if (!currentUser || currentUser.uid !== uidAtStart || activeWorkoutRef || draftRecoveryShownThisSession) return;
  if (!row) return;
  showDraftRecoveryDialog(row, count);
}

/**
 * One unfinished workout at a time: silently starting another would orphan the old draft and bring the
 * resume prompt back forever. Returns true (after showing the prompt) when the caller must not start a new one.
 */
async function blockStartIfUnfinishedDraft() {
  if (!currentUser || activeWorkoutRef) return false;
  let found;
  try { found = await resolveUnfinishedDrafts(); } catch (_) { return false; }
  if (!found.best) return false;
  showDraftRecoveryDialog(found.best, found.count, "Finish or discard this workout before starting a new one.");
  return true;
}

function suppressDraftRecoveryForNewStart() {
  draftRecoveryShownThisSession = true;
  els.draftRecoveryDialog?.close();
}

// Focus + session fields trigger debounced save
document.querySelectorAll('input[name="workoutFocus"]').forEach(cb => {
  cb.addEventListener("change", () => {
    workoutState.focus = Array.from(document.querySelectorAll('input[name="workoutFocus"]:checked')).map(el => el.value);
    scheduleAutosave();
  });
});
els.dateInput?.addEventListener("change", () => {
  dateInputManuallySelected = true;
  clearWorkoutDateConfirmation();
  scheduleAutosave();
});
els.unitSelect?.addEventListener("change", () => {
  renderAllSetComparisons();
  scheduleAutosave();
});
els.workoutNotesInput?.addEventListener("input", () => {
  workoutState.notes = els.workoutNotesInput.value;
  scheduleAutosave();
});

els.resumeDraftBtn?.addEventListener("click", () => resumeLatestDraft());
els.discardWorkoutBtn?.addEventListener("click", async () => {
  if (!currentUser || !activeWorkoutRef || isFinishingWorkout || isDiscardingWorkout) return;
  const logged = countLoggedSets(workoutState.exercises);
  const detail = logged > 0 ? `${logged} logged set(s) will be permanently deleted.` : "Nothing has been logged yet.";
  if (!confirm(`Discard this workout? ${detail} This cannot be undone.`)) return;
  try {
    await discardWorkoutDraft(activeWorkoutRef.id);
    await updateResumeDraftButtonState();
  } catch (e) {
    console.error("Discard workout failed", e);
    setStatus("Could not discard workout", "error");
  }
});
els.draftRecoveryResume?.addEventListener("click", () => resumeLatestDraft());
els.draftRecoveryDiscard?.addEventListener("click", async () => {
  try {
    els.draftRecoveryDiscard.disabled = true;
    const { best: row } = await resolveUnfinishedDrafts();
    if (!row?.id) {
      clearLocalDraft();
      els.draftRecoveryDialog?.close();
      await updateResumeDraftButtonState();
      return;
    }
    const logged = countLoggedSets(row.exercises);
    if (logged > 0 && !confirm(`Permanently delete the unfinished workout from ${formatCalendarDate(row.dateKey || row.date)} (${logged} logged set(s))? This cannot be undone.`)) return;
    await discardWorkoutDraft(row.id);
    // Several drafts can exist: keep the prompt open for the next one so they can be cleared one by one.
    const next = await resolveUnfinishedDrafts();
    if (next.best) showDraftRecoveryDialog(next.best, next.count);
    else els.draftRecoveryDialog?.close();
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
  workoutState.exercises.forEach((exercise) => {
    if (exercise.progress?.status === "offline" || exercise.progress?.status === "error") {
      ensureExerciseProgressLoaded(exercise, { force: true }).catch(() => {});
    }
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && activeWorkoutRef) {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    writeLocalDraftSnapshot();
    saveWorkoutDraft().catch(() => {});
  } else if (document.visibilityState === "visible") {
    recheckWorkoutDateAfterReturn().catch((error) => console.warn("Workout date recheck failed", error));
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
  return (arr || []).map(ex => ({
    ...ex,
    exerciseNote: ex.exerciseNote != null ? String(ex.exerciseNote) : "",
    lastSets: (Array.isArray(ex.lastSets) ? ex.lastSets : []).filter(isCompletedSet),
  }));
}

// After a deploy a new service worker takes over. Reload onto the new version, but never in the middle of a workout:
// the page then keeps running and the new version loads the next time the app is opened.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloadingForUpdate || activeWorkoutRef || isFinishingWorkout || isDiscardingWorkout) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
}

window.addEventListener("beforeunload", () => {
  if (activeWorkoutRef && currentUser) {
    try { localStorage.setItem(localDraftStorageKey(currentUser.uid), JSON.stringify(buildLocalDraftSnapshot())); } catch (_) { /* ignore */ }
  }
});

// ==================== AUTH ====================
function formatAuthError(error) {
  const code = String(error?.code || "").replace(/^auth\//, "");
  if (code === "unauthorized-domain") return "Sign-in failed: this domain is not authorized in Firebase Auth.";
  if (code === "popup-blocked") return "Popup was blocked. Redirecting to Google sign-in...";
  if (code === "popup-closed-by-user" || code === "cancelled-popup-request") return "Popup closed. Redirecting to Google sign-in...";
  return `Sign-in failed${code ? `: ${code}` : "."}`;
}

async function startGoogleSignIn() {
  if (!els.signInBtn) return;
  els.signInBtn.disabled = true;
  setStatus("Opening Google sign-in...", "info");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("FIREBASE AUTH ERROR:", {
      code: error?.code || null,
      message: error?.message || String(error),
    });
    setStatus(formatAuthError(error), "error");
    const code = String(error?.code || "");
    if (
      code === "auth/popup-blocked" ||
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request"
    ) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
  } finally {
    els.signInBtn.disabled = false;
  }
}

getRedirectResult(auth).catch((error) => {
  console.error("FIREBASE AUTH REDIRECT ERROR:", {
    code: error?.code || null,
    message: error?.message || String(error),
  });
  setStatus(formatAuthError(error), "error");
});

els.signInBtn?.addEventListener("click", () => startGoogleSignIn());
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
    resetRecentWorkoutsState();
    resetWorkoutState({ clearLocal: false });
    setAuthUI();
    if (els.templatesList) els.templatesList.innerHTML = `<div class="text-zinc-500 text-sm">Sign in to see routines.</div>`;
    renderRecentWorkoutsSignedOut();
    handleRouteChange();
    return;
  }
  await runBootstrapStep("lastSeen", () =>
    setDoc(doc(db, "users", currentUser.uid), { lastSeen: serverTimestamp() }, { merge: true })
  );
  await runBootstrapStep("favorites", () => initFavoriteExercisesForUser());
  runBootstrapStep("prs listener", async () => listenToPRs());
  runBootstrapStep("analytics", () => loadAnalytics());
  runBootstrapStep("templates", () => loadTemplates());
  runBootstrapStep("integrity check", () => runIntegrityCheckIfDue());
  setAuthUI();
  setActiveBadge();
  renderWorkoutBuilder();
  await runBootstrapStep("dropdowns", () => populateDropdowns());
  await runBootstrapStep("draft cleanup", () => purgeEmptyStaleDrafts());
  await runBootstrapStep("resume button", () => updateResumeDraftButtonState());
  await runBootstrapStep("draft recovery", () => offerDraftRecoveryIfNeeded());
  handleRouteChange();
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
els.createCustomExerciseBtn?.addEventListener("click", () => promptCreateCustomExercise());

async function saveCustomExerciseByName(name, { addToActiveWorkout = true } = {}) {
  if (!currentUser) {
    setStatus("Sign in to create custom exercises.", "error");
    return null;
  }
  const cleanName = String(name || "").trim();
  const nameLower = normalizeSearchText(cleanName);
  if (!cleanName || !nameLower) {
    setStatus("Enter an exercise name first.", "error");
    return null;
  }

  const existingSnap = await getDocs(
    query(collection(db, "users", currentUser.uid, "custom_exercises"), where("nameLower", "==", nameLower), limit(1))
  );
  const existing = existingSnap.empty ? null : { id: existingSnap.docs[0].id, ...existingSnap.docs[0].data() };
  const exercise = existing || {
    id: (await addDoc(collection(db, "users", currentUser.uid, "custom_exercises"), {
      name: cleanName.slice(0, 120),
      nameLower,
      createdAt: serverTimestamp(),
    })).id,
    name: cleanName.slice(0, 120),
  };

  if (addToActiveWorkout && activeWorkoutRef) {
    addExerciseToWorkout(exercise.id, exercise.name || cleanName);
  }
  if (els.searchInput) els.searchInput.value = exercise.name || cleanName;
  await searchExercises(exercise.name || cleanName);
  setStatus(existing ? "Custom exercise already exists." : "Custom exercise saved.", "info");
  return exercise;
}

async function promptCreateCustomExercise() {
  const suggested = String(els.searchInput?.value || "").trim();
  const name = prompt("Custom exercise name", suggested);
  if (!name || !name.trim()) return;
  try {
    await saveCustomExerciseByName(name, { addToActiveWorkout: true });
  } catch (e) {
    console.error("Custom exercise creation failed", e);
    setStatus("Failed to create custom exercise.", "error");
  }
}

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
          await saveCustomExerciseByName(term, { addToActiveWorkout: true });
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

function buildFallbackAiExerciseId(name, index) {
  const normalized = normalizeSearchText(name).replace(/\s+/g, "_").slice(0, 48) || "exercise";
  return `ai_${Date.now()}_${index}_${normalized}`;
}

async function resolveExerciseIdForAi(name, index) {
  try {
    const match = await findOrCreateExerciseId(name);
    if (match?.id && match?.name) return match;
  } catch (e) {
    if (/permission|insufficient/i.test(String(e?.message || ""))) {
      console.warn("AI exercise lookup fell back to local-only id", { name, message: e.message });
      return { id: buildFallbackAiExerciseId(name, index), name: name.trim() || "Exercise" };
    }
    throw e;
  }
  return { id: buildFallbackAiExerciseId(name, index), name: name.trim() || "Exercise" };
}

/** Clears cached “last sets” reads and chart workout sample after workout/PR changes. */
function exerciseProgressStorageKey(uid, exerciseId) {
  return uid && exerciseId ? `${EXERCISE_PROGRESS_CACHE_KEY_PREFIX}${uid}:${encodeURIComponent(exerciseId)}` : null;
}

function readLocalExerciseProgress(exerciseId) {
  const key = exerciseProgressStorageKey(currentUser?.uid, exerciseId);
  if (!key) return null;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    const sessions = normalizeCachedExerciseSessions(stored?.sessions, 5, isCompletedSet);
    if (!sessions.length) return null;
    return {
      sessions,
      pr: stored?.pr && typeof stored.pr === "object" ? stored.pr : null,
      exerciseNote: String(stored?.exerciseNote || sessions[0]?.exerciseNote || "").slice(0, 500),
    };
  } catch (_) {
    return null;
  }
}

function writeLocalExerciseProgress(exerciseId, progress) {
  const key = exerciseProgressStorageKey(currentUser?.uid, exerciseId);
  const sessions = normalizeCachedExerciseSessions(progress?.sessions, 5, isCompletedSet);
  if (!key || !sessions.length) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      sessions,
      pr: progress?.pr || null,
      exerciseNote: String(progress?.exerciseNote || sessions[0]?.exerciseNote || "").slice(0, 500),
      cachedAtMs: Date.now(),
    }));
  } catch (_) { /* storage unavailable */ }
}

function clearLocalExerciseProgress(exerciseIds) {
  (Array.isArray(exerciseIds) ? exerciseIds : []).forEach((exerciseId) => {
    const key = exerciseProgressStorageKey(currentUser?.uid, exerciseId);
    if (!key) return;
    try { localStorage.removeItem(key); } catch (_) { /* storage unavailable */ }
  });
}

function hydrateExerciseProgressReference(exercise) {
  const existingSessions = normalizeCachedExerciseSessions(exercise?.progress?.sessions, 5, isCompletedSet);
  const localProgress = existingSessions.length ? null : readLocalExerciseProgress(exercise?.exerciseId);
  const sessions = existingSessions.length ? existingSessions : (localProgress?.sessions || []);
  exercise.lastSets = sessions[0]?.sets || [];
  if (sessions.length) {
    exercise.progress = {
      status: navigator.onLine === false ? "offline" : (exercise.progress?.status || "loading"),
      sessions,
      pr: exercise.progress?.pr || localProgress?.pr || null,
      exerciseNote: exercise.progress?.exerciseNote || localProgress?.exerciseNote || "",
    };
  }
}

function invalidateFinalSetsCache(exerciseIds = []) {
  finalHistoryPages = { uid: null, pages: [] };
  chartWorkoutsSample = [];
  chartWorkoutsLoadPromise = null;
  exerciseProgressCache.clear();
  clearLocalExerciseProgress(exerciseIds);
}

async function fetchLastFinalSetsForExerciseSafe(exerciseId) {
  const context = await fetchLastExerciseContextSafe(exerciseId);
  return context.sets;
}

async function fetchLastExerciseContextSafe(exerciseId) {
  const fallback = { sets: [], exerciseNote: "" };
  if (!currentUser || !exerciseId) return fallback;
  try {
    const progress = await fetchExerciseProgress(exerciseId);
    return {
      sets: progress.sessions?.[0]?.sets || [],
      exerciseNote: String(progress.exerciseNote || "").slice(0, 500),
    };
  } catch (_) { /* offline with no validated cache */ }
  return fallback;
}

function findExerciseCard(exerciseId) {
  return [...(els.workoutExercises?.querySelectorAll("[data-exercise-id]") || [])]
    .find((card) => card.dataset.exerciseId === exerciseId) || null;
}

function formatProgressSet(set, unit) {
  const weight = String(set?.weight ?? "").trim() || "0";
  const reps = String(set?.reps ?? "").trim() || "0";
  return `${escapeHtml(weight)} ${escapeHtml(unit)} × ${escapeHtml(reps)}`;
}

function bestProgressSet(progress) {
  if (progress?.pr && Number(progress.pr.reps) > 0) {
    return { set: progress.pr, unit: progress.pr.unit === "kg" ? "kg" : "lb" };
  }
  const currentUnit = els.unitSelect?.value || "lb";
  const candidates = (progress?.sessions || []).flatMap((session) =>
    session.unit === currentUnit
      ? filterScorableSets(session.sets).map((set) => ({ set, unit: session.unit }))
      : []
  );
  if (!candidates.length) return null;
  return candidates.reduce((best, candidate) =>
    isNewPRBeatsCurrent(candidate.set, best.set) ? candidate : best
  );
}

function exerciseProgressHtml(exercise) {
  const progress = exercise.progress || { status: "loading", sessions: [] };
  const sessions = progress.sessions || [];
  const stateMessage = progressStateMessage(progress.status, sessions.length);
  if (!sessions.length) {
    const retry = progress.status === "offline" || progress.status === "error"
      ? `<button type="button" class="retry-progress mt-2 text-xs font-semibold text-emerald-400 hover:text-emerald-300">Retry</button>`
      : "";
    return `<div class="exercise-progress rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 py-3 mb-4 text-sm text-zinc-400">${escapeHtml(stateMessage)}${retry}</div>`;
  }

  const latest = sessions[0];
  const best = bestProgressSet(progress);
  const warning = stateMessage
    ? `<div class="mb-2 text-xs ${progress.status === "offline" ? "text-amber-300" : "text-red-300"}">${escapeHtml(stateMessage)}</div>`
    : "";
  const latestSets = latest.sets.map((set, index) =>
    `<div class="flex justify-between gap-3"><span class="text-zinc-500">Set ${index + 1}</span><span class="font-medium text-zinc-200">${formatProgressSet(set, latest.unit)}</span></div>`
  ).join("");
  const history = sessions.map((session) => `
    <div class="border-t border-zinc-800 py-2 first:border-t-0 first:pt-0">
      <div class="mb-1 text-xs font-semibold text-zinc-300">${escapeHtml(formatCalendarDate(session.date))}</div>
      <div class="text-xs text-zinc-500">${session.sets.map((set) => formatProgressSet(set, session.unit)).join(" · ")}</div>
    </div>`).join("");
  return `<section class="exercise-progress rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 py-3 mb-4" aria-label="Previous performance for ${escapeHtml(exercise.name)}">
    ${warning}
    <div class="flex flex-wrap items-baseline justify-between gap-2 mb-2">
      <div class="text-sm font-semibold text-zinc-200">Last time — ${escapeHtml(formatCalendarDate(latest.date, { includeYear: false }))}</div>
      ${best ? `<div class="text-xs font-semibold text-amber-300">Best: ${formatProgressSet(best.set, best.unit)}</div>` : ""}
    </div>
    <div class="space-y-1 text-xs">${latestSets}</div>
    <details class="mt-3 border-t border-zinc-800 pt-2">
      <summary class="cursor-pointer select-none text-xs font-semibold text-emerald-400">Recent history (${sessions.length})</summary>
      <div class="mt-2">${history}</div>
    </details>
  </section>`;
}

function comparisonDirectionHtml(label, value) {
  const presentation = {
    increased: { symbol: "↑", text: "increased", className: "text-emerald-400" },
    same: { symbol: "=", text: "same", className: "text-zinc-400" },
    decreased: { symbol: "↓", text: "decreased", className: "text-amber-300" },
  }[value];
  if (!presentation) return "";
  return `<span class="${presentation.className}">${escapeHtml(label)} ${presentation.symbol} ${presentation.text}</span>`;
}

function setComparisonHtml(exercise, setIndex) {
  const previousSession = exercise.progress?.sessions?.[0];
  const previousSet = previousSession?.sets?.[setIndex];
  if (!previousSet) return "";
  const currentUnit = els.unitSelect?.value || "lb";
  if (previousSession.unit !== currentUnit) {
    return `<span class="text-zinc-500">Previous set used ${escapeHtml(previousSession.unit)}; comparison unavailable.</span>`;
  }
  const comparison = compareSetPerformance(exercise.sets[setIndex], previousSet, prSetVolume);
  if (!comparison.comparable) return `<span class="text-zinc-500">Compared with ${formatProgressSet(previousSet, previousSession.unit)}</span>`;
  return [
    comparisonDirectionHtml("Weight", comparison.weight),
    comparisonDirectionHtml("Reps", comparison.reps),
    comparisonDirectionHtml("Score", comparison.score),
  ].filter(Boolean).join(`<span class="text-zinc-700"> · </span>`);
}

function updateSetComparisonRow(card, exercise, setIndex) {
  const target = [...card.querySelectorAll("[data-comparison-idx]")]
    .find((row) => Number(row.dataset.comparisonIdx) === setIndex);
  if (target) target.innerHTML = setComparisonHtml(exercise, setIndex);
}

function updateExerciseSetPlaceholders(card, exercise) {
  card.querySelectorAll("[data-idx]").forEach((row) => {
    const setIndex = Number(row.dataset.idx);
    const weightInput = row.querySelector(".w");
    const repsInput = row.querySelector(".r");
    if (weightInput) weightInput.placeholder = previousSetPlaceholder(exercise.lastSets, setIndex, "weight");
    if (repsInput) repsInput.placeholder = previousSetPlaceholder(exercise.lastSets, setIndex, "reps");
  });
}

function renderAllSetComparisons() {
  workoutState.exercises.forEach((exercise) => updateExerciseProgressPanel(exercise));
}

function updateExerciseProgressPanel(exercise) {
  const card = findExerciseCard(exercise.exerciseId);
  const panel = card?.querySelector(".exercise-progress");
  if (!card || !panel) return;
  panel.outerHTML = exerciseProgressHtml(exercise);
  card.querySelector(".retry-progress")?.addEventListener("click", () => ensureExerciseProgressLoaded(exercise, { force: true }));
  updateExerciseSetPlaceholders(card, exercise);
  exercise.sets.forEach((_set, index) => updateSetComparisonRow(card, exercise, index));
}

// Newest finalized workouts, read once per session and shared by every exercise card. Each card used to page
// through the whole history on its own, so a 6-exercise workout re-read the same documents six times over.
const FINAL_HISTORY_PAGE_SIZE = 50;
const FINAL_HISTORY_MAX_PAGES = 4;

function loadFinalHistoryPage(index) {
  const uid = currentUser.uid;
  if (finalHistoryPages.uid !== uid) finalHistoryPages = { uid, pages: [] };
  const state = finalHistoryPages;
  if (!state.pages[index]) {
    const load = (async () => {
      const previous = index > 0 ? await loadFinalHistoryPage(index - 1) : null;
      if (previous && !previous.hasMore) return { workouts: [], cursor: null, hasMore: false };
      const constraints = [
        where("status", "==", "final"),
        orderBy("updatedAtMs", "desc"),
        limit(FINAL_HISTORY_PAGE_SIZE),
      ];
      if (previous) constraints.push(startAfter(previous.cursor));
      const snap = await getDocs(query(collection(db, "users", uid, "workouts"), ...constraints));
      return {
        workouts: snap.docs.map((workoutSnap) => ({ id: workoutSnap.id, ...workoutSnap.data() })),
        cursor: snap.docs[snap.docs.length - 1] || null,
        hasMore: snap.size === FINAL_HISTORY_PAGE_SIZE,
      };
    })();
    state.pages[index] = load;
    // A failed read must not be cached, or every later card would fail the same way until reload.
    load.catch(() => { if (state.pages[index] === load) delete state.pages[index]; });
  }
  return state.pages[index];
}

async function fetchExerciseProgress(exerciseId) {
  const cacheKey = `${currentUser?.uid || "signed-out"}:${exerciseId}`;
  if (exerciseProgressCache.has(cacheKey)) return exerciseProgressCache.get(cacheKey);
  const request = (async () => {
    const localProgress = readLocalExerciseProgress(exerciseId);
    // Stops after FINAL_HISTORY_MAX_PAGES pages: an exercise you have never logged would otherwise read every
    // workout you have ever saved. `complete` is false when the cap cut the scan short.
    const fetchFinalizedSessions = async () => {
      const workouts = [];
      let sessions = [];
      for (let index = 0; index < FINAL_HISTORY_MAX_PAGES; index++) {
        const page = await loadFinalHistoryPage(index);
        workouts.push(...page.workouts);
        sessions = selectPreviousExerciseSessions(
          workouts,
          exerciseId,
          activeWorkoutRef?.id || null,
          5,
          isCompletedSet,
          completedExerciseSetRows
        );
        if (sessions.length >= 5 || !page.hasMore) return { sessions, complete: true };
      }
      return { sessions, complete: false };
    };
    const [historyResult, lastSetsResult, prResult] = await Promise.allSettled([
      fetchFinalizedSessions(),
      getDoc(doc(db, "users", currentUser.uid, "exercise_last_sets", exerciseId)),
      getDoc(doc(db, "users", currentUser.uid, "prs", exerciseId)),
    ]);
    const lastData = lastSetsResult.status === "fulfilled" && lastSetsResult.value.exists()
      ? lastSetsResult.value.data()
      : null;
    const derivedSessions = lastData &&
      lastData.sourceExerciseCompleted === true &&
      (lastData.unit === "lb" || lastData.unit === "kg") &&
      lastData.sourceWorkoutId !== activeWorkoutRef?.id
      ? normalizeCachedExerciseSessions([{
        workoutId: lastData.sourceWorkoutId || "last-sets-cache",
        date: lastData.sourceWorkoutDate || "",
        unit: lastData.unit,
        exerciseNote: String(lastData.exerciseNote || "").slice(0, 500),
        sets: lastData.sets,
        updatedAtMs: Number(lastData.updatedAtMs) || 0,
      }], 1, isCompletedSet)
      : [];
    const historyUnavailable = historyResult.status === "rejected" || navigator.onLine === false;
    const sessions = resolveExerciseSessions({
      history: historyResult.status === "fulfilled" ? historyResult.value : null,
      derivedSessions,
      cachedSessions: localProgress?.sessions || [],
      historyUnavailable,
      limit: 5,
      isCompletedSet,
    });
    const latestSession = sessions[0] || null;
    const pr = prResult.status === "fulfilled" && prResult.value.exists()
      ? prResult.value.data()
      : localProgress?.pr || null;
    const exerciseNote = latestSession?.exerciseNote || (
      lastData && latestSession && lastData.sourceWorkoutId === latestSession.workoutId ? String(lastData.exerciseNote || "").slice(0, 500) : ""
    ) || String(localProgress?.exerciseNote || "").slice(0, 500);
    const progress = {
      status: historyUnavailable ? (navigator.onLine === false ? "offline" : "error") : "ready",
      sessions,
      pr,
      exerciseNote,
    };
    if (sessions.length) writeLocalExerciseProgress(exerciseId, progress);
    else if (!historyUnavailable) clearLocalExerciseProgress([exerciseId]);
    return progress;
  })();
  exerciseProgressCache.set(cacheKey, request);
  return request;
}

async function ensureExerciseProgressLoaded(exercise, options = {}) {
  if (!currentUser || !exercise?.exerciseId) return;
  const cacheKey = `${currentUser.uid}:${exercise.exerciseId}`;
  if (options.force) exerciseProgressCache.delete(cacheKey);
  const localProgress = readLocalExerciseProgress(exercise.exerciseId);
  const initialSessions = normalizeCachedExerciseSessions([
    ...(exercise.progress?.sessions || []),
    ...(localProgress?.sessions || []),
  ], 5, isCompletedSet);
  exercise.progress = {
    status: navigator.onLine === false && initialSessions.length ? "offline" : "loading",
    sessions: initialSessions,
    pr: exercise.progress?.pr || localProgress?.pr || null,
    exerciseNote: exercise.progress?.exerciseNote || localProgress?.exerciseNote || "",
  };
  exercise.lastSets = initialSessions[0]?.sets || (exercise.lastSets || []).filter(isCompletedSet);
  updateExerciseProgressPanel(exercise);
  try {
    const progress = await fetchExerciseProgress(exercise.exerciseId);
    if (!workoutState.exercises.includes(exercise)) return;
    exercise.progress = progress;
    exercise.lastSets = progress.sessions?.[0]?.sets || [];
    if (!exercise.exerciseNote && progress.exerciseNote) {
      exercise.exerciseNote = progress.exerciseNote;
      const card = findExerciseCard(exercise.exerciseId);
      const note = card?.querySelector(".exercise-note-input");
      if (note && !note.value) note.value = progress.exerciseNote;
      scheduleAutosave();
    }
    updateExerciseProgressPanel(exercise);
  } catch (error) {
    console.warn("Exercise progress load failed", error);
    exercise.progress = { status: navigator.onLine === false ? "offline" : "error", sessions: [] };
    exerciseProgressCache.delete(cacheKey);
    updateExerciseProgressPanel(exercise);
  }
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

function clearAiPreview() {
  pendingAiRoutine = null;
  if (els.aiPreviewList) els.aiPreviewList.innerHTML = "";
  els.aiPreviewWrap?.classList.add("hidden");
  els.aiPreviewActions?.classList.add("hidden");
}

function renderAiPreview(aiExercises) {
  if (!els.aiPreviewList) return;
  els.aiPreviewList.innerHTML = "";
  aiExercises.forEach((ex, index) => {
    const card = document.createElement("div");
    card.className = "rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-3";
    card.innerHTML = `<div class="flex items-start justify-between gap-3"><div><div class="font-medium text-zinc-100">${index + 1}. ${escapeHtml(ex.name)}</div><div class="mt-1 text-sm text-zinc-400">${escapeHtml(String(ex.sets))} sets × ${escapeHtml(ex.reps)}</div></div></div>`;
    els.aiPreviewList.appendChild(card);
  });
  els.aiPreviewWrap?.classList.remove("hidden");
  els.aiPreviewActions?.classList.remove("hidden");
}

async function applyPendingAiRoutine() {
  if (!currentUser || !pendingAiRoutine?.exercises?.length) return;
  if (activeWorkoutRef && !confirm("You have an active workout in progress. Replace it with this AI routine?")) return;
  if (await blockStartIfUnfinishedDraft()) return;
  suppressDraftRecoveryForNewStart();
  clearAiError();
  try {
    els.applyAiPreviewBtn.disabled = true;
    els.discardAiPreviewBtn.disabled = true;
    els.applyAiPreviewBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Applying...`;

    const newExercises = [];
    for (const [index, aiEx] of pendingAiRoutine.exercises.entries()) {
      const dbMatch = await resolveExerciseIdForAi(aiEx.name, index);
      const lastContext = await fetchLastExerciseContextSafe(dbMatch.id);
      const generatedSets = [];
      const numSets = Number(aiEx.sets) || 3;
      for (let i = 0; i < numSets; i++) generatedSets.push({ weight: "", reps: String(aiEx.reps || "10"), rpe: "" });
      newExercises.push({
        exerciseId: dbMatch.id,
        name: dbMatch.name,
        exerciseNote: lastContext.exerciseNote,
        sets: generatedSets,
        lastSets: lastContext.sets,
        addedAt: Date.now(),
        firstEditTime: null,
        lastEditTime: null,
      });
    }

    let targetWorkoutRef = activeWorkoutRef;
    if (!targetWorkoutRef) {
      const workoutDate = resolveDateForNewWorkout();
      targetWorkoutRef = await createWorkoutDraftInFirestore({
        exercises: [],
        date: workoutDate,
        dateKey: workoutDate,
        unit: els.unitSelect?.value || "lb",
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
    clearAiPreview();
    els.aiModal?.close();
    if (els.aiPromptInput) els.aiPromptInput.value = "";
    setActiveBadge();
    setAuthUI();
    renderWorkoutBuilder();
    await updateResumeDraftButtonState();
    setStatus("AI routine loaded into your workout draft.", "info");
  } catch (e) {
    console.error("AI apply failed", e);
    showAiError(e?.message || "Could not apply this AI routine.");
  } finally {
    els.applyAiPreviewBtn.disabled = false;
    els.discardAiPreviewBtn.disabled = false;
    els.applyAiPreviewBtn.innerHTML = `Use Routine`;
  }
}

function openAiRoutineModal() {
  if (!currentUser) return alert("Please sign in to use the AI Generator.");
  clearAiError();
  clearAiPreview();
  els.aiModal?.showModal();
}
els.openAiModalBtn?.addEventListener("click", openAiRoutineModal);
els.openAiModalBtnRoutines?.addEventListener("click", openAiRoutineModal);
els.closeAiModalBtn?.addEventListener("click", () => { clearAiError(); clearAiPreview(); els.aiModal?.close(); });

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
    pendingAiRoutine = {
      prompt,
      exercises: payload.exercises,
      generatedAtMs: Date.now(),
    };
    renderAiPreview(payload.exercises);
    setStatus("AI routine preview ready.", "info");
  } catch (e) {
    console.error("AI Generation Error", e);
    const msg = e?.message || "Failed to generate AI routine.";
    showAiError(/resource-exhausted|too-many-requests|unauthenticated|invalid-argument/i.test(String(e?.code || msg)) ? msg : `${msg} If this persists, confirm the function is deployed and configured.`);
  } finally {
    els.generateAiBtn.innerHTML = `Generate Routine`;
    els.generateAiBtn.disabled = false;
  }
});
els.applyAiPreviewBtn?.addEventListener("click", () => applyPendingAiRoutine());
els.discardAiPreviewBtn?.addEventListener("click", () => {
  clearAiPreview();
  clearAiError();
  setStatus("AI routine discarded.", "info");
});

// ==================== TEMPLATES ====================
let currentEditTemplateId = null; let currentEditTemplateExercises = [];
let loadedTemplates = [];

function renderTemplatesList() {
    if (!els.templatesList) return;
    els.templatesList.innerHTML = "";
    if (!loadedTemplates.length) { els.templatesList.innerHTML = `<div class="text-zinc-500 text-sm">No routines saved yet.</div>`; return; }
    loadedTemplates.forEach((template, position) => {
        const div = document.createElement("div"); div.className = "bg-zinc-800 p-4 rounded-xl border border-zinc-700 flex justify-between items-center hover:border-indigo-500/50 transition-colors group";
        div.innerHTML = `<div class="flex flex-col gap-1 pr-3"><button type="button" class="moveTemplateUp ${MOVE_BTN_CLASS}" title="Move up" aria-label="Move ${escapeHtml(template.name)} up"${position === 0 ? " disabled" : ""}><i class="fa-solid fa-chevron-up"></i></button><button type="button" class="moveTemplateDown ${MOVE_BTN_CLASS}" title="Move down" aria-label="Move ${escapeHtml(template.name)} down"${position === loadedTemplates.length - 1 ? " disabled" : ""}><i class="fa-solid fa-chevron-down"></i></button></div><div class="flex-1 pr-4 min-w-0"><div class="font-bold text-zinc-100 group-hover:text-indigo-400 transition-colors">${escapeHtml(template.name)}</div><div class="text-xs text-zinc-400 mt-1">${(template.exercises || []).map(e => e.name).join(", ").substring(0, 40)}...</div></div><div class="flex items-center gap-2"><button class="editTemplateBtn text-zinc-400 hover:text-white px-3 py-2 rounded-lg bg-zinc-700/50 hover:bg-zinc-700 transition-colors border border-zinc-700"><i class="fa-solid fa-pen"></i></button><button class="startTemplateBtn bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-indigo-900/20 transition-colors">Start</button></div>`;
        div.querySelector(".startTemplateBtn").onclick = () => startWorkoutFromTemplate(template.id, template);
        div.querySelector(".editTemplateBtn").onclick = () => openTemplateEditModal(template.id, template);
        div.querySelector(".moveTemplateUp").onclick = () => moveTemplate(template.id, -1);
        div.querySelector(".moveTemplateDown").onclick = () => moveTemplate(template.id, 1);
        els.templatesList.appendChild(div);
    });
}

async function loadTemplates() {
    if (!currentUser || !els.templatesList) return;
    try {
        const q = query(collection(db, "users", currentUser.uid, "templates"), limit(100));
        const snap = await getDocs(q);
        loadedTemplates = sortRoutines(snap.docs.map((d) => {
            const data = d.data();
            return { ...data, id: d.id, createdAtMs: typeof data.createdAt?.toMillis === "function" ? data.createdAt.toMillis() : 0 };
        }));
        renderTemplatesList();
    } catch (e) {
        console.error("Failed to load routines", e);
        els.templatesList.innerHTML = `<div class="text-red-400 rounded-xl border border-red-500/20 bg-red-500/5 py-6 px-4 text-center text-sm">Could not load routines.</div>`;
    }
}

/** Reorders the routines list and saves the new order so it is the same next time. */
async function moveTemplate(id, delta) {
    if (!currentUser) return;
    const { routines, updates } = moveRoutine(loadedTemplates, id, delta);
    if (!updates.length) return;
    const previous = loadedTemplates;
    loadedTemplates = routines;
    renderTemplatesList();
    try {
        const batch = writeBatch(db);
        updates.forEach(({ id: templateId, order }) => batch.update(doc(db, "users", currentUser.uid, "templates", templateId), { order }));
        await batch.commit();
    } catch (e) {
        console.error("Failed to save routine order", e);
        loadedTemplates = previous;
        renderTemplatesList();
        setStatus("Could not save the new routine order.", "error");
    }
}

function openTemplateEditModal(id, template) { currentEditTemplateId = id; els.editTemplateName.value = template.name; currentEditTemplateExercises = [...(template.exercises || [])]; renderEditTemplateExercises(); els.templateModal.showModal(); }
function renderEditTemplateExercises() {
    els.editTemplateExercises.innerHTML = ""; if (currentEditTemplateExercises.length === 0) { els.editTemplateExercises.innerHTML = `<div class="text-zinc-500 text-sm">No exercises.</div>`; return; }
    currentEditTemplateExercises.forEach((ex, idx) => {
        const div = document.createElement("div"); div.className = "flex justify-between items-center bg-zinc-800 border border-zinc-700 p-3 rounded-lg";
        const last = currentEditTemplateExercises.length - 1;
        div.innerHTML = `<span class="text-sm font-medium text-zinc-200 flex-1 min-w-0 truncate">${escapeHtml(ex.name)}</span><div class="flex items-center gap-2"><button type="button" class="ex-move-up ${MOVE_BTN_CLASS}" title="Move up" aria-label="Move ${escapeHtml(ex.name)} up"${idx === 0 ? " disabled" : ""}><i class="fa-solid fa-chevron-up"></i></button><button type="button" class="ex-move-down ${MOVE_BTN_CLASS}" title="Move down" aria-label="Move ${escapeHtml(ex.name)} down"${idx === last ? " disabled" : ""}><i class="fa-solid fa-chevron-down"></i></button><button type="button" class="ex-remove text-red-400 hover:text-red-300 px-3 py-1 bg-red-400/10 rounded border border-red-400/20" title="Remove"><i class="fa-solid fa-minus"></i></button></div>`;
        div.querySelector(".ex-move-up").onclick = () => { currentEditTemplateExercises = moveListItem(currentEditTemplateExercises, idx, -1); renderEditTemplateExercises(); };
        div.querySelector(".ex-move-down").onclick = () => { currentEditTemplateExercises = moveListItem(currentEditTemplateExercises, idx, 1); renderEditTemplateExercises(); };
        div.querySelector(".ex-remove").onclick = () => { currentEditTemplateExercises.splice(idx, 1); renderEditTemplateExercises(); }; els.editTemplateExercises.appendChild(div);
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
    if (await blockStartIfUnfinishedDraft()) return;
    try {
        suppressDraftRecoveryForNewStart();
        setStatus("Starting Routine...");
        if (els.startWorkoutBtn) els.startWorkoutBtn.disabled = true;
        if (activeWorkoutRef) { await deleteDoc(activeWorkoutRef); clearLocalDraft(); }
        const workoutDate = resolveDateForNewWorkout();
        const newExercises = template.exercises.map(ex => ({ exerciseId: ex.exerciseId, name: ex.name, exerciseNote: "", sets: [{weight: "", reps: "", rpe: ""}], lastSets: [], addedAt: Date.now(), firstEditTime: null, lastEditTime: null }));
        activeWorkoutRef = await createWorkoutDraftInFirestore({
          exercises: newExercises,
          templateId,
          routineName: template.name,
          date: workoutDate,
          dateKey: workoutDate,
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
        await saveWorkoutDraft();
        await updateResumeDraftButtonState();
        setStatus("Routine started ✓");
        if (currentRoute === "routines") {
          history.pushState(null, "", "index.html");
          handleRouteChange();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
    } catch (e) { setStatus("Failed to start routine.", "error"); } finally { if (els.startWorkoutBtn) els.startWorkoutBtn.disabled = false; }
}

// ==================== WORKOUT FLOW & UI ====================
els.startWorkoutBtn?.addEventListener("click", async () => {
  if (!currentUser || activeWorkoutRef) return;
  try {
    if (await blockStartIfUnfinishedDraft()) return;
    suppressDraftRecoveryForNewStart();
    setStatus("Starting...");
    els.startWorkoutBtn.disabled = true;
    const workoutDate = resolveDateForNewWorkout();
    activeWorkoutRef = await createWorkoutDraftInFirestore({
      exercises: [],
      date: workoutDate,
      dateKey: workoutDate,
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
els.loadMoreWorkoutsBtn?.addEventListener("click", () => refreshRecentWorkoutsPage({ reset: false, renderLoading: false }).catch((e) => {
  console.error("Load more workouts failed", e);
  renderRecentWorkoutsError("Could not load more workouts.");
}));

function renderWorkoutBuilder() {
  if (!els.workoutExercises) return; els.workoutExercises.innerHTML = "";
  if (!currentUser) { els.workoutExercises.innerHTML = `<div class="text-zinc-500 text-center py-8">Sign in to start a workout.</div>`; return; }
  if (!activeWorkoutRef) { els.workoutExercises.innerHTML = `<div class="text-zinc-500 text-center py-8">Select a routine above or start an empty workout.</div>`; return; }
  if (!workoutState.exercises.length) { els.workoutExercises.innerHTML = `<div class="text-zinc-500 text-center py-8">Search and add an exercise to begin tracking.</div>`; return; }

  workoutState.exercises.forEach((ex, exIndex) => {
    hydrateExerciseProgressReference(ex);
    const card = document.createElement("div"); card.className = "bg-zinc-900 border border-zinc-700 rounded-2xl p-5 mb-4";
    card.dataset.exerciseId = ex.exerciseId;
    function trackTime() { if (!ex.firstEditTime) ex.firstEditTime = Date.now(); ex.lastEditTime = Date.now(); }
    const setsHtml = ex.sets.map((s, idx) => {
      const phW = previousSetPlaceholder(ex.lastSets, idx, "weight");
      const phR = previousSetPlaceholder(ex.lastSets, idx, "reps");
      return `
        <div class="flex flex-wrap items-end gap-3 bg-zinc-800 p-4 rounded-xl border border-zinc-700 mb-3" data-idx="${idx}">
          <div class="flex-1"><label class="block text-xs text-zinc-400 mb-1">Set ${idx + 1} - Weight</label><input class="w w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500" type="number" step="0.5" value="${escapeHtml(s.weight)}" placeholder="${escapeHtml(phW)}"></div>
          <div class="flex-1"><label class="block text-xs text-zinc-400 mb-1">Reps</label><input class="r w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500" type="text" value="${escapeHtml(s.reps)}" placeholder="${escapeHtml(phR)}"></div>
          <div class="flex-1 hidden md:block"><label class="block text-xs text-zinc-400 mb-1">RPE</label><input class="p w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500" type="number" step="0.5" value="${escapeHtml(s.rpe)}" placeholder="-"></div>
          <button class="rem px-3 py-2 text-red-400 hover:text-red-300 transition-colors"><i class="fa-solid fa-trash"></i></button>
          <div class="set-comparison w-full text-[11px] leading-relaxed" data-comparison-idx="${idx}">${setComparisonHtml(ex, idx)}</div>
        </div>`;
    }).join("");
    if (ex.exerciseNote == null) ex.exerciseNote = "";
    const favOn = isExerciseFavorite(ex.exerciseId);
    card.innerHTML = `<div class="flex justify-between items-start gap-2 mb-2">
      <div class="font-bold text-xl text-emerald-400 flex-1 min-w-0">${escapeHtml(ex.name)}</div>
      <div class="flex flex-col gap-1 shrink-0"><button type="button" class="ex-move-up ${MOVE_BTN_CLASS}" title="Move exercise up" aria-label="Move ${escapeHtml(ex.name)} up"${exIndex === 0 ? " disabled" : ""}><i class="fa-solid fa-chevron-up"></i></button><button type="button" class="ex-move-down ${MOVE_BTN_CLASS}" title="Move exercise down" aria-label="Move ${escapeHtml(ex.name)} down"${exIndex === workoutState.exercises.length - 1 ? " disabled" : ""}><i class="fa-solid fa-chevron-down"></i></button></div>
      <button type="button" class="ex-fav-toggle shrink-0 w-10 h-10 rounded-lg border border-zinc-600 hover:bg-zinc-800 text-amber-400 flex items-center justify-center" title="${favOn ? "Remove from favorites" : "Add to favorites"}" aria-label="Favorite"><i class="fa-star ${favOn ? "fa-solid" : "fa-regular"}"></i></button>
    </div>
    <label class="block text-xs text-zinc-500 mb-1">Notes</label>
    <textarea class="exercise-note-input w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 resize-y min-h-[60px] mb-4" rows="2" placeholder="Add note for this exercise">${escapeHtml(ex.exerciseNote)}</textarea>
    <div class="flex flex-wrap gap-2 mb-4"><button class="addSet bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-4 py-2 rounded-lg text-sm border border-zinc-600">+ Add Set</button><button class="copyLast bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-4 py-2 rounded-lg text-sm border border-zinc-600">Copy Last</button><button class="removeExercise text-red-400 hover:text-red-300 px-4 py-2 text-sm ml-auto">Remove</button></div>${exerciseProgressHtml(ex)}<div>${setsHtml}</div>`;
    const moveExercise = (delta) => { workoutState.exercises = moveListItem(workoutState.exercises, exIndex, delta); renderWorkoutBuilder(); scheduleAutosave(); };
    card.querySelector(".ex-move-up").addEventListener("click", () => moveExercise(-1));
    card.querySelector(".ex-move-down").addEventListener("click", () => moveExercise(1));
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
      row.querySelector(".w").addEventListener("input", e => { ex.sets[idx].weight = e.target.value; trackTime(); updateSetComparisonRow(card, ex, idx); scheduleAutosave(); });
      row.querySelector(".r").addEventListener("input", e => { ex.sets[idx].reps = e.target.value; trackTime(); updateSetComparisonRow(card, ex, idx); scheduleAutosave(); });
      row.querySelector(".p").addEventListener("input", e => { ex.sets[idx].rpe = e.target.value; trackTime(); scheduleAutosave(); });
      row.querySelector(".rem").addEventListener("click", () => { ex.sets.splice(idx, 1); if (!ex.sets.length) ex.sets.push({ weight: "", reps: "", rpe: "" }); trackTime(); renderWorkoutBuilder(); scheduleAutosave(); });
    });
    els.workoutExercises.appendChild(card);
    card.querySelector(".retry-progress")?.addEventListener("click", () => ensureExerciseProgressLoaded(ex, { force: true }));
    if (!exerciseProgressLoadsStarted.has(ex)) {
      exerciseProgressLoadsStarted.add(ex);
      ensureExerciseProgressLoaded(ex).catch(() => {});
    }
  });
}

// ==================== PRS, ANALYTICS & CHARTS ====================
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

function mergeWorkoutLikeRecords(...lists) {
  const byId = new Map();
  const scoreRecord = (record) => {
    let score = 0;
    if (Array.isArray(record?.exerciseSummaries) && record.exerciseSummaries.length) score += 4;
    if (Array.isArray(record?.exercises) && record.exercises.length) score += 3;
    if (Array.isArray(record?.focus) && record.focus.length) score += 2;
    if (typeof record?.routineName === "string" && record.routineName.trim()) score += 1;
    return score;
  };

  lists.forEach((list) => {
    (list || []).forEach((record) => {
      if (!record?.id) return;
      const existing = byId.get(record.id);
      if (!existing) {
        byId.set(record.id, record);
        return;
      }
      const merged = { ...existing, ...record };
      const existingScore = scoreRecord(existing);
      const nextScore = scoreRecord(record);
      if (nextScore > existingScore) {
        byId.set(record.id, merged);
        return;
      }
      if (nextScore === existingScore && (Number(record.updatedAtMs) || 0) >= (Number(existing.updatedAtMs) || 0)) {
        byId.set(record.id, merged);
      } else {
        byId.set(record.id, { ...record, ...existing });
      }
    });
  });

  return [...byId.values()];
}

async function loadChartWorkoutsSample() {
  if (!currentUser) return [];
  if (chartWorkoutsSample.length) return chartWorkoutsSample;
  if (!chartWorkoutsLoadPromise) {
    chartWorkoutsLoadPromise = (async () => {
      let summaryRows = [];
      let rawRows = [];
      try {
        const summarySnap = await getDocs(
          query(workoutSummariesCollection(), orderBy("updatedAtMs", "desc"), limit(120))
        );
        summaryRows = summarySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (e) {
        console.warn("Chart workout summary query failed", e);
      }
      try {
        const rawSnap = await getDocs(
          query(
            collection(db, "users", currentUser.uid, "workouts"),
            where("status", "==", "final"),
            orderBy("updatedAtMs", "desc"),
            limit(120)
          )
        );
        rawRows = rawSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (e) {
        console.warn("Chart raw workout query failed", e);
      } finally {
        chartWorkoutsSample = mergeWorkoutLikeRecords(summaryRows, rawRows)
          .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0))
          .slice(0, 120);
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
  Legs: "heat-legs-fill shadow-[0_0_8px_rgba(59,130,246,0.5)]",
  Chest: "heat-chest-fill shadow-[0_0_8px_rgba(249,115,22,0.5)]",
  Shoulders: "heat-shoulders-fill shadow-[0_0_8px_rgba(168,85,247,0.5)]",
  Back: "heat-back-cell",
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

function parseStoredWorkoutDate(dateValue) {
  if (typeof dateValue !== "string") return null;
  const trimmed = dateValue.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function workoutDisplayMeta(w) {
  const storedDate = parseStoredWorkoutDate(w?.date);
  let displayDate = w.date;
  let timeString = "";
  let dDate = w.date;
  if (storedDate) {
    displayDate = storedDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    dDate = toLocalISODate(storedDate);
    if (w.updatedAtMs) {
      const updatedDate = new Date(w.updatedAtMs);
      if (!Number.isNaN(updatedDate.getTime())) {
        timeString = updatedDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      }
    }
  } else if (w.updatedAtMs) {
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

function workoutDateSortMs(workout) {
  const storedDate = parseStoredWorkoutDate(workout?.date);
  if (storedDate) return storedDate.getTime();
  const updatedAtMs = Number(workout?.updatedAtMs) || 0;
  return updatedAtMs > 0 ? updatedAtMs : 0;
}

function compareWorkoutsByDateDesc(a, b) {
  const dateDiff = workoutDateSortMs(b) - workoutDateSortMs(a);
  if (dateDiff !== 0) return dateDiff;
  return (Number(b?.updatedAtMs) || 0) - (Number(a?.updatedAtMs) || 0);
}

function workoutFullDisplayDate(workout) {
  const { displayDate, timeString } = workoutDisplayMeta(workout || {});
  return timeString ? `${displayDate} at ${timeString}` : displayDate;
}

function createWorkoutListItem(workout, options = {}) {
  const { compact = false } = options;
  const { displayDate, timeString } = workoutDisplayMeta(workout);
  const fullDateStr = workoutFullDisplayDate(workout);
  const div = document.createElement("div");
  div.className = compact
    ? "rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 transition hover:border-emerald-500/50"
    : "bg-zinc-800 p-4 rounded-xl flex justify-between items-center border border-zinc-700 cursor-pointer hover:border-emerald-500/50 transition-colors";
  const exerciseCount = Number(workout.exerciseCount || (workout.exercises || []).length || (workout.exerciseSummaries || []).length || 0);
  const hasSessionNotes = typeof workout.notes === "string" && workout.notes.trim().length > 0;
  if (compact) {
    div.innerHTML = `<div class="flex items-center justify-between gap-3"><div class="min-w-0"><div class="truncate text-sm font-semibold text-zinc-200">${escapeHtml(workout.routineName || "Custom Workout")}</div><div class="text-xs text-zinc-500">${escapeHtml(displayDate)} ${escapeHtml(timeString)}</div></div><div class="shrink-0 text-xs font-bold text-emerald-400">${exerciseCount}</div></div>`;
  } else {
    div.innerHTML = `<div><div class="font-medium text-zinc-200">${escapeHtml(displayDate)} <span class="text-zinc-500 text-xs ml-1">${escapeHtml(timeString)}</span></div><div class="text-xs text-zinc-500">${exerciseCount} exercises${hasSessionNotes ? ` <span class="ml-2 text-amber-400"><i class="fa-regular fa-note-sticky mr-1"></i>Notes</span>` : ""}</div></div><div class="text-right text-emerald-400 font-bold">${escapeHtml(workout.routineName || "Custom Workout")}</div>`;
  }
  div.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    openWorkoutDetailsFromSummary(workout, fullDateStr);
  };
  return div;
}

let recentWorkoutsRows = [];
let recentWorkoutsCursor = null;
let recentWorkoutsHasMore = true;
let recentWorkoutsLoading = false;
const RECENT_WORKOUTS_PAGE_SIZE = 20;

function resetRecentWorkoutsState() {
  recentWorkoutsRows = [];
  recentWorkoutsCursor = null;
  recentWorkoutsHasMore = true;
  recentWorkoutsLoading = false;
}

function renderRecentWorkoutsSignedOut() {
  if (els.recentWorkouts) els.recentWorkouts.innerHTML = `<div class="text-zinc-500 rounded-xl border border-dashed border-zinc-800 py-10 px-4 text-center text-sm">Sign in to see workout history.</div>`;
  if (els.recentWorkoutsPreview) els.recentWorkoutsPreview.innerHTML = `<div class="text-sm text-zinc-500">Sign in to preview workouts.</div>`;
  els.loadMoreWorkoutsBtn?.classList.add("hidden");
}

function renderRecentWorkoutsError(message) {
  if (els.recentWorkouts) els.recentWorkouts.innerHTML = `<div class="text-red-400 rounded-xl border border-red-500/20 bg-red-500/5 py-6 px-4 text-center text-sm">${escapeHtml(message)}</div>`;
  els.loadMoreWorkoutsBtn?.classList.add("hidden");
}

function renderRecentWorkoutsPreview(rows) {
  if (!els.recentWorkoutsPreview) return;
  const list = (rows || recentWorkoutsRows).slice(0, 3);
  els.recentWorkoutsPreview.innerHTML = "";
  if (!currentUser) return renderRecentWorkoutsSignedOut();
  if (!list.length) {
    els.recentWorkoutsPreview.innerHTML = `<div class="text-sm text-zinc-500">No saved workouts yet.</div>`;
    return;
  }
  list.forEach((workout) => els.recentWorkoutsPreview.appendChild(createWorkoutListItem(workout, { compact: true })));
}

function renderRecentWorkoutsPage() {
  if (!els.recentWorkouts) return;
  if (!currentUser) return renderRecentWorkoutsSignedOut();
  els.recentWorkouts.innerHTML = "";
  if (!recentWorkoutsRows.length) {
    els.recentWorkouts.innerHTML = `<div class="text-zinc-500 rounded-xl border border-dashed border-zinc-800 py-10 px-4 text-center text-sm">No saved workouts yet.</div>`;
  } else {
    recentWorkoutsRows.forEach((workout) => els.recentWorkouts.appendChild(createWorkoutListItem(workout)));
  }
  if (els.loadMoreWorkoutsBtn) {
    els.loadMoreWorkoutsBtn.classList.toggle("hidden", !recentWorkoutsHasMore || recentWorkoutsRows.length === 0);
    els.loadMoreWorkoutsBtn.disabled = recentWorkoutsLoading;
    els.loadMoreWorkoutsBtn.innerHTML = recentWorkoutsLoading ? `<i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading...` : "Load more workouts";
  }
}

async function refreshRecentWorkoutsPage(options = {}) {
  if (!currentUser) return;
  const { reset = false, renderLoading = true } = options;
  if (recentWorkoutsLoading) return;
  if (reset) resetRecentWorkoutsState();
  if (!recentWorkoutsHasMore) {
    renderRecentWorkoutsPage();
    return;
  }
  recentWorkoutsLoading = true;
  if (renderLoading && els.recentWorkouts && recentWorkoutsRows.length === 0) {
    els.recentWorkouts.innerHTML = `<div class="text-zinc-500 rounded-xl border border-zinc-800 py-10 px-4 text-center text-sm"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading workouts...</div>`;
  }
  renderRecentWorkoutsPage();
  try {
    const constraints = [
      where("status", "==", "final"),
      orderBy("updatedAtMs", "desc"),
    ];
    if (recentWorkoutsCursor) constraints.push(startAfter(recentWorkoutsCursor));
    constraints.push(limit(RECENT_WORKOUTS_PAGE_SIZE));
    const snap = await getDocs(query(collection(db, "users", currentUser.uid, "workouts"), ...constraints));
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    recentWorkoutsRows = mergeWorkoutLikeRecords(recentWorkoutsRows, rows)
      .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
    recentWorkoutsCursor = snap.docs[snap.docs.length - 1] || recentWorkoutsCursor;
    recentWorkoutsHasMore = snap.docs.length === RECENT_WORKOUTS_PAGE_SIZE;
    analyticsWindowWorkouts = mergeWorkoutLikeRecords(analyticsWindowWorkouts, rows)
      .sort(compareWorkoutsByDateDesc);
    renderRecentWorkoutsPreview();
  } catch (e) {
    console.error("Recent workouts query failed", e);
    renderRecentWorkoutsError("Could not load workouts.");
  } finally {
    recentWorkoutsLoading = false;
    renderRecentWorkoutsPage();
  }
}

async function ensureRecentWorkoutsPageLoaded() {
  if (!currentUser) return renderRecentWorkoutsSignedOut();
  if (recentWorkoutsRows.length) {
    renderRecentWorkoutsPage();
    return;
  }
  await refreshRecentWorkoutsPage({ reset: true, renderLoading: true });
}

function workoutFallsWithinDateWindow(workout, minDateStr) {
  const { dDate } = workoutDisplayMeta(workout || {});
  return typeof dDate === "string" && dDate >= minDateStr;
}

async function fetchDateWindowRows(baseConstraintsFactory, minDateStr, pageSize = 120, maxPages = 6) {
  const rows = [];
  let cursor = null;

  for (let page = 0; page < maxPages; page += 1) {
    const constraints = [...baseConstraintsFactory(minDateStr)];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));

    const snap = await getDocs(query(...constraints));
    if (snap.empty) break;

    snap.docs.forEach((d) => {
      rows.push({ id: d.id, ...d.data() });
    });

    cursor = snap.docs[snap.docs.length - 1] || null;
    if (snap.docs.length < pageSize) break;
  }

  return rows;
}

async function loadAnalytics() {
  if (!currentUser || !els.analyticsContent) return;
  try {
    const summariesCol = workoutSummariesCollection();
    const workoutsCol = collection(db, "users", currentUser.uid, "workouts");
    let totalWorkoutsDisplay = "0";
    try {
      const [summaryCountSnap, rawCountSnap] = await Promise.all([
        getCountFromServer(summariesCol).catch(() => null),
        getCountFromServer(query(workoutsCol, where("status", "==", "final"))).catch(() => null),
      ]);
      const summaryCount = Number(summaryCountSnap?.data().count || 0);
      const rawCount = Number(rawCountSnap?.data().count || 0);
      totalWorkoutsDisplay = String(Math.max(summaryCount, rawCount));
    } catch (e) {
      console.warn("Workout summary count aggregation failed; using capped read fallback.", e);
      const approx = await getDocs(query(workoutsCol, where("status", "==", "final"), limit(500)));
      totalWorkoutsDisplay = approx.size >= 500 ? "500+" : String(approx.size);
    }

    const today = new Date();
    const minD = new Date(today);
    minD.setDate(minD.getDate() - 89);
    const minDateStr = toLocalISODate(minD);

    let summaryWindowRows = [];
    try {
      summaryWindowRows = await fetchDateWindowRows(
        (windowMinDateStr) => [
          summariesCol,
          where("date", ">=", windowMinDateStr),
          orderBy("date", "desc"),
        ],
        minDateStr
      );
    } catch (e) {
      console.warn("Analytics summary date-window query failed", e);
    }
    let rawWindowRows = [];
    try {
      rawWindowRows = await fetchDateWindowRows(
        (windowMinDateStr) => [
          workoutsCol,
          where("status", "==", "final"),
          where("date", ">=", windowMinDateStr),
          orderBy("date", "desc"),
        ],
        minDateStr
      );
    } catch (e) {
      console.warn("Analytics raw date-window query failed", e);
    }
    let recentSummaryRows = [];
    try {
      const snapRecent = await getDocs(
        query(summariesCol, orderBy("updatedAtMs", "desc"), limit(8))
      );
      recentSummaryRows = snapRecent.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      recentSummaryRows = [];
    }
    let recentRawRows = [];
    try {
      const rawRecent = await getDocs(
        query(workoutsCol, where("status", "==", "final"), orderBy("updatedAtMs", "desc"), limit(8))
      );
      recentRawRows = rawRecent.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      recentRawRows = [];
    }
    const mergedRecentRows = mergeWorkoutLikeRecords(recentSummaryRows, recentRawRows);
    const recentWindowRows = mergedRecentRows.filter((w) => workoutFallsWithinDateWindow(w, minDateStr));
    analyticsWindowWorkouts = mergeWorkoutLikeRecords(summaryWindowRows, rawWindowRows, recentWindowRows)
      .filter((w) => workoutFallsWithinDateWindow(w, minDateStr));

    let recentList = mergeWorkoutLikeRecords(analyticsWindowWorkouts, mergedRecentRows)
      .sort(compareWorkoutsByDateDesc)
      .slice(0, 8);
    if (recentList.length === 0) recentList = [...mergedRecentRows].sort(compareWorkoutsByDateDesc).slice(0, 8);

    renderRecentWorkoutsPreview(recentList);
    const workoutsByDate = {};

    analyticsWindowWorkouts.forEach((w) => {
      const { dDate } = workoutDisplayMeta(w);
      if (!workoutsByDate[dDate]) workoutsByDate[dDate] = [];
      workoutsByDate[dDate].push(w);
    });

    // Generate Unified Analytics & Heatmap Layout
    let heatHtml = `<div id="heatmapGrid" class="flex flex-wrap gap-1.5 justify-center mt-5 mb-3">`;
    for (let i = 89; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i); const dateStr = toLocalISODate(d);
        const dayWorkouts = workoutsByDate[dateStr] || [];
        const uniqueFocuses = uniqueHeatFocusesForDay(dayWorkouts);
        const vis = heatmapCellVisual(uniqueFocuses, dayWorkouts.length > 0);
        const baseCell = "w-4 h-4 rounded-sm cursor-pointer hover:ring-2 hover:ring-zinc-400 transition-all overflow-hidden shrink-0";
        const tip = dayWorkouts.length
          ? (uniqueFocuses.length ? `${dateStr} — ${uniqueFocuses.join(", ")}` : `${dateStr} — workout (no focus selected)`)
          : dateStr;
        const styleAttr = vis.kind === "split" && vis.style ? ` style="${escapeHtml(vis.style)}"` : "";
        heatHtml += `<div class="${baseCell} ${vis.className}" data-date="${dateStr}" data-focus="${escapeHtml(uniqueFocuses.join(", "))}" title="${escapeHtml(tip)}"${styleAttr}></div>`;
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
                  <span class="flex items-center gap-1"><div class="w-2 h-2 rounded-sm heat-legs-fill"></div> Legs</span>
                  <span class="flex items-center gap-1"><div class="w-2 h-2 rounded-sm heat-chest-fill"></div> Chest</span>
                  <span class="flex items-center gap-1"><div class="w-2 h-2 rounded-sm heat-shoulders-fill"></div> Shoulders</span>
                  <span class="flex items-center gap-1"><div class="w-2 h-2 rounded-sm heat-back-fill"></div> Back</span>
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
        const displayBox = document.getElementById("newHeatSelectedDateDisplay");
        openHeatmapDateDetails(dateClicked, displayBox);
    });
  } catch (e) { console.error("Analytics error", e); }
}

let currentModalWorkoutId = null;
let currentModalWorkout = null;
let currentModalDisplayDate = "";
async function openWorkoutDetailsFromSummary(summary, displayDate) {
  if (!currentUser || !summary?.id) return;
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid, "workouts", summary.id));
    if (!snap.exists()) {
      showWorkoutDetailsModal(summary, displayDate);
      setStatus("Loaded summary view. Full workout details are no longer available.", "info");
      return;
    }
    showWorkoutDetailsModal({ id: snap.id, ...snap.data() }, displayDate);
  } catch (e) {
    console.error("Workout details load failed", e);
    if (Array.isArray(summary.exerciseSummaries) && summary.exerciseSummaries.length) {
      showWorkoutDetailsModal(summary, displayDate);
      setStatus("Loaded summary view because the full workout could not be fetched.", "info");
      return;
    }
    setStatus("Could not load workout details.", "error");
  }
}

function workoutsForLocalDate(dateStr) {
  return mergeWorkoutLikeRecords(analyticsWindowWorkouts, recentWorkoutsRows)
    .filter((workout) => workoutDisplayMeta(workout).dDate === dateStr)
    .sort(compareWorkoutsByDateDesc);
}

function openHeatmapDateDetails(dateStr, displayBox) {
  if (!dateStr || !displayBox) return;
  const dObj = new Date(`${dateStr}T12:00:00`);
  const displayDate = dObj.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const dayWorkouts = workoutsForLocalDate(dateStr);
  displayBox.classList.remove("hidden");

  if (dayWorkouts.length === 0) {
    displayBox.innerHTML = `<span class="text-zinc-400">${escapeHtml(displayDate)}:</span> <span class="text-zinc-500 ml-2">No workouts saved for this date.</span>`;
    return;
  }

  if (dayWorkouts.length === 1) {
    displayBox.innerHTML = `<span class="text-zinc-400">${escapeHtml(displayDate)}:</span> <span class="text-emerald-400 ml-2">Opening workout details...</span>`;
    openWorkoutDetailsFromSummary(dayWorkouts[0], workoutFullDisplayDate(dayWorkouts[0]));
    return;
  }

  displayBox.innerHTML = `<div class="mb-3"><span class="text-zinc-400">${escapeHtml(displayDate)}:</span> <span class="font-bold text-white ml-2">${dayWorkouts.length} workouts</span></div><div class="space-y-2" id="heatmapDayWorkoutList"></div>`;
  const list = displayBox.querySelector("#heatmapDayWorkoutList");
  dayWorkouts.forEach((workout) => list.appendChild(createWorkoutListItem(workout, { compact: true })));
}

function showWorkoutDetailsModal(workout, displayDate) {
    currentModalWorkout = workout;
    currentModalDisplayDate = displayDate;
    currentModalWorkoutId = workout.id; els.modalTitle.textContent = `Workout Details`;
    // Date and removal go through server functions that only accept saved (final) workouts.
    const isSavedWorkout = workout.status === "final";
    if (els.editWorkoutDateBtn) els.editWorkoutDateBtn.disabled = !isSavedWorkout;
    if (els.removeWorkoutBtn) els.removeWorkoutBtn.disabled = !isSavedWorkout;
    const focusText = Array.isArray(workout.focus) && workout.focus.length ? workout.focus.join(", ") : "No focus selected";
    const sessionNotes = typeof workout.notes === "string" ? workout.notes.trim() : "";
    let contentHtml = `<div class="text-sm text-zinc-400 mb-6 pb-4 border-b border-zinc-800">${displayDate} <br/>Routine: <span class="font-bold text-emerald-400">${escapeHtml(workout.routineName || 'Custom Workout')}</span><br/>Focus: <span class="font-bold text-blue-300">${escapeHtml(focusText)}</span></div>`;
    if (sessionNotes) {
        contentHtml += `<div class="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3"><div class="mb-1 text-xs font-bold uppercase tracking-wide text-amber-300"><i class="fa-regular fa-note-sticky mr-2"></i>Session Notes</div><div class="text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap">${escapeHtml(sessionNotes)}</div></div>`;
    }
    const displayExercises = Array.isArray(workout.exercises) && workout.exercises.length
      ? workout.exercises
      : (workout.exerciseSummaries || []).map((ex) => ({
          name: ex.exerciseName || ex.name || "Exercise",
          summaryOnly: true,
          bestWeight: ex.bestWeight,
          bestReps: ex.bestReps,
          bestVolume: ex.bestVolume,
        }));
    if (!displayExercises.length) {
        contentHtml += `<div class="text-sm text-zinc-500">No exercise details recorded.</div>`;
    }
    displayExercises.forEach(ex => {
        let timeHtml = ""; let tStart = ex.firstEditTime || ex.addedAt; let tEnd = ex.lastEditTime || ex.firstEditTime || ex.addedAt;
        if (tStart && tEnd && Math.abs(tEnd - tStart) > 60000) { timeHtml = `<span class="text-xs text-zinc-500 font-normal ml-auto bg-zinc-800 px-2 py-1 rounded"><i class="fa-regular fa-clock mr-1"></i> ${formatTimeDisplay(tStart)} - ${formatTimeDisplay(tEnd)}</span>`; } else if (tStart) { timeHtml = `<span class="text-xs text-zinc-500 font-normal ml-auto bg-zinc-800 px-2 py-1 rounded"><i class="fa-regular fa-clock mr-1"></i> ${formatTimeDisplay(tStart)}</span>`; }
        const exNote = (ex.exerciseNote && String(ex.exerciseNote).trim()) ? `<div class="text-sm text-zinc-400 mb-3 pl-1 border-l-2 border-emerald-500/50 py-1"><span class="text-zinc-500 text-xs uppercase tracking-wide mr-2">Notes</span>${escapeHtml(ex.exerciseNote)}</div>` : "";
        contentHtml += `<div class="mb-6"><div class="font-bold text-lg text-zinc-100 mb-3 flex items-center gap-2">${escapeHtml(ex.name)} ${timeHtml}</div>${exNote}`;
        if (ex.summaryOnly) {
            const bestWeight = Number(ex.bestWeight) || 0;
            const bestReps = Number(ex.bestReps) || 0;
            const bestVolume = Number(ex.bestVolume) || 0;
            if (bestWeight > 0 || bestReps > 0 || bestVolume > 0) {
                const bestWeightLabel = bestWeight > 0 ? `${bestWeight} ${workout.unit || 'lb'}` : "Bodyweight";
                contentHtml += `<div class="text-sm bg-zinc-900 p-3 rounded-lg border border-zinc-800"><span class="text-zinc-400">Best logged set:</span> <span class="font-medium">${bestWeightLabel}</span> <span class="font-medium text-emerald-400">× ${bestReps} reps</span> <span class="text-zinc-500 ml-2">(volume ${bestVolume})</span></div>`;
            } else {
                contentHtml += `<div class="text-sm text-zinc-500">Summary available, but no set-level details were stored.</div>`;
            }
        } else {
            const validSets = (ex.sets || []).filter(s => (parseInt(String(s.reps ?? ""), 10) || 0) > 0 || String(s.weight ?? "").trim() !== "");
            if(validSets.length === 0) { contentHtml += `<div class="text-sm text-zinc-500">No valid sets recorded.</div>`; } else { validSets.forEach((s, i) => { contentHtml += `<div class="flex gap-4 text-sm bg-zinc-900 p-2 rounded-lg mb-1 border border-zinc-800"><div class="text-zinc-500 w-12">Set ${i+1}</div><div class="font-medium">${s.weight} ${workout.unit || 'lb'}</div><div class="font-medium text-emerald-400">× ${s.reps} reps</div></div>`; }); }
        }
        contentHtml += `</div>`;
    });
    els.modalContent.innerHTML = contentHtml; els.workoutModal.showModal();
}
els.editWorkoutNameBtn?.addEventListener("click", async () => {
    if (!currentModalWorkoutId || !currentUser) return;
    const currentName = String(currentModalWorkout?.routineName || "Custom Workout");
    const nextNameRaw = prompt("Edit routine name", currentName);
    if (nextNameRaw == null) return;
    const nextName = nextNameRaw.replace(/\s+/g, " ").trim();
    if (!nextName) return setStatus("Routine name cannot be blank.", "error");
    if (nextName.length > 80) return setStatus("Routine name must be 80 characters or less.", "error");
    if (nextName === currentName) return;
    try {
        els.editWorkoutNameBtn.disabled = true;
        els.editWorkoutNameBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...`;
        await updateDoc(doc(db, "users", currentUser.uid, "workouts", currentModalWorkoutId), {
          routineName: nextName,
          updatedAtMs: Date.now(),
        });
        currentModalWorkout = { ...(currentModalWorkout || {}), id: currentModalWorkoutId, routineName: nextName };
        showWorkoutDetailsModal(currentModalWorkout, currentModalDisplayDate);
        resetWorkoutAnalyticsCaches();
        await loadAnalytics();
        setStatus("Routine name updated.", "info");
    } catch (e) {
        console.error("Failed to update routine name", e);
        setStatus("Failed to update routine name.", "error");
    } finally {
        els.editWorkoutNameBtn.disabled = false;
        els.editWorkoutNameBtn.innerHTML = `<i class="fa-solid fa-pen mr-1"></i> Edit Routine`;
    }
});
els.editWorkoutFocusBtn?.addEventListener("click", async () => {
    if (!currentModalWorkoutId || !currentUser) return;
    const currentFocus = Array.isArray(currentModalWorkout?.focus) ? currentModalWorkout.focus : [];
    const nextFocusRaw = prompt(`Edit focus. Use comma-separated values from: ${WORKOUT_FOCUS_OPTIONS.join(", ")}`, currentFocus.join(", "));
    if (nextFocusRaw == null) return;
    const nextFocus = [...new Set(nextFocusRaw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean))];
    const invalidFocus = nextFocus.find((item) => !WORKOUT_FOCUS_OPTIONS.includes(item));
    if (invalidFocus) return setStatus(`Invalid focus: ${invalidFocus}`, "error");
    if (nextFocus.length > 8) return setStatus("Focus is limited to 8 items.", "error");
    if (JSON.stringify(nextFocus) === JSON.stringify(currentFocus)) return;
    try {
        els.editWorkoutFocusBtn.disabled = true;
        els.editWorkoutFocusBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...`;
        await updateDoc(doc(db, "users", currentUser.uid, "workouts", currentModalWorkoutId), {
          focus: nextFocus,
          updatedAtMs: Date.now(),
        });
        currentModalWorkout = { ...(currentModalWorkout || {}), id: currentModalWorkoutId, focus: nextFocus };
        showWorkoutDetailsModal(currentModalWorkout, currentModalDisplayDate);
        resetWorkoutAnalyticsCaches();
        await loadAnalytics();
        setStatus("Workout focus updated.", "info");
    } catch (e) {
        console.error("Failed to update workout focus", e);
        setStatus("Failed to update workout focus.", "error");
    } finally {
        els.editWorkoutFocusBtn.disabled = false;
        els.editWorkoutFocusBtn.innerHTML = `<i class="fa-solid fa-bullseye mr-1"></i> Edit Focus`;
    }
});
/** After a server-side change to a saved workout: drop every cache derived from it and reload the lists. */
async function refreshAfterSavedWorkoutChange(exerciseIds) {
  invalidateFinalSetsCache(exerciseIds);
  resetWorkoutAnalyticsCaches();
  currentModalWorkout = null; currentModalWorkoutId = null; currentModalDisplayDate = "";
  els.workoutModal?.close();
  await Promise.allSettled([
    refreshRecentWorkoutsPage({ reset: true, renderLoading: false }),
    loadAnalytics(),
  ]);
}

els.editWorkoutDateBtn?.addEventListener("click", async () => {
  if (!currentUser || !currentModalWorkout) return;
  const workout = currentModalWorkout;
  const input = prompt(`Enter the correct date for this workout as YYYY-MM-DD.\nIt is currently on ${formatCalendarDate(workout.date)}.`, workout.date || "");
  if (input == null) return;
  let request;
  try {
    request = buildDateCorrectionRequest(workout, input, { todayKey: todayISO() });
  } catch (error) {
    return setStatus(error.message, "error");
  }
  try {
    els.editWorkoutDateBtn.disabled = true;
    // Preview first: the server must find exactly this one workout before anything is changed.
    const preview = await httpsCallable(functions, "previewWorkoutDateCorrection")(request);
    const matches = preview.data?.candidates || [];
    if (matches.length !== 1 || matches[0].workoutId !== workout.id) {
      return setStatus("Could not safely match this workout to change its date. Nothing was changed.", "error");
    }
    const label = String(workout.routineName || "this workout");
    if (!confirm(`Move "${label}" (${matches[0].exercises.length} exercise(s)) from ${formatCalendarDate(request.originalDate)} to ${formatCalendarDate(request.newDate)}?\n\nOnly the date changes. Sets, notes and everything else stay the same.`)) return;
    const result = await httpsCallable(functions, "correctFinalizedWorkoutDate")(request);
    await refreshAfterSavedWorkoutChange(request.exerciseIds);
    setStatus(
      result.data?.derivedDataWarning
        ? `Workout moved to ${formatCalendarDate(request.newDate)}. Some derived data will catch up shortly.`
        : `Workout moved to ${formatCalendarDate(request.newDate)}.`,
      "info"
    );
  } catch (error) {
    console.error("Workout date change failed", error);
    setStatus(String(error?.message || "Could not change the workout date.").replace(/^functions\//, ""), "error");
  } finally {
    if (els.editWorkoutDateBtn) els.editWorkoutDateBtn.disabled = currentModalWorkout?.status !== "final";
  }
});

els.removeWorkoutBtn?.addEventListener("click", async () => {
  if (!currentUser || !currentModalWorkoutId || currentModalWorkout?.status !== "final") return;
  const workout = currentModalWorkout;
  const exerciseIds = (workout.exercises || []).map((exercise) => exercise?.exerciseId).filter(Boolean);
  if (!confirm(`Remove this workout from ${formatCalendarDate(workout.date)}${workout.routineName ? ` ("${workout.routineName}")` : ""}?\n\nIt disappears from your history, charts and "last time" numbers. It is archived rather than erased. Any personal record it set stays until you delete it on the PRs page.`)) return;
  try {
    els.removeWorkoutBtn.disabled = true;
    await httpsCallable(functions, "archiveWorkout")({ workoutId: workout.id });
    await refreshAfterSavedWorkoutChange(exerciseIds);
    setStatus("Workout removed.", "info");
  } catch (error) {
    console.error("Workout removal failed", error);
    setStatus(String(error?.message || "Could not remove the workout.").replace(/^functions\//, ""), "error");
  } finally {
    if (els.removeWorkoutBtn) els.removeWorkoutBtn.disabled = currentModalWorkout?.status !== "final";
  }
});

els.closeModalBtn?.addEventListener("click", () => { currentModalWorkout = null; currentModalWorkoutId = null; currentModalDisplayDate = ""; els.workoutModal.close(); });

// ==================== REST TIMER ====================
// Source of truth while running: wall-clock end time (timerEndAt). setInterval only refreshes the UI ~1s; iOS throttles timers in background, so we recompute remaining time from Date.now() on resume (visibility/pageshow/focus) and from each tick.
// Persisted so switching apps / locking the screen does not lose the scheduled end time.
const TIMER_STORAGE_KEY = "k2_rest_timer_state_v2";
const TIMER_DEFAULT_SECONDS = 120;
const TimerAudioContextCtor = window.AudioContext || window.webkitAudioContext;

let timerSeconds = TIMER_DEFAULT_SECONDS;
let timerEndAt = null;
let isTimerRunning = false;
let timerInterval = null;
let timerAudioContext = null;
let timerAlarmBuffer = null;
let timerAlarmBufferPromise = null;
let timerAudioUnlocked = false;

function ensureTimerAudioContext() {
  if (!TimerAudioContextCtor) return null;
  if (!timerAudioContext) {
    try {
      timerAudioContext = new TimerAudioContextCtor();
    } catch (_) {
      timerAudioContext = null;
    }
  }
  return timerAudioContext;
}

function configureTimerAudioSession() {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== "ambient") {
      navigator.audioSession.type = "ambient";
    }
  } catch (_) {
    // Ignore unsupported or rejected audio session changes.
  }
}

async function loadTimerAlarmBuffer() {
  if (timerAlarmBuffer) return timerAlarmBuffer;
  if (timerAlarmBufferPromise) return timerAlarmBufferPromise;
  const context = ensureTimerAudioContext();
  if (!context) return null;
  timerAlarmBufferPromise = fetch("/rest-timer-finished.wav")
    .then((response) => {
      if (!response.ok) throw new Error(`Alarm fetch failed: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
    .then((decodedBuffer) => {
      timerAlarmBuffer = decodedBuffer;
      return decodedBuffer;
    })
    .catch(() => null)
    .finally(() => {
      timerAlarmBufferPromise = null;
    });
  return timerAlarmBufferPromise;
}

async function primeTimerAudio() {
  configureTimerAudioSession();
  const context = ensureTimerAudioContext();
  loadTimerAlarmBuffer().catch(() => {});
  if (!context) {
    timerAudioUnlocked = false;
    return false;
  }
  if (context?.state === "suspended") {
    try {
      await context.resume();
    } catch (_) {
      // Resume can fail until Safari considers the gesture trusted.
    }
  }
  timerAudioUnlocked = context.state === "running";
  return timerAudioUnlocked;
}

function playTimerAlarmFallback() {
  const context = ensureTimerAudioContext();
  if (!context || context.state !== "running") return false;
  const pattern = [0, 0.42, 0.74];
  const baseTime = context.currentTime + 0.02;
  pattern.forEach((offset, index) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(index === 1 ? 880 : 740, baseTime + offset);
    gain.gain.setValueAtTime(0.0001, baseTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.22, baseTime + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, baseTime + offset + 0.24);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(baseTime + offset);
    osc.stop(baseTime + offset + 0.26);
  });
  return true;
}

function playTimerAlarmBuffer(buffer) {
  const context = ensureTimerAudioContext();
  if (!context || context.state !== "running" || !buffer) return false;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = 1;
  source.connect(gain);
  gain.connect(context.destination);
  source.start();
  return true;
}

function playTimerAlarm() {
  configureTimerAudioSession();
  const context = ensureTimerAudioContext();
  if (context?.state === "running") {
    if (timerAlarmBuffer && playTimerAlarmBuffer(timerAlarmBuffer)) return;
    loadTimerAlarmBuffer()
      .then((buffer) => {
        if (playTimerAlarmBuffer(buffer)) return;
        if (!playTimerAlarmFallback()) {
          timerAudioUnlocked = false;
        }
      })
      .catch(() => {
        if (!playTimerAlarmFallback()) {
          timerAudioUnlocked = false;
        }
      });
    return;
  }

  if (!playTimerAlarmFallback()) {
    timerAudioUnlocked = false;
  }
}

function shouldShowTimerWidget(state) {
  if (!state || typeof state !== "object") return false;
  if (state.running) return true;
  return state.visible === true;
}

function getPersistedTimerState() {
  if (isTimerRunning && timerEndAt != null) {
    return { running: true, endAt: timerEndAt, completed: false, visible: true };
  }
  return {
    running: false,
    endAt: null,
    remainingSec: timerSeconds,
    completed: timerSeconds <= 0,
    visible: !els.restTimerWidget?.classList.contains("hidden"),
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
  } else if (revealWidget) {
    els.restTimerWidget?.classList.add("hidden");
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
    if (document.visibilityState === "visible") {
      if (timerAudioContext?.state === "suspended") {
        timerAudioContext.resume().catch(() => {});
      }
      recalcAfterForeground();
    }
});
window.addEventListener("pageshow", () => {
  if (timerAudioContext?.state === "suspended") {
    timerAudioContext.resume().catch(() => {});
  }
  recalcAfterForeground();
  recheckWorkoutDateAfterReturn().catch((error) => console.warn("Workout date recheck failed", error));
});
window.addEventListener("pagehide", () => {
    syncSecondsFromEndTime();
    persistTimerState();
});
window.addEventListener("focus", () => {
    if (timerAudioContext?.state === "suspended") {
      timerAudioContext.resume().catch(() => {});
    }
    recalcAfterForeground();
    recheckWorkoutDateAfterReturn().catch((error) => console.warn("Workout date recheck failed", error));
});
window.addEventListener("blur", () => {
    syncSecondsFromEndTime();
    persistTimerState();
});
window.addEventListener("storage", (event) => {
  if (event.key === APP_THEME_STORAGE_KEY) {
    applyThemeColor(event.newValue || DEFAULT_APP_THEME_COLOR);
    updateThemeSettingsUi();
    return;
  }
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
  primeTimerAudio().catch(() => {});
  els.restTimerWidget?.classList.toggle("hidden");
  if (!els.restTimerWidget?.classList.contains("hidden") && timerSeconds <= 0) {
    timerSeconds = TIMER_DEFAULT_SECONDS;
    timerEndAt = null;
    resetTimerVisuals();
    updateTimerDisplay();
  }
  persistTimerState();
});
els.timerPlayPauseBtn?.addEventListener("click", () => {
    primeTimerAudio().catch(() => {});
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
    primeTimerAudio().catch(() => {});
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
    primeTimerAudio().catch(() => {});
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
  primeTimerAudio().catch(() => {});
  els.restTimerWidget?.classList.add("hidden");
  persistTimerState();
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

initThemeSettingsPage();
