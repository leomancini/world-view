// Frontend fallback layout, used only if the server can't be reached.
// The server's layout.default.json is the real seed; keep them in sync.
export const DEFAULT_LAYOUT = [
  { name: "Left", x: 8, y: 13, w: 623, h: 625, color: 0 },
  { name: "Top Wide", x: 689, y: 5, w: 374, h: 113, color: 1 },
  { name: "Mid Wide", x: 693, y: 136, w: 366, h: 274, color: 2 },
  { name: "Col 1", x: 689, y: 446, w: 108, h: 192, color: 3 },
  { name: "Col 2", x: 825, y: 446, w: 108, h: 192, color: 4 },
  { name: "Col 3", x: 960, y: 446, w: 108, h: 192, color: 5 },
];

export const COLORS = [
  { name: "cyan", stroke: "rgba(0,229,255,0.7)", fill: "#00b8d4" },
  { name: "magenta", stroke: "rgba(255,64,160,0.7)", fill: "#e91e8c" },
  { name: "lime", stroke: "rgba(140,255,80,0.7)", fill: "#7cb342" },
  { name: "amber", stroke: "rgba(255,184,40,0.7)", fill: "#ffb300" },
  { name: "violet", stroke: "rgba(170,120,255,0.7)", fill: "#7e57c2" },
  { name: "white", stroke: "rgba(255,255,255,0.5)", fill: "#fafafa" },
];

export function normalizeSection(s) {
  return {
    name: typeof s.name === "string" ? s.name : "Section",
    x: Math.round(s.x) || 0,
    y: Math.round(s.y) || 0,
    w: Math.max(20, Math.round(s.w) || 100),
    h: Math.max(20, Math.round(s.h) || 100),
    color: (typeof s.color === "number" ? s.color : 0) % COLORS.length,
  };
}
