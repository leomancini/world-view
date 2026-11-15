import React, { useEffect, useRef, useState } from "react";
import { createDecartClient, models } from "@decartai/sdk";
import { startMetricsSampling } from "./CameraView";

const MODEL_NAME = "lucy-restyle-latest";
// Decart's fast tier: lower latency, same quality, billed at 2x. Only the
// lucy-2.x / lucy-latest edit models offer it (US region), not the restyle
// models, so it's off here. Set to "fast" if you switch to one that does.
const SPEED = undefined;
const REVEAL_DELAY_MS = 2500; // fallback reveal if no painted frame is detected
const RETRY_DELAY_MS = 5000; // kiosk: retry automatically instead of tap-to-resume
// setPrompt resolves on the server's prompt_ack, i.e. when the new style is
// applied; this buffer covers the first restyled frames' trip over WebRTC.
const STYLE_ACK_BUFFER_MS = 400;
// Idle on one style this long and the feed auto-pauses (freeze frame, camera
// off); a style switch or manual tap-to-resume restarts the countdown, but
// once paused it stays paused until tapped — no auto-resume.
const AUTO_PAUSE_MS = 60000;
// Safety net for the style fade: longer than the SDK's own setPrompt timeout
// (15s), so it only matters when the reveal after a style switch never runs.
const STYLE_FADE_MAX_MS = 20000;
// Auto-pause when the *raw* camera sees nothing worth restyling: too dark, a
// flat field of one color (lens pressed against something), or no edges at
// all (badly out of focus). Checked on the raw feed because the model
// invents texture even from a black frame. The scene has to stay blank for
// BLANK_PAUSE_MS before we pause, so a hand passing by doesn't trigger it.
// Thresholds are 0–255 luma at BLANK_W x BLANK_H; tune on the tablet with
// ?debug=blank in the URL (logs the numbers every second).
const BLANK_CHECK_MS = 250;
const BLANK_PAUSE_MS = 3000;
const BLANK_W = 64;
const BLANK_H = 48;
const DARK_LUMA = 20; // mean luma below this = mostly black
const FLAT_STD = 10; // luma std-dev below this = one flat color
const EDGE_STEP = 10; // neighbor luma jump that counts as an edge
const MIN_EDGE_FRACTION = 0.02; // fewer edge pixels than this = blurry
const DEBUG_BLANK = /[?&]debug=blank\b/.test(window.location.search);

// Score one tiny RGBA frame. Returns the reason it looks blank, or null.
function blankReason(data, w, h, log) {
  const n = w * h;
  const luma = new Float32Array(n);
  let sum = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    luma[p] = l;
    sum += l;
  }
  const mean = sum / n;
  let varSum = 0;
  let edges = 0;
  for (let p = 0; p < n; p++) {
    const d = luma[p] - mean;
    varSum += d * d;
    const x = p % w;
    const gx = x < w - 1 ? Math.abs(luma[p + 1] - luma[p]) : 0;
    const gy = p + w < n ? Math.abs(luma[p + w] - luma[p]) : 0;
    if (Math.max(gx, gy) >= EDGE_STEP) edges++;
  }
  const std = Math.sqrt(varSum / n);
  const edgeFraction = edges / n;
  const reason =
    mean < DARK_LUMA
      ? "dark"
      : std < FLAT_STD
      ? "flat"
      : edgeFraction < MIN_EDGE_FRACTION
      ? "blurry"
      : null;
  if (log) {
    console.log(
      `[DecartCamera] blank check mean=${mean.toFixed(1)} std=${std.toFixed(
        1
      )} edges=${(edgeFraction * 100).toFixed(1)}% -> ${reason || "ok"}`
    );
  }
  return reason;
}

// Watch the raw camera stream and call onBlank(reason) once it has looked
// blank for BLANK_PAUSE_MS straight. onBlankStart fires when a blank streak
// begins (used to grab a freeze frame while the restyled feed still shows
// the real scene). Returns a stop function.
function startBlankWatch(stream, onBlankStart, onBlank) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.play().catch(() => {});
  const canvas = document.createElement("canvas");
  canvas.width = BLANK_W;
  canvas.height = BLANK_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let blankSince = null;
  let fired = false;
  let lastLog = 0;
  const timer = setInterval(() => {
    if (fired || !video.videoWidth) return;
    try {
      ctx.drawImage(video, 0, 0, BLANK_W, BLANK_H);
      const { data } = ctx.getImageData(0, 0, BLANK_W, BLANK_H);
      const now = Date.now();
      const log = DEBUG_BLANK && now - lastLog >= 1000;
      if (log) lastLog = now;
      const reason = blankReason(data, BLANK_W, BLANK_H, log);
      if (!reason) {
        blankSince = null;
        return;
      }
      if (blankSince === null) {
        blankSince = now;
        onBlankStart();
      } else if (now - blankSince >= BLANK_PAUSE_MS) {
        fired = true;
        onBlank(reason);
      }
    } catch (e) {
      /* transient — skip this sample */
    }
  }, BLANK_CHECK_MS);
  return () => {
    clearInterval(timer);
    video.srcObject = null;
  };
}

// Live camera restyled through Decart's realtime API (same flow as
// magic-camera-android). Tap anywhere on the feed to pause — camera off,
// nothing sent to Decart — and tap again to resume. It also auto-pauses
// after a minute of sitting on the same style (see AUTO_PAUSE_MS); switching
// styles resets that countdown, but once auto-paused it stays paused until
// tapped. It also auto-pauses when the raw camera sees basically nothing
// (dark, one flat color, or totally out of focus) for a few seconds — see
// startBlankWatch. While connected it reports scene metrics from the *stylized* feed
// via onLevels, so the histogram and meter panels react to what's on screen.
// `prompt` changes are pushed into the live session without reconnecting.
export default function DecartCamera({ apiKey, prompt, onLevels }) {
  const videoRef = useRef(null);
  const realtimeRef = useRef(null);
  const [status, setStatus] = useState("Connecting…");
  const [revealed, setRevealed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [styleFading, setStyleFading] = useState(false);
  const fadeTimer = useRef(null);
  const freezeRef = useRef(null);

  // Copy the current frame onto the freeze canvas. Called right before the
  // stream is torn down (pause) so the slot shows a still instead of black.
  function captureFreeze() {
    const video = videoRef.current;
    const canvas = freezeRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    try {
      canvas.getContext("2d").drawImage(video, 0, 0);
    } catch (e) {
      /* ignore — worst case the canvas stays on its previous frame */
    }
  }

  // Latest prompt/callback available to the connect effect without re-running it.
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const onLevelsRef = useRef(onLevels);
  onLevelsRef.current = onLevels;

  useEffect(() => {
    if (!apiKey || paused) return;
    let cancelled = false;
    let localStream = null;
    let retryTimer = null;
    let revealTimer = null;
    let stopSampling = null;
    let stopBlankWatch = null;
    // Bumped by every connect and retry. A connect attempt or session whose
    // number is no longer current is stale: its callbacks are ignored and it
    // only cleans up after itself, so there is never more than one session.
    let generation = 0;

    const model = models.realtime(MODEL_NAME);
    const client = createDecartClient({ apiKey });

    function show(stream) {
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      const tryPlay = () => video.play().catch(() => {});
      tryPlay();
      video.onloadedmetadata = tryPlay;
    }

    function goLive() {
      if (cancelled) return;
      setRevealed(true);
      setStatus("");
    }

    function teardown() {
      clearTimeout(revealTimer);
      if (stopSampling) {
        stopSampling();
        stopSampling = null;
      }
      if (stopBlankWatch) {
        stopBlankWatch();
        stopBlankWatch = null;
      }
      try {
        realtimeRef.current?.disconnect?.();
      } catch (e) {
        /* ignore */
      }
      realtimeRef.current = null;
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
      }
    }

    function scheduleRetry(msg) {
      if (cancelled) return;
      generation++; // events from the session being torn down are stale now
      teardown();
      setRevealed(false);
      setStatus(msg + " — retrying…");
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, RETRY_DELAY_MS);
    }

    async function connect() {
      if (cancelled) return;
      const gen = ++generation;
      const stale = () => cancelled || gen !== generation;
      let stream = null;
      const stopStream = () => stream?.getTracks().forEach((t) => t.stop());
      setRevealed(false);
      setStatus("Connecting…");
      try {
        // Match the model's native capture spec (1280x704@30) so the browser
        // doesn't rescale; `ideal` lets the camera pick the closest it can do.
        stream = await navigator.mediaDevices.getUserMedia({
          // Prefer the rear camera (the wall-mounted tablet's front camera
          // faces a dark scene); front-only devices still work via `ideal`.
          video: {
            facingMode: { ideal: "environment" },
            frameRate: model.fps,
            width: { ideal: model.width },
            height: { ideal: model.height },
          },
          audio: false,
        });
        if (stale()) return stopStream();
        localStream = stream;

        let revealScheduled = false;
        const realtime = await client.realtime.connect(stream, {
          model,
          ...(SPEED ? { speed: SPEED } : {}),
          mirror: false,
          onRemoteStream: (transformed) => {
            if (stale()) return;
            show(transformed);
            // Reveal on the first painted frame (avoids a placeholder flash),
            // with a timer fallback if requestVideoFrameCallback is missing.
            if (!revealScheduled) {
              revealScheduled = true;
              const video = videoRef.current;
              if (video?.requestVideoFrameCallback) {
                video.requestVideoFrameCallback(() => goLive());
              }
              revealTimer = setTimeout(goLive, REVEAL_DELAY_MS);
            }
          },
          initialState: {
            prompt: { text: promptRef.current, enhance: true },
          },
        });
        if (stale()) {
          try {
            realtime.disconnect?.();
          } catch (e) {
            /* ignore */
          }
          return stopStream();
        }
        realtimeRef.current = realtime;

        // Drive the side panels from the transformed feed on screen. The
        // sampler no-ops until the video has frames.
        if (videoRef.current) {
          stopSampling = startMetricsSampling(videoRef.current, onLevelsRef);
        }

        stopBlankWatch = startBlankWatch(
          stream,
          () => {
            if (!stale()) captureFreeze();
          },
          (reason) => {
            if (stale()) return;
            console.log("[DecartCamera] auto-pausing, camera looks", reason);
            // Freeze was already grabbed when the blank streak started, so
            // the paused slot shows the last real scene, not a black frame.
            setPaused(true);
          }
        );

        realtime.on?.("error", (e) => {
          console.error("[DecartCamera] error", e);
          if (stale()) return;
          const code = e?.code;
          let msg = e?.message || String(e);
          if (code === "INVALID_API_KEY") msg = "Invalid API key";
          else if (code === "MODEL_NOT_FOUND") msg = "Model unavailable";
          else if (code === "WEB_RTC_ERROR") msg = "Network error";
          setStatus("Error: " + msg);
        });

        // The SDK auto-reconnects with backoff; if it gives up entirely we
        // rebuild the whole session ourselves.
        realtime.on?.("connectionChange", (state) => {
          console.log("[DecartCamera] connectionChange", state);
          if (stale()) return;
          if (state === "reconnecting") setStatus("Reconnecting…");
          else if (state === "disconnected") scheduleRetry("Disconnected");
          else if (state === "connected" || state === "generating") {
            if (realtimeRef.current) setStatus("");
          }
        });

        // The style may have changed while we were connecting.
        if (promptRef.current !== undefined) {
          try {
            realtime.setPrompt(promptRef.current);
          } catch (e) {
            /* initialState already covers it */
          }
        }
      } catch (e) {
        console.error("[DecartCamera] connect failed", e);
        if (stale()) return stopStream();
        if (/denied|permission/i.test(e?.message || "")) {
          setStatus("Camera access denied");
        } else {
          scheduleRetry("Failed: " + (e?.message || e));
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      teardown();
    };
  }, [apiKey, paused]);

  // Push style changes into the live session, fading the feed out while the
  // old look drains and back in once the server acks the new prompt. Rapid
  // swipes mark earlier requests stale, so only the last style reveals.
  useEffect(() => {
    const realtime = realtimeRef.current;
    if (!realtime || !prompt) return;
    let stale = false;
    setStyleFading(true);
    clearTimeout(fadeTimer.current);
    // Fallback: if the reveal below never runs (e.g. this request goes stale
    // while the session is down), un-fade anyway rather than staying dark.
    fadeTimer.current = setTimeout(
      () => setStyleFading(false),
      STYLE_FADE_MAX_MS
    );
    (async () => {
      try {
        await realtime.setPrompt(prompt); // resolves on prompt_ack
      } catch (e) {
        // Timeout or send failure — reveal anyway rather than staying dark.
        console.error("[DecartCamera] setPrompt failed", e);
      }
      if (stale) return;
      clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(
        () => setStyleFading(false),
        STYLE_ACK_BUFFER_MS
      );
    })();
    return () => {
      stale = true;
    };
  }, [prompt]);

  useEffect(() => () => clearTimeout(fadeTimer.current), []);

  // Auto-pause after a minute of no style change. Resets on every prompt
  // switch and on manual resume; once paused, stays paused (no re-arm) until
  // the next tap-to-resume restarts the countdown.
  const autoPauseTimer = useRef(null);
  useEffect(() => {
    clearTimeout(autoPauseTimer.current);
    if (paused) return;
    autoPauseTimer.current = setTimeout(() => {
      captureFreeze();
      setPaused(true);
    }, AUTO_PAUSE_MS);
    return () => clearTimeout(autoPauseTimer.current);
  }, [prompt, paused]);

  const message = !apiKey
    ? apiKey === ""
      ? "No API key"
      : "" // key still loading
    : paused
    ? ""
    : status;

  function togglePause() {
    if (!apiKey) return;
    if (!paused) captureFreeze(); // grab the frame before teardown stops the stream
    setPaused(!paused);
  }

  return (
    <div className="decart-cam" onClick={togglePause}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          opacity: revealed && !styleFading ? 1 : 0,
          // Drop out quickly, ease back in.
          transition: styleFading ? "opacity 0.2s" : "opacity 0.6s",
        }}
      />
      {/* Last captured frame; carries the slot through pause and reconnect
          (blank on very first load, which reads as the usual black). */}
      <canvas
        ref={freezeRef}
        className="decart-freeze"
        style={{ opacity: paused || !revealed ? 1 : 0 }}
      />
      {paused && (
        <div className="decart-paused">
          <div className="decart-play" />
        </div>
      )}
      {message &&
        (message === "Connecting…" || message === "Reconnecting…" ? (
          // Same dimmed overlay as the paused state, spinner instead of play.
          <div className="decart-status decart-dim">
            <div className="decart-spinner" />
          </div>
        ) : (
          <div className="decart-status">{message}</div>
        ))}
    </div>
  );
}
