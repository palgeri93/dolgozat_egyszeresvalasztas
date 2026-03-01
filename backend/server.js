import express from "express";
import cors from "cors";
import multer from "multer";
import XLSX from "xlsx";
import ExcelJS from "exceljs";
import { nanoid } from "nanoid";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const PORT = process.env.PORT || 3000;
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || "";
const TEACHER_TOKEN = process.env.TEACHER_TOKEN || "";

// MVP in-memory stores
const banks = new Map();      // bankId -> { createdAt, questions }
const sessions = new Map();   // code -> session
const submissions = [];       // array of submissions

const issuedTeacherTokens = new Set();
function issueTeacherToken() {
  const t = nanoid(24);
  issuedTeacherTokens.add(t);
  setTimeout(() => issuedTeacherTokens.delete(t), 24 * 3600 * 1000).unref?.();
  return t;
}

function requireTeacher(req, res, next) {
  const tok = req.header("X-Teacher-Token") || "";
  if (!tok) return res.status(401).send("Missing X-Teacher-Token");
  if (TEACHER_TOKEN && tok === TEACHER_TOKEN) return next();
  if (issuedTeacherTokens.has(tok)) return next();
  return res.status(403).send("Invalid teacher token");
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/teacher/login", (req, res) => {
  const { password } = req.body || {};
  if (!TEACHER_PASSWORD) return res.status(500).json({ error: "TEACHER_PASSWORD not configured" });
  if (password !== TEACHER_PASSWORD) return res.status(401).json({ error: "wrong_password" });
  return res.json({ teacherToken: issueTeacherToken() });
});

// Upload Excel and parse FIRST sheet.
// Columns: A question, B/C/D/E options, F correct letter (B/C/D/E)
app.post("/api/teacher/upload", requireTeacher, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "missing_file" });
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) return res.status(400).json({ error: "no_sheets" });

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

    const validLetters = new Set(["B", "C", "D", "E"]);
    const questions = [];

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      const qText = String(row[0] ?? "").trim();
      if (!qText) continue;

      const B = String(row[1] ?? "").trim();
      const C = String(row[2] ?? "").trim();
      const D = String(row[3] ?? "").trim();
      const E = String(row[4] ?? "").trim();
      const correct = String(row[5] ?? "").trim().toUpperCase();

      if (!validLetters.has(correct)) continue;

      questions.push({
        id: nanoid(10),
        rowNumber: r + 1,
        question: qText,
        B, C, D, E,
        correctLetter: correct
      });
    }

    if (questions.length === 0) {
      return res.status(400).json({ error: "no_valid_questions_found", hint: "Check columns A-F and correct letters B/C/D/E." });
    }

    const bankId = nanoid(8);
    banks.set(bankId, { createdAt: Date.now(), questions });
    return res.json({ bankId, totalQuestions: questions.length });
  } catch (e) {
    return res.status(500).json({ error: "parse_failed", detail: String(e?.message || e) });
  }
});

app.post("/api/teacher/publish", requireTeacher, (req, res) => {
  const { code, bankId, rowFrom, rowTo, questionCount, perQuestionTimeSec } = req.body || {};
  if (!code || typeof code !== "string") return res.status(400).json({ error: "missing_code" });
  if (!bankId || !banks.has(bankId)) return res.status(400).json({ error: "unknown_bank" });

  const rf = Number(rowFrom);
  const rt = Number(rowTo);
  const qc = Number(questionCount);
  const tsec = Number(perQuestionTimeSec);

  if (!Number.isInteger(rf) || rf < 1) return res.status(400).json({ error: "bad_rowFrom" });
  if (!Number.isInteger(rt) || rt < rf) return res.status(400).json({ error: "bad_rowTo" });
  if (!Number.isInteger(qc) || qc < 1) return res.status(400).json({ error: "bad_questionCount" });
  if (!Number.isInteger(tsec) || tsec < 1) return res.status(400).json({ error: "bad_perQuestionTimeSec" });

  const bank = banks.get(bankId);
  const eligible = bank.questions.filter(q => q.rowNumber >= rf && q.rowNumber <= rt);
  if (eligible.length === 0) return res.status(400).json({ error: "no_questions_in_range" });

  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(qc, shuffled.length));
  const selectedIds = selected.map(q => q.id);

  sessions.set(code, {
    code, bankId,
    rowFrom: rf, rowTo: rt,
    questionCount: qc,
    perQuestionTimeSec: tsec,
    selectedQuestionIds: selectedIds
  });

  return res.json({ ok: true, selectedCount: selectedIds.length });
});

app.get("/api/student/config", (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!code) return res.status(400).json({ error: "missing_code" });
  const sess = sessions.get(code);
  if (!sess) return res.status(404).json({ error: "unknown_code" });

  const bank = banks.get(sess.bankId);
  if (!bank) return res.status(500).json({ error: "bank_missing" });

  const byId = new Map(bank.questions.map(q => [q.id, q]));
  const questions = sess.selectedQuestionIds
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(q => ({
      id: q.id,
      question: q.question,
      B: q.B, C: q.C, D: q.D, E: q.E,
      correctLetter: q.correctLetter
    }));

  return res.json({ code: sess.code, perQuestionTimeSec: sess.perQuestionTimeSec, questions });
});

app.post("/api/student/submit", (req, res) => {
  const { code, name, score, total, answers } = req.body || {};
  if (!code || !sessions.has(code)) return res.status(400).json({ error: "unknown_code" });
  if (!name || typeof name !== "string") return res.status(400).json({ error: "missing_name" });
  if (!Array.isArray(answers)) return res.status(400).json({ error: "missing_answers" });

  submissions.push({
    submittedAt: Date.now(),
    code,
    name: String(name).trim(),
    score: Number(score) || 0,
    total: Number(total) || answers.length,
    answers
  });

  return res.json({ ok: true });
});

app.get("/api/teacher/export.xlsx", requireTeacher, async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "MCQ Exam App";
    wb.created = new Date();

    if (submissions.length === 0) {
      wb.addWorksheet("Üres").addRow(["Nincs beküldött dolgozat."]);
    } else {
      for (const sub of submissions) {
        const ts = new Date(sub.submittedAt);
        const stamp = ts.toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const safeName = (sub.name || "Tanulo").replace(/[\\/*?:[\]]/g, "_").slice(0, 22);
        const sheetName = `${safeName}_${stamp}`.slice(0, 31);

        const ws = wb.addWorksheet(sheetName);
        ws.addRow(["Név", sub.name]);
        ws.addRow(["Kód", sub.code]);
        ws.addRow(["Dátum", ts.toLocaleString()]);
        ws.addRow(["Pont", `${sub.score}/${sub.total}`]);
        ws.addRow([]);

        ws.addRow(["Kérdés", "Tanuló válasz", "Helyes válasz", "Pont", "Idő (ms)", "Timeout"]);
        ws.getRow(ws.lastRow.number).font = { bold: true };

        for (const a of sub.answers) {
          const chosen = a.chosenLetter ? `${a.chosenLetter} – ${a.chosenText || ""}` : (a.timeout ? "TIMEOUT" : "");
          const corr = a.correctLetter ? `${a.correctLetter} – ${a.correctText || ""}` : "";
          ws.addRow([a.question || "", chosen, corr, a.isCorrect ? 1 : 0, a.msSpent ?? "", a.timeout ? "1" : "0"]);
        }

        ws.columns = [
          { width: 60 },
          { width: 30 },
          { width: 30 },
          { width: 8 },
          { width: 12 },
          { width: 10 }
        ];
      }
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="eredmenyek.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(500).send("export_failed: " + String(e?.message || e));
  }
});

app.listen(PORT, () => console.log(`Backend listening on :${PORT}`));