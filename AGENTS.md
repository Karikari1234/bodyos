# BodyOS

Offline-first PWA for weight loss: food, weight, water, steps, sleep/mood, bodyweight training. No build step, no dependencies.

## Layout
- `app/logic.js` — pure logic (no DOM), exported as `window.L` / CommonJS. Put testable math here.
- `app/app.js` — UI + state (`localStorage` key `bodyos.v1`, object `S`). Per-day data in `S.days[YYYY-MM-DD]` (`food`, `water`, `steps`, `sleep: {bed, wake, mood}`).
- `app/figures.js` — exercise animations. `app/sw.js` — service worker.

## Commands
- Test: `node --test app/logic.test.js`
- Run: `python3 -m http.server 8765 -d app`

## Rules
- Saved data must stay readable: shape changes need a migration in `load()`; prefer additive fields.
- Bump `VERSION` in `app/sw.js` when shipped files change.
- New logic in `logic.js` gets a test.
- Push to `main` deploys to GitHub Pages; tests gate the deploy.
