import * as T from '@/lib';
import { Icon } from '@/components/Icon.jsx';
import { TrendChart } from '@/components/charts.jsx';

export function WellnessTrends({ wellness }) {
  const w = wellness.filter(r => r.ctl != null || r.hrv != null);
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
      <div className="section-title">Fitness &amp; Fatigue <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>last {w.length} days</span></div>
      <div className="card">
        {/* the stat strip is the legend: each number wears its line's colour */}
        <div className="load-stats" style={{ marginBottom: 10 }}>
          <span><b style={{ color: 'var(--blue)' }}>{Math.round(last.ctl)}</b> Fitness (CTL){ctlD != null ? ' ' + T.wellness.signed(ctlD) : ''}</span>
          <span><b style={{ color: 'var(--danger)' }}>{Math.round(last.atl)}</b> Fatigue (ATL)</span>
          {(() => { const ramp = T.wellness.rampRate(wellness); return ramp != null
            ? <span title="Fitness (CTL) change over the last 7 days — sustained ramps above ~5/week raise injury risk"><b>{T.wellness.signed(ramp)}</b> Ramp /wk</span>
            : null; })()}
        </div>
        {ctl.length >= 2 && <TrendChart height={96} series={[
          { values: ctl, color: 'var(--blue)', fill: true, width: 2.4 },
          { values: atl, color: 'var(--danger)', width: 1.8 },
        ]} />}
      </div>

      <div className="section-title">Form <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>fitness − fatigue, on its own scale</span></div>
      <div className="card">
        {/* Form gets its OWN axis: the training zones only mean anything against a
            TSB scale. The domain always frames all five zones in true proportion,
            with the numeric boundaries marked on the axis. */}
        <div className="load-stats" style={{ marginBottom: 10 }}>
          <span><b style={{ color: 'var(--brick)' }}>{tsb != null ? T.wellness.signed(tsb) : '—'}</b> Form (TSB)</span>
        </div>
        {tsbSeries.length >= 2 && <TrendChart height={128} domain={{ min: -35, max: 32 }}
          zones={T.wellness.FORM_ZONES.map(z => ({ ...z, active: !!zone && z.key === zone.key }))}
          series={[{ values: tsbSeries, color: 'var(--brick)', width: 2.2 }]} />}
      </div>

      <div className="section-title">Recovery</div>
      <div className="card">
        <div className="rd-pmc" style={{ marginTop: 0, marginBottom: 14 }}>
          <div><b>{last.hrv != null ? last.hrv : '—'}</b><span>HRV{base.hrvMean ? ' · base ' + Math.round(base.hrvMean) : ''}</span></div>
          <div><b>{rhrAvg != null ? Math.round(rhrAvg) : '—'}</b><span>Rest HR avg</span></div>
          <div><b>{sleepAvg != null ? T.wellness.fmtH(sleepAvg) : '—'}</b><span>Sleep avg</span></div>
        </div>
        {hrv.length >= 2 && <TrendChart height={96}
          band={base.hrvMean ? { lo: base.hrvMean - base.hrvSd, hi: base.hrvMean + base.hrvSd } : null}
          series={[{ values: hrv, color: 'var(--run)', width: 2.4 }]} />}
        <div className="chart-legend"><span><i style={{ background: 'var(--run)' }} />HRV</span><span className="dim">shaded = your baseline range</span></div>
      </div>
    </>
  );
}
