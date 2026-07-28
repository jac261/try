import * as T from '@/lib';
import { Sparkline } from '@/components/charts.jsx';

/* Phase 7: the swim dashboard. It answers one question — what is limiting
   my swim, and what is the plan doing about it — and every number says
   where it came from. A metric with no evidence renders as the reason it is
   missing, never as a zero. */

const fmtPace = (sec, pool) => (sec ? T.swimPaceLabel(sec, pool) : null);

// §7 made visible: one short word per number, so a derived figure can never
// be mistaken for a measured one.
function Src({ m }) {
  if (!m) return null;
  return <span className="muted" style={{ fontSize: 11, textTransform: 'none', fontWeight: 400 }}>
    {T.SOURCE_WORDS[m.kind]}
  </span>;
}

// §7 wants EVERY metric to say what it is, not one word per card standing
// in for four different numbers (review catch 2026-07-27). The kind rides
// the label, which is the only place there is room for it.
const KIND_TAG = { recorded: 'recorded', derived: 'derived', reported: 'your answer', estimated: 'est', missing: null };
function Stat({ label, value, unit, m }) {
  const tag = m ? KIND_TAG[m.kind] : null;
  return (
    <div className="s">
      <b>{value == null ? '—' : value}{unit && value != null ? <small> {unit}</small> : null}</b>
      <span>{label}{tag ? <span className="muted" style={{ textTransform: 'none' }}> · {tag}</span> : null}</span>
    </div>
  );
}

export function SwimDashboard({ plan, log, moves, activities, todayISO, retest, onSupport }) {
  const d = T.swimDashboard({ plan, log, moves, activities, todayISO, retest });
  const pool = (plan.paces && plan.paces.pool) || T.DEFAULT_POOL;
  const st = d.status;
  const hist = st.history.slice(-8);

  return (
    <>
      <div className="section-title">Your swim <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(what is holding it back)</span></div>

      {/* §4 + §5: the answer first. Everything below is the evidence. */}
      <div className="card">
        <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>{d.limiter.headline}</h2>
        {d.limiter.evidence.map((e, i) => <p key={i} className="lead" style={{ margin: '0 0 4px' }}>{e}</p>)}
        <div className="section-title" style={{ margin: '12px 0 6px' }}>What the plan is doing</div>
        {d.limiter.response.map((r, i) => (
          <div className="testnote" key={i} style={{ marginTop: i ? 6 : 0 }}>
            <span>{r}</span>
          </div>
        ))}
      </div>

      {/* §6 current swim status */}
      <div className="section-title">Current CSS</div>
      <div className="card">
        <div className="statline">
          <Stat label="CSS" value={fmtPace(st.css.value, pool)} m={st.css} />
          <Stat label="Source" value={st.source === 'try-test' ? 'Swum test' : st.source === 'intervals-icu' ? 'intervals.icu' : st.source === 'manual' ? 'You entered it' : 'Estimated'} />
          <Stat label="Confidence" value={st.confidence || '—'} />
          <Stat label="Measured" value={st.measuredAt ? T.fmtDate(st.measuredAt, { month: 'short', day: 'numeric' }) : '—'} />
        </div>
        <Src m={st.css} />
        {hist.length >= 2 && (
          <div style={{ marginTop: 10 }}>
            {/* CSS is a time, so lower is better */}
            <Sparkline values={hist.map(h => h.css)} betterDown color="var(--swim)" />
            <div className="chart-legend"><span>CSS history, most recent last</span></div>
          </div>
        )}
      </div>

      {/* §6 training distribution */}
      <div className="section-title">Training distribution <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(last {T.DASH_RULES.weeks} weeks)</span></div>
      <div className="card">
        <div className="statline">
          <Stat label="Swims / week" value={d.distribution.sessionsPerWeek.value} m={d.distribution.sessionsPerWeek} />
          <Stat label="Minutes / week" value={d.distribution.minutesPerWeek.value} m={d.distribution.minutesPerWeek} />
          <Stat label="Metres / week" value={d.distribution.metresPerWeek.value} m={d.distribution.metresPerWeek} />
          <Stat label="Completed" value={d.distribution.completion.value == null ? null : Math.round(d.distribution.completion.value * 100)} unit="%" m={d.distribution.completion} />
        </div>
        <Src m={d.distribution.sessionsPerWeek} />
        {Object.keys(d.distribution.mix).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="rd-trend-head"><span>Session mix</span><span className="muted">completed swims</span></div>
            {Object.entries(d.distribution.mix).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
              <div className="seg" key={type} style={{ padding: '4px 0' }}>
                <div className="bar" style={{ background: 'var(--swim)' }} />
                <div><div className="l">{type}</div></div>
                <div className="m">{n}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* §6 quality execution */}
      <div className="section-title">Quality execution</div>
      <div className="card">
        {d.quality.reviews.length === 0
          ? <p className="lead" style={{ margin: 0 }}>{d.quality.note}</p>
          : <>
            <div className="statline">
              <Stat label="Pace vs target" value={d.quality.adherence.value == null ? null
                : Math.abs(d.quality.adherence.value) + '% ' + (d.quality.adherence.value > 0 ? 'slower' : 'faster')}
                m={d.quality.adherence} />
              <Stat label="Late fade" value={d.quality.fade.value} unit="%" m={d.quality.fade} />
              <Stat label="Evenness" value={d.quality.consistency.value} unit="%" m={d.quality.consistency} />
              <Stat label="Reviewed" value={d.quality.reviews.length} />
            </div>
            <Src m={d.quality.adherence} />
          </>}
      </div>

      {/* §6 endurance + open-water readiness */}
      <div className="section-title">Endurance and open water</div>
      <div className="card">
        <div className="statline">
          <Stat label="Longest swim" value={d.endurance.longestM.value} unit="m" m={d.endurance.longestM} />
          <Stat label="Long swims" value={d.endurance.longSwims.value} m={d.endurance.longSwims} />
          <Stat label="Open water" value={d.openWater.exposure.sessions} />
          <Stat label="Last outdoors" value={d.openWater.exposure.daysSince == null ? null : d.openWater.exposure.daysSince} unit="d ago" />
        </div>
        <Src m={d.endurance.longestM} />
        {d.openWater.exposure.sessions > 0 && (
          <p className="lead" style={{ margin: '8px 0 0' }}>
            {d.openWater.exposure.minutes} minutes outdoors, longest {d.openWater.exposure.longestMin} min.
            {d.openWater.exposure.sightingSessions ? ' Sighting practised in ' + d.openWater.exposure.sightingSessions + '.' : ''}
            {d.openWater.exposure.wetsuitSessions ? ' Wetsuit worn in ' + d.openWater.exposure.wetsuitSessions + '.' : ''}
          </p>
        )}
      </div>

      {/* §6 next action: what is coming, and what Try suggests next. It was
          computed and never rendered in the first cut. */}
      <div className="section-title">Next action</div>
      <div className="card">
        {d.nextAction.nextKey
          ? <p className="lead" style={{ margin: '0 0 6px' }}>
            Next key swim: <b>{d.nextAction.nextKey.title}</b> on {T.fmtDate(d.nextAction.nextKey.date, { weekday: 'long', month: 'short', day: 'numeric' })}.
          </p>
          : <p className="lead" style={{ margin: '0 0 6px' }}>No key swim scheduled ahead.</p>}
        {d.nextAction.retest
          ? <div className="testnote"><span>{d.nextAction.retest.headline}. {d.nextAction.retest.why}</span></div>
          : <p className="lead" style={{ margin: 0 }}>No CSS retest is due.</p>}
      </div>

      {/* §3: estimates, as ranges, and honest about what they need */}
      <div className="section-title">Estimated times <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(estimates, not predictions)</span></div>
      <div className="card">
        {d.estimates.map(e => (
          <div className="seg" key={e.label} style={{ padding: '5px 0' }}>
            <div className="bar" style={{ background: e.range ? 'var(--swim)' : 'var(--chip)' }} />
            <div>
              <div className="l">{e.label}</div>
              {e.why ? <div className="d">{e.why}</div> : e.openWater ? <div className="d">{e.openWater}</div> : null}
            </div>
            <div className="m">{e.range ? T.fmtClock(e.range[0]) + ' to ' + T.fmtClock(e.range[1]) : '—'}</div>
          </div>
        ))}
        <p className="lead" style={{ margin: '8px 0 0', fontSize: 12 }}>
          Ranges, because a single number would claim more than your CSS can tell us. They are tightest near the distances your training actually rehearses, and widen further from them.
        </p>
      </div>
    </>
  );
}
