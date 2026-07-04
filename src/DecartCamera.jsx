import React, { useEffect, useRef, useState } from "react";
import { createDecartClient, models } from "@decartai/sdk";
import { startMetricsSampling } from "./CameraView";

const MODEL_NAME = "lucy-restyle-2";
const REVEAL_DELAY_MS = 2500; // fallback reveal if no painted frame is detected
const RETRY_DELAY_MS = 5000; // kiosk: retry automatically instead of tap-to-resume
// setPrompt resolves on the server's prompt_ack, i.e. when the new style is
// applied; this buffer covers the first restyled frames' trip over WebRTC.
const STYLE_ACK_BUFFER_MS = 400;

// Live camera restyled through Decart's realtime API (same flow as
// magic-camera-android). Tap anywhere on the feed to pause — camera off,
// nothing sent to Decart — and tap again to resume. While connected it
// reports scene metrics from the *stylized* feed via onLevels, so the
// histogram and meter panels react to what's on screen. `prompt` changes
// are pushed into the live session without reconnecting.
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
      teardown();
      setRevealed(false);
      setStatus(msg + " — retrying…");
      retryTimer = setTimeout(connect, RETRY_DELAY_MS);
    }

    async function connect() {
      if (cancelled) return;
      setRevealed(false);
      setStatus("Connecting…");
      try {
        // Match the model's native capture spec (1280x704@30) so the browser
        // doesn't rescale; `ideal` lets the camera pick the closest it can do.
        localStream = await navigator.mediaDevices.getUserMedia({
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
        if (cancelled) return teardown();

        let revealScheduled = false;
        const realtime = await client.realtime.connect(localStream, {
          model,
          mirror: false,
          onRemoteStream: (transformed) => {
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
        if (cancelled) {
          realtime.disconnect?.();
          return teardown();
        }
        realtimeRef.current = realtime;

        // Drive the side panels from the transformed feed on screen. The
        // sampler no-ops until the video has frames.
        if (videoRef.current) {
          stopSampling = startMetricsSampling(videoRef.current, onLevelsRef);
        }

        realtime.on?.("error", (e) => {
          console.error("[DecartCamera] error", e);
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
          if (cancelled) return;
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
    (async () => {
      try {
        await realtime.setPrompt(prompt); // resolves on prompt_ack
      } catch (e) {
        // Timeout or send failure — reveal anyway rather than staying dark.
        console.error("[DecartCamera] setPrompt failed", e);
      }
      if (stale) return;
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

  const message = !apiKey
    ? apiKey === ""
      ? "Missing Decart API key (set DECART_API_KEY in .env)"
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
      {message && (
        <div className="decart-status">
          {message === "Connecting…" || message === "Reconnecting…" ? (
            <div className="decart-spinner" />
          ) : (
            message
          )}
        </div>
      )}
    </div>
  );
}
