import * as T from '@/lib';

/* Phase 6 §1 + §3: what this long ride is for, and what to eat on it.
 *
 * Both are DERIVED at render time from the session that was already built and
 * the answers the athlete has already given, so nothing here can move a plan,
 * nothing needs to survive the wire, and a trim or a rebuild carries it for
 * free. That is the same choice the execution model and the distance estimate
 * made, for the same reason. */
export function BikeLongPlan({ w, plan, fuelLog, brickFollows }) {
  const objective = T.longRideObjective({ workout: w, seed: w.seed, brickFollows });
  const fuel = T.bikeFuellingPlan({
    workout: w, profile: plan && plan.profile, fuelLog, brickFollows,
  });
  if (!objective && !fuel) return null;
  return (
    <>
      {objective && <>
        <div className="section-title" style={{ margin: '16px 0 6px' }}>
          What this ride is for · {objective.label}
        </div>
        <div className="lead" style={{ margin: '0 0 6px', fontSize: 13 }}>{objective.why}</div>
        <div className="lead" style={{ margin: '0 0 6px', fontSize: 13 }}>
          {/* the cue must not point at a section this card will not render */}
          <b>{objective.focusLabel}.</b>{' '}
          {objective.focus === 'fuelling' && !fuel ? objective.focusCueAlone
            : objective.focus === 'position' && !T.positionAsk(w) ? objective.focusCueAlone
              : objective.focusCue}
        </div>
      </>}
      {fuel && <>
        <div className="section-title" style={{ margin: '16px 0 6px' }}>Fuelling</div>
        <div className="rd-pmc" style={{ marginTop: 0, flexWrap: 'wrap' }}>
          <div><b style={{ fontSize: 15 }}>{fuel.carbsPerHour} g</b><span>Carbs an hour</span></div>
          <div><b style={{ fontSize: 15 }}>{fuel.carbsTotal} g</b><span>Over {fuel.hours} h</span></div>
          <div><b style={{ fontSize: 15 }}>{fuel.fluidLoPerHour}–{fuel.fluidHiPerHour} ml</b><span>Fluid an hour</span></div>
        </div>
        <div className="lead" style={{ margin: '8px 0 0', fontSize: 13 }}>
          Start within the first {fuel.startAfterMin} minutes, before you need it. {fuel.why}
        </div>
        {fuel.provenGrams != null && (
          // makes the cap comprehensible rather than mysterious: the athlete
          // can see the number their own answers have earned
          <div className="lead" style={{ margin: '4px 0 0', fontSize: 12 }}>
            The most you have logged taking in is about {fuel.provenGrams} g an hour.
          </div>
        )}
        <div className="lead" style={{ margin: '4px 0 0', fontSize: 12 }}>
          Fluid over the whole ride: roughly {(fuel.fluidTotalLo / 1000).toFixed(1)}–{(fuel.fluidTotalHi / 1000).toFixed(1)} litres. {fuel.conditionsNote}
        </div>
        <div className="lead" style={{ margin: '4px 0 0', fontSize: 12 }}>{fuel.sodiumNote}</div>
      </>}
    </>
  );
}

/* §5: the one-tap position read, on the fuel tap's terms — a finished long
   ride, keyed by the RECORDING, always optional. It guides progression and
   never diagnoses a bike fit, which is why the symptom row records where it
   hurt and says nothing about why. */
export function PositionTap({ w, activity, positionLog, onPosition }) {
  if (!onPosition || !activity || !T.positionAsk(w)) return null;
  const saved = (positionLog && positionLog[activity.id]) || null;
  const comfort = saved && saved.comfort;
  const symptoms = (saved && saved.symptoms) || [];
  const toggle = key => {
    const next = symptoms.includes(key) ? symptoms.filter(s => s !== key) : symptoms.concat(key);
    onPosition(activity.id, comfort || 'ok', next, w.durationMin);
  };
  return (
    <>
      <div className="fuel-q">How did your position hold up?</div>
      <div className="feel-row fuel">
        {Object.entries(T.AERO_COMFORT).map(([k, lab]) => (
          <button key={k} className={'feelbtn' + (comfort === k ? ' on right' : '')}
            onClick={() => onPosition(activity.id, comfort === k ? null : k, symptoms, w.durationMin)}>{lab}</button>
        ))}
      </div>
      {comfort && <>
        <div className="fuel-cap">Anything complaining afterwards? Tap all that apply.</div>
        <div className="feel-row fuel">
          {Object.entries(T.AERO_SYMPTOMS).map(([k, lab]) => (
            <button key={k} className={'feelbtn' + (symptoms.includes(k) ? ' on right' : '')}
              onClick={() => toggle(k)}>{lab}</button>
          ))}
        </div>
      </>}
      {(() => {
        /* The answers, read back. Asking a question after every long ride and
           never using the answer is worse than not asking: this tap wrote to
           a store that nothing read until this was wired. Silent until there
           are enough answers to mean something. */
        const reads = Object.values(positionLog || {})
          .sort((a, b) => ((a.at || '') < (b.at || '') ? 1 : -1))
          .map(r => T.positionRead(r)).filter(Boolean);
        const tol = T.positionTolerance(reads);
        return tol.verdict === 'unknown' ? null
          : <div className="lead" style={{ margin: '6px 0 0', fontSize: 12 }}>{tol.text}</div>;
      })()}
    </>
  );
}
