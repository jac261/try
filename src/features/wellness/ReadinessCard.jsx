import { useState } from 'react';
import * as T from '@/lib';
import { INTENSITY_TYPES } from '@/lib/tuning.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { TrendChart } from '@/components/charts.jsx';

// The training-load charts are analysis, not a morning glance — collapsed by
// default behind a one-line summary. A stored choice wins; with no choice yet
// they unfold themselves only when a zone needs attention (management by
// exception, same philosophy as the engine: quiet when everything is fine).
const LOAD_PREF = 'try.showLoad';
const loadPref = () => { try { return localStorage.getItem(LOAD_PREF); } catch (e) { return null; } };
const saveLoadPref = v => { try { localStorage.setItem(LOAD_PREF, v ? '1' : '0'); } catch (e) { /* private mode */ } };

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

export function ReadinessCard({ wellness, today, onEdit, onEase, onRestore, onOpen }) {
  const [loadChoice, setLoadChoice] = useState(loadPref);
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
      {(() => {
        // The adaptive engine (Phase 1): at most one reasoned proposal for today,
        // from this morning's band — rules & thresholds in docs/ADAPTIVE_ENGINE.md.
        // Stale wellness data never drives a change (yesterday's read isn't advice).
        const proposal = stale ? null : T.proposeToday({ band: rd.band, score: rd.score, todays: today });
        if (proposal) {
          const accept = proposal.action === 'easeToday' ? onEase
            : proposal.action === 'restoreToday' ? onRestore
            : () => onOpen && onOpen(proposal.workout);
          return (
            <div className="rd-proposal">
              <div className="ph"><Icon name={proposal.kind === 'restore' ? 'bolt' : proposal.kind === 'move-test' ? 'calendar' : 'rest'} size={16} /> {proposal.headline}</div>
              <div className="pw">{proposal.why}</div>
              <button className="btn ghost sm rd-action" onClick={accept}>
                {proposal.kind === 'move-test' ? 'Open & reschedule' : proposal.kind === 'restore' ? 'Restore the session' : 'Accept the swap'}
              </button>
            </div>
          );
        }
        if (eased) return <div className="rd-eased"><Icon name="rest" size={15} /> Today eased to {eased.title} for recovery · <a className="reset" {...tap(onRestore)}>undo</a></div>;
        return null;
      })()}
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
        // Training load lives behind a one-line summary (full-size analysis on
        // the Progress tab). The summary itself carries the status: each number
        // wears a dot in its zone's colour, so collapsed still answers "am I OK?".
        const load = wellness.filter(r => r.ctl != null && r.atl != null).slice(-60);
        if (load.length < 3) return null;
        const tsbSeries = load.map(r => (r.tsb != null ? r.tsb : r.ctl - r.atl));
        const lastLoad = load[load.length - 1];
        const tsbNow = tsbSeries[tsbSeries.length - 1];
        const zone = T.wellness.formZone(tsbNow);
        const ramp = T.wellness.rampRate(wellness);
        const rZone = T.wellness.rampZone(ramp);
        const alarm = (rZone && (rZone.key === 'aggressive' || rZone.key === 'risky'))
          || (zone && zone.key === 'highRisk');
        const open = loadChoice != null ? loadChoice === '1' : alarm;
        const toggle = () => { saveLoadPref(!open); setLoadChoice(open ? '0' : '1'); };
        return (
          <>
            <div className="rd-load-toggle" {...tap(toggle)} role="button"
              aria-expanded={open} aria-label="Toggle training load charts">
              <span className="rlt-title">Training load</span>
              <span className="rlt-stats">
                <span><i style={{ background: 'var(--blue)' }} />{Math.round(lastLoad.ctl)} fit</span>
                <span><i style={{ background: zone ? zone.color : 'var(--muted)' }} />{T.wellness.signed(tsbNow)} form</span>
                {ramp != null && <span><i style={{ background: rZone ? rZone.color : 'var(--muted)' }} />{T.wellness.signed(ramp)}/wk</span>}
              </span>
              <span className="rlt-chev">{open ? '▾' : '▸'}</span>
            </div>
            {open && <>
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
              // Ramp rate as a histogram: one bar per week, coloured by its zone
              // (a weekly rate is discrete — bars say that; a line implies a
              // continuity that isn't there). Dashed lines mark the +5
              // sustainable ceiling and +8 injury territory.
              const weekly = T.wellness.weeklyRamps(wellness, 8);
              if (weekly.length < 2 || ramp == null) return null;
              return (
                <div className="rd-trend">
                  <div className="rd-trend-head">
                    <span>Ramp rate</span>
                    <span>fitness gained per week</span>
                  </div>
                  <div className="load-stats">
                    <span title="Fitness (CTL) change over the trailing 7 days — sustained ramps above ~5/week raise injury risk"><b style={{ color: rZone ? rZone.color : 'var(--blue)' }}>{T.wellness.signed(ramp)}</b> Ramp /wk · {rZone ? rZone.label : ''}</span>
                  </div>
                  <TrendChart height={84} domain={{ min: -3, max: 9 }}
                    bars={weekly.map((e, i) => ({
                      v: e.ramp,
                      color: (T.wellness.rampZone(e.ramp) || {}).color,
                      label: i === weekly.length - 1 ? 'now' : T.fmtDate(e.week, { day: 'numeric', month: 'numeric' }),
                    }))}
                    refLines={[{ v: 5, color: '#facc15' }, { v: 8, color: '#ef4444' }]} />
                </div>
              );
            })()}
            </>}
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
