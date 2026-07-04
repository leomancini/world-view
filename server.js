import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3138;

const LAYOUT_FILE = join(__dirname, "layout.default.json");

app.use(express.json({ limit: "256kb" }));

app.use(express.static(join(__dirname, "dist")));

function readLayout() {
  try {
    return JSON.parse(readFileSync(LAYOUT_FILE, "utf8"));
  } catch (e) {
    return [];
  }
}

function validSections(arr) {
  return (
    Array.isArray(arr) &&
    arr.length > 0 &&
    arr.every(
      (s) =>
        s &&
        typeof s.name === "string" &&
        ["x", "y", "w", "h"].every((k) => Number.isFinite(s[k]))
    )
  );
}

// Secrets live in the gitignored .env next to this file (see .env.example),
// so deploys never carry or clobber them. Read per request so a key can be
// added or rotated without restarting the server.
function readEnvFile() {
  const out = {};
  try {
    for (const line of readFileSync(join(__dirname, ".env"), "utf8").split("\n")) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !m[1].startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) {
    /* no .env */
  }
  return out;
}

// Runtime config for the frontend (keeps the API key out of the built bundle).
// Gated by the ACCESS_KEY from .env: the app forwards its ?key= URL param, so
// without it the Decart key is never handed out and the camera won't stream.
app.get("/api/config", (req, res) => {
  const env = readEnvFile();
  const accessKey = process.env.ACCESS_KEY || env.ACCESS_KEY || "";
  if (!accessKey || req.query.key !== accessKey) {
    return res.status(403).json({ error: "Invalid or missing access key" });
  }
  const key = process.env.DECART_API_KEY || env.DECART_API_KEY || "";
  res.json({ decartApiKey: key });
});

app.get("/api/layout", (req, res) => {
  res.json({ sections: readLayout() });
});

app.put("/api/layout", (req, res) => {
  const sections = req.body && req.body.sections;
  if (!validSections(sections)) {
    return res.status(400).json({ error: "Invalid sections payload" });
  }
  try {
    writeFileSync(LAYOUT_FILE, JSON.stringify(sections, null, 2));
    res.json({ ok: true, count: sections.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`World View server is running at http://localhost:${port}`);
});
