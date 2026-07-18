import * as T from '@/lib';
import { effDate } from '@/lib/schedule.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';

/* What you actually DID on a day, as first-class rows: every watch recording
   for the date, with its data inline — independent of whether it matched a
   planned session (field decision 2026-07-11). Two truthfulness rules:
   a brick's ride+run recordings fold into ONE row when they pair with the
   day's brick session, and any recording matched to a completed session is
   tagged with it, so plan and reality visibly connect without double-counting.
   Average HR and power render as soon as the backend passes them through. */

const DISC = T.DISCIPLINE; // activity type → discipline (autolog's map)

// Trainer and treadmill recordings: label the row and drop the speed bit
// rather than presenting a fabricated one. The map lives in autolog beside
// DISCIPLINE so review.js judges the same recordings the same way.
const INDOOR = T.INDOOR_TYPES;
function statBits(a, disc) {
  const bits = [];
  const indoor = !!INDOOR[a.type];
  if (a.movingTimeSec) bits.push(T.fmtDuration(Math.round(a.movingTimeSec / 60)));
  if (a.distance) bits.push((a.distance / 1000).toFixed(a.distance >= 10000 ? 0 : 1) + ' km');
  if (a.movingTimeSec && a.distance && !indoor) {
    if (disc === 'run') bits.push(T.fmtPace(a.movingTimeSec / (a.distance / 1000)) + ' /km');
    if (disc === 'swim') bits.push(T.fmtPace(a.movingTimeSec / (a.distance / 100)) + ' /100m');
    if (disc === 'bike') bits.push((a.distance / 1000 / (a.movingTimeSec / 3600)).toFixed(1) + ' km/h');
  }
  if (a.averageWatts) bits.push(Math.round(a.averageWatts) + ' W avg');
  if (a.averageHeartrate) bits.push(Math.round(a.averageHeartrate) + ' bpm avg');
  if (a.trainingLoad != null) bits.push((a.estimated ? '~load ' : 'load ') + Math.round(a.trainingLoad));
  return bits.join(' · ');
}

function Row({ disc, name, stat, tag, onOpen, manual, indoor }) {
  return (
    // A manual row's first tap celebrates, later taps edit — the accessible
    // name stays neutral so it is never wrong about which one comes next.
    // Indoor joins the label because it is the first tag that WITHHOLDS data
    // (the pace or speed line): without it a screen reader gets no
    // explanation for the missing stat (gauntlet catch 2026-07-18).
    <div className="wk" {...tap(onOpen)}
      aria-label={(manual ? 'Open ' : 'Recap: ') + name + (indoor ? ', indoor' : '')}>
      <div className="dot" style={{ background: T.DISCIPLINES[disc].grad }}><Icon name={T.DISCIPLINES[disc].icon} size={22} /></div>
      <div className="meta">
        <div className="t">{name} {tag && <span className="tag key">{tag}</span>}{indoor && <span className="tag indoor">Indoor</span>}</div>
        <div className="s">{stat}</div>
      </div>
      <div className="right" aria-hidden="true">›</div>
    </div>
  );
}

export function RecordedActivities({ activities, date, plan, log, moves, onOpen, noHeading }) {
  // The DISCIPLINES guard keeps a future drift between the activity-type map
  // and the disciplines table from crashing the row render.
  const day = (activities || []).filter(a => a && a.date === date && DISC[a.type] && T.DISCIPLINES[DISC[a.type]] && a.movingTimeSec);
  if (!day.length) return null;
  const sessions = plan && Array.isArray(plan.weeks)
    ? plan.weeks.flatMap(w => w.workouts).filter(w => effDate(w, moves) === date) : [];

  // Fold each brick session's recording pair into one combined row. The
  // matcher sees REAL recordings only: a hand-logged diary entry must never
  // be folded into a brick's Matched row as if it were a measured leg.
  const feedActs = (activities || []).filter(a => a && !a.manual);
  const rows = [];
  const claimed = new Set();
  sessions.filter(w => w.discipline === 'brick').forEach(w => {
    const pair = T.brickPairFor({ workout: w, activities: feedActs, moves, used: claimed });
    if (!pair) return;
    claimed.add(pair.ride.id); claimed.add(pair.run.id);
    const load = (pair.ride.trainingLoad != null || pair.run.trainingLoad != null)
      ? Math.round((pair.ride.trainingLoad || 0) + (pair.run.trainingLoad || 0)) : null;
    rows.push({
      key: 'brick-' + w.id, disc: 'brick', name: w.title || 'Brick', open: { workout: w },
      tag: (log || {})[w.id] && log[w.id].done ? 'Matched' : null,
      stat: T.fmtDuration(Math.round(pair.ride.movingTimeSec / 60)) + (INDOOR[pair.ride.type] ? ' indoor ride + ' : ' ride + ')
        + T.fmtDuration(Math.round(pair.run.movingTimeSec / 60)) + (INDOOR[pair.run.type] ? ' indoor run' : ' run')
        + (load != null ? ' · load ' + load : ''),
    });
  });

  // Everything unclaimed renders as itself; tag it when it matched a session
  // that has been ticked off.
  day.filter(a => !claimed.has(a.id)).forEach(a => {
    const disc = DISC[a.type];
    const min = a.movingTimeSec / 60;
    // A manual entry never claims a plan workout: routing it through the
    // matched branch would hijack its edit sheet and lend it plan-relative
    // verdicts it has no data for (gauntlet catch).
    const owner = a.manual ? null : sessions.find(w => w.discipline === disc && (log || {})[w.id] && log[w.id].done
      && w.durationMin && min >= w.durationMin * T.MATCH_WINDOW.lo && min <= w.durationMin * T.MATCH_WINDOW.hi);
    // Always carry THIS activity, even when it matched a planned session:
    // two same-discipline recordings on one day can both fall in one session's
    // window, and re-deriving from the workout alone would resolve to the
    // recording closest to the planned duration, not the one actually tapped.
    rows.push({ key: a.id, disc, name: a.name || a.type, stat: statBits(a, disc), manual: !!a.manual,
      indoor: !!INDOOR[a.type],
      tag: a.manual ? 'Logged' : owner ? 'Matched' : null,
      open: owner ? { workout: owner, activity: a } : { activity: a } });
  });

  if (!rows.length) return null;
  return (
    <>
      {/* noHeading: when this card is a day's only content (calendar tab with
          no plan), the date heading directly above already owns it, and two
          stacked section-titles read as a layout glitch */}
      {!noHeading && <div className="section-title" style={{ marginTop: 14 }}>Recorded</div>}
      <div className="card">
        {rows.map(({ key, open, ...r }) => <Row key={key} {...r} onOpen={() => onOpen && onOpen(open)} />)}
      </div>
    </>
  );
}
