/* global L */
import { api } from "./api.js";
import { createMap, FloodLayers, SusceptLayer, SUSCEPT_CLASSES, severityText, timeAgo } from "./map.js";

const $ = (id) => document.getElementById(id);
const map = createMap("map");
const layers = new FloodLayers(map);

// ---- flood susceptibility grid (from QGIS)
const suscept = new SusceptLayer(map);
$("suscept-legend").innerHTML = [...SUSCEPT_CLASSES]
  .reverse()
  .map((c) => `<span style="--c:${c.color}">${c.label}</span>`)
  .join("");
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

// ---- 3-day rain forecast (TMD)
const WARN_LEVELS = new Set(["moderate", "heavy", "very_heavy"]);
function dayName(iso, i) {
  if (i === 0) return "วันนี้";
  if (i === 1) return "พรุ่งนี้";
  return new Date(iso + "T00:00:00+07:00").toLocaleDateString("th-TH", { weekday: "long" });
}
const shortDate = (iso) =>
  new Date(iso + "T00:00:00+07:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" });

async function loadRain() {
  try {
    const f = await api.rainForecast();
    $("rain-days").innerHTML = f.days
      .map(
        (d, i) => `
        <div class="rain-day lv-${d.level}">
          <div class="rd-name">${dayName(d.date, i)}<span>${shortDate(d.date)}</span></div>
          <div class="rd-mm">${d.rain_max.toFixed(1)}<small> มม.</small></div>
          <div class="rd-level">${d.level_label}</div>
          <div class="rd-range">ทั้งเขต ${d.rain_min.toFixed(1)}–${d.rain_max.toFixed(1)}</div>
        </div>`
      )
      .join("");
    const t = new Date(f.fetched_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    $("rain-meta").textContent = `อัปเดต ${t}${f.stale ? " (ข้อมูลเก่า)" : ""}`;

    const warn = f.days.map((d, i) => [d, i]).filter(([d]) => WARN_LEVELS.has(d.level));
    $("rain-alert").hidden = warn.length === 0;
    if (warn.length) {
      const [d, i] = warn.reduce((a, b) => (b[0].rain_max > a[0].rain_max ? b : a));
      $("rain-alert").textContent =
        `⚠️ ${dayName(d.date, i)}คาด${d.level_label} สูงสุด ${d.rain_max.toFixed(1)} มม. ` +
        `ระวังพื้นที่เสี่ยงสูงบนแผนที่`;
    }
  } catch (err) {
    $("rain-days").innerHTML = `<p class="hint">ดึงพยากรณ์ฝนไม่ได้ในขณะนี้</p>`;
    $("rain-meta").textContent = "";
    $("rain-alert").hidden = true;
  }
}
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
      } catch {
        out.textContent = "ดึงข้อมูลไม่สำเร็จ";
      }
    },
    () => (out.textContent = "ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง (ต้องเปิดผ่าน https หรือ localhost)"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});
