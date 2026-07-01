import React, { useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

// A small palette to color boxes by object class (stable per label).
const PALETTE = [
  "#00e5ff",
  "#ff40a0",
  "#8cff50",
  "#ffb828",
  "#aa78ff",
  "#ff6a3d",
  "#39d98a",
  "#ffd166",
];

function colorFor(label) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

// ---- Performance / anti-flicker tuning (paced for low-end Android) ----
// The MediaTek tablet's GPU is weak: each model.detect() saturates the same GPU
// that composites the video, so detecting too often makes the live feed stutter.
// Detect less frequently and on a smaller frame; the draw loop still interpolates
// box motion at display framerate, so boxes stay smooth between detections.
const DETECT_INTERVAL_MS = 375; // ~2.6 detections/sec — leaves GPU for the video
const MIN_SCORE = 0.45; // ignore detections below this confidence
const MIN_HITS = 2; // detections a box must accrue before it's drawn
const MAX_MISSES = 6; // detection cycles a box survives once it's gone (~1.2s)
const MATCH_IOU = 0.3; // overlap needed to treat a detection as the same box
const POS_SMOOTH = 0.25; // 0..1 — lower = smoother/laggier box motion
const SCORE_SMOOTH = 0.3; // smoothing for the confidence label
const CAM_WIDTH = 480; // small frame = far less work per detection
const CAM_HEIGHT = 360;

// One COCO-SSD model shared across mounts (loads once).
let modelPromise = null;
function loadModel() {
  if (!modelPromise) modelPromise = cocoSsd.load({ base: "lite_mobilenet_v2" });
  return modelPromise;
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a[2] * a[3] + b[2] * b[3] - inter;
  return uni <= 0 ? 0 : inter / uni;
}

export default function ObjectDetector({ w, h }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const detTimerRef = useRef(0);
  const drawRafRef = useRef(0);
  const runningRef = useRef(true);
  const tracksRef = useRef([]); // smoothed, persistent boxes
  const nextIdRef = useRef(1);
  const [status, setStatus] = useState("Loading model…");

  // Keep latest box size available to the loops without restarting them.
  const sizeRef = useRef({ w, h });
  sizeRef.current = { w, h };

  useEffect(() => {
    runningRef.current = true;
    let stream = null;

    async function start() {
      let model;
      try {
        model = await loadModel();
      } catch (e) {
        setStatus("Failed to load model");
        return;
      }
      // Confirm we're on the GPU; CPU fallback would be unusably slow.
      try {
        await tf.ready();
        const backend = tf.getBackend();
        console.log("[ObjectDetector] TF backend:", backend);
        if (backend !== "webgl" && backend !== "webgpu") {
          console.warn("[ObjectDetector] No GPU backend — detection will be slow.");
        }
      } catch (e) {
        /* non-fatal */
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Prefer the rear camera (the wall-mounted tablet's front camera faces
          // a dark scene). "ideal" so devices with only a front camera still work.
          video: {
            facingMode: { ideal: "environment" },
            width: CAM_WIDTH,
            height: CAM_HEIGHT,
          },
          audio: false,
        });
      } catch (e) {
        setStatus("Camera access denied");
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setStatus("");
      detectLoop(model);
      drawLoop();
    }

    // Detection is paced (not flat-out) so the tablet stays cool. The 60fps
    // draw loop interpolates between these slower updates, so it still looks
    // smooth. We measure how long detect() took and sleep for the remainder
    // of the interval — if the device is slow, we simply detect less often
    // rather than queueing up work.
    async function detectLoop(model) {
      const video = videoRef.current;
      if (!runningRef.current || !video) return;
      const t0 = performance.now();
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          updateTracks(await model.detect(video));
        } catch (e) {
          /* transient — skip this frame */
        }
      }
      if (!runningRef.current) return;
      const wait = Math.max(0, DETECT_INTERVAL_MS - (performance.now() - t0));
      detTimerRef.current = setTimeout(() => detectLoop(model), wait);
    }

    // Match new detections to existing tracks; age out the rest.
    function updateTracks(preds) {
      const dets = preds.filter((p) => p.score >= MIN_SCORE);
      const existing = tracksRef.current;
      const matched = new Set();
      const fresh = [];

      for (const d of dets) {
        let best = -1;
        let bestIoU = MATCH_IOU;
        for (let i = 0; i < existing.length; i++) {
          if (matched.has(i) || existing[i].class !== d.class) continue;
          const o = iou(existing[i].target, d.bbox);
          if (o > bestIoU) {
            bestIoU = o;
            best = i;
          }
        }
        if (best >= 0) {
          matched.add(best);
          const t = existing[best];
          t.target = d.bbox;
          t.score = t.score * (1 - SCORE_SMOOTH) + d.score * SCORE_SMOOTH;
          t.hits++;
          t.misses = 0;
        } else {
          fresh.push({
            id: nextIdRef.current++,
            class: d.class,
            score: d.score,
            target: d.bbox.slice(),
            box: d.bbox.slice(),
            hits: 1,
            misses: 0,
          });
        }
      }

      for (let i = 0; i < existing.length; i++) {
        if (!matched.has(i)) existing[i].misses++;
      }
      tracksRef.current = existing
        .filter((t) => t.misses <= MAX_MISSES)
        .concat(fresh);
    }

    // Draw at display framerate, easing each box toward its target.
    function drawLoop() {
      if (!runningRef.current) return;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (canvas && video && video.videoWidth) {
        const { w: bw, h: bh } = sizeRef.current;
        if (canvas.width !== bw) canvas.width = bw;
        if (canvas.height !== bh) canvas.height = bh;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, bw, bh);

        // Map video-native coords onto the box, matching object-fit: cover.
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const scale = Math.max(bw / vw, bh / vh);
        const ox = (bw - vw * scale) / 2;
        const oy = (bh - vh * scale) / 2;

        ctx.lineWidth = 2;
        ctx.font = "600 14px -apple-system, Helvetica Neue, Arial, sans-serif";
        ctx.textBaseline = "top";

        for (const t of tracksRef.current) {
          // Ease the displayed box toward the latest detected position.
          for (let k = 0; k < 4; k++) {
            t.box[k] += (t.target[k] - t.box[k]) * POS_SMOOTH;
          }
          if (t.hits < MIN_HITS) continue; // not stable yet

          const dx = t.box[0] * scale + ox;
          const dy = t.box[1] * scale + oy;
          const dw = t.box[2] * scale;
          const dh = t.box[3] * scale;
          const col = colorFor(t.class);

          // Fade out during the grace period after detection stops.
          ctx.globalAlpha = t.misses > 0 ? Math.max(0.25, 1 - t.misses / MAX_MISSES) : 1;

          ctx.strokeStyle = col;
          ctx.strokeRect(dx, dy, dw, dh);

          const label = `${t.class} ${Math.round(t.score * 100)}%`;
          const padX = 6;
          const tw = ctx.measureText(label).width + padX * 2;
          const th = 20;
          const ly = dy - th < 0 ? dy : dy - th;
          ctx.fillStyle = col;
          ctx.fillRect(dx, ly, tw, th);
          ctx.fillStyle = "#000";
          ctx.fillText(label, dx + padX, ly + 3);
          ctx.globalAlpha = 1;
        }
      }
      drawRafRef.current = requestAnimationFrame(drawLoop);
    }

    start();

    return () => {
      runningRef.current = false;
      clearTimeout(detTimerRef.current);
      cancelAnimationFrame(drawRafRef.current);
      tracksRef.current = [];
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
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
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
