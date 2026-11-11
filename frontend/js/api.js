// Thin wrappers around the backend API.

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export const api = {
  config: () => getJSON("/api/config"),
  heatmap: (hours) => getJSON(`/api/heatmap?hours=${hours}`),
  hexgrid: (hours) => getJSON(`/api/hexgrid?hours=${hours}`),
  reports: (hours) => getJSON(`/api/reports?hours=${hours}`),
  rainForecast: () => getJSON("/api/forecast/rain"),
  riskForecast: (day) => getJSON(`/api/forecast/risk?day=${day}`),
  riskAt: (lat, lng) => getJSON(`/api/forecast/risk/at?lat=${lat}&lng=${lng}`),
  area: (lat, lng, hours) => getJSON(`/api/area?lat=${lat}&lng=${lng}&hours=${hours}`),

  async submitReport(file, lat, lng, observedAt, observedSource) {
    const fd = new FormData();
    fd.append("image", file);
    fd.append("lat", lat);
    fd.append("lng", lng);
    if (observedAt) fd.append("observed_at", observedAt);
    if (observedSource) fd.append("observed_source", observedSource);
    const res = await fetch("/api/reports", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? "ข้อมูลที่ส่งไม่ถูกต้อง" : body.detail;
    if (!res.ok) throw new Error(detail || `ส่งไม่สำเร็จ (${res.status})`);
    return body;
  },
};
