/* Try — the power curve (phase 7 §1, §2, §5, §6).
 *
 * An FTP is one number about a rider. It says nothing about whether they can
 * sprint, whether they can go again after a minute at full gas, or whether
 * the number holds up in the fifth hour. The curve is the rest of the answer.
 *
 * THE WHOLE MODULE IS GATED, AND THE GATE IS REAL. Try has no power-curve
 * endpoint — the backend exposes thresholds and activities and nothing that
 * carries best power by duration — and a curve cannot be assembled from
 * activity averages: a ride average is not a best effort, and the best
 * twenty-minute power inside a four-hour ride is not recoverable from its
 * mean. So every function here returns null until the data arrives, the maths
 * is written and tested against known values so the day it lands is a wiring
 * day, and the ask is in the backend handoff. §7's first acceptance criterion
 * is that this stays disabled until then, which is the one criterion a phase
 * can meet by NOT doing something.
 *
 * §5 IS THE SUBTLE ONE AND IT SHAPES THE DATA MODEL. A new power meter can
 * read several per cent different from the old one, and a rider who changes
 * one appears to get suddenly stronger at every duration on the same legs.
 * So a point is never just a number: it carries where it came from, when, on
 * which bike, indoors or out, and how much the reading is trusted. Two points
 * from different sources are not comparable, and the comparison functions
 * refuse rather than quietly producing a "gain" that is a hardware change.
 */

/* §2. Seconds, because that is how best-power is indexed everywhere it
   exists, and because minutes would need fractions at the short end. */
export const CURVE_DURATIONS = [5, 15, 30, 60, 180, 300, 720, 1200, 2400, 3600];

export const CURVE_LABELS = {
  5: '5 sec', 15: '15 sec', 30: '30 sec', 60: '1 min', 180: '3 min',
  300: '5 min', 720: '12 min', 1200: '20 min', 2400: '40 min', 3600: '60 min',
};

export const POWER_CURVE_RULES = {
  staleDays: 120,        // a best older than a training block no longer describes now
  /* §1 lists an "optional freshness window" as a backend capability. It
     belongs to the QUERY, not to this module — the window decides which rides
     the endpoint considers when it builds the curve, and nothing here can
     apply it after the fact. It is named in the backend handoff instead of
     sitting here as a constant that looks implemented. */
  minPointsForProfile: 5,
  minQuality: 'medium',  // below this a point is recorded and never judged
  sourceJumpPct: 3,      // a source change can move readings by about this much
};

export const QUALITY_ORDER = ['low', 'medium', 'high'];

/* The conventional relationship between a twenty-minute best and a threshold.
 *
 * Exported because TWO places depend on it and they must not drift: the stale
 * FTP signal converts a twenty-minute best into an implied threshold with it,
 * and the rider profile's reference shape has to place twenty-minute power at
 * its reciprocal, or a rider whose curve exactly matches the definition of
 * their own FTP reads as above shape. That is not hypothetical: the first cut
 * had them independently chosen, and a rider matching a definition-derived
 * reference read +2% at threshold, +2.7% at durability and +3.3% at VO2 while
 * being, by construction, exactly average. */
export const FTP_FROM_20MIN = 0.95;

/* One point, normalised and never trusted blindly. Returns null for anything
   that is not a usable reading, so a caller cannot render a watts figure that
   came from a malformed row. */
export function curvePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const durationSec = Number(raw.durationSec);
  const watts = Number(raw.watts);
  // Infinity > 0 is true and Math.round(Infinity) is Infinity, so the old
  // guard passed a non-finite reading straight through to "Infinity W" on a
  // card. A number that is not finite is not a measurement.
  if (!CURVE_DURATIONS.includes(durationSec) || !Number.isFinite(watts) || watts <= 0) return null;
  return {
    durationSec,
    watts: Math.round(watts),
    date: raw.date || null,
    // §5: everything needed to know whether two readings can be compared
    source: raw.source || null,      // the device that recorded it
    bike: raw.bike || null,
    indoor: raw.indoor == null ? null : !!raw.indoor,
    /* Absent means UNKNOWN, not bad. Defaulting to 'low' looked cautious and
       was actually a silent kill switch: the profile filters to medium and
       above, so a backend that shipped the endpoint without a confidence
       signal — which the handoff explicitly allows — would have left §3, §4
       and §6's implication permanently dark with no error anywhere. Only an
       explicit 'low' is treated as untrusted. */
    quality: QUALITY_ORDER.includes(raw.quality) ? raw.quality : 'medium',
    qualityKnown: QUALITY_ORDER.includes(raw.quality),
  };
}

/* §1/§7: whether there is anything to work with at all. Absent means absent:
   nothing is inferred, estimated or back-filled from activity averages. */
export function curveAvailable(raw) {
  return Array.isArray(raw) && raw.map(curvePoint).filter(Boolean).length > 0;
}

/* The curve, or null. Points are keyed by duration and deduplicated to the
   best watts at each, with the metadata of the reading that won. */
export function powerCurve(raw) {
  if (!curveAvailable(raw)) return null;
  const best = new Map();
  raw.map(curvePoint).filter(Boolean).forEach(p => {
    const cur = best.get(p.durationSec);
    if (!cur || p.watts > cur.watts) best.set(p.durationSec, p);
  });
  const points = CURVE_DURATIONS.filter(d => best.has(d)).map(d => best.get(d));
  return {
    points,
    durations: points.map(p => p.durationSec),
    // §5/§6: what the athlete is looking at, so a jump can be explained
    sources: [...new Set(points.map(p => p.source).filter(Boolean))],
    latest: points.map(p => p.date).filter(Boolean).sort().pop() || null,
  };
}

/* §6: durations whose best is old enough that it describes a previous
   athlete. Reported, never hidden: a curve with a two-year-old sprint on it
   is not wrong, it is just not current, and saying so is the honest move. */
export function staleDurations(curve, todayISO) {
  if (!curve || !todayISO) return [];
  return curve.points.filter(p => {
    if (!p.date) return true;                 // undated is stale by definition
    const days = (Date.parse(todayISO) - Date.parse(p.date)) / 86400000;
    return days > POWER_CURVE_RULES.staleDays;
  }).map(p => p.durationSec);
}

/* §5/§7: may these two readings be compared at all?
 *
 * Different meters, or indoors against outdoors, are not the same
 * measurement. Returning false here is the whole point of the section: a
 * comparison that silently crosses a device change reports a hardware
 * difference as a training gain, and that is the one error an athlete has no
 * way to detect for themselves. */
export function comparable(a, b) {
  if (!a || !b) return false;
  if (a.durationSec !== b.durationSec) return false;
  /* FAILS CLOSED. This used to require BOTH sides to name a source before it
     would refuse, so a point with no source was comparable to a point from
     any meter on earth — and curvePoint normalises a missing source to null,
     so one older curve stored before the field existed, or one backend that
     omits it on historical rows, silently switched the whole §5 protection
     off and reported a 5% hardware difference as a 5% gain at every duration.
     An unknown source is not a matching source. The same reasoning applies to
     the bike and the environment: §5 lists all three as things a point must
     retain, and retaining them without consulting them is worse than not
     having them, because it looks handled. */
  if (a.source !== b.source) return false;
  if (a.bike !== b.bike) return false;
  if (a.indoor !== b.indoor) return false;
  return true;
}

/* §6: this curve against an older one, duration by duration.
 *
 * Every duration lands in exactly one bucket: improved, declined, unchanged,
 * or NOT COMPARABLE with the reason. The fourth is the one that matters and
 * it is never silently dropped. */
export function curveComparison({ current, previous }) {
  if (!current || !previous) return null;
  const prev = new Map(previous.points.map(p => [p.durationSec, p]));
  const rows = current.points.map(p => {
    const q = prev.get(p.durationSec);
    if (!q) return { durationSec: p.durationSec, status: 'new', watts: p.watts };
    if (!comparable(p, q)) {
      return {
        durationSec: p.durationSec, status: 'incomparable', watts: p.watts, wasWatts: q.watts,
        /* An UNKNOWN source is a source problem, not an environment one.
           This used to require both sides to name a meter before saying
           "different power meter", so the exact case the comparability guard
           fails closed for — one side missing its source — was refused
           correctly but explained wrongly, and sourceChanged stayed false, so
           the device-change banner never appeared for it. */
        why: p.source !== q.source
          ? (p.source && q.source ? 'recorded on a different power meter'
            : 'recorded without a power-meter identifier, so it cannot be compared safely')
          : p.bike !== q.bike ? 'recorded on a different bike'
            : 'recorded in a different environment',
      };
    }
    const deltaPct = (p.watts - q.watts) / q.watts * 100;
    return {
      durationSec: p.durationSec, watts: p.watts, wasWatts: q.watts,
      deltaPct: Math.round(deltaPct * 10) / 10,
      status: Math.abs(deltaPct) < 1 ? 'unchanged' : deltaPct > 0 ? 'improved' : 'declined',
    };
  });
  /* Durations the athlete used to have a best at and no longer does. The
     comment above claimed every duration lands in exactly one bucket and then
     mapped over the CURRENT points only, so this case fell through a gap —
     and with the freshness window the handoff asks for, it is the normal
     case rather than an edge one. */
  const current_ = new Set(current.points.map(p => p.durationSec));
  previous.points.filter(p => !current_.has(p.durationSec)).forEach(p => {
    rows.push({ durationSec: p.durationSec, status: 'gone', wasWatts: p.watts });
  });
  rows.sort((a, b) => a.durationSec - b.durationSec);
  const incomparable = rows.filter(r => r.status === 'incomparable');
  const sourceChanged = incomparable.length > 0 && incomparable.some(r => /power.meter/.test(r.why || ''));
  // Only the rows that changed METER. Averaging in rows that differ for some
  // other reason (a ride moved indoors, a different bike) produced a number
  // presented as a calibration offset that was partly not one, and both error
  // directions are bad: it can hide a real device shift inside an average, or
  // manufacture one that never happened.
  const shifts = incomparable
    .filter(r => r.wasWatts > 0 && /power meter/.test(r.why || ''))
    .map(r => (r.watts - r.wasWatts) / r.wasWatts * 100);
  const shift = shifts.length
    ? Math.round(shifts.reduce((t, x) => t + x, 0) / shifts.length * 10) / 10 : null;
  return {
    rows,
    improved: rows.filter(r => r.status === 'improved').map(r => r.durationSec),
    declined: rows.filter(r => r.status === 'declined').map(r => r.durationSec),
    incomparable: incomparable.map(r => r.durationSec),
    gone: rows.filter(r => r.status === 'gone').map(r => r.durationSec),
    /* §5's headline case, stated once rather than per row: a whole-curve jump
       that coincides with a device change is a device change until proven
       otherwise. */
    sourceChanged,
    /* How big the shift across the changed readings actually is. A device
       swap moves everything by roughly the same small percentage, whichever
       duration you look at; real fitness does not arrive evenly across five
       seconds and sixty minutes on the same day. So a uniform shift of about
       the size a calibration difference produces is worth naming as one,
       rather than leaving the athlete to wonder which it was. */
    sourceShiftPct: sourceChanged ? shift : null,
    looksLikeCalibration: sourceChanged && shift != null
      && Math.abs(shift) <= POWER_CURVE_RULES.sourceJumpPct,
  };
}

/* §4: is the athlete's FTP contradicted by their own best twenty-minute
   power? This is the one training application that can be answered from the
   curve alone, and it only ever RECOMMENDS A TEST — §4 is explicit that the
   curve must not rewrite the plan, and §7 that it must not overwrite FTP. */
export function staleFtpSignal({ curve, ftpWatts, todayISO, previous, ftpSource }) {
  if (!curve || !ftpWatts) return null;
  const p20 = curve.points.find(p => p.durationSec === 1200);
  if (!p20 || p20.quality === 'low') return null;
  if (todayISO && staleDurations(curve, todayISO).includes(1200)) return null;
  /* §5, APPLIED WHERE IT ACTUALLY MATTERS. The module builds a whole detector
     for hardware-versus-fitness and then this — the ONE signal that reaches
     the athlete — used to ignore it entirely, so a new meter reading six per
     cent high told a rider their threshold had moved. A twenty-minute best
     may only argue about a threshold if it was measured the same way the
     threshold was.
     Indoors versus outdoors counts too: a trainer and a road are not the same
     measurement, and a threshold set on one is not evidence about the other. */
  if (previous) {
    const q20 = previous.points.find(p => p.durationSec === 1200);
    if (q20 && !comparable(p20, q20)) return null;
  }
  if (ftpSource && p20.source && ftpSource !== p20.source) return null;
  // a twenty-minute best is conventionally a little above threshold; well
  // above it means the threshold is behind the rider
  const impliedFtp = p20.watts * FTP_FROM_20MIN;
  const pct = (impliedFtp - ftpWatts) / ftpWatts * 100;
  if (pct < 5) return null;
  return {
    impliedFtp: Math.round(impliedFtp),
    ftpWatts,
    pct: Math.round(pct * 10) / 10,
    date: p20.date,
    /* Deliberately a recommendation and not a change. The curve says what the
       rider did once, on a day, possibly on a descent; a threshold is what
       they can hold repeatedly, and only a test settles that. */
    text: 'Your best twenty-minute power suggests a threshold around '
      + Math.round(impliedFtp) + ' W, about ' + Math.round(pct)
      + '% above the number your targets are built from. Worth riding the twenty-minute test rather than a change on the strength of one ride.',
  };
}
