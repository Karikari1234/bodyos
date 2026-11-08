// Pure logic for BodyOS. No DOM. Loaded by the app (window.L) and by tests (require).
(function (root) {
  'use strict';

  // ---------- constants (sources in README) ----------
  const KCAL_PER_KG = 7700;          // energy in ~1 kg of body fat tissue (Wishnofsky / common practice)
  const DAYS_PER_MONTH = 30.44;
  const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
  const KCAL_FLOOR = { m: 1500, f: 1200 };   // common minimum without medical supervision
  const MAX_WEEKLY_LOSS = 0.01;              // 1% body weight per week
  const PROTEIN_G_PER_KG = 1.6;              // Morton et al. 2018 meta-analysis plateau
  const FAT_SHARE = 0.25;                    // 25% of kcal from fat
  const FAT_MIN_G_PER_KG = 0.6;
  const TREND_SMOOTHING = 0.1;               // Hacker's Diet exponential moving average

  // ---------- dates (local calendar days as 'YYYY-MM-DD') ----------
  const pad = n => String(n).padStart(2, '0');
  function dayKey(d = new Date()) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function keyToUTC(k) { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function daysBetween(a, b) { return Math.round((keyToUTC(b) - keyToUTC(a)) / 86400000); }
  function addDays(k, n) { const t = new Date(keyToUTC(k) + n * 86400000); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }
  function weekday(k) { return new Date(keyToUTC(k)).getUTCDay(); } // 0 = Sunday

  // ---------- energy ----------
  // Mifflin-St Jeor (1990). kg, cm, years.
  function bmr({ sex, kg, cm, age }) {
    const base = 10 * kg + 6.25 * cm - 5 * age;
    return sex === 'f' ? base - 161 : base + 5;
  }

  // p: { sex, kg, cm, age, activity, paceKgMonth }
  function targets(p) {
    const b = bmr(p);
    const tdee = b * ACTIVITY[p.activity];
    const maxPace = p.kg * MAX_WEEKLY_LOSS * DAYS_PER_MONTH / 7;
    const wantPace = Math.min(p.paceKgMonth, maxPace);
    const floor = KCAL_FLOOR[p.sex === 'f' ? 'f' : 'm'];
    const raw = Math.max(floor, tdee - wantPace * KCAL_PER_KG / DAYS_PER_MONTH);
    const kcal = Math.round(raw / 10) * 10;
    const protein = Math.round(PROTEIN_G_PER_KG * p.kg);
    const fat = Math.max(Math.round(FAT_SHARE * kcal / 9), Math.round(FAT_MIN_G_PER_KG * p.kg));
    const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    const pace = Math.max(0, (tdee - kcal) * DAYS_PER_MONTH / KCAL_PER_KG);
    return {
      bmr: Math.round(b), tdee: Math.round(tdee), kcal, protein, fat, carbs,
      pace: Math.round(pace * 10) / 10,
      limited: pace < p.paceKgMonth - 0.05, // asked pace not reachable safely
    };
  }

  function bmi(kg, cm) { return kg / Math.pow(cm / 100, 2); }

  // Calendar day when goal reached at a given pace (kg/month).
  function goalDate(fromKey, kg, goalKg, paceKgMonth) {
    if (kg <= goalKg) return fromKey;
    if (!(paceKgMonth > 0)) return null;
    return addDays(fromKey, Math.ceil((kg - goalKg) / paceKgMonth * DAYS_PER_MONTH));
  }

  // Planned weight on day `k` for a plan starting at startKey/startKg.
  function planWeight(startKey, startKg, goalKg, paceKgMonth, k) {
    const w = startKg - daysBetween(startKey, k) * paceKgMonth / DAYS_PER_MONTH;
    return Math.max(goalKg, w);
  }

  // ---------- weight trend ----------
  // weights: { 'YYYY-MM-DD': kg }. Returns [{date, kg, trend}] sorted. Gaps decay as (1-a)^days.
  function trend(weights) {
    const keys = Object.keys(weights).sort();
    const out = [];
    let t = null, prev = null;
    for (const k of keys) {
      const w = weights[k];
      if (t === null) t = w;
      else {
        const a = 1 - Math.pow(1 - TREND_SMOOTHING, daysBetween(prev, k));
        t = t + a * (w - t);
      }
      out.push({ date: k, kg: w, trend: Math.round(t * 100) / 100 });
      prev = k;
    }
    return out;
  }

  // Trend change per week over the last `days` days (negative = losing). null if not enough data.
  function weeklyRate(series, days = 14) {
    if (series.length < 2) return null;
    const last = series[series.length - 1];
    const from = addDays(last.date, -days);
    let first = series.find(s => s.date >= from);
    if (!first || first === last) return null;
    const span = daysBetween(first.date, last.date);
    if (span < 7) return null;
    return Math.round((last.trend - first.trend) / span * 7 * 100) / 100;
  }

  // ---------- streak ----------
  // Consecutive days with a log, ending today (or yesterday, if today not yet logged).
  function streak(loggedKeys, today) {
    const set = new Set(loggedKeys);
    let k = set.has(today) ? today : addDays(today, -1);
    let n = 0;
    while (set.has(k)) { n++; k = addDays(k, -1); }
    return n;
  }

  // ---------- steps ----------
  // Raise goal by 500 when hit on 5 of the last 7 days (all 7 days must be recorded). Cap 12000.
  function nextStepGoal(goal, last7) {
    if (last7.length < 7) return goal;
    const hits = last7.filter(s => s >= goal).length;
    return hits >= 5 ? Math.min(12000, goal + 500) : goal;
  }

  // ---------- food ----------
  function macroKcal(p, c, f) { return 4 * p + 4 * c + 9 * f; }
  // true when stated kcal and macros disagree by more than 15% (and 40 kcal).
  function macroMismatch(kcal, p, c, f) {
    const m = macroKcal(p, c, f);
    const diff = Math.abs(m - kcal);
    return diff > 40 && diff > 0.15 * Math.max(kcal, m);
  }
  function sumFood(items) {
    const s = { kcal: 0, p: 0, c: 0, f: 0 };
    for (const i of items) { s.kcal += +i.kcal || 0; s.p += +i.p || 0; s.c += +i.c || 0; s.f += +i.f || 0; }
    return s;
  }

  // Validate model output. Returns { items, confidence, notes } or throws.
  function parseAIFood(text) {
    let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    // first balanced {...}, string-aware: models sometimes append junk after the JSON
    const a = s.indexOf('{'); let b = -1;
    for (let i = a, d = 0, q = false; a >= 0 && i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === '\\') i++; else if (ch === '"') q = false; }
      else if (ch === '"') q = true;
      else if (ch === '{') d++;
      else if (ch === '}' && --d === 0) { b = i; break; }
    }
    if (b < 0) throw new Error('No JSON in AI reply');
    const obj = JSON.parse(s.slice(a, b + 1));
    if (!Array.isArray(obj.items) || !obj.items.length) throw new Error('AI found no food');
    const num = (v, max) => { const n = Number(v); if (!isFinite(n) || n < 0) return 0; return Math.min(n, max); };
    const items = obj.items.slice(0, 20).map(i => {
      const p = num(i.protein_g, 300), c = num(i.carbs_g, 600), f = num(i.fat_g, 300);
      let kcal = num(i.kcal, 5000);
      if (!kcal) kcal = macroKcal(p, c, f);
      return {
        name: String(i.name || 'Food').slice(0, 60),
        grams: Math.round(num(i.grams, 3000)),
        kcal: Math.round(kcal), p: Math.round(p), c: Math.round(c), f: Math.round(f),
        mismatch: macroMismatch(kcal, p, c, f),
      };
    });
    const conf = ['low', 'medium', 'high'].includes(obj.confidence) ? obj.confidence : 'low';
    return { items, confidence: conf, notes: String(obj.notes || '').slice(0, 300) };
  }

  // ---------- training ----------
  // type 'reps': sets x reps range. 'secs': sets x hold seconds. 'each': reps per side.
  const LADDERS = {
    squat: { name: 'Squat', levels: [
      { n: 'Chair sit-to-stand', type: 'reps', min: 8, max: 12, cues: ['Sit on a sturdy chair, feet hip-width', 'Lean chest forward, push through whole foot', 'Stand tall, then sit down slowly (3 s)', 'Use hands on thighs only if needed'] },
      { n: 'Box squat (touch chair)', type: 'reps', min: 8, max: 12, cues: ['Stand in front of chair', 'Hips back and down until you lightly touch the seat', 'Do not sit or relax at the bottom', 'Knees track over toes'] },
      { n: 'Bodyweight squat', type: 'reps', min: 10, max: 15, cues: ['Feet shoulder-width, toes slightly out', 'Arms forward for balance', 'Hips down to at least knee level if comfortable', 'Heels stay on the floor'] },
      { n: 'Split squat', type: 'each', min: 8, max: 12, cues: ['Long stance, back heel up', 'Drop back knee straight down toward floor', 'Front heel stays down', 'Hold a wall for balance at first'] },
      { n: 'Reverse lunge', type: 'each', min: 8, max: 12, cues: ['Step one foot back', 'Lower until both knees near 90°', 'Push through front heel to return', 'Torso tall'] },
      { n: 'Bulgarian split squat', type: 'each', min: 8, max: 12, cues: ['Back foot on a chair seat behind you', 'Lower straight down', 'Front knee follows toes', 'Most weight on front leg'] },
    ] },
    push: { name: 'Push', levels: [
      { n: 'Wall push-up', type: 'reps', min: 8, max: 15, cues: ['Hands on wall at shoulder height, slightly wider than shoulders', 'Body straight from head to heels', 'Elbows about 45° from body', 'Chest to near the wall, push back'] },
      { n: 'Counter push-up', type: 'reps', min: 8, max: 15, cues: ['Hands on kitchen counter edge', 'Squeeze glutes, body in one line', 'Lower chest to the edge', 'Full arm lockout at top'] },
      { n: 'Low incline push-up', type: 'reps', min: 8, max: 12, cues: ['Hands on a sturdy bench, step or couch arm', 'Same straight body line', 'Lower under control', 'Do not let hips sag'] },
      { n: 'Knee push-up', type: 'reps', min: 8, max: 12, cues: ['Knees on a soft surface', 'Straight line from head to knees', 'Chest almost touches floor', 'Elbows about 45°'] },
      { n: 'Push-up', type: 'reps', min: 6, max: 12, cues: ['Hands under shoulders', 'Body rigid like a plank', 'Chest to fist height from floor', 'Press the floor away'] },
      { n: 'Feet-elevated push-up', type: 'reps', min: 6, max: 12, cues: ['Feet on a step or low chair', 'Keep the plank line', 'Lower slowly', 'Stop if lower back arches'] },
    ] },
    pull: { name: 'Pull', levels: [
      { n: 'Prone Y-raise', type: 'reps', min: 8, max: 15, cues: ['Lie face down, arms overhead in a Y, thumbs up', 'Lift arms off floor by squeezing shoulder blades down and back', 'Hold 1 s at top', 'Neck long, look at floor'] },
      { n: 'Door-frame row', type: 'reps', min: 8, max: 15, cues: ['Hold both sides of a solid door frame at chest height', 'Feet close to the frame, lean back with straight arms', 'Pull chest to the frame, squeeze shoulder blades', 'Step feet closer to make it harder'] },
      { n: 'Table row, knees bent', type: 'reps', min: 6, max: 12, cues: ['Lie under a very sturdy table, grip the edge', 'Knees bent, feet flat', 'Pull chest to the edge, body straight from knees to head', 'Test the table first — it must not tip'] },
      { n: 'Table row, legs straight', type: 'reps', min: 6, max: 12, cues: ['Same setup, legs straight, heels on floor', 'Body rigid like a plank', 'Pull chest to the edge', 'Lower slowly'] },
      { n: 'Negative chin-up (bar needed)', type: 'reps', min: 3, max: 6, cues: ['Jump or step up so chin is over the bar', 'Lower as slowly as you can (aim 5 s)', 'Shoulders stay down, away from ears', 'Reset fully each rep'] },
      { n: 'Chin-up (bar needed)', type: 'reps', min: 3, max: 8, cues: ['Palms facing you, shoulder-width', 'Start from a dead hang, shoulders engaged', 'Pull until chin over the bar', 'Lower under control'] },
    ] },
    hinge: { name: 'Hinge', levels: [
      { n: 'Glute bridge', type: 'reps', min: 10, max: 15, cues: ['Lie on back, knees bent, feet flat hip-width', 'Push through heels, lift hips', 'Squeeze glutes at top for 1 s', 'Do not arch the lower back'] },
      { n: 'Glute bridge, 3 s hold', type: 'reps', min: 8, max: 12, cues: ['Same as glute bridge', 'Hold the top for 3 seconds', 'Ribs down', 'Lower slowly'] },
      { n: 'Bodyweight hip hinge', type: 'reps', min: 10, max: 15, cues: ['Hands on hips, soft knees', 'Push hips back, chest forward, back flat', 'Stop when you feel hamstrings stretch', 'Squeeze glutes to stand'] },
      { n: 'Single-leg glute bridge', type: 'each', min: 8, max: 12, cues: ['One foot on floor, other leg up', 'Lift hips level, no tilting', 'Squeeze glute at top', 'Lower slowly'] },
      { n: 'Single-leg RDL, supported', type: 'each', min: 8, max: 12, cues: ['One hand on wall or chair', 'Hinge on one leg, other leg goes back', 'Hips square to floor, back flat', 'Return by squeezing glute'] },
      { n: 'Single-leg RDL', type: 'each', min: 8, max: 12, cues: ['No support', 'Slow and controlled', 'Hips square', 'Reach toward floor only as far as back stays flat'] },
    ] },
    core: { name: 'Core', levels: [
      { n: 'Dead bug', type: 'each', min: 6, max: 10, cues: ['Lie on back, arms up, knees bent 90° above hips', 'Press lower back into the floor', 'Lower opposite arm and leg slowly', 'Breathe out as you lower'] },
      { n: 'Knee plank', type: 'secs', min: 20, max: 40, cues: ['Forearms under shoulders, knees down', 'Straight line from head to knees', 'Squeeze glutes, ribs down', 'Breathe normally'] },
      { n: 'Front plank', type: 'secs', min: 20, max: 45, cues: ['Forearms and toes', 'Body in one straight line', 'Do not let hips sag or pike', 'Stop when form breaks'] },
      { n: 'Side plank, knees', type: 'secs', min: 15, max: 30, cues: ['Lie on side, elbow under shoulder, knees bent', 'Lift hips in line with shoulders and knees', 'Do both sides', 'Breathe'] },
      { n: 'Side plank', type: 'secs', min: 15, max: 30, cues: ['Feet stacked or staggered', 'Hips high, body straight', 'Do both sides', 'Stop when hips drop'] },
      { n: 'Plank shoulder tap', type: 'each', min: 6, max: 12, cues: ['High plank, feet wider than hips', 'Tap opposite shoulder', 'Keep hips still — no rocking', 'Slow is better'] },
    ] },
  };
  const PATTERNS = ['squat', 'push', 'pull', 'hinge', 'core'];
  const SETS = 3;

  // history: sessions oldest-first, each { items: [{ pattern, level, sets:[n..], pain }] }.
  // Rules: pain in last session -> drop a level. Top of range on every set in the
  // last 2 sessions at this level -> go up a level. Otherwise stay.
  function progression(pattern, history, startLevel = 1) {
    const done = history.map(s => s.items.find(i => i.pattern === pattern)).filter(Boolean);
    if (!done.length) return { level: startLevel, reason: 'start' };
    const last = done[done.length - 1];
    const top = LADDERS[pattern].levels.length;
    if (last.pain) return { level: Math.max(1, last.level - 1), reason: 'pain' };
    const spec = LADDERS[pattern].levels[last.level - 1];
    const hitTop = it => it.level === last.level && it.sets.length >= SETS && it.sets.every(r => r >= spec.max);
    const lastTwo = done.slice(-2);
    if (lastTwo.length === 2 && lastTwo.every(hitTop) && last.level < top) return { level: last.level + 1, reason: 'up' };
    return { level: last.level, reason: 'stay' };
  }

  // ---------- weekly review ----------
  // days: { key: { food:[], water, steps } }, weights: {key:kg}, sessions: [{date}]
  function weekReview(endKey, days, weights, sessions) {
    const keys = []; for (let i = 6; i >= 0; i--) keys.push(addDays(endKey, -i));
    const foodDays = keys.filter(k => days[k] && days[k].food && days[k].food.length);
    const kcalAvg = foodDays.length ? Math.round(foodDays.reduce((s, k) => s + sumFood(days[k].food).kcal, 0) / foodDays.length) : null;
    const pAvg = foodDays.length ? Math.round(foodDays.reduce((s, k) => s + sumFood(days[k].food).p, 0) / foodDays.length) : null;
    const stepDays = keys.filter(k => days[k] && days[k].steps > 0);
    const stepsAvg = stepDays.length ? Math.round(stepDays.reduce((s, k) => s + days[k].steps, 0) / stepDays.length) : null;
    const series = trend(weights);
    const at = k => { let v = null; for (const s of series) { if (s.date <= k) v = s.trend; else break; } return v; };
    const t1 = at(endKey), t0 = at(addDays(endKey, -7));
    return {
      from: keys[0], to: endKey, kcalAvg, proteinAvg: pAvg, foodDays: foodDays.length, stepsAvg,
      workouts: sessions.filter(s => s.date >= keys[0] && s.date <= endKey).length,
      trendChange: t1 !== null && t0 !== null ? Math.round((t1 - t0) * 100) / 100 : null,
    };
  }

  // ---------- calendar reminders (.ics) ----------
  // events: [{ title, time:'HH:MM', days:[0..6] or null for daily }]
  function ics(events, startKey) {
    const D = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const ymd = startKey.replace(/-/g, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BodyOS//EN', 'CALSCALE:GREGORIAN'];
    events.forEach((e, i) => {
      const [h, m] = e.time.split(':');
      L.push('BEGIN:VEVENT', 'UID:bodyos-' + i + '-' + ymd + '@bodyos', 'DTSTAMP:' + ymd + 'T000000Z',
        'DTSTART:' + ymd + 'T' + h + m + '00', 'DURATION:PT10M',
        'RRULE:FREQ=' + (e.days ? 'WEEKLY;BYDAY=' + e.days.map(d => D[d]).join(',') : 'DAILY'),
        'SUMMARY:' + e.title.replace(/[,;\\]/g, ' '),
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + e.title.replace(/[,;\\]/g, ' '), 'TRIGGER:PT0M', 'END:VALARM',
        'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.join('\r\n') + '\r\n';
  }

  // Month-by-month roadmap: weight checkpoint from the plan line plus habit focus for that phase.
  const PHASES = [
    { name: 'Foundations', eat: ['Log every meal, even rough guesses', 'Protein at every meal', 'Water goal daily'], move: ['Walk 20–30 min every day', 'Hit your step goal 5 of 7 days'], train: ['2 workouts a week at levels 1–2', 'Learn the form, not the burn'] },
    { name: 'Build the habit', eat: ['Half the plate vegetables at lunch and dinner', 'Plan tomorrow’s food the night before', 'Swap one sugary drink a day for water'], move: ['10 min walk after your two biggest meals', 'Step goal climbs on its own as you hit it'], train: ['Never miss a workout twice in a row', 'Expect your first level-ups'] },
    { name: 'Get stronger', eat: ['Hit the protein target 6 of 7 days', 'Cook at home most days'], move: ['One long walk (45–60 min) each week', 'Take stairs when you can'], train: ['Push each move to the top of its rep range', 'Aim for level 3 on squat and push'] },
    { name: 'Momentum', eat: ['Same calories — the plan updates as you lose', 'Eat out at most twice a week, log it anyway'], move: ['Aim for 10,000 steps a day', 'Add a brisk hill or stairs walk once a week'], train: ['Level up wherever you can', 'Add a 3rd workout day if recovery is good'] },
    { name: 'Final stretch', eat: ['Stay consistent — plateaus of 1–2 weeks are normal', 'Do not cut calories below the plan'], move: ['Keep 10,000 steps', 'Two long walks a week'], train: ['Keep training — it protects muscle while you lose fat'] },
  ];
  const MAINTAIN = { name: 'Maintain', eat: ['Add about 200 kcal a day for 2 weeks, then check the trend', 'Keep high protein and weekly weigh-in average'], move: ['Keep your step habit'], train: ['Keep 2–3 workouts a week and keep climbing levels'] };
  function roadmap(startKey, startKg, goalKg, paceKgMonth) {
    const end = goalDate(startKey, startKg, goalKg, paceKgMonth);
    if (!end) return [];
    const n = Math.max(1, Math.round(daysBetween(startKey, end) / DAYS_PER_MONTH)) // goalDate rounds days up, so ceil would add a stray extra month;
    const out = [];
    for (let i = 1; i <= n; i++) {
      const date = i === n ? end : addDays(startKey, Math.round(i * DAYS_PER_MONTH));
      out.push({ month: i, from: i === 1 ? startKey : out[i - 2].date, date, kg: Math.round(planWeight(startKey, startKg, goalKg, paceKgMonth, date) * 10) / 10, ...PHASES[i === n && n > 1 ? PHASES.length - 1 : Math.min(i - 1, PHASES.length - 2)] }); // last month is always the final stretch
    }
    out.push({ month: n + 1, from: end, date: null, kg: goalKg, ...MAINTAIN });
    return out;
  }

  const api = {
    KCAL_PER_KG, DAYS_PER_MONTH, ACTIVITY, LADDERS, PATTERNS, SETS,
    dayKey, daysBetween, addDays, weekday, bmr, targets, bmi, goalDate, planWeight,
    trend, weeklyRate, streak, nextStepGoal, macroKcal, macroMismatch, sumFood, parseAIFood,
    progression, weekReview, ics, roadmap,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.L = api;
})(this);
