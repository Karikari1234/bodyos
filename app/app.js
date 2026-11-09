/* BodyOS app. State in localStorage, logic in logic.js (window.L). */
'use strict';

// ---------- state ----------
const KEY = 'bodyos.v1';
const DEFAULT = {
  v: 1, profile: null,
  settings: {
    provider: 'gemini', apiKey: '', model: 'gemini-3.5-flash-lite', base: 'https://openrouter.ai/api/v1',
    workoutDays: [1, 4], waterGoal: 8, glassMl: 250, stepGoal: 5000, stepCheck: null,
    remind: { weigh: '07:30', workout: '18:00', water: true },
  },
  days: {}, weights: {}, sessions: [], meals: [], levels: {},
};
let S = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) { if (/^gemini-(3\.8|2\.5)-flash-lite$/.test(s.settings?.model)) s.settings.model = 'gemini-3.5-flash-lite'; return { ...DEFAULT, ...s, settings: { ...DEFAULT.settings, ...s.settings, remind: { ...DEFAULT.settings.remind, ...(s.settings || {}).remind } } }; }
  } catch (e) { /* fall through to fresh state */ }
  return structuredClone(DEFAULT);
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Could not save — storage full? Export your data.'); }
}

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => L.dayKey();
const day = k => (S.days[k] ||= { food: [], water: 0, steps: 0 });
const num = (v, d = 0) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : d; };
const fmtDate = k => new Date(k + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
function openSheet(html) { $('#sheet .sheet-body').innerHTML = `<div class="sheet-top"><button class="sheet-close" aria-label="Close" onclick="closeSheet()">×</button></div>` + html; $('#sheet').hidden = false; $('#sheet .sheet-body').scrollTop = 0; }
function closeSheet() { $('#sheet').hidden = true; }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

function currentKg() {
  const s = L.trend(S.weights);
  return s.length ? s[s.length - 1].kg : S.profile.kg;
}
function trendKg() {
  const s = L.trend(S.weights);
  return s.length ? s[s.length - 1].trend : S.profile.kg;
}
function T() { const p = S.profile; return L.targets({ ...p, kg: trendKg(), paceKgMonth: p.pace }); }
function loggedDays() {
  const k = new Set(Object.keys(S.weights));
  for (const [d, v] of Object.entries(S.days)) if (v.food.length || v.water || v.steps) k.add(d);
  S.sessions.forEach(s => k.add(s.date));
  return [...k];
}
function nextLevel(p) {
  // a manual level choice restarts progression from that point in history
  const o = S.levels[p] || { level: 1, after: 0 };
  return L.progression(p, S.sessions.slice(o.after), o.level);
}
function repLabel(spec) { return spec.type === 'secs' ? `${spec.min}–${spec.max} s` : `${spec.min}–${spec.max} reps${spec.type === 'each' ? ' each side' : ''}`; }

// ---------- routing ----------
let tab = 'home';
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => b.dataset.tab === 'log' ? logSheet() : go(b.dataset.tab));
function go(t) { tab = t; render(); window.scrollTo(0, 0); }
function render() {
  document.body.classList.toggle('dark', tab === 'workout');
  document.body.classList.toggle('workout', tab === 'workout' || !S.profile);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const v = $('#view');
  if (!S.profile) { v.innerHTML = setupView(); return bindSetup(); }
  ({ home: homeView, train: trainView, workout: workoutView, progress: progressView, me: meView })[tab]();
}

// ---------- setup ----------
const PARQ = [
  'Has a doctor ever said you have a heart condition and should only do activity a doctor recommends?',
  'Do you feel pain in your chest during physical activity?',
  'In the past month, have you had chest pain when not doing physical activity?',
  'Do you lose balance because of dizziness, or have you ever lost consciousness?',
  'Do you have a bone or joint problem that could be made worse by activity?',
  'Is a doctor currently prescribing drugs for your blood pressure or a heart condition?',
  'Do you know of any other reason you should not do physical activity?',
];
function setupView(edit) {
  const p = S.profile || { sex: 'm', age: '', cm: '', kg: '', goalKg: '', activity: 'light', pace: 2.5 };
  const chip = (name, val, label) => `<button type="button" class="chip ${p[name] == val ? 'on' : ''}" data-chip="${name}" data-val="${val}">${label}</button>`;
  return `<h1>${edit ? 'Edit profile' : 'Welcome to BodyOS'}</h1>
  <p class="muted">${edit ? 'Targets update from these numbers.' : 'A few numbers to build your plan. Stored only on this phone.'}</p>
  <form id="setup" class="card">
    <label>Sex (for the calorie formula)</label><div class="chips">${chip('sex', 'm', 'Male')}${chip('sex', 'f', 'Female')}</div>
    <div class="grid2">
      <div><label>Age</label><input name="age" inputmode="numeric" value="${esc(p.age)}" required></div>
      <div><label>Height (cm)</label><input name="cm" inputmode="decimal" value="${esc(p.cm)}" required></div>
      <div><label>Weight now (kg)</label><input name="kg" inputmode="decimal" value="${esc(p.kg)}" required ${edit ? 'disabled' : ''}></div>
      <div><label>Goal weight (kg)</label><input name="goalKg" inputmode="decimal" value="${esc(p.goalKg)}" required></div>
    </div>
    <label>Daily activity outside workouts</label>
    <div class="chips">${chip('activity', 'sedentary', 'Desk, little walking')}${chip('activity', 'light', 'Some walking')}${chip('activity', 'moderate', 'On feet a lot')}${chip('activity', 'active', 'Physical job')}</div>
    <label>Pace (kg per month)</label><div class="chips">${chip('pace', 2, '2')}${chip('pace', 2.5, '2.5')}${chip('pace', 3, '3')}</div>
    ${edit ? '' : `<h3 style="margin-top:18px">Safety check (PAR-Q)</h3>
    ${PARQ.map((q, i) => `<label style="display:flex;gap:10px;color:var(--ink)"><input type="checkbox" name="q${i}" style="width:auto"> ${q}</label>`).join('')}`}
    <p id="setupErr" class="bad small"></p>
    <button class="btn orange">${edit ? 'Save' : 'Build my plan'}</button>
    ${edit ? '<button type="button" class="btn ghost" style="margin-top:8px" id="cancelEdit">Cancel</button>' : ''}
  </form>`;
}
function bindSetup(edit) {
  const f = $('#setup');
  const sel = { sex: null, activity: null, pace: null };
  f.querySelectorAll('[data-chip]').forEach(c => {
    if (c.classList.contains('on')) sel[c.dataset.chip] = c.dataset.val;
    c.onclick = () => { f.querySelectorAll(`[data-chip="${c.dataset.chip}"]`).forEach(x => x.classList.remove('on')); c.classList.add('on'); sel[c.dataset.chip] = c.dataset.val; };
  });
  if ($('#cancelEdit')) $('#cancelEdit').onclick = () => go('me');
  f.onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const age = num(d.age), cm = num(d.cm), goalKg = num(d.goalKg), kg = edit ? S.profile.kg : num(d.kg);
    const err = !(age >= 18 && age <= 90) ? 'Age must be 18–90 (formulas are for adults).'
      : !(cm >= 120 && cm <= 230) ? 'Height looks wrong (cm).'
      : !(kg >= 35 && kg <= 300) ? 'Weight looks wrong (kg).'
      : !(goalKg >= 35 && goalKg <= 300) ? 'Goal weight looks wrong (kg).'
      : goalKg >= (edit ? trendKg() : kg) ? 'Goal must be below your current weight.'
      : L.bmi(goalKg, cm) < 18.5 ? `Goal is underweight for your height (BMI ${L.bmi(goalKg, cm).toFixed(1)}). Pick at least ${Math.ceil(18.5 * (cm / 100) ** 2)} kg.`
      : '';
    if (err) { $('#setupErr').textContent = err; return; }
    const p = { sex: sel.sex, age, cm, goalKg, activity: sel.activity, pace: num(sel.pace) };
    if (edit) { Object.assign(S.profile, p); save(); toast('Profile saved'); return go('me'); }
    const t = today();
    S.profile = { ...p, kg, start: t, startKg: kg, parq: PARQ.map((_, i) => !!d['q' + i]) };
    S.weights[t] = kg;
    save();
    const t2 = T();
    tab = 'home'; render();
    openSheet(`<h2>Your plan</h2>
      ${S.profile.parq.some(Boolean) ? '<div class="card bad">You answered yes to a safety question. Please talk to a doctor before starting exercise. You can still track food and weight.</div>' : ''}
      <div class="card"><div class="big">${t2.kcal} kcal</div><p class="muted small">per day. Maintenance ≈ ${t2.tdee} kcal (Mifflin-St Jeor × activity).</p>
      <p>Protein ${t2.protein} g · Carbs ${t2.carbs} g · Fat ${t2.fat} g</p>
      <p>Pace ${t2.pace} kg/month${t2.limited ? ' <span class="warn">(slowed to stay safe)</span>' : ''}. Goal around <b>${fmtDate(L.goalDate(t, kg, goalKg, t2.pace) || t)}</b>.</p></div>
      <div class="card"><p>Water ${S.settings.waterGoal} glasses · ${S.settings.stepGoal} steps · workouts Mon & Thu.</p></div>
      <button class="btn orange" onclick="closeSheet()">Start</button>`);
  };
}

// ---------- home ----------
function checkStepGoal() {
  const t = today();
  if (S.settings.stepCheck === t) return;
  S.settings.stepCheck = t;
  const last7 = []; for (let i = 7; i >= 1; i--) { const d = S.days[L.addDays(t, -i)]; if (d && d.steps > 0) last7.push(d.steps); }
  const g = L.nextStepGoal(S.settings.stepGoal, last7);
  if (g !== S.settings.stepGoal) { S.settings.stepGoal = g; toast(`Step goal up to ${g} — nice work`); }
  save();
}
function homeView() {
  checkStepGoal();
  const t = today(), d = day(t), tg = T(), sum = L.sumFood(d.food);
  const left = tg.kcal - Math.round(sum.kcal);
  const bar = (v, max) => `<div class="bar"><i class="${v > max * 1.05 ? 'over' : ''}" style="width:${Math.min(100, v / max * 100)}%"></i></div>`;
  const isWorkoutDay = S.settings.workoutDays.includes(L.weekday(t));
  const doneToday = S.sessions.some(s => s.date === t);
  const st = L.streak(loggedDays(), t);
  $('#view').innerHTML = `
  <div class="row between"><h1>Today</h1><span class="pill">${st} day streak</span></div>
  <p class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
  <div class="card">
    <div class="row between"><div><div class="big">${Math.abs(left)}</div><div class="muted small">kcal ${left >= 0 ? 'left' : 'over'} of ${tg.kcal}</div></div>
    <button class="btn sm orange" id="addFood">Add food</button></div>
    <div style="margin-top:14px" class="small">
      <div class="row between"><span>Protein</span><span>${Math.round(sum.p)} / ${tg.protein} g</span></div>${bar(sum.p, tg.protein)}
      <div class="row between" style="margin-top:8px"><span>Carbs</span><span>${Math.round(sum.c)} / ${tg.carbs} g</span></div>${bar(sum.c, tg.carbs)}
      <div class="row between" style="margin-top:8px"><span>Fat</span><span>${Math.round(sum.f)} / ${tg.fat} g</span></div>${bar(sum.f, tg.fat)}
    </div>
  </div>
  <div class="card">
    <div class="row between"><h2>Water</h2><span class="muted small">${d.water} / ${S.settings.waterGoal} × ${S.settings.glassMl} ml</span></div>
    <div class="glasses">${Array.from({ length: Math.max(S.settings.waterGoal, d.water) }, (_, i) => `<div class="glass ${i < d.water ? 'on' : ''}"></div>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="btn sm ghost" id="wMinus">−1</button><button class="btn sm" id="wPlus">+1 glass</button></div>
  </div>
  <div class="grid2">
    <div class="card" id="stepsCard" style="margin:0"><div class="muted small">Steps</div><div class="big">${d.steps || '—'}</div>${bar(d.steps, S.settings.stepGoal)}<div class="muted small" style="margin-top:6px">goal ${S.settings.stepGoal}</div></div>
    <div class="card" id="weightCard" style="margin:0"><div class="muted small">Weight</div><div class="big">${S.weights[t] ?? '—'}</div><div class="muted small" style="margin-top:6px">trend ${trendKg().toFixed(1)} kg</div></div>
  </div>
  <div class="card" id="sleepCard"><div class="row between"><h2>Sleep &amp; mood</h2><span class="muted small">${d.sleep ? `${d.sleep.bed} → ${d.sleep.wake}` : 'tap to log'}</span></div>
    ${d.sleep ? `<div class="big">${L.sleepHours(d.sleep.bed, d.sleep.wake)} h</div><div class="muted small">mood ${d.sleep.mood} / 5</div>` : ''}</div>
  ${isWorkoutDay || doneToday ? `<div class="card"><div class="row between"><div><h2>${doneToday ? 'Workout done ✓' : 'Workout day'}</h2><p class="muted small" style="margin:0">5 moves · 3 sets · ~25 min</p></div>${doneToday ? '' : '<button class="btn sm orange" id="startW">Start</button>'}</div></div>` : ''}
  <div class="card"><h2>Food today</h2><div class="list">${d.food.length ? d.food.map(foodRow).join('') : '<p class="muted small">Nothing yet.</p>'}</div></div>`;
  $('#addFood').onclick = foodSheet;
  $('#wPlus').onclick = () => { d.water++; save(); render(); };
  $('#wMinus').onclick = () => { d.water = Math.max(0, d.water - 1); save(); render(); };
  $('#stepsCard').onclick = stepsSheet;
  $('#weightCard').onclick = weightSheet;
  $('#sleepCard').onclick = sleepSheet;
  if ($('#startW')) $('#startW').onclick = startWorkout;
  bindFoodRows(t);
}
function foodRow(i) {
  return `<div class="row between"><div><div>${esc(i.name)}</div><div class="muted small">${Math.round(i.kcal)} kcal · P ${Math.round(i.p)} · C ${Math.round(i.c)} · F ${Math.round(i.f)}${i.ai ? ' · AI' : ''}</div></div><button class="x" data-del="${i.id}" aria-label="Delete">×</button></div>`;
}
function bindFoodRows(k) {
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (!confirm('Delete this food?')) return;
    day(k).food = day(k).food.filter(i => i.id !== b.dataset.del); save(); render();
  });
}

// ---------- log sheets ----------
function logSheet() {
  openSheet(`<h2>Log</h2><div class="grid2">
    <button class="btn" id="lFood">Food</button><button class="btn" id="lWeight">Weight</button>
    <button class="btn" id="lWater">+1 water</button><button class="btn" id="lSteps">Steps</button>
    <button class="btn" id="lSleep">Sleep &amp; mood</button></div>`);
  $('#lFood').onclick = foodSheet; $('#lWeight').onclick = weightSheet; $('#lSteps').onclick = stepsSheet; $('#lSleep').onclick = sleepSheet;
  $('#lWater').onclick = () => { day(today()).water++; save(); closeSheet(); render(); toast('Water logged'); };
}
function weightSheet() {
  openSheet(`<h2>Weight</h2><p class="muted small">Weigh in the morning, after the toilet, before food. The trend line smooths daily water swings.</p>
    <label>Date</label><input type="date" id="wDate" value="${today()}" max="${today()}">
    <label>kg</label><input id="wKg" inputmode="decimal" placeholder="${currentKg()}">
    <p id="wErr" class="bad small"></p><button class="btn orange" id="wSave">Save</button>
    ${Object.keys(S.weights).length ? '<button class="btn ghost" style="margin-top:8px" id="wDel">Delete entry for this date</button>' : ''}`);
  $('#wSave').onclick = () => {
    const kg = num($('#wKg').value), k = $('#wDate').value;
    if (!(kg >= 35 && kg <= 300)) return $('#wErr').textContent = 'Enter a weight between 35 and 300 kg.';
    if (!k || k > today()) return $('#wErr').textContent = 'Pick a date up to today.';
    const prev = currentKg();
    if (Math.abs(kg - prev) > 5 && !confirm(`${kg} kg is ${Math.abs(kg - prev).toFixed(1)} kg from your last entry. Save anyway?`)) return;
    S.weights[k] = Math.round(kg * 10) / 10; save(); closeSheet(); render(); toast('Weight saved');
  };
  if ($('#wDel')) $('#wDel').onclick = () => {
    const k = $('#wDate').value;
    if (!(k in S.weights)) return $('#wErr').textContent = 'No entry on that date.';
    if (Object.keys(S.weights).length === 1) return $('#wErr').textContent = 'Keep at least one weight.';
    delete S.weights[k]; save(); closeSheet(); render(); toast('Deleted');
  };
}
function sleepSheet() {
  const s = day(today()).sleep || { bed: '23:00', wake: '07:00', mood: 3 };
  openSheet(`<h2>Sleep &amp; mood</h2><p class="muted small">Log the night that ended on the wake-up date.</p>
    <label>Wake-up date</label><input type="date" id="slDate" value="${today()}" max="${today()}">
    <div class="grid2"><div><label>Sleep time</label><input type="time" id="slBed" value="${s.bed}"></div><div><label>Wake time</label><input type="time" id="slWake" value="${s.wake}"></div></div>
    <label>Mood (1 = low, 5 = great)</label><div class="row" id="slMood">${[1, 2, 3, 4, 5].map(n => `<button class="btn sm ${n === s.mood ? 'orange' : 'ghost'}" data-m="${n}" aria-pressed="${n === s.mood}">${n}</button>`).join('')}</div>
    <p id="slErr" class="bad small"></p><button class="btn orange" id="slSave">Save</button>`);
  let mood = s.mood;
  document.querySelectorAll('#slMood [data-m]').forEach(b => b.onclick = () => {
    mood = +b.dataset.m;
    document.querySelectorAll('#slMood [data-m]').forEach(x => { const on = +x.dataset.m === mood; x.className = `btn sm ${on ? 'orange' : 'ghost'}`; x.setAttribute('aria-pressed', on); });
  });
  $('#slSave').onclick = () => {
    const k = $('#slDate').value, bed = $('#slBed').value, wake = $('#slWake').value;
    if (!k || k > today()) return $('#slErr').textContent = 'Pick a date up to today.';
    if (!bed || !wake) return $('#slErr').textContent = 'Enter sleep and wake times.';
    day(k).sleep = { bed, wake, mood }; save(); closeSheet(); render(); toast(`Sleep saved: ${L.sleepHours(bed, wake)} h`);
  };
}
function stepsSheet() {
  openSheet(`<h2>Steps today</h2><p class="muted small">Copy the number from the Health app or your watch.</p>
    <input id="sN" inputmode="numeric" value="${day(today()).steps || ''}"><p id="sErr" class="bad small"></p>
    <button class="btn orange" id="sSave">Save</button>`);
  $('#sSave').onclick = () => {
    const n = Math.round(num($('#sN').value, -1));
    if (!(n >= 0 && n <= 100000)) return $('#sErr').textContent = 'Enter 0–100000.';
    day(today()).steps = n; save(); closeSheet(); render();
  };
}
function foodSheet() {
  openSheet(`<h2>Add food</h2>
    <button class="btn orange" id="fPhoto">Photo → AI estimate</button>
    <input type="file" accept="image/*" capture="environment" id="fFile" hidden>
    ${S.meals.length ? `<h3 style="margin-top:16px">Saved meals</h3><div class="chips">${S.meals.map((m, i) => `<button class="chip" data-meal="${i}">${esc(m.name)} · ${m.kcal}</button>`).join('')}</div>` : ''}
    <h3 style="margin-top:16px">Enter by hand</h3>${manualForm({})}`);
  $('#fPhoto').onclick = () => S.settings.apiKey || S.settings.provider === 'openai' ? $('#fFile').click() : toast('Add an AI key in Me → Food AI first');
  $('#fFile').onchange = e => e.target.files[0] && aiFlow(e.target.files[0]);
  document.querySelectorAll('[data-meal]').forEach(b => b.onclick = () => { const m = S.meals[b.dataset.meal]; addFood([{ ...m }]); });
  bindManual();
}
function manualForm(i) {
  return `<form id="mf"><label>Name</label><input name="name" value="${esc(i.name || '')}" required>
    <div class="grid2"><div><label>kcal</label><input name="kcal" inputmode="decimal" value="${i.kcal ?? ''}"></div>
    <div><label>Protein g</label><input name="p" inputmode="decimal" value="${i.p ?? ''}"></div>
    <div><label>Carbs g</label><input name="c" inputmode="decimal" value="${i.c ?? ''}"></div>
    <div><label>Fat g</label><input name="f" inputmode="decimal" value="${i.f ?? ''}"></div></div>
    <p class="muted small">Leave kcal empty to compute it from macros (4/4/9).</p>
    <label style="display:flex;gap:10px;color:var(--ink)"><input type="checkbox" name="keep" style="width:auto"> Save as a meal for next time</label>
    <p id="mErr" class="bad small"></p><button class="btn">Add</button></form>`;
}
function bindManual() {
  $('#mf').onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const p = num(d.p), c = num(d.c), f = num(d.f);
    let kcal = d.kcal.trim() ? num(d.kcal, -1) : L.macroKcal(p, c, f);
    if ([p, c, f, kcal].some(v => v < 0 || v > 5000)) return $('#mErr').textContent = 'Values must be 0–5000.';
    if (!kcal) return $('#mErr').textContent = 'Enter kcal or macros.';
    if (L.macroMismatch(kcal, p, c, f) && (p || c || f) && !confirm(`Macros add up to ${Math.round(L.macroKcal(p, c, f))} kcal, not ${kcal}. Save anyway?`)) return;
    const item = { name: d.name.trim().slice(0, 60), kcal: Math.round(kcal), p, c, f };
    if (d.keep) { S.meals = S.meals.filter(m => m.name !== item.name); S.meals.unshift(item); S.meals.length = Math.min(S.meals.length, 30); }
    addFood([item]);
  };
}
function addFood(items) {
  const d = day(today());
  items.forEach(i => d.food.push({ id: uid(), name: i.name, kcal: i.kcal, p: i.p, c: i.c, f: i.f, ai: !!i.ai, t: Date.now() }));
  save(); closeSheet(); render(); toast(items.length > 1 ? `${items.length} foods added` : 'Food added');
}

// ---------- food AI ----------
const AI_PROMPT = `You are a careful nutrition estimator. Identify each distinct food or drink in the photo and estimate the portion in grams and its nutrition.
Use standard food composition values (USDA FoodData Central style). Count visible cooking oil, butter and sauces. If unsure, say so with confidence "low" rather than guessing wildly.
List each food once. If there are several of the same food (e.g. 2 eggs), use ONE item named with the count ("2 boiled eggs") whose grams and nutrition are the total for all of them. Never repeat an item.
Reply with JSON only, no other text:
{"items":[{"name":"string","grams":number,"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number}],"confidence":"low|medium|high","notes":"short string"}`;

function imageToJpeg(file, max = 1024) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => rej(new Error('Could not read that image'));
    img.src = url;
  });
}
async function callAI(dataUrl, hint) {
  const st = S.settings, text = AI_PROMPT + (hint ? `\nUser note: ${hint}` : '');
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 90000);
  try {
    let r, j;
    if (st.provider === 'gemini') {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(st.model)}:generateContent`, {
        method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': st.apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text }, { inline_data: { mime_type: 'image/jpeg', data: dataUrl.split(',')[1] } }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
      });
      j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || `HTTP ${r.status}`);
      return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    }
    r = await fetch(st.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', ...(st.apiKey ? { Authorization: 'Bearer ' + st.apiKey } : {}) },
      // shortcut: Ollama detected by its default port; thinking makes small local models take minutes
      body: JSON.stringify({ model: st.model, temperature: 0.2, ...(/:11434\b/.test(st.base) ? { reasoning_effort: 'none' } : {}), messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: dataUrl } }] }] }),
    });
    j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || `HTTP ${r.status}`);
    return j.choices?.[0]?.message?.content || '';
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'AI took too long (90 s)' : e.message === 'Failed to fetch' || e.message === 'Load failed' ? 'Network error — check connection, URL and CORS' : e.message);
  } finally { clearTimeout(to); }
}
async function aiFlow(file) {
  let dataUrl;
  try { dataUrl = await imageToJpeg(file); } catch (e) { return toast(e.message); }
  openSheet(`<h2>Food photo</h2><img class="photo-prev" src="${dataUrl}" alt="">
    <label>Note for the AI (optional)</label><input id="aiHint" placeholder="e.g. fried in oil, 2 rotis, large plate">
    <button class="btn orange" style="margin-top:12px" id="aiGo">Estimate</button><div id="aiOut"></div>`);
  $('#aiGo').onclick = async () => {
    $('#aiGo').disabled = true; $('#aiGo').textContent = 'Asking AI…'; $('#aiOut').innerHTML = '';
    try {
      const r = L.parseAIFood(await callAI(dataUrl, $('#aiHint').value.trim()));
      aiReview(r);
    } catch (e) {
      $('#aiOut').innerHTML = `<p class="bad small">${esc(e.message)}</p>`;
      $('#aiGo').disabled = false; $('#aiGo').textContent = 'Try again';
    }
  };
}
function aiReview(r) {
  $('#aiGo').remove();
  $('#aiOut').innerHTML = `<p class="small">Confidence: <b class="${r.confidence === 'low' ? 'warn' : ''}">${r.confidence}</b>${r.notes ? ' · ' + esc(r.notes) : ''}</p>
    <p class="muted small">AI estimates can be off by 20–30%. Check portions and edit before saving.</p>
    <div id="aiItems">${r.items.map((i, n) => `<div class="card" data-i="${n}" style="padding:12px">
      <div class="row between"><input data-k="name" value="${esc(i.name)}" style="flex:1"><label style="display:flex;gap:6px;margin:0;color:var(--ink)"><input type="checkbox" data-k="on" checked style="width:auto">Keep</label></div>
      <div class="grid2" style="grid-template-columns:repeat(5,1fr);gap:6px;margin-top:6px">
        ${[['grams', 'g'], ['kcal', 'kcal'], ['p', 'P'], ['c', 'C'], ['f', 'F']].map(([k, l]) => `<div><label style="margin:0 0 2px">${l}</label><input data-k="${k}" inputmode="decimal" value="${i[k]}" style="padding:8px"></div>`).join('')}
      </div>${i.mismatch ? '<p class="warn small">kcal and macros disagree — check.</p>' : ''}</div>`).join('')}</div>
    <button class="btn orange" id="aiSave">Add to today</button>`;
  // scaling grams scales the whole item proportionally
  document.querySelectorAll('#aiItems [data-i]').forEach(card => {
    const base = r.items[card.dataset.i];
    card.querySelector('[data-k="grams"]').oninput = e => {
      const g = num(e.target.value); if (!base.grams || !(g > 0)) return;
      const k = g / base.grams;
      ['kcal', 'p', 'c', 'f'].forEach(f => card.querySelector(`[data-k="${f}"]`).value = Math.round(base[f] * k));
    };
  });
  $('#aiSave').onclick = () => {
    const items = [...document.querySelectorAll('#aiItems [data-i]')].filter(c => c.querySelector('[data-k="on"]').checked).map(c => {
      const g = k => num(c.querySelector(`[data-k="${k}"]`).value);
      return { name: c.querySelector('[data-k="name"]').value.trim().slice(0, 60) || 'Food', kcal: Math.round(Math.min(5000, Math.max(0, g('kcal')))), p: Math.max(0, g('p')), c: Math.max(0, g('c')), f: Math.max(0, g('f')), ai: true };
    });
    if (!items.length) return toast('Nothing selected');
    addFood(items);
  };
}

// ---------- train ----------
function trainView() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  $('#view').innerHTML = `<h1>Train</h1><p class="muted">Full body · ${S.settings.workoutDays.map(d => days[d]).join(' & ')} · 3 sets each · rest 60–90 s</p>
  ${S.profile.parq && S.profile.parq.some(Boolean) ? '<div class="card bad small">You flagged a safety question. Get a doctor’s OK before training.</div>' : ''}
  <button class="btn orange" id="startW">Start workout</button>
  ${L.PATTERNS.map(p => {
    const nl = nextLevel(p), lv = L.LADDERS[p].levels[nl.level - 1];
    return `<div class="card" data-learn="${p}"><div class="row between"><div><div class="muted small">${L.LADDERS[p].name} · level ${nl.level}/6</div><h2 style="margin:2px 0">${esc(lv.n)}</h2><div class="small">${SETS()} × ${repLabel(lv)}</div>
      ${nl.reason === 'up' ? '<span class="pill">Level up!</span>' : nl.reason === 'pain' ? '<span class="pill">Eased off</span>' : ''}</div><div style="width:120px;flex:none">${figure(p, nl.level)}</div></div></div>`;
  }).join('')}
  <div class="card small"><h3>How you level up</h3><p class="muted" style="margin:0">Hit the top of the range on all 3 sets in two workouts in a row → next level. Felt pain (not muscle burn) → drop a level. Warm up first: 2 min marching on the spot + 10 arm circles.</p></div>
  <div class="card"><h2>History</h2><div class="list">${S.sessions.slice(-8).reverse().map(s => `<div><b>${fmtDate(s.date)}</b><div class="muted small">${s.items.map(i => `${L.LADDERS[i.pattern].levels[i.level - 1].n} ${i.sets.join('/')}${i.pain ? ' ⚠︎' : ''}`).join(' · ')}</div></div>`).join('') || '<p class="muted small">No workouts yet.</p>'}</div></div>`;
  $('#startW').onclick = startWorkout;
  document.querySelectorAll('[data-learn]').forEach(c => c.onclick = () => learnSheet(c.dataset.learn));
}
function SETS() { return L.SETS; }
function learnSheet(p) {
  const nl = nextLevel(p);
  openSheet(`<h2>${L.LADDERS[p].name} ladder</h2>${L.LADDERS[p].levels.map((l, i) => `<div class="card" style="${i + 1 === nl.level ? 'outline:2px solid var(--orange-d)' : ''}">
    <div class="muted small">Level ${i + 1} · ${repLabel(l)}</div><h3>${esc(l.n)}</h3>${figure(p, i + 1)}<ol class="small" style="margin:0;padding-left:18px">${l.cues.map(c => `<li>${esc(c)}</li>`).join('')}</ol>
    ${i + 1 !== nl.level ? `<button class="btn sm ghost" style="margin-top:8px" data-set="${i + 1}">Use this level</button>` : ''}</div>`).join('')}`);
  document.querySelectorAll('[data-set]').forEach(b => b.onclick = () => {
    const lv = +b.dataset.set;
    S.levels[p] = { level: lv, after: S.sessions.length };
    save(); closeSheet(); render(); toast(`${L.LADDERS[p].name}: level ${lv}`);
  });
}

// ---------- workout ----------
let W = null;
function startWorkout() {
  W = { items: L.PATTERNS.map(p => { const l = nextLevel(p).level; return { pattern: p, level: l, sets: [], pain: false }; }), i: 0, rest: null };
  W.cur = L.LADDERS[W.items[0].pattern].levels[W.items[0].level - 1].min;
  go('workout');
}
function workoutView() {
  if (!W) return go('train');
  const it = W.items[W.i], spec = L.LADDERS[it.pattern].levels[it.level - 1];
  const step = spec.type === 'secs' ? 5 : 1;
  if (W.rest) {
    const left = Math.max(0, Math.ceil((W.rest - Date.now()) / 1000));
    $('#view').innerHTML = `<p class="muted" style="margin-top:24px">Rest</p><div class="timer" id="tm">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</div>
      <p class="muted" style="text-align:center">Next: ${esc(spec.n)} · set ${it.sets.length + 1} of ${L.SETS}</p>
      <div class="row"><button class="btn ghost" id="add15">+15 s</button><button class="btn orange" id="skip">Go</button></div>
      <div class="row" style="margin-top:10px">${it.sets.length ? '<button class="btn ghost" id="undo">Undo last set</button>' : ''}<button class="btn ghost" id="quit">End workout</button></div>`;
    if ($('#undo')) $('#undo').onclick = () => { W.cur = it.sets.pop(); W.rest = null; render(); };
    $('#quit').onclick = quitWorkout;
    $('#add15').onclick = () => { W.rest += 15000; render(); };
    $('#skip').onclick = () => { W.rest = null; render(); };
    clearTimeout(W.tick); W.tick = setTimeout(() => { if (tab === 'workout' && W && W.rest) { if (Date.now() >= W.rest) { W.rest = null; navigator.vibrate && navigator.vibrate(300); } render(); } }, 500);
    return;
  }
  $('#view').innerHTML = `<div class="row between" style="margin-top:18px"><span class="muted small">Move ${W.i + 1} of ${W.items.length} · level ${it.level}</span><button class="btn sm ghost" id="quit">End workout</button></div>
    <h1>${esc(spec.n)}</h1><p class="muted">Set ${it.sets.length + 1} of ${L.SETS} · target ${repLabel(spec)}</p>
    ${figure(it.pattern, it.level)}
    <div class="card"><ol class="small" style="margin:0;padding-left:18px">${spec.cues.map(c => `<li>${esc(c)}</li>`).join('')}</ol></div>
    <p class="muted small" style="text-align:center">${spec.type === 'secs' ? 'Seconds held' : spec.type === 'each' ? 'Reps per side' : 'Reps done'} (good form only)</p>
    <div class="stepper"><button id="dn">−</button><span id="cv">${W.cur}</span><button id="up">+</button></div>
    <label style="display:flex;gap:10px;color:#F3EEE8;margin:18px 0"><input type="checkbox" id="pain" ${it.pain ? 'checked' : ''} style="width:auto"> Sharp or joint pain (not muscle burn) — stop this move</label>
    <button class="btn orange" id="done">Set done</button>
    ${it.sets.length ? `<p class="muted small" style="text-align:center">Done: ${it.sets.join(' / ')} · <a href="#" id="undo" style="color:inherit">undo last</a></p>` : ''}`;
  if ($('#undo')) $('#undo').onclick = e => { e.preventDefault(); W.cur = it.sets.pop(); render(); };
  $('#dn').onclick = () => { W.cur = Math.max(0, W.cur - step); $('#cv').textContent = W.cur; };
  $('#up').onclick = () => { W.cur = Math.min(300, W.cur + step); $('#cv').textContent = W.cur; };
  $('#quit').onclick = quitWorkout;
  $('#pain').onchange = e => { it.pain = e.target.checked; };
  $('#done').onclick = () => {
    if (it.pain) { nextMove(); return; }
    it.sets.push(W.cur);
    if (it.sets.length >= L.SETS) nextMove(); else { W.rest = Date.now() + 75000; render(); }
  };
}
function quitWorkout() { if (confirm(W.items.some(i => i.sets.length) ? 'End workout and save sets done so far?' : 'Leave workout?')) finishWorkout(); }
function nextMove() {
  if (W.i + 1 >= W.items.length) return finishWorkout();
  W.i++;
  const it = W.items[W.i];
  W.cur = L.LADDERS[it.pattern].levels[it.level - 1].min;
  W.rest = Date.now() + 90000; render();
}
function finishWorkout() {
  clearTimeout(W.tick);
  const items = W.items.filter(i => i.sets.length || i.pain);
  if (items.length) {
    S.sessions.push({ date: today(), items: items.map(({ pattern, level, sets, pain }) => ({ pattern, level, sets, pain })) });
    save(); toast('Workout saved');
  }
  W = null; go('train');
}

// ---------- progress ----------
function chart() {
  const p = S.profile, series = L.trend(S.weights);
  if (!series.length) return '';
  const end = today(), start = series[0].date < L.addDays(end, -90) ? L.addDays(end, -90) : series[0].date;
  const pts = series.filter(s => s.date >= start);
  const span = Math.max(7, L.daysBetween(start, end));
  const plan = [start, end].map(k => L.planWeight(p.start, p.startKg, p.goalKg, p.pace, k < p.start ? p.start : k));
  const vals = pts.flatMap(s => [s.kg, s.trend]).concat(plan);
  const lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
  const W_ = 340, H = 180, x = k => 30 + L.daysBetween(start, k) / span * (W_ - 40), y = v => 10 + (hi - v) / (hi - lo) * (H - 30);
  const ps = p.start < start ? start : p.start;
  return `<svg viewBox="0 0 ${W_} ${H}" width="100%" role="img" aria-label="Weight chart">
    ${[lo, (lo + hi) / 2, hi].map(v => `<text x="0" y="${y(v) + 4}" font-size="10" fill="#7A746D">${v.toFixed(0)}</text><line x1="30" x2="${W_ - 10}" y1="${y(v)}" y2="${y(v)}" stroke="#E7E1DA"/>`).join('')}
    <line x1="${x(ps)}" y1="${y(L.planWeight(p.start, p.startKg, p.goalKg, p.pace, ps))}" x2="${x(end)}" y2="${y(L.planWeight(p.start, p.startKg, p.goalKg, p.pace, end))}" stroke="#7A746D" stroke-dasharray="4 4"/>
    ${pts.map(s => `<circle cx="${x(s.date)}" cy="${y(s.kg)}" r="2.5" fill="#F79A63" opacity=".6"/>`).join('')}
    <polyline fill="none" stroke="#EE7A3C" stroke-width="2.5" points="${pts.map(s => x(s.date) + ',' + y(s.trend)).join(' ')}"/>
    <text x="30" y="${H - 4}" font-size="10" fill="#7A746D">${fmtDate(start)}</text><text x="${W_ - 10}" y="${H - 4}" font-size="10" fill="#7A746D" text-anchor="end">${fmtDate(end)}</text>
  </svg><p class="muted small">Dots: scale · line: trend · dashed: plan (${p.pace} kg/month)</p>`;
}
function progressView() {
  const p = S.profile, series = L.trend(S.weights), t = today();
  const rate = L.weeklyRate(series), tk = trendKg();
  const lost = Math.round((p.startKg - tk) * 10) / 10;
  const est = rate !== null && rate < 0 ? L.goalDate(t, tk, p.goalKg, -rate * L.DAYS_PER_MONTH / 7) : null;
  const wr = L.weekReview(t, S.days, S.weights, S.sessions), tg = T();
  $('#view').innerHTML = `<h1>Progress</h1>
  <div class="card"><div class="row between"><div><div class="big">${tk.toFixed(1)} kg</div><div class="muted small">trend · goal ${p.goalKg} kg</div></div>
    <div style="text-align:right"><div class="big ${lost > 0 ? 'good' : ''}">${lost > 0 ? '−' : '+'}${Math.abs(lost).toFixed(1)}</div><div class="muted small">since ${fmtDate(p.start)}</div></div></div>
    <div class="bar" style="margin-top:12px"><i style="width:${Math.max(0, Math.min(100, (p.startKg - tk) / (p.startKg - p.goalKg) * 100))}%"></i></div>
    ${chart()}
    <p class="small">${rate === null ? 'Log weight for 7+ days to see your real pace.' : `Real pace: <b>${rate > 0 ? '+' : ''}${rate} kg/week</b>${rate > 0.05 ? ' (gaining)' : ''}. ${est ? `At this pace: goal around <b>${fmtDate(est)}</b>.` : ''}`}
    ${rate !== null && rate < -(p.startKg * 0.01) ? '<br><span class="warn">Losing faster than 1% body weight per week — consider eating a bit more.</span>' : ''}</p></div>
  ${roadmapCard(p, t, tk)}
  <div class="card"><h2>Last 7 days</h2>
    <div class="list small">
      <div class="row between"><span>Average kcal</span><b>${wr.kcalAvg ?? '—'} ${wr.kcalAvg ? `/ ${tg.kcal}` : ''}</b></div>
      <div class="row between"><span>Average protein</span><b>${wr.proteinAvg ?? '—'} ${wr.proteinAvg !== null ? `/ ${tg.protein} g` : ''}</b></div>
      <div class="row between"><span>Days food logged</span><b>${wr.foodDays} / 7</b></div>
      <div class="row between"><span>Average steps</span><b>${wr.stepsAvg ?? '—'}</b></div>
      <div class="row between"><span>Workouts</span><b>${wr.workouts} / ${S.settings.workoutDays.length}</b></div>
      <div class="row between"><span>Trend change</span><b>${wr.trendChange === null ? '—' : (wr.trendChange > 0 ? '+' : '') + wr.trendChange + ' kg'}</b></div>
    </div>
    <p class="small muted">${reviewTip(wr, tg)}</p></div>
  <div class="card"><h2>Weigh-ins</h2><div class="list small">${series.slice(-10).reverse().map(s => `<div class="row between"><span>${fmtDate(s.date)}</span><span>${s.kg} kg <span class="muted">· trend ${s.trend.toFixed(1)}</span></span></div>`).join('')}</div></div>`;
}
function roadmapCard(p, t, tk) {
  const r = L.roadmap(p.start, p.startKg, p.goalKg, p.pace);
  if (!r.length) return '';
  const li = a => a.map(x => `<li>${esc(x)}</li>`).join('');
  return `<div class="card"><h2>Roadmap</h2><p class="muted small" style="margin-top:0">${p.startKg} → ${p.goalKg} kg at ${p.pace} kg/month. Each month has a weight checkpoint and a focus for eating, walking and training.</p><div class="road">${r.map(m => {
    const st = m.date && m.date <= t ? 'done' : m.from <= t ? 'now' : '';
    return `<div class="${st}"><div class="row between"><b>${m.date ? `Month ${m.month} · ${esc(m.name)}` : esc(m.name)}</b><span class="small muted" style="white-space:nowrap">${m.date ? `${fmtDate(m.date)} · ${m.kg} kg` : `from ${fmtDate(m.from)}`}</span></div>
      ${st === 'now' && m.date ? `<div class="small">Now: trend ${tk.toFixed(1)} kg · checkpoint ${m.kg} kg</div>` : ''}
      ${st === 'done' ? '' : `<div class="small"><b>Eat</b><ul>${li(m.eat)}</ul><b>Move</b><ul>${li(m.move)}</ul><b>Train</b><ul>${li(m.train)}</ul></div>`}</div>`;
  }).join('')}</div></div>`;
}
function reviewTip(wr, tg) {
  if (wr.foodDays < 4) return 'Tip: log food on at least 5 days so averages mean something.';
  if (wr.proteinAvg < tg.protein * 0.8) return 'Tip: protein is low. Add eggs, chicken, fish, lentils, Greek yogurt or tofu to each meal.';
  if (wr.kcalAvg > tg.kcal * 1.1) return 'Tip: averaging over target. Check oils, drinks and snacks.';
  if (wr.workouts < S.settings.workoutDays.length) return 'Tip: one more workout next week keeps the streak building.';
  return 'Solid week. Keep it the same.';
}

// ---------- me ----------
function meView() {
  const st = S.settings, tg = T(), days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  $('#view').innerHTML = `<h1>Me</h1>
  <div class="card"><div class="row between"><h2>Targets</h2><button class="btn sm ghost" id="edit">Edit profile</button></div>
    <p class="small">${tg.kcal} kcal · P ${tg.protein} g · C ${tg.carbs} g · F ${tg.fat} g</p>
    <p class="muted small">BMR ${tg.bmr} · maintenance ${tg.tdee} · pace ${tg.pace} kg/month${tg.limited ? ' (limited for safety)' : ''}. Recalculated from your trend weight (${trendKg().toFixed(1)} kg).</p>
    <div class="grid2"><div><label>Water glasses/day</label><input id="wg" inputmode="numeric" value="${st.waterGoal}"></div><div><label>Glass size ml</label><input id="gm" inputmode="numeric" value="${st.glassMl}"></div></div>
    <label>Step goal (rises 500 when hit 5 of 7 days)</label><input id="sg" inputmode="numeric" value="${st.stepGoal}">
    <label>Workout days</label><div class="chips">${days.map((d, i) => `<button class="chip ${st.workoutDays.includes(i) ? 'on' : ''}" data-wd="${i}">${d}</button>`).join('')}</div>
    <button class="btn" style="margin-top:12px" id="saveT">Save</button></div>
  <div class="card"><h2>Food AI</h2>
    <p class="muted small">Your key stays on this phone and is sent only to the provider you pick. Anyone with your unlocked phone could read it — use a key with a spend limit.</p>
    <label>Provider</label><select id="prov"><option value="gemini" ${st.provider === 'gemini' ? 'selected' : ''}>Google Gemini (free tier, cheapest)</option><option value="openai" ${st.provider === 'openai' ? 'selected' : ''}>OpenAI-compatible (OpenRouter, Ollama…)</option></select>
    <div id="baseRow" ${st.provider === 'gemini' ? 'hidden' : ''}><label>Base URL</label><input id="base" value="${esc(st.base)}" placeholder="https://openrouter.ai/api/v1"></div>
    <label>Model (must support images)</label><input id="model" value="${esc(st.model)}">
    <label>API key</label><input id="key" type="password" value="${esc(st.apiKey)}" autocomplete="off" placeholder="paste key">
    <p class="muted small">DeepSeek has no image API, so it can’t read photos. Cheapest good options: Gemini 3.5 Flash-Lite (key from aistudio.google.com), or on OpenRouter e.g. google/gemini-2.5-flash-lite.</p>
    <button class="btn" id="saveAI">Save</button></div>
  <div class="card"><h2>Reminders</h2>
    <p class="muted small">iPhone web apps can’t schedule alerts on their own, so this adds repeating events with alerts to your Calendar.</p>
    <div class="grid2"><div><label>Weigh-in</label><input type="time" id="rw" value="${st.remind.weigh}"></div><div><label>Workout</label><input type="time" id="rk" value="${st.remind.workout}"></div></div>
    <label style="display:flex;gap:10px;color:var(--ink)"><input type="checkbox" id="rwa" ${st.remind.water ? 'checked' : ''} style="width:auto"> Water at 10:00, 13:00, 16:00, 19:00</label>
    <button class="btn" id="ics">Add to Calendar (.ics)</button></div>
  <div class="card"><h2>Data</h2><p class="muted small">Everything lives on this phone only. Export a backup now and then.</p>
    <div class="grid2"><button class="btn ghost" id="exp">Export</button><button class="btn ghost" id="imp">Import</button></div>
    <input type="file" id="impF" accept="application/json,.json" hidden>
    <button class="btn ghost bad" style="margin-top:10px" id="reset">Erase everything</button></div>
  <p class="muted small">Not medical advice. Formulas: Mifflin-St Jeor, 7700 kcal/kg, protein 1.6 g/kg. Talk to a doctor if you have a health condition.</p>`;
  $('#edit').onclick = () => { $('#view').innerHTML = setupView(true); bindSetup(true); };
  document.querySelectorAll('[data-wd]').forEach(b => b.onclick = () => b.classList.toggle('on'));
  $('#saveT').onclick = () => {
    const wg = Math.round(num($('#wg').value)), gm = Math.round(num($('#gm').value)), sg = Math.round(num($('#sg').value));
    const wd = [...document.querySelectorAll('[data-wd].on')].map(b => +b.dataset.wd);
    if (!(wg >= 1 && wg <= 20 && gm >= 100 && gm <= 1000 && sg >= 1000 && sg <= 30000)) return toast('Water 1–20, glass 100–1000 ml, steps 1000–30000');
    if (!wd.length) return toast('Pick at least one workout day');
    Object.assign(st, { waterGoal: wg, glassMl: gm, stepGoal: sg, workoutDays: wd }); save(); toast('Saved');
  };
  $('#prov').onchange = e => {
    $('#baseRow').hidden = e.target.value === 'gemini';
    $('#model').value = e.target.value === 'gemini' ? 'gemini-3.5-flash-lite' : 'google/gemini-2.5-flash-lite';
  };
  $('#saveAI').onclick = () => {
    const prov = $('#prov').value, base = $('#base').value.trim();
    if (prov === 'openai' && !/^https?:\/\//.test(base)) return toast('Base URL must start with http(s)://');
    Object.assign(st, { provider: prov, base, model: $('#model').value.trim(), apiKey: $('#key').value.trim() }); save(); toast('AI settings saved');
  };
  $('#ics').onclick = () => {
    Object.assign(st.remind, { weigh: $('#rw').value || '07:30', workout: $('#rk').value || '18:00', water: $('#rwa').checked }); save();
    const ev = [{ title: 'BodyOS: weigh in', time: st.remind.weigh, days: null }, { title: 'BodyOS: workout', time: st.remind.workout, days: st.workoutDays }];
    if (st.remind.water) ['10:00', '13:00', '16:00', '19:00'].forEach(t => ev.push({ title: 'BodyOS: drink water', time: t, days: null }));
    download('bodyos-reminders.ics', L.ics(ev, today()), 'text/calendar');
  };
  $('#exp').onclick = () => download(`bodyos-${today()}.json`, JSON.stringify({ ...S, settings: { ...S.settings, apiKey: '' } }, null, 1), 'application/json');
  $('#imp').onclick = () => $('#impF').click();
  $('#impF').onchange = async e => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (d.v !== 1 || !d.profile || typeof d.weights !== 'object') throw new Error('Not a BodyOS backup');
      if (!confirm('Replace all data on this phone with this backup?')) return;
      const key = S.settings.apiKey;
      localStorage.setItem(KEY, JSON.stringify(d)); S = load(); S.settings.apiKey = S.settings.apiKey || key; save(); toast('Imported'); go('home');
    } catch (err) { toast('Import failed: ' + err.message); }
  };
  $('#reset').onclick = () => {
    if (prompt('This deletes all your data on this phone and cannot be undone. Type ERASE to confirm.') !== 'ERASE') return;
    localStorage.removeItem(KEY); S = load(); go('home');
  };
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// re-render when app comes back (date may have changed, rest timer)
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
// ask the OS not to evict our data under storage pressure; best effort, unsupported browsers just skip
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
render();
