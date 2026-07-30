import * as T from '@/lib';
import { SpiderChart } from '@/components/SpiderChart.jsx';

/* Phase 9's run dashboard, wired (audit catch 2026-07-30: run-dashboard.js
 * and the run-readiness.js it consumes were built with no component, so the
 * five questions reached no athlete while Swim and Bike both had a surface).
 *
 * Rendering rules, inherited from the other two dashboards:
 *   - the limiter and the plan's response come FIRST: they are the only two
 *     things on the page anybody has to act on
 *   - a missing value renders nothing, never a zero
 *   - real and estimated are never mixed: the benchmark row names its kind,
 *     and projections are absent rather than approximate for an estimate
 *   - no charts intervals.icu already draws, and no second km chart — the
 *     eight-week volume chart already lives above this in Progress
 */

const STATE_LABEL = { ready: 'Ready', building: 'Building', 'at-risk': 'Needs attention', unknown: 'Not enough data' };
const STATE_COLOR = { ready: 'var(--run)', building: 'var(--accent)', 'at-risk': '#f6b27a', unknown: 'var(--muted)' };
const COMPONENT_LABEL = {
  speed: 'Speed', threshold: 'Threshold', endurance: 'Endurance',
  longRunDurability: 'Long run durability', racePaceExecution: 'Race-pace execution',
  fuelling: 'Fuelling', consistency: 'Consistency', loadStability: 'Load stability',
};
const fmtClock = sec => {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
};
const fmtLong = sec => {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ' min';
};

export function RunDashboard({ plan, log, moves, activities, todayISO, fuelLog }) {
  const profile = plan.profile || {};
  const raceKey = plan.race;
  /* Stored per-session reviews, hydrated from the backend's typed field once
     it exists — dormant until then, exactly like the swim's harvest. The
     live review still renders on every recorded run via the workout sheet;
     this feed is what lets several of them argue together. */
  const reviews = (plan.weeks || []).flatMap(w => w.workouts || [])
    .filter(w => w.discipline === 'run' && log[w.id] && log[w.id].runReview)
    .map(w => ({ ...log[w.id].runReview, date: (log[w.id].at || '').slice(0, 10) || (moves && moves[w.id]) || w.date }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const runFuelLogs = Object.values(fuelLog || {}).filter(f => f && f.discipline === 'run');

  const d = T.runDashboard({ profile, plan, activities, log, reviews, fuelLogs: runFuelLogs, todayISO, raceKey });
  const perf = d.currentPerformance;
  const next = d.nextAction;
  const dur = d.durability;
  const gaps = T.runReadinessGaps(next.readiness);

  return (
    <>
      <div className="section-title">Run</div>
      <div className="card">
        {/* What is limiting me, and what is Try changing next (§1). */}
        {next.limiter && (
          <div className="testnote">
            <span><b>{COMPONENT_LABEL[next.limiter.component] || next.limiter.component}</b> is the current limiter. {next.limiter.why}</span>
          </div>
        )}
        {next.response && (
          <div className="testnote" style={{ marginTop: 6 }}>
            <span>The plan's next move: <b>{next.response.action}</b>, because {next.response.because}.</span>
          </div>
        )}
        {!next.response && (
          <div className="lead" style={{ fontSize: 12, marginTop: 6 }}>
            Nothing is changing: no group of recent runs argues for it yet. One session never retargets the plan.
          </div>
        )}
        {next.nextBenchmark && (
          <div className="lead" style={{ fontSize: 12, marginTop: 6 }}>{next.nextBenchmark}</div>
        )}

        {/* Is my running improving (§2): the benchmark, named for what it is. */}
        <div className="rd-pmc" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          {perf.benchmark.value != null && (
            <div>
              <b style={{ fontSize: 15 }}>{(perf.benchmark.kind === 'estimated' ? '~' : '') + fmtClock(perf.benchmark.value)}</b>
              <span>{perf.benchmark.kind === 'real' ? '5 km · ' + (perf.benchmark.note || 'measured') : '5 km · estimate'}</span>
            </div>
          )}
          {perf.projections && (
            <div><b style={{ fontSize: 15 }}>{fmtLong(perf.projections.marathon.lo)}–{fmtLong(perf.projections.marathon.hi)}</b><span>marathon range</span></div>
          )}
          {perf.projections && (
            <div><b style={{ fontSize: 15 }}>{fmtLong(perf.projections.halfMarathon)}</b><span>half projection</span></div>
          )}
          {dur.longestMin != null && (
            <div><b style={{ fontSize: 15 }}>{dur.longestMin} min</b><span>longest run so far</span></div>
          )}
        </div>
        {perf.projections == null && perf.benchmark.kind === 'estimated' && (
          <div className="lead" style={{ fontSize: 12, marginTop: 6 }}>
            No race projections yet: they need a real 5 km, not a level estimate.
          </div>
        )}

        {/* Pace across distances, against the level rings (spider,
            2026-07-30). The projection from the 5 km anchor is only the
            floor: a recorded race at an axis distance overrides it as a
            measured point, which is where distance-specific strengths
            honestly appear. */}
        <SpiderChart spider={T.runSpider(profile, activities)} color="var(--run)"
          fmtValue={ax => fmtLong(ax.value)} />

        {/* Readiness, as components — never a score (§5). */}
        <div className="rd-trend-head" style={{ marginTop: 12 }}><span>Race readiness</span><span>{gaps.length ? gaps.length + ' to work on' : ''}</span></div>
        <div className="legend" style={{ flexWrap: 'wrap' }}>
          {T.RUN_READINESS_COMPONENTS.map(k => {
            const c = next.readiness[k];
            if (!c) return null;
            return <div className="li" key={k} title={c.why}><i style={{ background: STATE_COLOR[c.state] }} />{COMPONENT_LABEL[k]} · {STATE_LABEL[c.state]}</div>;
          })}
        </div>
      </div>
    </>
  );
}
