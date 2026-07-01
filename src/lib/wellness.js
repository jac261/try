/* Try — readiness & load from wellness data (intervals.icu-shaped).
 *
 * Pure scoring engine + a localStorage store of daily wellness records:
 *   { date, hrv, rhr, sleepH, sleepScore, ctl, atl, tsb }
 * CTL = Fitness, ATL = Fatigue, TSB = Form (CTL - ATL). The fields mirror
 * intervals.icu so a future backend sync can populate the same store.
 *
 * No data ships in the repo — records live only in the browser (try.wellness),
 * entered manually today or auto-synced once there's a backend proxy.
 */
window.TF = window.TF || {};
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

// Readiness score (0–100) + band + the drivers behind it. Each factor only
// contributes when its data is present, so partial inputs still produce a read.
function readiness(rec, base) {
  if (!rec) return null;
  let score = 100; const why = [];
  if (rec.hrv != null && base.hrvMean) {
    const z = (rec.hrv - base.hrvMean) / (base.hrvSd || 4), bm = Math.round(base.hrvMean);
    if (z < -1.5) { score -= 26; why.push({ bad: 1, t: `HRV ${rec.hrv} — well below your ${bm} baseline` }); }
    else if (z < -0.7) { score -= 12; why.push({ bad: 1, t: `HRV ${rec.hrv} — a little below your ${bm} baseline` }); }
    else if (z > 0.7) { score += 4; why.push({ bad: 0, t: `HRV ${rec.hrv} — above your ${bm} baseline` }); }
    else why.push({ bad: 0, t: `HRV ${rec.hrv} — around your ${bm} baseline` });
  }
  if (rec.sleepH != null) {
    const s = rec.sleepH;
    if (s < 5) { score -= 22; why.push({ bad: 1, t: `Only ${fmtH(s)} sleep` }); }
    else if (s < 6) { score -= 11; why.push({ bad: 1, t: `${fmtH(s)} sleep — a bit short` }); }
    else if (s < 7) { score -= 3; why.push({ bad: 0, t: `${fmtH(s)} sleep` }); }
    else why.push({ bad: 0, t: `${fmtH(s)} sleep — solid` });
  }
  if (rec.rhr != null && base.rhrMean) {
    const d = rec.rhr - base.rhrMean;
    if (d >= 7) { score -= 15; why.push({ bad: 1, t: `Resting HR ${rec.rhr} — ${Math.round(d)} above baseline` }); }
    else if (d >= 4) { score -= 8; why.push({ bad: 1, t: `Resting HR ${rec.rhr} — slightly raised` }); }
  }
  if (rec.tsb != null) {
    if (rec.tsb < -20) { score -= 14; why.push({ bad: 1, t: `Form ${signed(rec.tsb)} — carrying fatigue` }); }
    else if (rec.tsb < -10) { score -= 7; why.push({ bad: 1, t: `Form ${signed(rec.tsb)} — some fatigue` }); }
    else if (rec.tsb > 12) { score += 4; why.push({ bad: 0, t: `Form ${signed(rec.tsb)} — fresh` }); }
    else why.push({ bad: 0, t: `Form ${signed(rec.tsb)}` });
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const band = score >= 75 ? 'green' : score >= 55 ? 'amber' : 'red';
  const headline = band === 'green' ? 'Ready to roll' : band === 'amber' ? 'Ease into it' : 'Recover today';
  return { score, band, headline, why };
}

// Session-aware recommendation: how readiness should shape today's workout.
function advice(band, isHard, sessionTitle) {
  const s = sessionTitle || 'session';
  if (band === 'green') return isHard ? `Green light — attack today's ${s} as planned.` : `Good to go — enjoy today's ${s}.`;
  if (band === 'amber') return isHard ? `A little down — keep the hard efforts controlled, or swap ${s} for an easy aerobic session.` : `Keep ${s} relaxed today.`;
  return isHard ? `Recovery first — swap today's ${s} for easy aerobic or rest.` : `Take it very easy today, or rest.`;
}

export const wellness = { load, save, upsert, latest, baseline, readiness, advice, fmtH, signed };
