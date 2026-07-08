import { useState, useEffect } from 'react';
import { useUser } from '@clerk/react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { DaySelector } from '@/components/DaySelector.jsx';

// Best display name from the signed-in Clerk profile, or '' if none is set.
function clerkDisplayName(user) {
  if (!user) return '';
  return (user.firstName || user.fullName || user.username || '').trim();
}

export function Onboarding({ onCreate }) {
  const { user } = useUser();
  const [step, setStep] = useState(0);
  // Pre-fill the name from the Clerk login (the app only renders this when signed in).
  const [f, setF] = useState(() => ({
    name: clerkDisplayName(user), raceType: 'olympic', fitness: 'intermediate', trainingDays: [0, 1, 3, 5, 6], longDay: 5,
    raceDate: T.iso(T.addDays(new Date(), 84)), fivek: '', css100: '', ftp: '',
  }));
  // If Clerk loads the profile a beat later, fill the name once — never over typed input.
  useEffect(() => {
    const name = clerkDisplayName(user);
    if (name) setF(s => (s.name ? s : { ...s, name }));
  }, [user]);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  // How the chosen date sits against the race's recommended build window.
  const runway = (() => {
    if (f.raceType === 'maintenance') return null;
    const race = T.RACES[f.raceType];
    const weeks = Math.ceil((T.daysBetween(T.startOfWeekMonday(new Date()), f.raceDate) + 1) / 7);
    if (weeks > 52) return { blocked: true, color: '#f87171', note: 'That is over a year away — start with a maintenance block and pick the race later.' };
    if (weeks > race.maxWeeks) return { color: '#9ab8ff', note: weeks + ' weeks out: you will hold in maintenance for ' + (weeks - race.maxWeeks) + ' weeks, then the ' + race.maxWeeks + '-week ' + race.name + ' build begins.' };
    if (weeks < race.minWeeks) return { color: '#fde68a', note: weeks + ' weeks is under the recommended ' + race.minWeeks + ' for a ' + race.name + ' — this will be a sharpen-and-arrive plan, not a full build.' };
    return null;
  })();

  function finish() {
    const mon = T.startOfWeekMonday(new Date());
    const maintenance = f.raceType === 'maintenance';
    onCreate({
      name: f.name.trim() || 'Athlete', raceType: f.raceType, fitness: f.fitness,
      trainingDays: f.trainingDays, longDay: f.longDay,
      daysPerWeek: f.trainingDays.length,
      raceDate: maintenance ? T.iso(T.addDays(mon, 12 * 7 - 1)) : f.raceDate,
      horizonWeeks: maintenance ? 12 : undefined,
      fivekSec: T.parseTimeToSec(f.fivek), css100Sec: T.parseTimeToSec(f.css100),
      ftp: f.ftp ? Number(f.ftp) : null, startDate: T.iso(new Date()),
    });
  }

  return (
    <div className="app">
      <div className="topbar"><h1><Icon name="logo" size={24} /> Try</h1><div className="sub">Your personalised triathlon coach</div></div>
      <div className="card">
        {step === 0 && <>
          <h2>Let's build your plan</h2>
          <p className="lead">Three quick steps and you'll have a full periodised plan to race day.</p>
          <label className="field"><span className="lab">What should we call you?</span>
            <input value={f.name} placeholder="Your name" onChange={e => set('name', e.target.value)} /></label>
          <label className="field"><span className="lab">Which race are you training for?</span></label>
          <div className="choice">
            {Object.values(T.RACES).filter(r => !r.noRace).map(r => (
              <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} {...tap(() => set('raceType', r.key))}>
                {r.name}<small>{r.swim}k swim · {r.bike}k bike · {r.run}k run</small></div>
            ))}
            <div className={'opt' + (f.raceType === 'maintenance' ? ' on' : '')} {...tap(() => set('raceType', 'maintenance'))}>
              No race yet<small>A rolling 12-week block to stay fit until you pick one</small></div>
          </div>
          <div style={{ height: 12 }} />
          <button className="btn primary" onClick={() => setStep(1)}>Continue</button>
        </>}

        {step === 1 && <>
          <h2>Schedule & experience</h2>
          <p className="lead">This shapes your volume, intensity and ramp rate.</p>
          {f.raceType !== 'maintenance' && <>
            <label className="field"><span className="lab">Race date</span>
              <input type="date" value={f.raceDate} min={T.iso(T.addDays(new Date(), 7))} onChange={e => set('raceDate', e.target.value)} /></label>
            {runway && runway.note && <p className="lead" style={{ color: runway.color, fontSize: 13, marginTop: -6 }}>{runway.note}</p>}
          </>}
          {f.raceType === 'maintenance' && <p className="lead" style={{ fontSize: 13 }}>
            A 12-week keep-fit block: balanced swim, bike and run with a recovery week every few weeks.
            When you enter a race, the plan rebuilds around it.</p>}
          <label className="field" style={{ marginBottom: 8 }}><span className="lab">Which days will you train?</span></label>
          <DaySelector days={f.trainingDays} longDay={f.longDay} onChange={(d, l) => setF(s => ({ ...s, trainingDays: d, longDay: l }))} />
          <div style={{ height: 18 }} />
          <label className="field"><span className="lab">Experience level</span></label>
          <div className="choice">
            {Object.values(T.FITNESS).map(l => (
              <div key={l.key} className={'opt' + (f.fitness === l.key ? ' on' : '')} {...tap(() => set('fitness', l.key))}>{l.name}<small>{l.blurb}</small></div>
            ))}
          </div>
          <div style={{ height: 12 }} />
          <div className="row"><button className="btn ghost" onClick={() => setStep(0)}>Back</button>
            <button className="btn primary" disabled={!!(runway && runway.blocked)} onClick={() => setStep(2)}>Continue</button></div>
        </>}

        {step === 2 && <>
          <h2>Your current fitness <span className="hint" style={{ fontWeight: 500 }}>· optional</span></h2>
          <p className="lead"><b>New to triathlon? You can skip all of these.</b> We'll then guide every session by effort (RPE / heart-rate zones), with ballpark paces estimated from your {T.FITNESS[f.fitness].name} level. Add any numbers you do know to make it precise.</p>
          <label className="field"><span className="lab">Recent 5 km run time <span className="hint">optional · mm:ss</span></span>
            <input value={f.fivek} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].est5k)} onChange={e => set('fivek', e.target.value)} /></label>
          <label className="field"><span className="lab">Swim pace per 100 m <span className="hint">optional · mm:ss</span></span>
            <input value={f.css100} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].estCss)} onChange={e => set('css100', e.target.value)} /></label>
          <label className="field"><span className="lab">Cycling FTP <span className="hint">optional · watts</span></span>
            <input value={f.ftp} placeholder="e.g. 200" inputMode="numeric" onChange={e => set('ftp', e.target.value)} /></label>
          <div className="row"><button className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary" onClick={finish}>Generate plan →</button></div>
        </>}
      </div>
      <div className="center muted" style={{ fontSize: 12 }}>Step {step + 1} of 3</div>
    </div>
  );
}
