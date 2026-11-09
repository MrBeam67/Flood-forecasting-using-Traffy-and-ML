/* global L */
import { api } from "./api.js";
import { createMap, FloodLayers, severityText, timeAgo } from "./map.js";

const $ = (id) => document.getElementById(id);
const map = createMap("map");
const layers = new FloodLayers(map);

// ---- model badge
api.config().then((c) => {
  const b = $("model-badge");
  b.textContent = c.model_version === "dummy" ? "โมเดลทดสอบ (ผลยังไม่จริง)" : `model: ${c.model_version}`;
  b.classList.toggle("dummy", c.model_version === "dummy");
});

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
