// "When was this photo taken?" for the report form.
// 1. Read the time from the photo's EXIF; if found, it is pre-selected.
// 2. Otherwise one tap on a shortcut (ตอนนี้ / 30 นาทีก่อน / … / เมื่อวาน).
// 3. "เลือกเอง" / "แก้" opens a scroll wheel (day · hour · minute) for exact values.
import { readPhotoTime } from "./exif.js";

export const MAX_AGE_DAYS = 30; // same limit as the backend
const ROW = 36;                 // wheel row height (px), must match .wheel-col div in CSS
const PAD_ROWS = 2;             // empty rows above/below so first/last item can sit in the band

const pad = (n) => String(n).padStart(2, "0");
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysAgo = (d) => Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
function dayLabel(d) {
  const k = daysAgo(d);
  const date = d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  if (k === 0) return `วันนี้ ${date}`;
  if (k === 1) return `เมื่อวาน ${date}`;
  return `${d.toLocaleDateString("th-TH", { weekday: "short" })} ${date}`;
}
export const fmtWhen = (d) => `${dayLabel(d)} · ${pad(d.getHours())}:${pad(d.getMinutes())} น.`;
export const SOURCE_TEXT = { exif: "จากข้อมูลในรูป", user: "เลือกเอง", now: "ตอนนี้" };

// Shortcuts. `at()` returns the Date; `refine` opens the wheel so the time can be adjusted.
const SHORTCUTS = [
  { id: "now", label: "ตอนนี้", at: () => new Date() },
  { id: "m30", label: "30 นาทีก่อน", at: () => new Date(Date.now() - 30 * 60_000) },
  { id: "h1", label: "1 ชม.ก่อน", at: () => new Date(Date.now() - 60 * 60_000) },
  { id: "h2", label: "2 ชม.ก่อน", at: () => new Date(Date.now() - 2 * 60 * 60_000) },
  { id: "h3", label: "3 ชม.ก่อน", at: () => new Date(Date.now() - 3 * 60 * 60_000) },
  {
    id: "morning", label: "เมื่อเช้า", refine: true,
    at: () => { const d = startOfDay(new Date()); d.setHours(8); return d; },
    show: () => new Date().getHours() >= 10,
  },
  {
    id: "yesterday", label: "เมื่อวาน", refine: true,
    at: () => { const d = startOfDay(new Date()); d.setDate(d.getDate() - 1); d.setHours(18); return d; },
  },
  { id: "custom", label: "เลือกเอง…", refine: true, at: null },
];

export function createWhenPicker(root) {
  const el = (sel) => root.querySelector(sel);
  const note = el(".when-source");
  const chips = el(".when-chips");
  const summary = el(".when-summary");
  const wheel = el(".wheel");
  const cols = { day: el('[data-col="day"]'), hour: el('[data-col="hour"]'), min: el('[data-col="min"]') };

  let exifTime = null;
  let chosen = null;   // { id, date, source }  (id = shortcut id, "exif" or "wheel")
  let days = [];       // Date per row of the day column (oldest first, today last)
  let silentUntil = 0; // ignore scroll events caused by our own scrollTo
  let file = null;

  // ---------------------------------------------------------------- wheel
  function buildWheel() {
    const today = startOfDay(new Date());
    days = Array.from({ length: MAX_AGE_DAYS + 1 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (MAX_AGE_DAYS - i));
      return d;
    });
    const rows = (labels) =>
      "<div></div>".repeat(PAD_ROWS) +
      labels.map((t, i) => `<div data-i="${i}" role="option">${t}</div>`).join("") +
      "<div></div>".repeat(PAD_ROWS);
    cols.day.innerHTML = rows(days.map(dayLabel));
    cols.hour.innerHTML = rows(Array.from({ length: 24 }, (_, i) => pad(i)));
    cols.min.innerHTML = rows(Array.from({ length: 60 }, (_, i) => pad(i)));
  }
  const idx = (col) => Math.max(0, Math.round(col.scrollTop / ROW));
  function scrollTo(col, i, smooth) {
    silentUntil = Date.now() + 400;
    col.scrollTo({ top: i * ROW, behavior: smooth ? "smooth" : "auto" });
    highlight();
  }
  function highlight() {
    for (const col of Object.values(cols)) {
      const k = idx(col);
      col.querySelectorAll("[data-i]").forEach((r) => r.setAttribute("aria-selected", String(+r.dataset.i === k)));
    }
  }
  function setWheel(d, smooth = false) {
    const k = days.findIndex((x) => +x === +startOfDay(d));
    scrollTo(cols.day, k < 0 ? days.length - 1 : k, smooth);
    scrollTo(cols.hour, d.getHours(), smooth);
    scrollTo(cols.min, d.getMinutes(), smooth);
  }
  function wheelDate() {
    const d = new Date(days[Math.min(idx(cols.day), days.length - 1)]);
    d.setHours(Math.min(idx(cols.hour), 23), Math.min(idx(cols.min), 59), 0, 0);
    return d;
  }
  for (const col of Object.values(cols)) {
    col.addEventListener("scroll", () => {
      highlight();
      clearTimeout(col._t);
      col._t = setTimeout(() => {
        if (Date.now() < silentUntil || !col.clientHeight) return; // ours, or wheel not on screen
        choose({ id: "wheel", date: wheelDate(), source: "user" }, false);
      }, 120);
    });
    // mouse users: click a row to jump to it
    col.addEventListener("click", (e) => {
      const r = e.target.closest("[data-i]");
      if (r) { silentUntil = 0; col.scrollTo({ top: +r.dataset.i * ROW, behavior: "smooth" }); }
    });
    // keyboard: ↑ ↓
    col.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      silentUntil = 0;
      col.scrollTo({ top: (idx(col) + (e.key === "ArrowDown" ? 1 : -1)) * ROW, behavior: "smooth" });
    });
  }
  function openWheel(d) {
    wheel.hidden = false;
    renderSummary();
    setWheel(d || chosen?.date || new Date()); // layout is synchronous once unhidden
  }

  // ---------------------------------------------------------------- chips
  function renderChips() {
    const items = [];
    if (exifTime) items.push({ id: "exif", label: `📷 จากรูป ${fmtWhen(exifTime)}` });
    for (const s of SHORTCUTS) if (!s.show || s.show()) items.push(s);
    chips.innerHTML = items
      .map((s) => `<button type="button" class="chip${s.id === "exif" ? " exif" : ""}" data-id="${s.id}"
        aria-pressed="${chosen?.id === s.id || (s.id === "custom" && chosen?.id === "wheel")}">${s.label}</button>`)
      .join("");
  }
  chips.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const id = b.dataset.id;
    if (id === "exif") return choose({ id, date: exifTime, source: "exif" }, true);
    const s = SHORTCUTS.find((x) => x.id === id);
    if (id === "custom") {
      choose({ id: "wheel", date: chosen?.date || new Date(), source: "user" }, true);
      return openWheel();
    }
    if (!s.refine) wheel.hidden = true;
    choose({ id, date: s.at(), source: id === "now" ? "now" : "user" }, true);
    if (s.refine) openWheel(chosen.date);
  });

  function renderSummary() {
    const c = chosen;
    summary.innerHTML = c?.date
      ? `บันทึกเป็น <strong>${fmtWhen(c.date)}</strong>` +
        (c.id === "now" ? " (เวลาตอนกดส่ง)" : "") +
        (wheel.hidden ? ` <button type="button" class="link when-edit">แก้</button>` : "")
      : "";
  }
  function choose(c, syncWheel) {
    chosen = c;
    renderChips();
    renderSummary();
    if (syncWheel && !wheel.hidden && c.date) setWheel(c.date, true);
    root.dispatchEvent(new Event("change"));
  }
  summary.addEventListener("click", (e) => {
    if (e.target.closest(".when-edit")) openWheel(chosen?.date);
  });

  // ---------------------------------------------------------------- public API
  return {
    async setPhoto(f) {
      file = f;
      root.hidden = false;
      wheel.hidden = true;
      buildWheel();
      chosen = null;
      exifTime = null;
      summary.textContent = "";
      note.className = "when-source";
      note.textContent = "กำลังอ่านวันเวลาจากรูป…";
      renderChips();
      const t = await readPhotoTime(f);
      if (file !== f) return; // another photo picked meanwhile
      exifTime = t;
      if (t) {
        note.className = "when-source ok";
        note.textContent = "✓ อ่านวันเวลาจากข้อมูลในรูปแล้ว ถ้าไม่ถูกต้องเลือกปุ่มอื่นได้";
        choose({ id: "exif", date: t, source: "exif" }, false);
      } else {
        note.className = "when-source warn";
        note.textContent = "รูปนี้ไม่มีข้อมูลวันเวลา แตะปุ่มที่ตรงที่สุด";
        renderChips();
      }
    },
    reset() {
      file = null;
      exifTime = null;
      chosen = null;
      root.hidden = true;
      wheel.hidden = true;
      summary.textContent = "";
    },
    /** { date, source } — "ตอนนี้" is re-read at call time. */
    read() {
      if (!chosen) return { date: null, source: null };
      if (chosen.id === "now") return { date: new Date(), source: "now" };
      return { date: chosen.date, source: chosen.source };
    },
    error() {
      const { date } = this.read();
      if (!date) return "เลือกว่าถ่ายรูปเมื่อไร (แตะปุ่มที่ตรงที่สุด)";
      if (date - Date.now() > 10 * 60_000) return "เวลาที่เลือกอยู่ในอนาคต กรุณาตรวจสอบ";
      if (Date.now() - date > MAX_AGE_DAYS * 86_400_000) return `รูปเก่าเกิน ${MAX_AGE_DAYS} วัน ใช้แจ้งไม่ได้`;
      return "";
    },
  };
}
