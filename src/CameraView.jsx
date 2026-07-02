import React, { useEffect, useRef, useState } from "react";

// How often to sample the frame for metrics, and the tiny size we downscale
// to first (32x24 = 768 px, negligible per-tick cost).
const SAMPLE_MS = 50;
const SAMPLE_W = 32;
const SAMPLE_H = 24;

// Compute the scene metrics driving the D/E/F panels from one tiny RGBA frame.
// prevLuma carries last tick's luminance for the motion measure. All outputs
// are normalized 0..1 except dom.{r,g,b} (0–255 display color).
function computeMetrics(data, prevLuma, luma) {
  const n = luma.length;
  let lumaSum = 0;

  // 64-bin coarse color histogram (2 bits/channel), weighted toward saturated
  // pixels so a colorful object beats a large gray background.
  const binW = new Float32Array(64);
  const binR = new Float32Array(64);
  const binG = new Float32Array(64);
  const binB = new Float32Array(64);
  const binN = new Float32Array(64);
  const binS = new Float32Array(64);

  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    luma[p] = l;
    lumaSum += l;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const bin = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
    const w = 0.2 + sat;
    binW[bin] += w;
    binR[bin] += r;
    binG[bin] += g;
    binB[bin] += b;
    binS[bin] += sat;
    binN[bin]++;
  }
  const meanLuma = lumaSum / n;

  // Contrast: luminance standard deviation. Sharpness: mean neighbor gradient.
  let varSum = 0;
  let gradSum = 0;
  let gradN = 0;
  for (let p = 0; p < n; p++) {
    const d = luma[p] - meanLuma;
    varSum += d * d;
    if (p % SAMPLE_W !== 0) {
      gradSum += Math.abs(luma[p] - luma[p - 1]);
      gradN++;
    }
    if (p >= SAMPLE_W) {
      gradSum += Math.abs(luma[p] - luma[p - SAMPLE_W]);
      gradN++;
    }
  }

  // Motion: mean absolute luminance change since the previous tick, with a
  // small floor subtracted so sensor noise reads as zero in a still room.
  let motion = 0;
  if (prevLuma) {
    let diff = 0;
    for (let p = 0; p < n; p++) diff += Math.abs(luma[p] - prevLuma[p]);
    motion = Math.min(1, Math.max(0, diff / n - 1.5) / 40);
  }

  let best = 0;
  for (let k = 1; k < 64; k++) if (binW[k] > binW[best]) best = k;
  const c = Math.max(1, binN[best]);

  return {
    motion,
    brightness: meanLuma / 255,
    contrast: Math.min(1, Math.sqrt(varSum / n) / 80),
    sharpness: Math.min(1, gradSum / gradN / 30),
    dom: {
      r: Math.round(binR[best] / c),
      g: Math.round(binG[best] / c),
      b: Math.round(binB[best] / c),
      sat: binS[best] / c,
    },
  };
}

// Plain live camera feed — no detection, no overlays, no heavy processing.
// Optionally reports scene metrics (motion, brightness, contrast, sharpness,
// dominant color) via onLevels for the side panels.
export default function CameraView({ onLevels }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState("Starting camera…");

  // Keep the latest callback available to the sampling loop without
  // restarting the camera when the parent re-renders.
  const onLevelsRef = useRef(onLevels);
  onLevelsRef.current = onLevels;

  useEffect(() => {
    let stream = null;
    let cancelled = false;
    let sampleTimer = 0;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Prefer the rear camera (the wall-mounted tablet's front camera faces
          // a dark scene). "ideal" so devices with only a front camera still work.
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (e) {
        if (!cancelled) setStatus("Camera access denied");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setStatus("");

      // Sample the frame on a small offscreen canvas and derive the metrics.
      const canvas = document.createElement("canvas");
      canvas.width = SAMPLE_W;
      canvas.height = SAMPLE_H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let luma = new Float32Array(SAMPLE_W * SAMPLE_H);
      let prevLuma = null;
      sampleTimer = setInterval(() => {
        if (!video.videoWidth || !onLevelsRef.current) return;
        try {
          ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
          const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
          onLevelsRef.current(computeMetrics(data, prevLuma, luma));
          // Reuse the buffers: current luma becomes previous, old previous is
          // overwritten next tick.
          const swap = prevLuma || new Float32Array(SAMPLE_W * SAMPLE_H);
          prevLuma = luma;
          luma = swap;
        } catch (e) {
          /* transient — skip this sample */
        }
      }, SAMPLE_MS);
    }

    start();

    return () => {
      cancelled = true;
      clearInterval(sampleTimer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div
      style={{ position: "absolute", inset: 0, background: "#000", overflow: "hidden" }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      {status && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.85)",
            fontSize: 15,
            textAlign: "center",
            padding: 16,
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}
