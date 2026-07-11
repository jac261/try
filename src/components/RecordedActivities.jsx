import * as T from '@/lib';
import { effDate } from '@/lib/schedule.js';
import { Icon } from '@/components/Icon.jsx';

/* What you actually DID on a day, as first-class rows: every watch recording
   for the date, with its data inline — independent of whether it matched a
   planned session (field decision 2026-07-11). Two truthfulness rules:
   a brick's ride+run recordings fold into ONE row when they pair with the
   day's brick session, and any recording matched to a completed session is
   tagged with it, so plan and reality visibly connect without double-counting.
   Average HR and power render as soon as the backend passes them through. */

const DISC = T.DISCIPLINE; // activity type → discipline (autolog's map)

function statBits(a, disc) {
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

function Row({ disc, name, stat, tag, href }) {
  return (
    <a className="wk" href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="dot" style={{ background: T.DISCIPLINES[disc].grad }}><Icon name={T.DISCIPLINES[disc].icon} size={22} /></div>
      <div className="meta">
        <div className="t">{name} {tag && <span className="tag key">{tag}</span>}</div>
        <div className="s">{stat}</div>
      </div>
      <div className="right" aria-hidden="true">↗</div>
    </a>
  );
}

export function RecordedActivities({ activities, date, plan, log, moves }) {
  const day = (activities || []).filter(a => a && a.date === date && DISC[a.type] && a.movingTimeSec);
  if (!day.length) return null;
  const sessions = plan && Array.isArray(plan.weeks)
    ? plan.weeks.flatMap(w => w.workouts).filter(w => effDate(w, moves) === date) : [];

  // Fold each brick session's recording pair into one combined row.
  const rows = [];
  const claimed = new Set();
  sessions.filter(w => w.discipline === 'brick').forEach(w => {
    const pair = T.brickPairFor({ workout: w, activities, moves, used: claimed });
    if (!pair) return;
    claimed.add(pair.ride.id); claimed.add(pair.run.id);
    const load = (pair.ride.trainingLoad != null || pair.run.trainingLoad != null)
      ? Math.round((pair.ride.trainingLoad || 0) + (pair.run.trainingLoad || 0)) : null;
    rows.push({
      key: 'brick-' + w.id, disc: 'brick', name: w.title || 'Brick', href: T.activityUrl(pair.ride),
      tag: (log || {})[w.id] && log[w.id].done ? 'Matched' : null,
      stat: T.fmtDuration(Math.round(pair.ride.movingTimeSec / 60)) + ' ride + '
        + T.fmtDuration(Math.round(pair.run.movingTimeSec / 60)) + ' run'
        + (load != null ? ' · load ' + load : ''),
    });
  });

  // Everything unclaimed renders as itself; tag it when it matched a session
  // that has been ticked off.
  day.filter(a => !claimed.has(a.id)).forEach(a => {
    const disc = DISC[a.type];
    const min = a.movingTimeSec / 60;
    const owner = sessions.find(w => w.discipline === disc && (log || {})[w.id] && log[w.id].done
      && w.durationMin && min >= w.durationMin * 0.5 && min <= w.durationMin * 1.7);
    rows.push({ key: a.id, disc, name: a.name || a.type, stat: statBits(a, disc), tag: owner ? 'Matched' : null, href: T.activityUrl(a) });
  });

  if (!rows.length) return null;
  return (
    <>
      <div className="section-title" style={{ marginTop: 14 }}>Recorded</div>
      <div className="card">
        {rows.map(r => <Row key={r.key} {...r} />)}
      </div>
    </>
  );
}
