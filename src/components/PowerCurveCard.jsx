import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
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
 * changes, and confidence. The seventh, training implication, moved to the
 * Power shape card (2026-08-01) along with the rider profile it belongs to:
 * this card is the measurement and that one is the reading of it. The curve
 * now carries the expected-shape reference, so the implication still has a
 * chart above it, one tab-section up rather than immediately above. */
export function PowerCurveCard({ curve, previous, ftpWatts, todayISO }) {
  /* The deltas toggle (Jon, 2026-07-30). Hook before the early return, the
     TDZ/hook-order lesson this codebase keeps re-learning: a conditional
     return above a hook changes the hook count the day the condition flips. */
  const [showDeltas, setShowDeltas] = useState(false);
  if (!curve || !curve.points || !curve.points.length) return null;
  const stale = T.staleDurations(curve, todayISO);
  const comparison = previous ? T.curveComparison({ current: curve, previous }) : null;
  // The toggle exists only when there is at least one comparable delta to
  // show. On an all-incomparable comparison (a meter change) it would toggle
  // between the curve and an emptier curve, which reads as a bug.
  const hasDeltas = !!comparison && comparison.rows.some(r => r.deltaPct != null);

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

        {/* The chart carries the per-duration data; the lines below carry the
            facts that do not vary per duration. */}
        {hasDeltas && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            {[false, true].map(v => (
              <a key={String(v)} className="reset" role="button" aria-pressed={showDeltas === v}
                {...tap(() => setShowDeltas(v))}
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 12,
                  background: showDeltas === v ? 'var(--chip)' : 'transparent',
                  border: '1px solid var(--chip)',
                  opacity: showDeltas === v ? 1 : 0.6,
                }}>{v ? 'change vs previous' : 'watts'}</a>
            ))}
          </div>
        )}
        <PowerCurveChart curve={curve} previous={previous} comparison={comparison}
          stale={stale} ftpWatts={ftpWatts} showDeltas={hasDeltas && showDeltas} />

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

    </>
  );
}
