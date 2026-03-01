// Online MCQ exam app (Teacher uploads Excel, Students take timed MCQ test)
// Excel columns: A question, B/C/D/E options, F correct letter (B/C/D/E)

const el = (id) => document.getElementById(id);

const STATUS = el("status");
function showStatus(msg, kind = "warn") {
  STATUS.classList.remove("hidden");
  STATUS.textContent = msg;
  STATUS.className = "p-3 rounded mb-4";
  if (kind === "ok") STATUS.classList.add("bg-emerald-100", "text-emerald-900");
  else if (kind === "err") STATUS.classList.add("bg-rose-100", "text-rose-900");
  else STATUS.classList.add("bg-amber-100", "text-amber-900");
}
function hideStatus() { STATUS.classList.add("hidden"); }

// Auto-default API: localhost for local dev, Render for Pages.
// TODO: Replace Render URL with your own service URL.
let API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://dolgozat-egyszeresvalasztas.onrender.com";

const apiBaseInput = el("apiBaseInput");
apiBaseInput.value = API_BASE;
apiBaseInput.addEventListener("change", () => {
  API_BASE = apiBaseInput.value.trim().replace(/\/+$/, "");
  apiBaseInput.value = API_BASE;
});

// Role switching
const roleStudentBtn = el("roleStudentBtn");
const roleTeacherBtn = el("roleTeacherBtn");
const teacherPanel = el("teacherPanel");

function setRole(role) {
  if (role === "teacher") {
    teacherPanel.classList.remove("hidden");
    roleTeacherBtn.classList.add("bg-slate-900", "text-white");
    roleTeacherBtn.classList.remove("bg-slate-200");
    roleStudentBtn.classList.remove("bg-slate-900", "text-white");
    roleStudentBtn.classList.add("bg-slate-200");
  } else {
    teacherPanel.classList.add("hidden");
    roleStudentBtn.classList.add("bg-slate-900", "text-white");
    roleStudentBtn.classList.remove("bg-slate-200");
    roleTeacherBtn.classList.remove("bg-slate-900", "text-white");
    roleTeacherBtn.classList.add("bg-slate-200");
  }
}
roleStudentBtn.addEventListener("click", () => setRole("student"));
roleTeacherBtn.addEventListener("click", () => setRole("teacher"));
setRole("student");

let teacherToken = ""; // Returned after teacher login

async function apiFetch(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (teacherToken) headers["X-Teacher-Token"] = teacherToken;

  const res = await fetch(url, { ...opts, headers });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    let detail = "";
    try {
      detail = ct.includes("application/json") ? JSON.stringify(await res.json()) : await res.text();
    } catch (_) {}
    throw new Error(`${res.status} ${res.statusText}${detail ? " – " + detail : ""}`);
  }
  if (ct.includes("application/json")) return await res.json();
  return await res.text();
}

// Teacher controls
const teacherPassword = el("teacherPassword");
const teacherLoginBtn = el("teacherLoginBtn");
const teacherAuthed = el("teacherAuthed");

const excelFileInput = el("excelFileInput");
const uploadExcelBtn = el("uploadExcelBtn");
const activeBankLine = el("activeBankLine");
const bankStats = el("bankStats");

const studentCode = el("studentCode");
const genCodeBtn = el("genCodeBtn");
const publishSessionBtn = el("publishSessionBtn");
const downloadXlsxBtn = el("downloadXlsxBtn");

const rowFrom = el("rowFrom");
const rowTo = el("rowTo");
const questionCount = el("questionCount");
const perQuestionTimeSec = el("perQuestionTimeSec");

let activeBankId = "";

teacherLoginBtn.addEventListener("click", async () => {
  try {
    hideStatus();
    const pw = teacherPassword.value;
    if (!pw) return showStatus("Adj meg tanári jelszót!", "warn");
    const data = await apiFetch("/api/teacher/login", {
      method: "POST",
      body: JSON.stringify({ password: pw })
    });
    teacherToken = data.teacherToken;
    teacherAuthed.classList.remove("hidden");
    showStatus("Sikeres tanári belépés.", "ok");
  } catch (e) {
    teacherToken = "";
    teacherAuthed.classList.add("hidden");
    showStatus("Tanári belépés sikertelen: " + e.message, "err");
  }
});

uploadExcelBtn.addEventListener("click", async () => {
  try {
    hideStatus();
    if (!teacherToken) return showStatus("Előbb lépj be tanárként!", "warn");
    const f = excelFileInput.files?.[0];
    if (!f) return showStatus("Válassz egy .xlsx fájlt!", "warn");

    const form = new FormData();
    form.append("file", f);

    const res = await fetch(`${API_BASE}/api/teacher/upload`, {
      method: "POST",
      headers: { "X-Teacher-Token": teacherToken },
      body: form
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${res.status} ${res.statusText} – ${t}`);
    }
    const data = await res.json();
    activeBankId = data.bankId;
    activeBankLine.textContent = `${data.bankId}`;
    bankStats.textContent = `Összes kérdés (1. lapon): ${data.totalQuestions}`;
    showStatus("Excel feltöltve és feldolgozva.", "ok");
  } catch (e) {
    showStatus("Excel feltöltés hiba: " + e.message, "err");
  }
});

function genCode(len = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
genCodeBtn.addEventListener("click", () => {
  studentCode.value = genCode(5);
});

publishSessionBtn.addEventListener("click", async () => {
  try {
    hideStatus();
    if (!teacherToken) return showStatus("Előbb lépj be tanárként!", "warn");
    if (!activeBankId) return showStatus("Előbb tölts fel Excel kérdésbankot!", "warn");
    const code = studentCode.value.trim();
    if (!code) return showStatus("Adj meg / generálj tanulói kódot!", "warn");

    const rf = parseInt(rowFrom.value, 10);
    const rt = parseInt(rowTo.value, 10);
    const qc = parseInt(questionCount.value, 10);
    const tsec = parseInt(perQuestionTimeSec.value, 10);

    if (!Number.isInteger(rf) || rf < 1) return showStatus("Hanyadik sortól: pozitív egész!", "warn");
    if (!Number.isInteger(rt) || rt < rf) return showStatus("Hanyadik sorig: legyen >= sortól!", "warn");
    if (!Number.isInteger(qc) || qc < 1) return showStatus("Kérdésszám: pozitív egész!", "warn");
    if (!Number.isInteger(tsec) || tsec < 1) return showStatus("Idő/kérdés: pozitív egész!", "warn");

    const data = await apiFetch("/api/teacher/publish", {
      method: "POST",
      body: JSON.stringify({
        code,
        bankId: activeBankId,
        rowFrom: rf,
        rowTo: rt,
        questionCount: qc,
        perQuestionTimeSec: tsec
      })
    });
    showStatus(`Session mentve a kódhoz: ${code} (kérdés: ${data.selectedCount})`, "ok");
  } catch (e) {
    showStatus("Session mentés hiba: " + e.message, "err");
  }
});

downloadXlsxBtn.addEventListener("click", async () => {
  try {
    hideStatus();
    if (!teacherToken) return showStatus("Előbb lépj be tanárként!", "warn");
    const url = `${API_BASE}/api/teacher/export.xlsx`;
    const res = await fetch(url, { headers: { "X-Teacher-Token": teacherToken } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "eredmenyek.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    showStatus("Export letöltése elindult.", "ok");
  } catch (e) {
    showStatus("Export hiba: " + e.message, "err");
  }
});

// Student controls
const studentCodeInput = el("studentCodeInput");
const loadConfigBtn = el("loadConfigBtn");
const nameInput = el("nameInput");
const startBtn = el("startBtn");
const loadedConfigLine = el("loadedConfigLine");

const scoreEl = el("score");
const progressEl = el("progress");
const qTimerEl = el("qTimer");
const metaLine = el("metaLine");
const promptEl = el("prompt");
const mcArea = el("mcArea");
const feedback = el("feedback");
const quizArea = el("quizArea");
const idleArea = el("idleArea");

let loadedConfig = null;
let quiz = null;

loadConfigBtn.addEventListener("click", async () => {
  try {
    hideStatus();
    const code = studentCodeInput.value.trim();
    if (!code) return showStatus("Adj meg egy tanulói kódot!", "warn");
    const data = await apiFetch(`/api/student/config?code=${encodeURIComponent(code)}`);
    loadedConfig = data;
    loadedConfigLine.textContent = `Kérdések: ${data.questions.length}, idő/kérdés: ${data.perQuestionTimeSec}s`;
    showStatus("Kód betöltve.", "ok");
  } catch (e) {
    loadedConfig = null;
    loadedConfigLine.textContent = "—";
    showStatus("Kód betöltés hiba: " + e.message, "err");
  }
});

function setFeedback(msg, kind) {
  feedback.classList.remove(
    "hidden",
    "bg-rose-100","text-rose-900",
    "bg-emerald-100","text-emerald-900",
    "bg-amber-100","text-amber-900"
  );
  feedback.textContent = msg;
  if (kind === "ok") feedback.classList.add("bg-emerald-100", "text-emerald-900");
  else if (kind === "err") feedback.classList.add("bg-rose-100", "text-rose-900");
  else feedback.classList.add("bg-amber-100", "text-amber-900");
}
function hideFeedback() { feedback.classList.add("hidden"); }

function startQuiz() {
  const code = studentCodeInput.value.trim();
  if (!loadedConfig || loadedConfig.code !== code) {
    showStatus("Előbb töltsd be a kódot!", "warn");
    return;
  }
  const name = nameInput.value.trim();
  if (!name) {
    showStatus("Add meg a neved!", "warn");
    return;
  }

  quiz = {
    code,
    name,
    perQuestionTimeSec: loadedConfig.perQuestionTimeSec,
    questions: loadedConfig.questions,
    idx: 0,
    score: 0,
    answers: [],
    qStartMs: 0,
    timerHandle: null,
    remaining: 0,
    locked: false
  };

  scoreEl.textContent = "0";
  progressEl.textContent = `0/${quiz.questions.length}`;
  qTimerEl.textContent = "--";
  quizArea.classList.remove("hidden");
  idleArea.classList.add("hidden");
  renderQuestion();
}
startBtn.addEventListener("click", startQuiz);

function stopQuestionTimer() {
  if (quiz?.timerHandle) {
    clearInterval(quiz.timerHandle);
    quiz.timerHandle = null;
  }
}

function startQuestionTimer() {
  stopQuestionTimer();
  quiz.remaining = quiz.perQuestionTimeSec;
  qTimerEl.textContent = `${quiz.remaining}s`;
  quiz.qStartMs = Date.now();

  quiz.timerHandle = setInterval(() => {
    quiz.remaining -= 1;
    if (quiz.remaining <= 0) {
      qTimerEl.textContent = `0s`;
      stopQuestionTimer();
      if (!quiz.locked) recordAnswer("", true);
      return;
    }
    qTimerEl.textContent = `${quiz.remaining}s`;
  }, 1000);
}

function renderQuestion() {
  quiz.locked = false;
  const total = quiz.questions.length;
  progressEl.textContent = `${quiz.idx + 1}/${total}`;
  scoreEl.textContent = `${quiz.score}`;

  const q = quiz.questions[quiz.idx];
  metaLine.textContent = `Kód: ${quiz.code} • Név: ${quiz.name}`;
  promptEl.textContent = q.question;

  mcArea.innerHTML = "";
  const opts = [
    { letter: "B", text: q.B },
    { letter: "C", text: q.C },
    { letter: "D", text: q.D },
    { letter: "E", text: q.E }
  ];

  for (const opt of opts) {
    const btn = document.createElement("button");
    btn.className = "w-full text-left border rounded-xl p-3 hover:bg-slate-50";
    btn.innerHTML = `<span class="font-bold mr-2">${opt.letter})</span> ${escapeHtml(opt.text || "")}`;
    btn.addEventListener("click", () => {
      if (quiz.locked) return;
      recordAnswer(opt.letter, false);
    });
    mcArea.appendChild(btn);
  }

  startQuestionTimer();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function recordAnswer(chosenLetter, timeout) {
  quiz.locked = true;
  stopQuestionTimer();

  const q = quiz.questions[quiz.idx];
  const msSpent = Math.max(0, Date.now() - quiz.qStartMs);
  const chosenUpper = chosenLetter ? chosenLetter.toUpperCase() : "";
  const correct = (chosenUpper && chosenUpper === q.correctLetter);

  if (correct) quiz.score += 1;

  quiz.answers.push({
    qid: q.id,
    question: q.question,
    chosenLetter: chosenUpper,
    chosenText: chosenUpper ? (q[chosenUpper] || "") : "",
    correctLetter: q.correctLetter,
    correctText: q[q.correctLetter] || "",
    isCorrect: !!correct,
    timeout: !!timeout,
    msSpent
  });

  if (timeout) setFeedback("Lejárt az idő – továbbléptem.", "warn");
  else setFeedback(correct ? "Helyes ✅" : "Hibás ❌", correct ? "ok" : "err");

  // nincs Next gomb: automatikus továbblépés
  setTimeout(() => {
    quiz.idx += 1;
    if (quiz.idx >= quiz.questions.length) finishQuiz();
    else renderQuestion();
  }, 650);
}

async function finishQuiz() {
  stopQuestionTimer();
  scoreEl.textContent = `${quiz.score}`;
  progressEl.textContent = `${quiz.questions.length}/${quiz.questions.length}`;
  qTimerEl.textContent = "--";

  setFeedback(`Kész. Pontszám: ${quiz.score}/${quiz.questions.length}. Beküldés…`, "ok");

  try {
    await apiFetch("/api/student/submit", {
      method: "POST",
      body: JSON.stringify({
        code: quiz.code,
        name: quiz.name,
        score: quiz.score,
        total: quiz.questions.length,
        answers: quiz.answers
      })
    });
    setFeedback(`Beküldve. Pontszám: ${quiz.score}/${quiz.questions.length}.`, "ok");
  } catch (e) {
    setFeedback("Beküldés hiba: " + e.message, "err");
  }
}