import React, { useEffect, useRef } from "react";

const BINS = 32;
const CHANNELS = [
  { key: "r", color: "rgba(255,60,60,0.7)" },
  { key: "g", color: "rgba(60,255,100,0.7)" },
  { key: "b", color: "rgba(60,160,255,0.7)" },
];

export default function Histogram({ histogram }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !histogram) return;

    const W = container.clientWidth;
    const H = container.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#0a0a08";
    ctx.fillRect(0, 0, W, H);

    const barW = W / BINS;
    for (const { key, color } of CHANNELS) {
      const data = histogram[key];
      ctx.fillStyle = color;
      for (let i = 0; i < BINS; i++) {
        const barH = Math.round(data[i] * H);
        if (!barH) continue;
        ctx.fillRect(Math.round(i * barW), H - barH, Math.ceil(barW), barH);
      }
    }

    // CRT scanlines — integer 3px period.
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  }, [histogram]);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, background: "#0a0a08" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
    </div>
  );
}
