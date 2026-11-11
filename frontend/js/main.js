/* global L */
// App shell: home (my-area status), map (full-screen + sheet), report wizard, alerts.
import { api } from "./api.js";
import {
  createMap, FloodLayers, SusceptLayer, SUSCEPT_CLASSES, RISK_CLASSES, TUNG_KHRU_CENTER,
  severityText, depthRef, depthFull, depthLevel, timeAgo,
} from "./map.js";

const $ = (id) => document.getElementById(id);
const desktop = matchMedia("(min-width: 900px)");
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------------------------------------------------------------- shared wording
const LEVELS = [
  { label: "ปกติ", icon: "✅" },
  { label: "เฝ้าระวัง", icon: "⚠️" },
  { label: "เสี่ยงท่วม", icon: "🌧️" },
  { label: "เสี่ยงสูง", icon: "🚨" },
];
const ADVICE = [
  "ไม่มีความเสี่ยงพิเศษ",
  "ติดตามสถานการณ์ และเลี่ยงถนนที่น้ำท่วมขังบ่อย",
  "ยกของขึ้นที่สูง ย้ายรถออกจากที่ต่ำ เตรียมไฟฉายและยาประจำตัว",
  "ย้ายรถและของมีค่าขึ้นที่สูง เก็บเอกสารสำคัญ ถ้าน้ำเข้าบ้านโทร 1555",
];
// District-wide level from the TMD rain level (light rain alone is not a warning).
const RAIN_TO_LEVEL = { none: 0, light: 0, moderate: 1, heavy: 2, very_heavy: 3 };
// Citizen reports: water depth (ไม่ท่วม/ต่ำกว่าเข่า/เข่า/เอว/คอ) -> status level
const reportLevel = (s) => [0, 1, 2, 3, 3][depthLevel(s)];

function dayName(iso, i) {
  if (i === 0) return "วันนี้";
  if (i === 1) return "พรุ่งนี้";
  return new Date(iso + "T00:00:00+07:00").toLocaleDateString("th-TH", { weekday: "long" });
}
const shortDate = (iso) =>
  new Date(iso + "T00:00:00+07:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" });
const hhmm = (iso) => new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
const fmtLoc = ({ lat, lng }) => `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

function getGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("เครื่องนี้หาตำแหน่งไม่ได้"));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => reject(new Error("ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง (ต้องเปิดผ่าน https หรือ localhost)")),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// ---------------------------------------------------------------- font size
function applyFont(big) {
  document.documentElement.classList.toggle("big", big);
  $("font-btn").setAttribute("aria-pressed", big);
}
applyFont(!!store.get("bigFont"));
$("font-btn").addEventListener("click", () => {
  const big = !document.documentElement.classList.contains("big");
  applyFont(big);
  store.set("bigFont", big);
  map.invalidateSize();
});

api.config().then((c) => {
  if (c.model_version !== "dummy") return;
  $("model-badge").hidden = false;
  $("model-badge").textContent = "โหมดทดสอบ";
}).catch(() => {});

// ---------------------------------------------------------------- map
const map = createMap("map");
const reports = new FloodLayers(map);
const grid = new SusceptLayer(map);
let fitted = false;
function mapShown() {
  map.invalidateSize();
  if (!fitted && map.areaBounds && map.getSize().x > 0) {
    map.fitBounds(map.areaBounds, { padding: [10, 10] });
    fitted = true;
  }
}
map.on("arealoaded", () => (desktop.matches || app.dataset.tab === "map") && mapShown());

// ---------------------------------------------------------------- tabs
const app = $("app");
function showTab(tab) {
  if (tab === "map" && desktop.matches) return; // map is always on screen
  if (picking && tab !== "map" && !desktop.matches) stopPicking(); // left the map: cancel
  app.dataset.tab = tab;
  document.querySelectorAll(".tabbar button").forEach((b) =>
    b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")
  );
  for (const t of ["home", "report", "alerts"]) $("tab-" + t).hidden = t !== tab;
  document.querySelector(".panel").scrollTop = 0;
  if (tab === "map") requestAnimationFrame(mapShown);
  if (tab === "report") wizard.enter();
}
desktop.addEventListener("change", () => {
  if (desktop.matches && app.dataset.tab === "map") showTab("home");
  requestAnimationFrame(mapShown);
});
if (desktop.matches) requestAnimationFrame(mapShown);

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab],[data-goto],[data-mapday]");
  if (!t || t.closest(".map-chips")) return;
  if (t.dataset.mapday !== undefined) {
    setMapView(Number(t.dataset.mapday));
    showTab("map");
  } else {
    showTab(t.dataset.tab || t.dataset.goto);
  }
});

// ---------------------------------------------------------------- forecast data (shared)
let forecast = null;         // /api/forecast/rain
let risks = [];              // /api/forecast/risk?day=i
async function loadForecast() {
  try {
    forecast = await api.rainForecast();
    risks = await Promise.all(forecast.days.map((_, i) => api.riskForecast(i).catch(() => null)));
  } catch {
    forecast = null;
    risks = [];
  }
  renderChips();
  renderAlerts();
  renderHome();
  setMapView(mapView);
}

// ---------------------------------------------------------------- map view: chips + sheet
let mapView = 0; // forecast day index
function renderChips() {
  const days = forecast?.days || [];
  $("map-chips").innerHTML = days.map((d, i) => `<button type="button" class="chip" data-view="${i}">${dayName(d.date, i)}</button>`).join("");
  syncChips();
}
function syncChips() {
  document.querySelectorAll("#map-chips .chip").forEach((c) =>
    c.setAttribute("aria-pressed", String(c.dataset.view === String(mapView)))
  );
}
$("map-chips").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (c) setMapView(Number(c.dataset.view));
});

function setLegend(items) {
  $("legend").innerHTML = items
    .map((c) => `<span style="--c:${c.color};--fg:${c.dark ? "#fff" : "#3a2a00"}">${c.label}</span>`)
    .join("");
}

async function reportLine() {
  const n = (await api.reports(Number($("hours").value)).catch(() => null))?.length;
  if (n == null) return "โหลดรายงานไม่สำเร็จ";
  const span = $("hours").selectedOptions[0].text;
  return n ? `รายงานจากประชาชน ${n} จุด (ย้อนหลัง ${span})` : `ไม่มีรายงานจากประชาชน (ย้อนหลัง ${span})`;
}

// v = forecast day index (0 = today). Citizen reports are shown on every day,
// filtered by the "ย้อนหลัง" setting; the grid shows that day's forecast risk.
let viewSeq = 0;
async function setMapView(v) {
  const seq = ++viewSeq;
  mapView = v;
  syncChips();
  const d = forecast?.days[v];
  const r = risks[v];
  const reportsP = reportLine();

  if (!d || !r) {
    // No forecast: fall back to the static susceptibility grid.
    await grid.setRisk(null);
    setLegend([...SUSCEPT_CLASSES].reverse().map((c, i) => ({ ...c, dark: i >= 3 })));
    const rl = await reportsP;
    if (seq !== viewSeq) return;
    $("sheet-title").textContent = forecast ? "ไม่มีข้อมูลพยากรณ์วันนี้" : "แผนที่ความเสี่ยงตามสภาพพื้นที่";
    $("sheet-sub").textContent = `${rl} · สีพื้น = ความเสี่ยงตามสภาพพื้นที่ (ต่ำ → สูง)`;
    return;
  }

  setLegend(RISK_CLASSES.map((c, i) => ({ ...c, dark: i >= 2 })));
  if (!$("grid-toggle").checked) {
    $("grid-toggle").checked = true;
    grid.setVisible(true);
  }
  await grid.setRisk({ ...r, title: dayName(d.date, v) });
  const risky = r.counts[2] + r.counts[3];
  const riskLine = risky
    ? `พื้นที่เสี่ยงท่วม ~${risky} เฮกตาร์ · เฝ้าระวัง ~${r.counts[1]} เฮกตาร์`
    : r.counts[1] ? `ไม่มีพื้นที่เสี่ยงท่วม · เฝ้าระวัง ~${r.counts[1]} เฮกตาร์` : "ไม่มีพื้นที่เสี่ยง";
  const rl = await reportsP;
  if (seq !== viewSeq) return;
  $("sheet-title").textContent = `${dayName(d.date, v)} · ${d.level_label} ${d.rain_max.toFixed(1)} มม.`;
  $("sheet-sub").innerHTML = `${riskLine}<br>${rl}`;
}

$("sheet-toggle").addEventListener("click", () => {
  const open = $("sheet-more").hidden;
  $("sheet-more").hidden = !open;
  $("sheet-toggle").setAttribute("aria-expanded", open);
});
document.querySelectorAll('input[name="layer"]').forEach((el) =>
  el.addEventListener("change", () => reports.setMode(el.value))
);
$("hours").addEventListener("change", (e) => {
  reports.setHours(Number(e.target.value));
  setMapView(mapView); // refresh the report count
});
$("grid-toggle").addEventListener("change", (e) => grid.setVisible(e.target.checked));
grid.setVisible(true);

// ---------------------------------------------------------------- home location
let homeLoc = store.get("homeLoc");
let homeMarker = null;
let picking = false;

function setHome(loc) {
  homeLoc = loc;
  store.set("homeLoc", loc);
  drawHomeMarker();
  renderHome();
}
function drawHomeMarker() {
  if (!homeLoc) return;
  if (!homeMarker) {
    homeMarker = L.circleMarker([homeLoc.lat, homeLoc.lng], {
      radius: 9, weight: 3, color: "#fff", fillColor: "#1565c0", fillOpacity: 1,
    }).bindTooltip("บ้านของคุณ").addTo(map);
  }
  homeMarker.setLatLng([homeLoc.lat, homeLoc.lng]);
}
drawHomeMarker();

$("loc-gps").addEventListener("click", async () => {
  $("loc-msg").className = "msg";
  $("loc-msg").textContent = "กำลังหาตำแหน่ง…";
  try {
    setHome(await getGPS());
    $("loc-msg").textContent = "";
  } catch (err) {
    $("loc-msg").className = "msg err";
    $("loc-msg").textContent = err.message + " ลองกด \"เลือกบนแผนที่\" แทน";
  }
});
// While picking a spot on the main map, hide the 100 m grid so streets are readable.
let gridBeforePick = null;
function startPicking() {
  picking = true;
  $("pick-hint").hidden = false;
  gridBeforePick = $("grid-toggle").checked;
  if (gridBeforePick) {
    $("grid-toggle").checked = false;
    grid.setVisible(false);
  }
}
function stopPicking() {
  picking = false;
  $("pick-hint").hidden = true;
  if (gridBeforePick) {
    $("grid-toggle").checked = true;
    grid.setVisible(true);
  }
  gridBeforePick = null;
}
$("loc-pick").addEventListener("click", () => {
  startPicking();
  if (desktop.matches) mapShown();
  else showTab("map");
});
$("pick-cancel").addEventListener("click", () => {
  stopPicking();
  showTab("home");
});
map.on("click", (e) => {
  if (!picking) return;
  stopPicking();
  setHome({ lat: e.latlng.lat, lng: e.latlng.lng });
  showTab("home");
});
$("loc-change").addEventListener("click", () => {
  $("loc-setup").hidden = !$("loc-setup").hidden;
});

// ---------------------------------------------------------------- home render
function setStatus(el, lvl, label, detail, icon) {
  el.className = `status st-${lvl}`;
  el.innerHTML =
    `<div class="st-icon" aria-hidden="true">${icon || LEVELS[lvl].icon}</div>` +
    `<div class="st-label">${label}</div><div class="st-detail">${detail}</div>`;
}
function dayButtons(items) {
  // items: [{date, level, label, rain}]
  return items
    .map(
      (d, i) => `
      <button type="button" class="day st-${d.level}" data-mapday="${i}"
        aria-label="${dayName(d.date, i)} ${d.label} ฝน ${d.rain.toFixed(1)} มิลลิเมตร ดูบนแผนที่">
        <span class="d-name">${dayName(d.date, i)}</span>
        <span class="d-ico" aria-hidden="true">${LEVELS[d.level].icon}</span>
        <span class="d-lv">${d.label}</span>
        <span class="d-rain">ฝน ${d.rain.toFixed(1)} มม.</span>
      </button>`
    )
    .join("");
}

let homeSeq = 0;
async function renderHome() {
  const seq = ++homeSeq;
  const st = $("status");
  $("home-meta").textContent = forecast
    ? `อัปเดต ${hhmm(forecast.fetched_at)}${forecast.stale ? " (ข้อมูลเก่า)" : ""} · ฝนพยากรณ์จากกรมอุตุนิยมวิทยา`
    : "";

  if (!homeLoc) {
    $("home-loc").textContent = "ทั้งเขตทุ่งครุ";
    $("loc-change").hidden = true;
    $("loc-setup").hidden = false;
    if (!forecast) {
      setStatus(st, 0, "ไม่มีข้อมูล", "ดึงพยากรณ์ฝนไม่ได้ในขณะนี้", "❔");
      $("home-days").innerHTML = "";
      return;
    }
    const days = forecast.days.map((d) => ({
      date: d.date, level: RAIN_TO_LEVEL[d.level], label: LEVELS[RAIN_TO_LEVEL[d.level]].label, rain: d.rain_max,
    }));
    const t = days[0];
    setStatus(st, t.level, t.label, `ทั้งเขต วันนี้ · ${forecast.days[0].level_label} ${t.rain.toFixed(1)} มม.<br>${ADVICE[t.level]}`);
    $("home-days").innerHTML = dayButtons(days);
    return;
  }

  $("home-loc").textContent = `บ้านของคุณ (${fmtLoc(homeLoc)})`;
  $("loc-change").hidden = false;
  $("loc-setup").hidden = true;
  const [rk, area] = await Promise.all([
    api.riskAt(homeLoc.lat, homeLoc.lng).then((r) => r.cell).catch(() => undefined),
    api.area(homeLoc.lat, homeLoc.lng, 24).catch(() => null),
  ]);
  if (seq !== homeSeq) return; // a newer render started

  if (area && !area.in_district) {
    setStatus(st, 0, "อยู่นอกพื้นที่", "ตำแหน่งนี้อยู่นอกพื้นที่ที่ระบบดูแล (เขตทุ่งครุ)<br>กด \"เปลี่ยน\" เพื่อเลือกตำแหน่งใหม่", "📍");
    $("home-days").innerHTML = "";
    return;
  }

  const s = area?.summary;
  const repLvl = s ? reportLevel(s.severity) : 0;
  const nowLine = s
    ? `ตอนนี้: <strong>${depthFull(s.severity)}</strong><br>${s.count} รายงาน · ล่าสุด ${timeAgo(s.latest)}`
    : "ตอนนี้: ยังไม่มีรายงานน้ำท่วมแถวนี้";

  if (!rk) {
    setStatus(st, repLvl, s && repLvl ? severityText(s.severity) : LEVELS[repLvl].label,
      `${nowLine}<br>ยังไม่มีข้อมูลพยากรณ์สำหรับจุดนี้`);
    $("home-days").innerHTML = "";
    return;
  }
  const today = rk.days[0];
  const lvl = Math.max(today.risk, repLvl);
  const label = repLvl > today.risk ? severityText(s.severity) : LEVELS[lvl].label;
  setStatus(st, lvl, label,
    `บริเวณบ้านคุณ วันนี้<br>${nowLine}<br>ฝน ${today.rain_mm.toFixed(1)} มม. · สภาพพื้นที่เสี่ยง${rk.suscept_label}<br><strong>${ADVICE[lvl]}</strong>`);
  $("home-days").innerHTML = dayButtons(
    rk.days.map((d) => ({ date: d.date, level: d.risk, label: d.risk_label, rain: d.rain_mm }))
  );
}

// ---------------------------------------------------------------- alerts tab
function renderAlerts() {
  if (!forecast) {
    $("alert-list").innerHTML = `<p class="hint">ดึงพยากรณ์ฝนไม่ได้ในขณะนี้</p>`;
    $("alert-dot").hidden = true;
    return;
  }
  let worst = 0;
  $("alert-list").innerHTML = forecast.days
    .map((d, i) => {
      const lvl = RAIN_TO_LEVEL[d.level];
      worst = Math.max(worst, lvl);
      const r = risks[i];
      const risky = r ? r.counts[2] + r.counts[3] : null;
      return `
      <article class="alert-item st-${lvl}">
        <div class="ai-head"><strong>${dayName(d.date, i)} ${shortDate(d.date)}</strong>
          <span class="ai-lv">${LEVELS[lvl].icon} ${LEVELS[lvl].label}</span></div>
        <p>${esc(d.level_label)} สูงสุด ${d.rain_max.toFixed(1)} มม.${
          risky ? ` · พื้นที่เสี่ยงท่วม ~${risky} เฮกตาร์` : ""}</p>
        <p>${ADVICE[lvl]}</p>
        <button type="button" class="link" data-mapday="${i}">ดูบนแผนที่ →</button>
      </article>`;
    })
    .join("");
  $("alert-dot").hidden = worst < 1;
}

// ---------------------------------------------------------------- report wizard
const wizard = (() => {
  let step = 1, file = null, loc = null, pickMap = null, triedGPS = false;
  const steps = () => document.querySelectorAll("#tab-report .step");

  function show(n) {
    step = n;
    steps().forEach((el) => (el.hidden = el.dataset.step !== String(n)));
    const k = n === "done" ? 3 : n;
    $("wiz-count").textContent = n === "done" ? "เสร็จแล้ว" : `ขั้น ${n} จาก 3`;
    document.querySelectorAll(".progress span").forEach((s, i) => s.classList.toggle("on", i < k));
    if (n === 2) initPick();
    if (n === 3) {
      $("confirm-img").src = $("preview").src;
      $("confirm-loc").textContent = `ตำแหน่ง ${fmtLoc(loc)}`;
    }
  }

  function initPick() {
    const start = loc || homeLoc || { lat: TUNG_KHRU_CENTER[0], lng: TUNG_KHRU_CENTER[1] };
    if (!pickMap) {
      pickMap = L.map("pick-map", { zoomControl: true, attributionControl: false })
        .setView([start.lat, start.lng], homeLoc || loc ? 17 : 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(pickMap);
    }
    requestAnimationFrame(() => pickMap.invalidateSize());
    if (!triedGPS && !loc) {
      triedGPS = true;
      useGPS(true);
    }
  }

  async function useGPS(quiet) {
    $("step2-msg").className = "msg";
    $("step2-msg").textContent = "กำลังหาตำแหน่ง…";
    try {
      const p = await getGPS();
      pickMap.setView([p.lat, p.lng], 18);
      $("step2-msg").textContent = "";
    } catch (err) {
      $("step2-msg").className = quiet ? "msg" : "msg err";
      $("step2-msg").textContent = quiet ? "เลื่อนแผนที่ไปยังจุดที่น้ำท่วม" : err.message;
    }
  }

  function pickFile(f) {
    if (!f) return;
    file = f;
    $("preview").src = URL.createObjectURL(f);
    $("preview").hidden = false;
    $("photo-hint").hidden = true;
    $("step1-msg").textContent = "";
  }
  $("image").addEventListener("change", (e) => pickFile(e.target.files[0]));
  $("image-gallery").addEventListener("change", (e) => pickFile(e.target.files[0]));
  $("pick-gps").addEventListener("click", () => useGPS(false));

  document.querySelectorAll("#tab-report [data-next]").forEach((b) =>
    b.addEventListener("click", () => {
      if (step === 1) {
        if (!file) return ($("step1-msg").textContent = "ถ่ายรูปหรือเลือกรูปก่อน แล้วกดถัดไป");
        show(2);
      } else if (step === 2) {
        const c = pickMap.getCenter();
        loc = { lat: c.lat, lng: c.lng };
        show(3);
      }
    })
  );
  document.querySelectorAll("#tab-report [data-back]").forEach((b) =>
    b.addEventListener("click", () => show(step - 1))
  );

  $("submit").addEventListener("click", async () => {
    $("submit").disabled = true;
    $("step3-msg").className = "msg";
    $("step3-msg").textContent = "กำลังส่งและวิเคราะห์รูป…";
    try {
      const r = await api.submitReport(file, loc.lat.toFixed(6), loc.lng.toFixed(6));
      const lvl = reportLevel(r.score);
      setStatus($("done-card"), lvl, "ส่งแล้ว ขอบคุณครับ",
        `ระบบประเมินจากรูป: <strong>${severityText(r.score)}</strong><br>(${depthRef(r.score)})<br>รายงานของคุณช่วยเตือนเพื่อนบ้านได้`, "✅");
      $("step3-msg").textContent = "";
      show("done");
      reports.refresh();
      setMapView(mapView);
      renderHome();
    } catch (err) {
      $("step3-msg").className = "msg err";
      $("step3-msg").textContent = err.message;
    } finally {
      $("submit").disabled = false;
    }
  });

  $("done-map").addEventListener("click", () => {
    if (loc) map.setView([loc.lat, loc.lng], 17);
  });
  $("again").addEventListener("click", () => {
    file = null;
    loc = null;
    $("image").value = "";
    $("image-gallery").value = "";
    $("preview").hidden = true;
    $("photo-hint").hidden = false;
    show(1);
  });

  return { enter: () => step === 2 && initPick() };
})();

// ---------------------------------------------------------------- start
showTab("home");
reports.refresh();
setMapView(mapView);
loadForecast();
setInterval(loadForecast, 30 * 60_000);
setInterval(() => reports.refresh(), 60_000);
