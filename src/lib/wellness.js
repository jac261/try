/* Try — readiness & load from wellness data (intervals.icu-shaped).
 *
 * Pure scoring engine + a localStorage store of daily wellness records:
 *   { date, hrv, rhr, sleepH, sleepScore, ctl, atl, tsb }
 * CTL = Fitness, ATL = Fatigue, TSB = Form (CTL - ATL). The fields mirror
 * intervals.icu so the backend sync populates the same store.
 *
 * READINESS MODEL — the point values are DERIVED, not hand-picked
 * (full rationale: docs/READINESS_MODEL.md). The score starts at 100 and each
 * factor with data adjusts it. Instead of choosing "−26" for a crashed HRV, the
 * model derives every magnitude from three stated decisions:
 *   1. The band cut-offs (green >=75, amber >=55) — the meaningful outputs.
 *   2. A policy that fixes the total penalty budget: it takes TWO compromised
 *      signals to reach "recover today", so the two most important factors, both
 *      at their worst, land exactly on the red line (a 45-point drop). No single
 *      signal alone can trigger red.
 *   3. Each factor's IMPORTANCE as an ordinal tier (HRV 4, sleep 3, feel 3,
 *      resting HR 2, form 2, sleep debt 2, load spike 2) — one ranking judgement.
 * A factor's max penalty is then (importance / total) x budget — so HRV's "26"
 * is an output (4/11 x ~70.7), not an input. Within a factor the penalty ramps
 * over a describable range (neutral -> worst), so there are no cliff edges either.
 */
import { iso, addDays, startOfWeekMonday } from './date.js';

const KEY = 'try.wellness';

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
const save = (arr) => { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {} };
const upsert = (rec) => {
  const a = load().filter(r => r.date !== rec.date);
  a.push(rec); a.sort((x, y) => (x.date < y.date ? -1 : 1));
  save(a); return a;
};
const latest = () => { const a = load(); return a.length ? a[a.length - 1] : null; };

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) * (x - m)))); };
const clamp01 = x => Math.max(0, Math.min(1, x));

// Rolling baseline from the records before `date`: HRV & resting-HR norms, plus
// the short-term context the cumulative factors need — the previous few nights'
// sleep and where acute load (ATL) stood a week ago.
function baseline(records, beforeDate) {
  const prior = records.filter(r => r.date < beforeDate);
  const hrv = prior.slice(-21).map(r => r.hrv).filter(v => v != null);
  const rhr = prior.slice(-21).map(r => r.rhr).filter(v => v != null);
  const nightFloor = iso(addDays(beforeDate, -3));
  const sleepPrior = prior.filter(r => r.date >= nightFloor).slice(-3).map(r => r.sleepH).filter(v => v != null);
  const wkTarget = iso(addDays(beforeDate, -7));
  const wk = [...prior].reverse().find(r => r.date <= wkTarget && r.atl != null);
  return { hrvMean: mean(hrv), hrvSd: sd(hrv) || 4, rhrMean: mean(rhr), sleepPrior, atlWeekAgo: wk ? wk.atl : null, n: prior.length };
}

// The morning check-in's three answers on the factor scale; anything else
// (unanswered, or an explicit skip) is missing data and scores nothing.
const feelValue = f => (f === 'fresh' ? 1 : f === 'okay' ? 0 : f === 'rough' ? -1 : null);

// Merge the check-in store (a {date: answer} map) into server-shaped wellness
// records at read time. Feel lives in its own store because the server sync is
// authoritative per date and would clobber a field it doesn't know; a day with
// an answer but no record becomes a record of its own (the sensor-less case).
function mergeFeel(records, feels) {
  if (!feels || !Object.keys(feels).length) return records || [];
  const out = (records || []).map(r => (feels[r.date] ? { ...r, feel: feels[r.date] } : r));
  const have = new Set(out.map(r => r.date));
  Object.keys(feels).forEach(d => {
    if (!have.has(d) && feelValue(feels[d]) != null) out.push({ date: d, feel: feels[d] });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const fmtH = h => { const m = Math.round(h * 60); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
const signed = v => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v));

const BANDS = [
  { key: 'green', min: 75, headline: 'Ready to roll', blurb: 'Recovered and good to train as planned.' },
  { key: 'amber', min: 55, headline: 'Ease into it', blurb: 'A bit down — keep hard efforts controlled or swap for easy aerobic.' },
  { key: 'red', min: 0, headline: 'Recover today', blurb: 'Signals point to recovery — take it very easy, or rest.' },
];
function bandFor(score) { return (BANDS.find(b => score >= b.min) || BANDS[BANDS.length - 1]).key; }

/* ---- the factor table ----
   Each factor states only meaningful, arguable quantities:
   `importance` — ordinal tier used to split the budget (max penalty is derived).
   `value(rec, base)` — the model input (or null if the data's missing).
   `neutral`/`worst` — the input range over which the penalty ramps 0 -> max;
   `worst` sits on the "bad" side of `neutral`, so one formula covers every
   direction. `curve` bends that ramp (sleep is convex — debt compounds).
   `bonusAt` — input at/beyond which a factor that can be *better* than normal
   (HRV, form) earns its small bonus. `driver`/`what`/`samples` are the human
   explanation the support page renders. */
const FACTORS = [
  {
    key: 'hrv', label: 'HRV', importance: 4,
    value: (rec, base) => (rec.hrv != null && base.hrvMean) ? (rec.hrv - base.hrvMean) / (base.hrvSd || 4) : null,
    neutral: -0.5, worst: -2.5, curve: 1, bonusAt: 0.7,
    driver: (rec, base, p) => {
      const bm = Math.round(base.hrvMean);
      if (p <= -12) return { bad: 1, t: `HRV ${rec.hrv} — well below your ${bm} baseline` };
      if (p <= -3) return { bad: 1, t: `HRV ${rec.hrv} — below your ${bm} baseline` };
      if (p >= 1) return { bad: 0, t: `HRV ${rec.hrv} — above your ${bm} baseline` };
      return { bad: 0, t: `HRV ${rec.hrv} — around your ${bm} baseline` };
    },
    what: 'Morning heart-rate variability, scored as standard deviations from your own rolling 21-day average — so it self-calibrates to you. Penalty ramps from 0 at baseline to the full weight at 2.5 sd below.',
    samples: [['0.7+ sd above', 0.7], ['At your baseline', 0], ['1 sd below', -1], ['1.5 sd below', -1.5], ['2.5+ sd below', -2.5]],
  },
  {
    key: 'sleep', label: 'Sleep', importance: 3,
    value: (rec) => (rec.sleepH != null ? rec.sleepH : null),
    neutral: 7, worst: 4, curve: 1.7,
    driver: (rec, _base, p) => {
      const s = rec.sleepH;
      if (p <= -8) return { bad: 1, t: `Only ${fmtH(s)} sleep` };
      if (p <= -3) return { bad: 1, t: `${fmtH(s)} sleep — a bit short` };
      if (p <= -1) return { bad: 0, t: `${fmtH(s)} sleep` };
      return { bad: 0, t: `${fmtH(s)} sleep — solid` };
    },
    what: '7h is treated as meeting an adult’s need (no penalty); 4h is the worst case (full weight). The ramp is convex, so sleep debt bites harder the deeper it goes — the hour lost from 6→5 costs more than 7→6.',
    samples: [['7h or more', 7], ['6h', 6], ['5h', 5], ['4h or less', 4]],
  },
  {
    key: 'feel', label: 'How you feel', importance: 3,
    value: (rec) => feelValue(rec.feel),
    neutral: 0, worst: -1, curve: 1, bonusAt: 1,
    driver: (_rec, _base, p) => {
      if (p < 0) return { bad: 1, t: 'You said you feel rough' };
      if (p > 0) return { bad: 0, t: 'You said you feel fresh' };
      return null;
    },
    what: 'Your own answer to the morning check-in. Subjective feel is one of the most sensitive readiness signals there is — it often catches what the sensors miss (and it’s the primary signal when there are no sensors at all). Feeling rough counts against the day, feeling fresh earns the small bonus, and skipping the question never costs anything.',
    samples: [['Feeling fresh', 1], ['Feeling okay', 0], ['Feeling rough', -1]],
  },
  {
    key: 'rhr', label: 'Resting HR', importance: 2,
    value: (rec, base) => (rec.rhr != null && base.rhrMean) ? rec.rhr - base.rhrMean : null,
    neutral: 2, worst: 8, curve: 1,
    driver: (rec, _base, p) => {
      if (p <= -10) return { bad: 1, t: `Resting HR ${rec.rhr} — well above baseline` };
      if (p <= -1) return { bad: 1, t: `Resting HR ${rec.rhr} — slightly raised` };
      return null;
    },
    what: 'Beats per minute above your baseline resting HR — a classic sign of incomplete recovery, stress, or a bug coming on. Within 2 bpm is normal variation (no penalty); 8+ bpm above is the worst case. No bonus for a low reading.',
    samples: [['Within 2 bpm', 2], ['4 bpm above', 4], ['8+ bpm above', 8]],
  },
  {
    key: 'form', label: 'Form', importance: 2,
    value: (rec) => (rec.tsb != null ? rec.tsb : null),
    neutral: 0, worst: -25, curve: 1, bonusAt: 12,
    driver: (rec, _base, p) => {
      const t = signed(rec.tsb);
      const zone = formZone(rec.tsb);
      if (p <= -10) return { bad: 1, t: `Form ${t} — carrying fatigue` };
      if (p <= -3) return { bad: 1, t: `Form ${t} — some fatigue` };
      // Neutral-or-better: name the training zone so the chip matches the chart.
      return { bad: 0, t: `Form ${t}` + (zone && zone.key !== 'grey' ? ` — ${zone.label.toLowerCase()}` : '') };
    },
    what: 'Form (TSB = Fitness − Fatigue) is your training-load balance — chronic context, not today’s acute state, so it’s a secondary signal. Balanced is neutral; −25 or deeper is the worst case; +12 or fresher earns the freshness bonus.',
    samples: [['+12 or fresher', 12], ['Balanced (0)', 0], ['−10 (some fatigue)', -10], ['−25 or deeper', -25]],
  },
  {
    key: 'debt', label: 'Sleep debt', importance: 2,
    value: (rec, base) => {
      const nights = base.sleepPrior || [];
      if (!nights.length) return null;
      return nights.reduce((s, h) => s + Math.max(0, 7 - h), 0);
    },
    neutral: 1.5, worst: 6, curve: 1,
    driver: (_rec, _base, p) => {
      if (p <= -7) return { bad: 1, t: 'Short sleep stacking up over recent nights' };
      if (p <= -2) return { bad: 1, t: 'Sleep running a little short lately' };
      return null;
    },
    what: 'Sleep shortfall added up across the few nights before last night — the hole, where the sleep factor is only the latest dig. One short night is quickly repaid; several in a row compound, so you can feel wrecked on a morning when last night alone looked passable.',
    samples: [['Well slept all week', 0], ['One shortish night', 2], ['A couple of short nights', 3.5], ['Several short nights', 6]],
  },
  {
    key: 'spike', label: 'Load spike', importance: 2,
    value: (rec, base) => (rec.atl != null && rec.ctl > 0 && base.atlWeekAgo != null)
      ? (rec.atl - base.atlWeekAgo) / rec.ctl : null,
    neutral: 0.15, worst: 0.5, curve: 1,
    driver: (_rec, _base, p) => {
      if (p <= -8) return { bad: 1, t: 'Training load has jumped well above your recent norm' };
      if (p <= -2) return { bad: 1, t: 'Training load climbing quickly' };
      return null;
    },
    what: 'How sharply acute load (Fatigue/ATL) has risen over the past week, scaled to your fitness. Form can read fresh after a run of easy weeks, yet a sudden jump in weekly load is a classic overreach signal — a fast rise counts as fatigue even while the balance still looks positive.',
    samples: [['Steady week', 0], ['Noticeably bigger week', 0.25], ['Big jump in load', 0.4], ['Sudden huge jump', 0.5]],
  },
];

/* ---- derive the magnitudes from the policy (see header) ---- */
// Rule: the two most important factors at their worst land on the red line.
const RED_DROP = 100 - BANDS.find(b => b.key === 'amber').min; // 45
const TOTAL_IMPORTANCE = FACTORS.reduce((s, f) => s + f.importance, 0);
const TOP_TWO_IMPORTANCE = FACTORS.map(f => f.importance).sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);
const BUDGET = RED_DROP * TOTAL_IMPORTANCE / TOP_TWO_IMPORTANCE; // total points removed by an all-worst day
const BONUS_FRACTION = 0.15; // being better than normal recovers at most ~15% of a factor's weight
FACTORS.forEach(f => {
  f.max = Math.round(f.importance / TOTAL_IMPORTANCE * BUDGET);
  f.bonus = f.bonusAt != null ? Math.max(1, Math.round(f.max * BONUS_FRACTION)) : 0;
});

// Signed points a factor contributes for input x: a bonus (positive) when it's
// on the good side of baseline, otherwise a penalty (negative) scaled by how far
// into the neutral->worst range it sits. The two never overlap.
function pointsFor(f, x) {
  if (f.bonusAt != null && ((x - 0) * Math.sign(f.bonusAt)) > 0) {
    return Math.round(f.bonus * clamp01((x - 0) / (f.bonusAt - 0)));
  }
  const badness = Math.pow(clamp01((x - f.neutral) / (f.worst - f.neutral)), f.curve || 1);
  return -Math.round(badness * f.max);
}

// Readiness score (0-100) + band + the drivers behind it. Each factor only
// contributes when its data is present, so partial inputs still produce a read.
function readiness(rec, base) {
  if (!rec) return null;
  let score = 100;
  const why = [];
  for (const f of FACTORS) {
    const x = f.value(rec, base);
    if (x == null) continue;
    const points = pointsFor(f, x);
    score += points;
    const line = f.driver(rec, base, points);
    if (line) why.push({ ...line, key: f.key, points });
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandFor(score);
  return { score, band, headline: BANDS.find(b => b.key === band).headline, why };
}

// The classic Form (TSB) training zones (Friel/PMC convention), used as the
// coloured background bands the form line moves through on the load charts.
// Colours chosen for what the word MEANS: golden caution-yellow for the
// detraining drift of transition, mint teal for fresh (crisp, race-ready),
// a receding neutral grey, growth green for optimal, alarm red for high risk.
// Each band is a subtle vertical gradient whose intensity grows TOWARD the
// extreme (`grad`: 'up' | 'down' | 'flat') — further from balanced, more
// saturated — with per-zone alpha tuned for the dark theme.
const FORM_ZONES = [
  { key: 'transition', label: 'Transition', lo: 25, hi: Infinity, color: '#facc15', alpha: 0.20, grad: 'up', blurb: 'so fresh you may be detraining' },
  { key: 'fresh', label: 'Fresh', lo: 5, hi: 25, color: '#22d3ee', alpha: 0.20, grad: 'up', blurb: 'race-ready' },
  { key: 'grey', label: 'Grey zone', lo: -10, hi: 5, color: '#94a3b8', alpha: 0.10, grad: 'flat', blurb: 'neither building nor peaking' },
  { key: 'optimal', label: 'Optimal', lo: -30, hi: -10, color: '#34d399', alpha: 0.20, grad: 'down', blurb: 'productive training load' },
  { key: 'highRisk', label: 'High risk', lo: -Infinity, hi: -30, color: '#ef4444', alpha: 0.34, grad: 'down', blurb: 'overreaching — injury/illness territory' },
];
function formZone(tsb) {
  if (tsb == null) return null;
  return FORM_ZONES.find(z => tsb >= z.lo && tsb < z.hi) || FORM_ZONES[0];
}

// Weekly ramp rate: how much Fitness (CTL) changed over the trailing 7 days —
// computed from the synced series (so it also works for manual entries).
// Sustained ramps above ~5-8/week are the classic overuse-injury flag.
function rampAt(withCtl, index) {
  const rec = withCtl[index];
  const target = iso(addDays(rec.date, -7));
  const prior = [...withCtl.slice(0, index)].reverse().find(r => r.date <= target);
  if (!prior) return null;
  return Math.round((rec.ctl - prior.ctl) * 10) / 10;
}

function rampRate(records) {
  const withCtl = (records || []).filter(r => r.ctl != null);
  if (withCtl.length < 2) return null;
  return rampAt(withCtl, withCtl.length - 1);
}

// The ramp trend: weekly ramp computed for each of the last `days` records that
// have fitness data AND a full week of history behind them (the leading edge of
// a fresh dataset can't have a ramp, so it's omitted rather than guessed).
function rampHistory(records, days = 60) {
  const withCtl = (records || []).filter(r => r.ctl != null);
  const out = [];
  for (let i = 0; i < withCtl.length; i++) {
    const ramp = rampAt(withCtl, i);
    if (ramp != null) out.push({ date: withCtl[i].date, ramp });
  }
  return out.slice(-days);
}

// Ramp-rate zones: how fast is it sustainable to build? Anchored on the common
// coaching guidance that ~5/week is the sustainable ceiling and sustained ramps
// above ~8/week are injury/illness territory. Colours by meaning, gradients
// intensifying toward the extreme, same conventions as FORM_ZONES.
const RAMP_ZONES = [
  { key: 'risky', label: 'Risky', lo: 8, hi: Infinity, color: '#ef4444', alpha: 0.30, grad: 'up', blurb: 'sustained ramps here invite injury/illness' },
  { key: 'aggressive', label: 'Aggressive', lo: 5, hi: 8, color: '#facc15', alpha: 0.20, grad: 'up', blurb: 'short blocks only' },
  { key: 'building', label: 'Building', lo: 0, hi: 5, color: '#34d399', alpha: 0.18, grad: 'up', blurb: 'productive, sustainable' },
  { key: 'steady', label: 'Steady', lo: -3, hi: 0, color: '#94a3b8', alpha: 0.10, grad: 'flat', blurb: 'holding fitness' },
  { key: 'detraining', label: 'Detraining', lo: -Infinity, hi: -3, color: '#38bdf8', alpha: 0.18, grad: 'down', blurb: 'losing fitness — exactly right in a taper' },
];
function rampZone(ramp) {
  if (ramp == null) return null;
  return RAMP_ZONES.find(z => ramp >= z.lo && ramp < z.hi) || RAMP_ZONES[0];
}

// The coach line: one plain-English sentence synthesising form + ramp, spoken
// when the engine has nothing to propose. Most-urgent-first, mirroring the
// engine's own priorities; null when there isn't enough data to say anything.
function coachLine(tsb, ramp) {
  const f = formZone(tsb), r = rampZone(ramp);
  if (!f && !r) return null;
  if (f && f.key === 'highRisk') return 'Deep fatigue territory. Recovery is the training right now.';
  if (r && r.key === 'risky') return 'Fitness is climbing faster than your body can absorb. Time to pull back.';
  if (r && r.key === 'aggressive') return 'A hot build. Big gains, but keep a close eye on recovery.';
  if (f && f.key === 'transition') return 'Very fresh, maybe too fresh. Fitness leaks without regular load.';
  if (r && r.key === 'building') {
    if (f && f.key === 'optimal') return 'Building well at a sustainable pace. Hold this rhythm.';
    return 'Fitness is edging up. There is room to push a little.';
  }
  if (r && r.key === 'steady') {
    if (f && f.key === 'fresh') return 'Fresh and holding fitness. A good place to be before racing.';
    return 'Holding fitness. Ticking over nicely.';
  }
  if (r && r.key === 'detraining') return 'Fitness is drifting down. Fine if this is a planned break or taper.';
  return null;
}

// True when synced fitness history exists but only reaches back a few weeks —
// the trigger for the one-time automatic deep backfill (records ascending).
function shallowHistory(records, todayISO) {
  const withCtl = (records || []).filter(r => r.ctl != null);
  if (!withCtl.length) return false;
  return withCtl[0].date > iso(addDays(todayISO || iso(new Date()), -120));
}

// One ramp reading per calendar week (for the histogram): fitness gained over
// the 7 days up to that week's last record — the same definition as rampAt, so
// the current partial week reads as "rate right now", not a misleading stub.
function weeklyRamps(records, weeks = 8) {
  const withCtl = (records || []).filter(r => r.ctl != null);
  const lastIdxByWeek = new Map();
  withCtl.forEach((r, i) => lastIdxByWeek.set(iso(startOfWeekMonday(r.date)), i));
  return [...lastIdxByWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, i]) => ({ week, ramp: rampAt(withCtl, i) }))
    .filter(e => e.ramp != null)
    .slice(-weeks);
}

// Readiness trend: score each of the last `days` records against the rolling
// baseline as it stood on THAT day (no hindsight), skipping records that carry
// no readiness metrics (an empty day would misleadingly score 100).
function history(records, days = 14) {
  const scored = (records || [])
    .filter(r => r.hrv != null || r.sleepH != null || r.rhr != null || r.tsb != null || feelValue(r.feel) != null)
    .slice(-days)
    .map(r => {
      const rd = readiness(r, baseline(records, r.date));
      return { date: r.date, score: rd.score, band: rd.band };
    });
  return scored;
}

// Bump when the scoring model changes shape — calibration observations carry it
// so a future fit can separate data gathered under different engines.
const ENGINE_VERSION = 4;

// Immutable capture of "readiness as it stood" for calibration: the raw inputs
// (not just the score) so future models can be fitted from the same observations,
// plus the score/band this engine showed the athlete at the time.
function snapshot(rec, base) {
  if (!rec) return { v: ENGINE_VERSION, score: null, band: null, inputs: null };
  const r = readiness(rec, base);
  const round1 = x => (x == null ? null : Math.round(x * 10) / 10);
  return {
    v: ENGINE_VERSION,
    score: r.score,
    band: r.band,
    inputs: {
      hrv: rec.hrv ?? null,
      hrvMean: round1(base.hrvMean) || null,
      hrvSd: round1(base.hrvSd) || null,
      rhr: rec.rhr ?? null,
      rhrMean: round1(base.rhrMean) || null,
      sleepH: rec.sleepH ?? null,
      sleepPrior: (base.sleepPrior || []).map(round1),
      feel: rec.feel ?? null,
      tsb: rec.tsb ?? null,
      atl: round1(rec.atl ?? null),
      ctl: round1(rec.ctl ?? null),
      atlWeekAgo: round1(base.atlWeekAgo ?? null),
      // Data lineage for the future fit: true when the load numbers were
      // log-derived estimates rather than measured (no intervals.icu).
      derivedLoad: rec.derived ? true : undefined,
    },
  };
}

// Session-aware recommendation: how readiness should shape today's workout.
// With no session at all (tracker mode, or a plan-less day), advice speaks only
// about the body, never prescribing a session that does not exist.
function advice(band, isHard, sessionTitle) {
  if (!sessionTitle) {
    if (band === 'green') return 'You are fresh today. A good day to train hard if you feel like it.';
    if (band === 'amber') return 'A little down today. Keep anything you do controlled.';
    return 'Recovery signals are high. Take it easy or rest today.';
  }
  const s = sessionTitle;
  if (band === 'green') return isHard ? `Green light — attack today's ${s} as planned.` : `Good to go — enjoy today's ${s}.`;
  if (band === 'amber') return isHard ? `A little down — keep the hard efforts controlled, or swap ${s} for an easy aerobic session.` : `Keep ${s} relaxed today.`;
  return isHard ? `Recovery first — swap today's ${s} for easy aerobic or rest.` : `Take it very easy today, or rest.`;
}

const fmtEffect = p => (p > 0 ? '+' + p : p === 0 ? '0' : '−' + Math.abs(p));

// Render-ready description for the in-app "How readiness works" page: the policy,
// the bands, and each factor's derived weight + explanation + a table of effects
// computed straight from the model (so the copy can never drift from the engine).
const MODEL = {
  start: 100,
  bands: BANDS,
  budget: Math.round(BUDGET),
  policy: 'The point values aren’t hand-picked. Each factor’s importance (HRV and sleep primary, resting HR and form secondary) sets its share of a total budget, and that budget is fixed by one rule: it takes two compromised signals to reach "recover today" — the two most important, both at their worst, land exactly on the red line. Every number below is computed from that.',
  factors: FACTORS.map(f => ({
    key: f.key, label: f.label, weight: f.max, what: f.what,
    bands: f.samples.map(([label, x]) => [label, fmtEffect(pointsFor(f, x))]),
  })),
};

export const wellness = { load, save, upsert, latest, baseline, readiness, advice, snapshot, history, mergeFeel, formZone, rampRate, rampHistory, rampZone, weeklyRamps, coachLine, shallowHistory, FORM_ZONES, RAMP_ZONES, fmtH, signed, MODEL, ENGINE_VERSION };
