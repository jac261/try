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
/* `pool` is threaded in from the component rather than read from a `plan` in
   scope: this function is module-level and never had one. Referencing it here
   was a live ReferenceError ("plan is not defined") that took out the whole
   calendar day view for any athlete with a recorded OUTDOOR swim carrying a
   distance — the only branch that touched it (shipped in the pool-profile
   phase, found 2026-07-30 from a production error report). */
function statBits(a, disc, pool) {
  const bits = [];
  const indoor = !!INDOOR[a.type];
  if (a.movingTimeSec) bits.push(T.fmtDuration(Math.round(a.movingTimeSec / 60)));
  if (a.distance) bits.push((a.distance / 1000).toFixed(a.distance >= 10000 ? 0 : 1) + ' km');
  if (a.movingTimeSec && a.distance && !indoor) {
    if (disc === 'run') bits.push(T.fmtPace(a.movingTimeSec / (a.distance / 1000)) + ' /km');
    if (disc === 'swim') bits.push(T.swimPaceLabel(a.movingTimeSec / (a.distance / 100), pool));
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
      /* the stat line rides along: aria-label REPLACES the accessible name,
         so pace, distance and duration were announced to nobody (audit
         2026-08-05) */
      aria-label={(manual ? 'Open ' : 'Recap: ') + name + (indoor ? ', indoor' : '') + (stat ? ', ' + stat : '')}>
      <div className="dot" style={{ background: T.DISCIPLINES[disc].grad }}><Icon name={T.DISCIPLINES[disc].icon} size={22} /></div>
      <div className="meta">
        <div className="t">{name} {tag && <span className="tag key">{tag}</span>}{indoor && <span className="tag indoor">Indoor</span>}</div>
        <div className="s">{stat}</div>
      </div>
      <div className="right" aria-hidden="true">›</div>
    </div>
  );
}

export function RecordedActivities({ activities, date, plan, log, moves, onOpen, noHeading, bare }) {
  // The DISCIPLINES guard keeps a future drift between the activity-type map
  // and the disciplines table from crashing the row render.
  const day = (activities || []).filter(a => a && a.date === date && DISC[a.type] && T.DISCIPLINES[DISC[a.type]] && a.movingTimeSec);
  if (!day.length) return null;
  // The athlete's pool, resolved ONCE here where `plan` actually is in scope,
  // and passed down. poolFor tolerates a missing profile and returns the
  // default, so a tracker or a half-hydrated plan still renders a pace.
  const pool = T.poolFor(plan && plan.profile);
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
    /* The shared claim rule (a manual entry never claims a plan workout:
       routing it through the matched branch would hijack its edit sheet and
       lend it plan-relative verdicts it has no data for, a gauntlet catch).
       No `used` set here on purpose: two same-discipline recordings on one
       day can both fall in one session's window and BOTH still render as
       their own rows, each opening the file actually tapped. */
    const owner = T.ownerFor({ activity: a, sessions, log });
    // Always carry THIS activity, even when it matched a planned session:
    // two same-discipline recordings on one day can both fall in one session's
    // window, and re-deriving from the workout alone would resolve to the
    // recording closest to the planned duration, not the one actually tapped.
    rows.push({ key: a.id, disc, name: a.name || a.type, stat: statBits(a, disc, pool), manual: !!a.manual,
      indoor: !!INDOOR[a.type],
      tag: a.manual ? 'Logged' : owner ? 'Matched' : null,
      open: owner ? { workout: owner, activity: a } : { activity: a } });
  });

  if (!rows.length) return null;
  const body = rows.map(({ key, open, ...r }) => <Row key={key} {...r} onOpen={() => onOpen && onOpen(open)} />);
  /* bare: the rows with no card and no heading, for a caller that already has
     both — the calendar's week range, where each day is its own card. The
     matching rule has to come from HERE rather than from the grid's
     unclaimedActs: the week is a list like the day card, so a recording that
     a planned session already claims still earns a row (tagged Matched),
     where on the grid it would only be a duplicate dot. */
  if (bare) return <>{body}</>;
  return (
    <>
      {/* noHeading: when this card is a day's only content (calendar tab with
          no plan), the date heading directly above already owns it, and two
          stacked section-titles read as a layout glitch */}
      {!noHeading && <div className="section-title" style={{ marginTop: 14 }}>Recorded</div>}
      <div className="card">{body}</div>
    </>
  );
}
