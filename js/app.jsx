/* Try — React UI (loaded via Babel standalone, no build step).
   index.html registers a "react-classic" Babel preset (runtime: classic) so JSX
   compiles to React.createElement against the global React, not an ESM import. */
const { useState, useEffect, useMemo } = React;
const T = window.TF;
const D = T.DISCIPLINES;

/* ---------------- persistence ---------------- */
const LS = {
  load(k, fb) { try { const v = localStorage.getItem('triflow.' + k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } },
  save(k, v) { try { localStorage.setItem('triflow.' + k, JSON.stringify(v)); } catch (e) {} },
  clear() { ['plan', 'log', 'moves'].forEach(k => localStorage.removeItem('triflow.' + k)); },
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
  swim: '<circle cx="13.8" cy="9" r="2.1" fill="currentColor" stroke="none"/><path d="M19 7.6 12.6 10 7 11.7 3.4 12.6"/><path d="M3 15.9q2.5-2.2 5 0 t5 0 5 0 4 0"/><path d="M3 19.3q2.5-2.2 5 0 t5 0 5 0 4 0"/>',
  bike: '<circle cx="5.5" cy="16.3" r="3.6"/><circle cx="18.5" cy="16.3" r="3.6"/><circle cx="15" cy="6" r="2" fill="currentColor" stroke="none"/><path d="M8.5 9 13.7 7.4 17 11.6"/><path d="M8.5 9 11 12.6 12 16.3"/><path d="M12 16.3 17 11.6 18.5 16.3"/>',
  run: '<circle cx="16.5" cy="4.8" r="2.1" fill="currentColor" stroke="none"/><path d="M15.6 6.7 9.8 12.2"/><path d="M9.8 12.2 14.8 11 15.6 14.8"/><path d="M9.8 12.2 7 14.6 8.6 18"/><path d="M15.3 7.1 18 8.2 16.4 10.4"/><path d="M15.3 7.1 11.6 8.7 12.6 11.2"/>',
  brick: '<path d="M5.5 10A7 7 0 0 1 17.5 6.5L19 8"/><path d="M19 5 19 8 16 8"/><path d="M18.5 14A7 7 0 0 1 6.5 17.5L5 16"/><path d="M5 19 5 16 8 16"/>',
  rest: '<path d="M20 14.5A8.5 8.5 0 1 1 10 4 6.5 6.5 0 0 0 20 14.5Z"/>',
  strength: '<path d="M6 9 6 15"/><path d="M3.5 10.5 3.5 13.5"/><path d="M18 9 18 15"/><path d="M20.5 10.5 20.5 13.5"/><path d="M6 12 18 12"/>',
  today: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5 12 5"/><path d="M12 19 12 21.5"/><path d="M2.5 12 5 12"/><path d="M19 12 21.5 12"/><path d="M5.2 5.2 7 7"/><path d="M17 17 18.8 18.8"/><path d="M18.8 5.2 17 7"/><path d="M7 17 5.2 18.8"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5 20.5 9.5"/><path d="M8 3 8 6.5"/><path d="M16 3 16 6.5"/>',
  plan: '<rect x="5" y="4.5" width="14" height="17" rx="2.5"/><rect x="9" y="3" width="6" height="3.6" rx="1.3"/><path d="M8.5 11.5 15.5 11.5"/><path d="M8.5 15.5 13.5 15.5"/>',
  progress: '<path d="M4 20.5 20 20.5"/><path d="M7 20.5 7 13"/><path d="M12 20.5 12 7"/><path d="M17 20.5 17 10"/>',
  you: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20A6.5 6.5 0 0 1 18.5 20"/>',
  bolt: '<path d="M13 2.5 5 13 11 13 10.5 21.5 19 10.5 12.5 10.5Z"/>',
  flag: '<path d="M6 21.5 6 3.5"/><path d="M6 4.5 17.5 4.5 14.6 8 17.5 11.5 6 11.5"/>',
  flame: '<path d="M12 3c.5 3.5 4.5 5 4.5 9.5a4.5 4.5 0 0 1-9 0c0-1.7.8-2.8 1.7-3.7.2 1.2 1 1.8 1.6 1.3C12 9 11 6.5 12 3Z"/>',
  download: '<path d="M12 3.5 12 14.5"/><path d="M7.5 10 12 14.5 16.5 10"/><path d="M5 20 19 20"/>',
  trend: '<path d="M3 16.5 9 10.5 13 14.5 21 6.5"/><path d="M15 6.5 21 6.5 21 12.5"/>',
};
// Bold silhouette-style icons render with a heavier stroke (filled-figure look).
const ICON_BOLD = { swim: 2.7, bike: 2.5, run: 3 };
function Icon({ name, size }) {
  const s = size || 22;
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={ICON_BOLD[name] || 2} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: 'block', flex: 'none' }}
    dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] || '' }} />;
}

/* ---------------- tiny SVG charts ---------------- */
function BarChart({ data, height }) {
  height = height || 150;
  const max = Math.max(1, ...data.map(d => d.planned));
  const bw = 100 / data.length;
  return (
    <svg viewBox={'0 0 100 ' + (height / 2)} style={{ width: '100%', height: height, overflow: 'visible' }} preserveAspectRatio="none">
      {data.map((d, i) => {
        const x = i * bw + bw * 0.18, w = bw * 0.64;
        const ph = (d.planned / max) * (height / 2 - 14);
        const dh = (Math.min(d.done, d.planned) / max) * (height / 2 - 14);
        const base = height / 2 - 8;
        return (
          <g key={i}>
            <rect x={x} y={base - ph} width={w} height={ph} rx="1.2" fill="var(--track)" />
            <rect x={x} y={base - dh} width={w} height={dh} rx="1.2" fill={d.color || 'var(--accent)'} />
            <text x={x + w / 2} y={base + 6} fontSize="3.2" textAnchor="middle" fill="var(--muted)">{d.label}</text>
          </g>
        );
      })}
    </svg>
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

/* ---------------- onboarding ---------------- */
function Onboarding({ onCreate }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    name: '', raceType: 'olympic', fitness: 'intermediate', daysPerWeek: 5,
    raceDate: T.iso(T.addDays(new Date(), 84)), fivek: '', css100: '', ftp: '',
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  function finish() {
    onCreate({
      name: f.name.trim() || 'Athlete', raceType: f.raceType, fitness: f.fitness,
      daysPerWeek: f.daysPerWeek, raceDate: f.raceDate,
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
          <label className="field"><span className="lab">Training days per week</span></label>
          <div className="days">
            {[3, 4, 5, 6, 7].map(n => (
              <div key={n} className={'d' + (f.daysPerWeek === n ? ' on' : '')} onClick={() => set('daysPerWeek', n)}>{n}</div>
            ))}
          </div>
          <div style={{ height: 16 }} />
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
        <div className="t">{w.title} {w.test ? <span className="tag test">Test</span> : (w.key && !w.race && <span className="tag key">Key</span>)}{moved && <span className="tag moved">Moved</span>}</div>
        <div className="s">{w.type}{w.distance ? ' · ' + w.distance + ' ' + w.unit : ''} · {T.fmtDuration(w.durationMin || 0)}</div>
      </div>
      <div className="right">{T.fmtDate(eff || w.date, { weekday: 'short' })}</div>
      <div className="check">✓</div>
    </div>
  );
}

function DetailSheet({ w, done, onClose, onToggle, eff, onMove, onResetMove, onLogResult, feel, onFeel }) {
  const disc = D[w.discipline];
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
        {!w.race && <div className="statline">
          <div className="s"><b>{T.fmtDuration(w.durationMin || 0)}</b><span>Duration</span></div>
          {w.distance && <div className="s"><b>{w.distance}</b><span>{w.unit}</span></div>}
          <div className="s"><b>{disc.name}</b><span>{w.type}</span></div>
        </div>}
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
        {w.test && w.note && <div className="testnote"><Icon name="trend" size={18} /><span>{w.note}</span></div>}
        {w.test && onLogResult && <><button className="btn primary" onClick={onLogResult}><Icon name="trend" size={18} /> Log result &amp; re-target</button><div style={{ height: 10 }} /></>}
        {!w.race && <button className={'btn ' + (done ? 'done' : (w.test ? 'ghost' : 'primary'))} onClick={onToggle}>
          {done ? '✓ Completed — tap to undo' : 'Mark as complete'}</button>}
        {done && !w.race && onFeel && <div className="feel">
          <div className="feel-q">How did it feel?</div>
          <div className="feel-row">
            {[['easy', 'Easy'], ['right', 'Just right'], ['hard', 'Hard']].map(([k, lab]) =>
              <button key={k} className={'feelbtn' + (feel === k ? ' on ' + k : '')} onClick={() => onFeel(w.id, k)}>{lab}</button>)}
          </div>
        </div>}
        {w.race && <div className="card center" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)', margin: 0 }}><b style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name="flag" size={18} /> You've got this.</b></div>}
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

/* ---------------- views ---------------- */
function TodayView({ plan, log, moves, open, onCatchUp, onTune }) {
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
  const row = w => <WorkoutRow key={w.id} w={w} done={!!log[w.id]} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} />;

  return (
    <>
      {missed.length > 0 && <div className="banner" onClick={onCatchUp}>
        <div className="bi"><Icon name="bolt" size={20} /></div>
        <div><div className="bt">{missed.length} session{missed.length > 1 ? 's' : ''} missed this week</div>
          <div className="bs">Tap to reschedule onto your free days →</div></div>
      </div>}
      {suggestions.length > 0 && <div className="banner tune" onClick={onTune}>
        <div className="bi"><Icon name="trend" size={20} /></div>
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
          : <div className="empty"><div className="big"><Icon name="flag" size={40} /></div>All done — race time!</div>}
      </div>
    </>
  );
}

function CalendarView({ plan, log, moves, open }) {
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
              {ordered.map(w => <WorkoutRow key={w.id} w={w} done={!!log[w.id]} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} />)}
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

function ProgressView({ plan, log }) {
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
    </>
  );
}

function SettingsView({ plan, onRegenerate, onReset, onExport, onEditFitness }) {
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

/* ---------------- root ---------------- */
function App() {
  const [plan, setPlan] = useState(() => LS.load('plan', null));
  const [log, setLog] = useState(() => LS.load('log', {}));
  const [moves, setMoves] = useState(() => LS.load('moves', {}));
  const [view, setView] = useState('today');
  const [detail, setDetail] = useState(null);
  const [editFitness, setEditFitness] = useState(false);

  useEffect(() => { if (plan) LS.save('plan', plan); }, [plan]);
  useEffect(() => { LS.save('log', log); }, [log]);
  useEffect(() => { LS.save('moves', moves); }, [moves]);

  if (!plan) return <Onboarding onCreate={p => { setPlan(T.generatePlan(p)); setView('today'); }} />;

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

      {view === 'today' && <TodayView plan={plan} log={log} moves={moves} open={setDetail} onCatchUp={catchUp} onTune={applyTune} />}
      {view === 'calendar' && <CalendarView plan={plan} log={log} moves={moves} open={setDetail} />}
      {view === 'plan' && <PlanView plan={plan} />}
      {view === 'progress' && <ProgressView plan={plan} log={log} />}
      {view === 'settings' && <SettingsView plan={plan}
        onEditFitness={() => setEditFitness(true)}
        onRegenerate={() => { if (confirm('Start a new plan? Your current plan will be replaced.')) { LS.clear(); setLog({}); setMoves({}); setPlan(null); } }}
        onReset={() => { if (confirm('Clear all completion progress?')) setLog({}); }}
        onExport={() => downloadICS(plan, moves)} />}

      {editFitness && <FitnessEditor profile={plan.profile} onClose={() => setEditFitness(false)} onSave={updateFitness} />}

      {detail && <DetailSheet w={detail} done={!!log[detail.id]} eff={effDate(detail, moves)}
        feel={(log[detail.id] || {}).feel} onFeel={setFeel}
        onClose={() => setDetail(null)} onToggle={() => toggle(detail.id)}
        onMove={moveWorkout} onResetMove={id => moveWorkout(id, null)}
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

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
