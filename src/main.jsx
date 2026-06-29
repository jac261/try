/* Try — React UI (Vite entry point).
   Domain modules are imported for their side effects: each attaches to the shared
   `window.TF` namespace, so they must load before this module's body runs. */
import './data.js';
import './plan.js';
import './fit.js';
import './wellness.js';
import './styles.css';
import { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

const T = window.TF;
const D = T.DISCIPLINES;

/* ---------------- persistence ---------------- */
const NS = 'try.';
// One-time migration: copy any legacy "triflow.*" data to "try.*" so saved plans
// survive the rename to Try. Only copies when the new key is absent.
['plan', 'log', 'moves'].forEach(k => {
  try { const old = localStorage.getItem('triflow.' + k); if (old != null && localStorage.getItem(NS + k) == null) localStorage.setItem(NS + k, old); } catch (e) {}
});
const LS = {
  load(k, fb) { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } },
  save(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} },
  clear() { ['plan', 'log', 'moves'].forEach(k => localStorage.removeItem(NS + k)); },
};

/* ---------------- scheduling helpers ----------------
   Reschedules are stored as an overlay map { workoutId: newDateISO } so the
   generated plan stays immutable. effDate() resolves a workout's shown date. */
function effDate(w, moves) { return (moves && moves[w.id]) || w.date; }
function weekRange(dateISO) {
  const mon = T.startOfWeekMonday(dateISO);
  return Array.from({ length: 7 }, (_, i) => T.iso(T.addDays(mon, i)));
}

// Auto-spread this week's missed (past, incomplete) sessions onto the emptiest
// upcoming days in the same week — the "adaptive catch-up" action.
function catchUpMoves(plan, log, moves) {
  const todayISO = T.iso(new Date());
  const week = weekRange(todayISO);
  const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest' && !w.race);
  const missed = all.filter(w => { const d = effDate(w, moves); return d < todayISO && d >= week[0] && !log[w.id]; });
  const next = Object.assign({}, moves);
  const occ = mv => { const m = {}; all.forEach(w => { const d = effDate(w, mv); m[d] = (m[d] || 0) + 1; }); return m; };
  missed.forEach(w => {
    const o = occ(next);
    const cands = week.filter(d => d >= todayISO).sort((a, b) => (o[a] || 0) - (o[b] || 0));
    next[w.id] = cands[0] || week[6];
  });
  return { next: next, count: missed.length };
}

// ---- adaptive pace tuning from post-session feedback ----
// Reviews how recent sessions (since the last baseline change) have felt, per
// discipline, and suggests a gentle pace nudge when a discipline trends one way.
// Workout types that genuinely tax the target paces. Easy / Long / Technique /
// Endurance (and recovery-week sessions, which downgrade to those) are *meant* to
// feel easy, so they don't signal that targets are too soft.
const INTENSITY_TYPES = { 'Tempo': 1, 'Threshold': 1, 'VO2 Intervals': 1, 'Sweet Spot': 1, 'CSS Intervals': 1, 'Race Pace': 1 };
function paceSuggestions(plan, log) {
  const since = plan.updatedAt || plan.createdAt || '0';
  const all = plan.weeks.flatMap(w => w.workouts).filter(w => INTENSITY_TYPES[w.type] && !w.test && !w.race);
  const byDisc = { run: [], bike: [], swim: [] };
  all.forEach(w => {
    const l = log[w.id];
    if (l && l.feel && l.at && l.at > since && byDisc[w.discipline]) byDisc[w.discipline].push(l.feel);
  });
  const out = [];
  ['run', 'bike', 'swim'].forEach(d => {
    if (d === 'bike' && !plan.profile.ftp) return;   // bike runs on RPE without an FTP — nothing to nudge
    const fs = byDisc[d];
    if (fs.length < 3) return;
    const easy = fs.filter(x => x === 'easy').length;
    const hard = fs.filter(x => x === 'hard').length;
    if (easy - hard >= 2) out.push({ discipline: d, direction: 'faster' });
    else if (hard - easy >= 2) out.push({ discipline: d, direction: 'easier' });
  });
  return out;
}

// Translate suggestions into adjusted baseline fields (~2% nudge each).
function tuneFields(profile, suggestions) {
  const lvl = T.FITNESS[profile.fitness] || T.FITNESS.intermediate;
  const fields = {};
  suggestions.forEach(s => {
    const t = s.direction === 'faster' ? 0.98 : 1.02;   // run/swim: less time = faster
    const w = s.direction === 'faster' ? 1.02 : 0.98;   // bike: more watts = faster
    if (s.discipline === 'run') fields.fivekSec = Math.round((profile.fivekSec || lvl.est5k) * t);
    if (s.discipline === 'swim') fields.css100Sec = Math.round((profile.css100Sec || lvl.estCss) * t);
    if (s.discipline === 'bike' && profile.ftp) fields.ftp = Math.round(profile.ftp * w);
  });
  return fields;
}

// ---- calendar (.ics) export ----
function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function buildICS(plan, moves) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Try//Triathlon//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  plan.weeks.forEach(week => week.workouts.forEach(w => {
    if (w.discipline === 'rest') return;
    const d = effDate(w, moves);
    const start = d.replace(/-/g, '');
    const end = T.iso(T.addDays(d, 1)).replace(/-/g, '');
    const sum = w.title + (w.durationMin ? ' (' + T.fmtDuration(w.durationMin) + ')' : '');
    const desc = w.segments.map(s => s.label + (s.detail ? ' — ' + s.detail : '') + (s.min ? ' [' + s.min + ' min]' : '')).join('\n');
    L.push('BEGIN:VEVENT', 'UID:try-' + w.id + '@try.app', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + start, 'DTEND;VALUE=DATE:' + end,
      'SUMMARY:' + icsEsc(sum), 'DESCRIPTION:' + icsEsc(desc), 'END:VEVENT');
  }));
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}
function downloadICS(plan, moves) {
  const blob = new Blob([buildICS(plan, moves)], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'try-' + plan.race + '-plan.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- minimalist line icons ----------------
   Monoline (stroke = currentColor) so they inherit text colour. */
const ICON_PATHS = {
  logo: '<path d="M12 3.2 20.4 18.6 3.6 18.6Z"/><circle cx="12" cy="13.4" r="1.6" fill="currentColor" stroke="none"/>',
  swim: '<circle cx="8.2" cy="7" r="2"/><path d="M10 7.6l2.8-2.5 3.4.8"/><path d="M3 10.9c1.2.9 2.4.9 3.6 0s2.4-.9 3.6 0 2.4.9 3.6 0 2.4-.9 3.6 0"/><path d="M3 14.3c1.2.9 2.4.9 3.6 0s2.4-.9 3.6 0 2.4.9 3.6 0 2.4-.9 3.6 0"/>',
  bike: '<circle cx="5.6" cy="16.4" r="3"/><circle cx="18.4" cy="16.4" r="3"/><path d="M5.6 16.4L9 9.6h7"/><path d="M9 9.6l2 6.8 5-7.4"/><path d="M16 9l2.4 7.4"/><path d="M7.7 9.3h2.5"/><path d="M14.7 8h2.7"/>',
  run: '<circle cx="15" cy="3.6" r="2.4" fill="currentColor" stroke="none"/><path fill="none" d="M14.3 7.2L11.4 13.6"/><path fill="none" d="M14.2 7.9l3.2 1l2.4-.4"/><path fill="none" d="M13.6 8L10 8.4l.8 3"/><path fill="none" d="M11.4 13.6l3 2v4.4"/><path fill="none" d="M11.4 13.6l-2 2.6-3 1.6"/><path fill="none" stroke-width="1.6" d="M5.4 8.2H2.6"/><path fill="none" stroke-width="1.6" d="M5 11.4H1.4"/><path fill="none" stroke-width="1.6" d="M5.6 14.4H3.2"/>',
  brick: '<path d="M4 9h13l-3.4-3.4"/><path d="M20 15H7l3.4 3.4"/>',
  rest: '<path d="M20 14.5A8.5 8.5 0 1 1 10 4 6.5 6.5 0 0 0 20 14.5Z"/>',
  strength: '<path d="M6 9 6 15"/><path d="M3.5 10.5 3.5 13.5"/><path d="M18 9 18 15"/><path d="M20.5 10.5 20.5 13.5"/><path d="M6 12 18 12"/>',
  today: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5 12 5"/><path d="M12 19 12 21.5"/><path d="M2.5 12 5 12"/><path d="M19 12 21.5 12"/><path d="M5.2 5.2 7 7"/><path d="M17 17 18.8 18.8"/><path d="M18.8 5.2 17 7"/><path d="M7 17 5.2 18.8"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5 20.5 9.5"/><path d="M8 3 8 6.5"/><path d="M16 3 16 6.5"/>',
  plan: '<rect x="4" y="5" width="16" height="15.5" rx="2.5"/><path d="M4 9.5h16"/><path d="M8.5 3v4"/><path d="M15.5 3v4"/><path d="M8.8 14l2 2 3.6-3.6"/>',
  progress: '<path d="M4 20.5 20 20.5"/><path d="M7 20.5 7 13"/><path d="M12 20.5 12 7"/><path d="M17 20.5 17 10"/>',
  you: '<circle cx="12" cy="8" r="4"/><path d="M5 20.4a7 7 0 0114 0"/>',
  bolt: '<path d="M13 2.5 5 13 11 13 10.5 21.5 19 10.5 12.5 10.5Z"/>',
  flag: '<path d="M6 21.5 6 3.5"/><path d="M6 4.5 17.5 4.5 14.6 8 17.5 11.5 6 11.5"/>',
  flame: '<path d="M12 3c.5 3.5 4.5 5 4.5 9.5a4.5 4.5 0 0 1-9 0c0-1.7.8-2.8 1.7-3.7.2 1.2 1 1.8 1.6 1.3C12 9 11 6.5 12 3Z"/>',
  download: '<path d="M12 3.5 12 14.5"/><path d="M7.5 10 12 14.5 16.5 10"/><path d="M5 20 19 20"/>',
  trend: '<path d="M3 16.5 9 10.5 13 14.5 21 6.5"/><path d="M15 6.5 21 6.5 21 12.5"/>',
  watch: '<rect x="7" y="6" width="10" height="12" rx="2.6"/><path d="M9 6 9.4 3 14.6 3 15 6"/><path d="M9 18 9.4 21 14.6 21 15 18"/><circle cx="12" cy="12" r="2.1"/>',
  // Rest of the triathlon set — available for tests, pace targets, routes, HR &
  // achievements (some map to roadmap features not yet wired into the UI).
  transition: '<path d="M4 9h13l-3.4-3.4"/><path d="M20 15H7l3.4 3.4"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.6"/><path d="M9.8 2.6h4.4"/><path d="M12 2.6v2.1"/><path d="M18.6 7.1l1.7-1.7"/>',
  route: '<path d="M12 21c4-4.5 6-7.6 6-10.6a6 6 0 10-12 0C6 13.4 8 16.5 12 21z"/><circle cx="12" cy="10.4" r="2.2"/>',
  heartrate: '<path d="M20.5 9.3c0 3.2-2.9 5.8-7.4 10l-1.1 1-1.1-1C6.4 15.1 3.5 12.5 3.5 9.3 3.5 6.7 5.5 4.7 8 4.7c1.6 0 3 .8 3.8 2 .9-1.2 2.3-2 3.9-2 2.5 0 4.8 2 4.8 4.6z"/><path d="M3.8 11.8H8l1.4-2.6 2 5 1.6-3.2h5.1"/>',
  pace: '<path d="M4.6 17a7.5 7.5 0 1114.8 0"/><path d="M12 17l4.2-4.2"/><circle cx="12" cy="17" r="1.2"/><path d="M4.6 17h1.4"/><path d="M18 17h1.4"/><path d="M12 9.6v1.4"/>',
  trophy: '<path d="M8 4.5h8v4.6a4 4 0 01-8 0z"/><path d="M8 5.6H5.2v1.7a3 3 0 002.9 3"/><path d="M16 5.6h2.8v1.7a3 3 0 01-2.9 3"/><path d="M12 13.5v3"/><path d="M9 20.5l.8-4h4.4l.8 4z"/><path d="M8.4 20.5h7.2"/>',
  settings: '<path d="M4 8h9"/><path d="M18 8h2"/><circle cx="15.5" cy="8" r="2.5"/><path d="M4 16h3"/><path d="M12 16h8"/><circle cx="9.5" cy="16" r="2.5"/>',
};
// New triathlon set is drawn for a uniform stroke-width of 2 (the app default);
// no per-icon weight overrides needed.
const ICON_BOLD = {};
function Icon({ name, size }) {
  const s = size || 22;
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={ICON_BOLD[name] || 2} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: 'block', flex: 'none' }}
    dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] || '' }} />;
}

/* ---------------- tiny SVG charts ---------------- */
// Hand-rolled bar chart in HTML/CSS. (An SVG with preserveAspectRatio="none"
// stretches non-uniformly to fill the width, which distorts text labels.)
function BarChart({ data, height }) {
  height = height || 150;
  const max = Math.max(1, ...data.map(d => d.planned));
  return (
    <div className="vchart" style={{ height }}>
      {data.map((d, i) => (
        <div className="vcol" key={i}>
          <div className="vplot">
            <div className="vtrack" style={{ height: (d.planned / max * 100) + '%' }} />
            <div className="vdone" style={{ height: (Math.min(d.done, d.planned) / max * 100) + '%', background: d.color || 'var(--accent)' }} />
          </div>
          <div className="vlabel">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function Donut({ segments, size }) {
  size = size || 150;
  const total = segments.reduce((a, b) => a + b.value, 0) || 1;
  const r = 60, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg viewBox="0 0 160 160" style={{ width: size, height: size }}>
      <g transform="rotate(-90 80 80)">
        {segments.map((s, i) => {
          const frac = s.value / total, len = frac * c;
          const el = <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={s.color} strokeWidth="26"
            strokeDasharray={len + ' ' + (c - len)} strokeDashoffset={-off} />;
          off += len; return el;
        })}
      </g>
      <text x="80" y="76" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">{Math.round(total)}</text>
      <text x="80" y="94" textAnchor="middle" fontSize="11" fill="var(--muted)">hrs total</text>
    </svg>
  );
}

// Sparkline: a small trend line where "better" always points up (so for pace
// metrics, where lower is better, the line is inverted).
function Sparkline({ values, betterDown, color }) {
  const W = 120, H = 40;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const norm = v => (betterDown ? (max - v) : (v - min)) / range;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * (W - 6) + 3;
    const y = H - 5 - norm(v) * (H - 10);
    return [x, y];
  });
  const path = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: W, height: H, flex: 'none' }} preserveAspectRatio="none">
      <polyline points={path} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  );
}

// Reconstruct each baseline's value over time from fitnessHistory + current value.
// history[i] holds the value that was active *before* history[i].date, so the value
// that became active at dates[i] is values[i] (current for the final point).
// Multi-series line/area chart (uniform-scaled SVG, no text → crisp at any width).
// series: [{ values:[], color, fill?, width? }]. Optional shaded `band` {lo, hi}.
function TrendChart({ series, height, band }) {
  const H = height || 100, W = 320, pad = 8;
  const vals = series.flatMap(s => s.values).filter(v => v != null).concat(band ? [band.lo, band.hi] : []);
  const min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
  const maxN = Math.max(...series.map(s => s.values.length));
  const X = i => (maxN <= 1 ? W / 2 : pad + (i / (maxN - 1)) * (W - 2 * pad));
  const Y = v => H - pad - ((v - min) / range) * (H - 2 * pad);
  const line = vs => vs.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  const area = vs => line(vs) + ' L' + X(vs.length - 1).toFixed(1) + ' ' + (H - pad) + ' L' + X(0).toFixed(1) + ' ' + (H - pad) + ' Z';
  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {band && <rect x={pad} y={Y(band.hi)} width={W - 2 * pad} height={Math.max(1, Y(band.lo) - Y(band.hi))} fill="var(--blue-soft)" rx="2" />}
      {series.map((s, i) => (
        <g key={i}>
          {s.fill && <path d={area(s.values)} fill={s.color} opacity="0.13" />}
          <path d={line(s.values)} fill="none" stroke={s.color} strokeWidth={s.width || 2.2} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={X(s.values.length - 1)} cy={Y(s.values[s.values.length - 1])} r="3" fill={s.color} />
        </g>
      ))}
    </svg>
  );
}

function fitnessSeries(profile, startDate) {
  const hist = profile.fitnessHistory || [];
  const series = key => {
    const dates = [startDate].concat(hist.map(h => h.date));
    const vals = hist.map(h => h[key]).concat([profile[key]]);
    const pts = [];
    for (let i = 0; i < vals.length; i++) if (vals[i] != null) pts.push({ date: dates[i], value: vals[i] });
    return pts;
  };
  return { run: series('fivekSec'), swim: series('css100Sec'), bike: series('ftp') };
}

// Sensible default training weekdays per count (0=Mon..6=Sun), matching the legacy layout.
const DEFAULT_DAYS = { 3: [1, 5, 6], 4: [0, 1, 3, 5], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Pick training days (≥3) and the long-session day. days = sorted weekday indices.
function DaySelector({ days, longDay, onChange }) {
  const toggle = d => {
    let nd = days.indexOf(d) >= 0 ? days.filter(x => x !== d) : days.concat([d]);
    if (nd.length < 3) return;                       // always keep at least 3 training days
    nd.sort((a, b) => a - b);
    let nl = longDay;
    if (nd.indexOf(nl) < 0) nl = nd.indexOf(5) >= 0 ? 5 : (nd.indexOf(6) >= 0 ? 6 : nd[nd.length - 1]);
    onChange(nd, nl);
  };
  return (
    <>
      <div className="days">
        {[0, 1, 2, 3, 4, 5, 6].map(d =>
          <div key={d} className={'d' + (days.indexOf(d) >= 0 ? ' on' : '')} onClick={() => toggle(d)}>{DAY_LETTERS[d]}</div>)}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>{days.length} training days · the rest are rest days</div>
      <label className="field" style={{ marginTop: 16, marginBottom: 0 }}><span className="lab">Long session day <span className="hint">your big ride / run</span></span></label>
      <div className="days" style={{ marginTop: 8 }}>
        {[0, 1, 2, 3, 4, 5, 6].map(d => {
          const sel = days.indexOf(d) >= 0;
          return <div key={d} className={'d' + (longDay === d ? ' on' : '')} onClick={() => sel && onChange(days, d)}
            style={{ opacity: sel ? 1 : .3, cursor: sel ? 'pointer' : 'default' }}>{DAY_LETTERS[d]}</div>;
        })}
      </div>
    </>
  );
}

/* ---------------- onboarding ---------------- */
function Onboarding({ onCreate }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    name: '', raceType: 'olympic', fitness: 'intermediate', trainingDays: [0, 1, 3, 5, 6], longDay: 5,
    raceDate: T.iso(T.addDays(new Date(), 84)), fivek: '', css100: '', ftp: '',
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  function finish() {
    onCreate({
      name: f.name.trim() || 'Athlete', raceType: f.raceType, fitness: f.fitness,
      trainingDays: f.trainingDays, longDay: f.longDay,
      daysPerWeek: f.trainingDays.length, raceDate: f.raceDate,
      fivekSec: T.parseTimeToSec(f.fivek), css100Sec: T.parseTimeToSec(f.css100),
      ftp: f.ftp ? Number(f.ftp) : null, startDate: T.iso(new Date()),
    });
  }

  return (
    <div className="app">
      <div className="topbar"><h1><Icon name="logo" size={24} /> Try</h1><div className="sub">Your personalised triathlon coach</div></div>
      <div className="card">
        {step === 0 && <>
          <h2>Let's build your plan</h2>
          <p className="lead">Three quick steps and you'll have a full periodised plan to race day.</p>
          <label className="field"><span className="lab">What should we call you?</span>
            <input value={f.name} placeholder="Your name" onChange={e => set('name', e.target.value)} /></label>
          <label className="field"><span className="lab">Which race are you training for?</span></label>
          <div className="choice">
            {Object.values(T.RACES).map(r => (
              <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} onClick={() => set('raceType', r.key)}>
                {r.name}<small>{r.swim}k swim · {r.bike}k bike · {r.run}k run</small></div>
            ))}
          </div>
          <div style={{ height: 12 }} />
          <button className="btn primary" onClick={() => setStep(1)}>Continue</button>
        </>}

        {step === 1 && <>
          <h2>Schedule & experience</h2>
          <p className="lead">This shapes your volume, intensity and ramp rate.</p>
          <label className="field"><span className="lab">Race date</span>
            <input type="date" value={f.raceDate} onChange={e => set('raceDate', e.target.value)} /></label>
          <label className="field" style={{ marginBottom: 8 }}><span className="lab">Which days will you train?</span></label>
          <DaySelector days={f.trainingDays} longDay={f.longDay} onChange={(d, l) => setF(s => ({ ...s, trainingDays: d, longDay: l }))} />
          <div style={{ height: 18 }} />
          <label className="field"><span className="lab">Experience level</span></label>
          <div className="choice">
            {Object.values(T.FITNESS).map(l => (
              <div key={l.key} className={'opt' + (f.fitness === l.key ? ' on' : '')} onClick={() => set('fitness', l.key)}>{l.name}<small>{l.blurb}</small></div>
            ))}
          </div>
          <div style={{ height: 12 }} />
          <div className="row"><button className="btn ghost" onClick={() => setStep(0)}>Back</button>
            <button className="btn primary" onClick={() => setStep(2)}>Continue</button></div>
        </>}

        {step === 2 && <>
          <h2>Your current fitness <span className="hint" style={{ fontWeight: 500 }}>· optional</span></h2>
          <p className="lead"><b>New to triathlon? You can skip all of these.</b> We'll then guide every session by effort (RPE / heart-rate zones), with ballpark paces estimated from your {T.FITNESS[f.fitness].name} level. Add any numbers you do know to make it precise.</p>
          <label className="field"><span className="lab">Recent 5 km run time <span className="hint">optional · mm:ss</span></span>
            <input value={f.fivek} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].est5k)} onChange={e => set('fivek', e.target.value)} /></label>
          <label className="field"><span className="lab">Swim pace per 100 m <span className="hint">optional · mm:ss</span></span>
            <input value={f.css100} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].estCss)} onChange={e => set('css100', e.target.value)} /></label>
          <label className="field"><span className="lab">Cycling FTP <span className="hint">optional · watts</span></span>
            <input value={f.ftp} placeholder="e.g. 200" inputMode="numeric" onChange={e => set('ftp', e.target.value)} /></label>
          <div className="row"><button className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary" onClick={finish}>Generate plan →</button></div>
        </>}
      </div>
      <div className="center muted" style={{ fontSize: 12 }}>Step {step + 1} of 3</div>
    </div>
  );
}

/* ---------------- workout row + detail ---------------- */
function WorkoutRow({ w, done, onClick, eff, moved }) {
  if (w.discipline === 'rest') return (
    <div className="wk" style={{ opacity: .6, cursor: 'default' }}>
      <div className="dot" style={{ background: 'var(--rest)' }}><Icon name="rest" size={22} /></div>
      <div className="meta"><div className="t">Rest day</div><div className="s">Recover & adapt</div></div>
    </div>
  );
  const disc = D[w.discipline];
  return (
    <div className={'wk' + (done ? ' done' : '')} onClick={onClick}>
      <div className="dot" style={{ background: disc.grad }}><Icon name={disc.icon} size={22} /></div>
      <div className="meta">
        <div className="t">{w.title} {w.test ? <span className="tag test">Test</span> : (w.key && !w.race && <span className="tag key">Key</span>)}{w.second && <span className="tag second">2nd</span>}{w.eased && <span className="tag eased">Eased</span>}{moved && <span className="tag moved">Moved</span>}</div>
        <div className="s">{w.type}{w.distance ? ' · ' + w.distance + ' ' + w.unit : ''} · {T.fmtDuration(w.durationMin || 0)}</div>
      </div>
      <div className="right">{T.fmtDate(eff || w.date, { weekday: 'short' })}</div>
      <div className="check">✓</div>
    </div>
  );
}

// One-line "why this session" coaching note, keyed by workout type.
const WHY = {
  'Easy': 'Build your aerobic base. Keep it conversational — easy enough to chat the whole way.',
  'Long': 'Build endurance for race day. Stay aerobic and relaxed, and practise your fuelling.',
  'Tempo': 'Raise the pace you can hold for the long haul. Settle into a steady "comfortably hard" effort.',
  'Threshold': 'Lift your threshold — the effort you could just sustain for an hour. Strong and controlled, never all-out.',
  'VO2 Intervals': 'Sharpen your top-end fitness. Commit to the target pace on every rep, then recover fully.',
  'Endurance': 'Lay down aerobic base on the bike. Smooth, steady and mostly Zone 2.',
  'Sweet Spot': 'Big aerobic and threshold gains for the time spent. Sustained, just below threshold.',
  'Technique': 'Groove efficient form while fresh. Focus on a clean catch and a long, balanced body line.',
  'CSS Intervals': 'Build sustainable swim speed. Hold your CSS pace — smooth and controlled, not a sprint.',
  'Race Pace': 'Rehearse race effort so it feels familiar. Strong and relaxed at your goal pace.',
  'Brick': 'Teach your legs to run off the bike. Expect heaviness at first — find your run rhythm quickly.',
  'Strength': 'Build durability and power to resist fatigue and injury. Quality over quantity — move well, brace your core.',
  'Open Water': 'Rehearse race-day swimming. Practise sighting, drafting and holding a straight line without walls to push off.',
};

function DetailSheet({ w, plan, done, onClose, onToggle, eff, onMove, onResetMove, onLogResult, feel, onFeel, onRestore }) {
  const canFit = T.FIT && T.FIT.supports(w);
  const disc = D[w.discipline];
  const why = !w.race && !w.test ? WHY[w.type] : null;
  const shown = eff || w.date;
  const moved = shown !== w.date;
  const days = weekRange(w.date);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="hero">
          <div className="dot" style={{ background: disc.grad }}><Icon name={disc.icon} size={26} /></div>
          <div><h2>{w.title}</h2><div className="s">{T.fmtDate(shown, { weekday: 'long', month: 'long', day: 'numeric' })} · {w.phase} phase</div></div>
        </div>
        {w.eased && <div className="testnote"><Icon name="heartrate" size={18} /><span>Eased from your planned {w.easedFrom} session for recovery. {onRestore && <a className="reset" onClick={onRestore}>Restore the hard session</a>}</span></div>}
        {!w.race && <div className="statline">
          <div className="s"><b>{T.fmtDuration(w.durationMin || 0)}</b><span>Duration</span></div>
          {w.distance && <div className="s"><b>{w.distance}</b><span>{w.unit}</span></div>}
          <div className="s"><b>{disc.name}</b><span>{w.type}</span></div>
        </div>}
        {why && <div className="why" style={{ borderColor: disc.color }}><span className="why-label">Why this session</span>{why}</div>}
        <div className="section-title" style={{ margin: '8px 0 2px' }}>{w.race ? 'Race plan' : 'Workout'}</div>
        {w.segments.map((s, i) => (
          <div className="seg" key={i}>
            <div className="bar" style={{ background: disc.color }} />
            <div><div className="l">{s.label}</div><div className="d">{s.detail}</div></div>
            {s.min ? <div className="m">{s.min} min</div> : null}
          </div>
        ))}
        {!w.race && onMove && <>
          <div className="section-title" style={{ margin: '18px 0 8px' }}>Reschedule
            {moved && <a className="reset" onClick={() => onResetMove(w.id)}> ↺ reset</a>}</div>
          <div className="days">
            {days.map((d, i) => {
              const lab = ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i];
              return <div key={d} className={'d' + (d === shown ? ' on' : '')} onClick={() => onMove(w.id, d)}>
                <div style={{ fontSize: 10, fontWeight: 600, opacity: .7 }}>{lab}</div>
                {Number(d.slice(8))}</div>;
            })}
          </div>
        </>}
        <div style={{ height: 16 }} />
        {w.test && w.note && <div className="testnote"><Icon name="stopwatch" size={18} /><span>{w.note}</span></div>}
        {w.test && onLogResult && <><button className="btn primary" onClick={onLogResult}><Icon name="trend" size={18} /> Log result &amp; re-target</button><div style={{ height: 10 }} /></>}
        {!w.race && <button className={'btn ' + (done ? 'done' : (w.test ? 'ghost' : 'primary'))} onClick={onToggle}>
          {done ? '✓ Completed — tap to undo' : 'Mark as complete'}</button>}
        {canFit && <>
          <div style={{ height: 10 }} />
          <button className="btn ghost" onClick={() => T.FIT.download(w, plan)}>
            <Icon name="watch" size={18} /> Send to watch (.FIT)</button>
          <div className="fithint">Structured workout with {w.discipline === 'bike' ? (plan.paces.ftp ? 'power' : 'effort (RPE)') : 'pace'} targets — load onto a Garmin to follow it step by step.</div>
        </>}
        {done && !w.race && onFeel && <div className="feel">
          <div className="feel-q">How did it feel?</div>
          <div className="feel-row">
            {[['easy', 'Easy'], ['right', 'Just right'], ['hard', 'Hard']].map(([k, lab]) =>
              <button key={k} className={'feelbtn' + (feel === k ? ' on ' + k : '')} onClick={() => onFeel(w.id, k)}>{lab}</button>)}
          </div>
        </div>}
        {w.race && <div className="card center" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)', margin: 0 }}><b style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name="trophy" size={18} /> You've got this.</b></div>}
      </div>
    </div>
  );
}

/* ---------------- update-fitness editor ---------------- */
function FitnessEditor({ profile, onClose, onSave }) {
  const lvl0 = T.FITNESS[profile.fitness] ? profile.fitness : 'intermediate';
  const [f, setF] = useState({
    fitness: lvl0,
    fivek: profile.fivekSec ? T.fmtPace(profile.fivekSec) : '',
    css100: profile.css100Sec ? T.fmtPace(profile.css100Sec) : '',
    ftp: profile.ftp || '',
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>Update fitness</h2>
        <p className="lead">Logged a test, race or just got fitter? Update your numbers and every <b>upcoming</b> session re-targets to the new paces. Completed sessions and reschedules stay put.</p>
        <label className="field"><span className="lab">Experience level</span></label>
        <div className="choice">
          {Object.values(T.FITNESS).map(l => (
            <div key={l.key} className={'opt' + (f.fitness === l.key ? ' on' : '')} onClick={() => set('fitness', l.key)}>{l.name}<small>{l.blurb}</small></div>
          ))}
        </div>
        <div style={{ height: 16 }} />
        <label className="field"><span className="lab">Recent 5 km run time <span className="hint">optional · mm:ss</span></span>
          <input value={f.fivek} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].est5k)} onChange={e => set('fivek', e.target.value)} /></label>
        <label className="field"><span className="lab">Swim pace per 100 m <span className="hint">optional · mm:ss</span></span>
          <input value={f.css100} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].estCss)} onChange={e => set('css100', e.target.value)} /></label>
        <label className="field"><span className="lab">Cycling FTP <span className="hint">optional · watts</span></span>
          <input value={f.ftp} placeholder="e.g. 200" inputMode="numeric" onChange={e => set('ftp', e.target.value)} /></label>
        <button className="btn primary" onClick={() => onSave({
          fitness: f.fitness,
          fivekSec: T.parseTimeToSec(f.fivek),
          css100Sec: T.parseTimeToSec(f.css100),
          ftp: f.ftp ? Number(f.ftp) : null,
        })}>Save &amp; re-target plan</button>
      </div>
    </div>
  );
}

/* ---------------- edit-plan (race / schedule) editor ---------------- */
function PlanSettingsEditor({ profile, onClose, onSave }) {
  const initDays = (profile.trainingDays && profile.trainingDays.length >= 3)
    ? profile.trainingDays.slice().sort((a, b) => a - b)
    : (DEFAULT_DAYS[Math.max(3, Math.min(7, profile.daysPerWeek))] || DEFAULT_DAYS[5]);
  const initLong = (profile.longDay !== undefined && initDays.indexOf(profile.longDay) >= 0)
    ? profile.longDay : (initDays.indexOf(5) >= 0 ? 5 : initDays[initDays.length - 1]);
  const [f, setF] = useState({
    raceType: profile.raceType,
    raceDate: T.iso(profile.raceDate),
    trainingDays: initDays,
    longDay: initLong,
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const todayISO = T.iso(new Date());
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>Edit plan</h2>
        <p className="lead">Change your race or schedule and the plan rebuilds around it. Completed sessions and reschedules are kept for the days that still exist; your fitness, paces and progress carry over.</p>
        <label className="field"><span className="lab">Race</span></label>
        <div className="choice">
          {Object.values(T.RACES).map(r => (
            <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} onClick={() => set('raceType', r.key)}>{r.name}<small>{r.swim}k · {r.bike}k · {r.run}k</small></div>
          ))}
        </div>
        <div style={{ height: 16 }} />
        <label className="field"><span className="lab">Race date</span>
          <input type="date" value={f.raceDate} min={todayISO} onChange={e => set('raceDate', e.target.value)} /></label>
        <label className="field" style={{ marginBottom: 8 }}><span className="lab">Which days will you train?</span></label>
        <DaySelector days={f.trainingDays} longDay={f.longDay} onChange={(d, l) => setF(s => ({ ...s, trainingDays: d, longDay: l }))} />
        <div style={{ height: 18 }} />
        <button className="btn primary" onClick={() => onSave({ raceType: f.raceType, raceDate: f.raceDate, daysPerWeek: f.trainingDays.length, trainingDays: f.trainingDays, longDay: f.longDay })}>Save &amp; rebuild plan</button>
      </div>
    </div>
  );
}

/* ---------------- views ---------------- */
/* ---------------- readiness (wellness-driven) ---------------- */
function ReadinessRing({ score, band }) {
  const r = 26, c = 2 * Math.PI * r;
  const col = band === 'green' ? 'var(--run)' : band === 'amber' ? 'var(--bike)' : 'var(--danger)';
  return (
    <svg width="74" height="74" viewBox="0 0 72 72" style={{ flex: 'none' }}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--track)" strokeWidth="6" />
      <circle cx="36" cy="36" r={r} fill="none" stroke={col} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={(score / 100 * c) + ' ' + c} transform="rotate(-90 36 36)" />
      <text x="36" y="41" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--ink)">{score}</text>
    </svg>
  );
}

function ReadinessCard({ wellness, today, onEdit, onEase, onRestore }) {
  const todayISO = T.iso(new Date());
  const rec = wellness.find(r => r.date === todayISO) || (wellness.length ? wellness[wellness.length - 1] : null);
  if (!rec) {
    return (
      <div className="banner rd-empty" onClick={onEdit}>
        <div className="bi"><Icon name="heartrate" size={20} /></div>
        <div><div className="bt">Add your morning readiness</div>
          <div className="bs">Log HRV, sleep &amp; resting HR for a daily go / ease / recover call →</div></div>
      </div>
    );
  }
  const base = T.wellness.baseline(wellness, todayISO);
  const rd = T.wellness.readiness(rec, base);
  const eased = today.find(w => w.eased);
  const hard = today.find(w => INTENSITY_TYPES[w.type]);
  const sessTitle = (hard || eased || today.find(w => w.discipline !== 'rest') || {}).title;
  const adv = T.wellness.advice(rd.band, !!hard, today.length && sessTitle ? sessTitle : 'rest day');
  const stale = rec.date !== todayISO;
  return (
    <div className={'card rd rd-' + rd.band}>
      <div className="rd-top">
        <ReadinessRing score={rd.score} band={rd.band} />
        <div className="rd-main">
          <div className="rd-headline">{rd.headline}</div>
          <div className="rd-advice">{adv}</div>
        </div>
      </div>
      {eased
        ? <div className="rd-eased"><Icon name="rest" size={15} /> Today eased to {eased.title} for recovery · <a className="reset" onClick={onRestore}>undo</a></div>
        : (!stale && rd.band !== 'green' && hard && <button className="btn ghost sm rd-action" onClick={onEase}>Ease today's {hard.title} → easy aerobic</button>)}
      <div className="rd-why">
        {rd.why.map((w, i) => <span key={i} className={'rd-chip' + (w.bad ? ' bad' : '')}>{w.t}</span>)}
      </div>
      {(rec.ctl != null || rec.tsb != null) && <div className="rd-pmc">
        {rec.ctl != null && <div><b>{Math.round(rec.ctl)}</b><span>Fitness</span></div>}
        {rec.atl != null && <div><b>{Math.round(rec.atl)}</b><span>Fatigue</span></div>}
        {rec.tsb != null && <div><b>{T.wellness.signed(rec.tsb)}</b><span>Form</span></div>}
      </div>}
      <div className="rd-foot">
        <span>{stale ? 'From ' + T.fmtDate(rec.date, { month: 'short', day: 'numeric' }) : 'This morning'}</span>
        <a className="reset" onClick={onEdit}>Update →</a>
      </div>
    </div>
  );
}

function WellnessEditor({ onClose, onSave }) {
  const [f, setF] = useState({ hrv: '', sleepH: '', rhr: '', tsb: '' });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const num = v => (v === '' || v == null ? null : Number(v));
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="hero"><div className="dot" style={{ background: D.run.grad }}><Icon name="heartrate" size={26} /></div>
          <div><h2>This morning's readiness</h2><div className="s">From your watch or intervals.icu</div></div></div>
        <label className="field"><span className="lab">HRV <span className="hint">ms · overnight</span></span>
          <input type="number" inputMode="numeric" value={f.hrv} onChange={e => set('hrv', e.target.value)} placeholder="e.g. 56" /></label>
        <label className="field"><span className="lab">Sleep <span className="hint">hours</span></span>
          <input type="number" inputMode="decimal" step="0.1" value={f.sleepH} onChange={e => set('sleepH', e.target.value)} placeholder="e.g. 7.5" /></label>
        <label className="field"><span className="lab">Resting HR <span className="hint">bpm</span></span>
          <input type="number" inputMode="numeric" value={f.rhr} onChange={e => set('rhr', e.target.value)} placeholder="e.g. 51" /></label>
        <label className="field"><span className="lab">Form / TSB <span className="hint">optional · from intervals.icu</span></span>
          <input type="number" inputMode="numeric" value={f.tsb} onChange={e => set('tsb', e.target.value)} placeholder="e.g. 12" /></label>
        <button className="btn primary" onClick={() => onSave({ date: T.iso(new Date()), hrv: num(f.hrv), sleepH: num(f.sleepH), rhr: num(f.rhr), tsb: num(f.tsb) })}>Save readiness</button>
        <div className="fithint">Auto-sync from intervals.icu arrives with the backend. For now, pop in this morning's numbers.</div>
      </div>
    </div>
  );
}

function TodayView({ plan, log, moves, open, onCatchUp, onTune, wellness, onEditWellness, easedOf, onEaseToday, onRestoreToday }) {
  const todayISO = T.iso(new Date());
  const all = plan.weeks.flatMap(w => w.workouts);
  const sessions = all.filter(w => w.discipline !== 'rest' && !w.race);
  const today = all.filter(w => effDate(w, moves) === todayISO);
  const upcoming = sessions.filter(w => effDate(w, moves) > todayISO)
    .sort((a, b) => effDate(a, moves) < effDate(b, moves) ? -1 : 1).slice(0, 4);
  const curWeek = plan.weeks.find(w => w.workouts.some(x => x.date >= todayISO)) || plan.weeks[plan.weeks.length - 1];
  const weekStart = weekRange(todayISO)[0];
  const missed = sessions.filter(w => { const d = effDate(w, moves); return d < todayISO && d >= weekStart && !log[w.id]; });
  const suggestions = paceSuggestions(plan, log);
  const row = w => <WorkoutRow key={w.id} w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} />;

  return (
    <>
      <div className="section-title">Today's readiness</div>
      <ReadinessCard wellness={wellness} today={today.map(easedOf)} onEdit={onEditWellness} onEase={onEaseToday} onRestore={onRestoreToday} />
      {missed.length > 0 && <div className="banner" onClick={onCatchUp}>
        <div className="bi"><Icon name="bolt" size={20} /></div>
        <div><div className="bt">{missed.length} session{missed.length > 1 ? 's' : ''} missed this week</div>
          <div className="bs">Tap to reschedule onto your free days →</div></div>
      </div>}
      {suggestions.length > 0 && <div className="banner tune" onClick={onTune}>
        <div className="bi"><Icon name="pace" size={20} /></div>
        <div><div className="bt">Time to tune your paces</div>
          <div className="bs">{suggestions.map(s => D[s.discipline].name + (s.direction === 'faster' ? ' feels easy' : ' feels hard')).join(' · ')} — tap to adjust →</div></div>
      </div>}
      <div className="section-title">Today · {T.fmtDate(todayISO, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      <div className="card">
        {today.length === 0 ? <div className="empty"><div className="big"><Icon name="rest" size={40} /></div>No session scheduled today.</div>
          : today.map(row)}
      </div>
      {curWeek && <div className="card">
        <div className="row"><div><h2 style={{ margin: 0 }}>Week {curWeek.index + 1} of {plan.totalWeeks}</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{curWeek.phase} · {T.PHASE_INFO[curWeek.phase].blurb}</div></div>
          <div className="spacer" /><div className="center"><div style={{ fontSize: 22, fontWeight: 700 }}>{T.fmtDuration(curWeek.totalMin)}</div>
            <div className="muted" style={{ fontSize: 11 }}>planned</div></div></div>
      </div>}
      <div className="section-title">Coming up</div>
      <div className="card">
        {upcoming.length ? upcoming.map(row)
          : <div className="empty"><div className="big"><Icon name="trophy" size={40} /></div>All done — race time!</div>}
      </div>
    </>
  );
}

function CalendarView({ plan, log, moves, open, easedOf }) {
  const todayISO = T.iso(new Date());
  const firstFuture = plan.weeks.findIndex(w => w.workouts.some(x => x.date >= todayISO));
  const [openWeek, setOpenWeek] = useState(firstFuture < 0 ? 0 : firstFuture);

  return (
    <>
      <div className="section-title">Training calendar</div>
      {plan.weeks.map(week => {
        const isOpen = week.index === openWeek;
        const pi = T.PHASE_INFO[week.phase];
        const sessions = week.workouts.filter(w => w.discipline !== 'rest');
        const doneCount = sessions.filter(w => log[w.id]).length;
        const ordered = week.workouts.slice().sort((a, b) => effDate(a, moves) < effDate(b, moves) ? -1 : 1);
        return (
          <div className="card" key={week.index} style={{ padding: '14px 16px' }}>
            <div className="weekhdr" onClick={() => setOpenWeek(isOpen ? -1 : week.index)} style={{ cursor: 'pointer' }}>
              <div><div className="ttl">Week {week.index + 1} {week.isRecovery && <span className="tag recovery">Recovery</span>}</div>
                <div className="muted" style={{ fontSize: 12 }}>{T.fmtDate(week.start, { month: 'short', day: 'numeric' })} · {sessions.length} sessions · {T.fmtDuration(week.totalMin)}</div></div>
              <div className="ph" style={{ background: pi.color }}>{week.phase}</div>
            </div>
            <div className="weekbar"><span style={{ width: (sessions.length ? doneCount / sessions.length * 100 : 0) + '%', background: 'var(--accent)' }} /></div>
            {isOpen && <div style={{ marginTop: 8 }}>
              {ordered.map(w => <WorkoutRow key={w.id} w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} />)}
            </div>}
          </div>
        );
      })}
    </>
  );
}

function PlanView({ plan }) {
  const phaseGroups = useMemo(() => {
    const g = [];
    plan.weeks.forEach(w => {
      const last = g[g.length - 1];
      if (last && last.phase === w.phase) { last.weeks++; last.min += w.totalMin; }
      else g.push({ phase: w.phase, weeks: 1, min: w.totalMin, start: w.index });
    });
    return g;
  }, [plan]);
  const totalHrs = Math.round(plan.weeks.reduce((a, b) => a + b.totalMin, 0) / 60);
  const race = T.RACES[plan.race];

  return (
    <>
      <div className="section-title">Plan overview</div>
      <div className="card">
        <h2>{race.name} Triathlon</h2>
        <p className="lead">{plan.totalWeeks}-week build · {totalHrs} total training hours · {plan.profile.daysPerWeek} days/week</p>
        {phaseGroups.map((g, i) => {
          const pi = T.PHASE_INFO[g.phase];
          return (
            <div className="seg" key={i} style={{ alignItems: 'center' }}>
              <div className="bar" style={{ background: pi.color, height: 38 }} />
              <div><div className="l">{g.phase} <span className="muted">· {g.weeks} {g.weeks === 1 ? 'week' : 'weeks'}</span></div>
                <div className="d">{pi.blurb}</div></div>
              <div className="m">{T.fmtDuration(g.min)}</div>
            </div>
          );
        })}
      </div>
      <div className="section-title">How your week is structured</div>
      <div className="card">
        <p className="lead">Built from your {plan.profile.daysPerWeek} available days, balancing all three disciplines with key long & brick sessions on weekends.</p>
        <div className="legend">
          {['swim', 'bike', 'run', 'brick'].map(k => (
            <div className="li" key={k}><i style={{ background: D[k].color }} />{D[k].name}</div>
          ))}
        </div>
      </div>
    </>
  );
}

// Fitness/Form (PMC) + recovery (HRV / sleep) trends from the wellness store.
function WellnessTrends({ wellness }) {
  const w = wellness.filter(r => r.ctl != null || r.hrv != null);
  if (w.length < 2) return (
    <>
      <div className="section-title">Fitness &amp; recovery</div>
      <div className="card"><div className="empty" style={{ padding: '22px 16px' }}>
        <div className="big"><Icon name="heartrate" size={32} /></div>
        Log a few days of readiness (or connect intervals.icu) and your Fitness, Form &amp; HRV trends will appear here.
      </div></div>
    </>
  );
  const last = w[w.length - 1], first = w[0];
  const num = (arr, k) => arr.map(r => r[k]).filter(v => v != null);
  const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const ctl = num(w, 'ctl'), atl = num(w, 'atl'), hrv = num(w, 'hrv');
  const tsb = last.tsb != null ? last.tsb : (last.ctl != null && last.atl != null ? last.ctl - last.atl : null);
  const ctlD = (last.ctl != null && first.ctl != null) ? last.ctl - first.ctl : null;
  const base = T.wellness.baseline(wellness, T.iso(new Date()));
  const sleepAvg = avg(num(w, 'sleepH')), rhrAvg = avg(num(w, 'rhr'));
  const formLabel = tsb == null ? '' : (tsb > 8 ? ' · fresh' : tsb < -10 ? ' · fatigued' : ' · neutral');
  return (
    <>
      <div className="section-title">Fitness &amp; Form <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>last {w.length} days</span></div>
      <div className="card">
        <div className="rd-pmc" style={{ marginTop: 0, marginBottom: 14 }}>
          <div><b>{Math.round(last.ctl)}</b><span>Fitness{ctlD != null ? ' ' + T.wellness.signed(ctlD) : ''}</span></div>
          <div><b>{Math.round(last.atl)}</b><span>Fatigue</span></div>
          <div><b>{tsb != null ? T.wellness.signed(tsb) : '—'}</b><span>Form{formLabel}</span></div>
        </div>
        {ctl.length >= 2 && <TrendChart height={104} series={[
          { values: ctl, color: 'var(--blue)', fill: true, width: 2.4 },
          { values: atl, color: 'var(--muted)', width: 1.8 },
        ]} />}
        <div className="chart-legend"><span><i style={{ background: 'var(--blue)' }} />Fitness (CTL)</span><span><i style={{ background: 'var(--muted)' }} />Fatigue (ATL)</span><span className="dim">gap = Form</span></div>
      </div>

      <div className="section-title">Recovery</div>
      <div className="card">
        <div className="rd-pmc" style={{ marginTop: 0, marginBottom: 14 }}>
          <div><b>{last.hrv != null ? last.hrv : '—'}</b><span>HRV{base.hrvMean ? ' · base ' + Math.round(base.hrvMean) : ''}</span></div>
          <div><b>{rhrAvg != null ? Math.round(rhrAvg) : '—'}</b><span>Rest HR avg</span></div>
          <div><b>{sleepAvg != null ? T.wellness.fmtH(sleepAvg) : '—'}</b><span>Sleep avg</span></div>
        </div>
        {hrv.length >= 2 && <TrendChart height={96}
          band={base.hrvMean ? { lo: base.hrvMean - base.hrvSd, hi: base.hrvMean + base.hrvSd } : null}
          series={[{ values: hrv, color: 'var(--run)', width: 2.4 }]} />}
        <div className="chart-legend"><span><i style={{ background: 'var(--run)' }} />HRV</span><span className="dim">shaded = your baseline range</span></div>
      </div>
    </>
  );
}

function ProgressView({ plan, log, wellness }) {
  const todayISO = T.iso(new Date());
  const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest' && !w.race);
  const done = all.filter(w => log[w.id]);
  const daysToRace = Math.max(0, T.daysBetween(new Date(), plan.profile.raceDate));
  const pct = all.length ? Math.round(done.length / all.length * 100) : 0;

  // weekly bars
  const bars = plan.weeks.map(w => {
    const sess = w.workouts.filter(x => x.discipline !== 'rest' && !x.race);
    const planned = sess.reduce((a, b) => a + b.durationMin, 0) / 60;
    const dn = sess.filter(x => log[x.id]).reduce((a, b) => a + b.durationMin, 0) / 60;
    return { label: w.index % 2 === 0 ? (w.index + 1) : '', planned, done: dn, color: 'var(--accent)' };
  });

  // discipline split (hours)
  const split = {};
  all.forEach(w => { const k = w.discipline; split[k] = (split[k] || 0) + w.durationMin / 60; });
  const donut = Object.keys(split).map(k => ({ label: D[k].name, value: split[k], color: D[k].color }));

  // current streak (consecutive completed sessions up to today, backwards)
  const pastSessions = all.filter(w => w.date <= todayISO).sort((a, b) => b.date < a.date ? 1 : -1);
  let streak = 0;
  for (let i = pastSessions.length - 1; i >= 0; i--) { if (log[pastSessions[i].id]) streak++; else break; }

  const thisWeek = plan.weeks.find(w => w.workouts.some(x => x.date >= todayISO)) || plan.weeks[plan.weeks.length - 1];
  const twSess = thisWeek.workouts.filter(x => x.discipline !== 'rest' && !x.race);
  const twDone = twSess.filter(x => log[x.id]).length;

  // fitness progression (from fitnessHistory snapshots + current baselines)
  const startISO = plan.profile.startDate || (plan.createdAt || '').slice(0, 10) || todayISO;
  const series = fitnessSeries(plan.profile, startISO);
  const METRICS = [
    { key: 'run', label: 'Run · 5k pace', fmt: v => T.fmtPace(v / 5) + ' /km', div: 5, color: D.run.color, betterDown: true },
    { key: 'swim', label: 'Swim · CSS', fmt: v => T.fmtPace(v) + ' /100m', div: 1, color: D.swim.color, betterDown: true },
    { key: 'bike', label: 'Bike · FTP', fmt: v => v + ' W', color: D.bike.color, betterDown: false },
  ];
  const trends = METRICS.map(m => {
    const pts = series[m.key];
    if (!pts.length) return null;
    const first = pts[0].value, latest = pts[pts.length - 1].value, changed = latest !== first;
    const improved = m.betterDown ? latest < first : latest > first;
    let deltaStr = null;
    if (changed) {
      const d = Math.abs(latest - first);
      deltaStr = m.key === 'bike' ? (improved ? '+' : '−') + d + ' W'
        : T.fmtPace(d / m.div) + (improved ? ' faster' : ' slower');
    }
    return { key: m.key, label: m.label, color: m.color, betterDown: m.betterDown, vals: pts.map(p => p.value), latest: m.fmt(latest), changed, improved, deltaStr };
  }).filter(Boolean);

  return (
    <>
      <div className="section-title">Progress</div>
      <div className="kpis">
        <div className="kpi"><div className="v">{daysToRace}<small> days</small></div><div className="k">Until race day</div></div>
        <div className="kpi"><div className="v">{pct}<small>%</small></div><div className="k">Sessions completed</div></div>
        <div className="kpi"><div className="v">{done.length}<small>/{all.length}</small></div><div className="k">Workouts done</div></div>
        <div className="kpi"><div className="v" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{streak}<Icon name="flame" size={22} /></div><div className="k">Current streak</div></div>
      </div>

      <div className="section-title">Weekly volume <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(planned vs completed)</span></div>
      <div className="card"><BarChart data={bars} height={160} /></div>

      <div className="section-title">Fitness progression</div>
      {trends.length === 0 ? (
        <div className="card"><div className="empty" style={{ padding: '24px 16px' }}><div className="big"><Icon name="trend" size={34} /></div>Log a benchmark test or update your fitness, and your pace &amp; power trends will appear here.</div></div>
      ) : (
        <div className="card">
          {trends.map(t => (
            <div className="trend" key={t.key}>
              <div className="trend-info">
                <div className="trend-label">{t.label}</div>
                <div className="trend-val">{t.latest}{t.deltaStr && <span className={'trend-delta ' + (t.improved ? 'up' : 'down')}>{t.deltaStr}</span>}</div>
              </div>
              {t.vals.length >= 2 ? <Sparkline values={t.vals} betterDown={t.betterDown} color={t.color} /> : <span className="trend-base">baseline</span>}
            </div>
          ))}
        </div>
      )}

      <div className="section-title">This week</div>
      <div className="card">
        <div className="row"><div><h2 style={{ margin: 0 }}>{twDone} of {twSess.length} done</h2>
          <div className="muted" style={{ fontSize: 12 }}>{thisWeek.phase} phase · week {thisWeek.index + 1}</div></div>
          <div className="spacer" /><div style={{ fontSize: 26, fontWeight: 750 }}>{twSess.length ? Math.round(twDone / twSess.length * 100) : 0}%</div></div>
        <div className="weekbar" style={{ height: 9 }}><span style={{ width: (twSess.length ? twDone / twSess.length * 100 : 0) + '%', background: 'var(--accent)' }} /></div>
      </div>

      <div className="section-title">Discipline balance</div>
      <div className="card center">
        <Donut segments={donut} size={170} />
        <div className="legend" style={{ justifyContent: 'center' }}>
          {donut.map(s => <div className="li" key={s.label}><i style={{ background: s.color }} />{s.label} · {Math.round(s.value)}h</div>)}
        </div>
      </div>

      <WellnessTrends wellness={wellness} />
    </>
  );
}

function SettingsView({ plan, onRegenerate, onReset, onExport, onEditFitness, onEditPlan }) {
  const p = plan.profile;
  return (
    <>
      <div className="section-title">Settings</div>
      <div className="card">
        <h2>{p.name}</h2>
        <p className="lead">Training for the {T.RACES[p.raceType].name} on {T.fmtDate(T.iso(p.raceDate), { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        <div className="statline">
          <div className="s"><b>{p.daysPerWeek}</b><span>days/week</span></div>
          <div className="s"><b style={{ textTransform: 'capitalize' }}>{p.fitness}</b><span>level</span></div>
          <div className="s"><b>{plan.totalWeeks}</b><span>weeks</span></div>
        </div>
        <div className="statline">
          <div className="s"><b>{p.fivekSec ? T.fmtPace(p.fivekSec / 5) : '~' + T.fmtPace((T.FITNESS[p.fitness] || T.FITNESS.intermediate).est5k / 5)}</b><span>{p.fivekSec ? '5k pace/km' : '5k pace · est'}</span></div>
          <div className="s"><b>{p.css100Sec ? T.fmtPace(p.css100Sec) : '~' + T.fmtPace((T.FITNESS[p.fitness] || T.FITNESS.intermediate).estCss)}</b><span>{p.css100Sec ? 'swim /100m' : 'swim · est'}</span></div>
          <div className="s"><b>{p.ftp || 'RPE'}</b><span>{p.ftp ? 'FTP watts' : 'bike by feel'}</span></div>
        </div>
        <div style={{ height: 12 }} />
        <button className="btn primary" onClick={onEditFitness}><Icon name="trend" size={18} /> Update fitness &amp; re-target</button>
        {plan.updatedAt && (() => {
          const prev = (p.fitnessHistory || []).slice(-1)[0];
          const delta = prev && prev.fivekSec && p.fivekSec
            ? ' · 5k ' + T.fmtPace(prev.fivekSec) + ' → ' + T.fmtPace(p.fivekSec) : '';
          return <p className="lead" style={{ margin: '10px 2px 0' }}>Paces re-targeted {T.fmtDate(T.iso(plan.updatedAt.slice(0, 10)), { month: 'short', day: 'numeric' })}{delta}</p>;
        })()}
        <div style={{ height: 10 }} />
        <button className="btn ghost" onClick={onEditPlan}><Icon name="calendar" size={18} /> Edit race &amp; schedule</button>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Sync & export</h2>
        <button className="btn primary" onClick={onExport}><Icon name="download" size={18} /> Export plan to calendar (.ics)</button>
        <p className="lead" style={{ margin: '10px 2px 0' }}>Downloads every session as all-day events with the full workout in the notes — import into Apple Calendar, Google Calendar or Outlook.</p>
      </div>
      <div className="card">
        <button className="btn ghost" onClick={onRegenerate}>↺ Start over / new plan</button>
        <div style={{ height: 10 }} />
        <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={onReset}>Clear all progress</button>
      </div>
      <div className="center muted" style={{ fontSize: 12 }}>Try · built with React</div>
    </>
  );
}

/* ---------------- building screen ---------------- */
// A brief, on-brand interstitial shown right after onboarding. The plan is
// already generated synchronously — this is purely a moment of anticipation
// so the hand-off doesn't feel abrupt. Messages are personalised to the plan.
function BuildingPlan({ plan, onDone }) {
  const p = plan.profile;
  const race = (T.RACES[plan.race] || {}).name || 'race';
  const steps = [
    'Reading your goals…',
    'Mapping out your ' + race + ' race day…',
    'Periodising Base → Build → Peak → Taper…',
    'Scheduling ' + p.daysPerWeek + ' sessions a week across ' + plan.totalWeeks + ' weeks…',
    'Setting your target paces…',
    'Your plan is ready',
  ];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const per = 460;
    const tick = setInterval(() => setStep(s => (s < steps.length - 1 ? s + 1 : s)), per);
    const done = setTimeout(onDone, per * (steps.length - 1) + 750);
    return () => { clearInterval(tick); clearTimeout(done); };
  }, []);
  const last = step === steps.length - 1;
  return (
    <div className="building">
      <div className="building-inner">
        <div className={'build-tiles' + (last ? ' done' : '')}>
          {['swim', 'bike', 'run'].map(k =>
            <span key={k} className="build-tile" style={{ background: D[k].grad }}>
              <Icon name={k} size={26} />
            </span>
          )}
        </div>
        <h1 className="build-title">{last ? "You're all set" : 'Building your plan'}</h1>
        <div key={step} className="build-step">{steps[step]}</div>
        <div className="build-bar"><span style={{ width: ((step + 1) / steps.length * 100) + '%' }} /></div>
      </div>
    </div>
  );
}

/* ---------------- root ---------------- */
function App() {
  const [plan, setPlan] = useState(() => LS.load('plan', null));
  const [log, setLog] = useState(() => LS.load('log', {}));
  const [moves, setMoves] = useState(() => LS.load('moves', {}));
  const [view, setView] = useState('today');
  const [detail, setDetail] = useState(null);
  const [editFitness, setEditFitness] = useState(false);
  const [editPlan, setEditPlan] = useState(false);
  const [building, setBuilding] = useState(false);
  const [wellness, setWellness] = useState(() => T.wellness.load());
  const [editWellness, setEditWellness] = useState(false);
  const saveWellness = rec => { setWellness(T.wellness.upsert(rec)); setEditWellness(false); };
  const [adjust, setAdjust] = useState(() => LS.load('adjust', {}));

  useEffect(() => { if (plan) LS.save('plan', plan); }, [plan]);
  useEffect(() => { LS.save('log', log); }, [log]);
  useEffect(() => { LS.save('moves', moves); }, [moves]);
  useEffect(() => { LS.save('adjust', adjust); }, [adjust]);

  if (!plan) return <Onboarding onCreate={p => { setPlan(T.generatePlan(p)); setView('today'); setBuilding(true); }} />;
  if (building) return <BuildingPlan plan={plan} onDone={() => setBuilding(false)} />;

  const toggle = id => setLog(l => { const n = { ...l }; if (n[id]) delete n[id]; else n[id] = { done: true, at: new Date().toISOString() }; return n; });
  const moveWorkout = (id, date) => setMoves(m => { const n = { ...m }; if (date === null) delete n[id]; else n[id] = date; return n; });
  const catchUp = () => setMoves(m => catchUpMoves(plan, log, m).next);
  // Re-target the plan from updated fitness. Same level/days/race → identical
  // week/day IDs, so the log & moves overlays stay valid; only paces change.
  const retarget = fields => {
    const old = plan.profile;
    const snapshot = { date: T.iso(new Date()), fivekSec: old.fivekSec, css100Sec: old.css100Sec, ftp: old.ftp, fitness: old.fitness };
    const profile = Object.assign({}, old, fields, { fitnessHistory: (old.fitnessHistory || []).concat([snapshot]) });
    const np = T.generatePlan(profile);
    np.createdAt = plan.createdAt;
    np.updatedAt = new Date().toISOString();
    setPlan(np);
  };
  const updateFitness = fields => { retarget(fields); setEditFitness(false); };
  const applyTune = () => { const s = paceSuggestions(plan, log); if (s.length) retarget(tuneFields(plan.profile, s)); };
  const setFeel = (id, feel) => setLog(l => ({ ...l, [id]: Object.assign({}, l[id], { done: true, at: (l[id] && l[id].at) || new Date().toISOString(), feel: feel }) }));
  // Readiness-driven adjustments overlay: eased session ids → easy aerobic version.
  const easedOf = w => (w && adjust[w.id] ? T.easeWorkout(w, plan) : w);
  const todaysHard = () => { const t = T.iso(new Date()); return plan.weeks.flatMap(wk => wk.workouts).filter(w => effDate(w, moves) === t && INTENSITY_TYPES[w.type] && !w.race); };
  const easeToday = () => { const hard = todaysHard(); if (!hard.length) return; setAdjust(a => { const n = { ...a }; hard.forEach(w => n[w.id] = { kind: 'ease', at: new Date().toISOString() }); return n; }); };
  const restoreToday = () => { const t = T.iso(new Date()); setAdjust(a => { const n = { ...a }; plan.weeks.flatMap(wk => wk.workouts).forEach(w => { if (effDate(w, moves) === t) delete n[w.id]; }); return n; }); };
  const unEase = id => setAdjust(a => { const n = { ...a }; delete n[id]; return n; });
  // Rebuild the plan after a race/schedule change. This reshapes the structure, so we
  // prune log & moves to the workout IDs that still exist (fitness/history carry over).
  const reshapePlan = fields => {
    const profile = Object.assign({}, plan.profile, fields);
    const np = T.generatePlan(profile);
    np.createdAt = plan.createdAt;
    if (plan.updatedAt) np.updatedAt = plan.updatedAt;
    const valid = new Set(np.weeks.flatMap(w => w.workouts).map(w => w.id));
    setLog(l => { const n = {}; Object.keys(l).forEach(id => { if (valid.has(id)) n[id] = l[id]; }); return n; });
    setMoves(m => { const n = {}; Object.keys(m).forEach(id => { if (valid.has(id)) n[id] = m[id]; }); return n; });
    setPlan(np);
    setEditPlan(false);
  };
  const race = T.RACES[plan.race];
  const daysToRace = Math.max(0, T.daysBetween(new Date(), plan.profile.raceDate));

  const tabs = [
    ['today', 'today', 'Today'], ['calendar', 'calendar', 'Calendar'],
    ['plan', 'plan', 'Plan'], ['progress', 'progress', 'Progress'], ['settings', 'you', 'You'],
  ];

  return (
    <div className="app">
      <div className="topbar">
        <h1><Icon name="logo" size={26} /> Try</h1>
        <div className="sub">Hi {plan.profile.name} — let's get to the finish line</div>
        <div className="race-chip"><span>{race.name} Triathlon</span><b>{daysToRace}</b><span>days to go</span></div>
      </div>

      {view === 'today' && <TodayView plan={plan} log={log} moves={moves} open={setDetail} onCatchUp={catchUp} onTune={applyTune} wellness={wellness} onEditWellness={() => setEditWellness(true)} easedOf={easedOf} onEaseToday={easeToday} onRestoreToday={restoreToday} />}
      {view === 'calendar' && <CalendarView plan={plan} log={log} moves={moves} open={setDetail} easedOf={easedOf} />}
      {view === 'plan' && <PlanView plan={plan} />}
      {view === 'progress' && <ProgressView plan={plan} log={log} wellness={wellness} />}
      {view === 'settings' && <SettingsView plan={plan}
        onEditFitness={() => setEditFitness(true)}
        onEditPlan={() => setEditPlan(true)}
        onRegenerate={() => { if (confirm('Start a new plan? Your current plan will be replaced.')) { LS.clear(); setLog({}); setMoves({}); setPlan(null); } }}
        onReset={() => { if (confirm('Clear all completion progress?')) setLog({}); }}
        onExport={() => downloadICS(plan, moves)} />}

      {editFitness && <FitnessEditor profile={plan.profile} onClose={() => setEditFitness(false)} onSave={updateFitness} />}
      {editPlan && <PlanSettingsEditor profile={plan.profile} onClose={() => setEditPlan(false)} onSave={reshapePlan} />}
      {editWellness && <WellnessEditor onClose={() => setEditWellness(false)} onSave={saveWellness} />}

      {detail && <DetailSheet w={easedOf(detail)} plan={plan} done={!!log[detail.id]} eff={effDate(detail, moves)}
        feel={(log[detail.id] || {}).feel} onFeel={setFeel}
        onClose={() => setDetail(null)} onToggle={() => toggle(detail.id)}
        onMove={moveWorkout} onResetMove={id => moveWorkout(id, null)} onRestore={() => unEase(detail.id)}
        onLogResult={() => { setDetail(null); setEditFitness(true); }} />}

      <div className="nav">
        {tabs.map(([k, ic, label]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            <span className="ic"><Icon name={ic} size={22} /></span>{label}</button>
        ))}
      </div>
    </div>
  );
}

// Reuse one root across hot-reloads (avoids the "createRoot() on a container that
// has already been passed to createRoot()" warning and double-mount churn in dev).
const _container = document.getElementById('root');
const _root = _container.__try_root || (_container.__try_root = createRoot(_container));
_root.render(<App />);
