# BodyOS handoff

Personal PWA: weight loss + beginner calisthenics. User 82 kg -> 70 kg, 2-3 kg/month.
Hosted free on GitHub Pages, installed via Safari "Add to Home Screen". No Xcode.

## Layout
- `design/screens.html` — static mockups (style reference).
- `app/logic.js` — all formulas, ladders, progression, parsing. Pure, tested.
- `app/logic.test.js` — `node --test app/`
- `app/index.html`, `app/app.js`, `app/app.css`, `app/sw.js`, `app/manifest.webmanifest` — the PWA.

## Decisions
- Kcal: Mifflin-St Jeor x activity, deficit = pace x 7700 / 30.44, floor 1500 m / 1200 f, pace capped at 1% body weight/week.
- Protein 1.6 g/kg, fat 25% kcal (min 0.6 g/kg), carbs remainder.
- Trend weight: EMA 0.1/day, gaps decay as 0.9^days.
- Progression: top of range all 3 sets, 2 sessions in a row -> level up; pain -> level down.
- Food AI: user brings key. Providers: Gemini (default) or any OpenAI-compatible endpoint
  (OpenRouter, local Ollama at http://localhost:11434/v1). DeepSeek has no vision API.
- Reminders: iOS PWAs cannot schedule local notifications, so the app exports an .ics calendar file.

## Status
See git log. AI inference tested last with local Ollama model once the key is provided.
