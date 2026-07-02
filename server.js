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
