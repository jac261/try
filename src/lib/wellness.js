/* Try — readiness & load from wellness data (intervals.icu-shaped).
 *
 * Pure scoring engine + a localStorage store of daily wellness records:
 *   { date, hrv, rhr, sleepH, sleepScore, ctl, atl, tsb }
 * CTL = Fitness, ATL = Fatigue, TSB = Form (CTL - ATL). The fields mirror
 * intervals.icu so the backend sync populates the same store.
 *
 * READINESS MODEL (see docs/READINESS_MODEL.md for the full rationale)
 * Every morning starts at 100. Each factor you have data for subtracts points
 * as you deviate from a healthy norm — the further out, the bigger the penalty —
 * and a couple can add a small bonus. The penalty for a factor is a piecewise-
 * linear curve between documented anchor points (so there are no cliff edges:
 * 6.4h of sleep lands *between* the 6h and 7h penalties, not on a flat tier).
 * A factor's WEIGHT is the most it can ever subtract; the weights rank how much
 * a morning number should trust each signal:
 *   HRV 26  — most direct read on autonomic recovery, z-scored to your own norm
 *   Sleep 22 — the primary recovery input
 *   Resting HR 15 — corroborates HRV, but noisier/laggier, so lower + penalty-only
 *   Form/TSB 14 — chronic training-load context, not today's acute state
 * Bands: >=75 green "Ready to roll", 55-74 amber "Ease into it", <55 red "Recover today".
 */
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

// Rolling baseline from the records before `date` (HRV & resting-HR norms).
function baseline(records, beforeDate) {
  const prior = records.filter(r => r.date < beforeDate);
  const hrv = prior.slice(-21).map(r => r.hrv).filter(v => v != null);
  const rhr = prior.slice(-21).map(r => r.rhr).filter(v => v != null);
  return { hrvMean: mean(hrv), hrvSd: sd(hrv) || 4, rhrMean: mean(rhr), n: prior.length };
}

const fmtH = h => { const m = Math.round(h * 60); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
const signed = v => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v));

// Piecewise-linear interpolation over [x, penalty] anchors sorted by x ascending.
// Clamps to the end penalties outside the anchor range.
function interp(anchors, x) {
  if (x <= anchors[0][0]) return anchors[0][1];
  const end = anchors[anchors.length - 1];
  if (x >= end[0]) return end[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, p0] = anchors[i - 1];
    const [x1, p1] = anchors[i];
    if (x <= x1) return p0 + (p1 - p0) * ((x - x0) / (x1 - x0));
  }
  return end[1];
}

/* ---- the factor table: input → penalty curve → driver text ----
   `value(rec, base)` returns the model input (or null if the data's missing).
   `anchors` map that input to a penalty (0 = no effect, negative = deduction,
   positive = bonus). `driver` produces the plain-English line for the card,
   or null to stay quiet (e.g. a normal resting HR isn't worth mentioning).
   `weight`, `what` and `bands` are the human explanation the support page renders. */
const FACTORS = [
  {
    key: 'hrv',
    label: 'HRV',
    weight: 26,
    // z-score: standard deviations from your own 21-day HRV norm.
    value: (rec, base) => (rec.hrv != null && base.hrvMean) ? (rec.hrv - base.hrvMean) / (base.hrvSd || 4) : null,
    anchors: [[-2.6, -26], [-1.5, -18], [-0.7, -11], [0, 0], [0.7, 4]],
    driver: (rec, base, p) => {
      const bm = Math.round(base.hrvMean);
      if (p <= -12) return { bad: 1, t: `HRV ${rec.hrv} — well below your ${bm} baseline` };
      if (p <= -3) return { bad: 1, t: `HRV ${rec.hrv} — below your ${bm} baseline` };
      if (p >= 1) return { bad: 0, t: `HRV ${rec.hrv} — above your ${bm} baseline` };
      return { bad: 0, t: `HRV ${rec.hrv} — around your ${bm} baseline` };
    },
    what: 'Morning heart-rate variability, scored as how many standard deviations it sits from your own rolling 21-day average — so it self-calibrates to you, not a population norm.',
    bands: [
      ['Above your baseline', '+4'],
      ['Around your baseline', '0'],
      ['~1 sd below', '−11'],
      ['~1.5 sd below', '−18'],
      ['2.5+ sd below', '−26'],
    ],
  },
  {
    key: 'sleep',
    label: 'Sleep',
    weight: 22,
    value: (rec) => (rec.sleepH != null ? rec.sleepH : null),
    anchors: [[4, -22], [5, -11], [6, -3], [7, 0]],
    driver: (rec, _base, p) => {
      const s = rec.sleepH;
      if (p <= -8) return { bad: 1, t: `Only ${fmtH(s)} sleep` };
      if (p <= -3) return { bad: 1, t: `${fmtH(s)} sleep — a bit short` };
      if (p <= -1) return { bad: 0, t: `${fmtH(s)} sleep` };
      return { bad: 0, t: `${fmtH(s)} sleep — solid` };
    },
    what: 'Hours slept. 7h is treated as meeting an adult’s need; the penalty deepens faster than linearly below that, because sleep debt compounds — losing the hour from 6→5 costs more than 7→6.',
    bands: [
      ['7h or more', '0'],
      ['6h', '−3'],
      ['5h', '−11'],
      ['4h or less', '−22'],
    ],
  },
  {
    key: 'rhr',
    label: 'Resting HR',
    weight: 15,
    // bpm above your baseline; below your norm is just normal, not extra-ready.
    value: (rec, base) => (rec.rhr != null && base.rhrMean) ? rec.rhr - base.rhrMean : null,
    anchors: [[2, 0], [4, -8], [7, -15], [12, -15]],
    driver: (rec, _base, p) => {
      if (p <= -12) return { bad: 1, t: `Resting HR ${rec.rhr} — well above baseline` };
      if (p <= -1) return { bad: 1, t: `Resting HR ${rec.rhr} — slightly raised` };
      return null; // normal resting HR isn't worth a line
    },
    what: 'Beats per minute above your baseline resting HR. A raised morning resting HR is a classic sign of incomplete recovery, stress, or a bug coming on. Within 4 bpm of normal is neutral; there is no bonus for a low reading.',
    bands: [
      ['Within 4 bpm of baseline', '0'],
      ['4 bpm above', '−8'],
      ['7+ bpm above', '−15'],
    ],
  },
  {
    key: 'form',
    label: 'Form',
    weight: 14,
    value: (rec) => (rec.tsb != null ? rec.tsb : null),
    anchors: [[-25, -14], [-20, -14], [-10, -7], [0, 0], [12, 4], [30, 4]],
    driver: (rec, _base, p) => {
      const t = signed(rec.tsb);
      if (p <= -12) return { bad: 1, t: `Form ${t} — carrying fatigue` };
      if (p <= -3) return { bad: 1, t: `Form ${t} — some fatigue` };
      if (p >= 1) return { bad: 0, t: `Form ${t} — fresh` };
      return { bad: 0, t: `Form ${t}` };
    },
    what: 'Form (TSB = Fitness − Fatigue) is your training-load balance. Deeply negative means accumulated fatigue (often deliberate mid-block, but still a drag on readiness); positive means fresh, as in a taper. It carries the least weight because it is chronic context, not today’s acute state.',
    bands: [
      ['+12 or fresher', '+4'],
      ['Around balanced', '0'],
      ['−10 (some fatigue)', '−7'],
      ['−20 or deeper', '−14'],
    ],
  },
];

// Band cutoffs + copy — exported for the support page and the readiness card.
const BANDS = [
  { key: 'green', min: 75, headline: 'Ready to roll', blurb: 'Recovered and good to train as planned.' },
  { key: 'amber', min: 55, headline: 'Ease into it', blurb: 'A bit down — keep hard efforts controlled or swap for easy aerobic.' },
  { key: 'red', min: 0, headline: 'Recover today', blurb: 'Signals point to recovery — take it very easy, or rest.' },
];

function bandFor(score) {
  return (BANDS.find(b => score >= b.min) || BANDS[BANDS.length - 1]).key;
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
    const points = Math.round(interp(f.anchors, x));
    score += points;
    const line = f.driver(rec, base, points);
    if (line) why.push({ ...line, key: f.key, points });
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandFor(score);
  const meta = BANDS.find(b => b.key === band);
  return { score, band, headline: meta.headline, why };
}

// Session-aware recommendation: how readiness should shape today's workout.
function advice(band, isHard, sessionTitle) {
  const s = sessionTitle || 'session';
  if (band === 'green') return isHard ? `Green light — attack today's ${s} as planned.` : `Good to go — enjoy today's ${s}.`;
  if (band === 'amber') return isHard ? `A little down — keep the hard efforts controlled, or swap ${s} for an easy aerobic session.` : `Keep ${s} relaxed today.`;
  return isHard ? `Recovery first — swap today's ${s} for easy aerobic or rest.` : `Take it very easy today, or rest.`;
}

// Render-ready description of the model for the in-app "How readiness works" page.
const MODEL = {
  start: 100,
  bands: BANDS,
  factors: FACTORS.map(f => ({ key: f.key, label: f.label, weight: f.weight, what: f.what, bands: f.bands })),
};

export const wellness = { load, save, upsert, latest, baseline, readiness, advice, fmtH, signed, MODEL };
