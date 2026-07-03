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
      <div className="section-title">Fitness &amp; Form <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>last {w.length} days</span></div>
      <div className="card">
        <div className="rd-pmc" style={{ marginTop: 0, marginBottom: 14 }}>
          <div><b>{Math.round(last.ctl)}</b><span>Fitness{ctlD != null ? ' ' + T.wellness.signed(ctlD) : ''}</span></div>
          <div><b>{Math.round(last.atl)}</b><span>Fatigue</span></div>
          <div><b>{tsb != null ? T.wellness.signed(tsb) : '—'}</b><span>Form{zone ? ' · ' + zone.label.toLowerCase() : ''}</span></div>
        </div>
        {ctl.length >= 2 && <TrendChart height={116} zones={T.wellness.FORM_ZONES} series={[
          { values: ctl, color: 'var(--blue)', fill: true, width: 2.4 },
          { values: atl, color: 'var(--muted)', width: 1.8 },
          { values: tsbSeries, color: 'var(--brick)', width: 2 },
        ]} />}
        <div className="chart-legend">
          <span><i style={{ background: 'var(--blue)' }} />Fitness (CTL)</span>
          <span><i style={{ background: 'var(--muted)' }} />Fatigue (ATL)</span>
          <span><i style={{ background: 'var(--brick)' }} />Form (TSB)</span>
        </div>
        <div className="chart-legend zone-legend">
          {T.wellness.FORM_ZONES.map(z => <span key={z.key} title={z.blurb}><i style={{ background: z.color }} />{z.label}</span>)}
        </div>
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
