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
        {(() => {
          // Only the signals that actually moved the score; a chip that says
          // "everything is normal" three different ways is noise.
          const movers = rd.why.filter(w => Math.abs(w.points || 0) >= 1);
          if (!movers.length) return <span className="rd-chip">All signals around your baseline</span>;
          return movers.map((w, i) => <span key={i} className={'rd-chip' + (w.bad ? ' bad' : '')}>{w.t}</span>);
        })()}
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
            <TrendChart height={84} band={{ lo: amber, hi: green }}
              series={[{ values: hist.map(h => h.score), color: BAND_COLOR[rd.band], fill: true }]} />
          </div>
        );
      })()}
      {(() => {
        // Compact training-load trends from the synced intervals.icu history
        // (full-size versions live on the Progress tab). Two charts, two scales:
        // Fitness & Fatigue share an axis; Form gets its OWN — the training zones
        // only mean anything against a TSB scale, and the domain always frames all
        // five zones in true proportion, with the boundary numbers on the axis.
        const load = wellness.filter(r => r.ctl != null && r.atl != null).slice(-60);
        if (load.length < 3) return null;
        const tsbSeries = load.map(r => (r.tsb != null ? r.tsb : r.ctl - r.atl));
        const lastLoad = load[load.length - 1];
        const tsbNow = tsbSeries[tsbSeries.length - 1];
        const zone = T.wellness.formZone(tsbNow);
        const ramp = T.wellness.rampRate(wellness);
        return (
          <>
            <div className="rd-trend">
              <div className="rd-trend-head">
                <span>Fitness &amp; Fatigue</span>
                <span>{load.length} days</span>
              </div>
              <div className="load-stats">
                <span><b style={{ color: 'var(--blue)' }}>{Math.round(lastLoad.ctl)}</b> Fitness</span>
                <span><b style={{ color: 'var(--danger)' }}>{Math.round(lastLoad.atl)}</b> Fatigue</span>
              </div>
              <TrendChart height={84} axis series={[
                { values: load.map(r => r.ctl), color: 'var(--blue)', fill: true, width: 2 },
                { values: load.map(r => r.atl), color: 'var(--danger)', width: 1.6 },
              ]} />
            </div>
            <div className="rd-trend">
              <div className="rd-trend-head">
                <span>Form</span>
                <span>fitness − fatigue</span>
              </div>
              <div className="load-stats">
                <span><b style={{ color: 'var(--brick)' }}>{T.wellness.signed(tsbNow)}</b> Form</span>
              </div>
              <TrendChart height={84} domain={{ min: -35, max: 32 }}
                zones={T.wellness.FORM_ZONES.map(z => ({ ...z, active: !!zone && z.key === zone.key }))}
                series={[{ values: tsbSeries, color: 'var(--brick)', width: 2 }]} />
            </div>
            {(() => {
              // Ramp rate last: how fast fitness is being built, against the
              // sustainable-ceiling zones (+5) and injury territory (+8).
              const ramps = T.wellness.rampHistory(wellness, 60);
              if (ramps.length < 3 || ramp == null) return null;
              const rZone = T.wellness.rampZone(ramp);
              return (
                <div className="rd-trend">
                  <div className="rd-trend-head">
                    <span>Ramp rate</span>
                    <span>fitness gained per week</span>
                  </div>
                  <div className="load-stats">
                    <span title="Fitness (CTL) change over the trailing 7 days — sustained ramps above ~5/week raise injury risk"><b style={{ color: 'var(--blue)' }}>{T.wellness.signed(ramp)}</b> Ramp /wk</span>
                  </div>
                  <TrendChart height={84} domain={{ min: -5, max: 9.5 }}
                    zones={T.wellness.RAMP_ZONES.map(z => ({ ...z, active: !!rZone && z.key === rZone.key }))}
                    series={[{ values: ramps.map(r => r.ramp), color: 'var(--blue)', width: 1.8 }]} />
                </div>
              );
            })()}
          </>
        );
      })()}
      <div className="rd-foot">
        <span>{stale ? 'From ' + T.fmtDate(rec.date, { month: 'short', day: 'numeric' }) : 'This morning'}</span>
        <a className="reset" {...tap(onEdit)}>Update →</a>
      </div>
    </div>
  );
}
