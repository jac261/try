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
          <b>{objective.focusLabel}.</b> {objective.focusCue}
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
    </>
  );
}
