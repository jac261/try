import * as T from '@/lib';
import { INTENSITY_TYPES } from '@/lib/tuning.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { TrendChart } from '@/components/charts.jsx';

const BAND_COLOR = { green: 'var(--run)', amber: 'var(--bike)', red: 'var(--danger)' };

function ReadinessRing({ score, band }) {
  const r = 26, c = 2 * Math.PI * r;
  const col = BAND_COLOR[band];
  return (
    <svg width="74" height="74" viewBox="0 0 72 72" style={{ flex: 'none' }}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--track)" strokeWidth="6" />
      <circle cx="36" cy="36" r={r} fill="none" stroke={col} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={(score / 100 * c) + ' ' + c} transform="rotate(-90 36 36)" />
      <text x="36" y="41" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--ink)">{score}</text>
    </svg>
  );
}

export function ReadinessCard({ wellness, today, onEdit, onEase, onRestore }) {
  const todayISO = T.iso(new Date());
  const rec = wellness.find(r => r.date === todayISO) || (wellness.length ? wellness[wellness.length - 1] : null);
  if (!rec) {
    return (
      <div className="banner rd-empty" {...tap(onEdit)}>
        <div className="bi"><Icon name="heartrate" size={20} /></div>
        <div><div className="bt">Add your morning readiness</div>
          <div className="bs">Log HRV, sleep &amp; resting HR for a daily go / ease / recover call →</div></div>
      </div>
    );
  }
  const base = T.wellness.baseline(wellness, todayISO);
  const rd = T.wellness.readiness(rec, base);
  const eased = today.find(w => w.eased);
  const hard = today.find(w => INTENSITY_TYPES[w.type]);
  const sessTitle = (hard || eased || today.find(w => w.discipline !== 'rest') || {}).title;
  const adv = T.wellness.advice(rd.band, !!hard, today.length && sessTitle ? sessTitle : 'rest day');
  const stale = rec.date !== todayISO;
  return (
    <div className={'card rd rd-' + rd.band}>
      <div className="rd-top">
        <ReadinessRing score={rd.score} band={rd.band} />
        <div className="rd-main">
          <div className="rd-headline">{rd.headline}</div>
          <div className="rd-advice">{adv}</div>
        </div>
      </div>
      {eased
        ? <div className="rd-eased"><Icon name="rest" size={15} /> Today eased to {eased.title} for recovery · <a className="reset" {...tap(onRestore)}>undo</a></div>
        : (!stale && rd.band !== 'green' && hard && <button className="btn ghost sm rd-action" onClick={onEase}>Ease today's {hard.title} → easy aerobic</button>)}
      <div className="rd-why">
        {rd.why.map((w, i) => <span key={i} className={'rd-chip' + (w.bad ? ' bad' : '')}>{w.t}</span>)}
      </div>
      {(() => {
        // Readiness over the recent days, each scored against its own rolling
        // baseline; the shaded band is the amber zone (55-75), so where the line
        // sits tells you green/amber/red at a glance.
        const hist = T.wellness.history(wellness, 14);
        if (hist.length < 3) return null;
        const amber = T.wellness.MODEL.bands.find(b => b.key === 'amber').min;
        const green = T.wellness.MODEL.bands.find(b => b.key === 'green').min;
        return (
          <div className="rd-trend">
            <div className="rd-trend-head">
              <span>Readiness trend</span>
              <span>{T.fmtDate(hist[0].date, { month: 'short', day: 'numeric' })} – {T.fmtDate(hist[hist.length - 1].date, { month: 'short', day: 'numeric' })}</span>
            </div>
            <TrendChart height={62} band={{ lo: amber, hi: green }}
              series={[{ values: hist.map(h => h.score), color: BAND_COLOR[rd.band], fill: true }]} />
          </div>
        );
      })()}
      {(rec.ctl != null || rec.tsb != null) && <div className="rd-pmc">
        {rec.ctl != null && <div><b>{Math.round(rec.ctl)}</b><span>Fitness</span></div>}
        {rec.atl != null && <div><b>{Math.round(rec.atl)}</b><span>Fatigue</span></div>}
        {rec.tsb != null && <div><b>{T.wellness.signed(rec.tsb)}</b><span>Form</span></div>}
      </div>}
      {(() => {
        // Compact Fitness & Form trend from the synced intervals.icu training-load
        // history (full-size version lives on the Progress tab): Fitness (CTL)
        // filled, Fatigue (ATL) thin — the gap between them is Form.
        const load = wellness.filter(r => r.ctl != null && r.atl != null).slice(-60);
        if (load.length < 3) return null;
        return (
          <div className="rd-trend">
            <div className="rd-trend-head">
              <span>Fitness &amp; Form</span>
              <span>fitness − fatigue = form · {load.length} days</span>
            </div>
            <TrendChart height={54} series={[
              { values: load.map(r => r.ctl), color: 'var(--blue)', fill: true, width: 2 },
              { values: load.map(r => r.atl), color: 'var(--muted)', width: 1.6 },
            ]} />
          </div>
        );
      })()}
      <div className="rd-foot">
        <span>{stale ? 'From ' + T.fmtDate(rec.date, { month: 'short', day: 'numeric' }) : 'This morning'}</span>
        <a className="reset" {...tap(onEdit)}>Update →</a>
      </div>
    </div>
  );
}
