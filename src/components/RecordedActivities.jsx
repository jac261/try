import * as T from '@/lib';
import { Icon } from '@/components/Icon.jsx';

/* What you actually DID on a day, as first-class rows: every watch recording
   for the date, with its data inline — independent of whether it matched a
   planned session (field decision 2026-07-11: a 50-min run against a planned
   brick matched nothing and simply vanished from the app). Average HR and
   power render as soon as the backend passes them through. */

const DISC = { Run: 'run', VirtualRun: 'run', Ride: 'bike', VirtualRide: 'bike', Swim: 'swim', OpenWaterSwim: 'swim' };

function statLine(a) {
  const disc = DISC[a.type];
  const bits = [];
  if (a.movingTimeSec) bits.push(T.fmtDuration(Math.round(a.movingTimeSec / 60)));
  if (a.distance) bits.push((a.distance / 1000).toFixed(a.distance >= 10000 ? 0 : 1) + ' km');
  if (a.movingTimeSec && a.distance) {
    if (disc === 'run') bits.push(T.fmtPace(a.movingTimeSec / (a.distance / 1000)) + ' /km');
    if (disc === 'swim') bits.push(T.fmtPace(a.movingTimeSec / (a.distance / 100)) + ' /100m');
    if (disc === 'bike') bits.push((a.distance / 1000 / (a.movingTimeSec / 3600)).toFixed(1) + ' km/h');
  }
  if (a.avgWatts) bits.push(Math.round(a.avgWatts) + ' W avg');
  if (a.avgHr) bits.push(Math.round(a.avgHr) + ' bpm avg');
  if (a.trainingLoad != null) bits.push('load ' + Math.round(a.trainingLoad));
  return bits.join(' · ');
}

export function RecordedActivities({ activities, date }) {
  const day = (activities || []).filter(a => a && a.date === date && DISC[a.type] && a.movingTimeSec);
  if (!day.length) return null;
  return (
    <>
      <div className="section-title" style={{ marginTop: 14 }}>Recorded</div>
      <div className="card">
        {day.map(a => (
          <a className="wk" key={a.id} href={T.activityUrl(a)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="dot" style={{ background: T.DISCIPLINES[DISC[a.type]].grad }}><Icon name={T.DISCIPLINES[DISC[a.type]].icon} size={22} /></div>
            <div className="meta">
              <div className="t">{a.name || a.type}</div>
              <div className="s">{statLine(a)}</div>
            </div>
            <div className="right" aria-hidden="true">↗</div>
          </a>
        ))}
      </div>
    </>
  );
}
