import React, { useRef, useState } from "react";

// Gap between neighboring names as a fraction of width: 0.5 puts the prev/next
// names centered on the slot edges, so about half of each peeks in.
const SPACING = 0.5;
const SWIPE_FRACTION = 0.12; // drag distance (fraction of width) that commits
const NEIGHBORS = 2; // names rendered on each side of the current one

// Swipeable style picker, CRT-styled: current style name centered in glowing
// phosphor, previous/next names peeking in from the edges, scanlines over the
// whole panel. Wraps around in both directions; touch or mouse drag.
export default function StyleCarousel({ styles, index, onChange, w }) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(null);

  const spacing = Math.max(110, w * SPACING);
  const n = styles.length;

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

  // Render the current name plus NEIGHBORS on each side, positioned relative
  // to center; the whole strip follows the finger while dragging.
  const items = [];
  for (let rel = -NEIGHBORS; rel <= NEIGHBORS; rel++) {
    const idx = (index + rel + n) % n;
    // Effective distance from center, in "slots", including the live drag.
    const eff = rel + dragX / spacing;
    const dist = Math.abs(eff);
    items.push(
      <span
        key={idx}
        className="carousel-item"
        style={{
          transform: `translate(calc(-50% + ${rel * spacing + dragX}px), -50%)`,
          opacity: Math.max(0.2, 1 - dist * 0.75),
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
