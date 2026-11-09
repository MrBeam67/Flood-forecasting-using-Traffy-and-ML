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
  area: (lat, lng, hours) => getJSON(`/api/area?lat=${lat}&lng=${lng}&hours=${hours}`),

  async submitReport(file, lat, lng) {
    const fd = new FormData();
    fd.append("image", file);
    fd.append("lat", lat);
    fd.append("lng", lng);
    const res = await fetch("/api/reports", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || `ส่งไม่สำเร็จ (${res.status})`);
    return body;
  },
};
