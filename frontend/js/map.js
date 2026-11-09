// Leaflet map: district boundary + three switchable flood layers.
/* global L */
import { api } from "./api.js";

export const TUNG_KHRU_CENTER = [13.6304, 100.504];

// Severity 0..1 -> color (blue = dry ... dark red = high)
const STOPS = [
  [0.0, "#2c7bb6"], [0.25, "#abd9e9"], [0.4, "#fdae61"], [0.65, "#f46d43"], [0.85, "#a50026"],
];
export function severityColor(s) {
  let c = STOPS[0][1];
  for (const [t, col] of STOPS) if (s >= t) c = col;
  return c;
}
export function severityText(s) {
  if (s < 0.17) return "แห้ง / ไม่ท่วม";
  if (s < 0.5) return "ท่วมระดับต่ำ";
  if (s < 0.83) return "ท่วมระดับปานกลาง";
  return "ท่วมระดับสูง";
}
export function timeAgo(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  if (min < 1440) return `${Math.round(min / 60)} ชม.ที่แล้ว`;
  return `${Math.round(min / 1440)} วันที่แล้ว`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createMap(el) {
  const map = L.map(el, { zoomControl: true }).setView(TUNG_KHRU_CENTER, 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // District + subdistrict boundaries
  fetch("/static/data/tungkhru.geojson")
    .then((r) => r.json())
    .then((gj) => {
      const layer = L.geoJSON(gj, {
        style: (f) =>
          f.properties.admin_level === 6
            ? { color: "#1565c0", weight: 3, fill: false }
            : { color: "#1565c0", weight: 1, dashArray: "4 4", fill: false },
        onEachFeature: (f, l) =>
          f.properties.admin_level === 8 && l.bindTooltip(f.properties.name, { sticky: true }),
        interactive: true,
      }).addTo(map);
      map.fitBounds(layer.getBounds(), { padding: [10, 10] });
    })
    .catch(() => {});

  return map;
}

export class FloodLayers {
  constructor(map) {
    this.map = map;
    this.mode = "hex";
    this.hours = 24;
    this.heat = L.heatLayer([], {
      radius: 30, blur: 22, maxZoom: 16, max: 1.0, minOpacity: 0.35,
      gradient: { 0.2: "#abd9e9", 0.4: "#fdae61", 0.65: "#f46d43", 0.9: "#a50026" },
    });
    this.hex = L.geoJSON(null, {
      style: (f) => ({
        color: severityColor(f.properties.severity),
        weight: 1,
        fillColor: severityColor(f.properties.severity),
        // more recent reports -> more opaque
        fillOpacity: 0.25 + 0.45 * Math.min(f.properties.confidence, 1),
      }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindPopup(
          `<div class="popup"><strong>${severityText(p.severity)}</strong><br>` +
          `ความรุนแรง ${p.severity.toFixed(2)} (สูงสุด ${p.max_score.toFixed(2)})<br>` +
          `${p.count} รายงาน · ล่าสุด ${timeAgo(p.latest)}</div>`
        );
      },
    });
    this.points = L.layerGroup();
  }

  setMode(mode) { this.mode = mode; return this.refresh(); }
  setHours(h) { this.hours = h; return this.refresh(); }

  async refresh() {
    for (const l of [this.heat, this.hex, this.points]) this.map.removeLayer(l);

    if (this.mode === "heat") {
      this.heat.setLatLngs(await api.heatmap(this.hours));
      this.heat.addTo(this.map);
    } else if (this.mode === "hex") {
      this.hex.clearLayers();
      this.hex.addData(await api.hexgrid(this.hours));
      this.hex.addTo(this.map);
    } else {
      this.points.clearLayers();
      for (const r of await api.reports(this.hours)) {
        L.circleMarker([r.lat, r.lng], {
          radius: 7, weight: 1, color: "#fff",
          fillColor: severityColor(r.score), fillOpacity: 0.9,
        })
          .bindPopup(
            `<div class="popup"><img src="${esc(r.image_url)}" alt="">` +
            `<strong>${severityText(r.score)}</strong> (${r.score.toFixed(2)})<br>` +
            `${timeAgo(r.created_at)}</div>`
          )
          .addTo(this.points);
      }
      this.points.addTo(this.map);
    }
  }
}
