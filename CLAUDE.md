# World View

React (Vite) web app + Express server for a wall-mounted Lenovo tablet behind a
3D-printed frame with cut-outs. The screen is divided into absolutely
positioned "sections" (slots) that line up with the frame's holes. The tablet
runs the sibling repo `world-view-android-wrapper` (a kiosk WebView shell); on
this machine both live under `~/Developer/world-view-system/`.

## Architecture

- `src/App.jsx` — loads the slot layout from `GET /api/layout`, renders one
  component per slot, and owns the keyboard-driven layout editor (press `H` in
  the app for keys). Slot indexes are load-bearing:
  0. `DecartCamera` — camera restyled live through Decart's realtime API
     (`lucy-restyle-2` via `@decartai/sdk`, same flow as magic-camera-android).
     Tap pauses/resumes (freeze frame, no frames sent while paused). Style
     switches fade the feed out and reveal on the server's `prompt_ack`.
  1. `StyleCarousel` — swipeable style-name picker (styles in `src/styles.js`),
     shared `styleIndex` state lives in App.
  2. `Histogram`, 3–5. `StatPanel` (LUM/CON/SHP) — driven by metrics sampled
     from the *stylized* feed (`startMetricsSampling` in `CameraView.jsx`).
- Visual language for the side panels: monochrome white-on-black CRT — Roboto
  Mono 400 (Google Fonts, monospace fallback), phosphor glow, 3px scanlines.
- `server.js` — Express on port 3138: serves `dist/`, `GET/PUT /api/layout`
  (persists `layout.default.json`), and `GET /api/config`.

## Secrets — never commit these

`.env` (gitignored, see `.env.example`) holds `DECART_API_KEY` and
`ACCESS_KEY`. `GET /api/config` returns the Decart key **only** when the
request carries `?key=<ACCESS_KEY>`; the app forwards its own `?key=` URL
param. Without it the camera slot shows "No API key". The production `.env`
lives at `/home/leo/full-stack-apps/world-view/.env` (`leo@root.noshado.ws`,
SSH from Leo's Mac works) — deploys don't touch it; new env vars must be added
there manually.

## Workflow

- Build: `npm run build` (the Express server serves `dist/`, so rebuild to see
  changes). Dev: `npm run dev` (Vite proxies `/api` to :3138) + `npm start`.
- Test locally at `http://localhost:3138/?key=<ACCESS_KEY from .env>`.
- Deploy: push to `main` on GitHub → Actions pushes to the DreamCompute server
  → live at https://world-view.leo.gd. The tablet URL needs the `?key=` param
  (the wrapper bakes it in from its gitignored `secrets.properties`).
- Layout numbers in `layout.default.json` are calibrated on the physical
  tablet (TB310FU) — don't "clean them up".
