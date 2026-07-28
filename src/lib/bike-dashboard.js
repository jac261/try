/* Try — phase 8: the bike dashboard.
 *
 * One question, the same one the swim dashboard answers: what is limiting my
 * bike, and what is the plan doing about it? Everything here is a pure read
 * over what phases 1 to 7 already built — the power anchor, the review
 * engine, durability, fuelling, bricks, position, the curve. Nothing
 * generates, nothing writes, nothing is stored.
 *
 * THREE RULES RUN THROUGH IT, and two of them are scars.
 *
 * Every number says where it came from, so a derived figure can never be read
 * as a measured one, and 'missing' is a first-class answer rather than a zero
 * pretending to be data (§9's "conclusions expose confidence").
 *
 * EVERY WINDOW IS THE WINDOW THE CARD CLAIMS. The swim dashboard shipped an
 * all-time completion rate inside a card headed "last 6 weeks", which is the
 * kind of error nobody notices because both halves are individually true.
 * Anything rolling here is computed over BIKE_DASH_RULES.weeks and nothing
 * else.
 *
 * AND A PLAN ON ITS FIRST DAY ACCUSES NOBODY. The same dashboard told
 * athletes they had completed 0% of their sessions before a single one had
 * come due. A rate over zero opportunities is not zero, it is absent.
 */
import { bikePowerAnchor, RACES } from './domain.js';
import { daysBetween, iso, startOfWeekMonday, addDays } from './date.js';
import { metric } from './swim-dashboard.js';
import { isTrainingRide } from './bikeschema.js';
import { isIndoor } from './autolog.js';
import { bikeDistance } from './bike-distance.js';
import { plannedBikeEfforts } from './bike-review.js';
import { bikeFuellingPlan, FUEL_LEVEL_GRAMS } from './bike-fuelling.js';
import { longRideObjective, LONG_OBJECTIVES } from './bike-long.js';
import { positionRead, positionTolerance } from './bike-position.js';
import { brickHistory } from './brick.js';

export const BIKE_DASH_RULES = {
  weeks: 6,              // the window every rolling figure uses
  completionFloor: 0.7,  // below this, consistency is the limiter
  minSessions: 4,        // below this there is no completion rate worth naming
  /* Mirrors BIKE_REVIEW_RULES.fadeSoftPct, and is written out rather than
     imported. Reading another module's constant AT MODULE SCOPE inside a
     circular import graph resolves to undefined — the review engine is still
     initialising when this file evaluates — which is the same temporal dead
     zone the phase 5 rep table hit. A test asserts the two stay equal, so the
     duplication cannot drift. */
  fadeConcern: 3,
  driftConcern: 5,       // heart-rate drift, percent
  indoorHeavy: 0.8,      // riding this much indoors is worth naming
};

const QUALITY_TYPES = ['Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'];

function ridesIn({ plan, moves, from, to }) {
  return (plan && plan.weeks ? plan.weeks.flatMap(w => w.workouts) : [])
    .filter(w => (isTrainingRide(w) || (w.discipline === 'brick' && !w.race)))
    .map(w => ({ w, date: (moves && moves[w.id]) || w.date }))
    .filter(x => x.date >= from && x.date <= to);
}

/* §2: where the athlete is now.
 *
 * §9's first acceptance criterion lives here: real and estimated FTP are
 * never conflated. They are different FIELDS, not one field with a flag, so
 * a caller cannot render an estimate in the place a measurement belongs by
 * forgetting to check something. */
function status({ plan, log, moves, activities, todayISO }) {
  const profile = (plan && plan.profile) || {};
  const anchor = bikePowerAnchor(profile);
  const meta = profile.ftpMeta || {};
  const from = iso(addDays(startOfWeekMonday(new Date(todayISO)), -7 * (BIKE_DASH_RULES.weeks - 1)));
  const window = ridesIn({ plan, moves, from, to: todayISO });
  const done = window.filter(x => log && log[x.w.id]);

  // recordings matched to this window, so the indoor split is about the
  // athlete's actual riding rather than about what was planned
  const recs = (activities || []).filter(a => a && /Ride/i.test(a.type || '')
    && a.date >= from && a.date <= todayISO && a.movingTimeSec != null);
  const indoorMin = recs.filter(isIndoor).reduce((t, a) => t + a.movingTimeSec / 60, 0);
  const outdoorMin = recs.filter(a => !isIndoor(a)).reduce((t, a) => t + a.movingTimeSec / 60, 0);

  return {
    // real, or null. NEVER filled in from the estimate.
    ftpWatts: anchor.kind === 'real' ? metric(anchor.ftpWatts, 'recorded', 'W') : metric(null, 'missing'),
    ftpSource: anchor.kind === 'real' ? metric(anchor.source, 'recorded') : metric(null, 'missing'),
    ftpDate: anchor.kind === 'real' && meta.measuredAt ? metric(meta.measuredAt, 'recorded') : metric(null, 'missing'),
    ftpConfidence: anchor.kind === 'real' ? metric(meta.confidence || 'unknown', 'derived') : metric(null, 'missing'),
    /* Shown SEPARATELY and only when there is no real one, which is §2's own
       wording and the whole of §9's first criterion. */
    estimatedFtpWatts: anchor.kind === 'estimated' ? metric(anchor.ftpWatts, 'estimated', 'from your level and weight') : metric(null, 'missing'),
    wkg: profile.ftp && profile.weightKg
      ? metric(Math.round(profile.ftp / profile.weightKg * 100) / 100, 'derived', 'W/kg')
      : metric(null, 'missing'),
    ridesPerWeek: window.length
      ? metric(Math.round(done.length / BIKE_DASH_RULES.weeks * 10) / 10, 'derived')
      : metric(null, 'missing'),
    weeklyMinutes: done.length
      ? metric(Math.round(done.reduce((t, x) => t + (x.w.durationMin || 0), 0) / BIKE_DASH_RULES.weeks), 'derived')
      : metric(null, 'missing'),
    /* §8: OUTDOOR only, and estimated. Indoor virtual distance never enters
       an outdoor figure — a trainer's kilometres are its wheel model's
       opinion, and mixing them into a distance trend makes the trend a
       statement about how often somebody rode inside. */
    outdoorDistanceKm: done.length
      ? metric(Math.round(done.reduce((t, x) => t + bikeDistance(x.w.segments || [], plan.paces), 0)), 'estimated',
        'modelled from each session’s zone mix, not measured')
      : metric(null, 'missing'),
    indoorMinutes: recs.length ? metric(Math.round(indoorMin), 'recorded') : metric(null, 'missing'),
    outdoorMinutes: recs.length ? metric(Math.round(outdoorMin), 'recorded') : metric(null, 'missing'),
    indoorShare: (indoorMin + outdoorMin) > 0
      ? metric(Math.round(indoorMin / (indoorMin + outdoorMin) * 100), 'derived', '% of your riding time')
      : metric(null, 'missing'),
    /* §1 asks "can I complete the prescribed work?", and the answer is about
       ALL of it. Judging consistency on quality sessions alone let an athlete
       who skipped every endurance ride read as consistent — and in a base
       block, where there may be no quality rides scheduled at all, it left
       the question unanswerable for weeks. */
    completion: window.length >= BIKE_DASH_RULES.minSessions
      ? metric(Math.round(done.length / window.length * 100) / 100, 'derived')
      : metric(null, 'missing', 'not enough rides have come due yet'),
    sessions: done.length,
    planned: window.length,
    windowFrom: from,
  };
}

/* §3: the quality work, and whether it is landing.
 *
 * Time in zone counts EFFORTS, not sessions. A ninety-minute threshold ride
 * is fifteen minutes of threshold and seventy-five of everything else, and
 * counting the session would make the number about how long the athlete rode
 * rather than about how much work they did. */
function quality({ plan, log, moves, todayISO, reviews, retest }) {
  const from = iso(addDays(startOfWeekMonday(new Date(todayISO)), -7 * (BIKE_DASH_RULES.weeks - 1)));
  const window = ridesIn({ plan, moves, from, to: todayISO }).filter(x => QUALITY_TYPES.includes(x.w.type));
  const done = window.filter(x => log && log[x.w.id]);
  const minutesIn = zone => done.reduce((t, x) =>
    t + plannedBikeEfforts(x.w).filter(e => e.zone === zone).reduce((s, e) => s + e.min, 0), 0);

  const rv = (reviews || []).filter(r => r && r.date && r.date >= from && r.date <= todayISO);
  const adh = rv.filter(r => r.powerAdherence != null);
  const fades = rv.filter(r => r.intervalFadePercent != null);

  return {
    // Z3 holds both tempo and sweet spot; they are separated by TYPE, since
    // the zone alone cannot tell them apart
    sweetSpotMin: done.length ? metric(Math.round(done.filter(x => x.w.type === 'Sweet Spot')
      .reduce((t, x) => t + plannedBikeEfforts(x.w).reduce((s, e) => s + e.min, 0), 0)), 'derived') : metric(null, 'missing'),
    thresholdMin: done.length ? metric(Math.round(minutesIn('Z4')), 'derived') : metric(null, 'missing'),
    vo2Min: done.length ? metric(Math.round(minutesIn('Z5')), 'derived') : metric(null, 'missing'),
    /* A rate needs opportunities. With nothing due yet this is MISSING, not
       zero: the swim dashboard told day-one athletes they had completed 0%
       of sessions that had not come round. */
    completion: window.length >= BIKE_DASH_RULES.minSessions
      ? metric(Math.round(done.length / window.length * 100) / 100, 'derived')
      : metric(null, 'missing', 'not enough quality sessions have come due yet'),
    adherence: adh.length
      ? metric(Math.round(adh.reduce((t, r) => t + r.powerAdherence, 0) / adh.length * 10) / 10, 'recorded', '% from the prescription')
      : metric(null, 'missing'),
    fade: fades.length
      ? metric(Math.round(fades.reduce((t, r) => t + r.intervalFadePercent, 0) / fades.length * 10) / 10, 'recorded', '% in the closing efforts')
      : metric(null, 'missing'),
    outcomes: rv.length ? rv.reduce((m, r) => { m[r.outcome] = (m[r.outcome] || 0) + 1; return m; }, {}) : null,
    nextFtp: retest ? metric(retest.headline, 'derived', retest.why) : metric(null, 'missing'),
    sessions: done.length,
    planned: window.length,
  };
}

/* §4: whether it holds up when the ride is long. */
function durability({ plan, log, moves, activities, todayISO, durabilityReads, fuelLog, positionLog, paces }) {
  const from = iso(addDays(startOfWeekMonday(new Date(todayISO)), -7 * (BIKE_DASH_RULES.weeks - 1)));
  const window = ridesIn({ plan, moves, from, to: todayISO });
  const done = window.filter(x => log && log[x.w.id]);
  const reads = (durabilityReads || []).filter(r => r && r.discipline === 'bike'
    && r.date >= from && r.date <= todayISO);
  const fades = reads.filter(r => r.read && r.read.outputDropPct != null);
  const drifts = reads.filter(r => r.read && r.read.hrDriftPct != null);

  // §3's fuelling half: did the athlete take in what the session asked for?
  const fuelled = done.map(x => {
    const fp = bikeFuellingPlan({ workout: x.w, profile: plan.profile, fuelLog });
    if (!fp) return null;
    const act = (activities || []).find(a => a && a.date === x.date && /Ride/i.test(a.type || ''));
    const lvl = act && fuelLog && fuelLog[act.id] && fuelLog[act.id].level;
    if (!lvl) return null;
    return FUEL_LEVEL_GRAMS[lvl] >= fp.carbsPerHour - 25;
  }).filter(v => v !== null);

  const posReads = Object.values(positionLog || {})
    .map(r => positionRead(r)).filter(Boolean);
  const tolerance = positionTolerance(posReads);

  const objectives = done.map(x => longRideObjective({ workout: x.w, seed: x.w.seed }))
    .filter(Boolean);

  return {
    longestRideMin: done.length
      ? metric(Math.max(...done.map(x => x.w.durationMin || 0)), 'derived') : metric(null, 'missing'),
    lateFadePct: fades.length
      ? metric(Math.round(fades.reduce((t, r) => t + r.read.outputDropPct, 0) / fades.length * 10) / 10, 'recorded', '% down in the closing third')
      : metric(null, 'missing'),
    hrDriftPct: drifts.length
      ? metric(Math.round(drifts.reduce((t, r) => t + r.read.hrDriftPct, 0) / drifts.length * 10) / 10, 'recorded', '%')
      : metric(null, 'missing'),
    fuellingMet: fuelled.length
      ? metric(Math.round(fuelled.filter(Boolean).length / fuelled.length * 100), 'reported', '% of long rides fuelled to plan')
      : metric(null, 'missing', 'no fuelling answers logged yet'),
    /* §4 asks for "aero duration". There is no position channel, so what
       exists is the athlete's own tolerance read, which is reported as such
       and never dressed up as a measured aero time. */
    positionTolerance: tolerance.verdict === 'unknown'
      ? metric(null, 'missing', tolerance.text)
      : metric(tolerance.verdict, 'reported', tolerance.text),
    longestPositionMin: tolerance.longestMin ? metric(tolerance.longestMin, 'reported') : metric(null, 'missing'),
    objectives: objectives.length
      ? metric(objectives.reduce((m, o) => { m[o.primary] = (m[o.primary] || 0) + 1; return m; }, {}), 'derived')
      : metric(null, 'missing'),
    objectiveLabels: LONG_OBJECTIVES,
    reads: reads.length,
  };
}

/* §5: ONE primary limiter, with the evidence for it and §6's plan response.
 *
 * One, not a ranked list: a dashboard that names five limiters has named
 * none, and the athlete cannot act on five things at once. The order below is
 * the order these things actually block progress in. */
export function bikeLimiter(d) {
  const out = (id, headline, evidence, response) => ({ id, headline, evidence, response });
  const comp = d.status.completion.value;

  if (comp != null && comp < BIKE_DASH_RULES.completionFloor) {
    return out('consistency', 'Consistency is limiting your bike',
      ['You have completed ' + Math.round(comp * 100) + '% of your planned rides in the last '
        + BIKE_DASH_RULES.weeks + ' weeks.',
        'Progression needs the sessions to happen before it can ask for more.'],
      ['The plan holds its current progression rather than adding load.',
        'Missed sessions are never made up: the week moves on.']);
  }
  if (d.status.ftpWatts.value == null) {
    return out('data-confidence', 'Your bike targets are guesses',
      ['No FTP has been measured, so every watt target is derived from your level.',
        'Nothing on this page can judge your riding until that changes.'],
      ['A ramp test is scheduled in your plan.',
        'Once you ride it, every bike target re-anchors to you.']);
  }
  if (d.brick && d.brick.pattern) {
    return out('bike-to-run', 'Your bike pacing is costing you the run',
      [d.brick.pattern.text],
      ['The plan holds bike intensity in the week of a brick rather than progressing it.',
        'How a bike leg is ridden shows up in the run, not in the ride.']);
  }
  if (d.durability.lateFadePct.value != null && d.durability.lateFadePct.value > BIKE_DASH_RULES.fadeConcern) {
    return out('durability', 'Durability is limiting your bike',
      ['Your output falls about ' + d.durability.lateFadePct.value + '% in the closing third of long rides.',
        d.durability.hrDriftPct.value != null
          ? 'Heart rate drifts ' + d.durability.hrDriftPct.value + '% over the same window.'
          : 'No heart-rate data on those rides, so the cardiac half of this is unread.'],
      ['The plan holds threshold progression and adds long-ride duration instead.',
        'Late-ride stability sessions rehearse exactly this.']);
  }
  if (d.durability.fuellingMet.value != null && d.durability.fuellingMet.value < 50) {
    return out('fuelling', 'Fuelling is limiting your long rides',
      ['You hit the fuelling plan on ' + d.durability.fuellingMet.value + '% of your long rides.',
        'On a ride over three hours that gap is usually what the last hour felt like.'],
      ['The plan progresses your carbohydrate target one step at a time rather than jumping to race rates.',
        'Every long ride carries the number to practise.']);
  }
  if (d.quality.adherence.value != null && d.quality.adherence.value <= -BIKE_DASH_RULES.fadeConcern) {
    return out('threshold', 'Threshold is limiting your bike',
      ['Recent quality efforts are coming in below their targets.',
        'That usually means the targets are set too high rather than that you are unfit.'],
      ['A ramp test is recommended so the targets match you.',
        'Until then the plan repeats rather than progresses the threshold work.']);
  }
  if (d.durability.positionTolerance.value === 'back-off') {
    return out('aero-tolerance', 'Position tolerance is limiting your race setup',
      [d.durability.positionTolerance.note],
      ['The plan keeps the position work in shorter blocks and builds the time back up.',
        'This guides how long you ride in position, and says nothing about your bike fit.']);
  }
  const hasQuality = d.quality.adherence.value != null;
  return out('none', 'Nothing is obviously holding your bike back',
    [comp != null ? 'You are completing your planned rides.'
      : 'Not enough completed rides yet to name a limiter.',
      ...(hasQuality ? ['Your quality efforts are landing on target.'] : [])],
    ['The plan continues to progress as written.']);
}

/* The whole model. One call, one pure object. */
export function bikeDashboard({
  plan, log, moves, activities, todayISO, retest, reviews,
  durabilityReads, fuelLog, positionLog,
}) {
  if (!plan || !plan.weeks) return null;
  const today = todayISO || iso(new Date());
  const st = status({ plan, log, moves, activities, todayISO: today });
  const ql = quality({ plan, log, moves, todayISO: today, reviews, retest });
  const du = durability({
    plan, log, moves, activities, todayISO: today, durabilityReads, fuelLog, positionLog, paces: plan.paces,
  });
  const brick = brickHistory({
    plan, activities: activities || [], log, moves, paces: plan.paces, fuelLog, limit: 3,
  });
  const d = {
    windowWeeks: BIKE_DASH_RULES.weeks,
    status: st, quality: ql, durability: du, brick,
    race: RACES[(plan.profile || {}).raceType] || null,
    daysToRace: plan.raceDate ? daysBetween(today, plan.raceDate) : null,
  };
  d.limiter = bikeLimiter(d);
  return d;
}
