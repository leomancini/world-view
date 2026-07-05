import React, { useRef, useState } from "react";

const SWIPE_FRACTION = 0.12; // drag distance (fraction of width) that commits
const NEIGHBORS = 2; // names rendered on each side of the current one
// Fixed inset where the side names are pinned: the previous name's RIGHT edge
// and the next name's LEFT edge sit here, so name length never moves them
// (long names just run off the slot edge).
const PEEK = 0.16; // fraction of width

// Swipeable style picker, CRT-styled: current style name centered in glowing
// phosphor, previous/next names peeking in from the edges, scanlines over the
// whole panel. Wraps around in both directions; touch or mouse drag.
export default function StyleCarousel({ styles, index, onChange, w }) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(null);

  const spacing = Math.max(110, w * 0.5); // one "slot" of drag travel
  const peek = Math.round(w * PEEK);
  const n = styles.length;

  // Anchor per integer position: x is the pinned point, align is which text
  // edge sits on it (right edge for the left side, center for current, left
  // edge for the right side, as a translate %). ±2 items park just off the
  // slot edges so swaps slide in.
  function anchorFor(rel) {
    if (rel === 0) return { x: w / 2, align: -50 };
    if (rel < 0) return { x: rel === -1 ? peek : -24, align: -100 };
    return { x: rel === 1 ? w - peek : w + 24, align: 0 };
  }

  // Continuous anchor: while dragging, each name sits on the straight path
  // between the two integer anchors it's moving between, proportional to drag
  // progress — so it's already part-way to where it will land, not translated
  // 1:1 with the finger and snapped after release.
  function anchorAt(t) {
    const c = Math.max(-NEIGHBORS, Math.min(NEIGHBORS, t));
    const lo = Math.floor(c);
    if (lo === c) return anchorFor(lo);
    const a = anchorFor(lo);
    const b = anchorFor(lo + 1);
    const f = c - lo;
    return { x: a.x + (b.x - a.x) * f, align: a.align + (b.align - a.align) * f };
  }

  function onPointerDown(e) {
    startX.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (startX.current === null) return;
    setDragX(e.clientX - startX.current);
  }

  function endDrag(e) {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    setDragging(false);
    setDragX(0);
    if (Math.abs(dx) > w * SWIPE_FRACTION) {
      // Drag right reveals the previous style, drag left the next.
      onChange((index + (dx < 0 ? 1 : -1) + n) % n);
    }
  }

  // Render the current name plus NEIGHBORS on each side, each at the anchor
  // for its live (fractional) position.
  const items = [];
  for (let rel = -NEIGHBORS; rel <= NEIGHBORS; rel++) {
    const idx = (index + rel + n) % n;
    // Effective distance from center, in "slots", including the live drag.
    const eff = rel + dragX / spacing;
    const dist = Math.abs(eff);
    const { x, align } = anchorAt(eff);
    // 1 at center, 0.25 at the side anchors, then quickly to 0 within the
    // first 0.4 slots of outbound travel past a side anchor.
    const opacity =
      dist <= 1 ? 1 - dist * 0.75 : Math.max(0, 0.25 * (1 - (dist - 1) / 0.4));
    items.push(
      <span
        key={idx}
        className="carousel-item"
        style={{
          transform: `translate(calc(${align}% + ${x}px), -50%)`,
          opacity,
          fontSize: Math.round(Math.max(13, 21 - dist * 7)),
          transition: dragging ? "none" : "all 0.28s ease",
        }}
      >
        {styles[idx].name.toUpperCase()}
      </span>
    );
  }

  return (
    <div
      className="style-carousel"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {items}
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
