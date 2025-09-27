
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
function loadDB(){ try { return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); } catch { return { events:{} }; } }
function saveDB(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

const PNG_DATA = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bf2a0000000049454e44ae426082",
  "hex"
);

function classifyUA(ua=""){
  const u = ua.toLowerCase();
  const isProxy = /googleimageproxy|google|googleusercontent|http\.client|proxy/.test(u);
  const isHuman = /(chrome|safari|firefox|edg|iphone|android|ipad|macintosh|windows nt)/.test(u) && !isProxy;
  return isProxy ? "proxy" : (isHuman ? "human" : "unknown");
}

app.post("/api/new", (req,res)=>{
  const id = nanoid(10);
  const db = loadDB();
  db.events[id] = { id, createdAt: Date.now(), opens: [], sender: null };
  saveDB(db);
  res.json({ id, pixel_url: `${req.protocol}://${req.get("host")}/p/${id}.png` });
});

// Called by sender's browser right after inserting pixel (to store sender UA/IP)
app.post("/api/sent/:id", (req,res)=>{
  const id = req.params.id;
  const db = loadDB();
  if (!db.events[id]) db.events[id] = { id, createdAt: Date.now(), opens: [], sender: null };
  db.events[id].sender = {
    at: Date.now(),
    ua: req.headers["user-agent"] || "",
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""
  };
  saveDB(db);
  res.json({ ok: true });
});

app.get("/p/:id.png", (req,res)=>{
  const id = req.params.id;
  const db = loadDB();
  if (!db.events[id]) db.events[id] = { id, createdAt: Date.now(), opens: [], sender: null };
  const ua = req.headers["user-agent"] || "";
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  const via = classifyUA(ua);
  db.events[id].opens.push({ at: Date.now(), ua, ip, via });
  saveDB(db);
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.end(PNG_DATA);
});

app.get("/api/status/:id", (req,res)=>{
  const id = req.params.id;
  const db = loadDB();
  const ev = db.events[id] || { id, createdAt: null, opens: [], sender: null };
  const createdAt = ev.createdAt || 0;
  const sender = ev.sender;
  const GRACE_MS = 90 * 1000;

  // Filter out likely-self/proxy-preload opens for "human" decision
  const filtered = (ev.opens||[]).filter(o => {
    if ((o.at - createdAt) < GRACE_MS) return false; // too soon after send
    if (sender && (o.ip === sender.ip || o.ua === sender.ua)) return false; // same device
    return true;
  });

  const human = filtered.find(o => o.via === "human");
  const proxy = (ev.opens||[]).find(o => o.via === "proxy");

  const status = human ? "human" : (proxy ? "proxy" : "tracked");
  res.json({
    id,
    status,
    counts: {
      total: (ev.opens||[]).length,
      human: (ev.opens||[]).filter(o=>o.via==="human").length,
      proxy: (ev.opens||[]).filter(o=>o.via==="proxy").length
    },
    createdAtISO: createdAt ? new Date(createdAt).toISOString() : null,
    lastOpenISO: ev.opens && ev.opens.length ? new Date(ev.opens[ev.opens.length-1].at).toISOString() : null,
    opens: (ev.opens||[]).slice(-20)
  });
});

app.listen(PORT, ()=> console.log("Server v3.2 on", PORT));
