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
   LEAFLET MAP INIT (DEMO)
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

  marker = L.marker([lat, lng])
    .addTo(map)
    .bindPopup(`Uređaj: ${deviceId}`)
    .openPopup();

  setTimeout(() => map.invalidateSize(), 200);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMap);
} else {
  initMap();
}

/* =========================
   SAFE JSON helper
   ========================= */
async function safeJson(r) {
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await r.json();
  } catch {
    return null;
  }
}

/* =========================
   TELEMETRY REFRESH
   ========================= */
async function refresh() {
  try {
    const r = await fetch(`/api/telemetry/${encodeURIComponent(deviceId)}`, {
      credentials: "include", // bitno za session cookie
    });

    // Ako nisi ulogovana -> preusmeri na /login ili pokaži poruku
    if (r.status === 401) {
      setBadge(false, "Uloguj se");
      // opciono: automatski preusmeri
      // window.location.href = "/login";
      return;
    }

    if (!r.ok) {
      setBadge(false, `Greška (${r.status})`);
      return;
    }

    const data = await safeJson(r);

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
    const r = await fetch(`/api/cmd/${encodeURIComponent(deviceId)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd }),
    });

    if (r.status === 401) {
      setBadge(false, "Uloguj se");
      return;
    }

    if (!r.ok) {
      setBadge(false, `Cmd greška (${r.status})`);
      return;
    }

    // možeš i kratko “potvrđeno”
    setBadge(true, "Komanda poslata");
  } catch (e) {
    setBadge(false, "Cmd greška");
  }
}

el("btnOpen")?.addEventListener("click", () => sendCmd("OPEN"));
el("btnClose")?.addEventListener("click", () => sendCmd("CLOSE"));
el("btnLedOn")?.addEventListener("click", () => sendCmd("LED_ON"));
el("btnLedOff")?.addEventListener("click", () => sendCmd("LED_OFF"));
