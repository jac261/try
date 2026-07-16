import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { useSheetFocus } from '@/utils/useSheetFocus.js';
import { TrendChart } from '@/components/charts.jsx';

/* The what-if simulator: a read-only lens over the load model, opened from
 * the Form card on Progress or from a workout's own detail sheet ("What if I
 * skip this?"). Two scenarios, words before curves, a permanent estimate
 * caveat, and refusals where the model cannot answer honestly. It never
 * writes: the only exit is the athlete going and making the change through
 * the real controls. */

function Result({ res }) {
  if (!res) return null;
  if (!res.ok) return <p className="lead" style={{ marginTop: 12 }}>{res.reason}</p>;
  return (
    <>
      <p className="wi-verdict">{res.verdict}</p>
      {res.assumption && <p className="wi-assumption">{res.assumption}</p>}
      <p className="wi-caveat">{T.WHATIF_CAVEAT}{res.caveatDerived ? ' ' + T.WHATIF_CAVEAT_DERIVED : ''}</p>
      {res.series && res.series.scenario.length >= 2 && (
        <>
          <TrendChart height={120} domain={{ min: -35, max: 32 }}
            zones={T.wellness.FORM_ZONES}
            series={[
              { values: res.series.planned, color: 'var(--muted)', width: 1.6 },
              { values: res.series.scenario, color: 'var(--blue)', width: 2.4 },
            ]} />
          <div className="chart-legend">
            <span><i style={{ background: 'var(--muted)' }} />as planned</span>
            <span><i style={{ background: 'var(--blue)' }} />this what-if</span>
          </div>
        </>
      )}
    </>
  );
}

export function WhatIfSheet({ plan, log, moves, adjust, wellness, todayISO, initial, onClose }) {
  // initial: { tab: 'miss'|'race', skipIds?, skipLabel? } — the detail-sheet
  // doorway arrives pre-filled with its own session.
  const [tab, setTab] = useState((initial && initial.tab) || 'miss');
  const [weekIdx, setWeekIdx] = useState(null);
  const [delta, setDelta] = useState(null);
  const sheetRef = useSheetFocus(onClose);

  const inputs = { plan, log, moves, adjust, wellness, todayISO };
  const weeks = T.missWeekCandidates({ plan, log, moves, todayISO });
  const bounds = T.raceMoveBounds({ plan, moves, todayISO });

  const preset = initial && initial.skipIds;
  const chosen = preset ? null : weeks.find(w => w.index === weekIdx);
  const missRes = preset
    ? T.simulateMiss({ ...inputs, skipIds: initial.skipIds, skipLabel: initial.skipLabel })
    : chosen ? T.simulateMiss({ ...inputs, skipIds: chosen.ids, skipLabel: chosen.label.replace(' · ', ' (') + ')' }) : null;

  const raceRes = delta != null && bounds
    ? T.simulateRaceMove({ ...inputs, newRaceDate: T.iso(T.addDays(bounds.raceDate, delta)) })
    : null;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="What if" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '2px 0 2px' }}>What if…</h2>
        <p className="lead" style={{ marginBottom: 10 }}>A preview, not a change. Nothing here touches your plan.</p>

        {!preset && (
          <div className="wi-tabs" role="tablist">
            {[['miss', 'Miss a week'], ['race', 'Move my race']].map(([k, lab]) => (
              <button key={k} role="tab" id={'wi-tab-' + k} aria-controls={'wi-panel-' + k} aria-selected={tab === k}
                className={'btn sm ' + (tab === k ? 'primary' : 'ghost')}
                style={{ width: 'auto', flex: 1 }} onClick={() => setTab(k)}>{lab}</button>
            ))}
          </div>
        )}

        {(preset || tab === 'miss') && (
          <div role="tabpanel" id="wi-panel-miss" aria-labelledby={preset ? undefined : 'wi-tab-miss'}>
            {!preset && (weeks.length ? (
              <div className="wi-chips">
                {weeks.map(w => (
                  <button key={w.index} className={'btn sm ' + (weekIdx === w.index ? 'primary' : 'ghost')}
                    style={{ width: 'auto' }} onClick={() => setWeekIdx(w.index)}>{w.label}</button>
                ))}
              </div>
            ) : (
              <p className="lead" style={{ marginTop: 12 }}>Every week left in this plan is taper, recovery, or race week. There is nothing left to safely simulate missing.</p>
            ))}
            <Result res={missRes} />
          </div>
        )}

        {!preset && tab === 'race' && (
          <div role="tabpanel" id="wi-panel-race" aria-labelledby="wi-tab-race">
            {bounds ? (
              <>
                <div className="wi-chips">
                  {[-14, -7, 7, 14].map(d => {
                    const target = T.iso(T.addDays(bounds.raceDate, d));
                    const out = target <= bounds.min || target > bounds.max;
                    return (
                      <button key={d} disabled={out}
                        className={'btn sm ' + (delta === d ? 'primary' : 'ghost')}
                        style={{ width: 'auto', opacity: out ? 0.45 : 1 }}
                        onClick={() => setDelta(d)}>
                        {d < 0 ? '−' + Math.abs(d / 7) + ' wk' : '+' + d / 7 + ' wk'}
                      </button>
                    );
                  })}
                </div>
                <Result res={raceRes} />
              </>
            ) : (
              <p className="lead" style={{ marginTop: 12 }}>This plan does not have a race day to move. Start a race plan to try this one.</p>
            )}
          </div>
        )}

        <div style={{ height: 8 }} />
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
