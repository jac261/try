import * as T from '@/lib';
import { Icon } from '@/components/Icon.jsx';
import { BarChart, Donut, Sparkline } from '@/components/charts.jsx';
import { fitnessSeries } from '@/features/progress/fitnessSeries.js';
import { WellnessTrends } from '@/features/wellness/WellnessTrends.jsx';
import { InfoLink } from '@/components/InfoLink.jsx';
const D = T.DISCIPLINES;

export function ProgressView({ plan, log, wellness , onSupport }) {
  const todayISO = T.iso(new Date());
  const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest' && !w.race);
  const done = all.filter(w => log[w.id]);
  const daysToRace = Math.max(0, T.daysBetween(new Date(), plan.profile.raceDate));
  const pct = all.length ? Math.round(done.length / all.length * 100) : 0;

  // weekly bars — training load, not raw minutes. A benchmark test or a sharp
  // interval session is short but taxing; counting minutes made those weeks look
  // like a step back, load shows them for the hard weeks they are.
  const bars = plan.weeks.map(w => {
    const sess = w.workouts.filter(x => x.discipline !== 'rest' && !x.race);
    const planned = sess.reduce((a, b) => a + T.estimateTss(b), 0);
    const dn = sess.filter(x => log[x.id]).reduce((a, b) => a + T.estimateTss(b), 0);
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
      // the watt delta renders its sign separately so it can be optically
      // lifted to the digits (see .sgn); pace deltas read "faster/slower"
      deltaStr = m.key === 'bike' ? d + ' W'
        : T.fmtPace(d / m.div) + (improved ? ' faster' : ' slower');
    }
    const deltaSign = changed && m.key === 'bike' ? (improved ? '+' : '−') : null;
    return { key: m.key, label: m.label, color: m.color, betterDown: m.betterDown, vals: pts.map(p => p.value), latest: m.fmt(latest), changed, improved, deltaStr, deltaSign };
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

      <div className="section-title"><InfoLink onOpen={onSupport} topic="plan-structure" />Weekly load <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(planned vs completed)</span></div>
      <div className="card"><BarChart data={bars} height={160} /></div>

      <div className="section-title"><InfoLink onOpen={onSupport} topic="zones" />Fitness progression</div>
      {trends.length === 0 ? (
        <div className="card"><div className="empty" style={{ padding: '24px 16px' }}><div className="big"><Icon name="trend" size={34} /></div>Log a benchmark test or update your fitness, and your pace &amp; power trends will appear here.</div></div>
      ) : (
        <div className="card">
          {trends.map(t => (
            <div className="trend" key={t.key}>
              <div className="trend-info">
                <div className="trend-label">{t.label}</div>
                <div className="trend-val">{t.latest}{t.deltaStr && <span className={'trend-delta ' + (t.improved ? 'up' : 'down')}>{t.deltaSign && <span className="sgn">{t.deltaSign}</span>}{t.deltaStr}</span>}</div>
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

      <WellnessTrends onSupport={onSupport} wellness={wellness} />
    </>
  );
}
