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
    const disc = D[w.discipline];
    const sum = (disc.icon ? disc.icon + ' ' : '') + w.title + (w.durationMin ? ' (' + T.fmtDuration(w.durationMin) + ')' : '');
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
    raceDate: T.iso(T.addDays(new Date(), 84)), fivek: '25:00', css100: '2:00', ftp: '',
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
      <div className="topbar"><h1>🏊‍♀️🚴‍♂️🏃‍♀️ Try</h1><div className="sub">Your personalised triathlon coach</div></div>
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
          <div className="choice" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            {Object.values(T.FITNESS).map(l => (
              <div key={l.key} className={'opt' + (f.fitness === l.key ? ' on' : '')} onClick={() => set('fitness', l.key)}>{l.name}</div>
            ))}
          </div>
          <div style={{ height: 12 }} />
          <div className="row"><button className="btn ghost" onClick={() => setStep(0)}>Back</button>
            <button className="btn primary" onClick={() => setStep(2)}>Continue</button></div>
        </>}

        {step === 2 && <>
          <h2>Your current fitness</h2>
          <p className="lead">Used to set precise paces & power. Estimates are fine — leave blank to train by feel (RPE).</p>
          <label className="field"><span className="lab">Recent 5 km run time <span className="hint">mm:ss</span></span>
            <input value={f.fivek} placeholder="25:00" onChange={e => set('fivek', e.target.value)} /></label>
          <label className="field"><span className="lab">Swim pace per 100 m <span className="hint">mm:ss</span></span>
            <input value={f.css100} placeholder="2:00" onChange={e => set('css100', e.target.value)} /></label>
          <label className="field"><span className="lab">Cycling FTP <span className="hint">watts — optional</span></span>
            <input value={f.ftp} placeholder="e.g. 220" inputMode="numeric" onChange={e => set('ftp', e.target.value)} /></label>
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
      <div className="dot" style={{ background: 'var(--rest)' }}>😴</div>
      <div className="meta"><div className="t">Rest day</div><div className="s">Recover & adapt</div></div>
    </div>
  );
  const disc = D[w.discipline];
  return (
    <div className={'wk' + (done ? ' done' : '')} onClick={onClick}>
      <div className="dot" style={{ background: disc.grad }}>{disc.icon}</div>
      <div className="meta">
        <div className="t">{w.title} {w.key && !w.race && <span className="tag key">Key</span>}{moved && <span className="tag moved">Moved</span>}</div>
        <div className="s">{w.type}{w.distance ? ' · ' + w.distance + ' ' + w.unit : ''} · {T.fmtDuration(w.durationMin || 0)}</div>
      </div>
      <div className="right">{T.fmtDate(eff || w.date, { weekday: 'short' })}</div>
      <div className="check">✓</div>
    </div>
  );
}

function DetailSheet({ w, done, onClose, onToggle, eff, onMove, onResetMove }) {
  const disc = D[w.discipline];
  const shown = eff || w.date;
  const moved = shown !== w.date;
  const days = weekRange(w.date);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="hero">
          <div className="dot" style={{ background: disc.grad }}>{disc.icon}</div>
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
        {!w.race && <button className={'btn ' + (done ? 'done' : 'primary')} onClick={onToggle}>
          {done ? '✓ Completed — tap to undo' : 'Mark as complete'}</button>}
        {w.race && <div className="card center" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)', margin: 0 }}><b>You've got this. 🏁</b></div>}
      </div>
    </div>
  );
}

/* ---------------- views ---------------- */
function TodayView({ plan, log, moves, open, onCatchUp }) {
  const todayISO = T.iso(new Date());
  const all = plan.weeks.flatMap(w => w.workouts);
  const sessions = all.filter(w => w.discipline !== 'rest' && !w.race);
  const today = all.filter(w => effDate(w, moves) === todayISO);
  const upcoming = sessions.filter(w => effDate(w, moves) > todayISO)
    .sort((a, b) => effDate(a, moves) < effDate(b, moves) ? -1 : 1).slice(0, 4);
  const curWeek = plan.weeks.find(w => w.workouts.some(x => x.date >= todayISO)) || plan.weeks[plan.weeks.length - 1];
  const weekStart = weekRange(todayISO)[0];
  const missed = sessions.filter(w => { const d = effDate(w, moves); return d < todayISO && d >= weekStart && !log[w.id]; });
  const row = w => <WorkoutRow key={w.id} w={w} done={!!log[w.id]} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} />;

  return (
    <>
      {missed.length > 0 && <div className="banner" onClick={onCatchUp}>
        <div className="bi">⚡</div>
        <div><div className="bt">{missed.length} session{missed.length > 1 ? 's' : ''} missed this week</div>
          <div className="bs">Tap to reschedule onto your free days →</div></div>
      </div>}
      <div className="section-title">Today · {T.fmtDate(todayISO, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      <div className="card">
        {today.length === 0 ? <div className="empty"><div className="big">🛌</div>No session scheduled today.</div>
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
          : <div className="empty">All done — race time! 🏁</div>}
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
        <div className="kpi"><div className="v">{streak} 🔥</div><div className="k">Current streak</div></div>
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

function SettingsView({ plan, onRegenerate, onReset, onExport }) {
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
          <div className="s"><b>{p.fivekSec ? T.fmtPace(p.fivekSec / 5) : '—'}</b><span>5k pace/km</span></div>
          <div className="s"><b>{p.css100Sec ? T.fmtPace(p.css100Sec) : '—'}</b><span>swim /100m</span></div>
          <div className="s"><b>{p.ftp || '—'}</b><span>FTP watts</span></div>
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Sync & export</h2>
        <button className="btn primary" onClick={onExport}>📅 Export plan to calendar (.ics)</button>
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

  useEffect(() => { if (plan) LS.save('plan', plan); }, [plan]);
  useEffect(() => { LS.save('log', log); }, [log]);
  useEffect(() => { LS.save('moves', moves); }, [moves]);

  if (!plan) return <Onboarding onCreate={p => { setPlan(T.generatePlan(p)); setView('today'); }} />;

  const toggle = id => setLog(l => { const n = { ...l }; if (n[id]) delete n[id]; else n[id] = { done: true, at: new Date().toISOString() }; return n; });
  const moveWorkout = (id, date) => setMoves(m => { const n = { ...m }; if (date === null) delete n[id]; else n[id] = date; return n; });
  const catchUp = () => setMoves(m => catchUpMoves(plan, log, m).next);
  const race = T.RACES[plan.race];
  const daysToRace = Math.max(0, T.daysBetween(new Date(), plan.profile.raceDate));

  const tabs = [
    ['today', '☀️', 'Today'], ['calendar', '🗓️', 'Calendar'],
    ['plan', '📋', 'Plan'], ['progress', '📈', 'Progress'], ['settings', '⚙️', 'You'],
  ];

  return (
    <div className="app">
      <div className="topbar">
        <h1>🏊‍♀️🚴‍♂️🏃‍♀️ Try</h1>
        <div className="sub">Hi {plan.profile.name} — let's get to the finish line</div>
        <div className="race-chip"><span>{race.name} Triathlon</span><b>{daysToRace}</b><span>days to go</span></div>
      </div>

      {view === 'today' && <TodayView plan={plan} log={log} moves={moves} open={setDetail} onCatchUp={catchUp} />}
      {view === 'calendar' && <CalendarView plan={plan} log={log} moves={moves} open={setDetail} />}
      {view === 'plan' && <PlanView plan={plan} />}
      {view === 'progress' && <ProgressView plan={plan} log={log} />}
      {view === 'settings' && <SettingsView plan={plan}
        onRegenerate={() => { if (confirm('Start a new plan? Your current plan will be replaced.')) { LS.clear(); setLog({}); setMoves({}); setPlan(null); } }}
        onReset={() => { if (confirm('Clear all completion progress?')) setLog({}); }}
        onExport={() => downloadICS(plan, moves)} />}

      {detail && <DetailSheet w={detail} done={!!log[detail.id]} eff={effDate(detail, moves)}
        onClose={() => setDetail(null)} onToggle={() => toggle(detail.id)}
        onMove={moveWorkout} onResetMove={id => moveWorkout(id, null)} />}

      <div className="nav">
        {tabs.map(([k, ic, label]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            <span className="ic">{ic}</span>{label}</button>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
