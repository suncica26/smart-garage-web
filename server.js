// server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Mongo =====
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.warn("WARNING: MONGO_URI nije setovan. Dodaj ga u .env (lokalno) i u Render ENV vars.");
}

let db, colUsers, colDevices, colEvents, colCmd;

// ===== View / static =====
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false })); // login/register forme
app.use(express.static(path.join(__dirname, "public")));

// Render je iza proxy-ja -> bitno za cookie/session
app.set("trust proxy", 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production", // na Render-u true
    },
  })
);

// ===== Helpers =====
function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.redirect("/login");
  next();
}

function requireAuthJson(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

function getBaseUrl(req) {
  const envBase = process.env.BASE_URL && String(process.env.BASE_URL).trim();
  if (envBase) return envBase.replace(/\/+$/, "");

  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

// locals za view-ove
app.use((req, res, next) => {
  res.locals.baseUrl = getBaseUrl(req);
  res.locals.username = req.session?.username || null;
  next();
});

// ===== Health check =====
app.get("/health", async (req, res) => {
  try {
    const devices = colDevices ? await colDevices.countDocuments({}) : 0;
    res.status(200).json({ ok: true, ts: Date.now(), devices });
  } catch {
    res.status(200).json({ ok: true, ts: Date.now(), devices: 0 });
  }
});

// ===== Auth =====
app.get("/login", (req, res) => {
  res.send(`
  <html><head><meta charset="utf-8"><title>Login</title></head>
  <body style="font-family:Arial; max-width:420px; margin:40px auto;">
    <h2>Login</h2>
    <form method="post" action="/login">
      <label>Username</label><br/>
      <input name="username" required style="width:100%; padding:8px"/><br/><br/>
      <label>Password</label><br/>
      <input name="password" type="password" required style="width:100%; padding:8px"/><br/><br/>
      <button style="padding:10px 14px">Uloguj se</button>
    </form>
    <p>Nemaš nalog? <a href="/register">Registruj se</a></p>
  </body></html>
  `);
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).send("Missing fields");

    const u = await colUsers.findOne({ username: String(username).trim().toLowerCase() });
    if (!u) return res.status(401).send("Invalid credentials");

    const passHash = sha256(password);
    if (u.passHash !== passHash) return res.status(401).send("Invalid credentials");

    req.session.userId = String(u._id);
    req.session.username = u.username;

    return res.redirect("/devices");
  } catch (e) {
    console.error(e);
    res.status(500).send("Login error");
  }
});

app.get("/register", (req, res) => {
  res.send(`
  <html><head><meta charset="utf-8"><title>Register</title></head>
  <body style="font-family:Arial; max-width:420px; margin:40px auto;">
    <h2>Register</h2>
    <form method="post" action="/register">
      <label>Username</label><br/>
      <input name="username" required style="width:100%; padding:8px"/><br/><br/>
      <label>Password</label><br/>
      <input name="password" type="password" required style="width:100%; padding:8px"/><br/><br/>
      <label>Repeat password</label><br/>
      <input name="password2" type="password" required style="width:100%; padding:8px"/><br/><br/>
      <button style="padding:10px 14px">Napravi nalog</button>
    </form>
    <p>Imaš nalog? <a href="/login">Login</a></p>
  </body></html>
  `);
});

app.post("/register", async (req, res) => {
  try {
    const { username, password, password2 } = req.body || {};
    if (!username || !password || !password2) return res.status(400).send("Missing fields");
    if (password !== password2) return res.status(400).send("Passwords do not match");

    const uname = String(username).trim().toLowerCase();
    const exists = await colUsers.findOne({ username: uname });
    if (exists) return res.status(400).send("Username taken");

    const result = await colUsers.insertOne({
      username: uname,
      passHash: sha256(password),
      createdAt: new Date(),
    });

    req.session.userId = String(result.insertedId);
    req.session.username = uname;

    res.redirect("/devices");
  } catch (e) {
    console.error(e);
    res.status(500).send("Register error");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ===== App pages =====
app.get("/", (req, res) => {
  if (!req.session?.userId) return res.redirect("/login");
  return res.redirect("/devices");
});

// Lista uređaja
app.get("/devices", requireAuth, async (req, res) => {
  const ownerId = req.session.userId;

  const devices = await colDevices.find({ ownerId }).sort({ createdAt: -1 }).toArray();

  let html = `
  <html><head><meta charset="utf-8"><title>Moji uređaji</title></head>
  <body style="font-family:Arial; max-width:900px; margin:30px auto;">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h2>Moji uređaji</h2>
      <div>
        <span style="margin-right:10px;">${req.session.username}</span>
        <a href="/logout">Logout</a>
      </div>
    </div>

    <p><a href="/devices/new">+ Dodaj novi uređaj</a></p>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse; width:100%;">
      <tr>
        <th>Naziv</th><th>Mesto</th><th>deviceId</th><th>Lokacija</th><th>Detalj</th>
      </tr>
  `;

  for (const d of devices) {
    html += `
      <tr>
        <td>${d.name || ""}</td>
        <td>${d.place || ""}</td>
        <td>${d.deviceId}</td>
        <td>${(d.lat ?? "")}, ${(d.lng ?? "")}</td>
        <td><a href="/devices/${encodeURIComponent(d.deviceId)}">Otvori</a></td>
      </tr>
    `;
  }

  html += `
    </table>
  </body></html>
  `;

  res.send(html);
});

// Forma za dodavanje uređaja
app.get("/devices/new", requireAuth, (req, res) => {
  res.send(`
  <html><head><meta charset="utf-8"><title>Novi uređaj</title></head>
  <body style="font-family:Arial; max-width:520px; margin:40px auto;">
    <h2>Dodaj uređaj</h2>
    <form method="post" action="/devices/new">
      <label>deviceId (sa kutije / QR)</label><br/>
      <input name="deviceId" required style="width:100%; padding:8px"/><br/><br/>

      <label>Naziv</label><br/>
      <input name="name" style="width:100%; padding:8px"/><br/><br/>

      <label>Mesto (npr. Garaža)</label><br/>
      <input name="place" style="width:100%; padding:8px"/><br/><br/>

      <label>Opis</label><br/>
      <input name="description" style="width:100%; padding:8px"/><br/><br/>

      <label>Lat</label><br/>
      <input name="lat" style="width:100%; padding:8px"/><br/><br/>

      <label>Lng</label><br/>
      <input name="lng" style="width:100%; padding:8px"/><br/><br/>

      <button style="padding:10px 14px">Sačuvaj</button>
    </form>
    <p><a href="/devices">Nazad</a></p>
  </body></html>
  `);
});

app.post("/devices/new", requireAuth, async (req, res) => {
  const ownerId = req.session.userId;
  const { deviceId, name, place, description, lat, lng } = req.body || {};
  if (!deviceId) return res.status(400).send("Missing deviceId");

  const did = String(deviceId).trim();

  const exists = await colDevices.findOne({ ownerId, deviceId: did });
  if (exists) return res.status(400).send("Uređaj već postoji");

  await colDevices.insertOne({
    ownerId,
    deviceId: did,
    name: name || "",
    place: place || "",
    description: description || "",
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    createdAt: new Date(),
    lastTelemetry: null,
    lastSeenAt: null,
  });

  res.redirect("/devices");
});

// ✅ DASHBOARD: renderuj index.ejs
app.get("/devices/:deviceId", requireAuth, async (req, res) => {
  const ownerId = req.session.userId;
  const deviceId = req.params.deviceId;

  const dev = await colDevices.findOne({ ownerId, deviceId });
  if (!dev) return res.status(404).send("Device not found");

  // lat/lng za mapu (fallback ako nema)
  const lat = Number.isFinite(dev.lat) ? dev.lat : 44.815313;
  const lng = Number.isFinite(dev.lng) ? dev.lng : 20.459812;

  return res.render("index", {
    deviceId: dev.deviceId,
    lat,
    lng,
    username: req.session.username, // opciono, već je i u res.locals
  });
});

// ===== API (telemetry/events) =====

// Pico -> server (POST telemetry)  [OPEN]
app.post("/api/telemetry/:deviceId", async (req, res) => {
  try {
    const deviceId = req.params.deviceId;
    const body = req.body || {};

    const exists = await colDevices.findOne({ deviceId }, { projection: { _id: 1 } });
    if (!exists) return res.status(404).json({ ok: false, error: "unknown deviceId" });

    const data = {
      ...body,
      deviceId,
      serverTs: Date.now(),
    };

    await colEvents.insertOne({
      deviceId,
      ts: new Date(),
      payload: data,
    });

    await colDevices.updateMany(
      { deviceId },
      { $set: { lastTelemetry: data, lastSeenAt: new Date() } }
    );

    console.log("TELEMETRY:", deviceId, data);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "telemetry error" });
  }
});

// Dashboard -> server (GET latest telemetry) [AUTH]
app.get("/api/telemetry/:deviceId", requireAuthJson, async (req, res) => {
  const ownerId = req.session.userId;
  const deviceId = req.params.deviceId;

  const dev = await colDevices.findOne({ ownerId, deviceId });
  if (!dev) return res.status(404).json({ ok: false, error: "device not found" });

  res.json(dev.lastTelemetry || null);
});

// Istorija (za chart kasnije) [AUTH]
app.get("/api/events/:deviceId", requireAuthJson, async (req, res) => {
  const ownerId = req.session.userId;
  const deviceId = req.params.deviceId;
  const limit = Math.min(Number(req.query.limit || 200), 500);

  const dev = await colDevices.findOne({ ownerId, deviceId }, { projection: { _id: 1 } });
  if (!dev) return res.status(404).json({ ok: false, error: "device not found" });

  const items = await colEvents.find({ deviceId }).sort({ ts: -1 }).limit(limit).toArray();
  res.json(items);
});

// ===== CMD queue (Mongo) =====

// web -> server (pošalji komandu) [AUTH]
app.post("/api/cmd/:deviceId", requireAuthJson, async (req, res) => {
  const ownerId = req.session.userId;
  const deviceId = req.params.deviceId;
  const { cmd } = req.body || {};
  if (!cmd) return res.status(400).json({ ok: false, error: "Missing cmd" });

  const dev = await colDevices.findOne({ ownerId, deviceId }, { projection: { _id: 1 } });
  if (!dev) return res.status(404).json({ ok: false, error: "device not found" });

  // jedna pending komanda po uređaju (overwrite)
  await colCmd.updateOne(
    { deviceId },
    { $set: { deviceId, cmd: String(cmd), ts: new Date() } },
    { upsert: true }
  );

  console.log("CMD SET:", deviceId, cmd);
  res.json({ ok: true });
});

// pico -> server (pokupi komandu) [OPEN]
app.get("/api/cmd/:deviceId", async (req, res) => {
  try {
    const deviceId = req.params.deviceId;

    const doc = await colCmd.findOneAndDelete({ deviceId });

    if (!doc.value) return res.json(null);

    res.json({
      cmd: doc.value.cmd,
      ts: doc.value.ts ? new Date(doc.value.ts).getTime() : Date.now(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "cmd error" });
  }
});

// ===== Start =====
async function start() {
  if (!MONGO_URI) {
    console.error("MONGO_URI nije podešen. Aplikacija ne može bez baze (po zahtevima projekta).");
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();

  db = client.db();
  colUsers = db.collection("users");
  colDevices = db.collection("devices");
  colEvents = db.collection("events");
  colCmd = db.collection("cmd");

  await colUsers.createIndex({ username: 1 }, { unique: true });
  await colDevices.createIndex({ ownerId: 1, deviceId: 1 }, { unique: true });
  await colDevices.createIndex({ deviceId: 1 });
  await colEvents.createIndex({ deviceId: 1, ts: -1 });
  await colCmd.createIndex({ deviceId: 1 }, { unique: true });

  app.listen(PORT, () => console.log(`Listening on :${PORT}`));
}

start().catch((e) => {
  console.error("Startup error:", e);
  process.exit(1);
});
