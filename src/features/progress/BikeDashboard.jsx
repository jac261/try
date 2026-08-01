import * as T from '@/lib';
import { SpiderChart } from '@/components/SpiderChart.jsx';

/* Phase 8: the bike dashboard.
 *
 * Six questions (§1), answered in the order an athlete asks them, and the
 * limiter and the plan's response placed FIRST because they are the only two
 * things on the page anybody has to act on. Everything below them is the
 * evidence for them.
 *
 * Every figure renders through Metric, which shows nothing at all when a
 * value is missing and always says where a number came from. That is §9's
 * "conclusions expose confidence", and it is the reason a blank on this page
 * is safe: a missing metric is invisible rather than a zero. */

function Metric({ m, label, unit }) {
  if (!m || m.value == null) return null;
  return (
    <div>
      <b style={{ fontSize: 15 }}>{m.value}{unit ? ' ' + unit : ''}</b>
      <span>{label}</span>
    </div>
  );
}

/* A number and its note, as one sentence.
 *
 * This used to render `m.note` alone, and the notes are UNIT FRAGMENTS — so
 * §3's power adherence and rep fade appeared on the card as two orphan
 * phrases, "% from the prescription" and "% in the closing efforts", with the
 * numbers they belong to nowhere on the page. It also returned null whenever
 * the value was missing, which hid the note in exactly the case the note
 * exists to explain. */
/* A number and its note as one sentence — for NUMERIC metrics whose note is
   a unit fragment. `signed` marks deltas that deserve a leading plus; shares
   never get one (a "+100% of long rides fuelled to plan" is a signed glyph on
   a percentage that cannot be negative). Verdict-word metrics render through
   NoteOnly below: fusing the word to the sentence printed
   "buildYour position has been comfortable..." on the athlete's screen. */
function Note({ m, label, signed }) {
  if (!m || !m.note) return null;
  return (
    <div className="lead" style={{ margin: '4px 0 0', fontSize: 12 }}>
      {m.value != null
        ? (label ? label + ': ' : '') + (signed && m.value > 0 ? '+' : '') + m.value + m.note
        : m.note}
    </div>
  );
}

function NoteOnly({ m }) {
  if (!m || !m.note) return null;
  return <div className="lead" style={{ margin: '4px 0 0', fontSize: 12 }}>{m.note}</div>;
}

export function BikeDashboard({ plan, log, moves, activities, todayISO, retest, durabilityReads, fuelLog, positionLog, powerCurve, shapeLabelLog }) {
  const d = T.bikeDashboard({
    plan, log, moves, activities, todayISO, retest, durabilityReads, fuelLog, positionLog,
  });
  if (!d) return null;
  const readiness = T.bikeReadiness(d);
  const s = d.status;
  const q = d.quality;
  const du = d.durability;
  /* Rule 7 in practice: the label is computed HERE, for display, from the
     same profile the spider draws. Nothing upstream reads it, and no plan or
     coach path can, because it does not exist outside this render. */
  const riderProf = T.riderProfile({ curve: powerCurve, ftpWatts: (T.bikePowerAnchor(plan.profile || {}) || {}).ftpWatts });
  const label = T.shapeLabel(riderProf, {
    ftpWatts: (T.bikePowerAnchor(plan.profile || {}) || {}).ftpWatts,
    history: shapeLabelLog || [],
  });

  return (
    <>
      <div className="section-title" style={{ marginTop: 18 }}>
        Bike <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>
          (last {d.windowWeeks} weeks)
        </span>
      </div>

      {/* §5 + §6: one limiter, its evidence, and what the plan does about it. */}
      <div className="card">
        <div className="l" style={{ fontWeight: 600, marginBottom: 4 }}>{d.limiter.headline}</div>
        {d.limiter.evidence.map((e, i) => (
          <div className="lead" key={i} style={{ margin: '0 0 4px', fontSize: 13 }}>{e}</div>
        ))}
        <div className="section-title" style={{ margin: '10px 0 4px' }}>What the plan does about it</div>
        {d.limiter.response.map((r, i) => (
          <div className="lead" key={i} style={{ margin: '0 0 4px', fontSize: 13 }}>{r}</div>
        ))}
      </div>

      {/* §2. Real and estimated FTP are separate rows, never one row with a
          caveat: §9's first criterion is that they are never conflated. */}
      <div className="section-title" style={{ marginTop: 16 }}>Where you are</div>
      <div className="card">
        <div className="rd-pmc" style={{ marginTop: 0, flexWrap: 'wrap' }}>
          <Metric m={s.ftpWatts} label="FTP" unit="W" />
          <Metric m={s.estimatedFtpWatts} label="Estimated FTP" unit="W" />
          <Metric m={s.wkg} label="W/kg" />
          <Metric m={s.ridesPerWeek} label="Rides a week" />
          <Metric m={s.weeklyMinutes} label="Minutes a week" />
        </div>
        {s.ftpWatts.value != null && (
          /* "Measured from manual." labelled a hand-typed number as measured,
             while the retest nudge for the same state says it came from a
             hand entry — two surfaces disagreeing about whether a figure was
             measured, in a module whose rule is that a derived number can
             never read as a measured one. */
          <div className="lead" style={{ margin: '8px 0 0', fontSize: 12 }}>
            {{
              manual: 'Entered by hand',
              'try-test': 'Measured in your bike test',
              'activity-model': 'From the rolling estimate of your rides',
              'intervals-icu': 'From intervals.icu',
            }[s.ftpSource.value] || 'Recorded'}
            {s.ftpDate.value ? ' on ' + T.fmtDate(s.ftpDate.value) : ''}
            {s.ftpConfidence.value && s.ftpConfidence.value !== 'unknown'
              ? ' · ' + s.ftpConfidence.value + ' confidence' : ''}.
          </div>
        )}
        {/* §1: "Is my FTP improving?" — the first question on the spec's list,
            and the one the status block used to leave unanswered. */}
        {s.ftpTrend.value != null && (
          <div className="lead" style={{ margin: '4px 0 0', fontSize: 12 }}>
            {s.ftpTrend.value > 0 ? '+' : ''}{s.ftpTrend.value} {s.ftpTrend.note}
          </div>
        )}
        {s.ftpWatts.value != null && s.ftpTrend.value == null && s.ftpTrend.note && (
          <div className="lead" style={{ margin: '4px 0 0', fontSize: 12 }}>
            Is it improving? Only {s.ftpTrend.note}.
          </div>
        )}
        {s.estimatedFtpWatts.value != null && (
          <div className="lead" style={{ margin: '8px 0 0', fontSize: 12 }}>
            This is an estimate from your level and weight, not a measurement, so nothing
            on this page judges your riding against it. A twenty-minute test changes that.
          </div>
        )}
        {/* §8: outdoor and indoor kept apart, and the estimate explained. */}
        <div className="rd-pmc" style={{ flexWrap: 'wrap' }}>
          {/* §8 asks for the tilde on the figure itself, not only in the prose */}
          {s.outdoorDistanceKm.value != null && (
            <div><b style={{ fontSize: 15 }}>~{s.outdoorDistanceKm.value} km</b><span>Outdoor distance</span></div>
          )}
          <Metric m={s.indoorMinutes} label="Indoor minutes" />
          <Metric m={s.indoorShare} label="Ridden indoors" unit="%" />
        </div>
        {/* The explanation, in BOTH states: a rider who trained entirely
            indoors needs to know why there is no distance here at all. */}
        {s.outdoorDistanceKm.note && (
          <div className="lead" style={{ margin: '4px 0 0', fontSize: 12 }}>
            {s.outdoorDistanceKm.value != null
              ? '~' + s.outdoorDistanceKm.value + ' km is ' + s.outdoorDistanceKm.note + '.'
              : 'No outdoor distance is shown because ' + s.outdoorDistanceKm.note + '.'}
            {' '}Indoor rides contribute their duration and power here, never their distance:
            a trainer’s kilometres come from its wheel model rather than from the road.
          </div>
        )}
      </div>

      {/* §3, kept separate from §4 — acceptance criterion "quality and
          durability are separate". */}
      {/* The capability spider (2026-07-30): five power-profile axes on the
          rider's own shape rings, dormant until the power-curve endpoint
          lands — the SpiderChart renders the reason instead of improvising
          axes from FTP alone (Jon's call). */}
      <div className="section-title" style={{ marginTop: 16 }}>Power shape</div>
      <div className="card">
        <SpiderChart spider={T.bikeSpider(plan.profile, powerCurve)} color="var(--bike)"
          fmtValue={ax => (ax.value > 0 ? '+' : '') + ax.value + '%'} />
        {/* The label sits UNDER the chart on purpose (rule 3): it summarises
            what is drawn above it and never replaces it, so the evidence is
            read first and the sentence second. */}
        {label && (
          <div className="du-note" style={{ marginTop: 8 }}>
            <b style={{ fontWeight: 600 }}>{label.text}</b>
            {label.confidence === 'low' && ', read from one duration'}
            {'. '}
            {label.marginToChange != null && (
              label.decider === null ? null
                : 'A ' + label.marginToChange + ' point move at '
                  + (T.CAPABILITIES[label.decider] ? T.CAPABILITIES[label.decider].short.toLowerCase() : label.decider)
                  + ' would read differently. '
            )}
            {'Measured across ' + label.covered + ' of ' + label.capabilities + ' areas'}
            {label.ftpUsed ? ', against a threshold of ' + label.ftpUsed + ' W' : ''}
            {'. '}
            {label.changedFrom
              ? 'It previously read: ' + label.changedFrom.toLowerCase().replace(/^this curve /, '') + '.'
              : ''}
          </div>
        )}
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>Can you do the work?</div>
      <div className="card">
        <div className="rd-pmc" style={{ marginTop: 0, flexWrap: 'wrap' }}>
          <Metric m={q.sweetSpotMin} label="Sweet spot" unit="min" />
          <Metric m={q.thresholdMin} label="Threshold" unit="min" />
          <Metric m={q.vo2Min} label="VO2" unit="min" />
          {s.completion.value != null && (
            <div><b style={{ fontSize: 15 }}>{Math.round(s.completion.value * 100)}%</b><span>Rides completed</span></div>
          )}
          {q.completion.value != null && (
            <div><b style={{ fontSize: 15 }}>{Math.round(q.completion.value * 100)}%</b><span>Quality completed</span></div>
          )}
        </div>
        {s.completion.value == null && s.completion.note && (
          <div className="lead" style={{ margin: '6px 0 0', fontSize: 12 }}>{s.completion.note}</div>
        )}
        <Note m={q.adherence} label="Power adherence" signed />
        <Note m={q.fade} label="Rep fade" signed />
        {q.outcomes && (
          <div className="lead" style={{ margin: '4px 0 0', fontSize: 12 }}>
            Review outcomes: {Object.entries(q.outcomes).map(([k, n]) => k.replace('-', ' ') + ' ×' + n).join(', ')}.
          </div>
        )}
        {q.reviewNote && (
          <div className="lead" style={{ margin: '6px 0 0', fontSize: 12 }}>{q.reviewNote}</div>
        )}
        {q.nextFtp.value != null && (
          <div className="testnote" style={{ marginTop: 8 }}>
            <span><b>{q.nextFtp.value}</b> {q.nextFtp.note}</span>
          </div>
        )}
      </div>

      {/* §4 */}
      <div className="section-title" style={{ marginTop: 16 }}>Does it hold up late?</div>
      <div className="card">
        <div className="rd-pmc" style={{ marginTop: 0, flexWrap: 'wrap' }}>
          <Metric m={du.longestRideMin} label="Longest ride" unit="min" />
          <Metric m={du.lateFadePct} label="Late fade" unit="%" />
          <Metric m={du.hrDriftPct} label="HR drift" unit="%" />
          <Metric m={du.fuellingMet} label="Fuelled to plan" unit="%" />
        </div>
        <NoteOnly m={du.fuellingMet} />
        <NoteOnly m={du.positionTolerance} />
        {du.objectives.value && (
          <div className="lead" style={{ margin: '6px 0 0', fontSize: 12 }}>
            Long-ride objectives so far: {Object.entries(du.objectives.value)
              .map(([k, n]) => (du.objectiveLabels[k] ? du.objectiveLabels[k].label.toLowerCase() : k) + ' ×' + n)
              .join(', ')}.
          </div>
        )}
        {d.brick && d.brick.pattern && (
          <div className="testnote" style={{ marginTop: 8 }}><span>{d.brick.pattern.text}</span></div>
        )}
      </div>

      {/* §7: components, never a score. */}
      {readiness && <>
        <div className="section-title" style={{ marginTop: 16 }}>
          Race readiness <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>
            (kept in pieces, on purpose)
          </span>
        </div>
        <div className="card">
          {readiness.components.map(c => (
            <div className="seg" key={c.id} style={{ padding: '5px 0' }}>
              <div className="bar" style={{
                background: c.state === 'ready' ? 'var(--run)'
                  : c.state === 'at-risk' ? '#f6b27a' : 'var(--chip)',
              }} />
              <div>
                <div className="l">{c.label} · {c.state === 'at-risk' ? 'needs work' : c.state}</div>
                <div className="d">{c.evidence || c.why}</div>
              </div>
            </div>
          ))}
          <div className="lead" style={{ margin: '8px 0 0', fontSize: 12 }}>
            There is deliberately no single readiness score. Eight things measured with eight
            different confidences do not average into one number, and whatever number existed
            would be the only thing anybody read.
          </div>
        </div>
      </>}
    </>
  );
}
