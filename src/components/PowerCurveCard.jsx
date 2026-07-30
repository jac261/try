import * as T from '@/lib';
import { PowerCurveChart } from '@/components/PowerCurveChart.jsx';

/* Phase 7 §6: the curve, shown with everything needed to judge it.
 *
 * Renders nothing at all without curve data, which today is always — Try has
 * no power-curve endpoint. That is deliberate and it is §7's first acceptance
 * criterion. The component exists anyway so the model has a real path to the
 * athlete: the phase before this one shipped three models with no caller, and
 * a gate is only honest if there is something behind it to open.
 *
 * §6 asks for seven things and this renders six of them: the current curve,
 * a historical comparison, recent improvements, stale durations, source
 * changes, and confidence. The seventh, training implication, comes from
 * bike-profile.js and is rendered underneath, because an implication with no
 * curve above it is an assertion the athlete cannot check. */
export function PowerCurveCard({ curve, previous, ftpWatts, todayISO }) {
  if (!curve || !curve.points || !curve.points.length) return null;
  const stale = T.staleDurations(curve, todayISO);
  const comparison = previous ? T.curveComparison({ current: curve, previous }) : null;
  const profile = T.riderProfile({ curve, ftpWatts });
  const implications = T.trainingImplications(profile);

  /* Jon, 2026-07-30: the per-duration rows are gone and the watts live on the
     chart's axis instead. The rows carried five things a line cannot, and
     they repeated four of them ten times over: the same date, the same meter,
     the same environment, the same confidence. So the facts that VARY are
     named here and the ones that do not are said once. Nothing that would
     change how the curve is read has been dropped.

     Still built on durationSummary, which keeps the wording and the caveats
     in the model rather than in this component. */
  const summaries = curve.points.map(p =>
    T.durationSummary({ point: p, ftpWatts, stale: stale.includes(p.durationSec) }));
  const uniq = xs => [...new Set(xs.filter(x => x != null && x !== ''))];
  const dates = uniq(summaries.map(s => s.date)).sort();
  const sources = uniq(summaries.map(s => s.source));
  const indoors = uniq(summaries.map(s => s.indoor));
  const lowConfidence = summaries.filter(s => s.quality === 'low');
  const provenance = [
    dates.length === 0 ? null
      : dates.length === 1 ? T.fmtDate(dates[0])
        : T.fmtDate(dates[0]) + ' to ' + T.fmtDate(dates[dates.length - 1]),
    sources.length ? sources.join(' and ') : null,
    indoors.length !== 1 ? null : (indoors[0] ? 'indoors' : 'outdoors'),
  ].filter(Boolean).join(' · ');
  // §7 asks that the shape be readable, and the axis gives watts but not the
  // ratio. The two extremes are the ratio that matters.
  const ends = ftpWatts && summaries.length > 1
    ? { short: summaries[0], long: summaries[summaries.length - 1] } : null;

  return (
    <>
      <div className="section-title">
        Power curve <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(your best, by duration)</span>
      </div>
      <div className="card">
        {/* §5/§6: a whole-curve jump that coincides with a device change is a
            device change until proven otherwise, and it is said FIRST, before
            any number that would otherwise read as a gain. */}
        {comparison && comparison.sourceChanged && (
          <div className="testnote" style={{ marginBottom: 8 }}>
            <span>
              Some of these were recorded on a different power meter, so they are shown
              but not compared. A new meter can read several per cent apart from an old
              one, which looks exactly like getting stronger.
              {comparison.looksLikeCalibration && comparison.sourceShiftPct != null && (
                <> Everything moved by about {Math.abs(comparison.sourceShiftPct)}% in the
                same direction, which is what a calibration difference looks like rather
                than what fitness looks like.</>
              )}
            </span>
          </div>
        )}

        {/* The shape, then the facts. The rows below carry date, meter,
            environment, confidence and the per-duration delta — none of which
            a line can show — so the chart is added rather than swapped in. */}
        <PowerCurveChart curve={curve} previous={previous} comparison={comparison}
          stale={stale} ftpWatts={ftpWatts} />

        {ends && (
          <div className="lead" style={{ margin: '8px 0 0', fontSize: 13 }}>
            Your {ends.short.label} best is {ends.short.pctOfFtp}% of threshold and
            your {ends.long.label} best is {ends.long.pctOfFtp}% of threshold.
          </div>
        )}

        {provenance && (
          <div className="d" style={{ marginTop: 6 }}>{provenance}</div>
        )}

        {/* Confidence was a per-row field. Only the exceptions are worth
            saying, because "high confidence" ten times told nobody anything. */}
        {lowConfidence.length > 0 && (
          <div className="d" style={{ marginTop: 4 }}>
            {lowConfidence.map(s => s.label).join(', ')}
            {lowConfidence.length === 1 ? ' was' : ' were'} recorded, but not trusted
            well enough to read anything into.
          </div>
        )}

        {stale.length > 0 && (
          /* Names them now. The hollow markers say which on the chart, but a
             hollow dot is only legible if you already know to look for it, and
             the row that used to spell it out is gone. */
          <div className="lead" style={{ margin: '8px 0 0', fontSize: 12 }}>
            {summaries.filter(s => s.stale).map(s => s.label).join(', ')}
            {stale.length === 1 ? ' has' : ' have'} not been tested in a while, so
            {stale.length === 1 ? ' it describes' : ' they describe'} an older version
            of you. Going and setting a fresh best is the only way to know. They are the
            hollow points above.
          </div>
        )}
      </div>

      {profile && <>
        <div className="section-title" style={{ marginTop: 16 }}>The shape of your riding</div>
        <div className="card">
          {/* §3: five scores and no label. There is deliberately no sentence
              anywhere here of the form "you are a X rider". */}
          {profile.ranked.map(s => (
            <div className="seg" key={s.key} style={{ padding: '5px 0' }}>
              <div className="bar" style={{ background: 'var(--chip)' }} />
              <div>
                <div className="l">{s.label} · {s.pct > 0 ? '+' : ''}{s.pct}%</div>
                <div className="d">{s.why}{s.confidence === 'low' ? ' · read from one duration only' : ''}</div>
              </div>
            </div>
          ))}
          <div className="lead" style={{ margin: '8px 0 0', fontSize: 13 }}>{profile.text}</div>
          {comparison && comparison.sourceChanged && (
            /* The shape is measured against a threshold, and the threshold
               was measured on the OLD meter. So a device change moves the
               whole profile too, not just the comparison above — the same
               caveat one level down, and the athlete cannot see it from the
               numbers. */
            <div className="lead" style={{ margin: '6px 0 0', fontSize: 12 }}>
              These are measured against a threshold set on your previous power meter,
              so the whole shape shifts with it. A fresh test on the new one puts them
              back on the same footing.
            </div>
          )}
          {implications.map((im, i) => (
            <div className="lead" key={i} style={{ margin: '6px 0 0', fontSize: 12 }}>{im.text}</div>
          ))}
          {/* §4: suggestions, never applied. Said out loud so nobody expects
              their plan to have changed underneath them. */}
          <div className="lead" style={{ margin: '8px 0 0', fontSize: 12 }}>
            Nothing here changes your plan on its own. It is here so you can decide whether it should.
          </div>
        </div>
      </>}
    </>
  );
}
