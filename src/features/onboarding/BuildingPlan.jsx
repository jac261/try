import { useState, useEffect } from 'react';
import * as T from '@/lib';
import { Icon } from '@/components/Icon.jsx';
const D = T.DISCIPLINES;

export function BuildingPlan({ plan, onDone }) {
  const p = plan.profile;
  const raceEntry = T.RACES[plan.race] || {};
  const race = raceEntry.name || 'race';
  const solo = raceEntry.solo || null;
  const steps = [
    'Reading your goals…',
    'Mapping out your ' + race + ' race day…',
    'Periodising Base → Build → Peak → Taper…',
    ...(solo ? ['Building your long run progression…'] : []),
    'Scheduling ' + p.daysPerWeek + ' sessions a week across ' + plan.totalWeeks + ' weeks…',
    'Setting your target paces…',
    'Your plan is ready',
  ];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const per = 460;
    const tick = setInterval(() => setStep(s => (s < steps.length - 1 ? s + 1 : s)), per);
    const done = setTimeout(onDone, per * (steps.length - 1) + 750);
    return () => { clearInterval(tick); clearTimeout(done); };
  }, []);
  const last = step === steps.length - 1;
  return (
    <div className="building">
      <div className="building-inner">
        <div className={'build-tiles' + (last ? ' done' : '')}>
          {(solo ? [solo] : ['swim', 'bike', 'run']).map(k =>
            <span key={k} className="build-tile" style={{ background: D[k].grad }}>
              <Icon name={k} size={26} />
            </span>
          )}
        </div>
        <h1 className="build-title">{last ? "You're all set" : 'Building your plan'}</h1>
        <div key={step} className="build-step">{steps[step]}</div>
        <div className="build-bar"><span style={{ width: ((step + 1) / steps.length * 100) + '%' }} /></div>
      </div>
    </div>
  );
}
