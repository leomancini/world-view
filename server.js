import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3138;

// The committed default layout (calibrated on the tablet) and the runtime file
// that holds live edits saved from the app. The runtime file is gitignored so
// deploys never clobber an on-device calibration.
const DEFAULT_FILE = join(__dirname, "layout.default.json");
const RUNTIME_FILE = join(__dirname, "layout.json");

app.use(express.json({ limit: "256kb" }));

// Serve the built React app.
app.use(express.static(join(__dirname, "dist")));

function readLayout() {
  for (const f of [RUNTIME_FILE, DEFAULT_FILE]) {
    try {
      if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      /* try next */
    }
  }
  return [];
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

// Get the current layout (runtime override, else committed default).
app.get("/api/layout", (req, res) => {
  res.json({ sections: readLayout() });
});

// Persist a new layout (saved from the app with the S key).
app.put("/api/layout", (req, res) => {
  const sections = req.body && req.body.sections;
  if (!validSections(sections)) {
    return res.status(400).json({ error: "Invalid sections payload" });
  }
  try {
    writeFileSync(RUNTIME_FILE, JSON.stringify(sections, null, 2));
    res.json({ ok: true, count: sections.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback.
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`World View server is running at http://localhost:${port}`);
});
