import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { Signed } from '@/components/Signed.jsx';
import { InfoLink } from '@/components/InfoLink.jsx';
import { TrendChart } from '@/components/charts.jsx';

export function WellnessTrends({ wellness , onSupport, onWhatIf }) {
  // After a history backfill the store can hold a year+; the charts stay
  // readable on the trailing 120 days (the "last N days" labels follow).
  const w = wellness.filter(r => r.ctl != null || r.hrv != null).slice(-120);
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
  // Build all three load series from the same rows so they stay aligned even if
  // an odd day is missing one metric. Form falls back to ctl − atl when the feed
  // didn't include it.
  const loadRows = w.filter(r => r.ctl != null && r.atl != null);
  const ctl = loadRows.map(r => r.ctl);
  const atl = loadRows.map(r => r.atl);
  const tsbSeries = loadRows.map(r => (r.tsb != null ? r.tsb : r.ctl - r.atl));
  const hrv = num(w, 'hrv');
  const tsb = tsbSeries.length ? tsbSeries[tsbSeries.length - 1] : null;
  const ctlD = (last.ctl != null && first.ctl != null) ? last.ctl - first.ctl : null;
  const base = T.wellness.baseline(wellness, T.iso(new Date()));
  const sleepAvg = avg(num(w, 'sleepH')), rhrAvg = avg(num(w, 'rhr'));
  const zone = T.wellness.formZone(tsb);
  return (
    <>
      <div className="section-title"><InfoLink onOpen={onSupport} topic="fitness-fatigue" />Fitness &amp; Fatigue <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>last {w.length} days</span></div>
      <div className="card">
        {/* the stat strip is the legend: each number wears its line's colour */}
        <div className="load-stats" style={{ marginBottom: 10 }}>
          <span><b style={{ color: 'var(--blue)' }}>{Math.round(last.ctl)}</b> Fitness (CTL){ctlD != null && <> <Signed v={ctlD} /></>}</span>
          <span><b style={{ color: 'var(--danger)' }}>{Math.round(last.atl)}</b> Fatigue (ATL)</span>
          {loadRows.length > 0 && loadRows[loadRows.length - 1].derived &&
            <span className="dim">estimated from your training log</span>}
        </div>
        {ctl.length >= 2 && <TrendChart height={120} axis series={[
          { values: ctl, color: 'var(--blue)', fill: true, width: 2.4 },
          { values: atl, color: 'var(--danger)', width: 1.8 },
        ]} />}
      </div>


      <div className="section-title"><InfoLink onOpen={onSupport} topic="form" />Form</div>
      <div className="card">
        {/* Form gets its OWN axis: the training zones only mean anything against a
            TSB scale. The domain always frames all five zones in true proportion,
            with the numeric boundaries marked on the axis. */}
        <div className="load-stats" style={{ marginBottom: 10 }}>
          <span><b style={{ color: 'var(--brick)' }}>{tsb != null ? <Signed v={tsb} /> : '—'}</b> Form (TSB)</span>
        </div>
        {tsbSeries.length >= 2 && <TrendChart height={120} domain={{ min: -35, max: 32 }}
          zones={T.wellness.FORM_ZONES.map(z => ({ ...z, active: !!zone && z.key === zone.key }))}
          series={[{ values: tsbSeries, color: 'var(--brick)', width: 2.2 }]} />}
        {onWhatIf && <a className="wi-link" {...tap(onWhatIf)} role="button">Try a what-if →</a>}
      </div>

      {(() => {
        // Ramp rate as a weekly histogram: a rate per week is discrete, so bars —
        // each coloured by its zone — with dashed lines at the +5 sustainable
        // ceiling and +8 injury territory (lighter than five background bands).
        const weekly = T.wellness.weeklyRamps(wellness, 10);
        const ramp = T.wellness.rampRate(wellness);
        if (weekly.length < 2 || ramp == null) return null;
        const rZone = T.wellness.rampZone(ramp);
        return (
          <>
            <div className="section-title"><InfoLink onOpen={onSupport} topic="ramp-rate" />Ramp rate</div>
            <div className="card">
              <div className="load-stats" style={{ marginBottom: 10 }}>
                <span title="Fitness (CTL) change over the trailing 7 days — sustained ramps above ~5/week raise injury risk"><b style={{ color: rZone ? rZone.color : 'var(--blue)' }}><Signed v={ramp} /></b> Ramp /wk · {rZone ? rZone.label : ''}</span>
              </div>
              <TrendChart height={120} domain={{ min: -3, max: 9 }}
                bars={weekly.map((e, i) => ({
                  v: e.ramp,
                  color: (T.wellness.rampZone(e.ramp) || {}).color,
                  label: i === weekly.length - 1 ? 'now' : T.fmtDate(e.week, { day: 'numeric', month: 'numeric' }),
                }))}
                refLines={[{ v: 5, color: '#facc15' }, { v: 8, color: '#ef4444' }]} />
            </div>
          </>
        );
      })()}

      <div className="section-title">Recovery</div>
      <div className="card">
        <div className="rd-pmc" style={{ marginTop: 0, marginBottom: 14 }}>
          <div><b>{last.hrv != null ? last.hrv : '—'}</b><span>HRV{base.hrvMean ? ' · base ' + Math.round(base.hrvMean) : ''}</span></div>
          <div><b>{rhrAvg != null ? Math.round(rhrAvg) : '—'}</b><span>Rest HR avg</span></div>
          <div><b>{sleepAvg != null ? T.wellness.fmtH(sleepAvg) : '—'}</b><span>Sleep avg</span></div>
        </div>
        {hrv.length >= 2 && <TrendChart height={120}
          band={base.hrvMean ? { lo: base.hrvMean - base.hrvSd, hi: base.hrvMean + base.hrvSd } : null}
          series={[{ values: hrv, color: 'var(--run)', width: 2.4 }]} />}
        <div className="chart-legend"><span><i style={{ background: 'var(--run)' }} />HRV</span><span className="dim">shaded = your baseline range</span></div>
      </div>
    </>
  );
}
