import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { useSheetFocus } from '@/utils/useSheetFocus.js';
import { weekRange } from '@/lib/schedule.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutProfile } from '@/components/WorkoutProfile.jsx';
import { InfoLink } from '@/components/InfoLink.jsx';

const D = T.DISCIPLINES;

const WHY = {
  'Easy': 'Build your aerobic base. Keep it conversational — easy enough to chat the whole way.',
  'Long': 'Build endurance for race day. Stay aerobic and relaxed, and practise your fuelling.',
  'Fartlek': 'Play with speed. Surge when it feels right, float in between - structure without the track.',
  'Tempo': 'Raise the pace you can hold for the long haul. Settle into a steady "comfortably hard" effort.',
  'Threshold': 'Lift your threshold — the effort you could just sustain for an hour. Strong and controlled, never all-out.',
  'VO2 Intervals': 'Sharpen your top-end fitness. Commit to the target pace on every rep, then recover fully.',
  'Endurance': 'Lay down aerobic base on the bike. Smooth, steady and mostly Zone 2.',
  'Sweet Spot': 'Big aerobic and threshold gains for the time spent. Sustained, just below threshold.',
  'Technique': 'Groove efficient form while fresh. Focus on a clean catch and a long, balanced body line.',
  'CSS Intervals': 'Build sustainable swim speed. Hold your CSS pace — smooth and controlled, not a sprint.',
  'Race Pace': 'Rehearse race effort so it feels familiar. Strong and relaxed at your goal pace.',
  'Brick': 'Teach your legs to run off the bike. Expect heaviness at first — find your run rhythm quickly.',
  'Strength': 'Build durability and power to resist fatigue and injury. Quality over quantity — move well, brace your core.',
  'Open Water': 'Rehearse race-day swimming. Practise sighting, drafting and holding a straight line without walls to push off.',
};

// Some types exist in more than one sport; where the shared wording would name
// the wrong one, a discipline-specific entry wins (field report 2026-07-11: an
// Endurance Swim explained itself as a bike session).
const WHY_DISC = {
  'swim:Endurance': 'Build aerobic endurance in the water. Long, smooth and unhurried — hold relaxed form as the distance adds up.',
};

export function DetailSheet({ w, plan, done, onClose, onToggle, eff, onMove, onResetMove, onLogResult, feel, onFeel, onRestore, onRemove, activity, onSupport }) {
  const canFit = T.FIT && T.FIT.supports(w);
  const disc = D[w.discipline];
  const why = !w.race && !w.test ? (WHY_DISC[w.discipline + ':' + w.type] || WHY[w.type]) : null;
  const shown = eff || w.date;
  const moved = shown !== w.date;
  const days = weekRange(w.date);
  const sheetRef = useSheetFocus(onClose);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label={w.title} onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="hero">
          <div className="dot" style={{ background: disc.grad }}><Icon name={disc.icon} size={26} /></div>
          <div><h2>{w.title}</h2><div className="s">{T.fmtDate(shown, { weekday: 'long', month: 'long', day: 'numeric' })} · {w.phase} phase</div></div>
        </div>
        {w.eased && <div className="testnote"><Icon name="heartrate" size={18} /><span>Eased from your planned {w.easedFrom} session for recovery. {onRestore && <a className="reset" {...tap(onRestore)}>Restore the hard session</a>}</span></div>}
        {w.trimmed && <div className="testnote"><Icon name="trend" size={18} /><span>Trimmed from {T.fmtDuration(w.trimmedFrom)} by the adaptive engine to protect you from overload. {onRestore && <a className="reset" {...tap(onRestore)}>Restore full volume</a>}</span></div>}
        {w.boosted && <div className="testnote"><Icon name="flame" size={18} /><span>Extended from {T.fmtDuration(w.boostedFrom)} — your form showed room to absorb more load. {onRestore && <a className="reset" {...tap(onRestore)}>Back to the planned volume</a>}</span></div>}
        {!w.race && <div className="statline">
          <div className="s"><b>{T.fmtDuration(w.durationMin || 0)}</b><span>Duration</span></div>
          {w.distance && <div className="s"><b>{w.distance}</b><span>{w.unit}</span></div>}
          <div className="s"><b>{disc.name}</b><span>{w.type}</span></div>
        </div>}
        {why && <div className="why" style={{ borderColor: disc.color }}><span className="why-label">Why this session</span>{why}</div>}
        <div className="section-title" style={{ margin: '8px 0 2px' }}>{!w.race && !w.bRace && <InfoLink onOpen={onSupport} topic="workout-library" />}{w.race || w.bRace ? 'Race plan' : 'Workout'}</div>
        <WorkoutProfile w={w} />
        {w.segments.map((s, i) => (
          <div className="seg" key={i}>
            <div className="bar" style={{ background: disc.color }} />
            <div><div className="l">{s.label}</div><div className="d">{s.detail}</div></div>
            {s.min ? <div className="m">{s.min} min</div> : null}
          </div>
        ))}
        {!w.race && !w.bRace && onMove && <>
          <div className="section-title" style={{ margin: '18px 0 8px' }}>Reschedule
            {moved && <a className="reset" {...tap(() => onResetMove(w.id))}> ↺ reset</a>}</div>
          <div className="days">
            {days.map((d, i) => {
              const lab = ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i];
              return <div key={d} className={'d' + (d === shown ? ' on' : '')}
                aria-label={'Move to ' + T.fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' }) + (d === shown ? ' (current day)' : '')}
                {...tap(() => onMove(w.id, d))}>
                <div style={{ fontSize: 10, fontWeight: 600, opacity: .7 }}>{lab}</div>
                {Number(d.slice(8))}</div>;
            })}
          </div>
        </>}
        <div style={{ height: 16 }} />
        {w.test && w.note && <div className="testnote"><Icon name="stopwatch" size={18} /><span>{w.note}</span></div>}
        {w.test && onLogResult && <><button className="btn primary" onClick={onLogResult}><Icon name="trend" size={18} /> Log result &amp; re-target</button><div style={{ height: 10 }} /></>}
        {!w.race && <button className={'btn ' + (done ? 'done' : (w.test ? 'ghost' : 'primary'))} onClick={onToggle}>
          {done ? '✓ Completed — tap to undo' : 'Mark as complete'}</button>}
        {canFit && <>
          <div style={{ height: 10 }} />
          <button className="btn ghost" onClick={() => T.FIT.download(w, plan)}>
            <Icon name="watch" size={18} /> Send to watch (.FIT)</button>
          <div className="fithint">Structured workout with {w.discipline === 'bike' ? (plan.paces.ftp ? 'power' : 'effort (RPE)') : 'pace'} targets — load onto a Garmin to follow it step by step.</div>
        </>}
        {done && !w.race && onFeel && <div className="feel">
          <div className="feel-q">How did it feel?</div>
          <div className="feel-row">
            {[['easy', 'Easy'], ['right', 'Just right'], ['hard', 'Hard']].map(([k, lab]) =>
              <button key={k} className={'feelbtn' + (feel === k ? ' on ' + k : '')} onClick={() => onFeel(w.id, k)}>{lab}</button>)}
          </div>
        </div>}
        {activity && <a className="act-link" href={T.activityUrl(activity)} target="_blank" rel="noopener noreferrer">
          <Icon name="watch" size={15} /> See your recording on intervals.icu{activity.name ? ' · ' + activity.name : ''} ↗</a>}
        {(w.race || w.bRace) && <div className="card center" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)', margin: 0 }}><b style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name="trophy" size={18} /> You've got this.</b></div>}
        {w.custom && onRemove && <>
          <div style={{ height: 10 }} />
          <button className="btn ghost remove" onClick={onRemove}>Remove this session</button>
        </>}
      </div>
    </div>
  );
}

