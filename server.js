const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// memorija (za sada) - kasnije MongoDB
const store = new Map();

// poslednja komanda po uređaju (u memoriji)
const lastCmd = new Map();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ===== Health check (korisno na Renderu) =====
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    devices: store.size,
  });
});

// Dashboard
app.get("/", (req, res) => {
  res.render("index", {
    deviceId: "garage-01",
    lat: 44.815313,
    lng: 20.459812,
  });
});

// ===== Commands =====

// web -> server (pošalji komandu)
app.post("/api/cmd/:deviceId", (req, res) => {
  const deviceId = req.params.deviceId;
  const { cmd } = req.body || {};
  if (!cmd) return res.status(400).json({ ok: false, error: "Missing cmd" });

  lastCmd.set(deviceId, { cmd, ts: Date.now() });
  console.log("CMD:", deviceId, cmd);

  res.json({ ok: true });
});

// pico -> server (pokupi komandu)
app.get("/api/cmd/:deviceId", (req, res) => {
  const deviceId = req.params.deviceId;
  const item = lastCmd.get(deviceId) || null;

  // potroši komandu odmah (da se ne ponavlja)
  lastCmd.delete(deviceId);

  res.json(item);
});

// ===== Telemetry =====

// Pico -> server (POST)
app.post("/api/telemetry/:deviceId", (req, res) => {
  const deviceId = req.params.deviceId;
  const body = req.body || {};

  const data = {
    ...body,
    deviceId,
    serverTs: Date.now(),
  };

  store.set(deviceId, data);

  console.log("TELEMETRY:", deviceId, data);
  res.json({ ok: true });
});

// Dashboard -> server (GET)
app.get("/api/telemetry/:deviceId", (req, res) => {
  const deviceId = req.params.deviceId;
  res.json(store.get(deviceId) || null);
});

// Render-safe bind
app.listen(PORT, "0.0.0.0", () => console.log(`Listening on :${PORT}`));
