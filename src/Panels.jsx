import React from "react";

// Retro segmented LED meter for one scene stat, hi-fi VU style: a ladder of
// segments filling the whole slot, lit from the bottom up with a phosphor
// glow, terminal-font label and readout. No easing — segments snap with each
// camera sample.
//
// All geometry is integer pixels, computed from the slot height instead of
// flexbox distribution: fractional segment heights make boundaries land on
// partial pixels, which shimmer on the tablet as values change.

const SEGMENTS = 16;
const GAP = 3; // px between segments
const INSET_TOP = 44; // room for label + value above the ladder
const INSET_BOTTOM = 0;
const INSET_X = 0;

const textBase = {
  position: "absolute",
  left: 0,
  right: 0,
  textAlign: "center",
  fontFamily: '"Courier New", ui-monospace, monospace',
  fontWeight: 700,
  zIndex: 1,
};

export default function StatPanel({ label, color, value, h }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const lit = Math.round((pct / 100) * SEGMENTS);

  // Integer segment height that fits the slot; the ladder's total height is
  // then exact, anchored to the bottom, and every edge sits on a whole pixel.
  const avail = Math.max(0, Math.floor(h) - INSET_TOP - INSET_BOTTOM);
  const segH = Math.max(2, Math.floor((avail - (SEGMENTS - 1) * GAP) / SEGMENTS));
  const ladderH = SEGMENTS * segH + (SEGMENTS - 1) * GAP;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0a0a08" }}>
      <div style={{ ...textBase, top: 6, fontSize: 13, letterSpacing: "0.2em", color, textShadow: `0 0 8px ${color}` }}>
        {label}
      </div>
      <div style={{ ...textBase, top: 24, fontSize: 13, color, textShadow: `0 0 8px ${color}` }}>
        {String(pct).padStart(3, "0")}
      </div>

      {/* LED ladder: bottom-anchored, whole-pixel segments, lit from below. */}
      <div
        style={{
          position: "absolute",
          left: INSET_X,
          right: INSET_X,
          bottom: INSET_BOTTOM,
          height: ladderH,
        }}
      >
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const on = i < lit;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: i * (segH + GAP),
                height: segH,
                background: on ? color : "rgba(255, 255, 255, 0.07)",
                boxShadow: on ? `0 0 6px ${color}` : "none",
              }}
            />
          );
        })}
      </div>

      {/* CRT scanlines over the whole panel (integer 3px period). */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          pointerEvents: "none",
          background:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 1px, transparent 1px, transparent 3px)",
        }}
      />
    </div>
  );
}
