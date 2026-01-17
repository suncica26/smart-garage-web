const deviceId =
  (window.__CFG__ && window.__CFG__.deviceId) ||
  document.getElementById("deviceId")?.textContent?.trim() ||
  "garage-01";

const el = (id) => document.getElementById(id);

function setBadge(ok, text) {
  const b = el("statusBadge");
  if (!b) return;
  b.classList.remove("ok", "bad");
  b.classList.add(ok ? "ok" : "bad");
  b.textContent = text;
}

function fmt(v, suffix = "") {
  if (v === null || v === undefined) return "—";
  return `${v}${suffix}`;
}

/* =========================
   LEAFLET MAP INIT
   ========================= */
let map, marker;

function initMap() {
  const mapEl = el("map");
  if (!mapEl || typeof L === "undefined") return;

  const lat = Number(window.__CFG__?.lat ?? 44.815313);
  const lng = Number(window.__CFG__?.lng ?? 20.459812);

  map = L.map("map").setView([lat, lng], 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  marker = L.marker([lat, lng]).addTo(map).bindPopup(`Uređaj: ${deviceId}`).openPopup();
  setTimeout(() => map.invalidateSize(), 200);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMap);
} else {
  initMap();
}

/* =========================
   TELEMETRY REFRESH
   ========================= */
async function refresh() {
  try {
    const r = await fetch(`/api/telemetry/${encodeURIComponent(deviceId)}`);
    if (r.status === 401) {
      setBadge(false, "Nisi ulogovana");
      return;
    }
    const data = await r.json();

    if (!data) {
      setBadge(false, "Nema podataka");
      return;
    }

    const ageMs = Date.now() - (data.serverTs || 0);
    const fresh = ageMs < 5000;
    setBadge(fresh, fresh ? "Online" : "Staro");

    el("door").textContent = fmt(data.door);
    el("led").textContent = fmt(data.led);
    el("dist").textContent = fmt(data.distance_cm, " cm");
    el("pir").textContent = fmt(data.pir);
    el("ldr").textContent = fmt(data.ldr);
    el("night").textContent = fmt(data.night);
    el("tleft").textContent = fmt(data.t_left_ms, " ms");

    const d = new Date(data.serverTs);
    el("last").textContent = d.toLocaleString();
  } catch (e) {
    setBadge(false, "Greška");
  }
}

refresh();
setInterval(refresh, 1000);

/* =========================
   COMMANDS
   ========================= */
async function sendCmd(cmd) {
  try {
    await fetch(`/api/cmd/${encodeURIComponent(deviceId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd }),
    });
  } catch (e) {}
}

el("btnOpen")?.addEventListener("click", () => sendCmd("OPEN"));
el("btnClose")?.addEventListener("click", () => sendCmd("CLOSE"));
el("btnLedOn")?.addEventListener("click", () => sendCmd("LED_ON"));
el("btnLedOff")?.addEventListener("click", () => sendCmd("LED_OFF"));

/* =========================
   GOOGLE CHARTS (HISTORY)
   ========================= */
async function drawChart() {
  const chartEl = el("chart");
  if (!chartEl || !window.google?.charts) return;

  try {
    const r = await fetch(`/api/events/${encodeURIComponent(deviceId)}?limit=200`);
    if (r.status === 401) return;
    const items = await r.json();

    // items: [{ ts, payload: { distance_cm, ... }}, ...]
    const rows = (items || [])
      .map((it) => {
        const t = new Date(it.ts);
        const v = it?.payload?.distance_cm;
        return [t, typeof v === "number" ? v : Number(v)];
      })
      .filter((x) => x[0] instanceof Date && !Number.isNaN(x[1]))
      .reverse();

    const data = new google.visualization.DataTable();
    data.addColumn("datetime", "Time");
    data.addColumn("number", "distance_cm");
    data.addRows(rows);

    const options = {
      legend: { position: "none" },
      hAxis: { title: "Vreme" },
      vAxis: { title: "Distance (cm)" },
      chartArea: { left: 50, top: 20, right: 20, bottom: 50 },
    };

    const chart = new google.visualization.LineChart(chartEl);
    chart.draw(data, options);
  } catch (e) {}
}

if (window.google?.charts) {
  google.charts.load("current", { packages: ["corechart"] });
  google.charts.setOnLoadCallback(drawChart);
  setInterval(drawChart, 5000);
}
