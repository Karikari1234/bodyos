// Run: node --test app/logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');

const me = { sex: 'm', kg: 82, cm: 175, age: 30, activity: 'light', paceKgMonth: 2.5 };

test('Mifflin-St Jeor matches hand calculation', () => {
  assert.equal(L.bmr(me), 1768.75);
  assert.equal(L.bmr({ ...me, sex: 'f' }), 1602.75);
});

test('targets for 82 kg man, 2.5 kg/month', () => {
  const t = L.targets(me);
  assert.equal(t.tdee, 2432);
  assert.equal(t.kcal, 1800);           // 2432 - 632 deficit
  assert.equal(t.protein, 131);         // 1.6 x 82
  assert.equal(t.fat, 50);              // 25% of 1800 / 9
  assert.equal(t.carbs, 207);
  assert.equal(t.pace, 2.5);
  assert.equal(t.limited, false);
  // macros add back to kcal within rounding
  assert.ok(Math.abs(L.macroKcal(t.protein, t.carbs, t.fat) - t.kcal) <= 6);
});

test('safety floor and 1%/week cap', () => {
  const small = L.targets({ sex: 'f', kg: 50, cm: 155, age: 60, activity: 'sedentary', paceKgMonth: 3 });
  assert.equal(small.kcal, 1200);
  assert.equal(small.limited, true);
  assert.ok(small.pace < 3);
  const capped = L.targets({ ...me, kg: 60, activity: 'active', paceKgMonth: 5 });
  assert.ok(capped.pace <= 60 * 0.01 * 30.44 / 7 + 0.05);
});

test('dates across month, year and DST boundaries', () => {
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(L.daysBetween('2026-03-01', '2026-04-01'), 31);
  assert.equal(L.daysBetween('2026-10-20', '2026-11-10'), 21);
  assert.equal(L.weekday('2026-11-08'), 0); // Sunday
  assert.equal(L.dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('goal date and plan line', () => {
  // 12 kg at 2.5 kg/month = 4.8 months = 146.1 days -> 147
  assert.equal(L.goalDate('2026-11-08', 82, 70, 2.5), '2027-04-04');
  assert.equal(L.goalDate('2026-11-08', 70, 70, 2.5), '2026-11-08');
  assert.equal(L.goalDate('2026-11-08', 82, 70, 0), null);
  assert.equal(L.planWeight('2026-11-08', 82, 70, 2.5, '2026-11-08'), 82);
  assert.ok(Math.abs(L.planWeight('2026-11-08', 82, 70, 2.5, L.addDays('2026-11-08', 30.44 * 2 | 0)) - 77.0) < 0.1);
  assert.equal(L.planWeight('2026-11-08', 82, 70, 2.5, '2028-01-01'), 70);
});

test('trend EMA with gaps', () => {
  const s = L.trend({ '2026-11-01': 82, '2026-11-02': 81, '2026-11-04': 81 });
  assert.equal(s[0].trend, 82);
  assert.equal(s[1].trend, 81.9);               // 82 + 0.1*(81-82)
  assert.equal(s[2].trend, 81.73);              // gap 2: a=0.19
  assert.deepEqual(L.trend({}), []);
});

test('weekly rate', () => {
  const w = {};
  for (let i = 0; i <= 14; i++) w[L.addDays('2026-11-01', i)] = 82 - i * 0.1;
  const r = L.weeklyRate(L.trend(w));
  assert.ok(r < 0 && r > -0.7, String(r));
  assert.equal(L.weeklyRate(L.trend({ '2026-11-01': 82 })), null);
  assert.equal(L.weeklyRate(L.trend({ '2026-11-01': 82, '2026-11-03': 81 })), null);
});

test('streak', () => {
  assert.equal(L.streak(['2026-11-06', '2026-11-07', '2026-11-08'], '2026-11-08'), 3);
  assert.equal(L.streak(['2026-11-06', '2026-11-07'], '2026-11-08'), 2);   // today not logged yet
  assert.equal(L.streak(['2026-11-05', '2026-11-07'], '2026-11-08'), 1);
  assert.equal(L.streak([], '2026-11-08'), 0);
});

test('step goal', () => {
  assert.equal(L.nextStepGoal(5000, [5000, 6000, 5100, 5200, 5300, 100, 0]), 5500);
  assert.equal(L.nextStepGoal(5000, [5000, 6000, 5100, 5200, 100, 100, 0]), 5000);
  assert.equal(L.nextStepGoal(5000, [9000, 9000]), 5000);
  assert.equal(L.nextStepGoal(12000, Array(7).fill(20000)), 12000);
});

test('macro mismatch', () => {
  assert.equal(L.macroMismatch(400, 30, 40, 13), false); // 397
  assert.equal(L.macroMismatch(400, 10, 10, 5), true);   // 125
  assert.equal(L.macroMismatch(30, 0, 0, 0), false);     // small diff ignored
});

test('parseAIFood validates and cleans', () => {
  const r = L.parseAIFood('```json\n{"items":[{"name":"Rice","grams":200,"kcal":260,"protein_g":5,"carbs_g":57,"fat_g":0.6},{"name":"X","kcal":-5,"protein_g":"abc","carbs_g":10,"fat_g":0}],"confidence":"medium"}\n```');
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0], { name: 'Rice', grams: 200, kcal: 260, p: 5, c: 57, f: 1, mismatch: false });
  assert.equal(r.items[1].kcal, 40); // derived from macros when kcal invalid
  assert.equal(r.items[1].p, 0);
  assert.equal(r.confidence, 'medium');
  assert.equal(L.parseAIFood('{"items":[{"name":"a","kcal":1}],"confidence":"sure"}').confidence, 'low');
  assert.equal(L.parseAIFood('<think>maybe {x}</think>{"items":[{"name":"a","kcal":5}]}').items[0].kcal, 5);
  assert.throws(() => L.parseAIFood('sorry'));
  assert.throws(() => L.parseAIFood('{"items":[]}'));
});

test('ladders are complete and sane', () => {
  for (const p of L.PATTERNS) {
    const lv = L.LADDERS[p].levels;
    assert.equal(lv.length, 6, p);
    for (const l of lv) {
      assert.ok(['reps', 'secs', 'each'].includes(l.type));
      assert.ok(l.min > 0 && l.max > l.min, l.n);
      assert.ok(l.cues.length >= 3, l.n);
    }
  }
});

test('progression rules', () => {
  const s = (level, sets, pain = false) => ({ items: [{ pattern: 'push', level, sets, pain }] });
  assert.deepEqual(L.progression('push', []), { level: 1, reason: 'start' });
  assert.equal(L.progression('push', [s(1, [15, 15, 15])]).level, 1);            // only one session
  assert.equal(L.progression('push', [s(1, [15, 15, 15]), s(1, [15, 15, 15])]).level, 2);
  assert.equal(L.progression('push', [s(1, [15, 15, 15]), s(1, [15, 15, 14])]).level, 1);
  assert.equal(L.progression('push', [s(1, [15, 15, 15]), s(2, [12, 12, 12])]).level, 2); // different level
  assert.equal(L.progression('push', [s(3, [12, 12, 12]), s(3, [5, 5, 5], true)]).level, 2);
  assert.equal(L.progression('push', [s(1, [3], true)]).level, 1);
  assert.equal(L.progression('push', [s(6, [12, 12, 12]), s(6, [12, 12, 12])]).level, 6);  // top
  assert.equal(L.progression('squat', [s(1, [15, 15, 15])]).reason, 'start');
});

test('week review', () => {
  const days = { '2026-11-08': { food: [{ kcal: 1800, p: 130 }], steps: 6000 }, '2026-11-07': { food: [{ kcal: 1600, p: 110 }], steps: 4000 }, '2026-10-30': { food: [{ kcal: 5000 }] } };
  const r = L.weekReview('2026-11-08', days, { '2026-11-01': 82, '2026-11-08': 81 }, [{ date: '2026-11-05' }, { date: '2026-10-01' }]);
  assert.equal(r.kcalAvg, 1700);
  assert.equal(r.proteinAvg, 120);
  assert.equal(r.stepsAvg, 5000);
  assert.equal(r.workouts, 1);
  assert.equal(r.trendChange, -0.52); // 1 - 0.9^7 = 0.5217
});

test('ics output', () => {
  const t = L.ics([{ title: 'Workout', time: '18:30', days: [1, 4] }, { title: 'Weigh in', time: '07:00', days: null }], '2026-11-08');
  assert.match(t, /DTSTART:20261108T183000/);
  assert.match(t, /RRULE:FREQ=WEEKLY;BYDAY=MO,TH/);
  assert.match(t, /RRULE:FREQ=DAILY/);
  assert.ok(t.split('\r\n').filter(l => l === 'BEGIN:VEVENT').length === 2);
});
