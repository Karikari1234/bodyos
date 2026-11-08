# BodyOS handoff

Personal PWA: weight loss + beginner calisthenics. User 82 kg -> 70 kg, 2-3 kg/month.
Hosted free on GitHub Pages, installed via Safari "Add to Home Screen". No Xcode.

## Layout
- `design/screens.html` — static mockups (style reference).
- `app/logic.js` — all formulas, ladders, progression, parsing. Pure, tested.
- `app/logic.test.js` — `node --test app/logic.test.js`
- `app/index.html`, `app/app.js`, `app/app.css`, `app/sw.js`, `app/manifest.webmanifest` — the PWA.

## Decisions
- Kcal: Mifflin-St Jeor x activity, deficit = pace x 7700 / 30.44, floor 1500 m / 1200 f, pace capped at 1% body weight/week.
- Protein 1.6 g/kg, fat 25% kcal (min 0.6 g/kg), carbs remainder.
- Trend weight: EMA 0.1/day, gaps decay as 0.9^days.
- Progression: top of range all 3 sets, 2 sessions in a row -> level up; pain -> level down.
- Food AI: user brings key. Providers: Gemini (default) or any OpenAI-compatible endpoint
  (OpenRouter, local Ollama at http://localhost:11434/v1). DeepSeek has no vision API.
- Reminders: iOS PWAs cannot schedule local notifications, so the app exports an .ics calendar file.

## Data safety (read before changing saved data)
- All user data is one JSON blob in localStorage under `bodyos.v1`, tied to the origin karikari1234.github.io.
  Deploys never touch it. Deleting the home-screen app, changing the hosting origin, or iOS storage pressure can.
- `navigator.storage.persist()` is requested at startup to reduce eviction risk.
- Any change to the shape of saved data MUST keep old data readable: add a migration in `load()` that upgrades
  the old shape (or bump to `bodyos.v2` and convert from v1 once). Never rename/drop fields without one.
- Export/Import (Me tab) is the user's backup; keep Import accepting older export files.

## Status
See git log. 15/15 logic tests pass; full UI flow verified in browser.
- Local AI tested: qwen3.5:2b via Ollama, ~4 s with `reasoning_effort:'none'` (auto-sent when base URL has :11434;
  with thinking on it hit the 90 s timeout). Output parsed fine but was inaccurate (rice 200 g = 340 kcal, macros
  summed to 263 -> app flags mismatch). Small local models are not trustworthy; use Gemini Flash-Lite for real use.
- Ollama on the Mac is not reachable from the iPhone PWA (localhost = phone).
- Gemini 2.5 Flash-Lite tested with user's key: ~2-3 s. Rice 200 g = 262 kcal (USDA ~260), 2 eggs + bread = 235 (~231).
  Found + fixed: model appended junk after JSON (parser now takes first balanced object); model listed
  "2 eggs" as two items each with the 2-egg total (prompt now says one item per food, totals, never repeat).
- `gemini-3.8-flash-lite` does not exist; the app shows the API's "model not found" error.
- Not tested: real camera photo through the UI sheet (tests used a blank image + text hint).
