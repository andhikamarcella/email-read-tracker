
import express from "express";
import cors from "cors";
import morgan from "morgan";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(morgan("tiny"));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DB_FILE = path.join(__dirname, "data", "db.json");

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); }
  catch { return { events: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

// 1x1 PNG transparent
const PNG_DATA = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bf2a0000000049454e44ae426082",
  "hex"
);

// utils
function classifyUA(ua="") {
  const u = ua.toLowerCase();
  const isProxy = /googleimageproxy|google|googleusercontent|image\/|proxy/.test(u);
  const isMsProxy = /microsoft-office\/|microsoft office|outlook\-ios|outlook\-android/.test(u) && /proxy|outlook/.test(u);
  const isHumanBrowser = /(chrome|safari|firefox|edg|iphone|android|ipad|macintosh|windows nt)/.test(u) && !isProxy && !isMsProxy;
  if (isProxy || isMsProxy) return "proxy";
  if (isHumanBrowser) return "human";
  return "unknown";
}

app.post("/api/new", (req, res) => {
  const id = nanoid(10);
  const db = loadDB();
  db.events[id] = { id, createdAt: new Date().toISOString(), opens: [] };
  saveDB(db);
  res.json({
    id,
    pixel_url: `${req.protocol}://${req.get("host")}/p/${id}.png`,
    status_url: `${req.protocol}://${req.get("host")}/api/status/${id}`
  });
});

app.get("/p/:id.png", (req, res) => {
  const id = req.params.id;
  const db = loadDB();
  if (!db.events[id]) db.events[id] = { id, createdAt: new Date().toISOString(), opens: [] };
  const ua = req.headers["user-agent"] || "";
  const via = classifyUA(ua);
  db.events[id].opens.push({
    at: new Date().toISOString(),
    ua,
    via,
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""
  });
  saveDB(db);
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.end(PNG_DATA);
});

app.get("/api/status/:id", (req, res) => {
  const id = req.params.id;
  const db = loadDB();
  const ev = db.events[id] || { id, createdAt: null, opens: [] };
  const humanOpens = (ev.opens || []).filter(o => o.via === "human");
  const proxyOpens  = (ev.opens || []).filter(o => o.via === "proxy");
  const status = humanOpens.length ? "human" : (proxyOpens.length ? "proxy" : "tracked");
  res.json({
    id,
    createdAt: ev.createdAt,
    status,
    counts: { human: humanOpens.length, proxy: proxyOpens.length, total: (ev.opens||[]).length },
    lastOpen: ev.opens && ev.opens.length ? ev.opens[ev.opens.length-1].at : null,
    opens: ev.opens.slice(-20) // limit
  });
});

app.get("/", (req,res)=>{
  res.send(`<html><body style="font-family:Arial;padding:20px"><h3>Email Read Tracker v3.1</h3>
  <p>POST /api/new → {id,pixel_url}</p><p>GET /api/status/:id → {status: tracked|proxy|human}</p></body></html>`);
});

app.listen(PORT, () => console.log("Server running on", PORT));
