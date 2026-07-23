import { useState, useEffect } from 'react';
import { useUser } from '@clerk/react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { DaySelector } from '@/components/DaySelector.jsx';
import { PoolControl } from '@/components/PoolControl.jsx';

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
    raceDate: T.iso(T.addDays(new Date(), 84)), fivek: '', css100: '', ftp: '', weightKg: '', excludedDiscipline: null, pool: T.DEFAULT_POOL,
  }));
  // If Clerk loads the profile a beat later, fill the name once — never over typed input.
  useEffect(() => {
    const name = clerkDisplayName(user);
    if (name) setF(s => (s.name ? s : { ...s, name }));
  }, [user]);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const pickPool = np => setF(s => {
    const cur = T.parseTimeToSec(s.css100);
    const css100 = cur != null ? T.fmtPace(T.pacePer100ForDisplay(T.css100mFromDisplay(cur, s.pool), np)) : s.css100;
    return { ...s, pool: np, css100 };
  });
  const solo = (T.RACES[f.raceType] || {}).solo || null;

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
      // never submit a number for the excluded discipline: the field hides,
      // but a value typed BEFORE selecting the exclusion would still be in
      // state (gauntlet catch: type a 5k time, go back, exclude running)
      fivekSec: f.excludedDiscipline === 'run' ? null : T.parseTimeToSec(f.fivek),
      css100Sec: f.excludedDiscipline === 'swim' ? null : (() => { const d = T.parseTimeToSec(f.css100); return d != null ? Math.round(T.css100mFromDisplay(d, f.pool)) : null; })(),
      pool: f.pool,
      ftp: f.ftp ? Number(f.ftp) : null, weightKg: f.weightKg ? Number(f.weightKg) : null,
      startDate: T.iso(new Date()),
      // A solo race cannot exclude its only discipline; cleared here as well
      // as at selection time (render-time hiding alone leaves stale state).
      excludedDiscipline: solo ? null : (f.excludedDiscipline || null),
    });
  }

  return (
    <div className="app">
      <div className="topbar"><h1><Icon name="logo" size={24} /> Try</h1><div className="sub">Your personalised endurance coach</div></div>
      <div className="card">
        {step === 0 && <>
          <h2>Let's build your plan</h2>
          <p className="lead">Three quick steps and you'll have a full periodised plan to race day.</p>
          <label className="field"><span className="lab">What should we call you?</span>
            <input value={f.name} placeholder="Your name" onChange={e => set('name', e.target.value)} /></label>
          <label className="field"><span className="lab">Which race are you training for?</span></label>
          {/* Selecting a run race clears any injury exclusion: a solo plan
              cannot exclude its only discipline, and the injury step below
              hides for solo races (finish() clears it again defensively). */}
          <div className="lab muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>Triathlon</div>
          <div className="choice">
            {Object.values(T.RACES).filter(r => !r.noRace && !r.solo).map(r => (
              <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} {...tap(() => set('raceType', r.key))}>
                {r.name}<small>{r.swim}k swim · {r.bike}k bike · {r.run}k run</small></div>
            ))}
          </div>
          <div className="lab muted" style={{ fontSize: 12, margin: '10px 0 6px' }}>Running</div>
          <div className="choice">
            {Object.values(T.RACES).filter(r => r.solo).map(r => (
              <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} {...tap(() => setF(s2 => ({ ...s2, raceType: r.key, excludedDiscipline: null })))}>
                {r.name}<small>{r.run} km</small></div>
            ))}
          </div>
          {/* Outside both sport groups on purpose: maintenance is a
              three-sport block, and under the Running header it read as
              run-only maintenance (gauntlet catch). */}
          <div className="choice" style={{ marginTop: 10 }}>
            <div className={'opt' + (f.raceType === 'maintenance' ? ' on' : '')} {...tap(() => set('raceType', 'maintenance'))}>
              No race yet<small>A rolling 12-week block of all three sports to stay fit until you pick one</small></div>
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
          {!solo && <>
          <label className="field" style={{ marginBottom: 4 }}><span className="lab">Any injury we should plan around?</span></label>
          <p className="lead" style={{ fontSize: 13, marginTop: 0 }}>
            This is not medical advice. If you are not sure whether to train at all, check with a doctor
            or physio first. Tell us what to leave out and we will build the rest of your week around it.</p>
          <div className="choice">
            <div className={'opt' + (!f.excludedDiscipline ? ' on' : '')} {...tap(() => set('excludedDiscipline', null))}>
              Training as normal<small>All three sports</small></div>
            <div className={'opt' + (f.excludedDiscipline === 'run' ? ' on' : '')} {...tap(() => set('excludedDiscipline', 'run'))}>
              Can't run right now<small>No run sessions. Swim and bike keep building, and that fitness carries over.</small></div>
            <div className={'opt' + (f.excludedDiscipline === 'swim' ? ' on' : '')} {...tap(() => set('excludedDiscipline', 'swim'))}>
              Can't swim right now<small>No swim sessions. Bike and run keep building normally.</small></div>
          </div>
          {f.excludedDiscipline && f.raceType !== 'maintenance' && (
            <p className="lead" style={{ color: '#fde68a', fontSize: 13, marginTop: 8 }}>
              A {T.RACES[f.raceType].name} needs swimming, biking and running on the day. This plan trains
              {f.excludedDiscipline === 'run' ? ' swim and bike' : ' bike and run'} only, and it will not
              change on its own if your injury does. If you are not sure you will be
              {f.excludedDiscipline === 'run' ? ' running' : ' swimming'} again well before race day,
              consider starting with No race yet instead.</p>
          )}
          {f.excludedDiscipline === 'run' && f.trainingDays.length > 5 && (
            <p className="lead" style={{ fontSize: 13, marginTop: 8 }}>
              With running out, swim and bike top out at five real sessions a week. Extra days you pick
              will stay free rather than being filled with padding.</p>
          )}
          </>}
          <div style={{ height: 12 }} />
          <label className="field" style={{ marginBottom: 8 }}><span className="lab">Which days will you train?</span></label>
          <DaySelector days={f.trainingDays} longDay={f.longDay} onChange={(d, l) => setF(s => ({ ...s, trainingDays: d, longDay: l }))} />
          <div style={{ height: 18 }} />
          <label className="field"><span className="lab">Experience level</span></label>
          <div className="choice">
            {Object.values(T.FITNESS).map(l => (
              <div key={l.key} className={'opt' + (f.fitness === l.key ? ' on' : '')} {...tap(() => set('fitness', l.key))}>{l.name}<small>{solo ? l.runBlurb : l.blurb}</small></div>
            ))}
          </div>
          <div style={{ height: 12 }} />
          <div className="row"><button className="btn ghost" onClick={() => setStep(0)}>Back</button>
            <button className="btn primary" disabled={!!(runway && runway.blocked)} onClick={() => setStep(2)}>Continue</button></div>
        </>}

        {step === 2 && <>
          <h2>Your current fitness <span className="hint" style={{ fontWeight: 500 }}>· optional</span></h2>
          {solo ? <p className="lead">One number is enough: your 5k time sets every pace in the plan, from easy runs to race day. No recent 5k time? You can skip this. Every session is guided by effort, with ballpark paces estimated from your {T.FITNESS[f.fitness].name} level. Add a real time whenever you have one to make them precise.</p>
            : <p className="lead"><b>New to triathlon? You can skip all of these.</b> We'll then guide every session by effort (RPE / heart-rate zones), with ballpark paces estimated from your {T.FITNESS[f.fitness].name} level. Add any numbers you do know to make it precise.</p>}
          {f.excludedDiscipline !== 'run' && <label className="field"><span className="lab">Recent 5 km run time <span className="hint">optional · mm:ss</span></span>
            <input value={f.fivek} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].est5k)} onChange={e => set('fivek', e.target.value)} /></label>}
          {f.excludedDiscipline === 'run' && <p className="lead" style={{ fontSize: 13 }}>Running is out of your plan for now, so we will not ask for a run time.</p>}
          {!solo && f.excludedDiscipline !== 'swim' && <>
            <label className="field"><span className="lab">Swim pace per 100 {f.pool.unit === 'yards' ? 'yd' : 'm'} <span className="hint">optional · mm:ss</span></span>
              <input value={f.css100} placeholder={'e.g. ' + T.fmtPace(T.pacePer100ForDisplay(T.FITNESS[f.fitness].estCss, f.pool))} onChange={e => set('css100', e.target.value)} /></label>
            <label className="field" style={{ marginBottom: 4 }}><span className="lab">Pool <span className="hint">changes swim distances and display, not your fitness</span></span></label>
            <PoolControl pool={f.pool} onChange={pickPool} />
          </>}
          {f.excludedDiscipline === 'swim' && <p className="lead" style={{ fontSize: 13 }}>Swimming is out of your plan for now, so we will not ask for a swim pace.</p>}
          {!solo && <label className="field"><span className="lab">Cycling FTP <span className="hint">optional · watts</span></span>
            <input value={f.ftp} placeholder={'e.g. ' + (T.saneWeightKg(f.weightKg) ? Math.round(T.FITNESS[f.fitness].estWkg * T.saneWeightKg(f.weightKg)) : 200)}
              inputMode="numeric" onChange={e => set('ftp', e.target.value)} /></label>}
          {/* Weight belongs here, not only in Settings: without it a rider who
              skips the optional FTP gets no watt targets at all, which is the
              exact athlete the estimate exists for (gauntlet catch
              2026-07-18). */}
          <label className="field"><span className="lab">Weight <span className="hint">{solo ? 'optional · kg · never judged' : 'optional · kg — lets us estimate your bike targets'}</span></span>
            <input value={f.weightKg} placeholder="e.g. 70" inputMode="decimal" onChange={e => set('weightKg', e.target.value)} /></label>
          <div className="row"><button className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary" onClick={finish}>Generate plan →</button></div>
        </>}
      </div>
      <div className="center muted" style={{ fontSize: 12 }}>Step {step + 1} of 3</div>
    </div>
  );
}
