import * as T from '@/lib';
import { Icon } from '@/components/Icon.jsx';
import { BarChart, Donut, Sparkline, TrendChart } from '@/components/charts.jsx';
import { fitnessSeries } from '@/features/progress/fitnessSeries.js';
import { WellnessTrends } from '@/features/wellness/WellnessTrends.jsx';
import { AthleteStateStrip } from '@/features/wellness/AthleteStateStrip.jsx';
import { InfoLink } from '@/components/InfoLink.jsx';
const D = T.DISCIPLINES;

export function ProgressView({ plan, log, activities, coach, durability, fuelLog, wellness, runLoad, recovery, onSupport, onWhatIf }) {
  const tracker = plan.race === 'tracker'; // no plan: hide every race/plan-relative surface
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
    // Completed load uses the recorded moving time where a watch activity
    // matched (log[..].actualMin), so the done bar reflects what happened.
    const dn = sess.filter(x => log[x.id]).reduce((a, b) => a + T.estimateTss(b, undefined, log[b.id].actualMin), 0);
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

  // thisWeek is undefined on an empty (tracker) plan, so guard before .workouts.
  const thisWeek = tracker ? null : (plan.weeks.find(w => w.workouts.some(x => x.date >= todayISO)) || plan.weeks[plan.weeks.length - 1]);
  const twSess = thisWeek ? thisWeek.workouts.filter(x => x.discipline !== 'rest' && !x.race) : [];
  const twDone = twSess.filter(x => log[x.id]).length;

  // fitness progression (from fitnessHistory snapshots + current baselines)
  const startISO = plan.profile.startDate || (plan.createdAt || '').slice(0, 10) || todayISO;
  const series = fitnessSeries(plan.profile, startISO);
  // A solo plan trains one sport: swim/bike trend rows and the weakest-link
  // card suppress (the card's own have-two-baselines self-hide is not enough;
  // run plus one stale triathlon baseline would render it). Numbers stay on
  // the profile and return on the next tri plan.
  const solo = (T.RACES[plan.race] || {}).solo || null;
  const swimPool = T.poolFor(plan.profile);
  const METRICS = [
    { key: 'run', label: 'Run · 5k pace', fmt: v => T.fmtPace(v / 5) + ' /km', div: 5, color: D.run.color, betterDown: true },
    { key: 'swim', label: 'Swim · CSS', fmt: v => T.swimPaceLabel(v, swimPool), div: 1, color: D.swim.color, betterDown: true },
    { key: 'bike', label: 'Bike · FTP', fmt: v => v + ' W', color: D.bike.color, betterDown: false },
  ];
  const trends = METRICS.filter(m => !solo || m.key === solo).map(m => {
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

  // Race projections: only from a REAL 5k time (a projection of the level
  // estimate would be noise wearing a number). Lives inside the fitness card
  // so it refreshes with the same renders that move the 5k trend.
  const predict = T.predictRaceTimes(plan.profile);

  // Weekly run volume: what was actually recorded or logged, plan or no plan.
  // Deliberately a different fact from the athlete strip's ramp verdict (that
  // is minutes against a baseline; this is raw kilometres), so it carries no
  // risk bands or ramp language.
  const runVol = T.weeklyRunKm({ activities, todayISO, weeks: 8 });
  const anyKm = runVol.some(w => w.km > 0);

  return (
    <>
      <AthleteStateStrip wellness={wellness} runLoad={runLoad} recovery={recovery} onSupport={onSupport}
        excludedDiscipline={plan.weeks.some(wk => wk.workouts.some(w => w.discipline === 'run' && log[w.id]))
          ? null : plan.profile.excludedDiscipline} />
      <div className="section-title">Progress</div>
      {!tracker && <>
        <div className="kpis">
          <div className="kpi"><div className="v">{daysToRace}<small> days</small></div><div className="k">Until race day</div></div>
          <div className="kpi"><div className="v">{pct}<small>%</small></div><div className="k">Sessions completed</div></div>
          <div className="kpi"><div className="v">{done.length}<small>/{all.length}</small></div><div className="k">Workouts done</div></div>
          <div className="kpi"><div className="v" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{streak}<Icon name="flame" size={22} /></div><div className="k">Current streak</div></div>
        </div>

        <div className="section-title"><InfoLink onOpen={onSupport} topic="plan-structure" />Weekly load <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(planned vs completed)</span></div>
        <div className="card"><BarChart data={bars} height={160} /></div>
      </>}

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
          {predict && <div className="predict">
            <div className="predict-title">Race projections <span className="muted">from your 5k time</span></div>
            <div className="predict-rows">
              <div className="predict-row"><span className="pd">10k{plan.race === 'run10k' ? <span className="muted"> · your race</span> : null}</span><b>~{T.fmtClock(predict.tenK)}</b></div>
              <div className="predict-row"><span className="pd">Half marathon{plan.race === 'runhalf' ? <span className="muted"> · your race</span> : null}</span><b>~{T.fmtClock(predict.halfMarathon)}</b></div>
              <div className="predict-row"><span className="pd">Marathon{plan.race === 'runmarathon' ? <span className="muted"> · your race</span> : null}</span><b>~{T.fmtClock(predict.marathon.lo)} to {T.fmtClock(predict.marathon.hi)}</b></div>
            </div>
            <div className="predict-note">Assumes each distance is trained for. The marathon range most of all: a 5k time says little about marathon endurance until the long runs are in.</div>
          </div>}
        </div>
      )}

      {anyKm && <>
        <div className="section-title">Run volume <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(weekly km from runs with a distance)</span></div>
        <div className="card">
          <TrendChart height={120} axis series={[]}
            bars={runVol.map(w => ({ v: w.km, color: D.run.color, label: T.fmtDate(w.start, { day: 'numeric', month: 'numeric' }) }))} />
        </div>
      </>}

      {(() => {
        // Durability: how the long sessions ended, from their recorded laps.
        // Trends are strictly per discipline (a run/ride mix-shift must
        // never masquerade as a fitness trend); a read that saw no heart
        // rate says so; bike output is power, not pace, and the wording
        // follows. One read is never a claim.
        const reads = [...(durability || [])].reverse().filter(e => e.read);
        if (!reads.length) return null;
        const pct = v => '~' + Math.abs(v) + '%';
        const outputBit = e => e.read.outputDropPct === 0
          ? (e.discipline === 'bike' ? 'power level late' : 'pace level late')
          : e.discipline === 'bike'
            ? 'power ' + pct(e.read.outputDropPct) + (e.read.outputDropPct > 0 ? ' down late' : ' up late')
            : pct(e.read.outputDropPct) + (e.read.outputDropPct > 0 ? ' slower late' : ' quicker late');
        const hrBit = e => e.read.hrMissing ? 'no heart rate data'
          : e.read.hrDriftPct === 0 ? 'HR level late'
            : 'HR ' + pct(e.read.hrDriftPct) + (e.read.hrDriftPct > 0 ? ' up' : ' down');
        const trends = ['run', 'bike'].map(d => ({ d, t: T.durabilityTrend(reads.filter(e => e.discipline === d)) }))
          .filter(x => x.t);
        return <>
          <div className="section-title">Durability <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(how the long sessions ended)</span></div>
          <div className="card">
            {trends.map(x => <div className="du-trend" key={x.d}>{x.d === 'bike' ? 'Long rides: ' : 'Long runs: '}{x.t}</div>)}
            {reads.slice(0, 5).map(e => (
              <div className="du-row" key={e.activityId}>
                <span className="du-date">{T.fmtDate(e.date, { day: 'numeric', month: 'short' })}</span>
                <span className="du-disc">{e.discipline === 'bike' ? 'Ride' : 'Run'} · {T.fmtDuration(e.durationMin)}</span>
                <span className={'coach-pill' + (e.read.band === 'held-strong' ? ' progress' : e.read.band === 'faded-hard' ? ' recover' : '')}>{T.DURABILITY_BAND_LABELS[e.read.band]}</span>
                <span className="du-nums">{outputBit(e)} · {hrBit(e)}{e.read.efDropPct != null && e.read.efDropPct > 0 ? ' · efficiency ' + pct(e.read.efDropPct) + ' down' : ''}{fuelLog && fuelLog[e.activityId] ? ' · fuel: ' + T.FUEL_LEVELS[fuelLog[e.activityId].level].toLowerCase() : ''}</span>
              </div>
            ))}
            <div className="du-note">Laps only tell part of it: hills, heat, wind and fuelling are invisible here, so read the pattern across weeks, never one session.</div>
          </div>
        </>;
      })()}

      {(() => {
        // Weakest link: the three sports on one experience scale, and what the
        // plan does about the one lagging behind. Quiet claims only — with too
        // little data (no FTP or weight for the bike) it says so.
        // Shown in tracker mode too (Jon, 2026-07-16): the scores are pure
        // profile data and stay valid without a plan. Honesty guards: the
        // retained raceType is nulled so the lib never claims a share of a
        // race that is not scheduled, and the action line speaks about the
        // NEXT plan instead of one that does not exist.
        // the LATEST single weigh-in feeds W/kg here; the Body mass card
        // below shows weekly averages, and both say which window they use
        // so the two numbers can differ without reading as a bug
        const w = [...(wellness || [])].reverse().find(r => r.weightKg);
        if (solo) return null;
        const wl = T.weakestLink({ profile: { ...plan.profile, raceType: tracker ? null : plan.profile.raceType, weightKg: w ? w.weightKg : plan.profile.weightKg } });
        if (!wl) return null;
        const NAME = { run: 'Run', bike: 'Bike', swim: 'Swim' };
        // An excluded sport (injured state) gets a plain sentence, not a bar:
        // scoring what the plan cannot train would be a nag.
        const ORDER = ['swim', 'bike', 'run'].filter(d => d !== wl.excludedSport);
        // Bars wear the colour of the BAND their score sits in (cool → hot,
        // matching the axis labels), not the sport's colour — the row label
        // already names the sport; the colour should answer "how good".
        const BAND_COLORS = ['#5b8cff', '#2dd4bf', '#a78bfa', '#f472b6'];
        const bandColor = s => BAND_COLORS[Math.min(3, Math.max(0, Math.floor(s)))];
        return <>
          <div className="section-title">Weakest link</div>
          <div className="card">
            <div className="wl-bars">
              {ORDER.map(d => {
                const s = wl.scores[d];
                // Bar geometry must match the axis: the labels are four equal
                // cells, so each band owns a quarter of the track (a 2.49 run
                // is mid-Advanced and must END mid-Advanced — with score/3 it
                // reached 83% and read as Elite, the 2026-07-12 field report).
                const band = s == null ? 0 : Math.min(3, Math.max(0, Math.floor(s)));
                const within = s == null ? 0 : Math.min(1, Math.max(0, s - band));
                const frac = s == null ? 0 : Math.max(0.04, (band + within) / 4);
                return (
                  <div className="wlb" key={d}>
                    <span className="wlb-l">{NAME[d]}</span>
                    <span className="wlb-bar">
                      {/* Full-strength band colours on every bar — the LIMITER
                          tag does the pointing; dimming the others just made
                          their level colour read wrong. */}
                      <i style={{ width: Math.round(frac * 100) + '%', background: s == null ? 'var(--track)' : bandColor(s) }} />
                    </span>
                    <span className={'wlb-tag' + (wl.weakest === d ? ' limit' : '')}>{s == null ? 'no data' : wl.weakest === d ? 'limiter' : ''}</span>
                  </div>
                );
              })}
              {/* Levels are BANDS, not points: each label owns a quarter of the
                  axis, coloured cool → hot so Elite pops. */}
              <div className="wlb-scale" aria-hidden="true">
                {[['Beg', '#5b8cff'], ['Int', '#2dd4bf'], ['Adv', '#a78bfa'], ['Elite', '#f472b6']]
                  .map(([l, c]) => <span key={l} style={{ color: c }}>{l}</span>)}
              </div>
            </div>
            {wl.excludedSport && <p className="lead" style={{ margin: '10px 0 0' }}>
              {NAME[wl.excludedSport]} is paused while you manage an injury{tracker
                ? ', so it is not scored here.'
                : <>. {ORDER.map(d => NAME[d]).join(' and ')} keep building.</>}
            </p>}
            <p className="lead" style={{ margin: '10px 0 0' }}>
              {wl.weakest
                ? (tracker
                  ? 'Your ' + NAME[wl.weakest].toLowerCase() + ' sits clearly behind. Your next plan will give it extra time while you build.'
                  : 'Your ' + NAME[wl.weakest].toLowerCase() + ' sits clearly behind' + (wl.share ? ' and is roughly ' + wl.share + '% of your race' : '') + ' — the plan gives it extra time while you build.')
                : 'Balanced across sports' + (wl.missing.length ? ' (no reading yet for your ' + wl.missing.map(d => NAME[d].toLowerCase()).join(' or ') + ')' : '')
                  + (tracker ? '. A solid base to start your next plan from.' : ' — the plan stays even.')}
            </p>
            {/* The coach brain's per-discipline lines for the OPEN week,
                computed live and labelled so: only closed weeks freeze (the
                digest quotes those). Folded into this card because it is the
                one place that already speaks per discipline. */}
            {coach && (Object.keys(coach.disciplines).length > 0 || coach.overall) && <div className="coach-week">
              <div className="coach-week-head">This week so far <span className="muted">{T.DECISION_LABELS[coach.overall.decision]}</span></div>
              {Object.entries(coach.disciplines).map(([d, v]) => (
                <div className="coach-row-wrap" key={d}>
                  <div className="coach-row">
                    <span className="coach-d">{NAME[d] || d}</span>
                    <span className={'coach-pill ' + v.decision}>{T.DECISION_LABELS[v.decision]}</span>
                    <span className="coach-why">{v.headline}</span>
                  </div>
                  {(v.evidence || []).map((e, n) => (
                    <div className="coach-ev" key={n}><span className="coach-sig">{e.signal}</span>{e.reading}</div>
                  ))}
                </div>
              ))}
            </div>}
          </div>
        </>;
      })()}

      {(() => {
        // Body mass: shown only when a weigh-in exists or a goal was set.
        // Without a goal this card is a number and a line, and it never
        // says a judging word (design panel 2026-07-21). Zero data and no
        // goal renders nothing at all, the durability precedent.
        const goal = plan.profile.massGoal || null;
        const trend = T.massTrend(wellness, todayISO);
        if (!trend && !goal) return null;
        if (!trend) return null;
        const status = T.goalStatus(trend, goal, { setISO: plan.profile.massGoalSetAt || null, todayISO });
        // With a goal, the number shown IS the number judged (one source, no
        // pill-vs-figure contradiction). Without a goal there is no rate
        // line at all: a signed weekly figure is judgment-adjacent, and the
        // goalless card is a number and a line, nothing more (gauntlet
        // safety catches 2026-07-21).
        // settling carries no judgedRateKg, so the rate line hides
        // mechanically rather than by wording
        const rate = status && status.judgedRateKg != null ? T.fmtRateGrams(status.judgedRateKg) : null;
        return <>
          <div className="section-title">Body mass <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(weekly averages)</span></div>
          <div className="card">
            <div className="bm-head">
              <div><b>{trend.avgKg != null ? trend.avgKg + ' kg' : trend.latestKg + ' kg'}</b>
                <span className="muted"> {trend.avgKg != null ? '7-day average' : 'latest weigh-in, ' + T.fmtDate(trend.latestDate, { day: 'numeric', month: 'short' })}</span></div>
              {/* progress styling is gain-only by panel rule: bands may
                  reward gain, they only report hold. downFast wears its own
                  mass-warn class so a coach restyle can't touch it. */}
              {status && <span className={'coach-pill' + (goal === 'gain' && status.key === 'on' ? ' progress' : status.key === 'downFast' ? ' mass-warn' : '')}>{status.label}</span>}
            </div>
            {rate && <div className="bm-rate">{rate} <span className="muted">last completed week</span></div>}
            {status && <div className="bm-note">{status.detail}</div>}
            {trend.series.some(v => v != null) && <TrendChart height={90} series={[{ values: trend.series, color: '#8b95a7' }]} />}
            <div className="bm-note">Scales are noisy and weigh-in times vary; the weekly averages and the monthly rate carry more truth than any single reading.</div>
          </div>
        </>;
      })()}

      {!tracker && <>
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
      </>}

      <WellnessTrends onSupport={onSupport} wellness={wellness} onWhatIf={onWhatIf} />
    </>
  );
}
