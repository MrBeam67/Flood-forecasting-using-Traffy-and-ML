/* global L */
import { api } from "./api.js";
import { createMap, FloodLayers, SusceptLayer, SUSCEPT_CLASSES, RISK_CLASSES, severityText, timeAgo } from "./map.js";

const $ = (id) => document.getElementById(id);
const map = createMap("map");
const layers = new FloodLayers(map);

// ---- flood susceptibility grid (from QGIS)
const suscept = new SusceptLayer(map);
function setLegend(classes) {
  $("suscept-legend").classList.toggle("risk", classes === RISK_CLASSES);
  $("suscept-legend").innerHTML = classes.map((c) => `<span style="--c:${c.color}">${c.label}</span>`).join("");
}
setLegend([...SUSCEPT_CLASSES].reverse());
const syncSuscept = () => {
  const on = $("suscept-toggle").checked;
  $("suscept-legend").hidden = !on;
  suscept.setVisible(on);
};
$("suscept-toggle").addEventListener("change", syncSuscept);
syncSuscept();

// ---- model badge
api.config().then((c) => {
  const b = $("model-badge");
  b.textContent = c.model_version === "dummy" ? "โมเดลทดสอบ (ผลยังไม่จริง)" : `model: ${c.model_version}`;
  b.classList.toggle("dummy", c.model_version === "dummy");
});

// ---- 3-day rain forecast (TMD) + forecast risk on the 100 m grid
const WARN_LEVELS = new Set(["moderate", "heavy", "very_heavy"]);
function dayName(iso, i) {
  if (i === 0) return "วันนี้";
  if (i === 1) return "พรุ่งนี้";
  return new Date(iso + "T00:00:00+07:00").toLocaleDateString("th-TH", { weekday: "long" });
}
const shortDate = (iso) =>
  new Date(iso + "T00:00:00+07:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" });

let selectedDay = null;

async function selectDay(i) {
  selectedDay = selectedDay === i ? null : i; // click again = back to static map
  document.querySelectorAll(".rain-day").forEach((el, k) => el.setAttribute("aria-pressed", k === selectedDay));
  if (selectedDay === null) {
    await suscept.setRisk(null);
    setLegend([...SUSCEPT_CLASSES].reverse());
    $("grid-mode").hidden = true;
    return;
  }
  const day = selectedDay;
  $("grid-mode").hidden = false;
  $("grid-mode").textContent = "กำลังคำนวณพื้นที่เสี่ยง…";
  try {
    const r = await api.riskForecast(day);
    if (selectedDay !== day) return; // user clicked something else meanwhile
    const title = dayName(r.date, day);
    if (!$("suscept-toggle").checked) {
      $("suscept-toggle").checked = true;
      syncSuscept();
    }
    await suscept.setRisk({ ...r, title });
    setLegend(RISK_CLASSES);
    const ha = r.counts[2] + r.counts[3];
    $("grid-mode").innerHTML =
      `แสดง: <strong>ความเสี่ยงคาดการณ์ ${title} (${shortDate(r.date)})</strong><br>` +
      (ha ? `พื้นที่เสี่ยงท่วม ~${ha} เฮกตาร์ · เฝ้าระวัง ~${r.counts[1]} เฮกตาร์` :
            r.counts[1] ? `ไม่มีพื้นที่เสี่ยงท่วม · เฝ้าระวัง ~${r.counts[1]} เฮกตาร์` : "ไม่มีพื้นที่เสี่ยง");
  } catch {
    $("grid-mode").textContent = "คำนวณพื้นที่เสี่ยงไม่สำเร็จ";
  }
}

async function loadRain() {
  try {
    const f = await api.rainForecast();
    $("rain-days").innerHTML = f.days
      .map(
        (d, i) => `
        <button type="button" class="rain-day lv-${d.level}" data-day="${i}" aria-pressed="${i === selectedDay}">
          <div class="rd-name">${dayName(d.date, i)}<span>${shortDate(d.date)}</span></div>
          <div class="rd-mm">${d.rain_max.toFixed(1)}<small> มม.</small></div>
          <div class="rd-level">${d.level_label}</div>
          <div class="rd-range">ทั้งเขต ${d.rain_min.toFixed(1)}–${d.rain_max.toFixed(1)}</div>
        </button>`
      )
      .join("");
    const t = new Date(f.fetched_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    $("rain-meta").textContent = `อัปเดต ${t}${f.stale ? " (ข้อมูลเก่า)" : ""}`;

    const warn = f.days.map((d, i) => [d, i]).filter(([d]) => WARN_LEVELS.has(d.level));
    $("rain-alert").hidden = warn.length === 0;
    if (warn.length) {
      const [d, i] = warn.reduce((a, b) => (b[0].rain_max > a[0].rain_max ? b : a));
      $("rain-alert").innerHTML =
        `⚠️ ${dayName(d.date, i)}คาด${d.level_label} สูงสุด ${d.rain_max.toFixed(1)} มม. ` +
        `<button type="button" class="link" data-day="${i}">ดูพื้นที่เสี่ยงบนแผนที่</button>`;
    }
    if (selectedDay !== null) {
      const keep = selectedDay;
      selectedDay = null;
      await selectDay(keep); // refresh the map with the new forecast
    }
  } catch (err) {
    $("rain-days").innerHTML = `<p class="hint">ดึงพยากรณ์ฝนไม่ได้ในขณะนี้</p>`;
    $("rain-meta").textContent = "";
    $("rain-alert").hidden = true;
  }
}
$("rain-card").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-day]");
  if (!btn) return;
  const i = Number(btn.dataset.day);
  if (btn.classList.contains("link") && selectedDay === i) return; // already showing it
  selectDay(i);
});
loadRain();
setInterval(loadRain, 30 * 60_000);

// ---- layer controls
document.querySelectorAll('input[name="layer"]').forEach((el) =>
  el.addEventListener("change", () => layers.setMode(el.value))
);
$("hours").addEventListener("change", (e) => layers.setHours(Number(e.target.value)));
layers.refresh();
setInterval(() => layers.refresh(), 60_000); // auto-refresh every minute

// ---- pin location by clicking the map
let pin = null;
function setPin(latlng) {
  if (!pin) {
    pin = L.marker(latlng, { draggable: true }).addTo(map);
    pin.on("dragend", () => fillCoords(pin.getLatLng()));
  }
  pin.setLatLng(latlng);
  fillCoords(latlng);
}
function fillCoords({ lat, lng }) {
  $("lat").value = lat.toFixed(6);
  $("lng").value = lng.toFixed(6);
  $("pin-hint").textContent = "📌 ปักหมุดแล้ว (ลากหมุดเพื่อเลื่อนตำแหน่งได้)";
}
map.on("click", (e) => setPin(e.latlng));

// ---- image preview
$("image").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $("preview").src = URL.createObjectURL(f);
  $("preview").hidden = false;
  $("file-hint").textContent = f.name;
});

// ---- submit
$("report-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("image").files[0];
  if (!file) return showMsg("กรุณาเลือกรูป", true);
  if (!$("lat").value) return showMsg("กรุณาคลิกบนแผนที่เพื่อปักหมุด", true);

  $("submit").disabled = true;
  showMsg("กำลังวิเคราะห์รูป…");
  try {
    const r = await api.submitReport(file, $("lat").value, $("lng").value);
    showMsg(`ส่งแล้ว ✓ ผลประเมิน: ${severityText(r.score)} (score ${r.score.toFixed(2)})`);
    e.target.reset();
    $("preview").hidden = true;
    $("file-hint").textContent = "เลือกรูป / ถ่ายรูป";
    await layers.refresh();
  } catch (err) {
    showMsg(err.message, true);
  } finally {
    $("submit").disabled = false;
  }
});
function showMsg(text, isErr = false) {
  $("form-msg").textContent = text;
  $("form-msg").className = "msg " + (isErr ? "err" : "ok");
}

// ---- "Is my area flooded?"
let meMarker = null;
$("locate").addEventListener("click", () => {
  const out = $("area-result");
  out.hidden = false;
  if (!navigator.geolocation) {
    out.textContent = "เบราว์เซอร์นี้หาตำแหน่งไม่ได้";
    return;
  }
  out.textContent = "กำลังหาตำแหน่ง…";
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      const ll = [coords.latitude, coords.longitude];
      map.setView(ll, 16);
      if (!meMarker) meMarker = L.circleMarker(ll, { radius: 8, color: "#1565c0", fillOpacity: 1 }).addTo(map);
      meMarker.setLatLng(ll);
      const riskP = api.riskAt(ll[0], ll[1]).catch(() => null);
      try {
        const a = await api.area(ll[0], ll[1], layers.hours);
        if (!a.in_district) {
          out.innerHTML = "ตำแหน่งของคุณอยู่นอกเขตทุ่งครุ";
        } else if (!a.summary) {
          out.innerHTML = "<strong>ยังไม่มีรายงาน</strong><br>บริเวณนี้ยังไม่มีใครแจ้งในช่วงเวลาที่เลือก ช่วยถ่ายรูปแจ้งได้เลย";
        } else {
          const s = a.summary;
          out.innerHTML =
            `<strong>${severityText(s.severity)}</strong><br>` +
            `ความรุนแรง ${s.severity.toFixed(2)} จาก ${s.count} รายงาน · ล่าสุด ${timeAgo(s.latest)}`;
        }
        const rk = (await riskP)?.cell;
        if (a.in_district && rk) {
          out.innerHTML +=
            `<div class="area-forecast"><strong>พื้นที่เสี่ยง (คงที่): ${rk.suscept_label}</strong>` +
            `<ul>${rk.days
              .map((d, i) =>
                `<li><span>${dayName(d.date, i)}</span>` +
                `<span class="risk-chip r${d.risk}" style="--c:${RISK_CLASSES[d.risk].color}">${d.risk_label}</span>` +
                `<span class="muted">ฝน ${d.rain_mm.toFixed(1)} มม.</span></li>`)
              .join("")}</ul></div>`;
        }
      } catch {
        out.textContent = "ดึงข้อมูลไม่สำเร็จ";
      }
    },
    () => (out.textContent = "ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง (ต้องเปิดผ่าน https หรือ localhost)"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});
