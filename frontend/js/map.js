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
// Water depth in body / object terms. Index = model level (none, ankle, knee, waist,
// neck_up in backend/models/flood_cls.json); score 0..1 = level / 4.
export const DEPTH_LEVELS = [
  { label: "ไม่ท่วม", ref: "แห้ง หรือมีน้ำขังบาง ๆ" },
  { label: "ท่วมต่ำกว่าเข่า", ref: "ลึกประมาณ 10–40 ซม. · ระดับข้อเท้า ขอบฟุตบาท" },
  { label: "ท่วมถึงเข่า", ref: "ลึกประมาณ 40–70 ซม. · ระดับเข่า ครึ่งล้อรถเก๋ง" },
  { label: "ท่วมถึงเอว", ref: "ลึกประมาณ 70 ซม.–1.1 ม. · ระดับเอว ฝากระโปรงรถเก๋ง" },
  { label: "ท่วมถึงคอ", ref: "ลึกเกิน 1.2 ม. · ระดับคอผู้ใหญ่ เกือบถึงหลังคารถเก๋ง" },
];
export const depthLevel = (s) => Math.max(0, Math.min(4, Math.round(s * 4)));
export const severityText = (s) => DEPTH_LEVELS[depthLevel(s)].label;
export const depthRef = (s) => DEPTH_LEVELS[depthLevel(s)].ref;
/** "ท่วมถึงเข่า (ลึกประมาณ 40–70 ซม. · ระดับเข่า ครึ่งล้อรถเก๋ง)" */
export const depthFull = (s) => `${severityText(s)} (${depthRef(s)})`;
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

  // Study area (district + risk grid, thick) + subdistrict boundaries (dashed).
  // The OSM district line itself is hidden when a study-area outline exists.
  fetch("/static/data/tungkhru.geojson")
    .then((r) => r.json())
    .then((gj) => {
      const hasStudy = gj.features.some((f) => f.properties.study_area);
      const outline = (f) => f.properties.study_area || (!hasStudy && f.properties.admin_level === 6);
      const layer = L.geoJSON(gj, {
        filter: (f) => outline(f) || f.properties.admin_level === 8,
        style: (f) =>
          outline(f)
            ? { color: "#1565c0", weight: 3, fill: false }
            : { color: "#1565c0", weight: 1, dashArray: "4 4", fill: false },
        onEachFeature: (f, l) =>
          f.properties.admin_level === 8 && l.bindTooltip(f.properties.name, { sticky: true }),
        interactive: true,
      }).addTo(map);
      map.areaBounds = layer.getBounds();
      if (map.getSize().x > 0) map.fitBounds(map.areaBounds, { padding: [10, 10] });
      map.fire("arealoaded");
    })
    .catch(() => {});

  return map;
}

// ---- Flood susceptibility grid (100 m cells from QGIS, see backend/scripts/export_flood_grid.py)
// Breaks are ~quintiles of `suscept` so each class covers a similar number of cells.
export const SUSCEPT_CLASSES = [
  { min: 0.56, color: "#bd0026", label: "สูงมาก" },
  { min: 0.50, color: "#f03b20", label: "สูง" },
  { min: 0.44, color: "#fd8d3c", label: "ปานกลาง" },
  { min: 0.37, color: "#fecc5c", label: "ต่ำ" },
  { min: -Infinity, color: "#ffffb2", label: "ต่ำมาก" },
];
const susceptClass = (s) => SUSCEPT_CLASSES.find((c) => s >= c.min);
const fmt = (v, d = 2) => (v == null ? "–" : Number(v).toFixed(d));

// Forecast risk (susceptibility x TMD rain), levels from backend/app/risk.py
export const RISK_CLASSES = [
  { color: "#9ed9b8", label: "ปกติ" },
  { color: "#fdd835", label: "เฝ้าระวัง" },
  { color: "#fb8c00", label: "เสี่ยงท่วม" },
  { color: "#b71c1c", label: "เสี่ยงสูง" },
];

export class SusceptLayer {
  constructor(map) {
    this.map = map;
    this.layer = null;
    this.loading = null;
    this.risk = null; // {date, cells: {id: level}} when showing a forecast day
    map.createPane("suscept").style.zIndex = 350; // below report overlays (400)
  }

  _style(f) {
    if (this.risk) {
      const lv = this.risk.cells[f.properties.id] || 0;
      return { stroke: false, fillColor: RISK_CLASSES[lv].color, fillOpacity: lv ? 0.7 : 0.25 };
    }
    return { stroke: false, fillColor: susceptClass(f.properties.suscept).color, fillOpacity: 0.55 };
  }

  _popup(f) {
    const p = f.properties;
    const c = susceptClass(p.suscept);
    let head = "";
    if (this.risk) {
      const r = RISK_CLASSES[this.risk.cells[p.id] || 0];
      head = `<strong>${this.risk.title}: ${r.label}</strong><br>`;
    }
    return (
      `<div class="popup">${head}<strong>สภาพพื้นที่: เสี่ยง${c.label}</strong> (${fmt(p.suscept)})<br>` +
      `ระดับพื้นดินเฉลี่ย ${fmt(p.elev_mean)} ม.<br>` +
      `ระยะถึงคลอง ${fmt(p.canal_dist, 0)} ม.<br>` +
      `สัดส่วนอาคาร (BCR) ${fmt(p.bcr * 100, 0)}%<br>` +
      `ความหนาแน่นถนน ${fmt(p.road_dens, 1)}<br>` +
      `พื้นที่น้ำ ${fmt(p.water_mean * 100, 0)}%</div>`
    );
  }

  async load() {
    if (!this.loading) {
      this.loading = fetch("/static/data/flood_grid.geojson")
        .then((r) => r.json())
        .then((gj) => {
          this.layer = L.geoJSON(gj, {
            pane: "suscept",
            filter: (f) => f.properties.suscept != null,
            style: (f) => this._style(f),
            onEachFeature: (f, l) => l.bindPopup(() => this._popup(f)),
          });
          return this.layer;
        });
    }
    return this.loading;
  }

  async setVisible(on) {
    if (on) (await this.load()).addTo(this.map);
    else if (this.layer) this.map.removeLayer(this.layer);
  }

  /** Show forecast risk for one day, or null to go back to static susceptibility. */
  async setRisk(risk) {
    this.risk = risk;
    (await this.load()).setStyle((f) => this._style(f));
  }
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
          `<span class="ref">(${depthRef(p.severity)})</span><br>` +
          (depthLevel(p.max_score) > depthLevel(p.severity) ? `ลึกที่สุดที่มีคนแจ้ง: ${severityText(p.max_score)}<br>` : "") +
          `${p.count} รายงาน · ล่าสุด ${timeAgo(p.latest)}</div>`
        );
      },
    });
    this.points = L.layerGroup();
  }

  _popup(r) {
    return (
      `<div class="popup"><img src="${esc(r.image_url)}" alt="">` +
      `<strong>${severityText(r.score)}</strong><br>` +
      `<span class="ref">(${depthRef(r.score)})</span><br>` +
      `${timeAgo(r.created_at)}</div>`
    );
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
          .bindPopup(this._popup(r))
          .addTo(this.points);
      }
      this.points.addTo(this.map);
    }
  }
}
