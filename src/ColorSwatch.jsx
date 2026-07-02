import React from "react";

export default function ColorSwatch({ dom }) {
  const { r, g, b } = dom;
  const hex =
    "#" +
    [r, g, b]
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("");
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const ink = lum > 0.55 ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.85)";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: hex,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: '"Courier New", ui-monospace, monospace',
        fontWeight: 700,
        gap: 4,
      }}
    >
      <div style={{ fontSize: 20, color: ink, letterSpacing: "0.12em" }}>
        {hex.toUpperCase()}
      </div>
      <div style={{ fontSize: 12, color: ink, opacity: 0.7, letterSpacing: "0.06em" }}>
        {Math.round(r)} &nbsp; {Math.round(g)} &nbsp; {Math.round(b)}
      </div>
    </div>
  );
}
