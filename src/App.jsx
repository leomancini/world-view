import React, { useEffect, useRef, useState } from "react";
import { DEFAULT_LAYOUT, COLORS, normalizeSection } from "./defaultLayout";
import ObjectDetector from "./ObjectDetector";

const STORAGE_KEY = "worldview.layout.v1";
const STEPS = [1, 5, 10, 25];

// Pick a readable letter color for a given fill (dark letter on light slots).
function textColorFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "rgba(255,255,255,0.92)";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "rgba(0,0,0,0.78)" : "rgba(255,255,255,0.92)";
}

export default function App() {
  const [sections, setSections] = useState([]);
  const [selected, setSelected] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [edit, setEdit] = useState(false);
  const [guides, setGuides] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [toast, setToast] = useState("");

  // Mirror of state so the single keydown listener never goes stale.
  const ref = useRef({});
  ref.current = {
    sections,
    selected,
    stepIdx,
    edit,
    guides,
    showHelp,
    showExport,
  };

  const toastTimer = useRef(null);
  const exportRef = useRef(null);

  // ---- Load: localStorage working copy -> server config -> bundled default ----
  useEffect(() => {
    const ls = localStorage.getItem(STORAGE_KEY);
    if (ls) {
      try {
        const arr = JSON.parse(ls);
        if (Array.isArray(arr) && arr.length) {
          setSections(arr.map(normalizeSection));
          return;
        }
      } catch (e) {
        /* fall through */
      }
    }
    fetch("/api/layout")
      .then((r) => r.json())
      .then((d) => {
        const arr = d && d.sections;
        setSections(
          (Array.isArray(arr) && arr.length ? arr : DEFAULT_LAYOUT).map(
            normalizeSection
          )
        );
      })
      .catch(() => setSections(DEFAULT_LAYOUT.map(normalizeSection)));
  }, []);

  // Auto-save the live working copy to localStorage.
  useEffect(() => {
    if (sections.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sections));
    }
  }, [sections]);

  // Reflect display toggles on <body> for the CSS rules.
  useEffect(() => {
    document.body.classList.add("kiosk");
    document.body.classList.toggle("edit", edit);
  }, [edit]);

  // ---- Helpers ----
  function flash(msg) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }

  function step() {
    return STEPS[ref.current.stepIdx];
  }

  function move(dx, dy) {
    const i = ref.current.selected;
    setSections((prev) => {
      if (i < 0 || i >= prev.length) return prev;
      const next = prev.slice();
      next[i] = { ...next[i], x: next[i].x + dx, y: next[i].y + dy };
      return next;
    });
  }

  function resize(dw, dh) {
    const i = ref.current.selected;
    setSections((prev) => {
      if (i < 0 || i >= prev.length) return prev;
      const next = prev.slice();
      next[i] = {
        ...next[i],
        w: Math.max(20, next[i].w + dw),
        h: Math.max(20, next[i].h + dh),
      };
      return next;
    });
  }

  function selectDelta(d) {
    const n = ref.current.sections.length;
    if (!n) return;
    setSelected((s) => (s + d + n) % n);
  }

  function selectIndex(i) {
    if (i >= 0 && i < ref.current.sections.length) setSelected(i);
  }

  function addSection() {
    const W = window.innerWidth,
      H = window.innerHeight;
    setSections((prev) => {
      const next = prev.concat(
        normalizeSection({
          name: "Section " + (prev.length + 1),
          x: Math.round(W / 2 - 150),
          y: Math.round(H / 2 - 100),
          w: 300,
          h: 200,
          color: prev.length % COLORS.length,
        })
      );
      setSelected(next.length - 1);
      return next;
    });
  }

  function deleteSection() {
    const i = ref.current.selected;
    setSections((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice();
      next.splice(i, 1);
      setSelected(Math.min(i, next.length - 1));
      return next;
    });
  }

  function renameSection() {
    const i = ref.current.selected;
    const cur = ref.current.sections[i];
    if (!cur) return;
    const name = window.prompt("Section name:", cur.name);
    if (name !== null && name.trim() !== "") {
      setSections((prev) => {
        const next = prev.slice();
        next[i] = { ...next[i], name: name.trim() };
        return next;
      });
    }
  }

  function cycleColor() {
    const i = ref.current.selected;
    setSections((prev) => {
      if (i < 0 || i >= prev.length) return prev;
      const next = prev.slice();
      next[i] = { ...next[i], color: (next[i].color + 1) % COLORS.length };
      return next;
    });
  }

  async function saveConfig() {
    const payload = ref.current.sections;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    try {
      const res = await fetch("/api/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: payload }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      flash("Saved to server config");
    } catch (e) {
      flash("Saved locally (server unreachable)");
    }
  }

  async function resetToServer() {
    try {
      const d = await (await fetch("/api/layout")).json();
      const arr =
        Array.isArray(d.sections) && d.sections.length
          ? d.sections
          : DEFAULT_LAYOUT;
      const norm = arr.map(normalizeSection);
      setSections(norm);
      setSelected(0);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(norm));
      flash("Reset to saved config");
    } catch (e) {
      flash("Could not reach server");
    }
  }

  function closeOverlays() {
    setShowHelp(false);
    setShowExport(false);
  }

  function toggleHelp() {
    setShowExport(false);
    setShowHelp((v) => !v);
  }

  function toggleExport() {
    setShowHelp(false);
    setShowExport((v) => {
      const next = !v;
      if (next) {
        setTimeout(() => {
          if (exportRef.current) {
            exportRef.current.focus();
            exportRef.current.select();
          }
        }, 0);
      }
      return next;
    });
  }

  // ---- Single keydown listener (reads latest via ref) ----
  useEffect(() => {
    function onKey(e) {
      const k = e.key;
      const s = ref.current;

      if (k === "Escape") {
        closeOverlays();
        e.preventDefault();
        return;
      }

      if (s.showHelp || s.showExport) {
        if (k === "h" || k === "H" || k === "?") toggleHelp();
        else if (k === "p" || k === "P") toggleExport();
        e.preventDefault();
        return;
      }

      let handled = true;
      switch (k) {
        case "ArrowLeft":
          e.shiftKey ? resize(-step(), 0) : move(-step(), 0);
          break;
        case "ArrowRight":
          e.shiftKey ? resize(step(), 0) : move(step(), 0);
          break;
        case "ArrowUp":
          e.shiftKey ? resize(0, -step()) : move(0, -step());
          break;
        case "ArrowDown":
          e.shiftKey ? resize(0, step()) : move(0, step());
          break;
        case "Tab":
          selectDelta(e.shiftKey ? -1 : 1);
          break;
        case "[":
          setStepIdx((i) => Math.max(0, i - 1));
          break;
        case "]":
          setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
          break;
        case "e":
        case "E":
          setEdit((v) => !v);
          break;
        case "g":
        case "G":
          setGuides((v) => !v);
          break;
        case "n":
        case "N":
          addSection();
          break;
        case "Delete":
        case "Backspace":
          deleteSection();
          break;
        case "m":
        case "M":
          renameSection();
          break;
        case "c":
        case "C":
          cycleColor();
          break;
        case "s":
        case "S":
          saveConfig();
          break;
        case "p":
        case "P":
          toggleExport();
          break;
        case "h":
        case "H":
        case "?":
          toggleHelp();
          break;
        case "R":
          if (e.shiftKey) resetToServer();
          else handled = false;
          break;
        default:
          if (k >= "1" && k <= "9") selectIndex(parseInt(k, 10) - 1);
          else handled = false;
      }
      if (handled) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="stage">
        {sections.map((s, i) => {
          const c = COLORS[s.color % COLORS.length];
          return (
            <div
              key={i}
              className={"section" + (i === selected && edit ? " selected" : "")}
              style={{
                left: s.x,
                top: s.y,
                width: s.w,
                height: s.h,
                "--fill": c.fill,
                "--stroke": c.stroke,
              }}
            >
              {i === 0 ? (
                <ObjectDetector w={s.w} h={s.h} />
              ) : (
                <span
                  className="slot-letter"
                  style={{
                    fontSize: Math.round(
                      Math.min(120, Math.max(28, Math.min(s.w, s.h) * 0.4))
                    ),
                    color: textColorFor(c.fill),
                  }}
                >
                  {String.fromCharCode(65 + i)}
                </span>
              )}
              <span className="handle tl" />
              <span className="handle tr" />
              <span className="handle bl" />
              <span className="handle br" />
            </div>
          );
        })}
      </div>

      {guides && (
        <div className="guides">
          <div className="guide-v" />
          <div className="guide-h" />
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {showHelp && (
        <div className="overlay" onClick={() => setShowHelp(false)}>
          <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
            <h1>World View — Keyboard Controls</h1>
            <div className="cols">
              <ul>
                <li>
                  <kbd>E</kbd> toggle edit / display mode
                </li>
                <li>
                  <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> next / prev
                </li>
                <li>
                  <kbd>1</kbd>…<kbd>9</kbd> select by number
                </li>
                <li>
                  <kbd>←↑→↓</kbd> move selected
                </li>
                <li>
                  <kbd>Shift</kbd>+<kbd>←↑→↓</kbd> resize selected
                </li>
                <li>
                  <kbd>[</kbd> / <kbd>]</kbd> smaller / bigger step
                </li>
              </ul>
              <ul>
                <li>
                  <kbd>N</kbd> new &nbsp; <kbd>Del</kbd> delete
                </li>
                <li>
                  <kbd>M</kbd> rename &nbsp; <kbd>C</kbd> color
                </li>
                <li>
                  <kbd>G</kbd> alignment guides
                </li>
                <li>
                  <kbd>S</kbd> save to server config
                </li>
                <li>
                  <kbd>P</kbd> export JSON
                </li>
                <li>
                  <kbd>Shift</kbd>+<kbd>R</kbd> reset to saved config
                </li>
              </ul>
            </div>
            <p className="dim">
              Layout auto-saves locally; press S to publish to the server.
              Screen: {window.innerWidth} × {window.innerHeight}
            </p>
          </div>
        </div>
      )}

      {showExport && (
        <div className="overlay" onClick={() => setShowExport(false)}>
          <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
            <h1>Layout JSON</h1>
            <p className="dim">Select all and copy.</p>
            <textarea
              ref={exportRef}
              className="export-text"
              readOnly
              spellCheck={false}
              value={JSON.stringify(sections, null, 2)}
            />
            <p className="dim">
              press <kbd>P</kbd> or <kbd>Esc</kbd> to close
            </p>
          </div>
        </div>
      )}
    </>
  );
}
